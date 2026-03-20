import { Quality } from "@/types/codec";

export const SR = 16000;
export const NFFT = 1024;
export const HOP = 320;
export const WLEN = 1024;
export const PAD = 352;

export const MODEL_BASE =
  "https://huggingface.co/skymorphosis/focalcodec-onnx/resolve/main/";

export const RELAY_HTTP =
  location.hostname === "localhost"
    ? "http://localhost:8787"
    : "https://tinyvoice-relay.okan.workers.dev";

export const WORKER_WS =
  location.hostname === "localhost"
    ? "ws://localhost:8787/ws/"
    : "wss://tinyvoice-relay.okan.workers.dev/ws/";

export const SUGGESTED_ROOMS = [
  "odin",
  "valhalla",
  "bifrost",
  "midgard",
  "asgard",
];

export const THEMES = [
  { id: "mocha", label: "Mocha", swatch: "#89b4fa" },
  { id: "nord", label: "Nord", swatch: "#5e81ac" },
  { id: "rosepine", label: "Rose Pine", swatch: "#c4a7e7" },
  { id: "solarized", label: "Solarized", swatch: "#2aa198" },
  { id: "midnight", label: "Midnight", swatch: "#1c1c26" },
  { id: "latte", label: "Latte", swatch: "#dd7878" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const QUALITY_OPTIONS: {
  value: Quality;
  label: string;
  description: string;
}[] = [
  { value: Quality.Hz12_5, label: "12.5hz", description: "tiny QR \u00b7 ~144B" },
  { value: Quality.Hz25, label: "25hz", description: "balanced \u00b7 ~288B" },
  { value: Quality.Hz50, label: "50hz", description: "best quality \u00b7 ~576B" },
];
