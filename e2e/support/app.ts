import { expect, type Locator, type Page } from "@playwright/test";
import { LABEL, type Quality } from "./packets";

export type Ethos = "stage-swap" | "split-deck";
export type PageTab = "record" | "decode";
export type SourceTab = "hex" | "upload" | "camera";

export interface OrtControls {
  delayMs?: number;
  createDelayMs?: number;
  failRun?: string | null;
  failCreate?: string | null;
  failMessage?: string;
}

export interface OrtState {
  sessions: string[];
  runs: { model: string; dims: Record<string, number[]> }[];
}

const TAB_LABEL: Record<PageTab, string> = { record: "Record", decode: "Decode" };
const SOURCE_LABEL: Record<SourceTab, string> = { hex: "Hex", upload: "Upload", camera: "Camera" };

/**
 * Page object for /qr. Locators are role/text based so the specs read like
 * the UI; nothing here relies on test ids.
 */
export class QrApp {
  constructor(readonly page: Page) {}

  // ── Navigation ────────────────────────────────────────────────

  /** Open /qr (optionally with a ?v= payload) and wait for the tab bar. */
  async goto(opts: { v?: string; tab?: PageTab } = {}): Promise<void> {
    await this.page.goto(opts.v ? `/qr?v=${encodeURIComponent(opts.v)}` : "/qr");
    await expect(this.tab("record")).toBeVisible();
    if (opts.tab) await this.openTab(opts.tab);
  }

  /** Persist a layout ethos before the app boots (survives reloads). */
  async presetEthos(ethos: Ethos): Promise<void> {
    await this.page.addInitScript((value) => {
      localStorage.setItem("tinyvoice-layout", value);
    }, ethos);
  }

  tab(name: PageTab): Locator {
    return this.page.getByRole("tab", { name: TAB_LABEL[name], exact: true });
  }

  async openTab(name: PageTab): Promise<void> {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute("data-state", "active");
  }

  // ── Decode tab: sources ───────────────────────────────────────

  sourceTab(name: SourceTab): Locator {
    return this.page.getByRole("tab", { name: SOURCE_LABEL[name], exact: true });
  }

  async openSource(name: SourceTab): Promise<void> {
    await this.sourceTab(name).click();
    await expect(this.sourceTab(name)).toHaveAttribute("data-state", "active");
  }

  get hexTextarea(): Locator {
    return this.page.getByLabel("Hexadecimal bytes");
  }

  get decodeHexButton(): Locator {
    return this.page.getByRole("button", { name: "Decode hex", exact: true });
  }

  get editHexButton(): Locator {
    return this.page.getByRole("button", { name: "Edit hex", exact: true });
  }

  /** Type hex into the Hex source and submit it. */
  async submitHex(text: string): Promise<void> {
    await this.openSource("hex");
    if (await this.editHexButton.isVisible()) await this.editHexButton.click();
    await this.hexTextarea.fill(text);
    await this.decodeHexButton.click();
  }

  get fileInput(): Locator {
    return this.page.locator('input[type="file"]');
  }

  /** Upload a file through the Dropzone's hidden input. */
  async uploadFile(name: string, buffer: Buffer | Uint8Array, mimeType: string): Promise<void> {
    await this.openSource("upload");
    await this.fileInput.setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });
  }

  get startCameraButton(): Locator {
    return this.page.getByRole("button", { name: "Start Camera" });
  }

  get stopCameraButton(): Locator {
    return this.page.getByRole("button", { name: "Stop Camera" });
  }

  /**
   * The red panel-level error line under the sources (DecodePanel `error`).
   * Excludes HexInput's inline alert and DecodePlayer's own status line.
   */
  get sourceError(): Locator {
    return this.page
      .locator("p.text-xs.text-\\[var\\(--red\\)\\]:not([role=\"alert\"])")
      .and(this.page.locator(":not([data-slot=\"card-content\"] p)"));
  }

  /** HexInput's own inline validation message. */
  get hexInlineError(): Locator {
    return this.page.getByRole("alert");
  }

  // ── Decode tab: player ────────────────────────────────────────

  /** The card that wraps DecodePlayer (labelled "Player"). */
  get playerCard(): Locator {
    return this.page.locator('[data-slot="card-content"]', {
      has: this.page.getByText("Player", { exact: true }),
    });
  }

  get playButton(): Locator {
    return this.page.getByRole("button", {
      name: /^(Play voice packet|Stop voice playback|Decoding voice packet)$/,
    });
  }

  get downloadModelsButton(): Locator {
    return this.playerCard.getByRole("button", {
      name: /^(Download .+ decoder \(~\d+ MB\)|Download .+ models|Loading models\.\.\.)$/,
    });
  }

  /** DecodePlayer's single status <p>. */
  get playerStatus(): Locator {
    return this.playerCard.locator("p");
  }

  get playerHexButton(): Locator {
    return this.playerCard.getByRole("button", { name: "Hex", exact: true });
  }

  get newSourceButton(): Locator {
    return this.page.getByRole("button", { name: "← New source" });
  }

  get playerPlaceholder(): Locator {
    return this.page.getByText("Load a packet — the player appears here");
  }

  // ── Decoder override row (shared by DecodePlayer and QRResult) ──

  get decoderRow(): Locator {
    return this.page.locator("div", { has: this.page.getByText("Decoder:", { exact: true }) }).last();
  }

  decoderButtons(): Locator {
    return this.decoderRow.getByRole("button");
  }

  decoderButton(label: string | RegExp): Locator {
    return this.decoderRow.getByRole("button", { name: label, exact: typeof label === "string" });
  }

  async decoderLabels(): Promise<string[]> {
    return (await this.decoderButtons().allInnerTexts()).map((t) => t.trim());
  }

  async expectDecoderSelected(label: string | RegExp): Promise<void> {
    await expect(this.decoderButton(label)).toHaveClass(/font-semibold/);
  }

  async selectedDecoderLabels(): Promise<string[]> {
    const buttons = this.decoderButtons();
    const out: string[] = [];
    for (let i = 0; i < (await buttons.count()); i++) {
      const b = buttons.nth(i);
      if (/font-semibold/.test((await b.getAttribute("class")) ?? "")) out.push((await b.innerText()).trim());
    }
    return out;
  }

  // ── Hex sheet ─────────────────────────────────────────────────

  get hexSheet(): Locator {
    return this.page.getByRole("dialog", { name: "Token Data" });
  }

  // ── Record tab ────────────────────────────────────────────────

  qualityRadio(quality: Quality): Locator {
    return this.page.getByRole("radio", { name: new RegExp(`^${LABEL[quality].replace(".", "\\.")}\\b`) });
  }

  /** The quality option's clickable label (the radio itself is sr-only). */
  qualityOption(quality: Quality): Locator {
    return this.qualityRadio(quality).locator("xpath=ancestor::label[1]");
  }

  async pickQuality(quality: Quality): Promise<void> {
    await this.qualityOption(quality).click();
    await expect(this.qualityRadio(quality)).toHaveAttribute("aria-checked", "true");
  }

  get codecCard(): Locator {
    return this.page.locator('[data-slot="card"]', {
      has: this.page.getByText("Codec", { exact: true }),
    });
  }

  /** The codec card's primary button, whatever it currently says. */
  get codecButton(): Locator {
    return this.codecCard.getByRole("button", {
      name: /^(Choose models|Load cached models|Loading models\.\.\.|Enable microphone)$/,
    });
  }

  get codecCancelButton(): Locator {
    return this.codecCard.getByRole("button", { name: "Cancel download" });
  }

  /** The `<p>` status under the codec card (only rendered when showDisplayStatus). */
  get codecStatus(): Locator {
    return this.codecCard.locator("p");
  }

  get holdButton(): Locator {
    return this.page.getByRole("button", { name: /^(HOLD|ENCODING)/ });
  }

  get recordingTimer(): Locator {
    return this.page.locator("span.tabular-nums", { hasText: /\d\.\ds/ });
  }

  get trimSwitch(): Locator {
    return this.page.getByRole("switch", { name: "Trim lead-in silence" });
  }

  /** Hold the record button for `ms` using real pointer events. */
  async hold(ms: number): Promise<void> {
    const box = await this.holdButton.boundingBox();
    if (!box) throw new Error("HOLD button is not on screen");
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.down();
    await this.page.waitForTimeout(ms);
    await this.page.mouse.up();
  }

  /** Hold, release, and wait for the QR result to render. */
  async record(ms = 900): Promise<void> {
    await this.hold(ms);
    await expect(this.qrImage).toBeVisible({ timeout: 15_000 });
  }

  // ── Record result (QRResult) ──────────────────────────────────

  get qrImage(): Locator {
    return this.page.getByRole("img", { name: "QR code" });
  }

  get previewButton(): Locator {
    return this.qrImage.locator("xpath=..").getByRole("button", {
      name: /^(Preview|Playing\.\.\.|Loading\.\.\.)$/,
    }).and(this.page.locator('[data-variant="outline"]'));
  }

  get copyUrlButton(): Locator {
    return this.page.getByRole("button", { name: /^(Copy URL|Copied!|Copy failed)$/ });
  }

  get copyHexButton(): Locator {
    return this.page.getByRole("button", { name: /^(Copy hex|Hex copied!|Copy failed)$/ });
  }

  get saveHexButton(): Locator {
    return this.page.getByRole("button", { name: "Save hex", exact: true });
  }

  get downloadQrButton(): Locator {
    return this.page.getByRole("button", { name: "Download", exact: true });
  }

  get resultHexButton(): Locator {
    return this.page.getByRole("button", { name: "Hex", exact: true });
  }

  get newRecordingButton(): Locator {
    return this.page.getByRole("button", { name: "← New recording" });
  }

  get resultPlaceholder(): Locator {
    return this.page.getByText("Hold to record — your QR appears here");
  }

  /** The QRResult block (QR image + metadata + actions). */
  get resultBlock(): Locator {
    return this.qrImage.locator("xpath=..");
  }

  /** Metadata row values: bytes, tokens, seconds. */
  async resultMeta(): Promise<{ bytes: number; tokens: number; seconds: number }> {
    const block = this.resultBlock;
    const bytes = Number(await block.locator("span", { hasText: /^\d+ bytes$/ }).first().locator("b").innerText());
    const tokens = Number(await block.locator("span", { hasText: /^\d+ tokens$/ }).first().locator("b").innerText());
    const seconds = Number(await block.locator("span", { hasText: /^\d+\.\ds$/ }).first().locator("b").innerText());
    return { bytes, tokens, seconds };
  }

  /** Read the generated QR's payload URL back out of the img data URL. */
  async resultUrl(): Promise<string> {
    await this.copyUrlButton.click();
    await expect(this.copyUrlButton).toHaveText("Copied!");
    return this.page.evaluate(() => navigator.clipboard.readText());
  }

  // ── Settings sheet & model dialog ─────────────────────────────

  get settingsButton(): Locator {
    return this.page.locator("div.h-12 > button").last();
  }

  get settingsSheet(): Locator {
    return this.page.getByRole("dialog", { name: "Settings" });
  }

  async openSettings(tab?: "General" | "Audio" | "Models"): Promise<void> {
    if (!(await this.settingsSheet.isVisible())) await this.settingsButton.click();
    await expect(this.settingsSheet).toBeVisible();
    if (tab) {
      await this.settingsSheet.getByRole("tab", { name: tab, exact: true }).click();
    }
  }

  async closeSettings(): Promise<void> {
    if (await this.settingsSheet.isVisible()) {
      await this.page.keyboard.press("Escape");
      await expect(this.settingsSheet).toBeHidden();
    }
  }

  /** The Settings › Models codec button ("Choose models" / "Change models" / "Loading models..."). */
  get settingsCodecButton(): Locator {
    return this.settingsSheet.getByRole("button", { name: /^(Choose models|Change models|Loading models\.\.\.)$/ });
  }

  get settingsCodecStatus(): Locator {
    return this.settingsSheet.locator("span.font-mono").first();
  }

  get downloadDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Download models" });
  }

  /** A quality row inside the download dialog. */
  dialogRow(quality: Quality): Locator {
    return this.downloadDialog
      .getByText(LABEL[quality], { exact: true })
      .locator("xpath=ancestor::*[contains(@class,'rounded-md')][1]");
  }

  /** Switch the dialog to multi-select and return the footer action button. */
  async selectMultiple(qualities: Quality[]): Promise<Locator> {
    await this.downloadDialog.getByRole("button", { name: "Select multiple qualities" }).click();
    for (const q of qualities) {
      const box = this.dialogRow(q).getByRole("checkbox");
      if (!(await box.isChecked())) await box.check();
    }
    return this.downloadDialog.getByRole("button", {
      name: /^(Download selected \(~\d+ MB\)|Load selected from cache|Select a quality)$/,
    });
  }

  /** Open Settings › Models › Choose/Change models and download `qualities`. Waits for the dialog to close. */
  async loadModelsViaSettings(qualities: Quality[]): Promise<void> {
    await this.openSettings("Models");
    await this.settingsCodecButton.click();
    await expect(this.downloadDialog).toBeVisible();
    await this.startDialogDownload(qualities);
    await expect(this.downloadDialog).toBeHidden({ timeout: 20_000 });
    await this.closeSettings();
  }

  /** Click the right buttons inside an already-open download dialog. Does not wait for completion. */
  async startDialogDownload(qualities: Quality[]): Promise<void> {
    if (qualities.length === 1) {
      await this.dialogRow(qualities[0]!)
        .getByRole("button", { name: /^(Download \(~\d+ MB\)|Load from cache)$/ })
        .click();
    } else {
      const go = await this.selectMultiple(qualities);
      await go.click();
    }
  }

  async deleteModelsViaSettings(): Promise<void> {
    await this.openSettings("Models");
    await this.settingsSheet.getByRole("button", { name: "Delete downloaded models" }).first().click();
    await this.settingsSheet.getByRole("button", { name: "Yes, delete models" }).click();
    await this.closeSettings();
  }

  async switchEthosViaSettings(ethos: Ethos): Promise<void> {
    await this.openSettings("General");
    await this.settingsSheet
      .getByRole("button", { name: ethos === "split-deck" ? /^Split Deck/ : /^Stage Swap/ })
      .click();
    await this.closeSettings();
  }

  // ── ORT stub controls ─────────────────────────────────────────

  async setOrt(controls: OrtControls): Promise<void> {
    await this.page.evaluate((c) => {
      Object.assign((window as unknown as { __tv: Record<string, unknown> }).__tv, c);
    }, controls);
  }

  async ortState(): Promise<OrtState> {
    return this.page.evaluate(() => {
      const s = (window as unknown as { __tv: OrtState }).__tv;
      return { sessions: [...s.sessions], runs: JSON.parse(JSON.stringify(s.runs)) };
    });
  }

  async localStorageItem(key: string): Promise<string | null> {
    return this.page.evaluate((k) => localStorage.getItem(k), key);
  }
}
