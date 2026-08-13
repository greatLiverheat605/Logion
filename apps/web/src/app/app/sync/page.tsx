import { OfflineSyncCenter } from "@/features/sync/offline-sync-center";
import { ProductPageHeader } from "@/components/product/product-ui";
import { SystemCenterFrame } from "@/components/desk/system-center-frame";

export default function SyncPage() {
  return (
    <SystemCenterFrame activePath="/app/sync">
      <main className="app-shell sync-shell">
        <ProductPageHeader
          eyebrow="SYNC · OFFLINE-FIRST CONTROL"
          title="离线继续工作，冲突始终显式处理"
          description="设备状态、同步队列、附件和冲突合并集中展示，不用猜数据是否已经安全保存。"
        />
        <OfflineSyncCenter />
      </main>
    </SystemCenterFrame>
  );
}
