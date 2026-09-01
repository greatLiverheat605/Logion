import Link from "next/link";

import { AccessShellHeader } from "@/components/app-shell/access-shell-header";

export default function NotFoundPage() {
  return (
    <main className="public-flow-page" id="main-content">
      <div className="access-shell">
        <AccessShellHeader minimal />
        <div className="public-flow-stage">
          <section className="public-flow-panel">
            <h1 className="sr-only">页面不存在</h1>
            <div className="auth-heading" data-testid="not-found-state">
              <p className="auth-kicker">LOGION · RECOVERY</p>
              <h2>页面不存在</h2>
              <div className="auth-note">
                <p>这个地址没有对应的 Logion 页面，或者该入口尚未开放。</p>
              </div>
            </div>
            <nav aria-label="页面恢复" className="auth-note" data-testid="not-found-recovery">
              <h2>恢复路径</h2>
              <p>根据当前会话选择可用入口；无效地址不会改变你的数据或权限。</p>
              <div className="auth-links">
                <Link className="primary-action" href="/app/today">返回今日工作台</Link>
                <Link href="/auth/login">返回登录</Link>
                <Link href="/">返回首页</Link>
              </div>
            </nav>
          </section>
        </div>
      </div>
    </main>
  );
}
