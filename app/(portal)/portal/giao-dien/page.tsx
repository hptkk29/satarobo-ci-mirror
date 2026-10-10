import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPortalV2Enabled } from "@/lib/flags";
import { GiaoDienPage } from "@/components/portal/giao-dien-page";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Giao diện | Sata Robo",
  robots: { index: false },
};

export default async function Page() {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") redirect("/login");

  // Trang này sống nhờ PortalAppearanceProvider — provider chỉ tồn tại trong shell
  // v2. Flag OFF → shell cũ render, không có context → 404 thay vì crash.
  if (!isPortalV2Enabled()) notFound();

  return <GiaoDienPage />;
}
