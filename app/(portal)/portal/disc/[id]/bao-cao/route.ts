// GET /portal/disc/[id]/bao-cao — tải lại báo cáo (HTML in được → Ctrl+P → Lưu PDF). Chỉ đọc.
//
// Cùng cổng với trang chi tiết: cờ tắt / không phải PARENT / bài không thuộc người đăng nhập ⇒ 404 y hệt nhau
// (không phân biệt "không tồn tại" với "của người khác"). Không cache chung; không cho công cụ tìm kiếm lập chỉ mục.
import { docChiTietLuot, dungBaoCaoHtmlChoLuot } from "@/lib/disc/portal-doc";

import { docPhienDisc } from "../../_lib/phien-disc";

export const dynamic = "force-dynamic";

const KHONG_TIM_THAY = () => new Response("Không tìm thấy", { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const phien = await docPhienDisc({ phamVi: "DOC" });
  if (!phien.ok) {
    if (phien.loai === "CO_TAT") return KHONG_TIM_THAY();
    const kho = { "Cache-Control": "private, no-store" };
    // V8.31: chưa mở khoá DISC ⇒ 403 (KHÔNG phải 401: đã đăng nhập); lỗi hệ thống bảo vệ ⇒ 503 (fail-closed).
    if (phien.loai === "CHUA_MO_KHOA") return new Response("Cần nhập mã PIN để mở sổ DISC", { status: 403, headers: kho });
    if (phien.loai === "LOI_HE_THONG") return new Response("Hệ thống bảo vệ đang gặp sự cố", { status: 503, headers: kho });
    return new Response("Cần đăng nhập", { status: 401, headers: kho });
  }
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
