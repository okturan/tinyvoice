import { Quality } from "@/types/codec";

export const SR = 16000;
export const NFFT = 1024;
export const HOP = 320;
export const WLEN = 1024;
export const PAD = 352;

export const MODEL_REVISION = "a683dc2f143f129c30becb04ffef95cbd52f9eb7";
export const MODEL_BASE =
  `https://huggingface.co/skymorphosis/focalcodec-onnx/resolve/${MODEL_REVISION}/`;

/** Exact LFS artifact sizes at MODEL_REVISION, from the Hugging Face model API. */
export const MODEL_ARTIFACT_BYTES: Readonly<Record<string, number>> = {
  "encoder.onnx": 623_470_690,
  "compressor_50hz.onnx": 73_512_357,
  "decoder_50hz.onnx": 141_089_940,
  "compressor_25hz.onnx": 77_707_475,
  "decoder_25hz.onnx": 145_284_515,
  "compressor_12_5hz.onnx": 79_804_637,
  "decoder_12_5hz.onnx": 147_381_771,
};

export const MODEL_SIZE_ESTIMATES_MB: Record<string, number> = {
  "encoder.onnx": 595,
  "compressor_50hz.onnx": 70,
  "decoder_50hz.onnx": 135,
  "compressor_25hz.onnx": 74,
  "decoder_25hz.onnx": 139,
  "compressor_12_5hz.onnx": 76,
  "decoder_12_5hz.onnx": 141,
};

export const RELAY_HTTP =
  typeof location !== "undefined" && location.hostname === "localhost"
    ? "http://localhost:8787"
    : "https://tinyvoice-relay.okan.workers.dev";

export const SUGGESTED_ROOMS = [
  "odin",
  "valhalla",
  "bifrost",
  "midgard",
  "asgard",
];

export const QUALITY_OPTIONS: {
  value: Quality;
  label: string;
  description: string;
}[] = [
  { value: Quality.Hz12_5, label: "12.5hz", description: "tiny QR \u00b7 25 B/s + header" },
  { value: Quality.Hz25, label: "25hz", description: "balanced \u00b7 50 B/s + header" },
  { value: Quality.Hz50, label: "50hz", description: "best quality \u00b7 100 B/s + header" },
];
