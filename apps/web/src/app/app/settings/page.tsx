import Link from "next/link";

import { SystemCenterFrame } from "@/components/desk/system-center-frame";
import {
  ProductPageHeader,
  ProductPanel,
  ProductTag,
} from "@/components/product/product-ui";
import { IntegrationHubEntry } from "@/features/integrations/integration-hub-entry";

import { WorkbenchSettings } from "./workbench-settings";

export default function SettingsPage() {
  return (
    <SystemCenterFrame activePath="/app/settings">
      <main className="settings-page persona-settings-page" id="main-content">
        <ProductPageHeader
          actions={<ProductTag tone="info">同步到用户设置</ProductTag>}
          description="管理工作台与个人界面偏好；工作台与 Workspace 角色相互独立。"
          eyebrow="PERSONAL PREFERENCES"
          title="设置"
        />
        <WorkbenchSettings />
        <ProductPanel
          title="互操作与自动化边界"
          description="互操作中心聚合现有真实能力；通用连接器与自动化规则仍未开放。"
          aside={<ProductTag tone="warn">暂未开放</ProductTag>}
        >
          <p>
            Zotero、Webhook、MCP
            工具网关、第三方文件同步和自动化触发器都需要独立的
            API、权限、回滚与审计设计。AI
            Provider、日历订阅和数据导入导出是各自独立的现有能力，不代表通用集成已经实现。
          </p>
          <div className="app-actions">
            <IntegrationHubEntry />
            <Link className="app-secondary-link" href="/app/data">
              使用开放格式导入导出
            </Link>
            <Link className="app-secondary-link" href="/app/ai">
              管理 AI Provider
            </Link>
            <Link className="app-secondary-link" href="/app/search">
              管理只读日历订阅
            </Link>
          </div>
        </ProductPanel>
      </main>
    </SystemCenterFrame>
  );
}
