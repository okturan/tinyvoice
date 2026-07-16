import { unpackTokens } from "@/lib/wire-format";

const MAX_PACKET_BYTES = 64 * 1024;

/**
 * Decode a QR string (URL with ?v= param, or raw base64) into voice token bytes.
 * Returns Uint8Array on success, null on failure.
 */
export function decodeQRString(str: string): Uint8Array | null {
  // Try as URL with ?v= param
  try {
    const u = new URL(str);
    const v = u.searchParams.get("v");
    if (v) {
      return decodePacketBase64(v);
    }
  } catch {
    // not a URL
  }
  return decodePacketBase64(str);
}

/** Encode bytes to base64, safe for large arrays (no stack overflow from spread). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const value = b64.trim();
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value) ||
    value.slice(0, -2).includes("=")
  ) {
    throw new Error("Invalid base64");
  }
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const raw = atob(padded);
  const d = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) d[i] = raw.charCodeAt(i);
  return d;
}

function decodePacketBase64(value: string): Uint8Array | null {
  try {
    const bytes = base64ToBytes(value);
    if (bytes.byteLength > MAX_PACKET_BYTES || unpackTokens(bytes) === null) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}
