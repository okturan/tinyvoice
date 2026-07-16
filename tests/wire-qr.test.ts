import { describe, expect, it } from "vitest";
import { bytesToBase64, decodeQRString } from "@/lib/qrParsing";
import { packTokens, tokenBytesToBigInt64, unpackTokens } from "@/lib/wire-format";
import { MAGIC_BYTES, Quality } from "@/types/codec";

describe("wire format", () => {
  it.each([Quality.Hz50, Quality.Hz25, Quality.Hz12_5])(
    "round-trips %s packets with exact little-endian bytes",
    (quality) => {
      const packet = packTokens([0, 1, 255, 256, 65_535], quality);
      expect(packet).toEqual(
        new Uint8Array([MAGIC_BYTES[quality], 0, 0, 1, 0, 255, 0, 0, 1, 255, 255]),
      );
      const parsed = unpackTokens(packet);
      expect(parsed).toMatchObject({ quality, hasMagicByte: true });
      expect(tokenBytesToBigInt64(parsed!.tokenBytes)).toEqual(
        new BigInt64Array([0n, 1n, 255n, 256n, 65_535n]),
      );
    },
  );

  it("supports BigInt tokens and rejects values that would wrap", () => {
    expect(packTokens(new BigInt64Array([0n, 65_535n]), Quality.Hz50)).toHaveLength(5);
    expect(() => packTokens([], Quality.Hz50)).toThrow("empty");
    expect(() => packTokens([-1], Quality.Hz50)).toThrow(RangeError);
    expect(() => packTokens([1.5], Quality.Hz50)).toThrow(RangeError);
    expect(() => packTokens([65_536], Quality.Hz50)).toThrow(RangeError);
    expect(() => packTokens(new BigInt64Array([-1n]), Quality.Hz50)).toThrow(RangeError);
  });

  it("uses the documented 50 Hz fallback for legacy packets", () => {
    const legacy = new Uint8Array([1, 0, 255, 255]);
    expect(unpackTokens(legacy)).toEqual({
      quality: Quality.Hz50,
      tokenBytes: legacy,
      hasMagicByte: false,
    });
    expect(unpackTokens(new Uint8Array([9, 1, 0]))).toBeNull();
    expect(unpackTokens(new Uint8Array([1]))).toBeNull();
  });

  it("reads offset views and rejects odd token byte arrays", () => {
    const backing = new Uint8Array([99, 52, 18, 205, 171, 88]);
    expect(tokenBytesToBigInt64(backing.subarray(1, 5))).toEqual(
      new BigInt64Array([0x1234n, 0xabcdn]),
    );
    expect(() => tokenBytesToBigInt64(new Uint8Array([1]))).toThrow("even byte count");
  });
});

describe("QR parsing", () => {
  it.each([Quality.Hz50, Quality.Hz25, Quality.Hz12_5])(
    "accepts its own odd-length %s magic packet as raw base64 and as a URL",
    (quality) => {
      const packet = packTokens([251, 255, 4], quality);
      const base64 = bytesToBase64(packet);
      expect(base64).toMatch(/[+/]/u);
      expect(decodeQRString(base64)).toEqual(packet);
      expect(decodeQRString(`https://example.test/qr?v=${encodeURIComponent(base64)}`)).toEqual(packet);
    },
  );

  it("accepts legacy packets and rejects malformed or non-packet data", () => {
    const legacy = new Uint8Array([1, 0, 2, 0]);
    expect(decodeQRString(bytesToBase64(legacy))).toEqual(legacy);
    expect(decodeQRString("not base64" )).toBeNull();
    expect(decodeQRString(bytesToBase64(new Uint8Array([9, 1, 0])))).toBeNull();
    expect(decodeQRString("https://example.test/qr?v=%25%25%25")).toBeNull();
  });
});
