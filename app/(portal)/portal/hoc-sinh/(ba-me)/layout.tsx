import { redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/session";

// Màn Vào / Mã thoát là việc của BA MẸ. Đang ở chế độ học sinh thì không vào được (con không tự đổi mã hay tự chọn con khác).
export default async function BaMeLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/login");
  if (ctx.cheDo === "hoc-sinh") redirect("/portal/hoc-sinh");
  return children;
}
