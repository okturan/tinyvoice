import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TopBar } from "@/components/layout/TopBar";
import RecordPanel from "@/components/qr/RecordPanel";
import DecodePanel from "@/components/qr/DecodePanel";
import { RecordSessionProvider } from "@/contexts/RecordSessionContext";
import { DecodeSessionProvider } from "@/contexts/DecodeSessionContext";
import { useLayoutEthos } from "@/contexts/LayoutContext";

export default function QRPage() {
  const [searchParams] = useSearchParams();
  const { ethos } = useLayoutEthos();
  const voiceB64 = searchParams.get("v");
  const [tab, setTab] = useState(voiceB64 ? "decode" : "record");

  useEffect(() => {
    if (voiceB64) setTab("decode");
  }, [voiceB64]);

  return (
    <div className="flex h-dvh items-center justify-center overflow-hidden bg-[var(--crust)] p-4 text-[var(--text)]">
      <div className={`mx-auto flex h-[calc(100dvh-2rem)] w-full ${ethos === "split-deck" ? "max-w-[840px]" : "max-w-[520px]"} flex-col overflow-hidden rounded-xl border border-[var(--surface0)] bg-[var(--base)]`}>
        <TopBar />

        <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
          <RecordSessionProvider>
            <DecodeSessionProvider voiceB64={voiceB64}>
              <Tabs value={tab} onValueChange={setTab} className="h-full min-h-0">
                <TabsList className="mb-1 grid w-full flex-shrink-0 grid-cols-2 bg-[var(--mantle)]">
                  <TabsTrigger value="record">Record</TabsTrigger>
                  <TabsTrigger value="decode">Decode</TabsTrigger>
                </TabsList>

                <TabsContent value="record" className="mt-0 min-h-0 overflow-y-auto">
                  <RecordPanel />
                </TabsContent>

                <TabsContent value="decode" className="mt-0 min-h-0 overflow-hidden">
                  <DecodePanel />
                </TabsContent>
              </Tabs>
            </DecodeSessionProvider>
          </RecordSessionProvider>
        </div>
      </div>
    </div>
  );
}
