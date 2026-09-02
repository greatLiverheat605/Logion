import { SecurityDataNavigation } from "@/components/product/security-data-navigation";
import { DataRoute } from "@/features/data/data-workbench";

export default function DataPage() {
  return (
    <>
      <SecurityDataNavigation active="data" />
      <DataRoute />
    </>
  );
}
