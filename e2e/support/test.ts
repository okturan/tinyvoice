import { test as base, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModelServer } from "./model-server";
import { QrApp } from "./app";

const here = path.dirname(fileURLToPath(import.meta.url));
const ORT_STUB = path.join(here, "ort-stub.js");
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 5174}/`;

interface Fixtures {
  /** Fake HuggingFace: controls model download behaviour and records requests. */
  models: ModelServer;
  /** Page object for /qr. */
  app: QrApp;
  /** Uncaught page exceptions / unhandled rejections seen during the test. */
  pageErrors: string[];
}

interface Options {
  /** Fail the test if the page raised an uncaught error. Opt out with test.use({ strictPageErrors: false }). */
  strictPageErrors: boolean;
}

export const test = base.extend<Fixtures & Options>({
  strictPageErrors: [true, { option: true }],

  models: async ({ context }, use) => {
    // Hermetic network: only the Vite dev server is real. The relay lobby
    // poll gets an empty room list; the ORT CDN, fonts and everything else
    // are refused so a missing stub shows up as a failure, not a download.
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(APP_ORIGIN)) return route.continue();
      if (url.startsWith("http://localhost:8787/")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
      return route.abort("blockedbyclient");
    });
    const server = new ModelServer();
    await server.install(context);
    await context.addInitScript({ path: ORT_STUB });
    await use(server);
  },

  pageErrors: async ({ page, strictPageErrors }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use(errors);
    if (strictPageErrors) {
      expect(errors, "uncaught page errors").toEqual([]);
    }
  },

  app: async ({ page, models, pageErrors }, use) => {
    void models;
    void pageErrors;
    await use(new QrApp(page));
  },
});

export { expect };
