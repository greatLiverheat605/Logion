import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { SessionBoundary } from "@/features/auth/session-boundary";

export default function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SessionBoundary>
      <AppShell>{children}</AppShell>
    </SessionBoundary>
  );
}
