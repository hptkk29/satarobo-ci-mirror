import { redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/session";

// Mọi trang của Cổng học sinh CHỈ mở khi đang ở chế độ học sinh (cookie portal_hv đã ký, đúng phụ huynh + đúng con).
// Chưa ở chế độ ⇒ đá về màn "Cho con vào" (nơi tạo mã thoát và bấm vào) — vào Cổng học sinh mà chưa có mã thì không ai thoát được.
// Layout của SEGMENT chạy lại mỗi lần đi vào segment, kể cả điều hướng mềm — khác layout gốc của portal.
export default async function HocSinhLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/login");
  if (ctx.cheDo !== "hoc-sinh") redirect("/portal/hoc-sinh/vao");
  return children;
}
