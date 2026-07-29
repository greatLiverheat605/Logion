import Link from "next/link";

import { ThemeToggle } from "@/components/app-shell/theme-toggle";

export function AccessShellHeader() {
  return (
    <header className="access-header">
      <Link aria-label="Logion" className="access-brand" href="/">
        <span aria-hidden="true" className="access-brand-mark">
          L
        </span>
        <span className="access-brand-copy">
          <strong>LOGION</strong>
          <small>个人学习与研究工作台</small>
        </span>
      </Link>
      <ThemeToggle />
    </header>
  );
}
