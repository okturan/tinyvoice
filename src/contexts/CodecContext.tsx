import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { OrtInferenceSession } from "@/lib/ort-types";
import { getOrt } from "@/lib/ort-types";
import { loadModel, type ModelLoadProgress } from "@/lib/model-loader";
import { MODEL_BASE, SR } from "@/lib/constants";
import { clearModelCache as clearCache } from "@/lib/model-cache";
import { istft } from "@/lib/istft";

export type CodecState = "idle" | "loading" | "ready" | "error";

interface CodecContextValue {
  state: CodecState;
  statusText: string;
  progress: number;
  modelsLoaded: boolean;
  loadModels: () => Promise<void>;
  clearModelCache: () => Promise<void>;
  encode: (audio: Float32Array) => Promise<Uint8Array>;
  decode: (packet: Uint8Array) => Promise<Float32Array>;
}

const CodecContext = createContext<CodecContextValue | null>(null);

export function CodecProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CodecState>("idle");
  const [statusText, setStatusText] = useState("Not loaded");
  const [progress, setProgress] = useState(0);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  const encSessRef = useRef<OrtInferenceSession | null>(null);
  const compSessRef = useRef<OrtInferenceSession | null>(null);
  const decSessRef = useRef<OrtInferenceSession | null>(null);
  const istftWinRef = useRef<Float32Array | null>(null);

  const loadModels = useCallback(async () => {
    if (modelsLoaded) return;
    setState("loading");
    setProgress(0);
    const ort = getOrt();

    try {
      // iSTFT window
      setStatusText("iSTFT...");
      const wr = await fetch(MODEL_BASE + "istft_window.json");
      istftWinRef.current = new Float32Array(await wr.json());

      // Decoder (50hz)
      setStatusText("Decoder 50hz (135 MB)...");
      const decBuf = await loadModel("decoder_50hz.onnx", (info) => {
        setProgress(info.progress * 15);
        setStatusText(info.status);
      });
      decSessRef.current = await ort.InferenceSession.create(decBuf, {
        executionProviders: ["wasm"],
      });
      setProgress(15);

      // Encoder (WavLM)
      setStatusText("Encoder (595 MB)...");
      const encBuf = await loadModel("encoder.onnx", (info) => {
        setProgress(15 + info.progress * 65);
        setStatusText(info.status);
      });
      encSessRef.current = await ort.InferenceSession.create(encBuf, {
        executionProviders: ["wasm"],
      });
      setProgress(80);

      // Compressor (50hz)
      setStatusText("Compressor 50hz (70 MB)...");
      const compBuf = await loadModel("compressor_50hz.onnx", (info) => {
        setProgress(80 + info.progress * 15);
        setStatusText(info.status);
      });
      compSessRef.current = await ort.InferenceSession.create(compBuf, {
        executionProviders: ["wasm"],
      });
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

  const encode = useCallback(async (audio: Float32Array): Promise<Uint8Array> => {
    const ort = getOrt();
    const encSess = encSessRef.current;
    const compSess = compSessRef.current;
    if (!encSess || !compSess) throw new Error("Models not loaded");

    const feats = await encSess.run({
      audio: new ort.Tensor("float32", audio, [1, audio.length]),
    });
    const r = await compSess.run({ features: feats.features });
    const tok = r.tokens.data;

    // Pack: magic byte (0x01=50hz) + 16-bit LE tokens
    const pk = new Uint8Array(1 + tok.length * 2);
    pk[0] = 0x01;
    const dv = new DataView(pk.buffer);
    for (let i = 0; i < tok.length; i++) {
      dv.setUint16(1 + i * 2, Number(tok[i]), true);
    }
    return pk;
  }, []);

  const decode = useCallback(async (packet: Uint8Array): Promise<Float32Array> => {
    const ort = getOrt();
    const decSess = decSessRef.current;
    const win = istftWinRef.current;
    if (!decSess || !win) throw new Error("Models not loaded");

    // Strip magic byte header
    let tokenData = packet;
    if (
      packet.length >= 3 &&
      packet[0] >= 0x01 &&
      packet[0] <= 0x03 &&
      (packet.length - 1) % 2 === 0
    ) {
      tokenData = packet.slice(1);
    }

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
      tokens: new ort.Tensor("int64", tok, [1, n]),
    });
    return istft(
      r.magnitude.data as Float32Array,
      r.phase.data as Float32Array,
      win
    );
  }, []);

  const clearModelCacheFn = useCallback(async () => {
    await clearCache();
    setState("idle");
    setStatusText("Cache cleared");
    setProgress(0);
    setModelsLoaded(false);
    encSessRef.current = null;
    compSessRef.current = null;
    decSessRef.current = null;
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
