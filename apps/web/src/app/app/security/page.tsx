import { SecurityDataNavigation } from "@/components/product/security-data-navigation";
import { SecurityCenter } from "@/features/security/security-center";

export default function SecurityPage() {
  return (
    <>
      <SecurityDataNavigation active="security" />
      <SecurityCenter />
    </>
  );
}
