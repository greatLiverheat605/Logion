import { SecurityDataNavigation } from "@/components/product/security-data-navigation";
import { SystemCenterFrame } from "@/components/desk/system-center-frame";
import { AuditLog } from "@/features/audit/audit-log";

export default function AuditPage() {
  return (
    <SystemCenterFrame activePath="/app/audit">
      <SecurityDataNavigation active="audit" />
      <AuditLog />
    </SystemCenterFrame>
  );
}
