import { SecurityDataNavigation } from "@/components/product/security-data-navigation";
import { DataSovereigntyCenter } from "@/features/portability/data-sovereignty-center";

export default function DataPage() {
  return (
    <>
      <SecurityDataNavigation active="data" />
      <DataSovereigntyCenter />
    </>
  );
}
