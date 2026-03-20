import { useState, useEffect, useCallback } from "react";
import { getAllCachedKeys } from "@/lib/model-cache";

interface UseModelCacheReturn {
  cachedKeys: Set<string>;
  loading: boolean;
  refresh: () => void;
}

export function useModelCache(): UseModelCacheReturn {
  const [cachedKeys, setCachedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    getAllCachedKeys().then((keys) => {
      if (!cancelled) {
        setCachedKeys(new Set(keys));
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setCachedKeys(new Set());
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [refreshKey]);

  return { cachedKeys, loading, refresh };
}
