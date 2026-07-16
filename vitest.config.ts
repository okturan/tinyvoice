import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./worker/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
