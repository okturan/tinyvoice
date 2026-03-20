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
 *
 * @param data - Raw packet bytes
 * @returns Parsed wire packet, or null if data is invalid
 */
export function unpackTokens(data: Uint8Array): WirePacket | null {
  // Check for magic byte header
  if (
    data.length >= 3 &&
    data[0]! >= 0x01 &&
    data[0]! <= 0x03 &&
    (data.length - 1) % 2 === 0
  ) {
    const quality = MAGIC_TO_QUALITY[data[0]!];
    if (quality) {
      return {
        quality,
        tokenBytes: data.slice(1),
        hasMagicByte: true,
      };
    }
  }

  // Legacy: no header, guess quality from token count
  if (data.length >= 4 && data.length % 2 === 0) {
    const nTok = data.length / 2;
    const quality =
      nTok <= 100
        ? Quality.Hz12_5
        : nTok <= 200
          ? Quality.Hz25
          : Quality.Hz50;
    return {
      quality,
      tokenBytes: data,
      hasMagicByte: false,
    };
  }

  return null;
}

/**
 * Convert raw token bytes (16-bit LE) into a BigInt64Array for ONNX.
 */
export function tokenBytesToBigInt64(tokenBytes: Uint8Array): BigInt64Array {
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
