import Link from "next/link";
import type { ReactNode } from "react";

export function AuthFormShell({
  children,
  description,
  title,
}: Readonly<{ children: ReactNode; description: string; title: string }>) {
  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="brand-link" href="/">
          Logion
        </Link>
        <h1 id="auth-title">{title}</h1>
        <p className="auth-description">{description}</p>
        {children}
      </section>
    </main>
  );
}

export function FormError({ requestId }: Readonly<{ requestId: string }>) {
  return (
    <div className="form-message form-error" role="alert">
      <p>操作未完成，请检查输入或稍后重试。</p>
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
