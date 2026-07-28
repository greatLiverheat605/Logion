import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { SessionBoundary } from "@/features/auth/session-boundary";
import { VaultSessionProvider } from "@/features/offline/vault-session-provider";

export default function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SessionBoundary>
      <VaultSessionProvider>
        <AppShell>{children}</AppShell>
      </VaultSessionProvider>
    </SessionBoundary>
  );
}
