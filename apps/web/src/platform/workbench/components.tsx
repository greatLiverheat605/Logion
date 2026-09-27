"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as Tabs from "@radix-ui/react-tabs";
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { toast } from "sonner";

export function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`wb-button ${className}`} {...props} />
  );
}
export function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Tabs.Root value={value} onValueChange={onChange}>
      <Tabs.List className="wb-segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <Tabs.Trigger
            key={option.id}
            value={option.id}
            role="radio"
            aria-checked={value === option.id}
            aria-selected={undefined}
            aria-controls={undefined}
          >
            {option.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
export function Menu({
  label,
  children,
  items,
}: {
  label: string;
  children?: ReactNode;
  items: {
    label: string;
    action: () => void;
    checked?: boolean;
    disabled?: boolean;
  }[];
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button aria-label={label}>{children ?? label}</Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="wb-scope wb-popup"
          sideOffset={6}
          collisionPadding={12}
        >
          {items.map((item) => (
            <Dropdown.Item
              key={item.label}
              disabled={item.disabled}
              onSelect={item.action}
            >
              {item.checked ? "✓ " : ""}
              {item.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export function Sheet({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="wb-overlay" />
        <Dialog.Content className="wb-scope wb-sheet">
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button aria-label="关闭">×</Button>
            </Dialog.Close>
          </header>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Popover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <Button>{label}</Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="wb-scope wb-popup"
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
        >
          {children}
          <PopoverPrimitive.Close asChild>
            <Button>关闭</Button>
          </PopoverPrimitive.Close>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
export function Inspector({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <aside className="wb-inspector" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </aside>
  );
}
export function List({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <ul className="wb-list" aria-label={label}>
      {children}
    </ul>
  );
}
// Routine success stays inline. Only actionable failures create a notification.
export function notifyAction(message: string) {
  toast.error(message);
}
