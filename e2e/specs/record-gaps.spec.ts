/**
 * Record-side gaps: the encode status wording, status colour plumbing after
 * a quality change, "← New recording" after the cache was wiped, the quality
 * picker during a load, a microphone lost between holds (recDown), ending a
 * hold by dragging off the button, encoder failures, and the record tab's
 * own download dialog (its Cancel footer and the multi-select footer
 * variants once qualities are cached).
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../support/test";
import type { Ethos, QrApp } from "../support/app";
import { ALL_QUALITIES, LABEL, type Quality } from "../support/packets";

const TOO_SHORT = "Too short — hold longer";
const NOT_CACHED = "↓";

function modelsFor(q: Quality): string[] {
  return [`compressor_${q}.onnx`, `decoder_${q}.onnx`];
}

/** The <label> wrapping a quality radio (the radio itself is sr-only, so clicks go here). */
function qualityOption(app: QrApp, q: Quality): Locator {
  return app.page.locator("label", { has: app.qualityRadio(q) });
}

async function pick(app: QrApp, q: Quality): Promise<void> {
  await qualityOption(app, q).click();
  await expect(app.qualityRadio(q)).toHaveAttribute("aria-checked", "true");
}

/** The green "<quality> loaded" line the codec card shows once models are in memory. */
function loadedLine(app: QrApp): Locator {
  return app.codecCard.locator("span.text-\\[var\\(--green\\)\\]");
}

/** The codec card's own progress bar (model download, or a running encode). */
function cardProgress(app: QrApp): Locator {
  return app.codecCard.getByRole("progressbar");
}

/** The encode progress bar under the HOLD button. */
function encodeProgress(app: QrApp): Locator {
  return app.holdButton.locator("..").getByRole("progressbar");
}

/** The encoder.onnx row at the top of the download dialog. */
function encoderRow(app: QrApp): Locator {
  return app.downloadDialog
    .getByText("encoder.onnx", { exact: true })
    .locator("xpath=ancestor::*[contains(@class,'rounded-md')][1]");
}

/** Footer buttons only — the dialog's X also carries an sr-only "Close". */
function footerButton(app: QrApp, name: string): Locator {
  return app.downloadDialog.locator('[data-slot="dialog-footer"]').getByRole("button", { name, exact: true });
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

/** Press the HOLD button without releasing it; returns its bounding box. */
async function pressHold(app: QrApp): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await app.holdButton.boundingBox();
  if (!box) throw new Error("HOLD button is not on screen");
  await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.page.mouse.down();
  return box;
}

/**
 * pointerdown and pointerup in the same task, so recUp runs while recDown is
 * still awaiting the worklet setup and the hold is rejected as too short.
 */
async function instantTap(app: QrApp): Promise<void> {
  await app.holdButton.evaluate((el) => {
    const init = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", init));
    el.dispatchEvent(new PointerEvent("pointerup", init));
  });
}

/** 12.5hz downloaded through the card and the mic armed. Split-deck keeps the card beside the result. */
async function armedRecorder(app: QrApp, ethos: Ethos = "split-deck"): Promise<void> {
  await app.presetEthos(ethos);
  await app.goto();
  await downloadFromCard(app, "12_5hz");
  await enableMic(app);
}

/** Download 12.5hz + 25hz together from the card's dialog, then reload so both are merely cached. */
async function cacheTwoQualities(app: QrApp): Promise<void> {
  await app.goto();
  await app.codecButton.click();
  await expect(app.downloadDialog).toBeVisible();
  const go = await app.selectMultiple(["12_5hz", "25hz"]);
  await go.click();
  await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
  await expect(loadedLine(app)).toHaveText("12.5hz loaded");
  await reload(app);
  await expect(app.codecButton).toHaveText("Load cached models");
}

interface MicProbeWindow {
  __streams: MediaStream[];
  __micReject: string | null;
}

/**
 * Must run before `goto`. Records every stream getUserMedia hands out on
 * `window.__streams`, and once `window.__micReject` holds a message every
 * further getUserMedia call rejects with it (a revoked permission, a device
 * that went away).
 */
async function installMicProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as MicProbeWindow;
    w.__streams = [];
    w.__micReject = null;
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      if (w.__micReject) throw new DOMException(w.__micReject, "NotAllowedError");
      const stream = await original(constraints);
      w.__streams.push(stream);
      return stream;
    };
  });
}

/** End every live mic track and make the next getUserMedia reject with `message`. */
async function revokeMic(page: Page, message: string): Promise<void> {
  await page.evaluate((msg) => {
    const w = window as unknown as MicProbeWindow;
    for (const stream of w.__streams) for (const track of stream.getTracks()) track.stop();
    w.__micReject = msg;
  }, message);
}

// ── Encode status wording ───────────────────────────────────────

test.describe("encode status", () => {
  test("the encode step names the quality the way the rest of the card does", async ({ app }) => {
    await armedRecorder(app);
    await app.setOrt({ delayMs: 1500 }); // the encoder run holds the first status for 1.5 s
    await app.hold(800);
    await expect(app.holdButton).toHaveText("ENCODING");
    await expect(app.codecStatus).toHaveText(/^Encoding \(.+\)\.\.\.$/);
    expect(await app.codecStatus.textContent()).toBe("Encoding (12.5hz)...");
    await expect(app.qrImage).toBeVisible({ timeout: 15_000 });
  });
});

// ── Status colour after a quality change ────────────────────────

test.describe("status colour after a quality change", () => {
  test("an informational cache line written after a red 'Too short' is not red", async ({ app }) => {
    await app.goto();
    await downloadFromCard(app, "12_5hz");
    await reload(app);
    await expect(app.codecButton).toHaveText("Load cached models");
    await app.codecButton.click(); // loads from IndexedDB and arms the mic in the same click
    await expect(app.holdButton).toBeEnabled({ timeout: 15_000 });

    await instantTap(app);
    await expect(app.codecStatus).toHaveText(TOO_SHORT);
    await expect(app.codecStatus).toHaveClass(/--red/);

    await pick(app, "25hz");
    await expect(app.codecStatus).toHaveText("25hz compressor needs download");
    await expect(app.holdButton).toBeDisabled();
    await expect(app.codecStatus).not.toHaveClass(/--red/);
  });
});

// ── "← New recording" after the cache was wiped ─────────────────

test.describe("← New recording after the models were deleted", () => {
  test("does not claim the deleted quality is still loaded", async ({ app }) => {
    await armedRecorder(app, "stage-swap");
    await app.record(800);
    await expect(app.newRecordingButton).toBeVisible();

    await app.deleteModelsViaSettings();
    await expect(app.newRecordingButton).toBeVisible(); // the result stage is still up
    await app.newRecordingButton.click();

    await expect(app.qrImage).toBeHidden();
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.holdButton).toBeDisabled();
    await expect(loadedLine(app)).toHaveCount(0);
    await expect(app.codecCard).not.toContainText("loaded");
  });
});

// ── Quality picker while models load ────────────────────────────

test.describe("quality picker while models load", () => {
  test("the radios are disabled while the card says Loading models...", async ({ app }) => {
    await app.goto();
    await downloadFromCard(app, "12_5hz");
    await reload(app);
    await expect(app.codecButton).toHaveText("Load cached models");

    await app.setOrt({ createDelayMs: 2000 }); // each InferenceSession.create takes 2 s
    await app.codecButton.click();
    await expect(app.codecButton).toHaveText("Loading models...");
    await expect(app.codecButton).toBeDisabled();
    for (const q of ALL_QUALITIES) await expect(app.qualityRadio(q)).toBeDisabled();

    // Once the load has settled the picker is usable again and 12.5hz can record.
    await expect(app.holdButton).toBeEnabled({ timeout: 15_000 });
    for (const q of ALL_QUALITIES) await expect(app.qualityRadio(q)).toBeEnabled();
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
  });
});

// ── Microphone lost between holds ───────────────────────────────

test.describe("microphone lost between holds", () => {
  // The unguarded rejection inside recDown reaches the page as an uncaught
  // error; relax the fixture so the UI after it can be inspected.
  test.use({ strictPageErrors: false });

  test("a failed mic re-acquisition is reported in red and the recorder returns to idle", async ({ app, page, pageErrors }) => {
    await installMicProbe(page);
    await armedRecorder(app);
    await revokeMic(page, "E2E: microphone revoked");

    await app.hold(600);
    await expect(app.codecStatus).toContainText("E2E: microphone revoked");
    await expect(app.codecStatus).toHaveClass(/--red/);
    await expect(app.holdButton).toHaveText("HOLD");
    await expect(app.holdButton).toBeEnabled();
    await expect(app.recordingTimer).toBeHidden();
    expect(pageErrors).toEqual([]);
  });
});

// ── Ending a hold by leaving the button ─────────────────────────

test.describe("ending a hold", () => {
  test("dragging the pointer off HOLD ends the recording and encodes it without a release", async ({ app }) => {
    await armedRecorder(app);
    await app.setOrt({ delayMs: 400 }); // two runs → ENCODING stays up for ~0.8 s
    const box = await pressHold(app);
    await expect(app.codecStatus).toHaveText("Recording...");
    await expect(app.recordingTimer).toBeVisible();
    await app.page.waitForTimeout(700);
    await app.page.mouse.move(box.x + box.width + 60, box.y + box.height / 2, { steps: 4 });

    await expect(app.holdButton).toHaveText("ENCODING");
    await expect(app.recordingTimer).toBeHidden();
    await expect(app.qrImage).toBeVisible({ timeout: 15_000 });
    await expect(app.holdButton).toHaveText("HOLD");
    await expect(app.holdButton).toBeEnabled();
    expect((await app.ortState()).runs.map((r) => r.model)).toEqual(["encoder.onnx", "compressor_12_5hz.onnx"]);

    // Releasing the button somewhere else afterwards changes nothing.
    await app.page.mouse.up();
    await expect(app.holdButton).toHaveText("HOLD");
    await expect(app.qrImage).toBeVisible();
    await expect(app.recordingTimer).toBeHidden();
  });
});

// ── Encoder failure ─────────────────────────────────────────────

test.describe("encode failure", () => {
  test("an encoder failure is shown in red, HOLD re-arms, nothing is produced, and the next hold succeeds", async ({ app }) => {
    await armedRecorder(app);
    await app.setOrt({ failRun: "encoder", failMessage: "encoder exploded" });
    await app.hold(800);

    await expect(app.codecStatus).toHaveText("encoder exploded");
    await expect(app.codecStatus).toHaveClass(/--red/);
    await expect(app.holdButton).toHaveText("HOLD");
    await expect(app.holdButton).toBeEnabled();
    await expect(encodeProgress(app)).toBeHidden();
    await expect(app.qrImage).toHaveCount(0);
    await expect(app.resultPlaceholder).toBeVisible();
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    expect((await app.ortState()).runs.map((r) => r.model)).toEqual(["encoder.onnx"]);

    await app.setOrt({ failRun: null });
    await app.record(800);
    await expect(app.codecStatus).toHaveCount(0);
    expect((await app.ortState()).runs.map((r) => r.model)).toEqual([
      "encoder.onnx",
      "encoder.onnx",
      "compressor_12_5hz.onnx",
    ]);
  });

  test("the codec card's encode progress bar goes away after a failed encode", async ({ app }) => {
    await armedRecorder(app);
    await app.setOrt({ failRun: "encoder", failMessage: "encoder exploded" });
    await app.hold(800);
    await expect(app.codecStatus).toHaveText("encoder exploded");
    await expect(app.holdButton).toBeEnabled();
    await expect(cardProgress(app)).toBeHidden();
  });
});

// ── The record tab's own download dialog ────────────────────────

test.describe("the record tab's download dialog", () => {
  test("Cancel download in the footer returns the dialog to its idle footer and the card to Choose models", async ({ app, models }) => {
    await app.goto();
    models.set("*", { hang: true });
    await app.codecButton.click();
    await expect(app.downloadDialog).toBeVisible();
    await app.startDialogDownload(["12_5hz"]);
    await expect.poll(() => models.hungCount).toBe(3);
    const cancel = footerButton(app, "Cancel download");
    await expect(cancel).toBeVisible();
    await expect(app.downloadDialog.getByRole("progressbar")).toBeVisible();
    await expect(footerButton(app, "Close")).toHaveCount(0);

    await cancel.click();
    await expect(app.downloadDialog).toBeVisible();
    await expect(cancel).toBeHidden();
    await expect(footerButton(app, "Close")).toBeVisible();
    await expect(app.downloadDialog.getByRole("progressbar")).toHaveCount(0);
    const row = app.dialogRow("12_5hz").getByRole("button");
    await expect(row).toHaveText("Download (~812 MB)");
    await expect(row).toBeEnabled();
    await expect(app.dialogRow("12_5hz").getByText("cached", { exact: true })).toHaveCount(0);

    await footerButton(app, "Close").click();
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecButton).toBeEnabled();
    await expect(app.codecCancelButton).toBeHidden();
    await expect(cardProgress(app)).toBeHidden();
    await expect(app.codecStatus).toHaveCount(0);
    await expect(app.holdButton).toBeDisabled();
    await expect(qualityOption(app, "12_5hz")).toContainText(NOT_CACHED);
    expect(models.requests.length).toBe(3);
    expect((await app.ortState()).sessions).toEqual([]);

    // The same dialog can start over from scratch.
    models.reset();
    await downloadFromCard(app, "12_5hz");
    await expect(app.codecButton).toHaveText("Enable microphone");
    expect(models.requests.length).toBe(6);
  });

  test("multi-select with nothing checked offers a disabled 'Select a quality'", async ({ app, models }) => {
    await cacheTwoQualities(app);
    // The card loads a cached quality directly, so the dialog is reached through one that is not.
    await pick(app, "50hz");
    await expect(app.codecButton).toHaveText("Choose models");
    await app.codecButton.click();
    await expect(app.downloadDialog).toBeVisible();

    const go = await app.selectMultiple([]);
    await expect(app.dialogRow("50hz").getByRole("checkbox")).toBeChecked();
    await expect(go).toHaveText("Download selected (~205 MB)");

    await app.dialogRow("50hz").getByRole("checkbox").uncheck();
    for (const q of ALL_QUALITIES) await expect(app.dialogRow(q).getByRole("checkbox")).not.toBeChecked();
    await expect(go).toHaveText("Select a quality");
    await expect(go).toBeDisabled();
    await expect(footerButton(app, "Close")).toBeEnabled();

    await footerButton(app, "Close").click();
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.codecButton).toHaveText("Choose models");
    expect(models.requests.length).toBe(5);
  });

  test("checking both cached qualities offers 'Load selected from cache', which loads them without the network", async ({ app, models }) => {
    await cacheTwoQualities(app);
    await pick(app, "50hz");
    await app.codecButton.click();
    await expect(app.downloadDialog).toBeVisible();

    const go = await app.selectMultiple(["12_5hz", "25hz"]);
    await app.dialogRow("50hz").getByRole("checkbox").uncheck();
    await expect(encoderRow(app).getByText("cached", { exact: true })).toBeVisible();
    // Badge and price column both read "cached" for the two cached pairs.
    await expect(app.dialogRow("12_5hz").getByText("cached", { exact: true })).toHaveCount(2);
    await expect(app.dialogRow("25hz").getByText("cached", { exact: true })).toHaveCount(2);
    await expect(app.dialogRow("50hz")).toContainText("~205 MB");
    await expect(go).toHaveText("Load selected from cache");
    await expect(go).toBeEnabled();

    await go.click();
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    expect(models.requests.length).toBe(5);
    expect((await app.ortState()).sessions.sort()).toEqual(
      ["encoder.onnx", ...modelsFor("12_5hz"), ...modelsFor("25hz")].sort(),
    );

    // 50hz is still picked, so the card keeps asking for it; the two cached qualities are ready.
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.holdButton).toBeDisabled();
    await pick(app, "25hz");
    await expect(loadedLine(app)).toHaveText("25hz loaded");
    await expect(app.codecButton).toHaveText("Enable microphone");
    await pick(app, "12_5hz");
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    await expect(app.codecButton).toHaveText("Enable microphone");
  });
});
