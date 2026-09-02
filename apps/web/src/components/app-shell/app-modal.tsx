"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode, type RefObject } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";

export function AppModal({
  children,
  eyebrow,
  onClose,
  returnFocusRef,
  title,
}: Readonly<{
  children: ReactNode;
  eyebrow: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  title: string;
}>) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="app-backdrop" />
        <Dialog.Content
          aria-describedby={undefined}
          className="app-modal panel"
          ref={contentRef}
          onOpenAutoFocus={(event) => {
            previousFocusRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
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
            (returnFocusRef?.current ?? previousFocusRef.current)?.focus();
          }}
        >
          <header className="app-modal-head">
            <div>
              <p className="eyebrow">{eyebrow}</p>
              <Dialog.Title>{title}</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
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
