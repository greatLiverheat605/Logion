import type { ReactNode } from "react";

export type InlineFormFeedbackTone = "error" | "loading" | "success";

interface InlineFormFeedbackProps {
  children: ReactNode;
  id?: string;
  tone?: InlineFormFeedbackTone;
}

/**
 * Keeps action feedback next to the control that produced it. The live-region
 * role is intentionally limited to the feedback itself so unrelated page
 * updates do not interrupt the user.
 */
export function InlineFormFeedback({
  children,
  id,
  tone = "error",
}: InlineFormFeedbackProps) {
  return (
    <p
      aria-live="polite"
      className={`inline-form-feedback ${tone}`}
      id={id}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
