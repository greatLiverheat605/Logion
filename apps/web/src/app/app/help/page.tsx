import {
  ProductPageHeader,
  ProductPanel,
  ProductTag,
} from "@/components/product/product-ui";

export default function HelpPage() {
  return (
    <main className="settings-page" id="main-content">
      <ProductPageHeader
        actions={<ProductTag tone="good">随画像开放</ProductTag>}
        description="了解画像如何优化导航，以及如何恢复或切换设置。"
        eyebrow="HELP"
        title="帮助"
      />
      <ProductPanel title="画像与权限">
        <p>
          画像只控制侧边栏里优先显示的功能，不会改变你在任何工作区中的权限。
          即使某个入口未显示，已有权限仍由工作区角色规则决定。
        </p>
      </ProductPanel>
    </main>
  );
}
