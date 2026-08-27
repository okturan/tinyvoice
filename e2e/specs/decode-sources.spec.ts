/**
 * Decode tab — sources and panel chrome: how a packet gets in (URL, hex,
 * upload, camera), what each source says when it fails, how the two layout
 * ethoses frame a loaded player, and the hex sheet the player opens.
 */
import type { Page } from "@playwright/test";
import zlib from "node:zlib";
import { test, expect } from "../support/test";
import type { QrApp } from "../support/app";
import { CAMERA_PACKET, qrPng } from "../support/media";
import {
  initialStatus,
  legacyPacket,
  packet,
  packetSeconds,
  toBase64,
  toHex,
  tokensFor,
  voiceUrl,
} from "../support/packets";

// ── Locators the page object does not have ───────────────────────

/**
 * DecodePanel's red line under the sources. `app.sourceError` excludes both
 * HexInput's inline alert and DecodePlayer's status <p> (which turns red on
 * a decode failure and lives inside the Player card), so a fix that reports
 * a bad link inside the player can never satisfy these assertions by accident.
 */
function panelError(app: QrApp) {
  return app.sourceError;
}

/** HexInput's inline validation message. */
function inlineError(app: QrApp) {
  return app.page.getByRole("alert");
}

/** Stage-swap header: "<N> B · <quality>" beside "← New source". */
function stageHeader(app: QrApp, bytes: Uint8Array, label: string) {
  return app.page.getByText(`${bytes.length} B · ${label}`, { exact: true });
}

function video(app: QrApp) {
  return app.page.locator("video");
}

/** Text the hex source shows once a submission has been accepted. */
function hexLoaded(app: QrApp, bytes: Uint8Array) {
  return app.page.getByText(`${bytes.length} hexadecimal bytes loaded`, { exact: true });
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Wrap getUserMedia before the app boots so the transient "Requesting
 * camera..." state can be held open, or a permission failure simulated.
 */
async function primeCamera(page: Page, opts: { delayMs?: number; rejectWith?: string }): Promise<void> {
  await page.addInitScript((o) => {
    const devices = navigator.mediaDevices;
    const real = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints) => {
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (o.rejectWith) throw new DOMException(o.rejectWith, "NotAllowedError");
      return real(constraints);
    };
  }, opts);
}

/**
 * Node's HTTP parser refuses request lines over 16 KB, so a payload near the
 * app's 64 KiB cap can never reach the preview server as a real request.
 * Intercept those navigations in the browser instead: the document for a
 * plain /qr is fetched and handed back under the long URL, so the app boots
 * exactly as it would from a shared link — location.search and all.
 */
async function allowLongVoiceUrls(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/qr" && url.search.length > 8_000,
    async (route) => {
      const response = await route.fetch({ url: new URL("/qr", route.request().url()).href });
      await route.fulfill({ response });
    },
  );
}

/** A valid, solid-colour RGB PNG with no QR in it. */
function solidPng(width: number, height: number, rgb: [number, number, number] = [255, 255, 255]): Buffer {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of buf) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(rgb, y * stride + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const UNREADABLE_PAYLOADS: { name: string; v: string }[] = [
  { name: "invalid base64", v: "not base64!" },
  // Three bytes whose first byte is not a magic byte: odd length, so not even a legacy packet.
  { name: "an odd-length packet", v: toBase64(new Uint8Array([0xaa, 0xbb, 0xcc])) },
  { name: "a single byte", v: toBase64(new Uint8Array([0x01])) },
];

// ── Default tab ─────────────────────────────────────────────────

test.describe("default tab", () => {
  test("/qr opens on Record", async ({ app }) => {
    await app.goto();
    await expect(app.tab("record")).toHaveAttribute("aria-selected", "true");
    await expect(app.tab("decode")).toHaveAttribute("aria-selected", "false");
    await expect(app.holdButton).toBeVisible();
    await expect(app.playButton).toBeHidden();
  });

  test("/qr?v=<valid> opens Decode with the packet on the stage", async ({ app }) => {
    const bytes = packetSeconds("25hz", 1.2);
    await app.goto({ v: toBase64(bytes) });

    await expect(app.tab("decode")).toHaveAttribute("aria-selected", "true");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));
    await expect(app.downloadModelsButton).toHaveText("Download 25hz models");
    await expect(stageHeader(app, bytes, "25hz")).toBeVisible();
    await expect(app.newSourceButton).toBeVisible();
    // Stage swap: the loaded packet takes the whole canvas.
    await expect(app.sourceTab("hex")).toBeHidden();
    await expect(app.hexTextarea).toBeHidden();
    await expect(app.startCameraButton).toBeHidden();
    await expect(panelError(app)).toBeHidden();
  });

  test("/qr?v=<valid> in split-deck keeps the sources beside the player", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 2);
    await app.presetEthos("split-deck");
    await app.goto({ v: toBase64(bytes) });

    await expect(app.tab("decode")).toHaveAttribute("aria-selected", "true");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
    await expect(app.playerPlaceholder).toBeHidden();
    await expect(app.newSourceButton).toBeHidden();
    await expect(stageHeader(app, bytes, "12.5hz")).toBeHidden();
    await expect(app.sourceTab("hex")).toHaveAttribute("aria-selected", "true");
    await expect(app.hexTextarea).toBeVisible();
    await expect(app.hexTextarea).toHaveValue("");
  });

  for (const { name, v } of UNREADABLE_PAYLOADS) {
    test(`?v= with ${name} lands on an empty Decode tab`, async ({ app }) => {
      await app.goto({ v });
      await expect(app.tab("decode")).toHaveAttribute("aria-selected", "true");
      await expect(app.hexTextarea).toBeVisible();
      await expect(app.playButton).toBeHidden();
      await expect(app.newSourceButton).toBeHidden();
      await expect(app.page.getByText(/\d+ B · /)).toBeHidden();
    });

    test(`?v= with ${name} tells the user the link was unreadable`, async ({ app }) => {
      await app.goto({ v });
      await expect(app.tab("decode")).toHaveAttribute("aria-selected", "true");
      await expect(panelError(app)).toHaveText(/voice data|packet|link/i);
    });
  }

  test("the 64 KiB URL cap: 65535 bytes load, 65537 are seen but refused", async ({ app, page }) => {
    await allowLongVoiceUrls(page);
    const largest = packet("12_5hz", tokensFor(32767)); // 1 + 2 × 32767 = 65535 B
    await app.goto({ v: toBase64(largest) });
    // The player's hex stream renders every byte, so allow for the 65535-span paint.
    await expect(app.playerStatus).toHaveText(initialStatus(largest, "12_5hz"), { timeout: 15_000 });
    await expect(stageHeader(app, largest, "12.5hz")).toBeVisible();

    const tooBig = packet("12_5hz", tokensFor(32768)); // 65537 B
    await app.goto({ v: toBase64(tooBig) });
    // Only a ?v= link opens on Decode, so the active tab proves the payload reached the app...
    await expect(app.tab("decode")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL((url) => url.searchParams.get("v") === toBase64(tooBig));
    // ...and was refused: no player, the sources are back.
    await expect(app.playButton).toBeHidden();
    await expect(app.hexTextarea).toBeVisible();
  });

  test("a payload over the 64 KiB cap tells the user", async ({ app, page }) => {
    await allowLongVoiceUrls(page);
    await app.goto({ v: toBase64(packet("12_5hz", tokensFor(32768))) });
    await expect(app.tab("decode")).toHaveAttribute("aria-selected", "true");
    await expect(panelError(app)).toHaveText(/voice data|packet|large/i);
  });
});

// ── Hex source ──────────────────────────────────────────────────

test.describe("hex source", () => {
  test("accepts compact, spaced, comma-separated, 0x-prefixed and upper-case hex", async ({ app }) => {
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });

    const forms: { name: string; render: (b: Uint8Array) => string }[] = [
      { name: "compact", render: (b) => toHex(b).replace(/ /g, "") },
      { name: "spaced", render: (b) => toHex(b) },
      { name: "comma", render: (b) => toHex(b).split(" ").join(",") },
      { name: "0x", render: (b) => toHex(b).split(" ").map((h) => `0x${h}`).join(", ") },
      { name: "upper", render: (b) => toHex(b).toUpperCase().split(" ").map((h) => `0X${h}`).join(" ") },
    ];
    for (const [i, form] of forms.entries()) {
      const bytes = packetSeconds("25hz", 0.4 + i * 0.2, i + 1);
      await app.submitHex(form.render(bytes));
      await expect(app.playerStatus, form.name).toHaveText(initialStatus(bytes, "25hz"));
      await expect(hexLoaded(app, bytes)).toBeVisible();
      await expect(app.page.getByText("Loaded in the player")).toBeVisible();
      await expect(app.editHexButton).toBeVisible();
      await expect(app.hexTextarea).toBeHidden();
      await expect(app.decodeHexButton).toBeHidden();
      await expect(inlineError(app)).toBeHidden();
      await expect(panelError(app)).toBeHidden();
    }
  });

  test("Ctrl+Enter submits; a plain Enter only breaks the line", async ({ app }) => {
    const bytes = packetSeconds("50hz", 0.5, 3);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await expect(app.page.getByText("⌘/Ctrl + Enter to decode")).toBeVisible();

    await app.hexTextarea.fill(toHex(bytes));
    await app.hexTextarea.press("Enter");
    await expect(app.hexTextarea).toHaveValue(`${toHex(bytes)}\n`);
    await expect(app.playerPlaceholder).toBeVisible();

    await app.hexTextarea.press("Control+Enter");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "50hz"));
    await expect(hexLoaded(app, bytes)).toBeVisible();
  });

  test("Edit hex brings the textarea back with the previous text, focused; the player stays", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 1, 4);
    const text = toHex(bytes);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.submitHex(text);
    await expect(hexLoaded(app, bytes)).toBeVisible();

    await app.editHexButton.click();
    await expect(app.hexTextarea).toBeVisible();
    await expect(app.hexTextarea).toHaveValue(text);
    await expect(app.hexTextarea).toBeFocused();
    await expect(app.decodeHexButton).toBeVisible();
    await expect(hexLoaded(app, bytes)).toBeHidden();
    // Editing does not touch the panel: the packet is still in the player.
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
  });

  test("empty input is rejected inline, not on the panel line", async ({ app }) => {
    await app.goto({ tab: "decode" });
    for (const text of ["", "   ", "0x", " , ,"]) {
      await app.hexTextarea.fill(text);
      await app.decodeHexButton.click();
      await expect(inlineError(app), JSON.stringify(text)).toHaveText("Enter at least one hexadecimal byte.");
      await expect(app.hexTextarea).toHaveAttribute("aria-invalid", "true");
      await expect(panelError(app)).toBeHidden();
      await expect(app.playButton).toBeHidden();
    }
  });

  test("an invalid character is named in the message", async ({ app }) => {
    await app.goto({ tab: "decode" });
    await app.hexTextarea.fill("01 0g 02");
    await app.decodeHexButton.click();
    await expect(inlineError(app)).toHaveText("Invalid hexadecimal character “g”. Use only 0–9 and A–F.");

    await app.hexTextarea.fill("01-02");
    await app.decodeHexButton.click();
    await expect(inlineError(app)).toHaveText("Invalid hexadecimal character “-”. Use only 0–9 and A–F.");
    await expect(panelError(app)).toBeHidden();
  });

  test("an odd number of digits is rejected", async ({ app }) => {
    await app.goto({ tab: "decode" });
    await app.hexTextarea.fill("abc");
    await app.decodeHexButton.click();
    await expect(inlineError(app)).toHaveText(
      "Hexadecimal input must contain complete bytes (two digits per byte).",
    );
    await expect(app.hexTextarea).toHaveAttribute("aria-invalid", "true");
  });

  test("bytes that are not a packet are rejected inline and leave the player loaded", async ({ app }) => {
    const bytes = packetSeconds("25hz", 1, 5);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.submitHex(toHex(bytes));
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));

    // Odd length with a non-magic first byte: hex, but not a TinyVoice packet.
    await app.submitHex("aa bb cc");
    await expect(inlineError(app)).toHaveText(
      "These bytes are hexadecimal, but they are not a valid TinyVoice packet.",
    );
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));
    await expect(app.playButton).toBeVisible();
    await expect(app.playerPlaceholder).toBeHidden();
    await expect(panelError(app)).toBeHidden();
    await expect(app.hexTextarea).toHaveValue("aa bb cc");

    // A lone magic byte is too short to be anything.
    await app.hexTextarea.fill("01");
    await expect(inlineError(app)).toBeHidden();
    await app.decodeHexButton.click();
    await expect(inlineError(app)).toHaveText(
      "These bytes are hexadecimal, but they are not a valid TinyVoice packet.",
    );
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));
  });

  test("typing again clears the inline error", async ({ app }) => {
    await app.goto({ tab: "decode" });
    await app.hexTextarea.fill("zz");
    await app.decodeHexButton.click();
    await expect(inlineError(app)).toBeVisible();

    await app.hexTextarea.press("End");
    await app.hexTextarea.pressSequentially("0");
    await expect(inlineError(app)).toBeHidden();
    await expect(app.hexTextarea).not.toHaveAttribute("aria-invalid", "true");
    await expect(app.hexTextarea).toHaveValue("zz0");
  });

  test("a panel-level error and an inline hex error coexist until the hex is edited (current behaviour)", async ({ app }) => {
    // NOTE: two red lines at once — a source-agnostic "Invalid voice data"
    // left over from the Upload tab under a Hex parse error — and the only
    // thing that clears the panel line is the incidental coupling
    // HexInput.onChange → onError("") → DecodePanel.setError(""). Whether a
    // source switch or a new submission should re-scope the panel error is
    // an open product question; this pins today's coupling, not a requirement.
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.uploadFile("odd.bin", new Uint8Array([0xaa, 0xbb, 0xcc]), "application/octet-stream");
    await expect(panelError(app)).toHaveText("Invalid voice data");

    // HexInput's parse errors go only to its own alert; DecodePanel ignores
    // non-empty messages from it, so the upload error stays put.
    await app.submitHex("zz");
    await expect(inlineError(app)).toHaveText("Invalid hexadecimal character “z”. Use only 0–9 and A–F.");
    await expect(panelError(app)).toHaveText("Invalid voice data");

    // ...but the first keystroke after an inline error clears both lines.
    await app.hexTextarea.press("End");
    await app.hexTextarea.pressSequentially("0");
    await expect(inlineError(app)).toBeHidden();
    await expect(panelError(app)).toBeHidden();
  });

  test("a successful hex submit clears a panel-level error from another source", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 1, 6);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.uploadFile("odd.bin", new Uint8Array([0x10, 0x20, 0x30]), "application/octet-stream");
    await expect(panelError(app)).toHaveText("Invalid voice data");

    await app.submitHex(toHex(bytes));
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
    await expect(panelError(app)).toBeHidden();
  });

  test("a magic byte followed by an odd number of token bytes cannot be told from a legacy packet (wire-format limitation)", async ({ app }) => {
    // NOTE: an inherent ambiguity of the wire format, not a requirement:
    // unpackTokens only trusts the magic byte when the remainder is even, and
    // an even total is a legacy packet by definition, so "0x01 + 3 token
    // bytes" and "4 legacy bytes" are the same bytes. A future header change
    // may legitimately alter this.
    const bytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    await app.goto({ tab: "decode" });
    await app.submitHex(toHex(bytes));
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "50hz", true));
    await expect(app.decoderButtons()).toHaveText(["Auto (50hz, legacy fallback)", "12.5hz", "25hz"]);
  });
});

// ── Upload source ───────────────────────────────────────────────

test.describe("upload source", () => {
  test("a QR PNG with a voice URL loads the packet", async ({ app }) => {
    const bytes = packetSeconds("25hz", 1.5, 7);
    await app.goto({ tab: "decode" });
    await app.openSource("upload");
    await expect(app.page.getByText("Drop QR image, .bin, or raw bytes")).toBeVisible();
    await expect(app.page.getByText("click to browse files")).toBeVisible();

    await app.uploadFile("voice.png", await qrPng(voiceUrl("https://tinyvoice.pages.dev", bytes)), "image/png");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));
    await expect(stageHeader(app, bytes, "25hz")).toBeVisible();
    await expect(app.newSourceButton).toBeVisible();
    await expect(app.sourceTab("upload")).toBeHidden();
    await expect(panelError(app)).toBeHidden();
  });

  test("a QR PNG without a voice payload is refused", async ({ app }) => {
    await app.goto({ tab: "decode" });
    await app.uploadFile("hello.png", await qrPng("hello"), "image/png");
    await expect(panelError(app)).toHaveText("QR does not contain voice data");
    await expect(app.playButton).toBeHidden();

    // A TinyVoice URL with no ?v= is not voice data either.
    await app.uploadFile("bare.png", await qrPng("https://tinyvoice.pages.dev/qr"), "image/png");
    await expect(panelError(app)).toHaveText("QR does not contain voice data");
    await expect(app.playButton).toBeHidden();
    await expect(app.sourceTab("upload")).toHaveAttribute("aria-selected", "true");
  });

  test("an image with no QR in it is refused", async ({ app }) => {
    await app.goto({ tab: "decode" });
    await app.uploadFile("blank.png", solidPng(1, 1), "image/png");
    await expect(panelError(app)).toHaveText("No QR found in image");
    await expect(app.playButton).toBeHidden();

    await app.uploadFile("grey.png", solidPng(48, 48, [128, 128, 128]), "image/png");
    await expect(panelError(app)).toHaveText("No QR found in image");
  });

  test("a raw .bin loads; an odd-length .bin is refused and leaves the player loaded", async ({ app }) => {
    const bytes = packetSeconds("50hz", 0.5, 8);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.uploadFile("voice.bin", bytes, "application/octet-stream");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "50hz"));
    await expect(app.playerPlaceholder).toBeHidden();
    await expect(panelError(app)).toBeHidden();

    await app.uploadFile("odd.bin", new Uint8Array([0x10, 0x20, 0x30]), "application/octet-stream");
    await expect(panelError(app)).toHaveText("Invalid voice data");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "50hz"));
    await expect(app.playButton).toBeVisible();
    await expect(app.playerPlaceholder).toBeHidden();
  });

  test("a two-byte .bin is the smallest legacy packet", async ({ app }) => {
    // NOTE: the status reads "2B, 1 tok, ~0.0s" for a 20 ms packet while the
    // stage header a few pixels up says "2 B ·" (format.fmt). The oracle
    // mirrors the status format, so the spacing rides along with the numbers.
    const bytes = legacyPacket([0x1234]);
    await app.goto({ tab: "decode" });
    await app.uploadFile("tiny.bin", bytes, "application/octet-stream");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "50hz", true));
    await expect(app.decoderButtons()).toHaveText(["Auto (50hz, legacy fallback)", "12.5hz", "25hz"]);
    await expect(stageHeader(app, bytes, "50hz")).toBeVisible();
  });

  test("a failed QR upload keeps the packet that was already loaded (current behaviour)", async ({ app }) => {
    // NOTE: unlike a bad .bin or bad hex (which unload the player), a QR
    // without voice data only sets the error — handleQRData never touches the
    // packet. This is the less destructive of the two policies the sources
    // apply today; it is pinned as current behaviour, not as the requirement.
    const bytes = packetSeconds("12_5hz", 1, 9);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.submitHex(toHex(bytes));
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));

    await app.uploadFile("hello.png", await qrPng("hello"), "image/png");
    await expect(panelError(app)).toHaveText("QR does not contain voice data");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
    await expect(app.playButton).toBeVisible();
  });

  test("an image file that cannot be decoded reports an error", async ({ app }) => {
    await app.goto({ tab: "decode" });
    await app.uploadFile("broken.png", Buffer.from("definitely not a png"), "image/png");
    await expect(panelError(app)).toBeVisible();
  });
});

// ── Camera source ───────────────────────────────────────────────

test.describe("camera source", () => {
  test("Start asks for the camera, then mounts the viewfinder; Stop tears it down", async ({ app }) => {
    await primeCamera(app.page, { delayMs: 1500 });
    await app.goto({ tab: "decode" });
    await app.openSource("camera");
    await expect(app.startCameraButton).toBeVisible();
    await expect(video(app)).toHaveCount(0);

    await app.startCameraButton.click();
    await expect(app.page.getByText("Requesting camera...")).toBeVisible();
    // Still "Start Camera" while the permission prompt is open.
    await expect(app.startCameraButton).toBeVisible();
    await expect(video(app)).toHaveCount(0);

    await expect(app.page.getByText("Point at QR code")).toBeVisible({ timeout: 5_000 });
    await expect(app.stopCameraButton).toBeVisible();
    await expect(app.startCameraButton).toBeHidden();
    await expect(video(app)).toBeVisible();

    await app.stopCameraButton.click();
    await expect(app.page.getByText("Point at QR code")).toBeHidden();
    await expect(app.page.getByText("Requesting camera...")).toBeHidden();
    await expect(video(app)).toHaveCount(0);
    await expect(app.startCameraButton).toBeVisible();
    await expect(app.stopCameraButton).toBeHidden();
  });

  test("a refused camera permission is reported in the status line", async ({ app }) => {
    // NOTE: useCamera relays the DOMException message verbatim as
    // "Camera: <message>", so the wording here is the browser's, not the
    // app's; a missing device ("Requested device not found") reads just as raw.
    await primeCamera(app.page, { rejectWith: "Permission denied" });
    await app.goto({ tab: "decode" });
    await app.openSource("camera");
    await app.startCameraButton.click();
    await expect(app.page.getByText("Camera: Permission denied")).toBeVisible();
    await expect(app.startCameraButton).toBeVisible();
    await expect(app.stopCameraButton).toBeHidden();
    await expect(video(app)).toHaveCount(0);
    await expect(panelError(app)).toBeHidden();
  });

  test("scanning the fake camera feed loads the packet and stops the camera", async ({ app }) => {
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.openSource("camera");
    await app.startCameraButton.click();
    await expect(app.stopCameraButton).toBeVisible();
    await expect(app.page.getByText("Point at QR code")).toBeVisible();
    // The viewfinder is live: the fake feed's frames reach the <video>.
    await expect
      .poll(() => video(app).evaluate((el: HTMLVideoElement) => el.videoWidth), {
        message: "the camera stream reaches the viewfinder",
        timeout: 5_000,
      })
      .toBeGreaterThan(0);

    await expect(app.playerStatus).toHaveText(initialStatus(CAMERA_PACKET, "12_5hz"), { timeout: 6_000 });
    // handleScan calls stop() before handing the data over.
    await expect(app.startCameraButton).toBeVisible();
    await expect(video(app)).toHaveCount(0);
  });

  test("leaving the Camera sub-tab while active resets it", async ({ app }) => {
    await app.goto({ tab: "decode" });
    await app.openSource("camera");
    await app.startCameraButton.click();
    await expect(app.stopCameraButton).toBeVisible();

    await app.openSource("hex");
    await expect(video(app)).toHaveCount(0);
    await app.openSource("camera");
    await expect(app.startCameraButton).toBeVisible();
    await expect(app.stopCameraButton).toBeHidden();
    await expect(app.page.getByText("Point at QR code")).toBeHidden();
  });
});

// ── Sources while a packet is loaded ────────────────────────────

test.describe("sources while a packet is loaded", () => {
  test("split-deck: switching source sub-tabs keeps the packet and the sources", async ({ app }) => {
    const bytes = packetSeconds("25hz", 1, 10);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.submitHex(toHex(bytes));
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));

    await app.openSource("upload");
    await expect(app.page.getByText("Drop QR image, .bin, or raw bytes")).toBeVisible();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));

    await app.openSource("camera");
    await expect(app.startCameraButton).toBeVisible();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));

    await app.openSource("hex");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));
    await expect(app.playButton).toBeVisible();
    await expect(app.newSourceButton).toBeHidden();
  });

  test("split-deck: a panel error survives sub-tab switches (current behaviour)", async ({ app }) => {
    // NOTE: DecodePanel's error is not scoped to the source that raised it,
    // so Upload's "Invalid voice data" keeps showing under Camera and Hex.
    // Whether a source switch should clear it is an open product question.
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.uploadFile("odd.bin", new Uint8Array([0x10, 0x20, 0x30]), "application/octet-stream");
    await expect(panelError(app)).toHaveText("Invalid voice data");
    await app.openSource("camera");
    await expect(panelError(app)).toHaveText("Invalid voice data");
    await app.openSource("hex");
    await expect(panelError(app)).toHaveText("Invalid voice data");
  });

  test("stage-swap: a loaded packet hides the sources; ← New source brings them back on Hex", async ({ app }) => {
    const bytes = packetSeconds("50hz", 1, 11);
    await app.goto({ tab: "decode" });
    await app.openSource("upload");
    await app.uploadFile("voice.bin", bytes, "application/octet-stream");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "50hz"));
    await expect(stageHeader(app, bytes, "50hz")).toBeVisible();
    for (const source of ["hex", "upload", "camera"] as const) {
      await expect(app.sourceTab(source)).toBeHidden();
    }
    await expect(app.playerPlaceholder).toBeHidden();

    await app.newSourceButton.click();
    await expect(app.playButton).toBeHidden();
    await expect(stageHeader(app, bytes, "50hz")).toBeHidden();
    await expect(app.newSourceButton).toBeHidden();
    await expect(panelError(app)).toBeHidden();
    // The source block is remounted, so it opens on its default: an empty Hex form.
    await expect(app.sourceTab("hex")).toHaveAttribute("aria-selected", "true");
    await expect(app.sourceTab("upload")).toBeVisible();
    await expect(app.sourceTab("camera")).toBeVisible();
    await expect(app.hexTextarea).toHaveValue("");
    await expect(app.editHexButton).toBeHidden();
  });

  test("stage-swap: a packet that arrived by URL can be replaced after ← New source; the address bar keeps the original (current behaviour)", async ({ app, page }) => {
    // NOTE: DecodePanel never writes back to the URL, so after the swap the
    // address bar still carries the packet the user dismissed — a reload or
    // a copied link brings back fromUrl, not what the player shows. Whether
    // ?v= should follow the player or be cleared is an open product
    // question; this pins today's behaviour, not a requirement.
    const fromUrl = packetSeconds("12_5hz", 1, 12);
    const fromHex = packetSeconds("25hz", 1, 13);
    await app.goto({ v: toBase64(fromUrl) });
    await expect(app.playerStatus).toHaveText(initialStatus(fromUrl, "12_5hz"));

    await app.newSourceButton.click();
    await app.submitHex(toHex(fromHex));
    await expect(app.playerStatus).toHaveText(initialStatus(fromHex, "25hz"));
    await expect(stageHeader(app, fromHex, "25hz")).toBeVisible();
    await expect(page).toHaveURL((url) => url.searchParams.get("v") === toBase64(fromUrl));
  });
});

// ── Hex sheet ───────────────────────────────────────────────────

test.describe("hex sheet", () => {
  test("opens from the player with the dump, highlights the magic byte, closes with Escape", async ({ app }) => {
    const bytes = packet("12_5hz", [0x0102, 0xbeef, 0x0000]);
    await app.goto({ v: toBase64(bytes) });
    await expect(app.hexSheet).toBeHidden();

    await app.playerHexButton.click();
    await expect(app.hexSheet).toBeVisible();
    await expect(app.hexSheet.getByText("Token Data", { exact: true })).toBeVisible();
    await expect(app.hexSheet.getByText(`${bytes.length} bytes · raw hex dump`, { exact: true })).toBeVisible();

    // HexSheet marks the header byte with colour and weight only (no title or
    // aria-label), so the highlight can only be asserted through its classes.
    const cells = app.hexSheet.locator("span.inline-block");
    await expect(cells).toHaveCount(bytes.length);
    await expect(cells).toHaveText(["03", "02", "01", "ef", "be", "00", "00"]);
    await expect(cells.first()).toHaveClass(/text-\[var\(--tv-accent\)\]/);
    await expect(cells.first()).toHaveClass(/font-bold/);
    await expect(cells.nth(1)).toHaveClass(/text-\[var\(--subtext\)\]/);
    await expect(cells.nth(1)).not.toHaveClass(/tv-accent/);

    await app.page.keyboard.press("Escape");
    await expect(app.hexSheet).toBeHidden();
    // The player is untouched underneath.
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
  });

  test("a legacy packet gets no header highlight", async ({ app }) => {
    const bytes = legacyPacket([0x0102, 0x0304]);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.submitHex(toHex(bytes));
    await app.playerHexButton.click();
    await expect(app.hexSheet).toBeVisible();
    await expect(app.hexSheet.getByText("4 bytes · raw hex dump", { exact: true })).toBeVisible();

    const cells = app.hexSheet.locator("span.inline-block");
    await expect(cells).toHaveText(["02", "01", "04", "03"]);
    await expect(cells.first()).not.toHaveClass(/tv-accent/);
    await expect(cells.first()).toHaveClass(/text-\[var\(--subtext\)\]/);

    await app.page.keyboard.press("Escape");
    await expect(app.hexSheet).toBeHidden();
  });
});

// ── Split-deck placeholder ──────────────────────────────────────

test.describe("split-deck", () => {
  test("shows a placeholder until a packet loads, then the player beside the sources", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 2, 14);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await expect(app.playerPlaceholder).toBeVisible();
    await expect(app.playButton).toBeHidden();
    await expect(app.newSourceButton).toBeHidden();
    await expect(app.sourceTab("hex")).toHaveAttribute("aria-selected", "true");

    await app.submitHex(toHex(bytes));
    await expect(app.playerPlaceholder).toBeHidden();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
    await expect(app.sourceTab("hex")).toBeVisible();
    await expect(app.sourceTab("upload")).toBeVisible();
    await expect(app.sourceTab("camera")).toBeVisible();
    await expect(hexLoaded(app, bytes)).toBeVisible();
    await expect(app.newSourceButton).toBeHidden();
    await expect(stageHeader(app, bytes, "12.5hz")).toBeHidden();
  });

  test("switching ethos from Settings reframes the loaded packet in place", async ({ app }) => {
    const bytes = packetSeconds("25hz", 1, 15);
    await app.goto({ v: toBase64(bytes) });
    await expect(app.newSourceButton).toBeVisible();

    await app.switchEthosViaSettings("split-deck");
    await expect(app.newSourceButton).toBeHidden();
    await expect(app.sourceTab("hex")).toBeVisible();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));

    await app.switchEthosViaSettings("stage-swap");
    await expect(app.newSourceButton).toBeVisible();
    await expect(app.sourceTab("hex")).toBeHidden();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));
  });
});
