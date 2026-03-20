import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { codec } from "@/lib/codec-service";
import { Quality } from "@/types/codec";
import { clearModelCache as clearCache } from "@/lib/model-cache";

export type CodecState = "idle" | "loading" | "ready" | "error";

interface CodecContextValue {
  state: CodecState;
  statusText: string;
  progress: number;
  modelsLoaded: boolean;
  modelsCached: boolean;
  loadModels: () => Promise<void>;
  abortLoading: () => void;
  clearModelCache: () => Promise<void>;
  encode: (audio: Float32Array, quality?: Quality) => Promise<Uint8Array>;
  decode: (packet: Uint8Array) => Promise<Float32Array>;
}

const CodecContext = createContext<CodecContextValue | null>(null);

export function CodecProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CodecState>("idle");
  const [statusText, setStatusText] = useState("Not loaded");
  const [progress, setProgress] = useState(0);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsCached, setModelsCached] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const lastProgressUpdate = useRef(0);

  // Check if core models are already cached in IndexedDB on mount
  useEffect(() => {
    codec.isCoreModelsCached().then((cached) => {
      if (cached) {
        setModelsCached(true);
        setStatusText("Cached \u2014 tap Load to initialize");
      }
    });
  }, []);

  const setProgressThrottled = useCallback((value: number) => {
    const now = Date.now();
    if (value >= 100 || value === 0 || now - lastProgressUpdate.current > 150) {
      lastProgressUpdate.current = now;
      setProgress(Math.round(value));
    }
  }, []);

  const loadModels = useCallback(async () => {
    if (modelsLoaded || abortControllerRef.current) return;
    setState("loading");
    setProgressThrottled(0);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await codec.loadAll(
        Quality.Hz50,
        (info) => {
          setProgressThrottled(info.fraction * 100);
          setStatusText(info.status);
        },
        controller.signal,
      );

      setState("ready");
      setStatusText("Ready \u2014 encoder + 50hz comp/dec");
      setModelsLoaded(true);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setState("error");
      setStatusText("Error");
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("protobuf")) await clearCache();
      throw e;
    } finally {
      abortControllerRef.current = null;
    }
  }, [modelsLoaded, setProgressThrottled]);

  const abortLoading = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState("idle");
    setStatusText("Cancelled");
    setProgress(0);
  }, []);

  const encode = useCallback(
    async (audio: Float32Array, quality?: Quality): Promise<Uint8Array> => {
      const result = await codec.encode(audio, quality ?? Quality.Hz50);
      return result.packed;
    },
    [],
  );

  const decode = useCallback(async (packet: Uint8Array): Promise<Float32Array> => {
    return codec.decode(packet);
  }, []);

  const clearModelCacheFn = useCallback(async () => {
    await clearCache();
    codec.reset();
    setState("idle");
    setStatusText("Cache cleared");
    setProgress(0);
    setModelsLoaded(false);
    setModelsCached(false);
  }, []);

  return (
    <CodecContext.Provider
      value={{
        state,
        statusText,
        progress,
        modelsLoaded,
        modelsCached,
        loadModels,
        abortLoading,
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
