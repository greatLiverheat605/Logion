"use client";

import { Toaster } from "sonner";

import "sonner/dist/styles.css";
import "./feedback.css";

export function FeedbackProvider() {
  return (
    <Toaster
      position="top-center"
      offset={64}
      mobileOffset={{
        top: "calc(env(safe-area-inset-top, 0px) + 56px)",
        left: 12,
        right: 12,
      }}
      duration={3000}
      visibleToasts={1}
      closeButton
      richColors
      containerAriaLabel="操作反馈"
      toastOptions={{ closeButtonAriaLabel: "关闭反馈" }}
    />
  );
}
