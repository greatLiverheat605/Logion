"use client";

import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { getNonce } from "get-nonce";
import {
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import { AppIcon } from "@/components/app-shell/app-icon";

function joinClassNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

interface DialogSurfaceProps {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  title: ReactNode;
  trigger?: ReactElement;
}

function DialogSurface({
  children,
  description,
  footer,
  onOpenChange,
  open,
  restoreFocusRef,
  sheet,
  title,
  trigger,
}: DialogSurfaceProps & { sheet: boolean }) {
  const descriptionProps = description ? {} : { "aria-describedby": undefined };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="headless-overlay" />
        <Dialog.Content
          {...descriptionProps}
          className={joinClassNames(
            "headless-dialog",
            sheet && "headless-sheet",
          )}
          onCloseAutoFocus={(event) => {
            if (!restoreFocusRef?.current) return;
            event.preventDefault();
            restoreFocusRef.current.focus();
          }}
        >
          <header className="headless-surface-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description ? (
                <Dialog.Description>{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="关闭"
                className="headless-icon-button"
                type="button"
              >
                <AppIcon name="close" />
              </button>
            </Dialog.Close>
          </header>
          <div className="headless-surface-body">{children}</div>
          {footer ? (
            <footer className="headless-surface-footer">{footer}</footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WorkbenchDialog(props: DialogSurfaceProps) {
  return <DialogSurface {...props} sheet={false} />;
}

export function WorkbenchSheet(props: DialogSurfaceProps) {
  return <DialogSurface {...props} sheet />;
}

export function WorkbenchPopover({
  align = "end",
  children,
  trigger,
}: Readonly<{
  align?: "center" | "end" | "start";
  children: ReactNode;
  trigger: ReactElement;
}>) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          className="headless-popover"
          sideOffset={6}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface WorkbenchMenuItem {
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  id: string;
  label: ReactNode;
  onSelect?: () => void;
}

function DropdownItems({ items }: { items: readonly WorkbenchMenuItem[] }) {
  return items.map((item) => (
    <DropdownMenu.Item
      className={joinClassNames(
        "headless-menu-item",
        item.danger && "is-danger",
      )}
      disabled={item.disabled}
      key={item.id}
      onSelect={item.onSelect}
    >
      {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
      {item.label}
    </DropdownMenu.Item>
  ));
}

export function WorkbenchDropdownMenu({
  align = "end",
  items,
  label,
  trigger,
}: Readonly<{
  align?: "center" | "end" | "start";
  items: readonly WorkbenchMenuItem[];
  label: string;
  trigger: ReactElement;
}>) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          aria-label={label}
          className="headless-menu"
          sideOffset={6}
        >
          <DropdownItems items={items} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export interface WorkbenchTab {
  count?: number;
  label: ReactNode;
  value: string;
}

export function WorkbenchTabs({
  children,
  label,
  onValueChange,
  tabs,
  value,
}: Readonly<{
  children: ReactNode;
  label: string;
  onValueChange: (value: string) => void;
  tabs: readonly WorkbenchTab[];
  value: string;
}>) {
  return (
    <Tabs.Root
      className="headless-tabs-root"
      onValueChange={onValueChange}
      value={value}
    >
      <Tabs.List aria-label={label} className="headless-tabs-list">
        {tabs.map((tab) => (
          <Tabs.Trigger
            className="headless-tab"
            key={tab.value}
            value={tab.value}
          >
            {tab.label}
            {tab.count === undefined ? null : (
              <span className="headless-tab-count">{tab.count}</span>
            )}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}

export function WorkbenchTabPanel({
  children,
  forceMount,
  value,
}: Readonly<{
  children: ReactNode;
  forceMount?: boolean;
  value: string;
}>) {
  return (
    <Tabs.Content
      className="headless-tab-panel"
      forceMount={forceMount ? true : undefined}
      value={value}
    >
      {children}
    </Tabs.Content>
  );
}

export function WorkbenchTooltip({
  children,
  content,
}: Readonly<{ children: ReactElement; content: ReactNode }>) {
  return (
    <Tooltip.Provider delayDuration={400}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="headless-tooltip" sideOffset={5}>
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export interface WorkbenchSelectOption {
  disabled?: boolean;
  label: ReactNode;
  value: string;
}

export function WorkbenchSelect({
  disabled,
  label,
  onValueChange,
  options,
  placeholder,
  value,
}: Readonly<{
  disabled?: boolean;
  label: string;
  onValueChange: (value: string) => void;
  options: readonly WorkbenchSelectOption[];
  placeholder?: string;
  value?: string;
}>) {
  const [nonce] = useState(() => {
    const runtimeNonce = getNonce();
    if (runtimeNonce) return runtimeNonce;
    if (typeof document === "undefined") return undefined;
    return document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
  });
  return (
    <Select.Root
      disabled={disabled}
      onValueChange={onValueChange}
      value={value}
    >
      <Select.Trigger aria-label={label} className="headless-select-trigger">
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <AppIcon name="chevron-down" size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="headless-select-content" position="popper">
          <Select.Viewport nonce={nonce}>
            {options.map((option) => (
              <Select.Item
                className="headless-select-item"
                disabled={option.disabled}
                key={option.value}
                value={option.value}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator aria-hidden="true">
                  ✓
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function ContextItems({ items }: { items: readonly WorkbenchMenuItem[] }) {
  return items.map((item) => (
    <ContextMenu.Item
      className={joinClassNames(
        "headless-menu-item",
        item.danger && "is-danger",
      )}
      disabled={item.disabled}
      key={item.id}
      onSelect={item.onSelect}
    >
      {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
      {item.label}
    </ContextMenu.Item>
  ));
}

export function WorkbenchContextMenu({
  children,
  items,
  label,
}: Readonly<{
  children: ReactElement;
  items: readonly WorkbenchMenuItem[];
  label: string;
}>) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content aria-label={label} className="headless-menu">
          <ContextItems items={items} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
