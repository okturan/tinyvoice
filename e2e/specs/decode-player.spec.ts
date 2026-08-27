/**
 * DecodePlayer playback state machine — what happens once a packet is loaded
 * and the models are (or are about to be) in memory: Play → Decoding → Stop,
 * replay from the cached buffer, natural end, the hex play head, decoder
 * overrides mid-playback, decode / model-init failures, cancelled downloads,
 * packet replacement and tab switches while playing, and legacy packets.
 *
 * Durations are exact: the stub decoder emits round(tokens × 50 / rate)
 * frames and the real iSTFT returns frames × HOP samples, so a 30 s 12.5 hz
 * packet (375 tokens) decodes to 30.0 s — and to 15.0 s through the 25 hz
 * decoder. Every test that Stops, overrides or replaces a packet while it is
 * playing uses that 30 s packet, so the natural end cannot arrive first on a
 * slow box and turn a Stop click into a replay.
 */
import type { Locator } from "@playwright/test";
import { test, expect } from "../support/test";
import type { QrApp } from "../support/app";
import {
  initialStatus,
  legacyPacket,
  packetSeconds,
  toBase64,
  toHex,
  tokensFor,
} from "../support/packets";

const MODELS_12_5 = ["compressor_12_5hz.onnx", "decoder_12_5hz.onnx", "encoder.onnx"];

/** Long enough that a click meant to land mid-playback always does. */
const LONG_SECONDS = 30;

/** HexStream's `<section aria-label="Token data">` inside the player card. */
function hexStream(app: QrApp): Locator {
  return app.page.getByRole("region", { name: "Token data" });
}

/** Every byte cell of the dump, in order. */
function hexCells(app: QrApp): Locator {
  return hexStream(app).locator("span.inline-block");
}

/** The cell the play head is on (`aria-current="true"`). */
function playHead(app: QrApp): Locator {
  return hexStream(app).locator('[aria-current="true"]');
}

function progressBar(app: QrApp): Locator {
  return app.playerCard.getByRole("progressbar");
}

async function expectPlaying(app: QrApp): Promise<void> {
  await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback", { timeout: 15_000 });
}

async function expectIdle(app: QrApp): Promise<void> {
  await expect(app.playButton).toHaveAttribute("aria-label", "Play voice packet");
  await expect(app.playButton).toBeEnabled();
}

test.describe("play, decode, stop", () => {
  test("Play decodes behind a progress line, then plays; Stop keeps the decoded status", async ({ app, models }) => {
    const bytes = packetSeconds("12_5hz", LONG_SECONDS); // 375 tokens → 1500 frames → 30.0 s
    await app.goto({ v: toBase64(bytes) });

    // Models through the player's own Download button. The fetches stay
    // parked until release, so the loading state can be inspected without
    // racing a timer.
    models.set("*", { hang: true });
    await app.downloadModelsButton.click();
    await expect(app.downloadModelsButton).toHaveText("Loading models...");
    await expect(app.downloadModelsButton).toBeDisabled();
    await expect(app.playButton).toBeDisabled();
    await expect(progressBar(app)).toBeVisible();
    await expect.poll(() => models.hungCount).toBe(3);
    models.reset();
    await expect(app.downloadModelsButton).toBeHidden({ timeout: 15_000 });
    await expect(progressBar(app)).toBeHidden();
    // NOTE: a decode-only load fetches the encoder and the compressor along
    // with the decoder (~850 MB of real models to hear one packet) although
    // the player only ever runs decoder_*; codec-service.decodeFromTokens
    // can already lazy-load just the decoder. The set is pinned here as
    // current behaviour, not as the required one.
    expect([...models.requests].sort()).toEqual(MODELS_12_5);
    await expectIdle(app);
    expect((await app.ortState()).runs).toEqual([]);

    await app.setOrt({ delayMs: 2000 });
    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Decoding voice packet");
    await expect(app.playButton).toBeDisabled();
    await expect(progressBar(app)).toBeVisible();
    // "Loading decoder..." (5 %) is emitted in the click's own tick; the
    // resident decoder session resolves at once, so "Decoding..." (80 %) is
    // the state that holds while the stubbed run() sleeps.
    await expect(app.playerStatus).toHaveText("Decoding...");
    await expect(app.playerStatus).toHaveClass(/--overlay/);
    await expect(progressBar(app)).toHaveAttribute("aria-valuenow", /^80/);

    await expectPlaying(app);
    await expect(app.playButton).toBeEnabled();
    await expect(app.playerStatus).toHaveText(`30.0s decoded from ${bytes.length} bytes`);
    await expect(app.playerStatus).toHaveClass(/--green/);
    // The whole token payload — and only the decoder — went through the runtime.
    expect((await app.ortState()).runs).toEqual([
      { model: "decoder_12_5hz.onnx", dims: { tokens: [1, 375] } },
    ]);

    await app.playButton.click();
    await expectIdle(app);
    await expect(app.playerStatus).toHaveText(`30.0s decoded from ${bytes.length} bytes`);
    await expect(app.playerStatus).toHaveClass(/--green/);
  });

  test("Play after Stop replays the cached buffer: no new inference, no network", async ({ app, models }) => {
    const bytes = packetSeconds("12_5hz", LONG_SECONDS);
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);
    const decoded = `30.0s decoded from ${bytes.length} bytes`;

    await app.playButton.click();
    await expectPlaying(app);
    await expect(app.playerStatus).toHaveText(decoded);
    await app.playButton.click();
    await expectIdle(app);
    await expect(app.playerStatus).toHaveText(decoded);
    const requests = models.requests.length;

    await app.playButton.click();
    await expectPlaying(app);
    await expect(app.playerStatus).toHaveText(decoded);
    await expect(app.playerStatus).toHaveClass(/--green/);
    expect((await app.ortState()).runs).toHaveLength(1);
    expect(models.requests.length).toBe(requests);

    await app.playButton.click();
    await expectIdle(app);
  });

  test("a short packet ends on its own and the button returns to Play", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 0.3); // 4 tokens → 16 frames → 0.32 s
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));

    await app.playButton.click();
    // The decoded line is written the instant playback starts and survives
    // the natural end, which only flips the button back.
    await expect(app.playerStatus).toHaveText(`0.3s decoded from ${bytes.length} bytes`, { timeout: 15_000 });
    await expectIdle(app);
    await expect(app.playerStatus).toHaveText(`0.3s decoded from ${bytes.length} bytes`);
    await expect(app.playerStatus).toHaveClass(/--green/);
    await expect(playHead(app)).toHaveCount(0);
    expect((await app.ortState()).runs).toHaveLength(1);
  });

  test("the decode progress bar exposes its value to assistive technology", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 4);
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.setOrt({ delayMs: 2000 });
    await app.playButton.click();
    await expect(app.playerStatus).toHaveText("Decoding...");
    await expect(progressBar(app)).toHaveAttribute("aria-valuenow", /^80/, { timeout: 1_000 });
  });

  test("the progress line goes away once the packet has been decoded", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 4);
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.playButton.click();
    await expectPlaying(app);
    await expect(progressBar(app)).toBeHidden({ timeout: 2_500 });
  });

  test("after the player's own Download finishes, the status line stops claiming to download", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 2);
    await app.goto({ v: toBase64(bytes) });
    await app.downloadModelsButton.click();
    await expect(app.downloadModelsButton).toBeHidden({ timeout: 15_000 });
    await expectIdle(app);
    await expect(app.playerStatus).not.toContainText("Downloading", { timeout: 2_500 });
  });
});

test.describe("hex play head", () => {
  test("the Token data dump marks the header byte, follows playback, and drops the head on Stop", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", LONG_SECONDS);
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);

    const stream = hexStream(app);
    await expect(stream).toBeVisible();
    await expect(stream).toContainText("Token data");
    await expect(stream).toContainText(`${bytes.length} bytes · raw hex dump`);
    await expect(hexCells(app)).toHaveCount(bytes.length);
    await expect(hexCells(app).first()).toHaveText("03");
    await expect(hexCells(app).first()).toHaveClass(/font-bold/);
    await expect(hexCells(app).first()).toHaveClass(/--tv-accent/);
    await expect(playHead(app)).toHaveCount(0);

    await app.playButton.click();
    await expectPlaying(app);
    await expect(playHead(app)).toHaveCount(1);
    await expect(playHead(app)).toHaveClass(/--green/);
    // The magic byte is never part of the payload the head walks.
    await expect(hexCells(app).first()).not.toHaveAttribute("aria-current", "true");
    await expect(hexCells(app).first()).toHaveClass(/--tv-accent/);

    await app.playButton.click();
    await expectIdle(app);
    await expect(playHead(app)).toHaveCount(0);
  });
});

test.describe("decoder override while playing", () => {
  test("switching decoder mid-playback stops it; the next Play decodes again with the new decoder", async ({ app, models }) => {
    const bytes = packetSeconds("12_5hz", LONG_SECONDS); // 375 tokens
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz", "25hz"]);
    const requests = models.requests.length;

    await app.playButton.click();
    await expectPlaying(app);
    await expect(playHead(app)).toHaveCount(1);

    await app.decoderButton("25hz").click();
    await expectIdle(app);
    await expect(app.playerStatus).toHaveText("Decoder set to 25hz");
    await expect(app.playerStatus).toHaveClass(/--overlay/);
    await expect(progressBar(app)).toBeHidden();
    await expect(playHead(app)).toHaveCount(0);
    expect(await app.selectedDecoderLabels()).toEqual(["25hz"]);
    await expect(app.downloadModelsButton).toBeHidden();

    await app.playButton.click();
    await expectPlaying(app);
    // 375 tokens through the 25 hz decoder is 15 s, not 30.
    await expect(app.playerStatus).toHaveText(`15.0s decoded from ${bytes.length} bytes`);
    await expect(app.playerStatus).toHaveClass(/--green/);
    const { runs } = await app.ortState();
    expect(runs.map((r) => r.model)).toEqual(["decoder_12_5hz.onnx", "decoder_25hz.onnx"]);
    // The override re-decodes the same token payload, not a re-parsed one.
    expect(runs[1]!.dims.tokens).toEqual([1, 375]);
    expect(models.requests.length).toBe(requests);

    // Back to Auto while the 25 hz rendition is playing: same again.
    await app.decoderButton("Auto (12.5hz)").click();
    await expectIdle(app);
    await expect(app.playerStatus).toHaveText("Decoder set to Auto (12.5hz)");
    expect(await app.selectedDecoderLabels()).toEqual(["Auto (12.5hz)"]);
    await app.playButton.click();
    await expect(app.playerStatus).toHaveText(`30.0s decoded from ${bytes.length} bytes`, { timeout: 15_000 });
    expect((await app.ortState()).runs.map((r) => r.model)).toEqual([
      "decoder_12_5hz.onnx",
      "decoder_25hz.onnx",
      "decoder_12_5hz.onnx",
    ]);
  });

  test("re-selecting the active decoder is a no-op", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", LONG_SECONDS);
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.playButton.click();
    await expectPlaying(app);
    expect(await app.selectedDecoderLabels()).toEqual(["Auto (12.5hz)"]);

    await app.decoderButton("Auto (12.5hz)").click();
    await expectPlaying(app);
    await expect(app.playerStatus).toHaveText(`30.0s decoded from ${bytes.length} bytes`);
    expect(await app.selectedDecoderLabels()).toEqual(["Auto (12.5hz)"]);

    await app.playButton.click();
    await expectIdle(app);
    await app.playButton.click();
    await expectPlaying(app);
    expect((await app.ortState()).runs.map((r) => r.model)).toEqual([
      "decoder_12_5hz.onnx",
    ]);
  });
});

test.describe("failures", () => {
  test("a decoder failure shows the message in red and re-arms Play; the next Play succeeds once the runtime recovers", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 4);
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);

    await app.setOrt({ failRun: "decoder", failMessage: "boom" });
    await app.playButton.click();
    await expect(app.playerStatus).toHaveText("boom");
    await expect(app.playerStatus).toHaveClass(/--red/);
    await expectIdle(app);
    await expect(playHead(app)).toHaveCount(0);
    expect((await app.ortState()).runs).toHaveLength(1);

    await app.setOrt({ failRun: null });
    await app.playButton.click();
    await expectPlaying(app);
    await expect(app.playerStatus).toHaveText(`4.0s decoded from ${bytes.length} bytes`);
    await expect(app.playerStatus).toHaveClass(/--green/);
    expect((await app.ortState()).runs).toHaveLength(2);
  });

  test("the progress line is cleared after a decode failure", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 4);
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.setOrt({ failRun: "decoder", failMessage: "boom" });
    await app.playButton.click();
    await expect(app.playerStatus).toHaveText("boom");
    await expectIdle(app);
    await expect(progressBar(app)).toBeHidden({ timeout: 2_500 });
  });

  test("a decoder that fails to initialise on Play reports it, and a plain retry loads it without a reload", async ({ app, models }) => {
    const bytes = packetSeconds("12_5hz", 4);
    await app.goto({ v: toBase64(bytes) });
    await app.setOrt({ failCreate: "decoder", failMessage: "decoder init failed" });

    await app.playButton.click();
    // CodecContext.loadModels goes to "error" and rethrows; the player shows
    // the runtime's message and leaves both buttons usable.
    await expect(app.playerStatus).toHaveText("decoder init failed", { timeout: 15_000 });
    await expect(app.playerStatus).toHaveClass(/--red/);
    await expectIdle(app);
    await expect(app.downloadModelsButton).toHaveText("Download 12.5hz models");
    await expect(app.downloadModelsButton).toBeEnabled();
    await expect(progressBar(app)).toBeHidden();
    // The sibling loads keep going after the decoder session fails, so wait
    // until every fetch has been issued before taking the count.
    // NOTE: same three-model set as the first test — pinned as current
    // behaviour.
    await expect.poll(() => [...models.requests].sort()).toEqual(MODELS_12_5);
    expect((await app.ortState()).sessions).not.toContain("decoder_12_5hz.onnx");
    const requestsAfterFailure = models.requests.length;

    await app.setOrt({ failCreate: null });
    await app.playButton.click();
    await expectPlaying(app);
    await expect(app.playerStatus).toHaveText(`4.0s decoded from ${bytes.length} bytes`);
    await expect(app.playerStatus).toHaveClass(/--green/);
    await expect(app.downloadModelsButton).toBeHidden();
    // The bytes were cached before the session failed, so the retry is
    // served from IndexedDB: nothing is fetched again, the decoder session
    // is created exactly once, and no session is created twice.
    expect(models.requests.length).toBe(requestsAfterFailure);
    const { sessions, runs } = await app.ortState();
    expect(sessions.filter((s) => s === "decoder_12_5hz.onnx")).toHaveLength(1);
    expect(new Set(sessions).size).toBe(sessions.length);
    expect(runs.map((r) => r.model)).toEqual(["decoder_12_5hz.onnx"]);
  });

  test("Settings keeps reporting a failed load as an error", async ({ app }) => {
    // BUG: CodecContext.loadModels writes statusText "Error" when
    // loadModelSet rejects, but the sibling loads started by the same
    // Promise.all keep running with a progress callback that is never
    // detached — the compressor finishing a moment later overwrites the line
    // with "Loaded compressor_12_5hz.onnx" while `state` stays "error".
    // (CodecContext.tsx loadModels catch block; codec-service loadModelSet.)
    test.fail();
    const bytes = packetSeconds("12_5hz", 4);
    await app.goto({ v: toBase64(bytes) });
    await app.setOrt({ failCreate: "decoder", failMessage: "decoder init failed" });
    await app.playButton.click();
    await expect(app.playerStatus).toHaveText("decoder init failed", { timeout: 15_000 });
    // Let the sibling loads finish so the status line has settled.
    await expect.poll(async () => (await app.ortState()).sessions.sort(), { timeout: 10_000 }).toEqual([
      "compressor_12_5hz.onnx",
      "encoder.onnx",
    ]);

    await app.openSettings("Models");
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(app.settingsCodecStatus).toHaveText("Error", { timeout: 2_500 });
  });
});

test.describe("download failures", () => {
  // The unfixed handler lets the rejection escape as an uncaught page error;
  // the fixture is relaxed for this one test so the failure it reports is
  // the missing error line, not the teardown check. The in-test assertion on
  // pageErrors takes over once the handler catches.
  test.use({ strictPageErrors: false });

  test("a failed download from the player's Download button is reported in red, not swallowed", async ({ app, models, pageErrors }) => {
    // BUG: DecodePlayer.handleDownloadModels has no try/catch. When
    // CodecContext.loadModels rethrows (here the decoder session fails to
    // initialise) the status line keeps saying "Downloading 12.5hz
    // models...", nothing turns red, and the rejection surfaces as an
    // uncaught exception. handlePlay's catch block handles the same failure
    // correctly. (DecodePlayer.tsx handleDownloadModels.)
    test.fail();
    const bytes = packetSeconds("12_5hz", 2);
    await app.goto({ v: toBase64(bytes) });
    await app.setOrt({ failCreate: "decoder", failMessage: "decoder init failed" });
    models.set("*", { hang: true });

    await app.downloadModelsButton.click();
    await expect(app.downloadModelsButton).toHaveText("Loading models...");
    await expect.poll(() => models.hungCount).toBe(3);
    models.reset();

    await expect(app.downloadModelsButton).toHaveText("Download 12.5hz models", { timeout: 15_000 });
    await expect(app.downloadModelsButton).toBeEnabled();
    await expectIdle(app);
    await expect(app.playerStatus).toContainText("decoder init failed", { timeout: 2_500 });
    await expect(app.playerStatus).toHaveClass(/--red/);
    expect(pageErrors).toEqual([]);
  });
});

test.describe("cancelled downloads", () => {
  test("cancelling the download Play started reports it, hides the progress line, and Play works again", async ({ app, models }) => {
    const bytes = packetSeconds("12_5hz", 4);
    await app.goto({ v: toBase64(bytes) });
    models.set("*", { hang: true });

    await app.playButton.click();
    await expect(app.playButton).toBeDisabled();
    await expect(app.playButton).toHaveAttribute("aria-label", "Play voice packet");
    await expect(app.downloadModelsButton).toHaveText("Loading models...");
    await expect(app.downloadModelsButton).toBeDisabled();
    await expect(progressBar(app)).toBeVisible();
    // While the codec context is loading, the player relays its status.
    await expect(app.playerStatus).toHaveText(/Loading models\.\.\.|Downloading .+\.onnx/);
    await expect.poll(() => models.hungCount).toBe(3);

    await app.openSettings("Models");
    await app.settingsSheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(app.settingsCodecStatus).toHaveText("Cancelled");
    await app.closeSettings();

    await expect(app.playerStatus).toHaveText("Download cancelled");
    await expect(app.playerStatus).toHaveClass(/--overlay/);
    await expectIdle(app);
    await expect(app.downloadModelsButton).toHaveText("Download 12.5hz models");
    await expect(app.downloadModelsButton).toBeEnabled();
    await expect(progressBar(app)).toBeHidden();
    expect((await app.ortState()).runs).toEqual([]);

    models.reset();
    await app.playButton.click();
    await expectPlaying(app);
    await expect(app.playerStatus).toHaveText(`4.0s decoded from ${bytes.length} bytes`);
    // Nothing reached the cache, so Play starts the download over.
    expect(models.requestsFor("decoder_12_5hz.onnx")).toBe(2);
  });

  test("cancelling a download started from the player's Download button reports it the same way", async ({ app, models }) => {
    const bytes = packetSeconds("12_5hz", 2);
    await app.goto({ v: toBase64(bytes) });
    models.set("*", { hang: true });

    await app.downloadModelsButton.click();
    await expect(app.downloadModelsButton).toHaveText("Loading models...");
    await expect(app.downloadModelsButton).toBeDisabled();
    await expect(app.playButton).toBeDisabled();
    await expect(progressBar(app)).toBeVisible();
    await expect.poll(() => models.hungCount).toBe(3);

    await app.openSettings("Models");
    await app.settingsSheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await app.closeSettings();

    await expect(app.playerStatus).toHaveText("Download cancelled");
    await expect(app.downloadModelsButton).toHaveText("Download 12.5hz models");
    await expect(app.downloadModelsButton).toBeEnabled();
    await expectIdle(app);
    await expect(progressBar(app)).toBeHidden();
  });
});

test.describe("packet replacement and tab switches", () => {
  test("submitting another packet while playing stops playback and resets the player to the new packet", async ({ app }) => {
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.loadModelsViaSettings(["12_5hz"]);
    const first = packetSeconds("12_5hz", LONG_SECONDS, 1); // 375 tokens, 751 bytes
    const second = packetSeconds("12_5hz", 2, 2); // 25 tokens, 51 bytes

    await app.submitHex(toHex(first));
    await expect(app.playerStatus).toHaveText(initialStatus(first, "12_5hz"));
    await app.playButton.click();
    await expectPlaying(app);
    await expect(playHead(app)).toHaveCount(1);

    await app.submitHex(toHex(second));
    await expectIdle(app);
    await expect(app.playerStatus).toHaveText(initialStatus(second, "12_5hz"));
    await expect(app.playerStatus).toHaveClass(/--overlay/);
    await expect(playHead(app)).toHaveCount(0);
    await expect(progressBar(app)).toBeHidden();
    await expect(hexStream(app)).toContainText(`${second.length} bytes · raw hex dump`);
    await expect(hexCells(app)).toHaveCount(second.length);

    await app.playerHexButton.click();
    await expect(app.hexSheet).toBeVisible();
    await expect(app.hexSheet).toContainText(`${second.length} bytes · raw hex dump`);
    await expect(app.hexSheet.locator("div.break-all")).toHaveText(toHex(second));
    await app.page.keyboard.press("Escape");
    await expect(app.hexSheet).toBeHidden();

    // The first packet's buffer is gone: Play decodes the new one.
    await app.playButton.click();
    await expect(app.playerStatus).toHaveText(`2.0s decoded from ${second.length} bytes`, { timeout: 15_000 });
    expect((await app.ortState()).runs.map((r) => r.dims.tokens)).toEqual([[1, 375], [1, 25]]);
  });

  test("leaving the Decode tab mid-playback stops it; a hex-loaded packet is still there when you come back", async ({ app }) => {
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.loadModelsViaSettings(["12_5hz"]);
    const bytes = packetSeconds("12_5hz", LONG_SECONDS);
    await app.submitHex(toHex(bytes));
    await app.playButton.click();
    await expectPlaying(app);

    await app.openTab("record");
    await expect(app.playerCard).toBeHidden();

    await app.openTab("decode");
    await expect(app.playerCard).toBeVisible();
    await expect(app.playerPlaceholder).toBeHidden();
    await expectIdle(app);
    await expect(app.editHexButton).toBeVisible();
    expect((await app.ortState()).runs).toHaveLength(1);
  });

  test("a URL-loaded packet keeps its decoded buffer and status after a tab round trip", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", LONG_SECONDS);
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.playButton.click();
    await expectPlaying(app);
    await expect(playHead(app)).toHaveCount(1);

    await app.openTab("record");
    await expect(app.playerCard).toBeHidden();

    await app.openTab("decode");
    await expect(app.playerCard).toBeVisible();
    await expect(app.newSourceButton).toBeVisible();
    await expectIdle(app);
    await expect(app.playerStatus).toHaveText(`30.0s decoded from ${bytes.length} bytes`);
    await expect(app.playerStatus).toHaveClass(/--green/);
    await expect(playHead(app)).toHaveCount(0);
    await expect(progressBar(app)).toBeHidden();
    await expect(app.downloadModelsButton).toBeHidden();
    expect(await app.selectedDecoderLabels()).toEqual(["Auto (12.5hz)"]);

    await app.playButton.click();
    await expectPlaying(app);
    await expect(app.playerStatus).toHaveText(`30.0s decoded from ${bytes.length} bytes`);
    expect((await app.ortState()).runs).toHaveLength(1);
  });
});

test.describe("legacy packets", () => {
  test("a headerless packet plays through the 50hz decoder and keeps saying so", async ({ app, models }) => {
    const bytes = legacyPacket(tokensFor(LONG_SECONDS * 50, 3)); // 30 s at 50 hz, no magic byte
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["50hz"]);
    await expect(app.downloadModelsButton).toBeHidden();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "50hz", true));
    await expect(app.playerStatus).toContainText("(legacy fallback)");
    expect(await app.decoderLabels()).toEqual(["Auto (50hz, legacy fallback)", "12.5hz", "25hz"]);
    expect(await app.selectedDecoderLabels()).toEqual(["Auto (50hz, legacy fallback)"]);
    await expect(hexStream(app)).toContainText(`${bytes.length} bytes · raw hex dump`);
    await expect(hexCells(app)).toHaveCount(bytes.length);
    // No magic byte, so no highlighted header cell.
    await expect(hexCells(app).first()).not.toHaveClass(/font-bold/);
    const requests = models.requests.length;

    await app.playButton.click();
    await expectPlaying(app);
    await expect(app.playerStatus).toHaveText(`30.0s decoded from ${bytes.length} bytes`);
    await expect(app.playerStatus).toHaveClass(/--green/);
    await expect(playHead(app)).toHaveCount(1);
    // Every byte pair is a token — nothing was skipped as a header.
    expect((await app.ortState()).runs).toEqual([
      { model: "decoder_50hz.onnx", dims: { tokens: [1, 1500] } },
    ]);
    // The models came from Settings; Play fetched nothing new.
    expect(models.requests.length).toBe(requests);

    await app.playButton.click();
    await expectIdle(app);
    await expect(app.playerStatus).toHaveText(`30.0s decoded from ${bytes.length} bytes`);
    // An override and the way back to Auto both keep naming the fallback.
    await app.decoderButton("25hz").click();
    await expect(app.playerStatus).toHaveText("Decoder set to 25hz");
    await app.decoderButton("Auto (50hz, legacy fallback)").click();
    await expect(app.playerStatus).toHaveText("Decoder set to Auto (50hz, legacy fallback)");
    expect(await app.selectedDecoderLabels()).toEqual(["Auto (50hz, legacy fallback)"]);
  });
});
