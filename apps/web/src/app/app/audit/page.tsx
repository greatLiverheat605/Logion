import { SecurityDataNavigation } from "@/components/product/security-data-navigation";
import { AuditLog } from "@/features/audit/audit-log";

export default function AuditPage() {
  return (
    <>
      <SecurityDataNavigation active="audit" />
      <AuditLog />
    </>
  );
}
