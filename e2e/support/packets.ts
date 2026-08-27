/**
 * Independent wire-format oracle for the e2e suite. Deliberately does not
 * import the app's implementation so the tests check the app against a
 * second, hand-written encoding of the documented format:
 *   [magic 0x01|0x02|0x03][uint16 LE token]*  — legacy packets omit the magic.
 */
export type Quality = "50hz" | "25hz" | "12_5hz";

export const MAGIC: Record<Quality, number> = { "50hz": 0x01, "25hz": 0x02, "12_5hz": 0x03 };
export const RATE: Record<Quality, number> = { "50hz": 50, "25hz": 25, "12_5hz": 12.5 };
export const LABEL: Record<Quality, string> = { "50hz": "50hz", "25hz": "25hz", "12_5hz": "12.5hz" };
export const ALL_QUALITIES: Quality[] = ["12_5hz", "25hz", "50hz"];

export function tokensFor(count: number, seed = 0): number[] {
  return Array.from({ length: count }, (_, i) => (i * 131 + seed * 7 + 3) % 65536);
}

export function packet(quality: Quality, tokens: number[]): Uint8Array {
  const out = new Uint8Array(1 + tokens.length * 2);
  out[0] = MAGIC[quality];
  const view = new DataView(out.buffer);
  tokens.forEach((t, i) => view.setUint16(1 + i * 2, t, true));
  return out;
}

/** A headerless packet: the app must interpret it as 50 Hz "legacy fallback". */
export function legacyPacket(tokens: number[]): Uint8Array {
  const out = new Uint8Array(tokens.length * 2);
  const view = new DataView(out.buffer);
  tokens.forEach((t, i) => view.setUint16(i * 2, t, true));
  return out;
}

/** Packet holding roughly `seconds` of audio at `quality`. */
export function packetSeconds(quality: Quality, seconds: number, seed = 0): Uint8Array {
  return packet(quality, tokensFor(Math.round(seconds * RATE[quality]), seed));
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

export function voiceUrl(origin: string, bytes: Uint8Array): string {
  return `${origin}/qr?v=${encodeURIComponent(toBase64(bytes))}`;
}

export function tokenCount(bytes: Uint8Array, legacy = false): number {
  return (bytes.length - (legacy ? 0 : 1)) / 2;
}

/** The status line DecodePlayer shows before anything is decoded. */
export function initialStatus(bytes: Uint8Array, quality: Quality, legacy = false): string {
  const tokens = tokenCount(bytes, legacy);
  const seconds = (tokens / RATE[quality]).toFixed(1);
  return `${bytes.length}B, ${tokens} tok, ~${seconds}s · ${LABEL[quality]}${legacy ? " (legacy fallback)" : ""}`;
}
