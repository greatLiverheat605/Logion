import { PublicShareView } from "@/features/growth/public-share";

export const metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicShareView token={token} />;
}
