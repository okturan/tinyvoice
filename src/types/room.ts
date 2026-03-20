/** A room visible in the lobby */
export interface Room {
  name: string;
  count: number;
}

/** A user in a room */
export interface User {
  name: string;
}

/** WebSocket message types from the relay server */
export type WSMessage =
  | WSHelloMessage
  | WSUsersMessage;

export interface WSHelloMessage {
  type: "hello";
  name: string;
}

export interface WSUsersMessage {
  type: "users";
  count: number;
  names: string[];
}
