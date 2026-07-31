import Link from "next/link";

export const SECURITY_DATA_ROUTES = [
  {
    href: "/app/security",
    id: "security",
    label: "账户与设备安全",
  },
  {
    href: "/app/data",
    id: "data",
    label: "导入、导出与删除",
  },
  {
    href: "/app/audit",
    id: "audit",
    label: "审计时间线",
  },
] as const;

type SecurityDataRouteId = (typeof SECURITY_DATA_ROUTES)[number]["id"];

export function SecurityDataNavigation({
  active,
}: Readonly<{ active: SecurityDataRouteId }>) {
  return (
    <nav className="system-workbench-nav" aria-label="安全与数据主权">
      <strong>安全与数据主权</strong>
      {SECURITY_DATA_ROUTES.map((route) => (
        <Link
          aria-current={route.id === active ? "page" : undefined}
          href={route.href}
          key={route.id}
        >
          {route.label}
        </Link>
      ))}
    </nav>
  );
}
