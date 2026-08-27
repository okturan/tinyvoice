import { defineConfig, type Plugin } from "vite";
import { readdirSync, rmSync } from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/**
 * Vite config for the Playwright suite. Identical to the production config
 * except that `@/lib/constants` resolves to a fixture that shrinks the pinned
 * model artifact sizes to 1 MiB each, so the fake HuggingFace route can serve
 * bodies the real model-loader accepts without streaming 1.2 GB per test.
 */
/**
 * `public/` may hold real multi-hundred-MB ONNX files on a developer machine
 * (gitignored). The app never loads them from its own origin, so drop them
 * from the e2e build output the same way `npm run deploy` does.
 */
function stripLocalModels(): Plugin {
  let outDir = "";
  return {
    name: "e2e-strip-local-models",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const entry of readdirSync(outDir)) {
        if (entry.endsWith(".onnx") || entry.endsWith(".onnx.data")) {
          rmSync(path.join(outDir, entry), { force: true });
        }
      }
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), tailwindcss(), stripLocalModels()],
  resolve: {
    alias: [
      {
        find: /^@\/lib\/constants$/,
        replacement: path.resolve(here, "fixtures/constants.e2e.ts"),
      },
      { find: "@", replacement: path.resolve(root, "src") },
    ],
  },
  server: { host: "localhost", port: 5174, strictPort: true },
});
