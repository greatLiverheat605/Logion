import { ProviderCenter } from "@/features/ai/provider-center";
import { AIRunCenter } from "@/features/ai/run-center";
import { SystemCenterFrame } from "@/components/desk/system-center-frame";

export default function AIProviderPage() {
  return (
    <SystemCenterFrame activePath="/app/ai">
      <main id="main-content" className="app-route-stack">
        <nav className="system-workbench-nav" aria-label="AI 路由中心分区">
          <strong>AI 路由中心</strong>
          <a href="#ai-run-center">运行与草稿</a>
          <a href="#ai-provider-center">Provider 与模型</a>
          <a href="#ai-budget-center">预算</a>
          <a href="#ai-route-center">任务路由</a>
        </nav>
        <AIRunCenter />
        <ProviderCenter />
      </main>
    </SystemCenterFrame>
  );
}
