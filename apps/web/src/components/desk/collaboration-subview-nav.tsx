import { DeskSubviewNav } from "@/components/desk/desk-subview-nav";

const COLLABORATION_SUBVIEWS = [
  {
    href: "/app/collaboration",
    icon: "clipboard" as const,
    label: "审阅与反馈",
  },
  {
    href: "/app/workspaces",
    icon: "users" as const,
    label: "空间与成员",
  },
] as const;

export function CollaborationSubviewNav({
  activePath,
}: Readonly<{ activePath: string }>) {
  return (
    <DeskSubviewNav
      activePath={activePath}
      ariaLabel="协作空间视图"
      items={COLLABORATION_SUBVIEWS}
    />
  );
}
