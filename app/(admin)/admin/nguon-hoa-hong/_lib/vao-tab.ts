// app/(admin)/admin/nguon-hoa-hong/_lib/vao-tab.ts — CỔNG VÀO chung của năm tab (05 §1.5).
//
// Thứ tự cố định, và thứ tự là một phần của luật:
//   1. chưa đăng nhập        ⇒ /login (layout admin đã gác; đây là lưới cuối cho gọi trực tiếp);
//   2. CỜ của tab TẮT         ⇒ `notFound()` — "cờ tắt = màn không tồn tại" (như `/payments/hoa-don`). Đứng TRƯỚC câu
//      hỏi quyền để người không có quyền cũng không dò được tab nào đang có thật khi cờ bật.
//      ⚠️ THÂN trang là "Không tìm thấy trang" nhưng MÃ HTTP có thể là 200, không phải 404: route có `loading.tsx` đã
//      flush khung chờ trước khi `notFound()` chạy (đo khi dựng module; `/payments/hoa-don` cũng vậy). Đừng viết ca
//      nghiệm thu / giám sát kết luận "cờ tắt" từ mã 404; muốn 404 thật thì phải gác cờ ở layout cấp segment;
//   3. quyền                 ⇒ do PAGE (so với `PAGE_GATES[href]` ngay trong page.tsx — lưới `page-gates` đòi
//      chuỗi đó nằm trong chính page), hiện `NoPermission` nêu tên key + hỏi ai.
//
// Quyền hỏi MỘT lần (`loadNguonHoaHongScope`); `resolveActor` đã React.cache nên lấy actor thêm không tốn câu SQL.
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { loadNguonHoaHongScope } from "@/lib/nguon-hoa-hong/module-scope";
import type { NguonHoaHongScope } from "@/lib/nguon-hoa-hong/scope";
import { TAB_HREF, coCuaTab, type TabKey } from "@/lib/nguon-hoa-hong/tab";

export type VaoTab = { userId: string; actor: Actor; scope: NguonHoaHongScope };

export async function vaoTab(tab: TabKey): Promise<VaoTab> {
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(TAB_HREF[tab])}`);
  const userId = session.user.id;
  const [scope, actor] = await Promise.all([loadNguonHoaHongScope(userId), resolveActor(userId)]);
  if (!scope.co[coCuaTab(tab)]) notFound();
  return { userId, actor, scope };
}
