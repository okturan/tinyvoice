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
import { qualityLabel } from "@/lib/format";

export type CodecState = "idle" | "loading" | "ready" | "error";

interface CodecContextValue {
  state: CodecState;
  statusText: string;
  progress: number;
  modelsLoaded: boolean;
  modelsCached: boolean;
  loadedQualities: Quality[];
  isQualityLoaded: (quality: Quality) => boolean;
  loadModels: (quality?: Quality | Quality[]) => Promise<boolean>;
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
  const [loadedQualities, setLoadedQualities] = useState<Quality[]>([]);
  const [modelsCached, setModelsCached] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const lastProgressUpdate = useRef(0);

  // Check if core models are already cached in IndexedDB on mount
  useEffect(() => {
    codec.isCoreModelsCached().then((cached) => {
      if (cached) {
        setModelsCached(true);
        setStatusText("Cached models available");
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

  const isQualityLoaded = useCallback(
    (quality: Quality) => loadedQualities.includes(quality),
    [loadedQualities],
  );

  const modelsLoaded = loadedQualities.length > 0;

  const loadModels = useCallback(async (quality: Quality | Quality[] = Quality.Hz50) => {
    const requested = Array.isArray(quality) ? quality : [quality];
    const qualities = Array.from(new Set(requested));
    const missing = qualities.filter((q) => !loadedQualities.includes(q));
    if (missing.length === 0) return true;
    if (abortControllerRef.current) return false;
    setState("loading");
    setProgressThrottled(0);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await codec.loadModelSet(
        missing,
        (info) => {
          setProgressThrottled(info.fraction * 100);
          setStatusText(info.status);
        },
        controller.signal,
      );

      setState("ready");
      setStatusText(
        `${qualities.map(qualityLabel).join(", ")} loaded`,
      );
      setLoadedQualities((current) =>
        Array.from(new Set([...current, ...missing])),
      );
      setModelsCached(true);
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return false;
      setState("error");
      setStatusText("Error");
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("protobuf")) await clearCache();
      throw e;
    } finally {
      abortControllerRef.current = null;
    }
  }, [loadedQualities, setProgressThrottled]);

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
      const result = await codec.encode(audio, quality ?? loadedQualities[0] ?? Quality.Hz50);
      return result.packed;
    },
    [loadedQualities],
  );

  const decode = useCallback(async (packet: Uint8Array): Promise<Float32Array> => {
    return codec.decode(packet);
  }, []);

  const clearModelCacheFn = useCallback(async () => {
    await clearCache();
    codec.reset();
    setState("idle");
    setStatusText("Downloaded model cache cleared");
    setProgress(0);
    setLoadedQualities([]);
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
        loadedQualities,
        isQualityLoaded,
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
