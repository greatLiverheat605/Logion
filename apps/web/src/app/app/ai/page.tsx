import { ProviderCenter } from "@/features/ai/provider-center";
import { AIRunCenter } from "@/features/ai/run-center";

export default function AIProviderPage() {
  return (
    <main id="main-content">
      <AIRunCenter />
      <ProviderCenter />
    </main>
  );
}
