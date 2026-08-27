import type { BrowserContext, Route } from "@playwright/test";

export const E2E_MODEL_BYTES = 1024 * 1024;
export const MODEL_NAMES = [
  "encoder.onnx",
  "compressor_50hz.onnx",
  "decoder_50hz.onnx",
  "compressor_25hz.onnx",
  "decoder_25hz.onnx",
  "compressor_12_5hz.onnx",
  "decoder_12_5hz.onnx",
] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

export interface ModelBehavior {
  /** Wait this long before answering (lets tests observe "loading" states). */
  delayMs?: number;
  /** Answer with this HTTP status instead of a body. */
  status?: number;
  /** Never answer until `release()` is called (for cancel / abort tests). */
  hang?: boolean;
}

const MODEL_URL = /^https:\/\/huggingface\.co\/skymorphosis\/focalcodec-onnx\/resolve\/[0-9a-f]+\/([a-z0-9_.-]+\.onnx)$/i;

function fakeBody(name: string): Buffer {
  const body = Buffer.alloc(E2E_MODEL_BYTES, 0);
  body.write(name, 0, "ascii");
  body[name.length] = 0;
  return body;
}

/**
 * Stands in for HuggingFace. Every model is a 1 MiB body whose first bytes
 * spell the model name (the ORT stub reads it back). Per-model or default
 * behaviour can be changed mid-test.
 */
export class ModelServer {
  /** Model names requested, in order. */
  readonly requests: string[] = [];
  private behaviors = new Map<string, ModelBehavior>();
  private defaultBehavior: ModelBehavior = {};
  private hung: Array<() => void> = [];
  private bodies = new Map<string, Buffer>();

  async install(context: BrowserContext): Promise<void> {
    await context.route(MODEL_URL, (route) => this.handle(route));
  }

  /** Set behaviour for one model (or "*" for the default). */
  set(name: ModelName | "*", behavior: ModelBehavior): void {
    if (name === "*") this.defaultBehavior = behavior;
    else this.behaviors.set(name, behavior);
  }

  reset(): void {
    this.behaviors.clear();
    this.defaultBehavior = {};
    this.release();
  }

  /** Let every hung request complete. */
  release(): void {
    const pending = this.hung;
    this.hung = [];
    for (const resolve of pending) resolve();
  }

  /** How many requests are currently parked by `hang`. */
  get hungCount(): number {
    return this.hung.length;
  }

  requestsFor(name: string): number {
    return this.requests.filter((r) => r === name).length;
  }

  private async handle(route: Route): Promise<void> {
    const match = MODEL_URL.exec(route.request().url());
    const name = match?.[1] ?? "";
    this.requests.push(name);
    const behavior = this.behaviors.get(name) ?? this.defaultBehavior;

    if (behavior.hang) {
      await new Promise<void>((resolve) => this.hung.push(resolve));
    }
    if (behavior.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, behavior.delayMs));
    }
    try {
      if (behavior.status && behavior.status !== 200) {
        await route.fulfill({ status: behavior.status, body: "" });
        return;
      }
      if (!(MODEL_NAMES as readonly string[]).includes(name)) {
        await route.fulfill({ status: 404, body: "" });
        return;
      }
      let body = this.bodies.get(name);
      if (!body) {
        body = fakeBody(name);
        this.bodies.set(name, body);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "content-length": String(body.length) },
        body,
      });
    } catch {
      // The page aborted the fetch (cancelled download) — nothing to do.
    }
  }
}
