/**
 * Decode-side gaps: the app's own "Save hex" file fed back through Upload,
 * the missing size cap on the hex / upload paths, the TopBar's QR pill and
 * settings gear on the Decode tab, re-selecting the active decoder, the
 * clipboard failure paths on a record result, which failed second-source
 * loads clear an already-loaded player, and client-side navigation to a
 * /qr?v= URL.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../support/test";
import type { QrApp } from "../support/app";
import { qrPng } from "../support/media";
import {
  initialStatus,
  legacyPacket,
  packet,
  packetSeconds,
  toBase64,
  toHex,
  tokensFor,
} from "../support/packets";

// ── Local helpers ────────────────────────────────────────────────

/** Download 12.5hz through the record tab's codec card, then enable the mic. */
async function readyToRecord(app: QrApp): Promise<void> {
  await app.goto();
  await app.codecButton.click(); // "Choose models" → download dialog
  await expect(app.downloadDialog).toBeVisible();
  await app.startDialogDownload(["12_5hz"]);
  await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
  await expect(app.codecButton).toHaveText("Enable microphone");
  await app.codecButton.click();
  await expect(app.holdButton).toBeEnabled();
}

/** Independent hex-text parser (the suite never imports the app's own). */
function bytesFromHexText(text: string): Uint8Array {
  return Uint8Array.from(text.trim().split(/\s+/), (h) => Number.parseInt(h, 16));
}

/** Click "Save hex" and return the downloaded file exactly as written. */
async function saveHexFile(app: QrApp): Promise<{ name: string; buffer: Buffer }> {
  const downloadPromise = app.page.waitForEvent("download");
  await app.saveHexButton.click();
  const download = await downloadPromise;
  const path = await download.path();
  return { name: download.suggestedFilename(), buffer: fs.readFileSync(path!) };
}

/**
 * The record result's action row, addressed by position so a button can be
 * followed through a label change the page object does not know about
 * (Preview · Copy URL · Copy hex · Save hex · Download [· Hex]).
 */
function actionButton(app: QrApp, index: number): Locator {
  return app.copyHexButton.locator("xpath=..").getByRole("button").nth(index);
}
const COPY_URL_SLOT = 1;

/** Make navigator.clipboard.writeText reject from now on. */
async function breakClipboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    navigator.clipboard.writeText = () =>
      Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));
  });
}

/** Two animation frames, so a synchronous React commit has painted before a negative assertion. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * Client-side navigation to a /qr?v= URL. BrowserRouter listens to popstate,
 * so push the URL from inside the page (the dev server also refuses request
 * lines over 16 KB, which is why decode-sources does the same).
 */
async function pushVoiceUrl(page: Page, v: string): Promise<void> {
  await page.evaluate((value) => {
    history.pushState(null, "", `/qr?v=${encodeURIComponent(value)}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, v);
  await expect(page).toHaveURL(/[?&]v=/);
  await settle(page);
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

// ── Save hex → Upload ────────────────────────────────────────────

test.describe("the app's own Save hex file through Upload", () => {
  test("Save hex writes ASCII hex text, and Upload refuses that very file (current behaviour)", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);
    await app.copyHexButton.click();
    await expect(app.copyHexButton).toHaveText("Hex copied!");
    const packed = bytesFromHexText(await app.page.evaluate(() => navigator.clipboard.readText()));

    const { name, buffer } = await saveHexFile(app);
    expect(name).toBe(`tinyvoice-${packed.length}B.hex.txt`);
    // Independent check on the raw bytes: nothing but "0-9a-f", spaces and
    // one trailing newline — text, not the packet itself.
    const ascii = Array.from(buffer).every(
      (b) => b === 0x20 || b === 0x0a || (b >= 0x30 && b <= 0x39) || (b >= 0x61 && b <= 0x66),
    );
    expect(ascii).toBe(true);
    expect(buffer.length).toBe(packed.length * 3);
    expect(buffer.toString("latin1")).toBe(`${toHex(packed)}\n`);

    await app.openTab("decode");
    await app.uploadFile(name, buffer, "text/plain");
    // Dropzone treats every non-image file as raw packet bytes, so the hex
    // text (odd length, first byte "0") is not a packet.
    await expect(app.sourceError).toHaveText("Invalid voice data");
    await expect(app.playButton).toBeHidden();
    await expect(app.sourceTab("upload")).toHaveAttribute("data-state", "active");
  });

  test("the file Save hex wrote loads the same packet through Upload", async ({ app }) => {
    // BUG: QRResult.saveHex writes formatHexBytes(packed) as text/plain, but
    // Dropzone.handleFile only special-cases image/* and hands every other
    // file's raw bytes to onTokenData — so the app's own export comes back
    // as "Invalid voice data". Hex text has to be pasted into the Hex tab by
    // hand (src/components/qr/Dropzone.tsx handleFile; QRResult.tsx saveHex).
    test.fail();
    await readyToRecord(app);
    await app.record(700);
    const { name, buffer } = await saveHexFile(app);
    const packed = bytesFromHexText(buffer.toString("latin1"));

    await app.openTab("decode");
    await app.uploadFile(name, buffer, "text/plain");
    await expect(app.playerStatus).toHaveText(initialStatus(packed, "12_5hz"));
    await expect(app.sourceError).toBeHidden();
  });
});

// ── Size cap parity with the URL path ───────────────────────────

test.describe("size cap on the hex and upload paths", () => {
  test("a .bin just over the 64 KiB URL cap is refused", async ({ app }) => {
    // BUG: MAX_PACKET_BYTES (64 KiB) is enforced only in decodePacketBase64
    // (src/lib/qrParsing.ts). DecodePanel.handleTokenData goes straight to
    // codec.parsePacket → unpackTokens, whose legacy branch accepts any even
    // length, so an upload of any size loads as "50hz (legacy fallback)" and
    // HexStream renders one span per byte.
    test.fail();
    const bytes = legacyPacket(tokensFor(32769)); // 65 538 B, no magic byte
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.uploadFile("big.bin", bytes, "application/octet-stream");

    // Either the (wrong) player or the (right) refusal has to show up first.
    await expect(app.playerCard.or(app.sourceError)).toBeVisible({ timeout: 15_000 });
    await expect(app.playButton).toBeHidden();
    await expect(app.playerPlaceholder).toBeVisible();
    await expect(app.sourceError).toHaveText(/voice data|packet|large|limit/i);
  });

  test("hex text just over the 64 KiB URL cap is refused", async ({ app }) => {
    // BUG: same gap on the hex path — DecodePanel.handleHexData calls
    // codec.parsePacket with no size check, so the very payload the URL path
    // refuses (65 537 B, see decode-sources "the 64 KiB URL cap") loads when
    // pasted as hex.
    test.fail();
    const bytes = packet("12_5hz", tokensFor(32768)); // 65 537 B
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.submitHex(toHex(bytes).replace(/ /g, ""));

    await expect(app.playerCard.or(app.sourceError).or(app.hexInlineError)).toBeVisible({ timeout: 15_000 });
    await expect(app.playButton).toBeHidden();
    await expect(app.playerPlaceholder).toBeVisible();
    await expect(app.hexInlineError.or(app.sourceError)).toHaveText(/packet|large|limit/i);
  });
});

// ── TopBar on /qr?v= ────────────────────────────────────────────

test.describe("TopBar QR pill on /qr?v=", () => {
  test("clicking the already-active QR pill drops the packet and shows the sources (current behaviour)", async ({ app, page }) => {
    const bytes = packetSeconds("25hz", 1, 31);
    await app.goto({ v: toBase64(bytes) });
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));
    const qrPill = page.getByRole("link", { name: "QR", exact: true });
    await expect(qrPill).toHaveAttribute("href", "/qr");

    await qrPill.click();
    // The Link navigates to a bare /qr; QRPage keys DecodePanel on ?v=, so
    // it remounts as "manual" with nothing in it.
    await expect(page).toHaveURL("/qr");
    await expect(app.tab("decode")).toHaveAttribute("data-state", "active");
    await expect(app.playerCard).toBeHidden();
    await expect(app.newSourceButton).toBeHidden();
    await expect(app.sourceTab("hex")).toBeVisible();
    await expect(app.hexTextarea).toHaveValue("");
    await expect(app.sourceError).toBeHidden();
  });

  test("clicking the already-active QR pill keeps the loaded packet", async ({ app, page }) => {
    // BUG: TopBar renders the QR pill as <Link to="/qr"> even when the page
    // is already /qr — a click on the highlighted pill strips ?v= and QRPage
    // (key={voiceB64 ?? "manual"}) remounts an empty DecodePanel. The PTT
    // page renders its own active pill as inert text (src/components/layout/
    // TopBar.tsx; src/pages/QRPage.tsx DecodePanel key).
    test.fail();
    const bytes = packetSeconds("25hz", 1, 32);
    await app.goto({ v: toBase64(bytes) });
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));

    await page.getByRole("link", { name: "QR", exact: true }).click();
    await settle(page);
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));
    await expect(app.playButton).toBeVisible();
    await expect(app.newSourceButton).toBeVisible();
  });
});

// ── Re-selecting the active decoder ─────────────────────────────

test.describe("re-selecting the highlighted decoder", () => {
  test("clicking the decoder that is already selected while playing is a no-op", async ({ app, models }) => {
    // BUG: DecodePlayer.handleQualityChange has no same-value guard — it
    // bumps the playback generation, stops the source, nulls the decoded
    // buffer and rewrites the status even when the chosen decoder is the one
    // already in effect, so the next Play runs inference again
    // (src/components/qr/DecodePlayer.tsx handleQualityChange).
    test.fail();
    const bytes = packetSeconds("12_5hz", 4); // 50 tokens → 4.0 s
    await app.goto({ v: toBase64(bytes) });
    await app.downloadModelsButton.click();
    await expect(app.downloadModelsButton).toBeHidden({ timeout: 15_000 });
    expect(models.requests).toHaveLength(3);

    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback", { timeout: 15_000 });
    const decoded = `4.0s decoded from ${bytes.length} bytes`;
    await expect(app.playerStatus).toHaveText(decoded);
    expect(await app.selectedDecoderLabels()).toEqual(["Auto (12.5hz)"]);

    await app.decoderButton("Auto (12.5hz)").click();
    await settle(app.page);
    await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback");
    await expect(app.playerStatus).toHaveText(decoded);
    await expect(app.playerStatus).toHaveClass(/--green/);
    expect((await app.ortState()).runs).toHaveLength(1);

    // Stop, then Play again: the buffer is still there, no second decode.
    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Play voice packet");
    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback");
    expect((await app.ortState()).runs).toHaveLength(1);
  });
});

// ── Settings gear ───────────────────────────────────────────────

test.describe("settings gear in the TopBar", () => {
  test("the gear button has no accessible name (current behaviour)", async ({ app }) => {
    await app.goto();
    await expect(app.settingsButton).toBeVisible();
    await expect(app.settingsButton).toHaveAccessibleName("");
    await expect(app.page.getByRole("button", { name: /settings/i })).toHaveCount(0);
  });

  test("the gear button can be found as the Settings button", async ({ app, page }) => {
    // BUG: TopBar's gear <button> wraps an SVG only — no aria-label, title
    // or sr-only text (src/components/layout/TopBar.tsx). The PTT page's own
    // gear is labelled "Settings"; the QR page's is announced as "button".
    test.fail();
    await app.goto();
    const gear = page.getByRole("button", { name: /settings/i });
    await expect(gear).toBeVisible();
    await gear.click();
    await expect(app.settingsSheet).toBeVisible();
  });
});

// ── Clipboard failures on a record result ───────────────────────

test.describe("clipboard failures on the record result", () => {
  test.use({ strictPageErrors: false });

  test("Copy hex says 'Copy failed'; Copy URL stays silent and leaks an unhandled rejection (current behaviour)", async ({ app, page, pageErrors }) => {
    await readyToRecord(app);
    await app.record(700);
    await breakClipboard(page);

    await app.copyHexButton.click();
    await expect(app.copyHexButton).toHaveText("Copy failed");
    await expect(app.copyHexButton).toHaveText("Copy hex", { timeout: 3_000 });
    expect(pageErrors).toEqual([]);

    const copyUrl = actionButton(app, COPY_URL_SLOT);
    await expect(copyUrl).toHaveText("Copy URL");
    await copyUrl.click();
    await expect.poll(() => pageErrors.length).toBeGreaterThan(0);
    expect(pageErrors.join("\n")).toMatch(/Write permission denied/);
    await expect(copyUrl).toHaveText("Copy URL");
    await expect(app.copyUrlButton).not.toHaveText("Copied!");
  });

  test("Copy URL reports a clipboard failure without an unhandled rejection", async ({ app, page, pageErrors }) => {
    // BUG: QRResult.copyUrl awaits navigator.clipboard.writeText with no
    // try/catch (unlike copyHex, which flips to "Copy failed"), so a refused
    // clipboard leaves the label on "Copy URL" and surfaces only as an
    // unhandled rejection in the console (src/components/qr/QRResult.tsx copyUrl).
    test.fail();
    await readyToRecord(app);
    await app.record(700);
    await breakClipboard(page);

    const copyUrl = actionButton(app, COPY_URL_SLOT);
    await expect(copyUrl).toHaveText("Copy URL");
    await copyUrl.click();
    await expect(copyUrl).toHaveText(/fail/i);
    await expect(copyUrl).toHaveText("Copy URL", { timeout: 3_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ── Failed second-source loads ──────────────────────────────────

test.describe("a failed second source with a packet already loaded", () => {
  test("side by side: .bin and hex failures clear the player, QR-image failures keep it", async ({ app }) => {
    // Individually, three of these four are already pinned in
    // decode-sources.spec.ts; this puts the whole matrix in one place and
    // adds the missing "image without a QR" case. handleTokenData /
    // handleHexData null out the packet on failure; handleQRData and
    // Dropzone's image errors only set the error line (DecodePanel.tsx).
    const bytes = packetSeconds("12_5hz", 1, 21);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    const loaded = initialStatus(bytes, "12_5hz");
    const reload = async () => {
      await app.submitHex(toHex(bytes));
      await expect(app.playerStatus).toHaveText(loaded);
      await expect(app.sourceError).toBeHidden();
    };

    // Clears: an odd-length .bin.
    await reload();
    await app.uploadFile("odd.bin", new Uint8Array([0x10, 0x20, 0x30]), "application/octet-stream");
    await expect(app.sourceError).toHaveText("Invalid voice data");
    await expect(app.playerPlaceholder).toBeVisible();
    await expect(app.playButton).toBeHidden();

    // Clears: hex that is not a packet.
    await reload();
    await app.submitHex("aa bb cc");
    await expect(app.hexInlineError).toHaveText(
      "These bytes are hexadecimal, but they are not a valid TinyVoice packet.",
    );
    await expect(app.playerPlaceholder).toBeVisible();
    await expect(app.playButton).toBeHidden();

    // Keeps: a QR image whose payload is not voice data.
    await reload();
    await app.uploadFile("hello.png", await qrPng("hello"), "image/png");
    await expect(app.sourceError).toHaveText("QR does not contain voice data");
    await expect(app.playerStatus).toHaveText(loaded);
    await expect(app.playButton).toBeVisible();

    // Keeps: an image with no QR in it at all.
    await app.uploadFile("blank.png", solidPng(8, 8), "image/png");
    await expect(app.sourceError).toHaveText("No QR found in image");
    await expect(app.playerStatus).toHaveText(loaded);
    await expect(app.playButton).toBeVisible();
    await expect(app.playerPlaceholder).toBeHidden();
  });
});

// ── Client-side navigation to /qr?v= ────────────────────────────

test.describe("client-side navigation to /qr?v=", () => {
  test("pushState to /qr?v= hands the packet to Decode but leaves Record selected (current behaviour)", async ({ app, page }) => {
    const bytes = packetSeconds("50hz", 1, 41);
    await app.goto();
    await expect(app.tab("record")).toHaveAttribute("data-state", "active");

    await pushVoiceUrl(page, toBase64(bytes));
    // QRPage's <Tabs defaultValue> is only read on mount, so the tab does
    // not follow the URL the way a fresh load of /qr?v= does.
    await expect(app.tab("record")).toHaveAttribute("data-state", "active");
    await expect(app.tab("decode")).toHaveAttribute("data-state", "inactive");
    await expect(app.holdButton).toBeVisible();
    await expect(app.playerCard).toBeHidden();

    await app.openTab("decode");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "50hz"));
    await expect(app.newSourceButton).toBeVisible();
  });

  test("pushState to /qr?v= selects the Decode tab", async ({ app, page }) => {
    // BUG: QRPage computes defaultTab from ?v= but passes it as the
    // uncontrolled Tabs `defaultValue`, so an in-app navigation to a voice
    // URL (history.pushState / a <Link>) updates the DecodePanel key without
    // moving the user to the Decode tab (src/pages/QRPage.tsx).
    test.fail();
    const bytes = packetSeconds("50hz", 1, 42);
    await app.goto();
    await pushVoiceUrl(page, toBase64(bytes));
    await expect(app.tab("decode")).toHaveAttribute("data-state", "active");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "50hz"));
  });
});
