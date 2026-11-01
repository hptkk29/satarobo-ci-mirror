// app/(admin)/admin/nguon-hoa-hong/page.tsx — route GỐC của module: chỉ CHUYỂN HƯỚNG, không có thân.
//
// Quy tắc (06 §4.1, ca `[NHH-FE-11]`): tập ứng viên = các tab người xem có QUYỀN ∧ CỜ; chuyển sang tab ĐẦU TIÊN có
// hàng chờ > 0; không tab nào có việc thì sang ứng viên đầu tiên; tập RỖNG ⇒ 404 (không phải trang trống —
// `[NHH-FE-02b]`: Sale lúc pilot nguồn vào gốc thì 404). KHÔNG chuyển cứng sang tab Kỳ: lúc pilot nguồn
// (`engineBat` tắt) tab Kỳ trả 404, nên chuyển cứng là tặng người dùng một link chết ngay cửa vào.
//
// Số hàng chờ lấy từ cùng hàm với pill tab (`docSoHangChoTheoTab`) — không đếm lại (luật 12b).
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { loadNguonHoaHongScope } from "@/lib/nguon-hoa-hong/module-scope";
import { TAB_HREF, chonTabGoc } from "@/lib/nguon-hoa-hong/tab";

export const metadata = { title: "Nguồn lead & hoa hồng | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function NguonHoaHongGocPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fnguon-hoa-hong");
  const userId = session.user.id;
  const [scope, actor] = await Promise.all([loadNguonHoaHongScope(userId), resolveActor(userId)]);

  // Gác bằng HỢP mọi key của module; thiếu hết ⇒ 404 như "không có tab nào", không để lộ module tồn tại.
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong"])) notFound();

  const ungVien = scope.tabUngVien();
  const dich = chonTabGoc(ungVien, await docSoHangChoTheoTab(actor, scope));
  if (!dich) notFound();
  redirect(TAB_HREF[dich]);
}
