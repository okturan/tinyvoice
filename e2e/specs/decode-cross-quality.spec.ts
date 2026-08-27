/**
 * Cross-quality decode matrix: what the Decode tab shows — and what it
 * downloads on Play — for every combination of {loaded models} × {incoming
 * packet quality}, plus decoder overrides and wrong-decoder playback.
 */
import { test, expect } from "../support/test";
import {
  ALL_QUALITIES,
  LABEL,
  initialStatus,
  legacyPacket,
  packetSeconds,
  toBase64,
  toHex,
  tokensFor,
  type Quality,
} from "../support/packets";

const OTHER: Record<Quality, Quality> = { "12_5hz": "50hz", "25hz": "12_5hz", "50hz": "25hz" };

function modelsFor(q: Quality): string[] {
  return [`compressor_${q}.onnx`, `decoder_${q}.onnx`];
}

test.describe("nothing loaded", () => {
  for (const q of ALL_QUALITIES) {
    test(`a ${LABEL[q]} packet offers its own models and downloads exactly them on Play`, async ({ app, models }) => {
      const bytes = packetSeconds(q, 2);
      await app.goto({ v: toBase64(bytes) });

      await expect(app.playerStatus).toHaveText(initialStatus(bytes, q));
      await expect(app.downloadModelsButton).toHaveText(`Download ${LABEL[q]} models`);
      await expect(app.downloadModelsButton).toBeEnabled();
      await expect(app.playButton).toBeEnabled();
      await expect(app.playButton).toHaveAttribute("aria-label", "Play voice packet");

      // Auto names the packet's own quality; the other two rates are offered.
      expect(await app.decoderLabels()).toEqual([
        `Auto (${LABEL[q]})`,
        ...ALL_QUALITIES.filter((o) => o !== q).map((o) => LABEL[o]),
      ]);
      expect(await app.selectedDecoderLabels()).toEqual([`Auto (${LABEL[q]})`]);

      await app.playButton.click();
      await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback", { timeout: 15_000 });
      // Current behaviour: Play routes through CodecContext.loadModels, which
      // always fetches the shared encoder + compressor as well, although only
      // the decoder runs. That is ~800 MB in production for a recipient who
      // just wants to listen (see the "decoder-only playback" finding).
      expect([...models.requests].sort()).toEqual(["encoder.onnx", ...modelsFor(q)].sort());
      await expect(app.playerStatus).toHaveText(`2.0s decoded from ${bytes.length} bytes`);
      await expect(app.playerStatus).toHaveClass(/--green/);
      await expect(app.downloadModelsButton).toBeHidden();

      const { runs } = await app.ortState();
      expect(runs.map((r) => r.model)).toEqual([`decoder_${q}.onnx`]);
    });
  }
});

test.describe("another quality is loaded", () => {
  for (const q of ALL_QUALITIES) {
    const loaded = OTHER[q];
    test(`${LABEL[loaded]} loaded, ${LABEL[q]} packet arrives → still needs ${LABEL[q]}; Play fetches only the ${LABEL[q]} pair`, async ({ app, models }) => {
      const bytes = packetSeconds(q, 1.6);
      await app.goto({ v: toBase64(bytes) });
      await app.loadModelsViaSettings([loaded]);
      expect([...models.requests].sort()).toEqual(["encoder.onnx", ...modelsFor(loaded)].sort());

      // The player does not pretend the other decoder will do.
      await expect(app.downloadModelsButton).toHaveText(`Download ${LABEL[q]} models`);
      await expect(app.playButton).toBeEnabled();
      await expect(app.playerStatus).toHaveText(initialStatus(bytes, q));

      await app.playButton.click();
      await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback", { timeout: 15_000 });
      // The shared encoder is already in memory — only the new pair is fetched.
      expect(models.requests.slice(3).sort()).toEqual(modelsFor(q).sort());
      await expect(app.playerStatus).toHaveText(`1.6s decoded from ${bytes.length} bytes`);
    });
  }

  test("overriding to the loaded decoder removes the download prompt and plays with the wrong rate", async ({ app, models }) => {
    // 2 s at 50 hz = 100 tokens. Decoded with the 12.5 hz decoder that is 8 s.
    const bytes = packetSeconds("50hz", 2);
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);
    await expect(app.downloadModelsButton).toHaveText("Download 50hz models");

    await app.decoderButton("12.5hz").click();
    await expect(app.playerStatus).toHaveText("Decoder set to 12.5hz");
    await expect(app.downloadModelsButton).toBeHidden();
    expect(await app.selectedDecoderLabels()).toEqual(["12.5hz"]);

    const before = models.requests.length;
    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback", { timeout: 15_000 });
    expect(models.requests.length).toBe(before);
    await expect(app.playerStatus).toHaveText(`8.0s decoded from ${bytes.length} bytes`);
    const { runs } = await app.ortState();
    expect(runs.map((r) => r.model)).toEqual(["decoder_12_5hz.onnx"]);
    expect(runs[0]!.dims.tokens).toEqual([1, 100]);

    // Back to Auto: the packet's own quality is still missing.
    await app.decoderButton("Auto (50hz)").click();
    await expect(app.playerStatus).toHaveText("Decoder set to Auto (50hz)");
    await expect(app.downloadModelsButton).toHaveText("Download 50hz models");
    await expect(app.playButton).toHaveAttribute("aria-label", "Play voice packet");
  });

  test("overriding to an unloaded decoder retargets the download prompt and Play fetches that pair", async ({ app, models }) => {
    const bytes = packetSeconds("12_5hz", 2);
    await app.goto({ v: toBase64(bytes) });
    await app.loadModelsViaSettings(["12_5hz"]);
    await expect(app.downloadModelsButton).toBeHidden();

    await app.decoderButton("25hz").click();
    await expect(app.downloadModelsButton).toHaveText("Download 25hz models");
    await expect(app.playerStatus).toHaveText("Decoder set to 25hz");

    models.set("*", { delayMs: 1500 });
    await app.playButton.click();
    await expect(app.playButton).toBeDisabled();
    await expect(app.downloadModelsButton).toHaveText("Loading models...");
    await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback", { timeout: 15_000 });
    expect(models.requests.slice(3).sort()).toEqual(modelsFor("25hz").sort());
    // 25 tokens through the 25 hz decoder = 1 s.
    await expect(app.playerStatus).toHaveText(`1.0s decoded from ${bytes.length} bytes`);
    await expect(app.downloadModelsButton).toBeHidden();
  });

  test("the Download button itself fetches the override quality without playing", async ({ app, models }) => {
    const bytes = packetSeconds("25hz", 1);
    await app.goto({ v: toBase64(bytes) });
    await app.decoderButton("50hz").click();
    await app.downloadModelsButton.click();
    await expect(app.downloadModelsButton).toBeHidden({ timeout: 15_000 });
    expect([...models.requests].sort()).toEqual(["encoder.onnx", ...modelsFor("50hz")].sort());
    await expect(app.playButton).toHaveAttribute("aria-label", "Play voice packet");
    const { runs } = await app.ortState();
    expect(runs).toEqual([]);
  });
});

test.describe("several qualities loaded", () => {
  test("12.5hz + 25hz loaded: 25hz packet plays at once, 50hz packet still asks", async ({ app, models }) => {
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    await app.loadModelsViaSettings(["12_5hz", "25hz"]);
    expect([...models.requests].sort()).toEqual(
      ["encoder.onnx", ...modelsFor("12_5hz"), ...modelsFor("25hz")].sort(),
    );

    const p25 = packetSeconds("25hz", 1, 1);
    await app.submitHex(toHex(p25));
    await expect(app.playerStatus).toHaveText(initialStatus(p25, "25hz"));
    await expect(app.downloadModelsButton).toBeHidden();
    await app.playButton.click();
    await expect(app.playerStatus).toHaveText(`1.0s decoded from ${p25.length} bytes`, { timeout: 15_000 });

    const p50 = packetSeconds("50hz", 1, 2);
    await app.submitHex(toHex(p50));
    await expect(app.playerStatus).toHaveText(initialStatus(p50, "50hz"));
    await expect(app.downloadModelsButton).toHaveText("Download 50hz models");
    expect(models.requests.length).toBe(5);
  });
});

test.describe("legacy packets (no magic byte)", () => {
  test("fall back to 50hz, say so everywhere, and hide the redundant 50hz override", async ({ app, models }) => {
    const bytes = legacyPacket(tokensFor(50, 3)); // 1 s at 50 hz
    await app.goto({ v: toBase64(bytes) });
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "50hz", true));
    await expect(app.playerStatus).toContainText("(legacy fallback)");
    expect(await app.decoderLabels()).toEqual(["Auto (50hz, legacy fallback)", "12.5hz", "25hz"]);
    await expect(app.downloadModelsButton).toHaveText("Download 50hz models");

    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback", { timeout: 15_000 });
    expect([...models.requests].sort()).toEqual(["encoder.onnx", ...modelsFor("50hz")].sort());
    await expect(app.playerStatus).toHaveText(`1.0s decoded from ${bytes.length} bytes`);

    await app.decoderButton("12.5hz").click();
    await expect(app.playerStatus).toHaveText("Decoder set to 12.5hz");
    await app.decoderButton("Auto (50hz, legacy fallback)").click();
    await expect(app.playerStatus).toHaveText("Decoder set to Auto (50hz, legacy fallback)");
  });
});

test.describe("while models are downloading", () => {
  test("a download started elsewhere for another quality parks the player until it finishes", async ({ app, models }) => {
    const bytes = packetSeconds("12_5hz", 1);
    await app.goto({ v: toBase64(bytes) });
    models.set("*", { hang: true });

    await app.openSettings("Models");
    await app.settingsCodecButton.click();
    await app.startDialogDownload(["50hz"]);
    await expect(app.downloadDialog.getByRole("button", { name: "Cancel download" })).toBeVisible();
    await app.page.keyboard.press("Escape"); // close the dialog
    await app.closeSettings();

    await expect(app.playButton).toBeDisabled();
    await expect(app.downloadModelsButton).toHaveText("Loading models...");
    await expect(app.downloadModelsButton).toBeDisabled();
    await expect(app.playerCard.getByRole("progressbar")).toBeVisible();
    // The line now mirrors CodecContext.statusText for the unrelated 50hz load.
    await expect(app.playerStatus).toHaveText(/Loading models\.\.\.|MB/);

    models.release();
    await expect(app.playButton).toBeEnabled({ timeout: 15_000 });
    await expect(app.downloadModelsButton).toHaveText("Download 12.5hz models");
    await expect(app.playerCard.getByRole("progressbar")).toBeHidden();
    await expect(app.playerStatus).toHaveText(initialStatus(bytes, "12_5hz"));
  });

  test("cancelling the download Play started reports it and re-arms Play", async ({ app, models }) => {
    const bytes = packetSeconds("25hz", 1);
    await app.goto({ v: toBase64(bytes) });
    models.set("*", { hang: true });

    await app.playButton.click();
    await expect(app.playButton).toBeDisabled();
    await expect(app.downloadModelsButton).toHaveText("Loading models...");
    await expect.poll(() => models.hungCount).toBe(3);

    await app.openSettings("Models");
    await app.settingsSheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await app.closeSettings();

    await expect(app.playerStatus).toHaveText("Download cancelled");
    await expect(app.playButton).toBeEnabled();
    await expect(app.playButton).toHaveAttribute("aria-label", "Play voice packet");
    await expect(app.downloadModelsButton).toHaveText("Download 25hz models");

    // A second attempt downloads again from scratch.
    models.reset();
    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback", { timeout: 15_000 });
    expect(models.requests.length).toBe(6);
  });

  test("deleting downloaded models while a packet is loaded brings the prompt back", async ({ app, models }) => {
    const bytes = packetSeconds("12_5hz", 1);
    await app.goto({ v: toBase64(bytes) });
    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback", { timeout: 15_000 });
    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Play voice packet");
    await expect(app.downloadModelsButton).toBeHidden();

    await app.deleteModelsViaSettings();
    await expect(app.downloadModelsButton).toHaveText("Download 12.5hz models");

    // The decoded buffer is still cached in the player, so Play just replays it.
    await app.playButton.click();
    await expect(app.playButton).toHaveAttribute("aria-label", "Stop voice playback");
    expect(models.requests.length).toBe(3);
  });
});

test.describe("decoder override across packets", () => {
  test("a new packet resets the decoder to Auto", async ({ app }) => {
    // BUG: DecodePlayer keeps `qualityOverride` in component state and is not
    // remounted when DecodePanel swaps packets, so an override chosen for one
    // packet silently applies to the next one (QRResult on the Record tab
    // does reset its override on a new packet). See DecodePlayer.tsx
    // qualityOverride state + the packetBytes effect that resets everything
    // except it.
    test.fail();
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    const first = packetSeconds("12_5hz", 1, 1);
    await app.submitHex(toHex(first));
    await expect(app.playerStatus).toHaveText(initialStatus(first, "12_5hz"));
    await app.decoderButton("25hz").click();
    await expect(app.playerStatus).toHaveText("Decoder set to 25hz");
    expect(await app.selectedDecoderLabels()).toEqual(["25hz"]);

    const next = packetSeconds("50hz", 1, 2);
    await app.submitHex(toHex(next));
    await expect(app.playerStatus).toHaveText(initialStatus(next, "50hz"));
    expect(await app.selectedDecoderLabels()).toEqual(["Auto (50hz)"]);
    await expect(app.downloadModelsButton).toHaveText("Download 50hz models");
  });

  test("a new packet whose quality equals the stale override still highlights a decoder", async ({ app }) => {
    // BUG: same root cause as above. With override=25hz and a 25hz packet
    // arriving, the 25hz button is filtered out (it equals parsed.quality)
    // and Auto is not highlighted because qualityOverride is set — so no
    // decoder button is selected at all.
    test.fail();
    await app.presetEthos("split-deck");
    await app.goto({ tab: "decode" });
    const first = packetSeconds("12_5hz", 1, 1);
    await app.submitHex(toHex(first));
    await expect(app.playerStatus).toHaveText(initialStatus(first, "12_5hz"));
    await app.decoderButton("25hz").click();
    await expect(app.playerStatus).toHaveText("Decoder set to 25hz");

    const next = packetSeconds("25hz", 1, 2);
    await app.submitHex(toHex(next));
    await expect(app.playerStatus).toHaveText(initialStatus(next, "25hz"));
    expect(await app.decoderLabels()).toEqual(["Auto (25hz)", "12.5hz", "50hz"]);
    expect(await app.selectedDecoderLabels()).toEqual(["Auto (25hz)"]);
  });
});
