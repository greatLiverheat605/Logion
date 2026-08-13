import { SecurityDataNavigation } from "@/components/product/security-data-navigation";
import { SystemCenterFrame } from "@/components/desk/system-center-frame";
import { SecurityCenter } from "@/features/security/security-center";

export default function SecurityPage() {
  return (
    <SystemCenterFrame activePath="/app/security">
      <SecurityDataNavigation active="security" />
      <SecurityCenter />
    </SystemCenterFrame>
  );
}
