/**
 * Environment-aware configuration for relay server URLs.
 */

const isLocalhost =
  typeof window !== "undefined" && window.location.hostname === "localhost";

/** HTTP base URL for the relay server (rooms API) */
export const RELAY_HTTP = isLocalhost
  ? "http://localhost:8787"
  : "https://focalcodec-relay.okan.workers.dev";

/** WebSocket base URL for the relay server (append room name) */
export const RELAY_WS = isLocalhost
  ? "ws://localhost:8787/ws/"
  : "wss://focalcodec-relay.okan.workers.dev/ws/";
