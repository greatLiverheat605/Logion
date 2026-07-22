import { LogoutButton } from "@/features/auth/logout-button";
import Link from "next/link";

export default function AuthenticatedShellPage() {
  return (
    <main id="main-content" className="session-state">
      <p className="eyebrow">LOGION · PHASE 1</p>
      <h1>认证边界已就绪</h1>
      <p>可信身份、设备与多租户工作区边界已经可以使用。</p>
      <nav className="app-actions" aria-label="账户与工作区">
        <Link className="text-link" href="/app/today">
          今日学习
        </Link>
        <Link className="text-link" href="/app/planning">
          学习计划
        </Link>
        <Link className="text-link" href="/app/records">
          笔记与资料
        </Link>
        <Link className="text-link" href="/app/review">
          掌握与复习
        </Link>
        <Link className="text-link" href="/app/workspaces">
          管理工作区
        </Link>
        <Link className="text-link" href="/app/security">
          账户安全
        </Link>
        <Link className="text-link" href="/app/audit">
          安全审计
        </Link>
      </nav>
      <LogoutButton />
    </main>
  );
}
