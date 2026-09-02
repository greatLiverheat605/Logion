import Link from "next/link";

import { AccessShellHeader } from "@/components/app-shell/access-shell-header";
import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";

const accessActions: readonly Readonly<{
  href: string;
  icon: AppIconName;
  label: string;
}>[] = [
  { href: "/auth/login", icon: "unlock", label: "登录" },
  { href: "/auth/register", icon: "users", label: "接受邀请" },
  { href: "/auth/recover", icon: "refresh", label: "找回账户" },
];

export default function HomePage() {
  return (
    <main id="main-content" className="access-page">
      <div className="access-shell">
        <AccessShellHeader minimal />
        <section className="access-entry-layout" aria-labelledby="access-title">
          <h1 id="access-title" className="sr-only">
            Logion
          </h1>
          <div className="access-entry-visual" aria-hidden="true">
            <div className="access-entry-visual-top">
              <span />
              <span />
            </div>
            <div className="access-monogram-art">
              <span className="access-monogram-vertical" />
              <span className="access-monogram-horizontal" />
              <span className="access-monogram-accent" />
              <span className="access-monogram-core">L</span>
            </div>
            <div className="access-entry-visual-bottom">
              <span />
              <span />
              <span />
            </div>
          </div>

          <nav className="access-entry-actions" aria-label="账户入口">
            {accessActions.map((action, index) => (
              <Link
                className="access-entry-action"
                href={action.href}
                key={action.href}
              >
                <span className="access-entry-action-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="access-entry-action-label">
                  {action.label}
                </span>
                <span className="access-entry-action-icon" aria-hidden="true">
                  <AppIcon name={action.icon} size={18} />
                </span>
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </main>
  );
}
