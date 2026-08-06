/* ============================================================
   knowledge-space-prototype / knowledge-space-shell.tsx
   Shell for Variant C — renders the KnowledgeSpaceVC
   with Logion's app-shell wrapper.
   ============================================================ */

"use client";

import { KnowledgeSpaceVC } from "./knowledge-space-vc";
import "./knowledge-space.css";

export function KnowledgeSpaceShell() {
  return (
    <main
      id="main-content"
      className="app-content"
      style={{
        width: "100%",
        maxWidth: "103.75rem",
        margin: "0 auto",
        padding: "1.5rem 1.5rem 5rem",
      }}
    >
      <KnowledgeSpaceVC />
    </main>
  );
}
