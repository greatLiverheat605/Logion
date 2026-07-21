import { OfflineSyncCenter } from "@/features/sync/offline-sync-center";

export default function SyncPage() {
  return (
    <main className="app-shell sync-shell">
      <header className="page-heading">
        <p className="eyebrow">Offline control plane</p>
        <h1>同步与冲突中心</h1>
        <p>本地编辑始终优先；只有无法安全合并的内容才需要你选择。</p>
      </header>
      <OfflineSyncCenter />
    </main>
  );
}
