"use client";

import {
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";

import { toneClass } from "@/components/desk/desk-tone";

/* ---- Button -------------------------------------------------------------- */

export type DeskButtonTone = "primary" | "secondary" | "ghost" | "good" | "bad";
export type DeskButtonSize = "default" | "sm";

interface DeskButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  tone?: DeskButtonTone;
  size?: DeskButtonSize;
  loading?: boolean;
  type?: "button" | "submit" | "reset";
}

/**
 * Primary desk button. `loading` renders an inline spinner, disables the
 * control and sets `aria-busy` so pending commands cannot be double-submitted.
 */
export function DeskButton({
  children,
  className,
  disabled,
  loading = false,
  size = "default",
  tone = "primary",
  type = "button",
  ...rest
}: Readonly<DeskButtonProps>) {
  // primary/secondary/ghost are button-specific modifiers; good/bad map onto
  // the shared DeskTone vocabulary so they stay consistent with the rest of
  // the design system.
  const toneClassName =
    tone === "primary"
      ? ""
      : tone === "good" || tone === "bad"
        ? toneClass(tone)
        : `tone-${tone}`;
  const classes = [
    "desk-button",
    toneClassName,
    size === "sm" ? "desk-button-size-sm" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      {...rest}
      aria-busy={loading || undefined}
      className={classes}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? (
        <span aria-hidden="true" className="desk-button-spinner" />
      ) : null}
      {children}
    </button>
  );
}

/* ---- IconButton ---------------------------------------------------------- */

interface DeskIconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "aria-label"
> {
  /** Required Chinese label for assistive technology. */
  "aria-label": string;
  tone?: "default" | "bad";
  type?: "button" | "submit" | "reset";
}

/**
 * Icon-only button. A human-readable Chinese `aria-label` is mandatory — the
 * D2 design system requires every IconButton to name its action.
 */
export function DeskIconButton({
  children,
  className,
  tone = "default",
  type = "button",
  ...rest
}: Readonly<DeskIconButtonProps>) {
  const classes = [
    "desk-icon-button",
    toneClass(tone === "bad" ? "bad" : "default"),
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button {...rest} className={classes} type={type}>
      {children}
    </button>
  );
}

/* ---- Field (label + hint + error wrapper) -------------------------------- */

interface DeskFieldProps {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  errorId?: string;
  errorMessage?: ReactNode;
  htmlFor?: string;
  required?: boolean;
}

export function DeskField({
  children,
  errorId,
  errorMessage,
  hint,
  htmlFor,
  label,
  required = false,
}: Readonly<DeskFieldProps>) {
  return (
    <div className="desk-field">
      <label className="desk-field-label" htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true">*</span> : null}
      </label>
      {children}
      {hint && !errorMessage ? (
        <span className="desk-field-hint">{hint}</span>
      ) : null}
      {errorMessage ? (
        <span className="desk-field-error" id={errorId} role="alert">
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}

/* ---- Input --------------------------------------------------------------- */

interface DeskInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function DeskInput({
  className,
  invalid,
  ...rest
}: Readonly<DeskInputProps>) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={["desk-input", className ?? ""].filter(Boolean).join(" ")}
    />
  );
}

/* ---- Select -------------------------------------------------------------- */

interface DeskSelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children"
> {
  invalid?: boolean;
  children: ReactNode;
}

export function DeskSelect({
  children,
  className,
  invalid,
  ...rest
}: Readonly<DeskSelectProps>) {
  return (
    <select
      {...rest}
      aria-invalid={invalid || undefined}
      className={["desk-select", className ?? ""].filter(Boolean).join(" ")}
    >
      {children}
    </select>
  );
}

/* ---- Textarea ------------------------------------------------------------ */

interface DeskTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function DeskTextarea({
  className,
  invalid,
  ...rest
}: Readonly<DeskTextareaProps>) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid || undefined}
      className={["desk-textarea", className ?? ""].filter(Boolean).join(" ")}
    />
  );
}

/* ---- Toggle (switch) ----------------------------------------------------- */

interface DeskToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}

export function DeskToggle({
  checked,
  disabled,
  id,
  label,
  onChange,
}: Readonly<DeskToggleProps>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label className="desk-toggle">
      <input
        checked={checked}
        className="desk-toggle-input"
        disabled={disabled}
        id={inputId}
        type="checkbox"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="desk-toggle-track">
        <span className="desk-toggle-thumb" />
      </span>
      <span className="desk-toggle-label">{label}</span>
    </label>
  );
}

/* ---- Segmented control --------------------------------------------------- */

interface DeskSegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface DeskSegmentedControlProps<T extends string> {
  name?: string;
  options: readonly DeskSegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

/**
 * Compact single-choice control. Implemented as an ARIA radiogroup with roving
 * tabindex: the selected radio is in the tab order (`tabIndex=0`), all others
 * are `tabIndex=-1`. Arrow keys move both selection AND DOM focus to the
 * adjacent option, matching native radiogroup behaviour.
 */
export function DeskSegmentedControl<T extends string>({
  "aria-label": ariaLabel,
  disabled,
  name,
  onChange,
  options,
  value,
}: Readonly<DeskSegmentedControlProps<T>>) {
  const baseId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusOption = (index: number) => {
    const target = optionRefs.current[index];
    if (target) target.focus();
  };

  const handleKeyDown =
    (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
      if (
        event.key !== "ArrowRight" &&
        event.key !== "ArrowDown" &&
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowUp"
      ) {
        return;
      }
      event.preventDefault();
      const direction =
        event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const next = (index + direction + options.length) % options.length;
      const nextOption = options[next];
      if (nextOption) {
        onChange(nextOption.value);
        // Move DOM focus to the newly-selected option (roving tabindex).
        focusOption(next);
      }
    };

  return (
    <div
      aria-label={ariaLabel}
      className="desk-segmented"
      id={baseId}
      role="radiogroup"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            aria-checked={selected}
            className="desk-segmented-option"
            disabled={disabled}
            key={option.value}
            name={name}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            role="radio"
            tabIndex={selected ? 0 : -1}
            type="button"
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown(index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---- Tabs ---------------------------------------------------------------- */

interface DeskTab {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

interface DeskTabsProps {
  tabs: readonly DeskTab[];
  ariaLabel?: string;
}

/**
 * Tab group with full ARIA tablist semantics and roving tabindex:
 *
 * - The active tab is in the tab order (`tabIndex=0`); inactive tabs are
 *   `tabIndex=-1`.
 * - Arrow Left/Right move both selection AND DOM focus to the adjacent tab.
 * - Each tab has a unique `id` (derived from `useId`) and `aria-controls`
 *   pointing at its panel; each panel has `aria-labelledby` pointing back.
 * - Multiple `DeskTabs` instances never collide because the id prefix is
 *   unique per instance.
 */
export function DeskTabs({ ariaLabel, tabs }: Readonly<DeskTabsProps>) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? "");
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = (id: string) => `${baseId}-panel-${id}`;

  const focusTab = (index: number) => {
    const target = tabRefs.current[index];
    if (target) target.focus();
  };

  const handleKeyDown =
    (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = (index + direction + tabs.length) % tabs.length;
      const nextTab = tabs[next];
      if (nextTab) {
        setActiveId(nextTab.id);
        // Move DOM focus to the newly-selected tab (roving tabindex).
        focusTab(next);
      }
    };

  if (!active) {
    return null;
  }

  return (
    <div className="desk-tabs">
      <div aria-label={ariaLabel} className="desk-tab-list" role="tablist">
        {tabs.map((tab, index) => {
          const selected = tab.id === active.id;
          return (
            <button
              aria-controls={panelId(tab.id)}
              aria-selected={selected}
              className="desk-tab"
              id={tabId(tab.id)}
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
              onClick={() => setActiveId(tab.id)}
              onKeyDown={handleKeyDown(index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        aria-labelledby={tabId(active.id)}
        className="desk-tab-panel"
        id={panelId(active.id)}
        role="tabpanel"
      >
        {active.content}
      </div>
    </div>
  );
}

/* ---- Controlled field change helper ------------------------------------- */

/**
 * Convenience hook returning a stable change handler for controlled desk
 * inputs/selects/textareas that store a single string value.
 */
export function useDeskFieldChange<
  T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
>(onChange: (value: string) => void) {
  return useCallback(
    (event: ChangeEvent<T>) => onChange(event.currentTarget.value),
    [onChange],
  );
}
