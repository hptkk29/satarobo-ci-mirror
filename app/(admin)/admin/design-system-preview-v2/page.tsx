import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DesignSystemV2Demo } from "./client";

export const metadata = { title: "Design System v2 Preview | Admin" };

export default async function DesignSystemV2PreviewPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") redirect("/dashboard");

  return <DesignSystemV2Demo />;
}
