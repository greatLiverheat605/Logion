import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { CommandFeedbackProvider } from "@/features/desk/command-feedback-context";
import { SessionBoundary } from "@/features/auth/session-boundary";
import { VaultSessionProvider } from "@/features/offline/vault-session-provider";
import { PersonaProvider } from "@/features/personas/persona-context";
import { WorkbenchProvider } from "@/features/workbenches/workbench-context";

export default function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SessionBoundary requireOnboarding>
      <PersonaProvider>
        <WorkbenchProvider>
          <VaultSessionProvider>
            <CommandFeedbackProvider>
              <AppShell>{children}</AppShell>
            </CommandFeedbackProvider>
          </VaultSessionProvider>
        </WorkbenchProvider>
      </PersonaProvider>
    </SessionBoundary>
  );
}
