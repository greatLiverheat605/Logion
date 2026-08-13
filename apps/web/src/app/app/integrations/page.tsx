import { IntegrationHub } from "@/features/integrations/integration-hub";
import { SystemCenterFrame } from "@/components/desk/system-center-frame";

export default function IntegrationsPage() {
  return (
    <SystemCenterFrame activePath="/app/integrations">
      <IntegrationHub />
    </SystemCenterFrame>
  );
}
