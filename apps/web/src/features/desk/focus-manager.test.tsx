/** @vitest-environment jsdom */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { useFocusReturn, useFocusTrap } from "@/features/desk/focus-manager";

afterEach(cleanup);
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Overlay that applies useFocusReturn (initial-focus + restore on close).
 */
function ReturnOverlay({ active }: { active: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  useFocusReturn(ref, active);
  return (
    <section ref={ref} tabIndex={-1}>
      <button>第一个</button>
      <button>第二个</button>
    </section>
  );
}

describe("useFocusReturn", () => {
  it("moves focus into the overlay when it becomes active", async () => {
    function App() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>打开</button>
          {open ? <ReturnOverlay active={open} /> : null}
        </>
      );
    }
    const { getByText } = render(<App />);
    act(() => getByText("打开").click());
    // useFocusReturn uses requestAnimationFrame, so wait for the autofocus.
    await waitFor(() => {
      expect(document.activeElement).toBe(getByText("第一个"));
    });
  });

  it("restores focus to the trigger when the overlay closes", async () => {
    function App() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen((v) => !v)}>触发器</button>
          {open ? <ReturnOverlay active={open} /> : null}
        </>
      );
    }
    const { getByText } = render(<App />);
    const trigger = getByText("触发器");
    trigger.focus();
    act(() => trigger.click());
    await waitFor(() =>
      expect(document.activeElement).toBe(getByText("第一个")),
    );
    // Close: focus should return to the trigger.
    act(() => trigger.click());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("useFocusTrap", () => {
  /**
   * Renders an overlay that exposes its trap handler and ref to the test via
   * callbacks. The test can then drive the handler directly and install focus
   * spies on the rendered buttons.
   */
  function renderTrap(
    onReady: (handlers: {
      trap: (event: KeyboardEvent<HTMLElement>) => void;
      ref: RefObject<HTMLElement | null>;
    }) => void,
  ) {
    function Probe() {
      const ref = useRef<HTMLElement | null>(null);
      const trap = useFocusTrap(ref);
      return (
        <section
          ref={(node) => {
            (ref as { current: HTMLElement | null }).current = node;
            if (node) onReady({ trap, ref });
          }}
          tabIndex={-1}
        >
          <button>第一个</button>
          <button>第二个</button>
        </section>
      );
    }
    return render(<Probe />);
  }

  function makeTabEvent(shiftKey = false): KeyboardEvent<HTMLElement> {
    return {
      key: "Tab",
      shiftKey,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent<HTMLElement>;
  }

  /**
   * jsdom has no layout engine, so `getClientRects()` always returns an empty
   * list. The trap handler filters out elements with no client rect (hidden
   * elements) — which is correct in real browsers but would drop every button
   * in jsdom. This helper stubs `getClientRects` on the test buttons so the
   * filter treats them as visible.
   */
  function makeVisible(element: HTMLElement) {
    element.getClientRects = () =>
      [{ width: 10, height: 10 }] as unknown as DOMRectList;
  }

  it("wraps Tab focus from the last focusable to the first", () => {
    let trapFn: ((event: KeyboardEvent<HTMLElement>) => void) | null = null;
    let trapRef: RefObject<HTMLElement | null> | null = null;
    renderTrap((handlers) => {
      trapFn = handlers.trap;
      trapRef = handlers.ref;
    });

    const container = trapRef!.current!;
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    );
    const firstFocus = vi.fn();
    const lastFocus = vi.fn();
    buttons[0]!.focus = firstFocus as unknown as (
      options?: FocusOptions,
    ) => void;
    buttons[1]!.focus = lastFocus as unknown as (
      options?: FocusOptions,
    ) => void;
    makeVisible(buttons[0]!);
    makeVisible(buttons[1]!);

    // Simulate the LAST button being active, then Tab → wrap to first.
    vi.spyOn(document, "activeElement", "get").mockReturnValue(buttons[1]!);
    act(() => trapFn!(makeTabEvent(false)));
    expect(firstFocus).toHaveBeenCalled();
  });

  it("wraps Shift+Tab focus from the first focusable to the last", () => {
    let trapFn: ((event: KeyboardEvent<HTMLElement>) => void) | null = null;
    let trapRef: RefObject<HTMLElement | null> | null = null;
    renderTrap((handlers) => {
      trapFn = handlers.trap;
      trapRef = handlers.ref;
    });

    const container = trapRef!.current!;
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    );
    const firstFocus = vi.fn();
    const lastFocus = vi.fn();
    buttons[0]!.focus = firstFocus as unknown as (
      options?: FocusOptions,
    ) => void;
    buttons[1]!.focus = lastFocus as unknown as (
      options?: FocusOptions,
    ) => void;
    makeVisible(buttons[0]!);
    makeVisible(buttons[1]!);

    // Simulate the FIRST button being active, then Shift+Tab → wrap to last.
    vi.spyOn(document, "activeElement", "get").mockReturnValue(buttons[0]!);
    act(() => trapFn!(makeTabEvent(true)));
    expect(lastFocus).toHaveBeenCalled();
  });

  it("prevents default on Tab so focus does not escape the overlay", () => {
    let trapFn: ((event: KeyboardEvent<HTMLElement>) => void) | null = null;
    renderTrap((handlers) => {
      trapFn = handlers.trap;
    });
    const preventDefault = vi.fn();
    act(() => {
      trapFn!({
        key: "Tab",
        preventDefault,
      } as unknown as KeyboardEvent<HTMLElement>);
    });
    expect(preventDefault).toHaveBeenCalled();
  });

  it("ignores non-Tab keys", () => {
    let trapFn: ((event: KeyboardEvent<HTMLElement>) => void) | null = null;
    renderTrap((handlers) => {
      trapFn = handlers.trap;
    });
    const preventDefault = vi.fn();
    act(() => {
      trapFn!({
        key: "Enter",
        preventDefault,
      } as unknown as KeyboardEvent<HTMLElement>);
    });
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
