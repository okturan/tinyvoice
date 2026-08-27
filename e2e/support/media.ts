import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { packetSeconds, voiceUrl, type Quality } from "./packets";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GENERATED_DIR = path.resolve(here, "../.generated");
export const FAKE_MIC_WAV = path.join(GENERATED_DIR, "mic.wav");
export const FAKE_CAMERA_Y4M = path.join(GENERATED_DIR, "camera.y4m");

/** The packet baked into the fake camera feed (see writeCameraY4m). */
export const CAMERA_QUALITY: Quality = "12_5hz";
export const CAMERA_SECONDS = 3.2;
export const CAMERA_SEED = 42;
export const CAMERA_PACKET = packetSeconds(CAMERA_QUALITY, CAMERA_SECONDS, CAMERA_SEED);
export const CAMERA_URL_ORIGIN = "http://localhost:5174";

/**
 * 16 kHz mono PCM WAV for --use-file-for-fake-audio-capture: a 440 Hz tone
 * gated on/off 4× per second so Chrome's noise suppression does not flatten
 * it and the app's silence trimmer sees "speech" right away.
 */
export function writeMicWav(file = FAKE_MIC_WAV): string {
  const sampleRate = 16_000;
  const seconds = 4;
  const frames = sampleRate * seconds;
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const gate = Math.floor(t * 8) % 2 === 0 ? 1 : 0.15;
    const sample = 0.45 * gate * Math.sin(2 * Math.PI * 440 * t);
    pcm.writeInt16LE(Math.round(sample * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  writeAtomic(file, Buffer.concat([header, pcm]));
  return file;
}

/**
 * 640×480 Y4M for --use-file-for-fake-video-capture showing one large QR
 * code that encodes a /qr?v= voice URL for CAMERA_PACKET.
 */
export function writeCameraY4m(file = FAKE_CAMERA_Y4M): string {
  const width = 640;
  const height = 480;
  const text = voiceUrl(CAMERA_URL_ORIGIN, CAMERA_PACKET);
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const quiet = 4;
  const scale = Math.floor((height - 40) / (size + quiet * 2));
  const box = (size + quiet * 2) * scale;
  const originX = Math.floor((width - box) / 2);
  const originY = Math.floor((height - box) / 2);

  const WHITE = 235;
  const BLACK = 16;
  const y = Buffer.alloc(width * height, WHITE);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!qr.modules.get(row, col)) continue;
      const px = originX + (quiet + col) * scale;
      const py = originY + (quiet + row) * scale;
      for (let dy = 0; dy < scale; dy++) {
        y.fill(BLACK, (py + dy) * width + px, (py + dy) * width + px + scale);
      }
    }
  }
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma, chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`);
  // Two identical frames so the looping capture always has a next frame.
  writeAtomic(file, Buffer.concat([header, frame, frame]));
  return file;
}

/** Write via a temp file + rename so concurrent Playwright runs never see a torn file. */
function writeAtomic(file: string, data: Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/** PNG data URL of a QR code for `text` (for upload tests). */
export async function qrPng(text: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(text, { width: 320, margin: 2, errorCorrectionLevel: "M" });
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}
