import { defineConfig, devices } from "@playwright/test";
import { FAKE_CAMERA_Y4M, FAKE_MIC_WAV } from "./e2e/support/media";

const PORT = Number(process.env.E2E_PORT ?? 5174);
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e/specs",
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_500 },
  outputDir: "e2e/.results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    permissions: ["microphone", "camera", "clipboard-read", "clipboard-write"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`,
        `--use-file-for-fake-video-capture=${FAKE_CAMERA_Y4M}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // The suite runs against a production build served by `vite preview`:
  // no HMR, no dependency re-optimisation reloads mid-test, and the bundle
  // under test is the one users get. Rebuilds when you change app code —
  // for interactive debugging keep `npm run dev:e2e` running instead.
  webServer: {
    command: `npx vite build --config e2e/vite.e2e.config.ts --outDir e2e/.build --logLevel warn && npx vite preview --config e2e/vite.e2e.config.ts --outDir e2e/.build --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
