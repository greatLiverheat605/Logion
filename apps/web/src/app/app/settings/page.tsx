import { ProductPageHeader, ProductTag } from "@/components/product/product-ui";

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
    </main>
  );
}
