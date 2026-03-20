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
    : "https://focalcodec-relay.okan.workers.dev";

export const WORKER_WS =
  location.hostname === "localhost"
    ? "ws://localhost:8787/ws/"
    : "wss://focalcodec-relay.okan.workers.dev/ws/";

/** Magic bytes for wire format quality detection */
export const MAGIC = {
  "50hz": 0x01,
  "25hz": 0x02,
  "12.5hz": 0x03,
} as const;

export const ADJECTIVES = [
  "swift",
  "bold",
  "quiet",
  "bright",
  "dark",
  "warm",
  "cool",
  "wild",
  "calm",
  "keen",
];
export const NOUNS = [
  "raven",
  "wolf",
  "fox",
  "hawk",
  "bear",
  "lynx",
  "owl",
  "deer",
  "crane",
  "seal",
];

export const ROOM_ADJ = [
  "hidden",
  "golden",
  "iron",
  "silver",
  "frost",
  "storm",
  "shadow",
  "ember",
  "crystal",
  "silent",
];
export const ROOM_NOUN = [
  "hall",
  "bridge",
  "forge",
  "tower",
  "grove",
  "vale",
  "peak",
  "gate",
  "den",
  "keep",
];

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
