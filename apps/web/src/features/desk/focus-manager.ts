"use client";

import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
} from "react";

/**
 * Selector matching the focusable interactive elements inside an overlay.
 * Mirrors the set already validated by {@link AppModal}.
 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Moves keyboard focus into an overlay when it becomes active, and restores
 * focus to the previously focused element on cleanup.
 *
 * This is the shared primitive behind every D2 overlay (confirm dialog,
 * inspector, toast region). It mirrors the focus handling already validated in
 * `AppModal` but is split out so non-modal surfaces can reuse it.
 *
 * @param ref        The overlay container element.
 * @param active     Whether the overlay is currently open. When `true` the
 *                   first focusable child (or the container itself) receives
 *                   focus; when it flips back to `false` focus is returned to
 *                   the element that was focused before the overlay opened.
 * @param autofocusSelector  Optional selector for the element that should
 *                           receive initial focus (defaults to the first
 *                           focusable element).
 */
export function useFocusReturn(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  autofocusSelector = "[data-modal-autofocus]",
): void {
  useEffect(() => {
    if (!active) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      const container = ref.current;
      if (!container) return;
      const autofocus = container.querySelector<HTMLElement>(autofocusSelector);
      const firstFocusable =
        container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (autofocus ?? firstFocusable ?? container).focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, [active, autofocusSelector, ref]);
}

/**
 * Returns a `keydown` handler implementing a Tab focus trap inside `ref`.
 *
 * Use the returned handler as `onKeyDown` on the overlay container. When the
 * user presses Tab (or Shift+Tab) at the edge of the overlay focus wraps to the
 * opposite end instead of escaping. This is the same logic validated in
 * `AppModal`.
 *
 * The handler only depends on `ref` (which is stable for the lifetime of a
 * component) and the module-level `FOCUSABLE_SELECTOR`, so it does not need an
 * extra dependency list.
 *
 * @param ref   The overlay container element.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Tab") return;
      const container = ref.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
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
    },
    [ref],
  );
}
