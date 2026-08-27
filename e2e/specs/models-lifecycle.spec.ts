/**
 * Model lifecycle as driven from the QR page's Settings sheet and the
 * "Download models" dialog: the untouched state, single- and multi-select
 * downloads, the loading / cancel / failure branches, cache deletion (whole
 * and per file), what survives a reload, and what carries over between the
 * PTT and QR pages.
 */
import type { Locator } from "@playwright/test";
import { expect, test } from "../support/test";
import type { QrApp } from "../support/app";
import { MODEL_NAMES } from "../support/model-server";
import { ALL_QUALITIES, type Quality } from "../support/packets";

const ENCODER_MB = 595;
/** compressor + decoder per quality, from MODEL_SIZE_ESTIMATES_MB. */
const PAIR_MB: Record<Quality, number> = { "12_5hz": 217, "25hz": 213, "50hz": 205 };
const DESCRIPTION: Record<Quality, string> = {
  "12_5hz": "tiny QR · 25 B/s + header",
  "25hz": "balanced · 50 B/s + header",
  "50hz": "best quality · 100 B/s + header",
};
const GROUP: Record<Quality, string> = {
  "12_5hz": "12.5hz — smallest",
  "25hz": "25hz — balanced",
  "50hz": "50hz — best quality",
};

function pairFor(q: Quality): string[] {
  return [`compressor_${q}.onnx`, `decoder_${q}.onnx`];
}

function fullSet(...qs: Quality[]): string[] {
  return ["encoder.onnx", ...qs.flatMap(pairFor)].sort();
}

// ── Locators the page object does not have ──────────────────────

/** The status dot to the left of the Settings › Models status text. */
function codecDot(app: QrApp): Locator {
  return app.settingsCodecStatus.locator("xpath=preceding-sibling::div[1]");
}

/**
 * The same status line read while the download dialog is on top of the
 * sheet: the modal aria-hides the sheet, so the role-based `settingsSheet`
 * stops matching although the text is still on screen behind the overlay.
 */
function statusBehindDialog(app: QrApp): Locator {
  return app.page.locator('[data-slot="sheet-content"] span.font-mono').first();
}

function sheetButton(app: QrApp, name: string): Locator {
  return app.settingsSheet.getByRole("button", { name, exact: true });
}

/** The Codec section's "Delete downloaded models" (two-step confirm). */
function deleteButton(app: QrApp): Locator {
  return sheetButton(app, "Delete downloaded models").first();
}

/** ModelManagement's own "Delete downloaded models" (disabled while nothing is cached). */
function inventoryDeleteButton(app: QrApp): Locator {
  return sheetButton(app, "Delete downloaded models").last();
}

function rowButton(app: QrApp, q: Quality): Locator {
  return app.dialogRow(q).getByRole("button");
}

function encoderRow(app: QrApp): Locator {
  return app.downloadDialog
    .getByText("encoder.onnx", { exact: true })
    .locator("xpath=ancestor::*[contains(@class,'rounded-md')][1]");
}

/** Footer buttons only — the dialog's X also carries an sr-only "Close". */
function footerButton(app: QrApp, name: string): Locator {
  return app.downloadDialog.locator('[data-slot="dialog-footer"]').getByRole("button", { name, exact: true });
}

function multiSelectButton(app: QrApp): Locator {
  return app.downloadDialog.getByRole("button", { name: "Select multiple qualities" });
}

function footerAction(app: QrApp): Locator {
  return app.downloadDialog.getByRole("button", {
    name: /^(Download selected \(~\d+ MB\)|Load selected from cache|Select a quality)$/,
  });
}

/** One file row in Settings › Models › ModelManagement. */
function fileRow(app: QrApp, name: string): Locator {
  return app.settingsSheet
    .getByText(name, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
}

/** The "<group label> [ready]" header line of a ModelManagement group. */
function groupHeader(app: QrApp, label: string): Locator {
  return app.settingsSheet.getByText(label, { exact: true }).locator("..");
}

function totalCached(app: QrApp): Locator {
  return app.settingsSheet.getByText(/^(Total cached: ~\d+ MB|Checking\.\.\.)$/);
}

/**
 * The PTT codec block's quality buttons ("25hz ↓" until loaded, then "25hz").
 * The one PTT would encode with is the bold one; the buttons carry no
 * aria-pressed, so the class is the only signal.
 */
function pttQualityButtons(app: QrApp): Locator {
  return app.page.getByTitle(/^(Encode with|Download & use) /);
}

function pttHighlightedQuality(app: QrApp): Locator {
  return pttQualityButtons(app).and(app.page.locator(".font-semibold"));
}

/** The radio input is sr-only under its label text, so click the label. */
async function pickQuality(app: QrApp, q: Quality): Promise<void> {
  await app.qualityRadio(q).locator("xpath=..").click();
  await expect(app.qualityRadio(q)).toHaveAttribute("aria-checked", "true");
}

async function openDialogViaSettings(app: QrApp): Promise<void> {
  await app.openSettings("Models");
  await app.settingsCodecButton.click();
  await expect(app.downloadDialog).toBeVisible();
}

test.describe("Settings › Models before anything is downloaded", () => {
  test("reports Not loaded with a grey dot, Choose models, and an all-empty inventory", async ({ app, models }) => {
    await app.goto();
    await app.openSettings("Models");

    await expect(app.settingsCodecStatus).toHaveText("Not loaded");
    await expect(codecDot(app)).toHaveClass(/--surface2/);
    await expect(codecDot(app)).not.toHaveClass(/--green/);
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(app.settingsCodecButton).toBeEnabled();
    await expect(app.settingsSheet.getByRole("progressbar")).toHaveCount(0);
    await expect(sheetButton(app, "Cancel")).toHaveCount(0);
    // The Codec section's delete is always armed; the inventory's is gated on the cache.
    await expect(deleteButton(app)).toBeEnabled();
    await expect(inventoryDeleteButton(app)).toBeDisabled();

    await expect(app.settingsSheet.getByText("Shared encoder", { exact: true })).toBeVisible();
    for (const q of ALL_QUALITIES) {
      await expect(app.settingsSheet.getByText(GROUP[q], { exact: true })).toBeVisible();
    }
    for (const name of MODEL_NAMES) {
      await expect(fileRow(app, name)).toBeVisible();
    }
    await expect(app.settingsSheet.getByText("not cached", { exact: true })).toHaveCount(MODEL_NAMES.length);
    await expect(app.settingsSheet.getByText("ready", { exact: true })).toHaveCount(0);
    await expect(app.settingsSheet.getByRole("button", { name: /^Delete .+\.onnx$/ })).toHaveCount(0);
    await expect(totalCached(app)).toHaveText("Total cached: ~0 MB");
    expect(models.requests).toEqual([]);
  });
});

test.describe("download dialog — single select", () => {
  test("lists every quality with its description and full-package price", async ({ app, models }) => {
    await app.goto();
    await openDialogViaSettings(app);

    await expect(app.downloadDialog.getByText("Start with one quality. The shared encoder is included with your first download.")).toBeVisible();
    await expect(encoderRow(app).getByText("Shared recording model")).toBeVisible();
    await expect(encoderRow(app).getByText("595 MB", { exact: true })).toBeVisible();
    await expect(app.downloadDialog.getByText("cached", { exact: true })).toHaveCount(0);
    await expect(app.downloadDialog.getByText("loaded", { exact: true })).toHaveCount(0);

    for (const q of ALL_QUALITIES) {
      await expect(app.dialogRow(q).getByText(DESCRIPTION[q], { exact: true })).toBeVisible();
      await expect(rowButton(app, q)).toHaveText(`Download (~${ENCODER_MB + PAIR_MB[q]} MB)`);
      await expect(rowButton(app, q)).toBeEnabled();
      // Opened from Settings the dialog has no default, so nothing is "suggested".
      await expect(app.dialogRow(q).getByText("suggested", { exact: true })).toHaveCount(0);
    }
    await expect(multiSelectButton(app)).toBeVisible();
    await expect(app.downloadDialog.getByRole("checkbox")).toHaveCount(0);
    await expect(footerButton(app, "Close")).toBeVisible();
    await expect(footerAction(app)).toHaveCount(0);

    await footerButton(app, "Close").click();
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.settingsSheet).toBeVisible();
    expect(models.requests).toEqual([]);
  });

  test("opened from the record card, the picked quality is marked suggested", async ({ app }) => {
    await app.goto();
    await pickQuality(app, "25hz");
    await app.codecButton.click();
    await expect(app.downloadDialog).toBeVisible();

    await expect(app.dialogRow("25hz").getByText("suggested", { exact: true })).toBeVisible();
    await expect(app.dialogRow("12_5hz").getByText("suggested", { exact: true })).toHaveCount(0);
    await expect(app.dialogRow("50hz").getByText("suggested", { exact: true })).toHaveCount(0);
    await expect(rowButton(app, "25hz")).toHaveText("Download (~669 MB)");
  });

  test("after one download the encoder is cached, that row is locked and the others shrink", async ({ app, models }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    expect([...models.requests].sort()).toEqual(fullSet("12_5hz"));
    await openDialogViaSettings(app);

    await expect(encoderRow(app).getByText("cached", { exact: true })).toBeVisible();
    await expect(app.dialogRow("12_5hz").getByText("loaded", { exact: true })).toBeVisible();
    await expect(app.dialogRow("12_5hz").getByText("cached", { exact: true })).toHaveCount(0);
    await expect(rowButton(app, "12_5hz")).toHaveText("Loaded");
    await expect(rowButton(app, "12_5hz")).toBeDisabled();
    await expect(rowButton(app, "25hz")).toHaveText(`Download (~${PAIR_MB["25hz"]} MB)`);
    await expect(rowButton(app, "50hz")).toHaveText(`Download (~${PAIR_MB["50hz"]} MB)`);

    // A second single download fetches only the new pair.
    await rowButton(app, "25hz").click();
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    // NOTE: current behaviour — CodecContext.loadModels builds the status
    // from the qualities just requested, not from loadedQualities, so the
    // sheet says "25hz loaded" while 12.5hz is still loaded (and the dialog
    // marks both rows "Loaded"). Whether it should name every loaded
    // quality is open.
    await expect(app.settingsCodecStatus).toHaveText("25hz loaded");
    await expect(app.settingsCodecButton).toHaveText("Change models");
    expect(models.requests.slice(3).sort()).toEqual(pairFor("25hz").sort());
    expect((await app.ortState()).sessions.sort()).toEqual(fullSet("12_5hz", "25hz"));

    await app.settingsCodecButton.click();
    await expect(rowButton(app, "12_5hz")).toHaveText("Loaded");
    await expect(rowButton(app, "25hz")).toHaveText("Loaded");
    await expect(rowButton(app, "50hz")).toHaveText(`Download (~${PAIR_MB["50hz"]} MB)`);
  });
});

test.describe("download dialog — multi select", () => {
  test("checkboxes sum the package price and the footer stays disabled until something is picked", async ({ app, models }) => {
    await app.goto();
    await openDialogViaSettings(app);
    await multiSelectButton(app).click();

    await expect(footerAction(app)).toHaveText("Select a quality");
    await expect(footerAction(app)).toBeDisabled();
    await expect(multiSelectButton(app)).toHaveCount(0);
    for (const q of ALL_QUALITIES) {
      const box = app.dialogRow(q).getByRole("checkbox");
      await expect(box).toBeEnabled();
      await expect(box).not.toBeChecked();
      await expect(app.dialogRow(q).getByText(`~${ENCODER_MB + PAIR_MB[q]} MB`, { exact: true })).toBeVisible();
      await expect(app.dialogRow(q).getByText(DESCRIPTION[q], { exact: true })).toBeVisible();
    }

    await app.dialogRow("12_5hz").getByRole("checkbox").check();
    await expect(footerAction(app)).toHaveText("Download selected (~812 MB)");
    await expect(footerAction(app)).toBeEnabled();
    await app.dialogRow("25hz").getByRole("checkbox").check();
    await expect(footerAction(app)).toHaveText("Download selected (~1025 MB)");
    await app.dialogRow("50hz").getByRole("checkbox").check();
    await expect(footerAction(app)).toHaveText("Download selected (~1230 MB)");
    // The encoder is counted once no matter how many pairs are picked.
    await app.dialogRow("12_5hz").getByRole("checkbox").uncheck();
    await expect(footerAction(app)).toHaveText("Download selected (~1013 MB)");
    await app.dialogRow("25hz").getByRole("checkbox").uncheck();
    await app.dialogRow("50hz").getByRole("checkbox").uncheck();
    await expect(footerAction(app)).toHaveText("Select a quality");
    await expect(footerAction(app)).toBeDisabled();

    await footerButton(app, "Close").click();
    await expect(app.downloadDialog).toBeHidden();
    expect(models.requests).toEqual([]);
  });

  test("a loaded quality is locked out of the selection and only the new pairs are fetched", async ({ app, models }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    await openDialogViaSettings(app);
    const go = await app.selectMultiple(["25hz", "50hz"]);

    const loadedBox = app.dialogRow("12_5hz").getByRole("checkbox");
    await expect(loadedBox).toBeDisabled();
    await expect(loadedBox).not.toBeChecked();
    await expect(app.dialogRow("12_5hz").getByText("loaded", { exact: true })).toBeVisible();
    await expect(app.dialogRow("12_5hz").getByText("ready", { exact: true })).toBeVisible();
    await expect(app.dialogRow("25hz").getByText(`~${PAIR_MB["25hz"]} MB`, { exact: true })).toBeVisible();
    await expect(app.dialogRow("50hz").getByText(`~${PAIR_MB["50hz"]} MB`, { exact: true })).toBeVisible();
    await expect(go).toHaveText("Download selected (~418 MB)");

    await go.click();
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    // NOTE: current behaviour — the status names the qualities just
    // requested, not everything loaded (12.5hz is loaded too); see the
    // single-select test above.
    await expect(app.settingsCodecStatus).toHaveText("25hz, 50hz loaded");
    expect(models.requests.slice(3).sort()).toEqual([...pairFor("25hz"), ...pairFor("50hz")].sort());
    expect((await app.ortState()).sessions.sort()).toEqual(fullSet("12_5hz", "25hz", "50hz"));
  });
});

test.describe("while models are loading", () => {
  test("the dialog and the sheet both show progress and a way to cancel; completion names every quality", async ({ app, models }) => {
    await app.goto();
    // Park every fetch: "Loading models..." then holds for as long as the checks take.
    models.set("*", { hang: true });
    await openDialogViaSettings(app);
    const go = await app.selectMultiple(["12_5hz", "25hz"]);
    await expect(go).toHaveText("Download selected (~1025 MB)");
    await go.click();

    // Dialog first: while it is open the modal aria-hides the sheet beneath it.
    await expect(footerButton(app, "Cancel download")).toBeVisible();
    await expect(footerButton(app, "Close")).toHaveCount(0);
    await expect(footerAction(app)).toHaveCount(0);
    await expect(app.downloadDialog.getByRole("progressbar")).toBeVisible();
    await expect(app.downloadDialog.getByText("Loading models...", { exact: true })).toBeVisible();
    for (const q of ALL_QUALITIES) {
      await expect(app.dialogRow(q).getByRole("checkbox")).toBeDisabled();
    }

    // Closing the dialog does not stop the download; the sheet carries on reporting it.
    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.settingsCodecStatus).toHaveText("Loading models...");
    await expect(app.settingsSheet.getByRole("progressbar")).toBeVisible();
    await expect(app.settingsCodecButton).toHaveText("Loading models...");
    await expect(app.settingsCodecButton).toBeDisabled();
    await expect(sheetButton(app, "Cancel")).toBeVisible();
    // NOTE: current behaviour — SettingsSheet colours the dot from
    // modelsLoaded alone, so "loading" is the same grey as idle;
    // CodecStatus.tsx defines per-state colours but nothing renders it.
    await expect(codecDot(app)).toHaveClass(/--surface2/);

    await expect.poll(() => models.hungCount).toBe(5);
    models.release();
    await expect(app.settingsCodecStatus).toHaveText("12.5hz, 25hz loaded", { timeout: 20_000 });
    await expect(app.settingsCodecButton).toHaveText("Change models");
    await expect(app.settingsCodecButton).toBeEnabled();
    await expect(codecDot(app)).toHaveClass(/--green/);
    await expect(app.settingsSheet.getByRole("progressbar")).toHaveCount(0);
    await expect(sheetButton(app, "Cancel")).toHaveCount(0);
    expect([...models.requests].sort()).toEqual(fullSet("12_5hz", "25hz"));
    expect((await app.ortState()).sessions.sort()).toEqual(fullSet("12_5hz", "25hz"));
  });

  test("the inventory in the same sheet picks up a download made from its dialog", async ({ app }) => {
    await app.goto();
    await app.openSettings("Models");
    await expect(totalCached(app)).toHaveText("Total cached: ~0 MB");
    await app.settingsCodecButton.click();
    await app.startDialogDownload(["12_5hz"]);
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");

    await expect(totalCached(app)).toHaveText("Total cached: ~812 MB");
    await expect(groupHeader(app, "Shared encoder").getByText("ready", { exact: true })).toBeVisible();
    await expect(fileRow(app, "encoder.onnx").getByText("cached", { exact: true })).toBeVisible();
    await expect(inventoryDeleteButton(app)).toBeEnabled();
  });
});

test.describe("cancelling a download", () => {
  test("Cancel download in the dialog aborts, reports Cancelled and leaves the dialog open for another go", async ({ app, models }) => {
    await app.goto();
    models.set("*", { hang: true });
    await openDialogViaSettings(app);
    await app.startDialogDownload(["12_5hz"]);
    await expect(footerButton(app, "Cancel download")).toBeVisible();
    await expect.poll(() => models.hungCount).toBe(3);
    for (const q of ALL_QUALITIES) await expect(rowButton(app, q)).toBeDisabled();

    await footerButton(app, "Cancel download").click();
    await expect(app.downloadDialog).toBeVisible();
    await expect(footerButton(app, "Close")).toBeVisible();
    await expect(app.downloadDialog.getByRole("progressbar")).toHaveCount(0);
    await expect(rowButton(app, "12_5hz")).toHaveText("Download (~812 MB)");
    await expect(rowButton(app, "12_5hz")).toBeEnabled();

    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.settingsCodecStatus).toHaveText("Cancelled");
    await expect(codecDot(app)).toHaveClass(/--surface2/);
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(app.settingsCodecButton).toBeEnabled();
    await expect(sheetButton(app, "Cancel")).toHaveCount(0);
    await expect(app.settingsSheet.getByRole("progressbar")).toHaveCount(0);
    // Nothing retried on its own: the three aborted fetches are all the server saw.
    expect(models.requests.length).toBe(3);
    expect((await app.ortState()).sessions).toEqual([]);

    // A fresh attempt starts over from the network.
    models.reset();
    await app.settingsCodecButton.click();
    await app.startDialogDownload(["12_5hz"]);
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");
    await expect(codecDot(app)).toHaveClass(/--green/);
    expect(models.requests.length).toBe(6);
    expect((await app.ortState()).sessions.sort()).toEqual(fullSet("12_5hz"));
  });

  test("Cancel in the sheet aborts a download the dialog started, and the record card follows", async ({ app, models }) => {
    await app.goto();
    models.set("*", { hang: true });
    await openDialogViaSettings(app);
    await app.startDialogDownload(["25hz"]);
    await expect(footerButton(app, "Cancel download")).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.settingsCodecButton).toHaveText("Loading models...");
    await expect(app.settingsCodecButton).toBeDisabled();
    // All three fetches are in flight before the abort, so the count below is exact.
    await expect.poll(() => models.hungCount).toBe(3);

    await sheetButton(app, "Cancel").click();
    await expect(app.settingsCodecStatus).toHaveText("Cancelled");
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(app.settingsSheet.getByRole("progressbar")).toHaveCount(0);
    await app.closeSettings();

    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecButton).toBeEnabled();
    await expect(app.codecCancelButton).toBeHidden();
    await expect(app.holdButton).toBeDisabled();
    expect(models.requests.length).toBe(3);
  });
});

test.describe("download failure", () => {
  test("an HTTP 500 on the encoder shows Error, keeps the dialog open, and a retry fetches the aborted siblings too", async ({ app, models }) => {
    await app.goto();
    models.set("encoder.onnx", { status: 500 });
    models.set("compressor_12_5hz.onnx", { hang: true });
    models.set("decoder_12_5hz.onnx", { hang: true });
    await openDialogViaSettings(app);
    await app.startDialogDownload(["12_5hz"]);

    await expect(statusBehindDialog(app)).toHaveText("Error");
    await expect(app.downloadDialog).toBeVisible();
    await expect(footerButton(app, "Close")).toBeVisible();
    await expect(footerButton(app, "Cancel download")).toHaveCount(0);
    await expect(app.downloadDialog.getByRole("progressbar")).toHaveCount(0);
    await expect(rowButton(app, "12_5hz")).toBeEnabled();

    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.settingsCodecStatus).toHaveText("Error");
    await expect(codecDot(app)).toHaveClass(/--surface2/);
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(app.settingsCodecButton).toBeEnabled();
    await expect(sheetButton(app, "Cancel")).toHaveCount(0);
    expect(models.requestsFor("encoder.onnx")).toBe(1);

    models.release();
    models.set("encoder.onnx", {});
    models.set("compressor_12_5hz.onnx", {});
    models.set("decoder_12_5hz.onnx", {});
    await app.settingsCodecButton.click();
    await app.startDialogDownload(["12_5hz"]);
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");
    await expect(codecDot(app)).toHaveClass(/--green/);
    expect(models.requestsFor("encoder.onnx")).toBe(2);
    expect(models.requests.length).toBe(6);
    expect((await app.ortState()).sessions.sort()).toEqual(fullSet("12_5hz"));
  });

  test("Error stays on screen while the sibling downloads finish", async ({ app, models }) => {
    await app.goto();
    models.set("encoder.onnx", { status: 500 });
    await openDialogViaSettings(app);
    await app.startDialogDownload(["12_5hz"]);
    await expect(statusBehindDialog(app)).toHaveText("Error");
    await expect(footerButton(app, "Close")).toBeVisible();

    await app.page.keyboard.press("Escape");
    await expect(app.settingsCodecStatus).toHaveText("Error");
    await expect(app.settingsCodecButton).toHaveText("Choose models");
  });

  test("a protobuf parse failure drops only the file ORT rejected", async ({ app, models }) => {
    await app.goto();
    await app.setOrt({ failCreate: "encoder", failMessage: "protobuf parsing failed" });
    models.set("encoder.onnx", { hang: true });
    await openDialogViaSettings(app);
    await app.startDialogDownload(["12_5hz"]);
    await expect.poll(async () => (await app.ortState()).sessions.length).toBe(2);
    await expect.poll(() => models.hungCount).toBe(1);
    models.release();

    await expect(statusBehindDialog(app)).toHaveText("Error");
    await expect(app.downloadDialog).toBeVisible();
    await expect(footerButton(app, "Close")).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.settingsCodecStatus).toHaveText("Error");
    expect([...models.requests].sort()).toEqual(fullSet("12_5hz"));

    await app.goto();
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecStatus).toHaveText("Encoder needs download");
    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText("Cached models available");
    await expect(totalCached(app)).toHaveText("Total cached: ~217 MB");
    await expect(app.settingsSheet.getByText("not cached", { exact: true })).toHaveCount(5);
    await expect(fileRow(app, "encoder.onnx").getByText("not cached", { exact: true })).toBeVisible();
    await expect(fileRow(app, "compressor_12_5hz.onnx").getByText("cached", { exact: true })).toBeVisible();
    await expect(fileRow(app, "decoder_12_5hz.onnx").getByText("cached", { exact: true })).toBeVisible();
    await app.settingsCodecButton.click();
    await expect(app.downloadDialog).toBeVisible();
    await expect(encoderRow(app).getByText("cached", { exact: true })).toHaveCount(0);
    await expect(app.dialogRow("12_5hz").getByText("cached", { exact: true })).toBeVisible();
    await expect(rowButton(app, "12_5hz")).toHaveText(`Download (~${ENCODER_MB} MB)`);
  });

  test("any other session-init failure keeps the cache", async ({ app, models }) => {
    await app.goto();
    await app.setOrt({ failCreate: "encoder", failMessage: "E2E stub: simulated init failure" });
    models.set("encoder.onnx", { hang: true });
    await openDialogViaSettings(app);
    await app.startDialogDownload(["12_5hz"]);
    await expect.poll(async () => (await app.ortState()).sessions.length).toBe(2);
    await expect.poll(() => models.hungCount).toBe(1);
    models.release();

    await expect(statusBehindDialog(app)).toHaveText("Error");
    await expect(app.downloadDialog).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.settingsCodecStatus).toHaveText("Error");

    await app.goto();
    await expect(app.codecButton).toHaveText("Load cached models");
    await expect(app.codecStatus).toHaveText("Cached models available");
    await app.openSettings("Models");
    await expect(totalCached(app)).toHaveText("Total cached: ~812 MB");
    await expect(app.settingsSheet.getByText("cached", { exact: true })).toHaveCount(3);
    await app.settingsCodecButton.click();
    await expect(encoderRow(app).getByText("cached", { exact: true })).toBeVisible();
    await expect(app.dialogRow("12_5hz").getByText("cached", { exact: true })).toBeVisible();
    await expect(rowButton(app, "12_5hz")).toHaveText("Load from cache");
    await expect(rowButton(app, "25hz")).toHaveText(`Download (~${PAIR_MB["25hz"]} MB)`);
  });
});

test.describe("download failure reporting", () => {
  test("a failed download is reported without an uncaught page error", async ({ app, models, pageErrors }) => {
    await app.goto();
    models.set("*", { status: 500 });
    await openDialogViaSettings(app);
    await app.startDialogDownload(["12_5hz"]);

    await expect(statusBehindDialog(app)).toHaveText("Error");
    await expect(app.downloadDialog).toBeVisible();
    await expect(footerButton(app, "Close")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

test.describe("deleting downloaded models", () => {
  test("the Codec section's delete is a two-step confirm that disarms itself after 3 s", async ({ app, page }) => {
    // Fake timers: the 3 s disarm is driven by the test instead of waited for.
    await page.clock.install();
    await app.goto();
    await app.openSettings("Models");

    await deleteButton(app).click();
    await expect(sheetButton(app, "Yes, delete models")).toBeVisible();
    await expect(sheetButton(app, "Cancel")).toBeVisible();
    // Only the inventory's copy of the button is left while the confirm is showing.
    await expect(sheetButton(app, "Delete downloaded models")).toHaveCount(1);
    await expect(app.settingsCodecStatus).toHaveText("Not loaded");

    await sheetButton(app, "Cancel").click();
    await expect(sheetButton(app, "Yes, delete models")).toHaveCount(0);
    await expect(sheetButton(app, "Delete downloaded models")).toHaveCount(2);

    await deleteButton(app).click();
    await expect(sheetButton(app, "Yes, delete models")).toBeVisible();
    await page.clock.fastForward(3000);
    await expect(sheetButton(app, "Yes, delete models")).toBeHidden();
    await expect(sheetButton(app, "Delete downloaded models")).toHaveCount(2);
    await expect(app.settingsCodecStatus).toHaveText("Not loaded");
  });

  test("confirming wipes the cache, drops the session and disarms the record tab even with the mic on", async ({ app, models }) => {
    await app.goto();
    await app.codecButton.click();
    await app.startDialogDownload(["12_5hz"]);
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    await expect(app.codecButton).toHaveText("Enable microphone");
    await app.codecButton.click();
    await expect(app.holdButton).toBeEnabled();
    await expect(app.codecCard.getByText("12.5hz loaded", { exact: true })).toBeVisible();

    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");
    await expect(totalCached(app)).toHaveText("Total cached: ~671 MB");
    await deleteButton(app).click();
    await sheetButton(app, "Yes, delete models").click();

    await expect(app.settingsCodecStatus).toHaveText("Downloaded model cache cleared");
    await expect(codecDot(app)).toHaveClass(/--surface2/);
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(sheetButton(app, "Yes, delete models")).toHaveCount(0);
    await expect(sheetButton(app, "Delete downloaded models")).toHaveCount(2);
    await app.closeSettings();

    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.holdButton).toBeDisabled();
    await expect(app.codecCard.getByText("12.5hz loaded", { exact: true })).toHaveCount(0);

    // Gone for real: a reload has nothing to offer from cache.
    await app.goto();
    await expect(app.codecButton).toHaveText("Choose models");
    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText("Not loaded");
    await expect(totalCached(app)).toHaveText("Total cached: ~0 MB");
    await expect(inventoryDeleteButton(app)).toBeDisabled();
    expect(models.requests.length).toBe(2);
  });

  test("the inventory below reflects the wipe", async ({ app }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.openSettings("Models");
    await expect(totalCached(app)).toHaveText("Total cached: ~812 MB");

    await deleteButton(app).click();
    await sheetButton(app, "Yes, delete models").click();
    await expect(app.settingsCodecStatus).toHaveText("Downloaded model cache cleared");

    await expect(totalCached(app)).toHaveText("Total cached: ~0 MB");
    await expect(app.settingsSheet.getByText("not cached", { exact: true })).toHaveCount(7);
    await expect(app.settingsSheet.getByText("ready", { exact: true })).toHaveCount(0);
    await expect(inventoryDeleteButton(app)).toBeDisabled();
  });

  test("the download dialog reflects the wipe", async ({ app }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.openSettings("Models");
    await deleteButton(app).click();
    await sheetButton(app, "Yes, delete models").click();
    await expect(app.settingsCodecStatus).toHaveText("Downloaded model cache cleared");

    await app.settingsCodecButton.click();
    await expect(app.downloadDialog).toBeVisible();
    await expect(app.downloadDialog.getByText("cached", { exact: true })).toHaveCount(0);
    await expect(rowButton(app, "12_5hz")).toHaveText("Download (~812 MB)");
  });

  test("the inventory's own Delete downloaded models asks for the same two-step confirm", async ({ app }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.openSettings("Models");
    await expect(inventoryDeleteButton(app)).toBeEnabled();
    await expect(app.settingsSheet.getByText("cached", { exact: true })).toHaveCount(3);

    await inventoryDeleteButton(app).click();
    await expect(sheetButton(app, "Yes, delete models")).toBeVisible();
    await expect(sheetButton(app, "Cancel")).toBeVisible();
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");

    await sheetButton(app, "Yes, delete models").click();
    await expect(app.settingsCodecStatus).toHaveText("Downloaded model cache cleared");
    await expect(sheetButton(app, "Yes, delete models")).toHaveCount(0);
    await expect(totalCached(app)).toHaveText("Total cached: ~0 MB");
    await expect(app.settingsSheet.getByText("not cached", { exact: true })).toHaveCount(7);
    await expect(app.settingsSheet.getByText("ready", { exact: true })).toHaveCount(0);
    await expect(inventoryDeleteButton(app)).toBeDisabled();
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(codecDot(app)).toHaveClass(/--surface2/);
  });
});

test.describe("deleting one file", () => {
  test("removes just that file from the cache while the loaded session keeps working", async ({ app, models }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.openSettings("Models");
    await expect(groupHeader(app, "Shared encoder").getByText("ready", { exact: true })).toBeVisible();
    await expect(groupHeader(app, GROUP["12_5hz"]).getByText("ready", { exact: true })).toBeVisible();
    await expect(groupHeader(app, GROUP["25hz"]).getByText("ready", { exact: true })).toHaveCount(0);
    await expect(app.settingsSheet.getByText("cached", { exact: true })).toHaveCount(3);
    await expect(app.settingsSheet.getByRole("button", { name: /^Delete .+\.onnx$/ })).toHaveCount(3);
    await expect(totalCached(app)).toHaveText("Total cached: ~812 MB");

    await fileRow(app, "encoder.onnx").getByRole("button", { name: "Delete encoder.onnx" }).click();
    await expect(fileRow(app, "encoder.onnx").getByText("not cached", { exact: true })).toBeVisible();
    await expect(groupHeader(app, "Shared encoder").getByText("ready", { exact: true })).toHaveCount(0);
    await expect(groupHeader(app, GROUP["12_5hz"]).getByText("ready", { exact: true })).toBeVisible();
    await expect(app.settingsSheet.getByRole("button", { name: "Delete encoder.onnx" })).toHaveCount(0);
    await expect(totalCached(app)).toHaveText(`Total cached: ~${PAIR_MB["12_5hz"]} MB`);
    await expect(inventoryDeleteButton(app)).toBeEnabled();

    // NOTE: current behaviour — a per-file delete touches only IndexedDB;
    // the session in memory stays loaded, so the sheet says "12.5hz loaded"
    // with a green dot right above an inventory that says the encoder is
    // gone. Whether deleting should also unload is an open product question.
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");
    await expect(codecDot(app)).toHaveClass(/--green/);
    await expect(app.settingsCodecButton).toHaveText("Change models");
    await app.closeSettings();
    await expect(app.codecCard.getByText("12.5hz loaded", { exact: true })).toBeVisible();
    await expect(app.codecButton).toHaveText("Enable microphone");

    // After a reload only the pair is cached: the encoder has to come back down.
    await app.goto();
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(app.codecStatus).toHaveText("Encoder needs download");
    await app.openSettings("Models");
    await app.settingsCodecButton.click();
    await expect(encoderRow(app).getByText("cached", { exact: true })).toHaveCount(0);
    await expect(app.dialogRow("12_5hz").getByText("cached", { exact: true })).toBeVisible();
    await expect(rowButton(app, "12_5hz")).toHaveText(`Download (~${ENCODER_MB} MB)`);
    await rowButton(app, "12_5hz").click();
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    expect(models.requests.slice(3)).toEqual(["encoder.onnx"]);
  });

  test("the download dialog in the same sheet reflects the per-file delete", async ({ app }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.openSettings("Models");
    await fileRow(app, "encoder.onnx").getByRole("button", { name: "Delete encoder.onnx" }).click();
    await expect(fileRow(app, "encoder.onnx").getByText("not cached", { exact: true })).toBeVisible();

    await app.settingsCodecButton.click();
    await expect(app.downloadDialog).toBeVisible();
    await expect(encoderRow(app).getByText("cached", { exact: true })).toHaveCount(0);
    await expect(rowButton(app, "25hz")).toHaveText(`Download (~${ENCODER_MB + PAIR_MB["25hz"]} MB)`);
  });
});

test.describe("persistence across reloads", () => {
  test("the sheet announces a cached 12.5hz set after a reload", async ({ app }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.goto();
    await expect(app.codecStatus).toHaveText("Cached models available");
    await app.openSettings("Models");
    // The mount check has long resolved by now, so a short wait is enough.
    await expect(app.settingsCodecStatus).toHaveText("Cached models available", { timeout: 4_000 });
  });

  test("the sheet announces a cached 50hz set after a reload, in step with the record card", async ({ app }) => {
    await app.goto();
    await app.loadModelsViaSettings(["50hz"]);
    await app.goto();
    await expect(app.codecStatus).toHaveText("Cached models available");
    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText("Cached models available");
    await expect(codecDot(app)).toHaveClass(/--surface2/);
    await expect(app.settingsCodecButton).toHaveText("Choose models");
  });

  test("Load from cache after a reload brings the models back without touching the network", async ({ app, models }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    expect(models.requests.length).toBe(3);

    await app.goto();
    expect((await app.ortState()).sessions).toEqual([]);
    await expect(app.codecButton).toHaveText("Load cached models");
    await expect(app.codecStatus).toHaveText("Cached models available");
    await app.openSettings("Models");
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(codecDot(app)).toHaveClass(/--surface2/);
    await expect(totalCached(app)).toHaveText("Total cached: ~812 MB");
    await expect(groupHeader(app, GROUP["12_5hz"]).getByText("ready", { exact: true })).toBeVisible();

    await app.settingsCodecButton.click();
    await expect(encoderRow(app).getByText("cached", { exact: true })).toBeVisible();
    await expect(app.dialogRow("12_5hz").getByText("cached", { exact: true })).toBeVisible();
    await expect(app.dialogRow("12_5hz").getByText("loaded", { exact: true })).toHaveCount(0);
    await expect(rowButton(app, "12_5hz")).toHaveText("Load from cache");
    await expect(rowButton(app, "25hz")).toHaveText(`Download (~${PAIR_MB["25hz"]} MB)`);
    await expect(rowButton(app, "50hz")).toHaveText(`Download (~${PAIR_MB["50hz"]} MB)`);

    await rowButton(app, "12_5hz").click();
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");
    await expect(codecDot(app)).toHaveClass(/--green/);
    await expect(app.settingsCodecButton).toHaveText("Change models");
    expect(models.requests.length).toBe(3);
    expect((await app.ortState()).sessions.sort()).toEqual(fullSet("12_5hz"));
    await app.closeSettings();
    await expect(app.codecButton).toHaveText("Enable microphone");
  });

  test("multi-select offers Load selected from cache once everything picked is cached", async ({ app, models }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    await app.goto();
    await openDialogViaSettings(app);
    const go = await app.selectMultiple(["12_5hz"]);

    // Badge and price column both read "cached".
    await expect(app.dialogRow("12_5hz").getByText("cached", { exact: true })).toHaveCount(2);
    await expect(go).toHaveText("Load selected from cache");
    await app.dialogRow("25hz").getByRole("checkbox").check();
    await expect(go).toHaveText(`Download selected (~${PAIR_MB["25hz"]} MB)`);
    await app.dialogRow("25hz").getByRole("checkbox").uncheck();
    await expect(go).toHaveText("Load selected from cache");

    await go.click();
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");
    expect(models.requests.length).toBe(3);
  });
});

test.describe("active quality", () => {
  test("loading from Settings never persists an active quality; the record tab adopts the first loaded quality only", async ({ app, models }) => {
    await app.goto();
    await expect(app.qualityRadio("12_5hz")).toHaveAttribute("aria-checked", "true");

    await app.loadModelsViaSettings(["50hz"]);
    await expect(app.qualityRadio("50hz")).toHaveAttribute("aria-checked", "true");
    await expect(app.codecCard.getByText("50hz loaded", { exact: true })).toBeVisible();
    await expect(app.codecButton).toHaveText("Enable microphone");

    // A later download does not move the radio: loadedQualities[0] is still 50hz.
    await app.loadModelsViaSettings(["25hz"]);
    await expect(app.qualityRadio("50hz")).toHaveAttribute("aria-checked", "true");
    await expect(app.qualityRadio("25hz")).toHaveAttribute("aria-checked", "false");
    await expect(app.codecCard.getByText("50hz loaded", { exact: true })).toBeVisible();

    // Both are loaded, so picking 25hz by hand needs no download.
    await pickQuality(app, "25hz");
    await expect(app.codecCard.getByText("25hz loaded", { exact: true })).toBeVisible();
    await expect(app.codecButton).toHaveText("Enable microphone");
    expect(models.requests.length).toBe(5);

    // Nothing was persisted: after a reload PTT has no quality it would encode with.
    await app.page.goto("/");
    await expect(pttQualityButtons(app)).toHaveCount(3);
    await expect(app.page.getByTitle(/^Download & use /)).toHaveCount(3);
    await expect(pttHighlightedQuality(app)).toHaveCount(0);
  });
});

test.describe("cross-page carry-over", () => {
  test("models loaded on the PTT page arrive on the QR page and survive the trip back", async ({ app, models }) => {
    await app.page.goto("/");
    const download25 = app.page.getByTitle("Download & use 25hz");
    await expect(download25).toHaveText("25hz ↓");
    await download25.click();
    await expect(app.page.getByText("25hz loaded", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(app.page.getByRole("button", { name: "Change models", exact: true })).toBeVisible();
    await expect(app.page.getByTitle("Encode with 25hz")).toHaveText("25hz");
    await expect(pttHighlightedQuality(app)).toHaveText("25hz");
    expect([...models.requests].sort()).toEqual(fullSet("25hz"));

    await app.page.getByRole("link", { name: "QR", exact: true }).click();
    await expect(app.tab("record")).toBeVisible();
    await expect(app.qualityRadio("25hz")).toHaveAttribute("aria-checked", "true");
    await expect(app.codecCard.getByText("25hz loaded", { exact: true })).toBeVisible();
    await expect(app.codecButton).toHaveText("Enable microphone");
    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText("25hz loaded");
    await expect(codecDot(app)).toHaveClass(/--green/);
    await expect(app.settingsCodecButton).toHaveText("Change models");
    await expect(groupHeader(app, GROUP["25hz"]).getByText("ready", { exact: true })).toBeVisible();
    await app.closeSettings();
    expect(models.requests.length).toBe(3);
    expect((await app.ortState()).sessions.sort()).toEqual(fullSet("25hz"));

    await app.page.getByRole("link", { name: "PTT", exact: true }).click();
    await expect(app.page.getByText("25hz loaded", { exact: true })).toBeVisible();
    await expect(app.page.getByRole("button", { name: "Change models", exact: true })).toBeVisible();
    await expect(app.page.getByTitle("Encode with 25hz")).toHaveText("25hz");
    expect(models.requests.length).toBe(3);

    // The PTT quality buttons are the one path that persists the active
    // quality: after a reload, with nothing loaded, 25hz is still the pick.
    await app.page.reload();
    await expect(app.page.getByTitle("Download & use 25hz")).toBeVisible();
    await expect(pttHighlightedQuality(app)).toHaveText("25hz ↓");
    expect(models.requests.length).toBe(3);
  });

  test("models loaded on the QR page are already there when the PTT page opens", async ({ app, models }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);

    await app.page.getByRole("link", { name: "PTT", exact: true }).click();
    await expect(app.page.getByText("12.5hz loaded", { exact: true })).toBeVisible();
    await expect(app.page.getByRole("button", { name: "Change models", exact: true })).toBeVisible();
    await expect(app.page.getByTitle("Encode with 12.5hz")).toHaveText("12.5hz");
    await expect(app.page.getByTitle("Download & use 25hz")).toHaveText("25hz ↓");
    expect(models.requests.length).toBe(3);

    await app.page.getByRole("link", { name: "QR", exact: true }).click();
    await expect(app.codecCard.getByText("12.5hz loaded", { exact: true })).toBeVisible();
    expect(models.requests.length).toBe(3);
  });
});
