// GET /portal/disc/[id]/bao-cao — tải lại báo cáo (HTML in được → Ctrl+P → Lưu PDF). Chỉ đọc.
//
// Cùng cổng với trang chi tiết: cờ tắt / không phải PARENT / bài không thuộc người đăng nhập ⇒ 404 y hệt nhau
// (không phân biệt "không tồn tại" với "của người khác"). Không cache chung; không cho công cụ tìm kiếm lập chỉ mục.
import { docChiTietLuot, dungBaoCaoHtmlChoLuot } from "@/lib/disc/portal-doc";

import { docPhienDisc } from "../../_lib/phien-disc";

export const dynamic = "force-dynamic";

const KHONG_TIM_THAY = () => new Response("Không tìm thấy", { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const phien = await docPhienDisc();
  if (!phien.ok) return phien.loai === "CO_TAT" ? KHONG_TIM_THAY() : new Response("Cần đăng nhập", { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const { id } = await ctx.params;
  const luot = await docChiTietLuot(phien.userId, id);
  // Không còn nhánh PDF (chủ dự án 04/11/2026): chỉ bản HTML in được.
  const html = luot ? dungBaoCaoHtmlChoLuot(luot) : null;
  if (!html) return KHONG_TIM_THAY();
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}
