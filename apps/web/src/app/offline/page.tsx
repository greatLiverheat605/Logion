import Link from "next/link";

export default function OfflinePage() {
  return (
    <main id="main-content" className="session-state">
      <h1>当前处于离线状态</h1>
      <p>
        认证会话不能通过离线页面恢复。未来的本地解锁与完整离线编辑将在 Phase 2
        通过独立安全边界提供。
      </p>
      <Link className="text-link" href="/">
        返回已缓存首页
      </Link>
    </main>
  );
}
