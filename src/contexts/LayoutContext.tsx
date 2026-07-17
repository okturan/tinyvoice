import { createContext, useContext, useState, useCallback } from "react";

export type LayoutEthos = "stage-swap" | "split-deck";

const STORAGE_KEY = "tinyvoice-layout";

function readStoredEthos(): LayoutEthos {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "split-deck" ? "split-deck" : "stage-swap";
  } catch {
    return "stage-swap";
  }
}

interface LayoutContextValue {
  ethos: LayoutEthos;
  setEthos: (ethos: LayoutEthos) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [ethos, setEthosState] = useState<LayoutEthos>(readStoredEthos);

  const setEthos = useCallback((next: LayoutEthos) => {
    setEthosState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  return (
    <LayoutContext.Provider value={{ ethos, setEthos }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayoutEthos(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) {
    throw new Error("useLayoutEthos must be used within a LayoutProvider");
  }
  return ctx;
}
