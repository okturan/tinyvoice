import HexSheet from "../HexSheet";
import { ModelDownloadDialog } from "@/components/codec/ModelDownloadDialog";
import type { RecordFlow } from "@/hooks/useRecordFlow";

/** The overlays every record layout needs: hex sheet + model download dialog. */
export function RecordFlowChrome({ flow }: { flow: RecordFlow }) {
  return (
    <>
      <HexSheet
        data={flow.hexData}
        open={flow.hexOpen}
        onOpenChange={flow.setHexOpen}
      />
      <ModelDownloadDialog
        open={flow.downloadOpen}
        onOpenChange={flow.setDownloadOpen}
        defaultQualities={[flow.quality]}
      />
    </>
  );
}
