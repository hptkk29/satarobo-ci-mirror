import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DesignSystemDemo } from "./client";

export const metadata = { title: "Design System Preview | Admin" };

export default async function DesignSystemPreviewPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") redirect("/dashboard");

  return <DesignSystemDemo />;
}
