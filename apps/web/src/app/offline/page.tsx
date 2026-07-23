import Link from "next/link";

export default function OfflinePage() {
  return (
    <main id="main-content" className="session-state">
      <h1>当前处于离线状态</h1>
      <p>
        如果此设备已解锁，可从应用继续访问已缓存内容并保存本地更改。认证恢复、成员权限更新和云端
        AI 需要重新联网；此页面不会把离线状态误报为已同步。
      </p>
      <Link className="text-link" href="/">
        返回已缓存首页
      </Link>
    </main>
  );
}
