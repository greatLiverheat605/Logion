import type { ReactNode } from "react";

import { AccessShellHeader } from "@/components/app-shell/access-shell-header";
import { AppIcon } from "@/components/app-shell/app-icon";

export function AuthFormShell({
  children,
  description,
  title,
}: Readonly<{ children: ReactNode; description: string; title: string }>) {
  return (
    <main id="main-content" className="auth-page">
      <div className="access-shell">
        <AccessShellHeader />
        <div className="auth-layout">
          <section className="auth-card" aria-labelledby="auth-title">
            <p className="access-eyebrow">SECURE ACCESS</p>
            <h1 id="auth-title">{title}</h1>
            <p className="auth-description">{description}</p>
            {children}
          </section>
          <section className="auth-context" aria-label="工作区说明">
            <p className="access-eyebrow">PRIVATE LEARNING WORKSPACE</p>
            <p className="auth-context-title">
              把学习过程沉淀为可继续、可复查的工作。
            </p>
            <p className="auth-context-description">
              Logion
              面向个人及受邀小组，统一承载计划、资料、笔记、复习、研究证据与 AI
              草稿。
            </p>
            <ul className="auth-context-list">
              <li>
                <span aria-hidden="true">
                  <AppIcon name="lock" />
                </span>
                <div>
                  <strong>私有访问</strong>
                  <small>仅本人及受邀成员进入工作区。</small>
                </div>
              </li>
              <li>
                <span aria-hidden="true">
                  <AppIcon name="refresh" />
                </span>
                <div>
                  <strong>本地优先</strong>
                  <small>断网时继续记录，恢复连接后再安全同步。</small>
                </div>
              </li>
              <li>
                <span aria-hidden="true">
                  <AppIcon name="shield" />
                </span>
                <div>
                  <strong>操作可追溯</strong>
                  <small>关键变更保留状态与审计线索。</small>
                </div>
              </li>
            </ul>
          </section>
        </div>
        <p className="access-footer">私有工作区 · 本地优先 · 可验证同步</p>
      </div>
    </main>
  );
}

export function FormError({
  message = "操作未完成，请检查输入或稍后重试。",
  requestId,
}: Readonly<{ message?: string; requestId: string }>) {
  return (
    <div className="form-message form-error" role="alert">
      <p>{message}</p>
      <p>
        请求编号：<code>{requestId}</code>
      </p>
    </div>
  );
}

export function FormSuccess({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="form-message form-success" role="status">
      {children}
    </div>
  );
}
