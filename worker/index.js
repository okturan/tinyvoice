// Cloudflare Worker — WebSocket relay for FocalCodec walkie-talkie
// Room: per-room Durable Object that relays token packets
// Lobby: singleton DO that tracks active rooms for the room list

export class Lobby {
  constructor(state) {
    this.state = state;
    this.rooms = null; // lazy-loaded from storage
  }

  async getRooms() {
    if (this.rooms === null) {
      this.rooms = await this.state.storage.get("rooms") || {};
    }
    return this.rooms;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const rooms = await this.getRooms();
    if (request.method === "POST" && url.pathname === "/update") {
      const { room, count } = await request.json();
      if (count > 0) {
        rooms[room] = count;
      } else {
        delete rooms[room];
      }
      await this.state.storage.put("rooms", rooms);
      return new Response("ok");
    }
    // GET /list
    const list = Object.entries(rooms).map(([name, count]) => ({ name, count }));
    return Response.json(list);
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
      return new Response("Expected WebSocket", { status: 426 });
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
      const id = env.LOBBY.idFromName("main");
      const lobby = env.LOBBY.get(id);
      const res = await lobby.fetch("http://internal/list");
      const data = await res.json();
      return Response.json(data, { headers: corsHeaders });
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

    return new Response("FocalCodec Walkie-Talkie Relay", { headers: corsHeaders });
  },
};
