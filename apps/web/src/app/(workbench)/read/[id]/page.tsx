import { ThreePanes } from "@/platform/workbench/panes";
import { ReaderInformation } from "@/platform/workbench/library";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ThreePanes info={<ReaderInformation id={id} />} />;
}
