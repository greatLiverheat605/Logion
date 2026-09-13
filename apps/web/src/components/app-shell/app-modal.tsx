"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode, type RefObject } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";

export function AppModal({
  busy = false,
  children,
  eyebrow,
  onClose,
  returnFocusRef,
  title,
}: Readonly<{
  busy?: boolean;
  children: ReactNode;
  eyebrow: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  title: string;
}>) {
  const contentRef = useRef<HTMLDivElement>(null);
  const fallbackFocusRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="app-backdrop" />
        <Dialog.Content
          aria-busy={busy}
          aria-describedby={undefined}
          className="app-modal panel"
          ref={contentRef}
          onKeyDownCapture={(event) => {
            if (
              event.key !== "Escape" ||
              !(event.target instanceof Element) ||
              event.target.closest('[role="dialog"]') !== event.currentTarget
            )
              return;
            // Focus can enter before Radix installs its document Escape listener.
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onClose();
          }}
          onOpenAutoFocus={(event) => {
            previousFocusRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            fallbackFocusRef.current = document.querySelector<HTMLElement>(
              '[role="tab"][aria-selected="true"]',
            );
            const autofocus = contentRef.current?.querySelector<HTMLElement>(
              "[data-modal-autofocus]",
            );
            if (autofocus) {
              event.preventDefault();
              autofocus.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef?.current ?? previousFocusRef.current;
            if (target?.isConnected && !target.matches(":disabled"))
              target.focus();
            else fallbackFocusRef.current?.focus();
          }}
        >
          <header className="app-modal-head">
            <div>
              <p className="eyebrow" style={{ color: "var(--accent-text)" }}>
                {eyebrow}
              </p>
              <Dialog.Title>{title}</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                disabled={busy}
                aria-label="关闭"
                className="app-icon-button"
                type="button"
              >
                <AppIcon name="close" />
              </button>
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
