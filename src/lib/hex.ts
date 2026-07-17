export type HexParseErrorCode =
  | "empty"
  | "invalid-character"
  | "odd-length";

export class HexParseError extends Error {
  readonly code: HexParseErrorCode;

  constructor(code: HexParseErrorCode, message: string) {
    super(message);
    this.name = "HexParseError";
    this.code = code;
  }
}

/** Format bytes as lowercase, space-separated hexadecimal for sharing. */
export function formatHexBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

/**
 * Convert hexadecimal text to bytes.
 *
 * Accepts compact hex or groups separated by whitespace and commas. Groups may
 * use an optional `0x` prefix, for example `deadbeef`, `de ad be ef`, or
 * `0xde, 0xad, 0xbe, 0xef`.
 *
 * @throws {HexParseError} when the input is empty, contains non-hexadecimal
 * characters, or does not contain a complete number of bytes.
 */
export function parseHex(input: string): Uint8Array {
  if (!input.trim()) {
    throw new HexParseError("empty", "Enter at least one hexadecimal byte.");
  }

  const withoutPrefixes = input.replace(/(^|[\s,])0x/gi, "$1");
  const invalidMatch = withoutPrefixes.match(/[^0-9a-f\s,]/i);

  if (invalidMatch) {
    throw new HexParseError(
      "invalid-character",
      `Invalid hexadecimal character “${invalidMatch[0]}”. Use only 0–9 and A–F.`,
    );
  }

  const digits = withoutPrefixes.replace(/[\s,]/g, "");

  if (!digits) {
    throw new HexParseError("empty", "Enter at least one hexadecimal byte.");
  }

  if (digits.length % 2 !== 0) {
    throw new HexParseError(
      "odd-length",
      "Hexadecimal input must contain complete bytes (two digits per byte).",
    );
  }

  const bytes = new Uint8Array(digits.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}
