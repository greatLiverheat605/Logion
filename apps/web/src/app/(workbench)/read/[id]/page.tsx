import { Reader } from "@/platform/workbench/reader";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Reader id={id} />;
}
