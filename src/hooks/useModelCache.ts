import { useState, useEffect, useCallback } from "react";
import { getAllCachedKeys, getCachedSize } from "@/lib/model-cache";

interface CachedModel {
  key: string;
  size: number;
}

interface UseModelCacheReturn {
  cachedModels: CachedModel[];
  totalSize: number;
  loading: boolean;
  refresh: () => void;
}

export function useModelCache(): UseModelCacheReturn {
  const [cachedModels, setCachedModels] = useState<CachedModel[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const keys = await getAllCachedKeys();
        const models: CachedModel[] = [];
        let total = 0;
        for (const key of keys) {
          const size = await getCachedSize(key);
          models.push({ key, size });
          total += size;
        }
        if (!cancelled) {
          setCachedModels(models);
          setTotalSize(total);
        }
      } catch {
        if (!cancelled) {
          setCachedModels([]);
          setTotalSize(0);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { cachedModels, totalSize, loading, refresh };
}
