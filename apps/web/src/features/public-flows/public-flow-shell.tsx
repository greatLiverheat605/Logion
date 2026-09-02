import type { ReactNode } from "react";

import { AccessShellHeader } from "@/components/app-shell/access-shell-header";

import styles from "./public-flow-workbench.module.css";

export function PublicFlowShell({
  children,
  wide = false,
  className,
}: Readonly<{
  children: ReactNode;
  className?: string;
  wide?: boolean;
}>) {
  return (
    <main
      className={`${styles.page} ${wide ? styles.wide : ""} ${className ?? ""}`.trim()}
      id="main-content"
    >
      <div className={styles.shell}>
        <AccessShellHeader minimal />
        <div className={styles.stage}>
          <section className={styles.panel}>{children}</section>
        </div>
        <footer className={styles.footer}>
          <span>Logion · 安静、可恢复的学习与研究工作台</span>
          <span>端侧加密 · 明确边界 · 可验证操作</span>
        </footer>
      </div>
    </main>
  );
}

export function PublicFlowHeader({
  eyebrow,
  title,
  description,
}: Readonly<{
  description: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}>) {
  return (
    <header className={styles.header}>
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h1>{title}</h1>
      <p className={styles.description}>{description}</p>
    </header>
  );
}

export function PublicFlowState({
  tone = "neutral",
  icon,
  title,
  children,
}: Readonly<{
  children: ReactNode;
  icon: ReactNode;
  title: ReactNode;
  tone?: "neutral" | "success" | "warning" | "error";
}>) {
  const toneClass = {
    neutral: styles.stateNeutral,
    success: styles.stateSuccess,
    warning: styles.stateWarning,
    error: styles.stateError,
  }[tone];
  return (
    <section
      className={`${styles.state} ${toneClass}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <div aria-hidden="true" className={styles.stateIcon}>
        {icon}
      </div>
      <div>
        <h2>{title}</h2>
        <div className={styles.stateBody}>{children}</div>
      </div>
    </section>
  );
}

export function PublicFlowLink({
  children,
  href,
  primary = false,
}: Readonly<{
  children: ReactNode;
  href: string;
  primary?: boolean;
}>) {
  return (
    <a
      className={primary ? styles.primaryLink : styles.secondaryLink}
      href={href}
    >
      {children}
    </a>
  );
}
