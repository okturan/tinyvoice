// Cloudflare Worker — WebSocket relay for FocalCodec walkie-talkie
// Room: per-room Durable Object that relays token packets
// Lobby: singleton DO that tracks active rooms for the room list

const ALARM_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
const STALE_THRESHOLD_MS = 10 * 60 * 1000;  // 10 minutes

export class Lobby {
  constructor(state) {
    this.state = state;
    this.rooms = null; // lazy-loaded from storage
  }

  async getRooms() {
    if (this.rooms === null) {
      const stored = await this.state.storage.get("rooms") || {};
      // Migrate old format: bare numbers → { count, lastUpdated }
      for (const [name, value] of Object.entries(stored)) {
        if (typeof value === "number") {
          stored[name] = { count: value, lastUpdated: 0 };
        }
      }
      this.rooms = stored;
      // Schedule cleanup alarm only if not already set
      const existingAlarm = await this.state.storage.getAlarm();
      if (!existingAlarm) {
        this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      }
    }
    return this.rooms;
  }

  async alarm() {
    const rooms = await this.getRooms();
    const now = Date.now();
    let changed = false;
    for (const [name, data] of Object.entries(rooms)) {
      if (now - data.lastUpdated > STALE_THRESHOLD_MS) {
        delete rooms[name];
        changed = true;
      }
    }
    if (changed) {
      await this.state.storage.put("rooms", rooms);
    }
    this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }

  async setRoomCount(room, count) {
    const rooms = await this.getRooms();
    if (count > 0) {
      rooms[room] = { count, lastUpdated: Date.now() };
    } else {
      delete rooms[room];
    }
    await this.state.storage.put("rooms", rooms);
  }

  async fetch(request) {
    const url = new URL(request.url);

    try {
      // POST /update — Room DOs report their user count
      if (request.method === "POST" && url.pathname === "/update") {
        const { room, count } = await request.json();
        if (typeof room !== "string" || typeof count !== "number") {
          return Response.json({ error: "invalid payload: need { room: string, count: number }" }, { status: 400 });
        }
        await this.setRoomCount(room, count);
        return Response.json({ ok: true });
      }

      // POST /reconcile — Room DOs correct stale counts on cold start
      if (request.method === "POST" && url.pathname === "/reconcile") {
        const { room, actualCount } = await request.json();
        if (typeof room !== "string" || typeof actualCount !== "number") {
          return Response.json({ error: "invalid payload: need { room: string, actualCount: number }" }, { status: 400 });
        }
        await this.setRoomCount(room, actualCount);
        return Response.json({ ok: true });
      }

      // GET /list — return active rooms
      if (url.pathname === "/list") {
        const rooms = await this.getRooms();
        const list = Object.entries(rooms).map(([name, data]) => ({
          name,
          count: data.count,
        }));
        return Response.json(list);
      }

      return Response.json({ error: "not found" }, { status: 404 });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = [];
    this.roomName = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ error: "expected WebSocket" }, { status: 426 });
    }

    // Extract room name from path
    this.roomName = decodeURIComponent(url.pathname.split("/ws/")[1] || "default");

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const session = { ws: server, name: "anon" };
    this.sessions.push(session);

    server.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "hello" && msg.name) {
            session.name = msg.name.slice(0, 32);
            this.broadcastUsers();
            return;
          }
        } catch (e) {}
      }
      for (const s of this.sessions) {
        if (s.ws !== server && s.ws.readyState === 1) {
          try { s.ws.send(event.data); } catch (e) {}
        }
      }
    });

    const cleanup = () => {
      this.sessions = this.sessions.filter((s) => s.ws !== server);
      this.broadcastUsers();
      this.notifyLobby();
    };

    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    // Send initial user list to the new connection
    this.broadcastUsers();
    this.notifyLobby();

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcastUsers() {
    const names = this.sessions.map(s => s.name);
    this.broadcast(JSON.stringify({ type: "users", count: names.length, names }));
  }

  async notifyLobby() {
    if (!this.roomName) return;
    try {
      const id = this.env.LOBBY.idFromName("main");
      const lobby = this.env.LOBBY.get(id);
      await lobby.fetch("http://internal/update", {
        method: "POST",
        body: JSON.stringify({ room: this.roomName, count: this.sessions.length }),
      });
    } catch (e) { /* lobby errors are non-fatal */ }
  }

  broadcast(msg) {
    for (const s of this.sessions) {
      if (s.ws.readyState === 1) {
        try { s.ws.send(msg); } catch (e) {}
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Live room list
    if (url.pathname === "/rooms") {
      try {
        const id = env.LOBBY.idFromName("main");
        const lobby = env.LOBBY.get(id);
        const res = await lobby.fetch("http://internal/list");
        const data = await res.json();
        return Response.json(data, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: "failed to fetch room list" }, { status: 502, headers: corsHeaders });
      }
    }

    // WebSocket endpoint: /ws/:room
    if (url.pathname.startsWith("/ws/")) {
      const roomName = url.pathname.split("/ws/")[1] || "default";
      const roomId = env.ROOMS.idFromName(roomName);
      const room = env.ROOMS.get(roomId);
      return room.fetch(request);
    }

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" }, { headers: corsHeaders });
    }

    return Response.json(
      { error: "not found", hint: "endpoints: /rooms, /ws/:room, /health" },
      { status: 404, headers: corsHeaders }
    );
  },
};
