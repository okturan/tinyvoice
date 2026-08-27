/**
 * Model-lifecycle gaps around CodecContext / codec-service as seen from the
 * QR page's Settings sheet, its download dialog and the record card: the
 * cache being cleared under a running download, Cancel arriving while ORT is
 * already initialising sessions, a protobuf error hitting one file of a
 * partly cached store, a load control re-clicked in the same task as Cancel,
 * and a failed encoder download leaving its siblings alone.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/test";
import type { QrApp } from "../support/app";
import type { Quality } from "../support/packets";

const GROUP_50 = "50hz — best quality";

function pairFor(q: Quality): string[] {
  return [`compressor_${q}.onnx`, `decoder_${q}.onnx`];
}

function fullSet(...qs: Quality[]): string[] {
  return ["encoder.onnx", ...qs.flatMap(pairFor)].sort();
}

// ── Locators the page object does not have ──────────────────────

function sheetButton(app: QrApp, name: string): Locator {
  return app.settingsSheet.getByRole("button", { name, exact: true });
}

function statusBehindDialog(app: QrApp): Locator {
  return app.page.locator('[data-slot="sheet-content"] span.font-mono').first();
}

/** The status dot to the left of the Settings › Models status text. */
function codecDot(app: QrApp): Locator {
  return app.settingsCodecStatus.locator("xpath=preceding-sibling::div[1]");
}

/** The Codec section's "Delete downloaded models" (two-step confirm), not the inventory's. */
function deleteButton(app: QrApp): Locator {
  return sheetButton(app, "Delete downloaded models").first();
}

/** Footer buttons only — the dialog's X also carries an sr-only "Close". */
function footerButton(app: QrApp, name: string): Locator {
  return app.downloadDialog.locator('[data-slot="dialog-footer"]').getByRole("button", { name, exact: true });
}

function rowButton(app: QrApp, q: Quality): Locator {
  return app.dialogRow(q).getByRole("button");
}

function encoderRow(app: QrApp): Locator {
  return app.downloadDialog
    .getByText("encoder.onnx", { exact: true })
    .locator("xpath=ancestor::*[contains(@class,'rounded-md')][1]");
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

/** The green "<quality> loaded" line the codec card shows once models are in memory. */
function loadedLine(app: QrApp): Locator {
  return app.codecCard.locator("span.text-\\[var\\(--green\\)\\]");
}

async function openDialogViaSettings(app: QrApp): Promise<void> {
  await app.openSettings("Models");
  await app.settingsCodecButton.click();
  await expect(app.downloadDialog).toBeVisible();
}

/**
 * Model requests the page itself gave up on (Chromium reports a fetch
 * aborted by an AbortController as `net::ERR_ABORTED`, even while the
 * request is parked in the fake model server). Install before `goto`.
 * A non-2xx response whose body is never read shows up the same way, so
 * filter out the request that was meant to fail when that matters.
 */
function trackAbortedModelRequests(page: Page): string[] {
  const aborted: string[] = [];
  page.on("requestfailed", (request) => {
    const name = /\/([a-z0-9_.-]+\.onnx)$/i.exec(request.url())?.[1];
    if (name && request.failure()?.errorText === "net::ERR_ABORTED") aborted.push(name);
  });
  return aborted;
}

async function sessionCount(app: QrApp): Promise<number> {
  return (await app.ortState()).sessions.length;
}

/** Start a 12.5hz download from Settings and park all three fetches; close the dialog again. */
async function startHungDownloadViaSettings(app: QrApp, models: { hungCount: number; set: (n: "*", b: { hang: boolean }) => void }): Promise<void> {
  models.set("*", { hang: true });
  await openDialogViaSettings(app);
  await app.startDialogDownload(["12_5hz"]);
  await expect(footerButton(app, "Cancel download")).toBeVisible();
  await expect.poll(() => models.hungCount).toBe(3);
  await app.page.keyboard.press("Escape");
  await expect(app.downloadDialog).toBeHidden();
  await expect(app.settingsCodecButton).toHaveText("Loading models...");
}

/** Confirm the Codec section's delete while a download is running. */
async function clearCacheMidDownload(app: QrApp): Promise<void> {
  await deleteButton(app).click();
  await sheetButton(app, "Yes, delete models").click();
  await expect(app.settingsCodecStatus).toHaveText("Downloaded model cache cleared");
  await expect(app.settingsCodecButton).toHaveText("Choose models");
  await expect(app.settingsCodecButton).toBeEnabled();
  await expect(sheetButton(app, "Cancel")).toHaveCount(0);
  await expect(app.settingsSheet.getByRole("progressbar")).toHaveCount(0);
  await expect(codecDot(app)).toHaveClass(/--surface2/);
}

/** Download 12.5hz through the record card, then reload so it is only cached. */
async function cachedRecordSet(app: QrApp): Promise<void> {
  await app.goto();
  await app.codecButton.click();
  await expect(app.downloadDialog).toBeVisible();
  await app.startDialogDownload(["12_5hz"]);
  await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
  await expect(loadedLine(app)).toHaveText("12.5hz loaded");
  await app.page.reload();
  await expect(app.tab("record")).toBeVisible();
  await expect(app.codecButton).toHaveText("Load cached models");
  await expect(app.codecStatus).toHaveText("Cached models available");
}

/**
 * Click the card's "Cancel download" and then its re-armed main button in
 * the same task, one microtask apart. React flushes the click's state
 * change in a microtask queued during the click, while the aborted fetch's
 * rejection still has to unwind loadModel → createSession → Promise.all →
 * loadModels' finally, so a single yield lands exactly between the two: the
 * button already reads "Load cached models" but the context has not let go
 * of its AbortController yet. Returns the label that was clicked.
 */
async function cancelAndReclick(app: QrApp): Promise<string> {
  return app.codecCard.evaluate(async (root) => {
    const button = (text: RegExp) =>
      Array.from(root.querySelectorAll("button")).find((b) => text.test(b.textContent?.trim() ?? ""));
    const cancel = button(/^Cancel download$/);
    if (!cancel) throw new Error("no Cancel download button on the card");
    cancel.click();
    await Promise.resolve();
    const next = button(/^(Load cached models|Choose models|Loading models\.\.\.)$/);
    if (!next) throw new Error("no load control on the card after Cancel");
    const label = next.textContent!.trim();
    next.click();
    return label;
  });
}

test.describe("clearing the cache during a download", () => {
  test("Yes, delete models aborts the running download and nothing gets loaded afterwards", async ({ app, models, page }) => {
    const aborted = trackAbortedModelRequests(page);
    await app.goto();
    await startHungDownloadViaSettings(app, models);
    await clearCacheMidDownload(app);

    models.release();
    // Settle: either the clear aborted the three fetches (nothing left in
    // flight) or the orphaned load created its sessions — whichever world.
    await expect
      .poll(async () => aborted.length === 3 || (await sessionCount(app)) === 3, { timeout: 15_000 })
      .toBe(true);

    await expect(app.settingsCodecStatus).toHaveText(/^(Downloaded model cache cleared|Not loaded)$/);
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(codecDot(app)).toHaveClass(/--surface2/);
    expect([...aborted].sort()).toEqual(fullSet("12_5hz"));
    expect((await app.ortState()).sessions).toEqual([]);

    await app.closeSettings();
    await expect(app.codecButton).toHaveText("Choose models");
    await expect(loadedLine(app)).toHaveCount(0);
    await expect(app.holdButton).toBeDisabled();

    // Reopening the sheet re-reads IndexedDB: still empty.
    await app.openSettings("Models");
    await expect(totalCached(app)).toHaveText("Total cached: ~0 MB");
    await expect(app.settingsSheet.getByText("not cached", { exact: true })).toHaveCount(7);
  });

  test("after the cache is cleared mid-download, a new download can start", async ({ app, models }) => {
    await app.goto();
    await startHungDownloadViaSettings(app, models);
    await clearCacheMidDownload(app);
    models.reset();

    await expect(app.settingsCodecStatus).toHaveText(/^(Downloaded model cache cleared|Not loaded)$/);
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(totalCached(app)).toHaveText("Total cached: ~0 MB");

    await app.settingsCodecButton.click();
    await expect(app.downloadDialog).toBeVisible();
    await app.startDialogDownload(["12_5hz"]);
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");
    await expect(app.settingsCodecButton).toHaveText("Change models");
    expect((await app.ortState()).sessions.sort()).toEqual(fullSet("12_5hz"));
  });
});

test.describe("cancelling while sessions initialise", () => {
  async function cancelDuringInit(app: QrApp): Promise<void> {
    await app.goto();
    await app.setOrt({ createDelayMs: 2500 });
    await openDialogViaSettings(app);
    await app.startDialogDownload(["12_5hz"]);
    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    // The 1 MiB bodies land at once; InferenceSession.create is the slow part.
    await expect(app.settingsCodecStatus).toHaveText(/^Initializing/);
    await expect(app.settingsSheet.getByRole("progressbar")).toBeVisible();
    await sheetButton(app, "Cancel").click();
    await expect(app.settingsCodecStatus).toHaveText("Cancelled");
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(app.settingsSheet.getByRole("progressbar")).toHaveCount(0);
  }

  test("Cancel during InferenceSession.create leaves nothing loaded", async ({ app }) => {
    await cancelDuringInit(app);

    // Settle: the stub always finishes its creates, so wait for all three.
    await expect.poll(() => sessionCount(app), { timeout: 10_000 }).toBe(3);

    await expect(app.settingsCodecStatus).toHaveText("Cancelled");
    await expect(app.settingsCodecButton).toHaveText("Choose models");
    await expect(codecDot(app)).toHaveClass(/--surface2/);
    await app.closeSettings();
    await expect(loadedLine(app)).toHaveCount(0);
    await expect(app.codecButton).toHaveText(/^(Choose models|Load cached models)$/);
    await expect(app.holdButton).toBeDisabled();
  });

  test("after Cancel during create, a retry from the dialog loads 12.5hz", async ({ app }) => {
    await cancelDuringInit(app);
    await app.setOrt({ createDelayMs: 0 });
    await app.settingsCodecButton.click();
    await expect(app.downloadDialog).toBeVisible();
    await app.startDialogDownload(["12_5hz"]);
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");
    await expect(app.settingsCodecButton).toHaveText("Change models");
    await app.closeSettings();
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    await expect(app.codecButton).toHaveText("Enable microphone");
  });
});

test.describe("a protobuf error while another quality is cached", () => {
  test.use({ strictPageErrors: false });

  test("only the file ORT rejected is dropped; the cached 50hz set survives", async ({ app, models, pageErrors }) => {
    await app.goto();
    await app.loadModelsViaSettings(["50hz"]);
    await app.goto();
    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText("Cached models available");
    await expect(totalCached(app)).toHaveText("Total cached: ~800 MB");

    await app.setOrt({ failCreate: "compressor_12_5hz", failMessage: "protobuf parsing failed" });
    models.set("decoder_12_5hz.onnx", { hang: true });
    await app.settingsCodecButton.click();
    await expect(app.downloadDialog).toBeVisible();
    await expect(encoderRow(app).getByText("cached", { exact: true })).toBeVisible();
    await expect(rowButton(app, "12_5hz")).toHaveText("Download (~217 MB)");
    await app.startDialogDownload(["12_5hz"]);
    await expect(statusBehindDialog(app)).toHaveText("Error");
    expect(pageErrors).toEqual([]);
    // The encoder came from the cache; only the 12.5hz pair hit the network.
    expect(models.requests.slice(3).sort()).toEqual(pairFor("12_5hz").sort());
    await app.page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.settingsCodecStatus).toHaveText("Error");
    models.release();

    // Reload: the healthy 50hz set is still on offer …
    await app.goto();
    await expect(app.qualityRadio("50hz")).toHaveAttribute("aria-checked", "true");
    await expect(app.codecButton).toHaveText("Load cached models");
    await expect(app.codecStatus).toHaveText("Cached models available");
    await app.openSettings("Models");
    await expect(app.settingsCodecStatus).toHaveText("Cached models available");
    await expect(fileRow(app, "encoder.onnx").getByText("cached", { exact: true })).toBeVisible();
    for (const name of pairFor("50hz")) {
      await expect(fileRow(app, name).getByText("cached", { exact: true })).toBeVisible();
    }
    await expect(groupHeader(app, GROUP_50).getByText("ready", { exact: true })).toBeVisible();
    // … and only the file ORT refused is gone.
    await expect(fileRow(app, "compressor_12_5hz.onnx").getByText("not cached", { exact: true })).toBeVisible();
    await app.settingsCodecButton.click();
    await expect(encoderRow(app).getByText("cached", { exact: true })).toBeVisible();
    await expect(rowButton(app, "50hz")).toHaveText("Load from cache");
  });
});

test.describe("re-clicking a load control in the same task as Cancel", () => {
  test("Load cached models right after Cancel download starts a new load", async ({ app }) => {
    await cachedRecordSet(app);
    await app.setOrt({ createDelayMs: 2500 });
    await app.codecButton.click();
    await expect(app.codecButton).toHaveText("Loading models...");
    await expect(app.codecCancelButton).toBeVisible();

    expect(await cancelAndReclick(app)).toBe("Load cached models");

    await expect(app.codecButton).toHaveText("Loading models...");
    await expect(app.codecCancelButton).toBeVisible();
    await expect(app.holdButton).toBeEnabled({ timeout: 15_000 });
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    await expect(app.codecStatus).toHaveCount(0);
  });

  test("a later click after Cancel loads the cached record set", async ({ app }) => {
    await cachedRecordSet(app);
    await app.setOrt({ createDelayMs: 2500 });
    await app.codecButton.click();
    await expect(app.codecButton).toHaveText("Loading models...");
    await app.codecCancelButton.click();
    await expect(app.codecButton).toHaveText("Load cached models");
    await expect(app.codecButton).toBeEnabled();
    await expect(app.holdButton).toBeDisabled();

    await app.setOrt({ createDelayMs: 0 });
    await app.codecButton.click();
    await expect(app.holdButton).toBeEnabled({ timeout: 15_000 });
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    await expect(app.codecStatus).toHaveCount(0);
    expect(new Set((await app.ortState()).sessions)).toEqual(
      new Set(["encoder.onnx", "compressor_12_5hz.onnx"]),
    );
  });
});

test.describe("a failed encoder download aborts its siblings", () => {
  test("the pair is aborted, and a retry fetches the missing files", async ({ app, models, page, pageErrors }) => {
    const aborted = trackAbortedModelRequests(page);
    await app.goto();
    models.set("encoder.onnx", { status: 500 });
    models.set("compressor_12_5hz.onnx", { delayMs: 1500 });
    models.set("decoder_12_5hz.onnx", { delayMs: 1500 });
    await openDialogViaSettings(app);
    await app.startDialogDownload(["12_5hz"]);

    await expect(statusBehindDialog(app)).toHaveText("Error");
    expect(pageErrors).toEqual([]);
    expect([...models.requests].sort()).toEqual(fullSet("12_5hz"));
    await expect(footerButton(app, "Close")).toBeVisible();
    await expect(rowButton(app, "12_5hz")).toBeEnabled();
    await expect.poll(() => aborted.filter((name) => name !== "encoder.onnx").sort()).toEqual(pairFor("12_5hz").sort());
    expect((await app.ortState()).sessions).toEqual([]);

    models.reset();
    await rowButton(app, "12_5hz").click();
    await expect(app.downloadDialog).toBeHidden({ timeout: 20_000 });
    await expect(app.settingsCodecStatus).toHaveText("12.5hz loaded");
    await expect(codecDot(app)).toHaveClass(/--green/);
    await expect(app.settingsCodecButton).toHaveText("Change models");
    expect(models.requestsFor("encoder.onnx")).toBe(2);
    expect(models.requests.length).toBe(6);
    expect((await app.ortState()).sessions.sort()).toEqual(fullSet("12_5hz"));

    await app.closeSettings();
    await expect(loadedLine(app)).toHaveText("12.5hz loaded");
    await expect(app.codecButton).toHaveText("Enable microphone");
  });
});
