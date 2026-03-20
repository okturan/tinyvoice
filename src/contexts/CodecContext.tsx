import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { loadModel, type ModelLoadProgress } from "@/lib/model-loader";
import { MAGIC } from "@/lib/constants";
import { clearModelCache as clearCache } from "@/lib/model-cache";
import { istft } from "@/lib/istft";

export type CodecState = "idle" | "loading" | "ready" | "error";

type Quality = "50hz" | "25hz" | "12.5hz";

/** Invert MAGIC constant to map byte values back to quality keys */
const MAGIC_TO_QUALITY = Object.fromEntries(
  Object.entries(MAGIC).map(([k, v]) => [v, k])
) as Record<number, Quality>;

/** Maps quality key to model filename suffix (12.5hz -> 12_5hz) */
const QUALITY_FILE: Record<Quality, string> = {
  "50hz": "50hz",
  "25hz": "25hz",
  "12.5hz": "12_5hz",
};

interface CodecContextValue {
  state: CodecState;
  statusText: string;
  progress: number;
  modelsLoaded: boolean;
  loadModels: () => Promise<void>;
  clearModelCache: () => Promise<void>;
  encode: (audio: Float32Array, quality?: Quality) => Promise<Uint8Array>;
  decode: (packet: Uint8Array) => Promise<Float32Array>;
}

const CodecContext = createContext<CodecContextValue | null>(null);

/** Load a model file and create an ORT inference session */
async function loadAndCreateSession(
  name: string,
  onProgress: (info: ModelLoadProgress) => void
): Promise<ort.InferenceSession> {
  const buf = await loadModel(name, onProgress);
  return window.ort.InferenceSession.create(buf, {
    executionProviders: ["wasm"],
  });
}

/**
 * Lazy-loading session cache. Stores promises (not resolved sessions)
 * so concurrent callers for the same quality share a single load.
 */
type SessionCache = Partial<Record<Quality, Promise<ort.InferenceSession>>>;

function getOrLoadSession(
  cache: React.RefObject<SessionCache>,
  prefix: string,
  quality: Quality
): Promise<ort.InferenceSession> {
  const existing = cache.current[quality];
  if (existing) return existing;

  const suffix = QUALITY_FILE[quality];
  const promise = loadAndCreateSession(`${prefix}_${suffix}.onnx`, () => {});
  cache.current[quality] = promise;

  // Remove from cache on failure so retry is possible
  promise.catch(() => {
    delete cache.current[quality];
  });

  return promise;
}

export function CodecProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CodecState>("idle");
  const [statusText, setStatusText] = useState("Not loaded");
  const [progress, setProgress] = useState(0);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  const encSessRef = useRef<ort.InferenceSession | null>(null);
  const compSessions = useRef<SessionCache>({});
  const decSessions = useRef<SessionCache>({});
  const istftWinRef = useRef<Float32Array | null>(null);

  const loadModels = useCallback(async () => {
    if (modelsLoaded) return;
    setState("loading");
    setProgress(0);

    try {
      // iSTFT window (local static asset)
      setStatusText("iSTFT...");
      const wr = await fetch("/istft_window.json");
      istftWinRef.current = new Float32Array(await wr.json());

      // Decoder 50hz
      setStatusText("Decoder 50hz (135 MB)...");
      const decPromise = loadAndCreateSession("decoder_50hz.onnx", (info) => {
        setProgress(info.progress * 15);
        setStatusText(info.status);
      });
      decSessions.current["50hz"] = decPromise;
      await decPromise;
      setProgress(15);

      // Encoder (WavLM -- shared across all qualities)
      setStatusText("Encoder (595 MB)...");
      const encSess = await loadAndCreateSession("encoder.onnx", (info) => {
        setProgress(15 + info.progress * 65);
        setStatusText(info.status);
      });
      encSessRef.current = encSess;
      setProgress(80);

      // Compressor 50hz
      setStatusText("Compressor 50hz (70 MB)...");
      const compPromise = loadAndCreateSession("compressor_50hz.onnx", (info) => {
        setProgress(80 + info.progress * 15);
        setStatusText(info.status);
      });
      compSessions.current["50hz"] = compPromise;
      await compPromise;
      setProgress(100);

      setState("ready");
      setStatusText("Ready \u2014 encoder + 50hz comp/dec");
      setModelsLoaded(true);
    } catch (e) {
      setState("error");
      setStatusText("Error");
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("protobuf")) {
        await clearCache();
      }
      throw e;
    }
  }, [modelsLoaded]);

  const encode = useCallback(
    async (audio: Float32Array, quality: Quality = "50hz"): Promise<Uint8Array> => {
      const ortRuntime = window.ort;
      const encSess = encSessRef.current;
      if (!encSess) throw new Error("Models not loaded");

      const compSess = await getOrLoadSession(compSessions, "compressor", quality);

      const feats = await encSess.run({
        audio: new ortRuntime.Tensor("float32", audio, [1, audio.length]),
      });
      const r = await compSess.run({ features: feats.features });
      const tok = r.tokens.data;

      // Pack: magic byte + 16-bit LE tokens
      const pk = new Uint8Array(1 + tok.length * 2);
      pk[0] = MAGIC[quality];
      const dv = new DataView(pk.buffer);
      for (let i = 0; i < tok.length; i++) {
        dv.setUint16(1 + i * 2, Number(tok[i]), true);
      }
      return pk;
    },
    []
  );

  const decode = useCallback(
    async (packet: Uint8Array): Promise<Float32Array> => {
      const ortRuntime = window.ort;
      const win = istftWinRef.current;
      if (!win) throw new Error("Models not loaded");

      // Detect quality from magic byte
      let tokenData = packet;
      let quality: Quality = "50hz";
      if (
        packet.length >= 3 &&
        packet[0] >= 0x01 &&
        packet[0] <= 0x03 &&
        (packet.length - 1) % 2 === 0
      ) {
        quality = MAGIC_TO_QUALITY[packet[0]] ?? "50hz";
        tokenData = packet.slice(1);
      }

      // Lazy-load decoder for this quality
      const decSess = await getOrLoadSession(decSessions, "decoder", quality);

      const n = tokenData.length / 2;
      const tok = new BigInt64Array(n);
      const dv = new DataView(
        tokenData.buffer,
        tokenData.byteOffset,
        tokenData.byteLength
      );
      for (let i = 0; i < n; i++) {
        tok[i] = BigInt(dv.getUint16(i * 2, true));
      }

      const r = await decSess.run({
        tokens: new ortRuntime.Tensor("int64", tok, [1, n]),
      });
      return istft(
        r.magnitude.data as Float32Array,
        r.phase.data as Float32Array,
        win
      );
    },
    []
  );

  const clearModelCacheFn = useCallback(async () => {
    await clearCache();
    setState("idle");
    setStatusText("Cache cleared");
    setProgress(0);
    setModelsLoaded(false);
    encSessRef.current = null;
    compSessions.current = {};
    decSessions.current = {};
    istftWinRef.current = null;
  }, []);

  return (
    <CodecContext.Provider
      value={{
        state,
        statusText,
        progress,
        modelsLoaded,
        loadModels,
        clearModelCache: clearModelCacheFn,
        encode,
        decode,
      }}
    >
      {children}
    </CodecContext.Provider>
  );
}

export function useCodecContext(): CodecContextValue {
  const ctx = useContext(CodecContext);
  if (!ctx) throw new Error("useCodecContext must be used inside CodecProvider");
  return ctx;
}
