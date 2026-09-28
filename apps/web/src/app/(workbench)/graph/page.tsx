import { Suspense } from "react";
import { KnowledgeNetwork } from "@/platform/workbench/network";
export default function Page() {
  return (
    <Suspense fallback={<p>正在载入知识网…</p>}>
      <KnowledgeNetwork />
    </Suspense>
  );
}
