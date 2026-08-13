import Link from "next/link";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";

export interface DeskSubviewLink {
  href: string;
  icon: AppIconName;
  label: string;
}

interface DeskSubviewNavProps {
  activePath: string;
  ariaLabel: string;
  items: readonly DeskSubviewLink[];
}

/**
 * Keeps high-frequency workbench subviews visible without duplicating the
 * formal route manifest in each feature page.
 */
export function DeskSubviewNav({
  activePath,
  ariaLabel,
  items,
}: Readonly<DeskSubviewNavProps>) {
  return (
    <nav aria-label={ariaLabel} className="desk-subview-nav">
      {items.map((item) => {
        const active = item.href === activePath;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={
              active ? "desk-subview-link active" : "desk-subview-link"
            }
            href={item.href}
            key={item.href}
          >
            <AppIcon aria-hidden="true" name={item.icon} size={15} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
