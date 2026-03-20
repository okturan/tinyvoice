export const SR = 16000;
export const NFFT = 1024;
export const HOP = 320;
export const WLEN = 1024;
export const PAD = 352;
export const MODEL_BASE =
  "https://huggingface.co/skymorphosis/focalcodec-onnx/resolve/main/";

export type Quality = "50hz" | "25hz" | "12_5hz";

export const MAGIC_TO_QUALITY: Record<number, Quality> = {
  0x01: "50hz",
  0x02: "25hz",
  0x03: "12_5hz",
};

export const QUALITY_TO_MAGIC: Record<Quality, number> = {
  "50hz": 0x01,
  "25hz": 0x02,
  "12_5hz": 0x03,
};

export const QUALITY_RATES: Record<Quality, number> = {
  "50hz": 50,
  "25hz": 25,
  "12_5hz": 12.5,
};

export const QUALITY_OPTIONS: {
  value: Quality;
  label: string;
  description: string;
}[] = [
  { value: "12_5hz", label: "12.5hz", description: "tiny QR \u00b7 ~144B" },
  { value: "25hz", label: "25hz", description: "balanced \u00b7 ~288B" },
  { value: "50hz", label: "50hz", description: "best quality \u00b7 ~576B" },
];
