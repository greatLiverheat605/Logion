import Link from "next/link";

import { ThemeToggle } from "@/components/app-shell/theme-toggle";

export function AccessShellHeader({
  minimal = false,
}: Readonly<{ minimal?: boolean }>) {
  return (
    <header className="access-header">
      <Link aria-label="Logion" className="access-brand" href="/">
        <span aria-hidden="true" className="access-brand-mark">
          L
        </span>
        <span className="access-brand-copy">
          <strong>LOGION</strong>
          {!minimal ? <small>个人学习与研究工作台</small> : null}
        </span>
      </Link>
      <ThemeToggle />
    </header>
  );
}
