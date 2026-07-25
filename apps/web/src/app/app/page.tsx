import { redirect } from "next/navigation";

export default function AuthenticatedShellPage() {
  redirect("/app/today");
}
