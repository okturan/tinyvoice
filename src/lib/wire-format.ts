/**
 * Wire format for FocalCodec voice packets.
 *
 * Format: 1 byte magic header + N * 2 bytes (16-bit LE token values)
 * Magic: 0x01 = 50hz, 0x02 = 25hz, 0x03 = 12.5hz
 */

import {
  Quality,
  MAGIC_BYTES,
  MAGIC_TO_QUALITY,
  type WirePacket,
} from "@/types/codec";

/**
 * Pack tokens into wire format with magic byte header.
 *
 * @param tokens - Token values (BigInt64Array from ONNX or number array)
 * @param quality - Codec quality level
 * @returns Uint8Array with magic byte + 16-bit LE tokens
 */
export function packTokens(
  tokens: BigInt64Array | number[],
  quality: Quality,
): Uint8Array {
  const n = tokens.length;
  const pk = new Uint8Array(1 + n * 2);
  pk[0] = MAGIC_BYTES[quality];
  const dv = new DataView(pk.buffer);
  for (let i = 0; i < n; i++) {
    dv.setUint16(1 + i * 2, Number(tokens[i]), true);
  }
  return pk;
}

/**
 * Unpack wire format data into tokens and detected quality.
 *
 * Supports both magic-byte-prefixed format and legacy headerless format.
 * Legacy packets default to Hz50 since quality cannot be reliably guessed
 * from token count alone (recordings can be any duration).
 *
 * @param data - Raw packet bytes
 * @returns Parsed wire packet, or null if data is invalid
 */
export function unpackTokens(data: Uint8Array): WirePacket | null {
  if (data.length < 2) return null;

  // Check for magic byte header using the canonical map
  const magicQuality = data.length >= 3 && (data.length - 1) % 2 === 0
    ? MAGIC_TO_QUALITY[data[0]!]
    : undefined;
  if (magicQuality) {
    return {
      quality: magicQuality,
      tokenBytes: data.slice(1),
      hasMagicByte: true,
    };
  }

  // Legacy: no header — default to Hz50 (cannot reliably guess from count)
  if (data.length % 2 === 0) {
    return {
      quality: Quality.Hz50,
      tokenBytes: data,
      hasMagicByte: false,
    };
  }

  // Odd byte count — invalid packet
  return null;
}

/**
 * Convert raw token bytes (16-bit LE) into a BigInt64Array for ONNX.
 * @throws Error if tokenBytes has odd length
 */
export function tokenBytesToBigInt64(tokenBytes: Uint8Array): BigInt64Array {
  if (tokenBytes.length % 2 !== 0) {
    throw new Error(
      `Invalid token data: expected even byte count, got ${tokenBytes.length}`,
    );
  }
  const n = tokenBytes.length / 2;
  const tok = new BigInt64Array(n);
  const dv = new DataView(
    tokenBytes.buffer,
    tokenBytes.byteOffset,
    tokenBytes.byteLength,
  );
  for (let i = 0; i < n; i++) {
    tok[i] = BigInt(dv.getUint16(i * 2, true));
  }
  return tok;
}
