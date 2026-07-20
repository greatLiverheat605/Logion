import type { ReactNode } from "react";

import { SessionBoundary } from "@/features/auth/session-boundary";

export default function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <SessionBoundary>{children}</SessionBoundary>;
}
