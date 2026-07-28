"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { AppIcon } from "@/components/app-shell/app-icon";

const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

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
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const returnFocus = returnFocusRef?.current ?? previousFocus;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const autofocus = dialog.querySelector<HTMLElement>(
        "[data-modal-autofocus]",
      );
      const firstFocusable = dialog.querySelector<HTMLElement>(
        MODAL_FOCUSABLE_SELECTOR,
      );
      (autofocus ?? firstFocusable ?? dialog).focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      returnFocus?.focus();
    };
  }, [returnFocusRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR),
    ).filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    event.preventDefault();
    const currentIndex = focusable.findIndex(
      (element) => element === document.activeElement,
    );
    const nextIndex = event.shiftKey
      ? currentIndex <= 0
        ? focusable.length - 1
        : currentIndex - 1
      : currentIndex < 0 || currentIndex === focusable.length - 1
        ? 0
        : currentIndex + 1;
    focusable[nextIndex]?.focus();
  };

  return (
    <div className="app-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={title}
        aria-modal="true"
        className="app-modal panel"
        onKeyDown={handleKeyDown}
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="app-modal-head">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button
            aria-label="关闭"
            className="app-icon-button"
            type="button"
            onClick={onClose}
          >
            <AppIcon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
