import Link from "next/link";
import type { ReactNode } from "react";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";

interface SystemCenterNavItem {
  href: string;
  icon: AppIconName;
  label: string;
  description: string;
}

interface SystemCenterNavGroup {
  label: string;
  items: readonly SystemCenterNavItem[];
}

export const SYSTEM_CENTER_NAV_GROUPS: readonly SystemCenterNavGroup[] = [
  {
    label: "账户与偏好",
    items: [
      {
        description: "身份、显示名称与个人范围",
        href: "/app/profile",
        icon: "users",
        label: "账户",
      },
      {
        description: "画像、外观和通用偏好",
        href: "/app/settings",
        icon: "shield",
        label: "偏好设置",
      },
      {
        description: "受控状态与恢复路径",
        href: "/app/help",
        icon: "book-open",
        label: "帮助",
      },
    ],
  },
  {
    label: "安全与数据",
    items: [
      {
        description: "Passkey、TOTP、设备与会话",
        href: "/app/security",
        icon: "lock",
        label: "安全",
      },
      {
        description: "Vault、离线队列和冲突",
        href: "/app/sync",
        icon: "refresh",
        label: "数据与同步",
      },
      {
        description: "导出、导入与恢复",
        href: "/app/data",
        icon: "download",
        label: "数据主权",
      },
      {
        description: "授权范围内的事件记录",
        href: "/app/audit",
        icon: "clipboard",
        label: "审计",
      },
    ],
  },
  {
    label: "服务与治理",
    items: [
      {
        description: "日历、导入导出和开放格式",
        href: "/app/integrations",
        icon: "refresh",
        label: "互操作",
      },
      {
        description: "Provider、预算与 Draft",
        href: "/app/ai",
        icon: "ai",
        label: "AI 治理",
      },
    ],
  },
] as const;

function SystemCenterNav({ activePath }: Readonly<{ activePath: string }>) {
  return (
    <nav aria-label="系统中心设置" className="system-center-nav">
      {SYSTEM_CENTER_NAV_GROUPS.map((group) => (
        <section className="system-center-nav-group" key={group.label}>
          <h2>{group.label}</h2>
          <div className="system-center-nav-list">
            {group.items.map((item) => {
              const active = item.href === activePath;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={active ? "is-selected" : undefined}
                  href={item.href}
                  key={item.href}
                >
                  <span className="system-center-nav-icon">
                    <AppIcon aria-hidden="true" name={item.icon} size={16} />
                  </span>
                  <span className="system-center-nav-copy">
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}

export function SystemCenterFrame({
  activePath,
  children,
}: Readonly<{ activePath: string; children: ReactNode }>) {
  return (
    <div className="system-center-frame">
      <SystemCenterNav activePath={activePath} />
      <div className="system-center-detail">{children}</div>
    </div>
  );
}
