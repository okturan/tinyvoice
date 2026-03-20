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
      return base64ToBytes(decodeURIComponent(v));
    }
  } catch {
    // not a URL
  }
  // Try raw base64
  try {
    const d = base64ToBytes(str);
    if (d.length >= 4 && d.length % 2 === 0) {
      return d;
    }
  } catch {
    // not base64
  }
  return null;
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
  const raw = atob(b64);
  const d = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) d[i] = raw.charCodeAt(i);
  return d;
}
