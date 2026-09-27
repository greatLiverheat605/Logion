import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { WorkbenchProvider } from "@/platform/workbench/provider";
import { WorkbenchShell } from "@/platform/workbench/shell";
import "@/platform/workbench/workbench.css";

export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  if (process.env.LOGION_RESEARCH_V3_ENABLED !== "true") notFound();
  return (
    <WorkbenchProvider>
      <WorkbenchShell>{children}</WorkbenchShell>
    </WorkbenchProvider>
  );
}
