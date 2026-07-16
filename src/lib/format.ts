import { Quality } from "@/types/codec";

/** Format byte count for display */
export function fmt(b: number): string {
  return b < 1024 ? b + " B" : (b / 1024).toFixed(1) + " KB";
}

export function qualityLabel(quality: Quality): string {
  return quality === Quality.Hz12_5 ? "12.5hz" : quality;
}

export function autoDecoderLabel(quality: Quality, detected: boolean): string {
  return `Auto (${qualityLabel(quality)}${detected ? "" : ", legacy fallback"})`;
}
