import Link from "next/link";

import {
  ProductPageHeader,
  ProductPanel,
  ProductTag,
} from "@/components/product/product-ui";

import { PersonaSettings } from "./persona-settings";

export default function SettingsPage() {
  return (
    <main className="settings-page persona-settings-page" id="main-content">
      <ProductPageHeader
        actions={<ProductTag tone="info">同步到用户设置</ProductTag>}
        description="管理个人界面偏好；画像与 Workspace 角色相互独立。"
        eyebrow="PERSONAL PREFERENCES"
        title="设置"
      />
      <PersonaSettings />
      <ProductPanel
        title="自动化与集成边界"
        description="当前版本没有通用连接器或自动化规则 CRUD；此处不会提供可保存但不生效的配置。"
        aside={<ProductTag tone="warn">暂未开放</ProductTag>}
      >
        <p>
          Zotero、Webhook、MCP
          工具网关、第三方文件同步和自动化触发器都需要独立的
          API、权限、回滚与审计设计。AI
          Provider、日历订阅和数据导入导出是各自独立的现有能力，不代表通用集成已经实现。
        </p>
        <div className="app-actions">
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
  );
}
