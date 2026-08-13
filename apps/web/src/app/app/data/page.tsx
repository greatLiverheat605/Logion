import { SecurityDataNavigation } from "@/components/product/security-data-navigation";
import { SystemCenterFrame } from "@/components/desk/system-center-frame";
import { DataSovereigntyCenter } from "@/features/portability/data-sovereignty-center";

export default function DataPage() {
  return (
    <SystemCenterFrame activePath="/app/data">
      <SecurityDataNavigation active="data" />
      <DataSovereigntyCenter />
    </SystemCenterFrame>
  );
}
