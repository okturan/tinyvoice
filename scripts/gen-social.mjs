import sharp from "sharp";
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

/* ── deterministic byte stream for the hex row ── */
const mul = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rng = mul(0x54696e79);
// 17 bytes + the magic-byte header is what fits inside the panel at 21px.
const BYTES = Array.from({ length: 17 }, () =>
  Math.floor(rng() * 256).toString(16).padStart(2, "0"),
);

/** Hex row with the comet play head, the app's signature visual. */
function hexRow(x, y, size) {
  const step = size * 1.72;
  const head = 11;
  let out = `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="700" fill="${C.accent}">02</text>`;
  BYTES.forEach((b, i) => {
    const d = head - i;
    let fill = "#3a3d52";           // unplayed
    let weight = "600";
    if (d === 0) { fill = C.green; weight = "700"; }
    else if (d === 1) fill = "#8fd190";
    else if (d === 2) fill = "#79b98c";
    else if (d <= 4) fill = "#6b9b87";
    else if (d > 0) fill = C.subtext; // already played
    out += `<text x="${x + step * (i + 1)}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" fill="${fill}">${b}</text>`;
  });
  return out;
}

/** A believable QR block: three finder patterns + seeded noise. */
function qr(x, y, px, modules = 25) {
  const r = mul(0x7402);
  let cells = "";
  const inFinder = (cx, cy) =>
    (cx < 8 && cy < 8) || (cx >= modules - 8 && cy < 8) || (cx < 8 && cy >= modules - 8);
  for (let cy = 0; cy < modules; cy++) {
    for (let cx = 0; cx < modules; cx++) {
      if (!inFinder(cx, cy) && r() < 0.46) {
        cells += `<rect x="${x + cx * px}" y="${y + cy * px}" width="${px}" height="${px}"/>`;
      }
    }
  }
  const finder = (fx, fy) => {
    let out = "";
    for (let cy = 0; cy < 7; cy++) {
      for (let cx = 0; cx < 7; cx++) {
        const ring = cx === 0 || cy === 0 || cx === 6 || cy === 6;
        const core = cx >= 2 && cx <= 4 && cy >= 2 && cy <= 4;
        if (ring || core) {
          out += `<rect x="${x + (fx + cx) * px}" y="${y + (fy + cy) * px}" width="${px}" height="${px}"/>`;
        }
      }
    }
    return out;
  };
  cells += finder(0, 0) + finder(modules - 7, 0) + finder(0, modules - 7);
  return `<g fill="#11111b">${cells}</g>`;
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
  ${hexRow(88, 522, 21)}
  <text x="88" y="552" font-family="${MONO}" font-size="15" fill="${C.overlay}">2.6s of speech · <tspan fill="${C.green}">129 bytes</tspan> · 25hz</text>

  <!-- QR card -->
  <rect x="836" y="196" width="300" height="300" rx="20" fill="#ffffff"/>
  ${qr(866, 226, 9.6)}

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
