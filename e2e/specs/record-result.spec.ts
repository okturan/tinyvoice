/**
 * Record tab → the encoded result (QRResult) and its round trips back into
 * Decode. Every test records real (fake-mic) audio through the codec card,
 * so the exact byte/token counts vary run-to-run; assertions lean on
 * structural invariants (bytes == 1 + 2·tokens), the QR/hex/URL that the
 * result exposes, and the ORT stub's deterministic request/run records.
 */
import fs from "node:fs";
import type { Locator } from "@playwright/test";
import { test, expect } from "../support/test";
import type { QrApp } from "../support/app";
import {
  ALL_QUALITIES,
  RATE,
  initialStatus,
  packetSeconds,
  toHex,
  voiceUrl,
  type Quality,
} from "../support/packets";

/** Decoder row labels for a 12.5hz packet: Auto names the packet's own rate. */
const DECODER_LABELS_12_5 = ["Auto (12.5hz)", "25hz", "50hz"];

/** Inverse of packets.ts `toHex`, kept spec-local so the oracle never imports app code. */
function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.trim().split(/\s+/), (pair) => Number.parseInt(pair, 16));
}

/** The QRResult container (the <img alt="QR code">'s parent), for scoped reads. */
function resultRoot(app: QrApp) {
  return app.qrImage.locator("xpath=..");
}

/** Metadata row values, scoped to the result so the record timer never leaks in. */
async function qrMeta(app: QrApp): Promise<{ bytes: number; tokens: number; seconds: number }> {
  const root = resultRoot(app);
  const bytes = Number(await root.locator("span", { hasText: /^\d+ bytes$/ }).locator("b").innerText());
  const tokens = Number(await root.locator("span", { hasText: /^\d+ tokens$/ }).locator("b").innerText());
  const seconds = Number(await root.locator("span", { hasText: /^\d+\.\ds$/ }).locator("b").innerText());
  return { bytes, tokens, seconds };
}

/** Download 12.5hz through the record tab's codec card, then enable the mic. */
async function readyToRecord(
  app: QrApp,
  opts: { quality?: Quality; ethos?: "stage-swap" | "split-deck" } = {},
): Promise<void> {
  const quality = opts.quality ?? "12_5hz";
  if (opts.ethos) await app.presetEthos(opts.ethos);
  await app.goto();
  if (quality !== "12_5hz") await app.pickQuality(quality);
  await app.codecButton.click(); // "Choose models" → download dialog
  await expect(app.downloadDialog).toBeVisible();
  await app.startDialogDownload([quality]);
  await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
  await expect(app.codecButton).toHaveText("Enable microphone");
  await app.codecButton.click();
  await expect(app.holdButton).toBeEnabled();
}

/** Copy the result's hex to the clipboard and return the packet bytes it holds. */
async function packetFromCopyHex(app: QrApp): Promise<Uint8Array> {
  await app.copyHexButton.click();
  await expect(app.copyHexButton).toHaveText("Hex copied!");
  const hex = await app.page.evaluate(() => navigator.clipboard.readText());
  return fromHex(hex);
}

/**
 * Press HOLD, run `during` while the button is still held, then release and
 * wait for the QR. Lets a test look at the page mid-recording.
 */
async function recordWhile(app: QrApp, ms: number, during: () => Promise<void>): Promise<void> {
  const box = await app.holdButton.boundingBox();
  if (!box) throw new Error("HOLD button is not on screen");
  await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.page.mouse.down();
  await during();
  await app.page.waitForTimeout(ms);
  await app.page.mouse.up();
  await expect(app.qrImage).toBeVisible({ timeout: 15_000 });
}

/**
 * Exactly one decoder button is lit. The buttons carry no aria-pressed, so
 * this leans on the page object's class-based check, but every assertion
 * auto-waits rather than snapshotting the row.
 */
async function expectOnlyDecoderSelected(app: QrApp, label: string): Promise<void> {
  await app.expectDecoderSelected(label);
  for (const other of DECODER_LABELS_12_5.filter((l) => l !== label)) {
    await expect(app.decoderButton(other)).not.toHaveClass(/font-semibold/);
  }
}

/** Every two-digit hex cell of a dump, in byte order (header byte first). */
function hexCells(scope: Locator): Locator {
  return scope.getByText(/^[0-9a-f]{2}$/);
}

/** The header (magic) byte is set apart from the payload: bold and a different colour. */
async function expectHeaderByteHighlighted(cells: Locator): Promise<void> {
  const header = cells.first();
  const payload = cells.nth(1);
  await expect(header).toHaveCSS("font-weight", "700");
  await expect(payload).toHaveCSS("font-weight", "400");
  const payloadColor = await payload.evaluate((el) => getComputedStyle(el).color);
  await expect(header).not.toHaveCSS("color", payloadColor);
}

// ── Metadata ────────────────────────────────────────────────────────

test.describe("result metadata", () => {
  test("bytes, tokens, seconds are internally consistent for every quality", async ({ app, models }) => {
    // Load all three qualities up front so switching quality never re-opens
    // the download dialog; then record once at each in the split deck (whose
    // controls stay put so the quality picker is always reachable).
    await app.presetEthos("split-deck");
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz", "25hz", "50hz"]);
    expect([...models.requests].sort()).toEqual(
      [
        "encoder.onnx",
        "compressor_12_5hz.onnx", "decoder_12_5hz.onnx",
        "compressor_25hz.onnx", "decoder_25hz.onnx",
        "compressor_50hz.onnx", "decoder_50hz.onnx",
      ].sort(),
    );
    await expect(app.codecButton).toHaveText("Enable microphone");
    await app.codecButton.click();
    await expect(app.holdButton).toBeEnabled();

    for (const q of ALL_QUALITIES) {
      await app.pickQuality(q);
      await app.record(700);
      const { bytes, tokens, seconds } = await qrMeta(app);

      // The wire format is a 1-byte magic header + two bytes per token.
      expect(bytes).toBe(1 + 2 * tokens);
      expect(tokens).toBeGreaterThan(0);

      // tokens ≈ seconds·rate, but the duration is *shown* rounded to 0.1 s,
      // so half a display tick (0.05 s) times the rate — plus <1 token of
      // frame-floor + token-rounding slack — is the real band. At 50 hz that
      // is ~4 tokens wide, not 1.
      const band = RATE[q] * 0.05 + RATE[q] / 50 + 0.5;
      expect(Math.abs(tokens - seconds * RATE[q])).toBeLessThanOrEqual(band);
    }
  });
});

// ── Stage-swap result stage ─────────────────────────────────────────

test.describe("stage-swap result stage", () => {
  test("header reads '<quality> · <s>s → <bytes> B'", async ({ app }) => {
    await readyToRecord(app, { ethos: "stage-swap" });
    await app.record(700);
    const { bytes, seconds } = await qrMeta(app);
    const header = app.page.getByText(/^12\.5hz · \d+\.\ds → \d+ B$/);
    await expect(header).toHaveText(`12.5hz · ${seconds.toFixed(1)}s → ${bytes} B`);
  });

  test("'← New recording' returns to the controls with the mic still armed", async ({ app }) => {
    await readyToRecord(app, { ethos: "stage-swap" });
    await app.record(700);
    await expect(app.newRecordingButton).toBeVisible();

    await app.newRecordingButton.click();

    await expect(app.qrImage).toBeHidden();
    // Codec card is still green ("12.5hz loaded") and the mic was kept, so no
    // "Enable microphone" button reappears and HOLD is immediately usable.
    await expect(app.codecCard.getByText("12.5hz loaded")).toBeVisible();
    await expect(app.codecCard.getByRole("button", { name: "Enable microphone" })).toHaveCount(0);
    await expect(app.holdButton).toBeEnabled();
    await expect(app.page.getByText("hold to record · release to encode")).toBeVisible();
    // The quality picker (controls stage only) is back and usable.
    await app.pickQuality("25hz");
  });
});

// ── Split-deck result pane ──────────────────────────────────────────

test.describe("split-deck result pane", () => {
  test("placeholder before, result after, and a new recording replaces it", async ({ app }) => {
    await readyToRecord(app, { ethos: "split-deck" });
    await expect(app.resultPlaceholder).toBeVisible();

    await app.record(700);
    await expect(app.qrImage).toBeVisible();
    await expect(app.resultPlaceholder).toBeHidden();

    // Pressing HOLD again discards the previous result straight away (the
    // placeholder is back while recording) and releasing swaps in a new QR —
    // so the QR on screen afterwards is the second take's, not a leftover.
    await recordWhile(app, 700, async () => {
      await expect(app.qrImage).toBeHidden();
      await expect(app.resultPlaceholder).toBeVisible();
    });
    await expect(app.qrImage).toHaveCount(1);
    await expect(app.resultPlaceholder).toBeHidden();
  });

  test("picking another quality clears the result pane back to the placeholder", async ({ app }) => {
    await readyToRecord(app, { ethos: "split-deck" });
    await app.record(700);
    await expect(app.qrImage).toBeVisible();

    await app.pickQuality("25hz");
    await expect(app.qrImage).toBeHidden();
    await expect(app.resultPlaceholder).toBeVisible();
  });
});

// ── Share actions: QR image, Copy URL, Copy hex, downloads ──────────

test.describe("share actions", () => {
  test("QR image is labelled and the URL round-trips through the copied hex", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);
    await expect(app.qrImage).toHaveAttribute("alt", "QR code");

    const packed = await packetFromCopyHex(app);
    const hexString = toHex(packed);

    await app.copyUrlButton.click();
    await expect(app.copyUrlButton).toHaveText("Copied!");
    const url = await app.page.evaluate(() => navigator.clipboard.readText());

    // The copied URL is this origin's /qr?v=<base64> and its base64 decodes to
    // exactly the bytes the "Copy hex" button hands out.
    const origin = new URL(app.page.url()).origin;
    expect(url).toBe(voiceUrl(origin, packed));
    const v = new URL(url).searchParams.get("v")!;
    const urlBytes = new Uint8Array(Buffer.from(v, "base64"));
    expect(toHex(urlBytes)).toBe(hexString);

    // "Copied!" is transient — it reverts to "Copy URL" after ~1.5 s.
    await expect(app.copyUrlButton).toHaveText("Copy URL", { timeout: 3_000 });
  });

  test("Copy hex confirms with 'Hex copied!' and lowercase, space-separated bytes", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);

    await app.copyHexButton.click();
    await expect(app.copyHexButton).toHaveText("Hex copied!");
    const hex = await app.page.evaluate(() => navigator.clipboard.readText());
    expect(hex).toMatch(/^[0-9a-f]{2}( [0-9a-f]{2})*$/);
    // First byte is the 12.5hz magic header.
    expect(hex.startsWith("03 ")).toBe(true);

    await expect(app.copyHexButton).toHaveText("Copy hex", { timeout: 3_000 });
  });

  test("Save hex downloads tinyvoice-<bytes>B.hex.txt containing the formatted hex + newline", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);
    const packed = await packetFromCopyHex(app);

    const downloadPromise = app.page.waitForEvent("download");
    await app.saveHexButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(`tinyvoice-${packed.length}B.hex.txt`);
    const path = await download.path();
    expect(fs.readFileSync(path!, "utf8")).toBe(`${toHex(packed)}\n`);
  });

  test("Download saves the QR as tinyvoice-qr.png", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);

    const downloadPromise = app.page.waitForEvent("download");
    await app.downloadQrButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("tinyvoice-qr.png");
    const path = await download.path();
    // A real PNG (magic \x89PNG) with a non-trivial body.
    const bytes = fs.readFileSync(path!);
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("\x89PNG");
  });
});

// ── Round trips back into Decode ────────────────────────────────────

test.describe("round trips into decode", () => {
  test("Copy URL → navigate → Decode shows the same packet and Play fetches only the decoder", async ({ app, models }) => {
    await readyToRecord(app);
    await app.record(700);
    const packed = await packetFromCopyHex(app);
    await app.copyUrlButton.click();
    await expect(app.copyUrlButton).toHaveText("Copied!");
    const url = await app.page.evaluate(() => navigator.clipboard.readText());

    const before = models.requests.length;
    await app.page.goto(url);
    // The ?v= payload lands the app on the Decode tab, ready to play.
    await expect(app.tab("decode")).toHaveAttribute("aria-selected", "true");
    await expect(app.playerStatus).toHaveText(initialStatus(packed, "12_5hz"));

    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback", { timeout: 10_000 });
    expect(models.requests.slice(before)).toEqual(["decoder_12_5hz.onnx"]);
  });

  test("Download PNG → upload on Decode decodes to the same packet", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);
    const packed = await packetFromCopyHex(app);

    const downloadPromise = app.page.waitForEvent("download");
    await app.downloadQrButton.click();
    const png = fs.readFileSync((await (await downloadPromise).path())!);

    await app.openTab("decode");
    await app.uploadFile("tinyvoice-qr.png", png, "image/png");
    await expect(app.playerStatus).toHaveText(initialStatus(packed, "12_5hz"), { timeout: 10_000 });
  });

  test("Copy hex → Decode › Hex decodes to the same packet", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);
    const packed = await packetFromCopyHex(app);

    await app.openTab("decode");
    await app.submitHex(toHex(packed));
    await expect(app.playerStatus).toHaveText(initialStatus(packed, "12_5hz"));
  });
});

// ── Preview ─────────────────────────────────────────────────────────

test.describe("preview playback", () => {
  test("Preview shows a loading state with progress, then plays, then a click stops it", async ({ app }) => {
    await readyToRecord(app);
    // A long take (~3 s of audio) so the stop click below lands while the
    // preview is still playing rather than after it ended on its own.
    await app.record(3_000);
    const { seconds } = await qrMeta(app);
    expect(seconds).toBeGreaterThanOrEqual(2);

    await app.setOrt({ delayMs: 900 }); // make the decode run observable
    await app.previewButton.click();
    await expect(app.previewButton).toHaveText("Loading...");
    await expect(resultRoot(app).getByRole("progressbar")).toBeVisible();
    await expect(resultRoot(app).locator("p", { hasText: "Decoding..." })).toBeVisible();

    await expect(app.previewButton).toHaveText("Playing...", { timeout: 10_000 });

    // With seconds of audio left, "Preview" can only come back this quickly
    // because the click stopped playback — had it started a replay from the
    // cached buffer instead, "Playing..." would persist for the whole clip.
    await app.previewButton.click();
    await expect(app.previewButton).toHaveText("Preview", { timeout: 1_500 });
  });

  test("a short preview ends on its own and reuses the decoded buffer", async ({ app }) => {
    await readyToRecord(app);
    await app.record(450); // short recording → ~0.4 s of audio
    await app.previewButton.click();
    await expect(app.previewButton).toHaveText("Playing...", { timeout: 10_000 });
    const runsAfterFirst = (await app.ortState()).runs.length;

    // Natural end: no click, the button returns to Preview once playback stops.
    await expect(app.previewButton).toHaveText("Preview", { timeout: 8_000 });

    // A second Preview replays the cached buffer without another decode run.
    await app.previewButton.click();
    await expect(app.previewButton).toHaveText("Playing...");
    expect((await app.ortState()).runs.length).toBe(runsAfterFirst);
  });

  test("a failed decode surfaces the error and re-arms Preview", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);

    await app.setOrt({ failRun: "decoder" });
    await app.previewButton.click();
    await expect(resultRoot(app).locator("p", { hasText: "E2E stub: simulated inference failure" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(app.previewButton).toHaveText("Preview");
  });
});

// ── Preview decoder override ────────────────────────────────────────

test.describe("preview decoder override", () => {
  test("the row offers Auto + the other two rates; a 50hz override fetches only its decoder", async ({ app, models }) => {
    await readyToRecord(app);
    await app.record(700);
    const { tokens } = await qrMeta(app);

    // The packet is 12.5hz, so Auto names it and 12.5hz is not offered again.
    await expect(app.decoderButtons()).toHaveText(DECODER_LABELS_12_5);
    await expectOnlyDecoderSelected(app, "Auto (12.5hz)");

    await app.decoderButton("50hz").click();
    await expectOnlyDecoderSelected(app, "50hz");

    const before = models.requests.length;
    await app.previewButton.click();
    await expect(app.previewButton).toHaveText("Playing...", { timeout: 10_000 });

    // A preview only needs the decoder — no compressor, and the shared encoder
    // is already loaded, so exactly one new request goes out.
    expect(models.requests.slice(before)).toEqual(["decoder_50hz.onnx"]);
    const { runs } = await app.ortState();
    const decoderRun = runs.filter((r) => r.model === "decoder_50hz.onnx").at(-1)!;
    // Decoded with the wrong (50hz) decoder, the token count is unchanged
    // ([1, tokens]) but the audio shrinks to tokens/50 s — a quarter of the
    // 12.5hz duration.
    expect(decoderRun.dims.tokens).toEqual([1, tokens]);

    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText("50hz loaded");
    await app.closeSettings();
  });

  test("after a 50hz preview override, Decode does not ask for the 50hz decoder", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);
    await app.decoderButton("50hz").click();
    await app.previewButton.click();
    await expect(app.previewButton).toHaveText("Playing...", { timeout: 10_000 });

    await app.openTab("decode");
    await app.submitHex(toHex(packetSeconds("50hz", 1, 5)));
    await expect(app.downloadModelsButton).toHaveCount(0);
  });

  test("previewing a recording whose decoder is absent offers a decoder download and plays after it", async ({ app, models }) => {
    await readyToRecord(app);
    await app.record(700);
    const decoderButton = resultRoot(app).getByRole("button", {
      name: "Download 12.5hz decoder (~141 MB)",
    });
    await expect(decoderButton).toBeVisible();
    expect(models.requests).not.toContain("decoder_12_5hz.onnx");

    await decoderButton.click();
    await expect(app.previewButton).toHaveText("Playing...", { timeout: 15_000 });
    await expect(decoderButton).toHaveCount(0);
    expect(models.requests).toContain("decoder_12_5hz.onnx");
    expect((await app.ortState()).runs.map((r) => r.model)).toContain("decoder_12_5hz.onnx");
  });

  test("a new recording resets the override to Auto and clears the copied states", async ({ app }) => {
    await readyToRecord(app, { ethos: "split-deck" });
    await app.record(700);

    await app.decoderButton("50hz").click();
    await expectOnlyDecoderSelected(app, "50hz");
    await app.copyUrlButton.click();
    await expect(app.copyUrlButton).toHaveText("Copied!");
    await app.copyHexButton.click();
    await expect(app.copyHexButton).toHaveText("Hex copied!");

    // A short fresh take, then read the labels the moment the new QR is up —
    // deliberately without retrying: the copied states also revert on their
    // own 1.5 s timers, and a retrying expect would let that timer paper over
    // a missing reset.
    await app.record(500);
    expect((await app.copyUrlButton.innerText()).trim()).toBe("Copy URL");
    expect((await app.copyHexButton.innerText()).trim()).toBe("Copy hex");
    await expectOnlyDecoderSelected(app, "Auto (12.5hz)");
  });
});

// ── Hex dump (inline + sheet) ───────────────────────────────────────

test.describe("hex dump", () => {
  test("the Hex button opens the Token Data sheet with the packet bytes", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);
    const { bytes } = await qrMeta(app);

    await app.resultHexButton.click();
    await expect(app.hexSheet).toBeVisible();
    await expect(app.hexSheet.getByText(`${bytes} bytes · raw hex dump`)).toBeVisible();
    const cells = hexCells(app.hexSheet);
    await expect(cells).toHaveCount(bytes);
    // The magic header byte leads the dump and is set apart from the payload.
    await expect(cells.first()).toHaveText("03");
    await expectHeaderByteHighlighted(cells);
  });

  test("the inline HexStream shows the byte count and styles the header byte", async ({ app }) => {
    await readyToRecord(app);
    await app.record(700);
    const { bytes } = await qrMeta(app);

    const section = app.page.getByRole("region", { name: "Token data" });
    await expect(section).toHaveCount(1);
    await expect(section.getByText(`${bytes} bytes · raw hex dump`)).toBeVisible();
    const cells = hexCells(section);
    await expect(cells).toHaveCount(bytes);
    await expect(cells.first()).toHaveText("03");
    await expectHeaderByteHighlighted(cells);
  });
});
