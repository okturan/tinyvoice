import sharp from "sharp";
import QRCode from "qrcode";
import { writeFileSync } from "node:fs";

const OUT = new URL("../public/", import.meta.url).pathname;

// Catppuccin Mocha — the app's default theme
const C = {
  crust: "#11111b",
  base: "#1e1e2e",
  mantle: "#181825",
  surface0: "#313244",
  surface1: "#45475a",
  text: "#cdd6f4",
  subtext: "#a6adc8",
  overlay: "#6c7086",
  accent: "#89b4fa",
  green: "#a6e3a1",
};

const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";
const MONO = "Menlo, Monaco, monospace";

/** The mic mark from favicon.svg, drawn at an arbitrary scale/offset. */
function mic(cx, cy, s, color, stroke) {
  return `
    <g transform="translate(${cx} ${cy}) scale(${s}) translate(-16 -16)">
      <path d="M16 6a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0v-6a4 4 0 0 0-4-4z" fill="${color}"/>
      <path d="M22 14v2a6 6 0 0 1-12 0v-2" stroke="${color}" stroke-width="${stroke}" fill="none" stroke-linecap="round"/>
      <line x1="16" y1="22" x2="16" y2="26" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>
    </g>`;
}

const PACKET_HEX = [
  "03", "43", "09", "b5", "1b", "15", "0c", "85",
  "08", "47", "1b", "54", "14", "44", "1d", "cf",
  "01", "53", "15", "f6", "14", "89", "14",
];
const PACKET_BYTES = Buffer.from(PACKET_HEX.join(""), "hex");
const PLAY_URL =
  `https://tinyvoice.app/qr?v=${encodeURIComponent(PACKET_BYTES.toString("base64"))}`;
const QR = QRCode.create(PLAY_URL, { errorCorrectionLevel: "M" });

/** Hex row with the comet play head, the app's signature visual. */
function hexRow(x, y, size) {
  const step = size * 1.72;
  const head = 14;
  let out = "";
  PACKET_HEX.forEach((b, i) => {
    const d = head - i;
    let fill = "#3a3d52";           // unplayed
    let weight = "600";
    if (d === 0) { fill = C.green; weight = "700"; }
    else if (d === 1) fill = "#8fd190";
    else if (d === 2) fill = "#79b98c";
    else if (d <= 4) fill = "#6b9b87";
    else if (d > 0) fill = C.subtext; // already played
    if (i === 0) { fill = C.accent; weight = "700"; }
    out += `<text x="${x + step * i}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" fill="${fill}">${b}</text>`;
  });
  return out;
}

/** The real TinyVoice playback URL for PACKET_HEX, rendered with a quiet zone. */
function qr(x, y, px, margin = 4) {
  const modules = QR.modules.size;
  let cells = "";
  for (let cy = 0; cy < modules; cy++) {
    for (let cx = 0; cx < modules; cx++) {
      if (QR.modules.data[cy * modules + cx]) {
        cells += `<rect x="${x + (cx + margin) * px}" y="${y + (cy + margin) * px}" width="${px}" height="${px}"/>`;
      }
    }
  }
  return `<g fill="#11111b" shape-rendering="crispEdges">${cells}</g>`;
}

/* ══════════ OG / Twitter card: 1200x630 ══════════ */
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="22%" cy="18%" r="72%">
      <stop offset="0%" stop-color="#89b4fa" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#89b4fa" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="${C.crust}"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- brand -->
  ${mic(96, 92, 2.5, C.accent, 2.2)}
  <text x="132" y="105" font-family="${SANS}" font-size="42" font-weight="700" fill="${C.text}">TinyVoice</text>

  <!-- headline -->
  <text x="64" y="228" font-family="${SANS}" font-size="66" font-weight="700" fill="${C.text}">Voice small enough</text>
  <text x="64" y="304" font-family="${SANS}" font-size="66" font-weight="700" fill="${C.text}">to fit in a <tspan fill="${C.accent}">QR code</tspan>.</text>

  <!-- subhead -->
  <text x="64" y="368" font-family="${SANS}" font-size="27" fill="${C.subtext}">Neural speech at 25–100 bytes per second,</text>
  <text x="64" y="404" font-family="${SANS}" font-size="27" fill="${C.subtext}">encoded in your browser. No upload, no server.</text>

  <!-- token data panel -->
  <rect x="64" y="452" width="700" height="118" rx="14" fill="${C.mantle}" stroke="${C.surface0}" stroke-width="1.5"/>
  <text x="88" y="484" font-family="${MONO}" font-size="14" font-weight="700" fill="${C.overlay}" letter-spacing="2.4">TOKEN DATA</text>
  ${hexRow(88, 522, 16)}
  <text x="88" y="552" font-family="${MONO}" font-size="15" fill="${C.overlay}">0.9s of speech · <tspan fill="${C.green}">23 bytes</tspan> · 12.5hz</text>

  <!-- QR card -->
  <rect x="836" y="196" width="300" height="300" rx="20" fill="#ffffff"/>
  ${qr(863, 223, 6)}

  <!-- footer -->
  <text x="836" y="546" font-family="${MONO}" font-size="22" font-weight="600" fill="${C.overlay}">tinyvoice.app</text>
</svg>`;

/* ══════════ App icon (maskable-safe padding) ══════════ */
const icon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${C.base}"/>
  ${mic(256, 256, 11, C.accent, 2.2)}
</svg>`;

/* Rounded variant for apple-touch-icon (iOS masks it itself, so keep it square-filled) */
const written = [];
async function png(svg, name, w, h) {
  const buf = await sharp(Buffer.from(svg), { density: 384 })
    .resize(w, h, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(`${OUT}/${name}`, buf);
  written.push(`${name} (${w}x${h}, ${(buf.length / 1024).toFixed(1)} KB)`);
}

await png(og, "og.png", 1200, 630);
await png(icon(512), "icon-512.png", 512, 512);
await png(icon(512), "icon-192.png", 192, 192);
await png(icon(512), "apple-touch-icon.png", 180, 180);
await png(icon(512), "favicon-32.png", 32, 32);

console.log(written.join("\n"));
