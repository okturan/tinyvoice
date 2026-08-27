import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { codec, type LoadIntent } from "@/lib/codec-service";

export type { LoadIntent };
import { Quality } from "@/types/codec";
import {
  clearModelCache as clearCache,
  delCache,
  getAllCachedKeys,
  pruneStaleRevisions,
  requestPersistentModelStorage,
} from "@/lib/model-cache";
import { qualityLabel } from "@/lib/format";

export type CodecState = "idle" | "loading" | "ready" | "error";
export type LoadModelsResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "busy" | "error"; message?: string };

const ALL_QUALITIES = Object.values(Quality);

export function encoderFile(): string {
  return "encoder.onnx";
}

export function compressorFile(quality: Quality): string {
  return `compressor_${quality}.onnx`;
}

export function decoderFile(quality: Quality): string {
  return `decoder_${quality}.onnx`;
}

export function artifactNameFromError(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "modelName" in error &&
    typeof (error as { modelName: unknown }).modelName === "string"
  ) {
    return (error as { modelName: string }).modelName;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /([a-z0-9_.-]+\.onnx)/i.exec(message);
  return match?.[1];
}

interface CodecContextValue {
  state: CodecState;
  statusText: string;
  errorText: string;
  progress: number;
  modelsLoaded: boolean;
  modelsCached: boolean;
  cacheReady: boolean;
  cachedFiles: Set<string>;
  loadedQualities: Quality[];
  /** The quality PTT encodes with. Persisted; always one of loadedQualities when any are loaded. */
  activeQuality: Quality | null;
  setActiveQuality: (quality: Quality) => void;
  isQualityLoaded: (quality: Quality) => boolean;
  canRecord: (quality: Quality) => boolean;
  canPlay: (quality: Quality) => boolean;
  isCachedForRecording: (quality: Quality) => boolean;
  isCachedForPlayback: (quality: Quality) => boolean;
  refreshCache: () => Promise<void>;
  loadModels: (
    quality?: Quality | Quality[],
    intent?: LoadIntent,
  ) => Promise<LoadModelsResult>;
  abortLoading: () => void;
  clearModelCache: () => Promise<void>;
  encode: (audio: Float32Array, quality?: Quality) => Promise<Uint8Array>;
  decode: (packet: Uint8Array, qualityOverride?: Quality) => Promise<Float32Array>;
}

const ACTIVE_QUALITY_KEY = "tinyvoice-active-quality";

function readStoredActiveQuality(): Quality | null {
  try {
    const stored = localStorage.getItem(ACTIVE_QUALITY_KEY);
    return Object.values(Quality).includes(stored as Quality)
      ? (stored as Quality)
      : null;
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const CodecContext = createContext<CodecContextValue | null>(null);

export function CodecProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CodecState>("idle");
  const [statusText, setStatusText] = useState("Not loaded");
  const [errorText, setErrorText] = useState("");
  const [progress, setProgress] = useState(0);
  const [encoderLoaded, setEncoderLoaded] = useState(false);
  const [loadedCompressors, setLoadedCompressors] = useState<Set<Quality>>(
    () => new Set(),
  );
  const [loadedDecoders, setLoadedDecoders] = useState<Set<Quality>>(
    () => new Set(),
  );
  const [cachedFiles, setCachedFiles] = useState<Set<string>>(() => new Set());
  const [cacheReady, setCacheReady] = useState(false);
  const [modelsCached, setModelsCached] = useState(false);
  const [activeQuality, setActiveQualityState] = useState<Quality | null>(
    readStoredActiveQuality,
  );

  const setActiveQuality = useCallback((quality: Quality) => {
    setActiveQualityState(quality);
    try {
      localStorage.setItem(ACTIVE_QUALITY_KEY, quality);
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  const canRecord = useCallback(
    (quality: Quality) => encoderLoaded && loadedCompressors.has(quality),
    [encoderLoaded, loadedCompressors],
  );

  const canPlay = useCallback(
    (quality: Quality) => loadedDecoders.has(quality),
    [loadedDecoders],
  );

  const isQualityLoaded = useCallback(
    (quality: Quality) => canRecord(quality) && canPlay(quality),
    [canRecord, canPlay],
  );

  const loadedQualities = useMemo(
    () => ALL_QUALITIES.filter((quality) => canRecord(quality) && canPlay(quality)),
    [canRecord, canPlay],
  );

  const isCachedForRecording = useCallback(
    (quality: Quality) =>
      cachedFiles.has(encoderFile()) && cachedFiles.has(compressorFile(quality)),
    [cachedFiles],
  );

  const isCachedForPlayback = useCallback(
    (quality: Quality) => cachedFiles.has(decoderFile(quality)),
    [cachedFiles],
  );

  // Keep activeQuality pointing at a loaded quality once any are loaded.
  useEffect(() => {
    if (loadedQualities.length === 0) return;
    setActiveQualityState((current) =>
      current && loadedQualities.includes(current)
        ? current
        : loadedQualities[0],
    );
  }, [loadedQualities]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);
  const lastProgressUpdate = useRef(0);
  const encoderLoadedRef = useRef(false);
  const loadedCompressorsRef = useRef<Set<Quality>>(new Set());
  const loadedDecodersRef = useRef<Set<Quality>>(new Set());

  encoderLoadedRef.current = encoderLoaded;
  loadedCompressorsRef.current = loadedCompressors;
  loadedDecodersRef.current = loadedDecoders;

  const refreshCache = useCallback(async () => {
    try {
      const keys = await getAllCachedKeys();
      const files = new Set(keys);
      setCachedFiles(files);
      const announced = ALL_QUALITIES.some(
        (quality) =>
          (files.has(encoderFile()) && files.has(compressorFile(quality))) ||
          files.has(decoderFile(quality)),
      );
      setModelsCached(announced);
    } catch {
      setCachedFiles(new Set());
      setModelsCached(false);
    } finally {
      setCacheReady(true);
    }
  }, []);

  // Reclaim storage from previous model revisions, then check every quality.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await pruneStaleRevisions();
      try {
        const keys = await getAllCachedKeys();
        if (cancelled) return;
        const files = new Set(keys);
        setCachedFiles(files);
        const announced = ALL_QUALITIES.some(
          (quality) =>
            (files.has(encoderFile()) && files.has(compressorFile(quality))) ||
            files.has(decoderFile(quality)),
        );
        setModelsCached(announced);
        if (announced) setStatusText("Cached models available");
      } catch {
        if (!cancelled) {
          setCachedFiles(new Set());
          setModelsCached(false);
        }
      } finally {
        if (!cancelled) setCacheReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setProgressThrottled = useCallback((value: number) => {
    const now = Date.now();
    if (value >= 100 || value === 0 || now - lastProgressUpdate.current > 150) {
      lastProgressUpdate.current = now;
      setProgress(Math.round(value));
    }
  }, []);

  const modelsLoaded =
    encoderLoaded || loadedCompressors.size > 0 || loadedDecoders.size > 0;

  const loadModels = useCallback(
    async (
      quality: Quality | Quality[] = Quality.Hz50,
      intent: LoadIntent = "both",
    ): Promise<LoadModelsResult> => {
      const requested = Array.isArray(quality) ? quality : [quality];
      const qualities = Array.from(new Set(requested));
      const missing = qualities.filter((item) => {
        if (intent === "play") return !loadedDecodersRef.current.has(item);
        if (intent === "record") {
          return !encoderLoadedRef.current || !loadedCompressorsRef.current.has(item);
        }
        return !(
          encoderLoadedRef.current &&
          loadedCompressorsRef.current.has(item) &&
          loadedDecodersRef.current.has(item)
        );
      });
      if (missing.length === 0) return { ok: true };
      if (abortControllerRef.current) return { ok: false, reason: "busy" };

      const generation = loadGenerationRef.current;
      const isCurrent = () => loadGenerationRef.current === generation;

      setErrorText("");
      setState("loading");
      setProgressThrottled(0);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      let lastModelName: string | undefined;

      try {
        await requestPersistentModelStorage();
        await codec.loadModelSet(
          missing,
          (info) => {
            if (!isCurrent()) return;
            if (info.modelName) lastModelName = info.modelName;
            setProgressThrottled(info.fraction * 100);
            setStatusText(info.status);
          },
          controller.signal,
          intent,
        );

        if (!isCurrent()) return { ok: false, reason: "cancelled" };

        if (intent !== "play") {
          setEncoderLoaded(true);
          encoderLoadedRef.current = true;
          setLoadedCompressors((current) => {
            const next = new Set(current);
            for (const item of missing) next.add(item);
            loadedCompressorsRef.current = next;
            return next;
          });
        }
        if (intent !== "record") {
          setLoadedDecoders((current) => {
            const next = new Set(current);
            for (const item of missing) next.add(item);
            loadedDecodersRef.current = next;
            return next;
          });
        }

        await refreshCache();
        if (!isCurrent()) return { ok: false, reason: "cancelled" };

        const files = await getAllCachedKeys();
        const fileSet = new Set(files);
        const cached = missing.every((item) => {
          if (intent === "play") return fileSet.has(decoderFile(item));
          if (intent === "record") {
            return fileSet.has(encoderFile()) && fileSet.has(compressorFile(item));
          }
          return (
            fileSet.has(encoderFile()) &&
            fileSet.has(compressorFile(item)) &&
            fileSet.has(decoderFile(item))
          );
        });
        setState("ready");
        setStatusText(
          cached
            ? `${qualities.map(qualityLabel).join(", ")} loaded`
            : `${qualities.map(qualityLabel).join(", ")} loaded for this session; cache unavailable`,
        );
        setModelsCached(cached || fileSet.size > 0);
        return { ok: true };
      } catch (e) {
        if (isAbortError(e)) {
          return { ok: false, reason: "cancelled" };
        }

        controller.abort();

        const message = e instanceof Error ? e.message : String(e);
        const artifact = artifactNameFromError(e) ?? lastModelName;
        if (message.includes("protobuf") && artifact) {
          await delCache(artifact);
          codec.resetArtifact(artifact);
          await refreshCache();
        }

        if (!isCurrent()) return { ok: false, reason: "cancelled" };

        setState("error");
        setStatusText("Error");
        setErrorText(message);
        loadGenerationRef.current += 1;
        return { ok: false, reason: "error", message };
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [refreshCache, setProgressThrottled],
  );

  const abortLoading = useCallback(() => {
    loadGenerationRef.current += 1;
    const controller = abortControllerRef.current;
    abortControllerRef.current = null;
    controller?.abort();
    setState("idle");
    setStatusText("Cancelled");
    setProgress(0);
    setErrorText("");
  }, []);

  const encode = useCallback(
    async (audio: Float32Array, quality?: Quality): Promise<Uint8Array> => {
      const result = await codec.encode(
        audio,
        quality ?? activeQuality ?? loadedQualities[0] ?? Quality.Hz50,
      );
      return result.packed;
    },
    [activeQuality, loadedQualities],
  );

  const decode = useCallback(
    async (packet: Uint8Array, qualityOverride?: Quality): Promise<Float32Array> => {
      return codec.decode(packet, qualityOverride);
    },
    [],
  );

  const clearModelCacheFn = useCallback(async () => {
    loadGenerationRef.current += 1;
    const controller = abortControllerRef.current;
    abortControllerRef.current = null;
    controller?.abort();
    await clearCache();
    codec.reset();
    setState("idle");
    setStatusText("Downloaded model cache cleared");
    setProgress(0);
    setErrorText("");
    setEncoderLoaded(false);
    setLoadedCompressors(new Set());
    setLoadedDecoders(new Set());
    encoderLoadedRef.current = false;
    loadedCompressorsRef.current = new Set();
    loadedDecodersRef.current = new Set();
    setModelsCached(false);
    await refreshCache();
  }, [refreshCache]);

  const value = useMemo<CodecContextValue>(
    () => ({
      state,
      statusText,
      errorText,
      progress,
      modelsLoaded,
      modelsCached,
      cacheReady,
      cachedFiles,
      loadedQualities,
      activeQuality,
      setActiveQuality,
      isQualityLoaded,
      canRecord,
      canPlay,
      isCachedForRecording,
      isCachedForPlayback,
      refreshCache,
      loadModels,
      abortLoading,
      clearModelCache: clearModelCacheFn,
      encode,
      decode,
    }),
    [
      state,
      statusText,
      errorText,
      progress,
      modelsLoaded,
      modelsCached,
      cacheReady,
      cachedFiles,
      loadedQualities,
      activeQuality,
      setActiveQuality,
      isQualityLoaded,
      canRecord,
      canPlay,
      isCachedForRecording,
      isCachedForPlayback,
      refreshCache,
      loadModels,
      abortLoading,
      clearModelCacheFn,
      encode,
      decode,
    ],
  );

  return (
    <CodecContext.Provider value={value}>
      {children}
    </CodecContext.Provider>
  );
}

export function useCodecContext(): CodecContextValue {
  const ctx = useContext(CodecContext);
  if (!ctx) throw new Error("useCodecContext must be used inside CodecProvider");
  return ctx;
}
