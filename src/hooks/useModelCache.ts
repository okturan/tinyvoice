import { useCodecContext } from "@/contexts/CodecContext";

interface UseModelCacheReturn {
  cachedKeys: Set<string>;
  loading: boolean;
  refresh: () => void;
}

export function useModelCache(): UseModelCacheReturn {
  const { cachedFiles, cacheReady, refreshCache } = useCodecContext();
  return {
    cachedKeys: cachedFiles,
    loading: !cacheReady,
    refresh: () => {
      void refreshCache();
    },
  };
}
