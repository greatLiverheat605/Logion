import {
  ProductPageHeader,
  ProductPanel,
  ProductTag,
} from "@/components/product/product-ui";

export default function ProfilePage() {
  return (
    <main className="settings-page" id="main-content">
      <ProductPageHeader
        actions={<ProductTag>个人范围</ProductTag>}
        description="个人资料与学习偏好独立于工作区成员角色。"
        eyebrow="PROFILE"
        title="个人"
      />
      <ProductPanel
        description="账户身份由安全中心维护；画像可在设置页随时调整。"
        title="个人资料"
      >
        <p className="muted">更多个人资料字段将在后续版本开放。</p>
      </ProductPanel>
    </main>
  );
}
