/**
 * Layout ethos, tab mounting, reload / navigation persistence and resource
 * leaks on the QR page: what survives a Settings › Layout switch, a
 * Record ↔ Decode tab change, a reload and a PTT round-trip — and what the
 * app forgets or leaves running behind the user's back.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../support/test";
import type { Ethos, QrApp } from "../support/app";
import { initialStatus, packetSeconds, toBase64, toHex } from "../support/packets";

// ── Local helpers ────────────────────────────────────────────────

/** QRPage's outer frame; its max-width is the only visible ethos cue outside the panels. */
function frame(page: Page): Locator {
  return page.locator("div.h-dvh > div").first();
}

const FRAME_MAX_WIDTH: Record<Ethos, string> = {
  "stage-swap": "520px",
  "split-deck": "840px",
};

async function expectFrame(page: Page, ethos: Ethos): Promise<void> {
  await expect(frame(page)).toHaveCSS("max-width", FRAME_MAX_WIDTH[ethos]);
}

/** Settings › General › Layout button (accessible name starts with the label). */
function ethosButton(app: QrApp, ethos: Ethos): Locator {
  return app.settingsSheet.getByRole("button", {
    name: ethos === "split-deck" ? /^Split Deck/ : /^Stage Swap/,
  });
}

// The layout buttons carry no aria-pressed, so the filled surface is the only
// selection cue. The other button only has a hover variant of the same
// colour, so anchor the match on word boundaries.
const SELECTED_ETHOS = /(^|\s)bg-\[var\(--surface0\)\](\s|$)/;
const UNSELECTED_ETHOS = /border-transparent/;

/** The "← New source" / "← New recording" header's right-hand summary (stage-swap only). */
function stageHeader(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true });
}

/** Load one quality through Settings, then arm the mic from the Record tab. */
async function loadAndEnableMic(app: QrApp, quality: "12_5hz" | "25hz" | "50hz" = "12_5hz"): Promise<void> {
  await app.loadModelsViaSettings([quality]);
  await expect(app.codecButton).toHaveText("Enable microphone");
  await app.codecButton.click();
  await expect(app.holdButton).toBeEnabled();
}

interface TrackState {
  kind: string;
  readyState: string;
}

/**
 * Must run before `goto`. Records every MediaStream handed out by
 * getUserMedia on `window.__streams` and every AudioContext constructed on
 * `window.__audioContexts`, so a test can check what the app leaves running
 * after the component that opened them has gone.
 */
async function installMediaProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const streams: MediaStream[] = [];
    const contexts: AudioContext[] = [];
    Object.defineProperty(window, "__streams", { value: streams });
    Object.defineProperty(window, "__audioContexts", { value: contexts });

    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await original(constraints);
      streams.push(stream);
      return stream;
    };

    const Native = window.AudioContext;
    window.AudioContext = class TrackedAudioContext extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
      }
    };
  });
}

async function trackStates(page: Page): Promise<TrackState[]> {
  return page.evaluate(() =>
    (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) =>
      s.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState })),
    ),
  );
}

async function audioContextStates(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __audioContexts: AudioContext[] }).__audioContexts.map((c) => c.state),
  );
}

async function liveTrackCount(page: Page): Promise<number> {
  return (await trackStates(page)).filter((t) => t.readyState === "live").length;
}

async function openAudioContextCount(page: Page): Promise<number> {
  return (await audioContextStates(page)).filter((s) => s !== "closed").length;
}

// ── Ethos ────────────────────────────────────────────────────────

test.describe("layout ethos", () => {
  test("defaults to Stage Swap: narrow frame, no result pane, Settings › General marks it", async ({ app, page }) => {
    await app.goto();
    await expectFrame(page, "stage-swap");
    await expect(app.resultPlaceholder).toBeHidden();

    await app.openSettings("General");
    await expect(ethosButton(app, "stage-swap")).toHaveClass(SELECTED_ETHOS);
    await expect(ethosButton(app, "split-deck")).toHaveClass(UNSELECTED_ETHOS);
  });

  test("a stored split-deck ethos boots the wide frame with Split Deck selected", async ({ app, page }) => {
    await app.presetEthos("split-deck");
    await app.goto();
    await expectFrame(page, "split-deck");
    await expect(app.resultPlaceholder).toBeVisible();
    await app.openSettings("General");
    await expect(ethosButton(app, "split-deck")).toHaveClass(SELECTED_ETHOS);
    await expect(ethosButton(app, "stage-swap")).toHaveClass(UNSELECTED_ETHOS);
  });

  test("an unrecognised stored value falls back to Stage Swap", async ({ app, page }) => {
    await page.addInitScript(() => localStorage.setItem("tinyvoice-layout", "carousel"));
    await app.goto();
    await expectFrame(page, "stage-swap");
    await app.openSettings("General");
    await expect(ethosButton(app, "stage-swap")).toHaveClass(SELECTED_ETHOS);
  });

  test("switching in Settings resizes the frame at once and the choice survives a reload in both directions", async ({ app, page }) => {
    await app.goto();
    await app.openSettings("General");
    await ethosButton(app, "split-deck").click();
    await expect(ethosButton(app, "split-deck")).toHaveClass(SELECTED_ETHOS);
    // The frame behind the sheet already grew.
    await expectFrame(page, "split-deck");
    await app.closeSettings();

    await page.reload();
    await expect(app.tab("record")).toBeVisible();
    await expectFrame(page, "split-deck");
    await expect(app.resultPlaceholder).toBeVisible();

    await app.switchEthosViaSettings("stage-swap");
    await expectFrame(page, "stage-swap");
    await expect(app.resultPlaceholder).toBeHidden();

    await page.reload();
    await expect(app.tab("record")).toBeVisible();
    await expectFrame(page, "stage-swap");
    await expect(app.resultPlaceholder).toBeHidden();
  });
});

// ── Decode layouts ───────────────────────────────────────────────

test.describe("Decode tab per ethos", () => {
  test("stage-swap: a loaded packet takes the stage and ← New source brings the sources back", async ({ app, page }) => {
    const bytes = packetSeconds("12_5hz", 1.2);
    await app.goto({ tab: "decode" });
    for (const s of ["hex", "upload", "camera"] as const) await expect(app.sourceTab(s)).toBeVisible();
    await expect(app.playerPlaceholder).toBeHidden();
    await expect(app.newSourceButton).toBeHidden();

    await app.submitHex(toHex(bytes));
    await expect(app.newSourceButton).toBeVisible();
    await expect(stageHeader(page, `${bytes.length} B · 12.5hz`)).toBeVisible();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
    for (const s of ["hex", "upload", "camera"] as const) await expect(app.sourceTab(s)).toBeHidden();
    await expect(app.editHexButton).toBeHidden();

    await app.newSourceButton.click();
    await expect(app.sourceTab("hex")).toBeVisible();
    await expect(app.playerCard).toBeHidden();
    await expect(stageHeader(page, `${bytes.length} B · 12.5hz`)).toBeHidden();
    // New source clears the session packet. Stage-swap then remounts the
    // hex form empty. Split-deck keeps the submitted hex behind "Edit hex".
    await expect(app.hexTextarea).toHaveValue("");
  });

  test("split-deck: sources stay beside the player; the placeholder shows until a packet loads", async ({ app }) => {
    const bytes = packetSeconds("25hz", 1);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await expect(app.playerPlaceholder).toHaveText("Load a packet — the player appears here");
    await expect(app.sourceTab("hex")).toBeVisible();

    await app.submitHex(toHex(bytes));
    await expect(app.playerPlaceholder).toBeHidden();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));
    await expect(app.sourceTab("hex")).toBeVisible();
    await expect(app.sourceTab("camera")).toBeVisible();
    await expect(app.editHexButton).toBeVisible();
    await expect(app.page.getByText(`${bytes.length} hexadecimal bytes loaded`)).toBeVisible();
    await expect(app.newSourceButton).toBeHidden();
  });
});

// ── Record layouts ───────────────────────────────────────────────

test.describe("Record tab per ethos", () => {
  test("stage-swap: the result replaces the stage under a quality · seconds → bytes header", async ({ app, page }) => {
    await app.goto();
    await expect(app.resultPlaceholder).toBeHidden();
    await loadAndEnableMic(app);
    await app.record();

    const { bytes, seconds } = await app.resultMeta();
    await expect(stageHeader(page, `12.5hz · ${seconds.toFixed(1)}s → ${bytes} B`)).toBeVisible();
    await expect(app.newRecordingButton).toBeVisible();
    await expect(app.holdButton).toBeHidden();
    await expect(app.codecCard).toBeHidden();
    await expect(app.qualityRadio("12_5hz")).toBeHidden();

    // Back to the recording stage: the mic is still armed (same component instance).
    await app.newRecordingButton.click();
    await expect(app.qrImage).toBeHidden();
    await expect(app.holdButton).toBeEnabled();
    await expect(app.codecCard).toContainText("12.5hz loaded");
    await expect(app.codecButton).toBeHidden();
  });

  test("split-deck: the rail keeps its controls while the result fills the right pane", async ({ app }) => {
    await app.presetEthos("split-deck");
    await app.goto();
    await expect(app.resultPlaceholder).toHaveText("Hold to record — your QR appears here");
    await loadAndEnableMic(app);
    await expect(app.resultPlaceholder).toBeVisible();

    await app.record();
    await expect(app.resultPlaceholder).toBeHidden();
    await expect(app.holdButton).toBeEnabled();
    await expect(app.codecCard).toContainText("12.5hz loaded");
    await expect(app.newRecordingButton).toBeHidden();
    await expect(app.previewButton).toHaveText("Preview");
  });
});

// ── Ethos switch with content on screen ──────────────────────────

test.describe("switching ethos with content loaded", () => {
  test("a Decode packet, its override and status survive the switch in both directions", async ({ app, page }) => {
    const bytes = packetSeconds("12_5hz", 1);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.submitHex(toHex(bytes));
    await app.decoderButton("25hz").click();
    await expect(app.playerStatus).toHaveText("Decoder set to 25hz");
    await expect(app.downloadModelsButton).toHaveText("Download 25hz decoder (~139 MB)");

    await app.switchEthosViaSettings("stage-swap");
    await expectFrame(page, "stage-swap");
    await expect(app.newSourceButton).toBeVisible();
    await expect(stageHeader(page, `${bytes.length} B · 12.5hz`)).toBeVisible();
    await expect(app.playerStatus).toHaveText("Decoder set to 25hz");
    expect(await app.selectedDecoderLabels()).toEqual(["25hz"]);
    await expect(app.downloadModelsButton).toHaveText("Download 25hz decoder (~139 MB)");

    await app.switchEthosViaSettings("split-deck");
    await expect(app.playerPlaceholder).toBeHidden();
    await expect(app.sourceTab("hex")).toBeVisible();
    await expect(app.playerStatus).toHaveText("Decoder set to 25hz");
    expect(await app.selectedDecoderLabels()).toEqual(["25hz"]);
  });

  test("a Record result survives an ethos switch", async ({ app, page }) => {
    await app.goto();
    await loadAndEnableMic(app);
    await app.record();
    const before = await app.resultMeta();

    await app.switchEthosViaSettings("split-deck");
    await expectFrame(page, "split-deck");
    // Models live in the codec context and survive the switch either way.
    await expect(app.codecCard).toContainText("12.5hz loaded");
    await expect(app.qrImage).toBeVisible();
    expect(await app.resultMeta()).toEqual(before);
    await expect(app.holdButton).toBeEnabled();
  });
});

// ── Tab switching ────────────────────────────────────────────────

test.describe("tab switching", () => {
  test("the loaded models survive a Decode round-trip", async ({ app }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    await expect(app.codecCard).toContainText("12.5hz loaded");

    await app.openTab("decode");
    await expect(app.sourceTab("hex")).toBeVisible();
    await expect(app.codecCard).toBeHidden();

    await app.openTab("record");
    await expect(app.codecCard).toContainText("12.5hz loaded");
    await expect(app.holdButton).toBeVisible();
  });

  test("a Record result survives a Decode round-trip", async ({ app }) => {
    // Split-deck keeps HOLD beside the result, so "still armed" is visible
    // without leaving the result stage.
    await app.presetEthos("split-deck");
    await app.goto();
    await loadAndEnableMic(app);
    await app.record();
    const before = await app.resultMeta();

    await app.openTab("decode");
    await expect(app.sourceTab("hex")).toBeVisible();
    await expect(app.qrImage).toBeHidden();

    await app.openTab("record");
    await expect(app.qrImage).toBeVisible();
    expect(await app.resultMeta()).toEqual(before);
    await expect(app.holdButton).toBeEnabled();
  });

  test("a hex-loaded packet survives a Record round-trip", async ({ app }) => {
    const bytes = packetSeconds("12_5hz", 1);
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.submitHex(toHex(bytes));
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));

    await app.openTab("record");
    await expect(app.playerCard).toBeHidden();
    await expect(app.holdButton).toBeVisible();

    await app.openTab("decode");
    await expect(app.sourceTab("hex")).toBeVisible();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
    await expect(app.editHexButton).toBeVisible();
  });

  test("a ?v= packet comes back after a Record round-trip", async ({ app, page }) => {
    const bytes = packetSeconds("25hz", 1);
    await app.goto({ v: toBase64(bytes) });
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));

    await app.openTab("record");
    await expect(app.playerCard).toBeHidden();
    await expect(app.holdButton).toBeVisible();

    await app.openTab("decode");
    // QRPage rebuilds DecodePanel from the URL (key={voiceB64}).
    await expect(stageHeader(page, `${bytes.length} B · 25hz`)).toBeVisible();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "25hz"));
    await expect(app.downloadModelsButton).toHaveText("Download 25hz decoder (~139 MB)");
  });

  test("a ?v= packet keeps its decoder override across a Record round-trip", async ({ app }) => {
    const bytes = packetSeconds("25hz", 1);
    await app.goto({ v: toBase64(bytes) });
    await app.decoderButton("50hz").click();
    await expect(app.playerStatus).toHaveText("Decoder set to 50hz");

    await app.openTab("record");
    await app.openTab("decode");
    await expect(app.playerStatus).toHaveText("Decoder set to 50hz");
    expect(await app.selectedDecoderLabels()).toEqual(["50hz"]);
  });
});

// ── Resource leaks ───────────────────────────────────────────────

test.describe("microphone and AudioContext after the Record panel unmounts", () => {
  test("Enable microphone opens one live audio track and one AudioContext", async ({ app, page }) => {
    await installMediaProbe(page);
    await app.goto();
    await expect.poll(() => trackStates(page)).toEqual([]);
    await loadAndEnableMic(app);
    await expect.poll(() => trackStates(page)).toEqual([{ kind: "audio", readyState: "live" }]);
    await expect.poll(() => audioContextStates(page)).toHaveLength(1);
  });

  test("leaving /qr for PTT releases the microphone", async ({ app, page }) => {
    await installMediaProbe(page);
    await app.goto();
    await loadAndEnableMic(app);

    await page.getByRole("link", { name: "PTT", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect.poll(() => trackStates(page)).toEqual([{ kind: "audio", readyState: "ended" }]);
  });

  test("leaving /qr for PTT closes the recording AudioContext", async ({ app, page }) => {
    await installMediaProbe(page);
    await app.goto();
    await loadAndEnableMic(app);

    await page.getByRole("link", { name: "PTT", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect.poll(() => audioContextStates(page)).toEqual(["closed"]);
  });

  test("switching ethos leaves exactly one live microphone and at most one AudioContext", async ({ app, page }) => {
    await installMediaProbe(page);
    await app.goto();
    await loadAndEnableMic(app);

    await app.switchEthosViaSettings("split-deck");
    await expect(app.codecCard).toContainText("12.5hz loaded");
    // Re-arm the mic if the new layout asks for it; a hoisted hook keeps HOLD armed.
    if (await app.codecButton.isVisible()) await app.codecButton.click();
    await expect(app.holdButton).toBeEnabled();

    await expect.poll(() => liveTrackCount(page)).toBe(1);
    await expect.poll(() => openAudioContextCount(page)).toBeLessThanOrEqual(1);
  });
});

// ── Reload ───────────────────────────────────────────────────────

test.describe("reload", () => {
  test("a ?v= packet is re-parsed after a reload and the Decode tab stays selected", async ({ app, page }) => {
    const bytes = packetSeconds("12_5hz", 2);
    await app.goto({ v: toBase64(bytes) });
    await expect(app.tab("decode")).toHaveAttribute("aria-selected", "true");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));

    await page.reload();
    await expect(app.tab("decode")).toHaveAttribute("aria-selected", "true");
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
    await expect(app.newSourceButton).toBeVisible();
    await expect(app.downloadModelsButton).toHaveText("Download 12.5hz decoder (~141 MB)");
  });

  test("a hex-loaded packet is gone after a reload and the page reopens on Record", async ({ app, page }) => {
    const bytes = packetSeconds("12_5hz", 1);
    await app.goto({ tab: "decode" });
    await app.submitHex(toHex(bytes));
    await expect(app.newSourceButton).toBeVisible();

    await page.reload();
    await expect(app.tab("record")).toHaveAttribute("aria-selected", "true");
    await app.openTab("decode");
    await expect(app.sourceTab("hex")).toBeVisible();
    await expect(app.newSourceButton).toBeHidden();
    await expect(app.playerCard).toBeHidden();
    await expect(app.hexTextarea).toHaveValue("");
  });

  test("the trim toggle is on by default and its state persists across a reload", async ({ app, page }) => {
    await app.goto();
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "true");

    await app.trimSwitch.click();
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "false");

    await page.reload();
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "false");

    // The other layout reads the same setting.
    await app.switchEthosViaSettings("split-deck");
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "false");
    await app.trimSwitch.click();
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "true");

    await page.reload();
    await expect(app.trimSwitch).toHaveAttribute("aria-checked", "true");
  });
});

// ── Navigation ───────────────────────────────────────────────────

test.describe("navigation", () => {
  test("the top bar links swap between /qr and /, and the current page is highlighted", async ({ app, page }) => {
    await app.goto();
    const nav = page.getByRole("navigation");
    const pttLink = page.getByRole("link", { name: "PTT", exact: true });
    // The active route is inert text, matching PTT's own header.
    await expect(page.getByRole("link", { name: "QR", exact: true })).toHaveCount(0);
    await expect(nav.getByText("QR", { exact: true })).toHaveClass(/text-\[var\(--text\)\]/);
    await expect(pttLink).toHaveAttribute("href", "/");
    await expect(pttLink).not.toHaveClass(/text-\[var\(--text\)\]/);

    await pttLink.click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("link", { name: "PTT", exact: true })).toHaveCount(0);
    await expect(page.getByText("PTT", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose models" })).toBeVisible();

    await page.getByRole("link", { name: "QR", exact: true }).click();
    await expect(page).toHaveURL("/qr");
    await expect(app.tab("record")).toHaveAttribute("aria-selected", "true");
  });

  test("models loaded on /qr are still loaded on PTT and back, and the Decode prompt reflects them", async ({ app, page, models }) => {
    await app.goto();
    await app.loadModelsViaSettings(["12_5hz"]);
    await expect(app.codecCard).toContainText("12.5hz loaded");

    await page.getByRole("link", { name: "PTT", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByText("12.5hz loaded", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change models" })).toBeVisible();

    await page.getByRole("link", { name: "QR", exact: true }).click();
    await expect(app.tab("record")).toBeVisible();
    await expect(app.codecCard).toContainText("12.5hz loaded");
    await expect(app.codecButton).toHaveText("Enable microphone");

    await app.openTab("decode");
    const p12 = packetSeconds("12_5hz", 1, 1);
    await app.submitHex(toHex(p12));
    await expect(app.playerStatus).toHaveText(initialStatus(p12, "12_5hz"));
    await expect(app.downloadModelsButton).toBeHidden();
    await app.newSourceButton.click();
    const p25 = packetSeconds("25hz", 1, 2);
    await app.submitHex(toHex(p25));
    await expect(app.downloadModelsButton).toHaveText("Download 25hz decoder (~139 MB)");
    // Only the one Settings download hit the network; nothing was re-fetched on the way round.
    expect([...models.requests].sort()).toEqual(["compressor_12_5hz.onnx", "decoder_12_5hz.onnx", "encoder.onnx"]);
  });

  test("the Settings sheet opens from both pages and Escape closes it", async ({ app, page }) => {
    await app.goto();
    await app.openSettings();
    await expect(app.settingsSheet.getByRole("tab", { name: "General", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(app.settingsSheet).toBeHidden();
    await expect(app.tab("record")).toBeVisible();

    await page.getByRole("link", { name: "PTT", exact: true }).click();
    await expect(page).toHaveURL("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(app.settingsSheet).toBeVisible();
    await app.settingsSheet.getByRole("tab", { name: "General", exact: true }).click();
    await expect(ethosButton(app, "stage-swap")).toHaveClass(SELECTED_ETHOS);
    await page.keyboard.press("Escape");
    await expect(app.settingsSheet).toBeHidden();
  });
});

// ── Keyboard & dialogs ───────────────────────────────────────────

test.describe("keyboard and dialog roles", () => {
  test("the player's Hex button opens a 'Token Data' dialog that Escape closes", async ({ app, page }) => {
    const bytes = packetSeconds("12_5hz", 1);
    await app.goto({ v: toBase64(bytes) });
    await expect(app.hexSheet).toBeHidden();
    await app.playerHexButton.click();
    await expect(app.hexSheet).toBeVisible();
    await expect(app.hexSheet).toContainText(`${bytes.length} bytes · raw hex dump`);
    await page.keyboard.press("Escape");
    await expect(app.hexSheet).toBeHidden();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
  });

  test("the Record result's Hex button opens the same sheet for the recorded packet", async ({ app, page }) => {
    await app.goto();
    await loadAndEnableMic(app);
    await app.record();
    const { bytes } = await app.resultMeta();
    await app.resultHexButton.click();
    await expect(app.hexSheet).toBeVisible();
    await expect(app.hexSheet).toContainText(`${bytes} bytes · raw hex dump`);
    await page.keyboard.press("Escape");
    await expect(app.hexSheet).toBeHidden();
    await expect(app.qrImage).toBeVisible();
  });

  test("Choose models opens a 'Download models' dialog that Escape closes without downloading", async ({ app, page, models }) => {
    await app.goto();
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.codecButton).toHaveText("Choose models");
    await app.codecButton.click();
    await expect(app.downloadDialog).toBeVisible();
    await expect(app.downloadDialog).toContainText("Start with one quality. The shared encoder is included with your first download.");
    await expect(app.dialogRow("12_5hz")).toContainText("suggested");
    await page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    expect(models.requests).toEqual([]);
    await expect(app.codecButton).toHaveText("Choose models");
  });

  test("Settings › Models opens the same dialog on top of the sheet; Escape peels one layer at a time", async ({ app, page }) => {
    await app.goto();
    await app.openSettings("Models");
    await app.settingsCodecButton.click();
    await expect(app.downloadDialog).toBeVisible();
    // Radix registers the new layer in an effect and re-renders; until then
    // the sheet still owns Escape (and the dialog is pointer-events: none).
    // Wait for the dialog to take the top layer before pressing.
    await expect(app.downloadDialog).toHaveCSS("pointer-events", "auto");
    await page.keyboard.press("Escape");
    await expect(app.downloadDialog).toBeHidden();
    await expect(app.settingsSheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(app.settingsSheet).toBeHidden();
  });
});
