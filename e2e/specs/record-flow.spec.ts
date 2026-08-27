/**
 * Record tab: codec card, quality picker, the model dialog launched from the
 * card, microphone enablement and the hold-to-record flow (useRecordFlow +
 * CodecCard / QualityCard / RecordButton / TrimToggle / ModelDownloadDialog).
 */
import type { Locator } from "@playwright/test";
import { test, expect } from "../support/test";
import type { QrApp } from "../support/app";
import { ALL_QUALITIES, LABEL, type Quality } from "../support/packets";

/** Record intent: 595 MB shared encoder + per-quality compressor (no decoder). */
const ENCODER_MB = 595;
const COMP_MB: Record<Quality, number> = { "12_5hz": 76, "25hz": 74, "50hz": 70 };
const RECORD_MB: Record<Quality, number> = {
  "12_5hz": ENCODER_MB + COMP_MB["12_5hz"], // 671
  "25hz": ENCODER_MB + COMP_MB["25hz"], // 669
  "50hz": ENCODER_MB + COMP_MB["50hz"], // 665
};

const CACHED = "✓";
const NOT_CACHED = "↓";
const TOO_SHORT = "Too short — hold longer";
const HINT = "hold to record · release to encode";

function recordFiles(q: Quality): string[] {
  return [`compressor_${q}.onnx`];
}

function pairFor(q: Quality): string[] {
  return [`compressor_${q}.onnx`, `decoder_${q}.onnx`];
}

/** The <label> wrapping a quality radio — it carries the ✓ / ↓ cache marker. */
function qualityOption(app: QrApp, q: Quality): Locator {
  return app.page.locator("label", { has: app.qualityRadio(q) });
}

/**
 * Pick a quality by clicking its label. The radio itself is `sr-only`, so
 * Playwright refuses to click it (the label's text span intercepts the
 * pointer) — `app.pickQuality` cannot be used on this page.
 */
async function pick(app: QrApp, q: Quality): Promise<void> {
  await qualityOption(app, q).click();
  await expect(app.qualityRadio(q)).toHaveAttribute("aria-checked", "true");
}

/**
 * Result metadata read from the QRResult block itself. The page object's
 * `resultMeta` takes the first `/^\d+\.\ds$/` span on the page, which in
 * split-deck is the (hidden) recording timer rather than the result's seconds.
 */
async function resultMeta(app: QrApp): Promise<{ bytes: number; tokens: number; seconds: number }> {
  const root = app.qrImage.locator("..");
  const num = async (re: RegExp) => Number(await root.locator("span", { hasText: re }).locator("b").innerText());
  return { bytes: await num(/^\d+ bytes$/), tokens: await num(/^\d+ tokens$/), seconds: await num(/^\d+\.\ds$/) };
}

/** The "<quality> loaded" line the codec card shows once models are in memory. */
function loadedLine(app: QrApp): Locator {
  return app.codecCard.getByText(/^\S+ loaded$/);
}

/** The encoder.onnx row at the top of the download dialog. */
function encoderRow(app: QrApp): Locator {
  return app.downloadDialog
    .getByText("encoder.onnx", { exact: true })
    .locator("xpath=ancestor::*[contains(@class,'rounded-md')][1]");
}

/** The waveform canvas + timer strip under the HOLD button. */
function waveformCanvas(app: QrApp): Locator {
  return app.holdButton.locator("..").locator("canvas");
}

function encodeProgress(app: QrApp): Locator {
  return app.holdButton.locator("..").getByRole("progressbar");
}

async function reload(app: QrApp): Promise<void> {
  await app.page.reload();
  await expect(app.tab("record")).toBeVisible();
}

/** Download `q` through the codec card's dialog and wait for the card to report it loaded. */
async function downloadFromCard(app: QrApp, q: Quality): Promise<void> {
  await expect(app.codecButton).toHaveText("Choose models");
  await app.codecButton.click();
  await expect(app.downloadDialog).toBeVisible();
  await app.startDialogDownload([q]);
  await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
  await expect(loadedLine(app)).toHaveText(`${LABEL[q]} loaded`);
}

async function enableMic(app: QrApp): Promise<void> {
  await expect(app.codecButton).toHaveText("Enable microphone");
  await app.codecButton.click();
  await expect(app.holdButton).toBeEnabled();
}

/** Count getUserMedia calls from here on — the only way the app can ask for the mic. */
async function trackMicRequests(app: QrApp): Promise<void> {
  await app.page.evaluate(() => {
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    const w = window as unknown as { __micRequests: number };
    w.__micRequests = 0;
    devices.getUserMedia = (constraints?: MediaStreamConstraints) => {
      w.__micRequests += 1;
      return original(constraints);
    };
  });
}

async function micRequests(app: QrApp): Promise<number> {
  return app.page.evaluate(() => (window as unknown as { __micRequests?: number }).__micRequests ?? 0);
}

/** Press the HOLD button without releasing it. */
async function pressHold(app: QrApp): Promise<void> {
  const box = await app.holdButton.boundingBox();
  if (!box) throw new Error("HOLD button is not on screen");
  await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.page.mouse.down();
}

/**
 * A release that lands inside recDown's async setup: pointerdown and
 * pointerup dispatched in the same task, so recUp runs while recDown is
 * still awaiting audioWorklet.addModule (~15 ms here; longer on a cold
 * audio thread or after AudioContext.resume on mobile). Real pointer
 * round-trips through Playwright are too slow to hit that window.
 */
async function instantTap(app: QrApp): Promise<void> {
  await app.holdButton.evaluate((el) => {
    const init = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", init));
    el.dispatchEvent(new PointerEvent("pointerup", init));
  });
}

async function timerSeconds(app: QrApp): Promise<number> {
  return parseFloat((await app.recordingTimer.textContent()) ?? "NaN");
}

/** Turn lead-in trimming off so a take's reported length is its hold time. */
async function disableTrim(app: QrApp): Promise<void> {
  await app.trimSwitch.click();
  await expect(app.trimSwitch).toHaveAttribute("aria-checked", "false");
}

/** Split-deck keeps the codec card on screen next to the result, so recording tests use it. */
async function armedRecorder(app: QrApp): Promise<void> {
  await app.presetEthos("split-deck");
  await app.goto();
  await downloadFromCard(app, "12_5hz");
  await enableMic(app);
}

test.describe("fresh state", () => {
  test("defaults to 12.5hz with nothing cached, no models chosen and HOLD disabled", async ({ app, models }) => {
    await app.goto();
    await expect(app.qualityRadio("12_5hz")).toHaveAttribute("aria-checked", "true");
    for (const q of ALL_QUALITIES) {
      await expect(qualityOption(app, q)).toContainText(NOT_CACHED);
      await expect(qualityOption(app, q)).not.toContainText(CACHED);
    }
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecButton).toBeEnabled();
    await expect(loadedLine(app)).toHaveCount(0);
    await expect(app.codecStatus).toHaveCount(0);
    await expect(app.holdButton).toHaveText("HOLD");
    await expect(app.holdButton).toBeDisabled();
    await expect(app.holdButton).toBeVisible();
    await expect(app.page.getByText(HINT)).toBeVisible();
    await expect(waveformCanvas(app)).toBeHidden();
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "true");
    // Stage-swap shows the record stage (HOLD + trim) until a result exists; there is no result pane yet.
    await expect(app.qrImage).toHaveCount(0);
    await expect(app.newRecordingButton).toHaveCount(0);
    expect(models.requests).toEqual([]);
  });

  test("Choose models opens the dialog with the current quality suggested and full package sizes", async ({ app, models }) => {
    await app.goto();
    await app.codecButton.click();
    await expect(app.downloadDialog).toBeVisible();
    await expect(app.downloadDialog).toContainText("Start with one quality. The shared encoder is included with your first download.");
    await expect(encoderRow(app)).toContainText("595 MB");
    await expect(encoderRow(app).getByText("cached", { exact: true })).toHaveCount(0);

    for (const q of ALL_QUALITIES) {
      const button = app.dialogRow(q).getByRole("button");
      await expect(button).toHaveText(`Download (~${RECORD_MB[q]} MB)`);
      await expect(button).toBeEnabled();
    }
    await expect(app.dialogRow("12_5hz").getByText("suggested", { exact: true })).toBeVisible();
    await expect(app.dialogRow("25hz").getByText("suggested", { exact: true })).toHaveCount(0);
    await expect(app.dialogRow("50hz").getByText("suggested", { exact: true })).toHaveCount(0);
    await expect(app.downloadDialog.getByRole("button", { name: "Select multiple qualities" })).toBeVisible();
    expect(models.requests).toEqual([]);

    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.holdButton).toBeDisabled();
  });

  test("the dialog's suggestion follows the picked quality", async ({ app }) => {
    await app.goto();
    await pick(app, "50hz");
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecStatus).toHaveCount(0);
    await app.codecButton.click();
    await expect(app.dialogRow("50hz").getByText("suggested", { exact: true })).toBeVisible();
    await expect(app.dialogRow("50hz").getByRole("button")).toHaveText(`Download (~${RECORD_MB["50hz"]} MB)`);
    await expect(app.dialogRow("12_5hz").getByText("suggested", { exact: true })).toHaveCount(0);
  });
});

test.describe("downloading from the codec card", () => {
  test("shows progress in the dialog and on the card, then hands over to the microphone step", async ({ app, models }) => {
    await app.goto();
    models.set("*", { hang: true });
    await app.codecButton.click();
    await app.startDialogDownload(["12_5hz"]);
    await expect.poll(() => models.hungCount).toBe(2);
    expect([...models.requests].sort()).toEqual(["encoder.onnx", ...recordFiles("12_5hz")].sort());

    // Dialog: rows lock, progress + status + Cancel download appear.
    await expect(app.downloadDialog.getByRole("progressbar")).toBeVisible();
    await expect(app.downloadDialog.getByRole("button", { name: "Cancel download" })).toBeVisible();
    await expect(app.downloadDialog.getByText("Loading models...", { exact: true })).toBeVisible();
    await expect(app.dialogRow("12_5hz").getByRole("button")).toBeDisabled();
    await expect(app.dialogRow("25hz").getByRole("button")).toBeDisabled();

    // The page behind a modal dialog is aria-hidden, so close it to inspect the card.
    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.codecButton).toHaveText("Loading models...");
    await expect(app.codecButton).toBeDisabled();
    await expect(app.codecCard.getByRole("progressbar")).toBeVisible();
    await expect(app.codecCancelButton).toBeVisible();
    await expect(app.codecStatus).toHaveText("Loading models...");
    await expect(app.holdButton).toBeDisabled();

    models.release();
    await expect(loadedLine(app)).toHaveText("12.5hz loaded", { timeout: 15_000 });
    await expect(app.codecButton).toHaveText("Enable microphone");
    await expect(app.codecCancelButton).toBeHidden();
    await expect(app.codecCard.getByRole("progressbar")).toBeHidden();
    await expect(app.codecStatus).toHaveCount(0);
    await expect(app.holdButton).toBeDisabled();
    await expect(qualityOption(app, "12_5hz")).toContainText(CACHED);
    await expect(qualityOption(app, "25hz")).toContainText(NOT_CACHED);
    await expect(qualityOption(app, "50hz")).toContainText(NOT_CACHED);
    expect((await app.ortState()).sessions.sort()).toEqual(["encoder.onnx", ...recordFiles("12_5hz")].sort());

    await app.codecButton.click();
    await expect(app.holdButton).toBeEnabled();
    await expect(app.codecButton).toHaveCount(0);
    // The hook's status now equals the loaded line, so the card does not repeat it.
    await expect(app.codecStatus).toHaveCount(0);
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    expect(models.requests.length).toBe(2);
  });

  test("the dialog closes itself when the download completes and Settings agrees", async ({ app, models }) => {
    await app.goto();
    models.set("*", { delayMs: 1200 });
    await app.codecButton.click();
    await app.startDialogDownload(["12_5hz"]);
    await expect(app.downloadDialog.getByRole("button", { name: "Cancel download" })).toBeVisible();
    await expect(app.downloadDialog).toBeHidden({ timeout: 15_000 });
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    await expect(app.codecButton).toHaveText("Enable microphone");

    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");
    await expect(app.settingsCodecButton).toHaveText("Change models");
    await app.closeSettings();
  });

  test("Cancel download on the card aborts and re-arms Choose models; a second attempt starts over", async ({ app, models }) => {
    await app.goto();
    models.set("*", { hang: true });
    await app.codecButton.click();
    await app.startDialogDownload(["12_5hz"]);
    await expect.poll(() => models.hungCount).toBe(2);
    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.codecButton).toHaveText("Loading models...");

    await app.codecCancelButton.click();
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecButton).toBeEnabled();
    await expect(app.codecCancelButton).toBeHidden();
    await expect(app.codecCard.getByRole("progressbar")).toBeHidden();
    await expect(app.holdButton).toBeDisabled();
    await expect(qualityOption(app, "12_5hz")).toContainText(NOT_CACHED);
    // NOTE: current behaviour — a cancelled dialog download leaves the record
    // tab with no message at all. "Download cancelled" only exists on the
    // card's own Load-cached-models path (useRecordFlow.handleLoadModels);
    // the context's "Cancelled" is only visible in Settings › Models. Whether
    // the card should say so too is an open question.
    await expect(app.codecStatus).toHaveCount(0);

    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText("Cancelled");
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await app.closeSettings();

    // A second attempt starts over from scratch.
    models.reset();
    await app.codecButton.click();
    await expect(app.dialogRow("12_5hz").getByRole("button")).toHaveText(`Download (~${RECORD_MB["12_5hz"]} MB)`);
    await app.startDialogDownload(["12_5hz"]);
    await expect(app.downloadDialog).toBeHidden({ timeout: 15_000 });
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    expect(models.requests.length).toBe(4);
  });

  test("Select multiple qualities downloads both pairs and either loaded quality can record", async ({ app, models }) => {
    await app.goto();
    await app.codecButton.click();
    const go = await app.selectMultiple(["12_5hz", "25hz"]);
    // The current quality was pre-selected before switching to multi-select.
    await expect(app.dialogRow("12_5hz").getByRole("checkbox")).toBeChecked();
    await expect(app.dialogRow("25hz").getByRole("checkbox")).toBeChecked();
    await expect(app.dialogRow("50hz").getByRole("checkbox")).not.toBeChecked();
    for (const q of ALL_QUALITIES) await expect(app.dialogRow(q)).toContainText(`~${RECORD_MB[q]} MB`);
    await expect(go).toHaveText(`Download selected (~${ENCODER_MB + COMP_MB["12_5hz"] + COMP_MB["25hz"]} MB)`); // 745

    models.set("*", { hang: true });
    await go.click();
    await expect.poll(() => models.hungCount).toBe(3);
    await expect(app.downloadDialog.getByRole("button", { name: "Cancel download" })).toBeVisible();
    await expect(app.dialogRow("50hz").getByRole("checkbox")).toBeDisabled();
    models.release();
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    expect([...models.requests].sort()).toEqual(
      ["encoder.onnx", ...recordFiles("12_5hz"), ...recordFiles("25hz")].sort(),
    );
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    await expect(qualityOption(app, "12_5hz")).toContainText(CACHED);
    await expect(qualityOption(app, "25hz")).toContainText(CACHED);
    await expect(qualityOption(app, "50hz")).toContainText(NOT_CACHED);

    await enableMic(app);
    await pick(app, "25hz");
    await expect(loadedLine(app)).toHaveText("25hz loaded");
    await expect(app.holdButton).toBeEnabled();
    await expect(app.codecButton).toHaveCount(0);
    await expect(app.codecStatus).toHaveCount(0);

    await pick(app, "50hz");
    await expect(app.holdButton).toBeDisabled();
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecStatus).toHaveText("50hz compressor needs download");
    expect(models.requests.length).toBe(3);
  });
});

test.describe("download failure from the dialog", () => {
  test("a failed download re-arms the dialog and tells the user what went wrong without throwing", async ({ app, models, pageErrors }) => {
    await app.goto();
    models.set("*", { status: 500, delayMs: 400 });
    await app.codecButton.click();
    await app.startDialogDownload(["12_5hz"]);
    const row = app.dialogRow("12_5hz").getByRole("button");
    await expect(row).toBeDisabled();
    await expect(app.downloadDialog.getByRole("button", { name: "Cancel download" })).toBeVisible();

    await expect(row).toBeEnabled();
    await expect(row).toHaveText(`Download (~${RECORD_MB["12_5hz"]} MB)`);
    await expect(app.downloadDialog).toBeVisible();
    await expect(app.downloadDialog.getByRole("button", { name: "Cancel download" })).toBeHidden();
    await expect(app.downloadDialog.getByRole("progressbar")).toBeHidden();
    await expect(app.downloadDialog.locator('[data-slot="dialog-footer"]').getByRole("button", { name: "Close" })).toBeVisible();
    expect(models.requests.length).toBe(2);

    await expect(app.downloadDialog.getByText(/Failed to download .+: HTTP 500/)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("after a failed download the record tab is back to Choose models and a retry works", async ({ app, models }) => {
    await app.goto();
    models.set("*", { status: 500, delayMs: 400 });
    await app.codecButton.click();
    await app.startDialogDownload(["12_5hz"]);
    const row = app.dialogRow("12_5hz").getByRole("button");
    await expect(row).toBeDisabled();
    await expect(row).toBeEnabled();
    expect(models.requests.length).toBe(2);

    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecButton).toBeEnabled();
    await expect(app.holdButton).toBeDisabled();
    await expect(qualityOption(app, "12_5hz")).toContainText(NOT_CACHED);

    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText(/Error|Failed to download/);
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await app.closeSettings();

    models.reset();
    await downloadFromCard(app, "12_5hz");
    expect(models.requests.length).toBe(4);
    await enableMic(app);
  });
});

test.describe("cached models after a reload", () => {
  test("Load cached models reads IndexedDB, grabs the mic in the same click, and arms HOLD without a download", async ({ app, models }) => {
    await app.goto();
    await downloadFromCard(app, "12_5hz");
    await reload(app);

    await expect(app.codecButton).toHaveText("Load cached models");
    await expect(app.codecStatus).toHaveText("Cached models available");
    await expect(loadedLine(app)).toHaveCount(0);
    await expect(qualityOption(app, "12_5hz")).toContainText(CACHED);
    await expect(app.holdButton).toBeDisabled();
    expect((await app.ortState()).sessions).toEqual([]);

    const before = models.requests.length;
    await app.codecButton.click();
    await expect(app.holdButton).toBeEnabled({ timeout: 15_000 });
    expect(models.requests.length).toBe(before);
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    await expect(app.codecButton).toHaveCount(0);
    await expect(app.codecStatus).toHaveCount(0);
    expect((await app.ortState()).sessions.sort()).toEqual(["encoder.onnx", ...recordFiles("12_5hz")].sort());
  });

  test("a session that fails to initialise from cache is reported in red on the card and can be retried", async ({ app }) => {
    await app.goto();
    await downloadFromCard(app, "12_5hz");
    await reload(app);
    await expect(app.codecButton).toHaveText("Load cached models");

    await app.setOrt({ failCreate: "compressor", failMessage: "E2E: compressor session refused" });
    await app.codecButton.click();
    await expect(app.codecStatus).toHaveText("E2E: compressor session refused");
    await expect(app.codecStatus).toHaveClass(/--red/);
    await expect(app.codecButton).toHaveText("Load cached models");
    await expect(app.codecButton).toBeEnabled();
    await expect(app.holdButton).toBeDisabled();
    await expect(loadedLine(app)).toHaveCount(0);
    expect((await app.ortState()).sessions).not.toContain("compressor_12_5hz.onnx");

    // Settings is back to an idle codec block. Its status line is not asserted
    // here: the sibling encoder/decoder loads keep running after the failure
    // and their progress overwrites "Error" at a racy moment (B28 — pinned by
    // the test.fail() cases in decode-player and models-lifecycle).
    await app.openSettings("Models");
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await app.closeSettings();

    // The failed session was dropped from the codec service, so a retry rebuilds it.
    await app.setOrt({ failCreate: null });
    await app.codecButton.click();
    await expect(app.holdButton).toBeEnabled({ timeout: 15_000 });
    await expect(app.codecStatus).toHaveCount(0);
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    expect((await app.ortState()).sessions).toContain("compressor_12_5hz.onnx");
  });

  test("picking a quality whose compressor is missing names it and the dialog prices only the missing pair", async ({ app }) => {
    await app.goto();
    await downloadFromCard(app, "12_5hz");
    await reload(app);
    await expect(app.codecButton).toHaveText("Load cached models");

    await pick(app, "25hz");
    await expect(app.codecStatus).toHaveText("25hz compressor needs download");
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.holdButton).toBeDisabled();
    await expect(qualityOption(app, "25hz")).toContainText(NOT_CACHED);
    await expect(qualityOption(app, "12_5hz")).toContainText(CACHED);

    await app.codecButton.click();
    await expect(encoderRow(app).getByText("cached", { exact: true })).toBeVisible();
    await expect(app.dialogRow("25hz").getByText("suggested", { exact: true })).toBeVisible();
    await expect(app.dialogRow("25hz").getByRole("button")).toHaveText(`Download (~${COMP_MB["25hz"]} MB)`);
    await expect(app.dialogRow("50hz").getByRole("button")).toHaveText(`Download (~${COMP_MB["50hz"]} MB)`);
    await expect(app.dialogRow("12_5hz").getByRole("button")).toHaveText("Load from cache");
    await expect(app.dialogRow("12_5hz").getByText("cached", { exact: true })).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();

    await pick(app, "12_5hz");
    await expect(app.codecButton).toHaveText("Load cached models");
    await expect(app.codecStatus).toHaveText("Cached models available");
  });

  test("deleting the shared encoder in Settings turns the card into Encoder needs download", async ({ app }) => {
    await app.goto();
    await downloadFromCard(app, "12_5hz");
    await reload(app);
    await expect(app.codecButton).toHaveText("Load cached models");

    await app.openSettings("Models");
    const encoderFile = app.settingsSheet.locator("div.rounded-md", { hasText: "encoder.onnx" });
    await expect(encoderFile.getByText("cached", { exact: true })).toBeVisible();
    await app.settingsSheet.getByTitle("Delete encoder.onnx").click();
    await expect(encoderFile.getByText("not cached", { exact: true })).toBeVisible();
    await app.closeSettings();

    // Changing the quality makes the card re-check the cache (it should notice
    // on its own — the test.fail() below); with a fix this round trip is simply redundant.
    await pick(app, "25hz");
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecStatus).toHaveCount(0); // nothing of 25hz is cached, so no partial-cache line
    await pick(app, "12_5hz");
    await expect(app.codecStatus).toHaveText("Encoder needs download");
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.holdButton).toBeDisabled();
    await expect(qualityOption(app, "12_5hz")).toContainText(NOT_CACHED);
  });

  test("the codec card notices the encoder deleted from Settings without a quality change", async ({ app }) => {
    await app.goto();
    await downloadFromCard(app, "12_5hz");
    await reload(app);
    await expect(app.codecButton).toHaveText("Load cached models");

    await app.openSettings("Models");
    const encoderFile = app.settingsSheet.locator("div.rounded-md", { hasText: "encoder.onnx" });
    await app.settingsSheet.getByTitle("Delete encoder.onnx").click();
    await expect(encoderFile.getByText("not cached", { exact: true })).toBeVisible();
    await app.closeSettings();

    await expect(app.codecStatus).toHaveText("Encoder needs download");
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.holdButton).toBeDisabled();
  });

  test("the record tab's dialog notices a model file deleted from Settings", async ({ app }) => {
    await app.goto();
    await downloadFromCard(app, "12_5hz");
    await reload(app);
    await expect(app.codecButton).toHaveText("Load cached models");

    await app.openSettings("Models");
    const encoderFile = app.settingsSheet.locator("div.rounded-md", { hasText: "encoder.onnx" });
    await app.settingsSheet.getByTitle("Delete encoder.onnx").click();
    await expect(encoderFile.getByText("not cached", { exact: true })).toBeVisible();
    await app.closeSettings();
    await pick(app, "25hz");
    await pick(app, "12_5hz");
    await expect(app.codecStatus).toHaveText("Encoder needs download");

    await app.codecButton.click();
    await expect(app.dialogRow("12_5hz").getByText("cached", { exact: true })).toBeVisible();
    await expect(app.dialogRow("12_5hz").getByRole("button")).toHaveText(`Download (~${ENCODER_MB} MB)`);
    await expect(encoderRow(app).getByText("cached", { exact: true })).toHaveCount(0);
  });
});

test.describe("switching quality", () => {
  test("leaving the loaded quality disarms HOLD; coming back re-arms it without asking for the mic again", async ({ app, models }) => {
    await app.goto();
    await trackMicRequests(app);
    await downloadFromCard(app, "12_5hz");
    await enableMic(app);
    await expect.poll(() => micRequests(app)).toBe(1);

    await pick(app, "25hz");
    await expect(app.holdButton).toBeDisabled();
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecStatus).toHaveText("25hz compressor needs download");
    await expect(loadedLine(app)).toHaveCount(0);

    await app.codecButton.click();
    await expect(app.dialogRow("25hz").getByText("suggested", { exact: true })).toBeVisible();
    await expect(app.dialogRow("25hz").getByRole("button")).toHaveText(`Download (~${COMP_MB["25hz"]} MB)`);
    await expect(app.dialogRow("12_5hz").getByRole("button")).toHaveText("Loaded");
    await expect(app.dialogRow("12_5hz").getByRole("button")).toBeDisabled();
    await expect(app.dialogRow("12_5hz").getByText("loaded", { exact: true })).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();

    await pick(app, "12_5hz");
    await expect(app.holdButton).toBeEnabled();
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    await expect(app.codecButton).toHaveCount(0);
    await expect(app.codecStatus).toHaveCount(0);
    expect(models.requests.length).toBe(2);
    expect(await micRequests(app)).toBe(1);
  });

  test("with nothing picked, loading 50hz from Settings moves the radio to 50hz", async ({ app, models }) => {
    await app.goto();
    await expect(app.qualityRadio("12_5hz")).toHaveAttribute("aria-checked", "true");
    await app.loadModelsViaSettings(["50hz"]);
    expect([...models.requests].sort()).toEqual(["encoder.onnx", ...pairFor("50hz")].sort());

    await expect(app.qualityRadio("50hz")).toHaveAttribute("aria-checked", "true");
    await expect(app.qualityRadio("12_5hz")).toHaveAttribute("aria-checked", "false");
    await expect(loadedLine(app)).toHaveText("50hz loaded");
    await expect(app.codecButton).toHaveText("Enable microphone");
    await expect(app.codecStatus).toHaveCount(0);
    await expect(app.holdButton).toBeDisabled();
    await expect(qualityOption(app, "50hz")).toContainText(CACHED);
    await expect(qualityOption(app, "12_5hz")).toContainText(NOT_CACHED);
    await enableMic(app);
  });

  test("a quality the user picked is not overridden by a Settings download", async ({ app }) => {
    await app.goto();
    await pick(app, "25hz");
    await app.loadModelsViaSettings(["50hz"]);

    await expect(app.qualityRadio("25hz")).toHaveAttribute("aria-checked", "true");
    await expect(app.qualityRadio("50hz")).toHaveAttribute("aria-checked", "false");
    await expect(qualityOption(app, "50hz")).toContainText(CACHED);
    await expect(qualityOption(app, "25hz")).toContainText(NOT_CACHED);
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.holdButton).toBeDisabled();
    await expect(loadedLine(app)).toHaveCount(0);

    await pick(app, "50hz");
    await expect(loadedLine(app)).toHaveText("50hz loaded");
    await expect(app.codecButton).toHaveText("Enable microphone");
  });

  test("after a reload the radio auto-picks the only cached quality", async ({ app }) => {
    await app.goto();
    await app.loadModelsViaSettings(["25hz"]);
    await reload(app);

    await expect(app.qualityRadio("25hz")).toHaveAttribute("aria-checked", "true");
    await expect(app.codecButton).toHaveText("Load cached models");
    await expect(app.codecStatus).toHaveText("Cached models available");
    await expect(qualityOption(app, "25hz")).toContainText(CACHED);
    await expect(qualityOption(app, "12_5hz")).toContainText(NOT_CACHED);
    await expect(qualityOption(app, "50hz")).toContainText(NOT_CACHED);
    await expect(app.holdButton).toBeDisabled();
  });
});

test.describe("recording", () => {
  test("holding shows a ticking timer and waveform; releasing encodes and the result clears the status", async ({ app }) => {
    await armedRecorder(app);
    await app.setOrt({ delayMs: 1500 }); // two runs → ENCODING stays up for ~3 s

    await pressHold(app);
    await expect(app.codecStatus).toHaveText("Recording...");
    await expect(app.holdButton).toHaveText("HOLD");
    await expect(waveformCanvas(app)).toBeVisible();
    await expect(app.recordingTimer).toBeVisible();
    await expect(app.page.getByText(HINT)).toBeHidden();
    const first = await timerSeconds(app);
    await expect.poll(() => timerSeconds(app)).toBeGreaterThan(first);
    await app.page.waitForTimeout(600);
    await app.page.mouse.up();

    await expect(app.holdButton).toHaveText("ENCODING");
    await expect(encodeProgress(app)).toBeVisible();
    await expect(waveformCanvas(app)).toBeHidden();
    await expect(app.page.getByText(HINT)).toBeVisible();
    await expect(app.codecStatus).toHaveText(/^(Encoding \(12\.5hz\)|Compressing|Packing)\.\.\.$/);

    // The button comes back whatever happened; a rejected or failed take would leave its message in the status line.
    await expect(app.holdButton).toHaveText("HOLD", { timeout: 15_000 });
    expect(await app.codecStatus.allInnerTexts(), "codec card status after the release").toEqual([]);
    await expect(app.qrImage).toBeVisible();
    await expect(app.holdButton).toBeEnabled();
    await expect(encodeProgress(app)).toBeHidden();
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");

    const meta = await resultMeta(app);
    expect(meta.bytes).toBe(1 + meta.tokens * 2);
    expect(meta.seconds).toBeGreaterThan(0.5);
    expect(meta.seconds).toBeLessThan(2);
    const { runs } = await app.ortState();
    expect(runs.map((r) => r.model)).toEqual(["encoder.onnx", "compressor_12_5hz.onnx"]);
  });

  test("the encoding status names the quality the way the rest of the app does", async ({ app }) => {
    await armedRecorder(app);
    await app.setOrt({ delayMs: 1500 }); // the encoder run keeps the "Encoding" line up for 1.5 s
    await app.hold(700);
    await expect(app.holdButton).toHaveText("ENCODING");
    await expect(app.codecStatus).toHaveText(`Encoding (${LABEL["12_5hz"]})...`, { timeout: 3_000 });
    await expect(app.qrImage).toBeVisible({ timeout: 15_000 });
  });

  test("a short press is rejected as too short, HOLD re-arms, and the next take is unaffected", async ({ app }) => {
    await armedRecorder(app);
    // 120 ms: well past the worklet setup (a release inside it is the race the
    // test.fail() below covers) and well under the 4096-sample minimum.
    await pressHold(app);
    await app.page.waitForTimeout(120);
    await app.page.mouse.up();
    await expect(app.codecStatus).toHaveText(TOO_SHORT);
    await expect(app.codecStatus).toHaveClass(/--red/);
    await expect(app.holdButton).toHaveText("HOLD");
    await expect(app.holdButton).toBeEnabled();
    await expect(waveformCanvas(app)).toBeHidden();
    await expect(app.qrImage).toHaveCount(0);
    await expect(app.resultPlaceholder).toBeVisible();
    expect((await app.ortState()).runs).toEqual([]);

    // A rejected take leaves nothing behind: the next one reports its own length.
    await disableTrim(app);
    await app.record(1000);
    await expect(app.codecStatus).toHaveCount(0);
    const { seconds } = await resultMeta(app);
    expect(seconds).toBeGreaterThan(0.7);
    expect(seconds).toBeLessThan(1.4);
  });

  test("a release that beat the worklet setup leaves no timer running and the next take reports its own length", async ({ app }) => {
    await armedRecorder(app);
    await instantTap(app);
    await expect(app.codecStatus).toHaveText(TOO_SHORT);
    await expect(app.holdButton).toBeEnabled();

    // Idle recorder: the (hidden) timer must not move.
    const before = await app.recordingTimer.textContent();
    await app.page.waitForTimeout(500);
    expect(await app.recordingTimer.textContent()).toBe(before);

    await disableTrim(app);
    await app.record(1000);
    const { seconds } = await resultMeta(app);
    expect(Math.abs(seconds - 1)).toBeLessThanOrEqual(0.3);
  });

  test("pressing HOLD while a recording is being encoded does not start another one", async ({ app }) => {
    await armedRecorder(app);
    await app.setOrt({ delayMs: 2000 }); // two runs → a 4 s ENCODING window for the press below
    await app.hold(700);
    await expect(app.holdButton).toHaveText("ENCODING");

    await pressHold(app);
    await app.page.waitForTimeout(150); // a wrongly accepted press flips the button within a frame
    await expect(app.holdButton).toHaveText("ENCODING", { timeout: 2_000 });
    await expect(app.recordingTimer).toBeHidden();
    await expect(app.codecStatus).toHaveText(/^(Encoding|Compressing|Packing)/);
    // With the press ignored this release is a no-op; the QR below is the first take's.
    await app.page.mouse.up();
    await expect(app.qrImage).toBeVisible({ timeout: 15_000 });
    await expect(app.holdButton).toHaveText("HOLD");
    expect((await app.ortState()).runs.map((r) => r.model)).toEqual(["encoder.onnx", "compressor_12_5hz.onnx"]);
  });
});

test.describe("trim toggle", () => {
  test("defaults on, persists off across a reload, and persists on again", async ({ app }) => {
    await app.goto();
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "true");

    await disableTrim(app);
    await reload(app);
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "false");

    await app.trimSwitch.click();
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "true");
    await reload(app);
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "true");
  });
});
