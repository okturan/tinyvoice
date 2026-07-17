import StageSwapRecord from "./record/StageSwapRecord";
import SplitDeckRecord from "./record/SplitDeckRecord";
import { useLayoutEthos } from "@/contexts/LayoutContext";

export default function RecordPanel() {
  const { ethos } = useLayoutEthos();
  return ethos === "split-deck" ? <SplitDeckRecord /> : <StageSwapRecord />;
}
