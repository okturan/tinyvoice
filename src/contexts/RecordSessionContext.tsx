import { createContext, useContext, type ReactNode } from "react";
import { useRecordFlow, type RecordFlow } from "@/hooks/useRecordFlow";

const RecordSessionContext = createContext<RecordFlow | null>(null);

export function RecordSessionProvider({ children }: { children: ReactNode }) {
  const flow = useRecordFlow();
  return (
    <RecordSessionContext.Provider value={flow}>
      {children}
    </RecordSessionContext.Provider>
  );
}

export function useRecordSession(): RecordFlow {
  const ctx = useContext(RecordSessionContext);
  if (!ctx) {
    throw new Error("useRecordSession must be used within a RecordSessionProvider");
  }
  return ctx;
}
