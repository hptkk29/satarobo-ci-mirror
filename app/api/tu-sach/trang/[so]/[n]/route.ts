/**
 * GET /api/tu-sach/trang/<so>/<n> — ảnh TRANG ebook để ĐỌC trực tuyến (07/11/2026).
 * ĐỌC THỬ (08/11/2026): 1/4 số trang đầu miễn phí, không cần thẻ; trang sau đó cần thẻ mở khoá (đã để lại thông tin).
 *
 *  → 302 tới ảnh ở R2 (`tu-sach/ebook/<so>/p<n>.webp`) · 401 trang ngoài phần đọc thử mà chưa mở khoá · 404 (cờ tắt / sai số / kho chưa cấu hình).
 * Không kiểm tệp có tồn tại (một lần HEAD mỗi trang là quá đắt): ảnh chưa nhập ⇒ R2 trả 404 ⇒ trình đọc tự giữ trang giả của thiết kế.
 */
import { NextResponse } from "next/server";
import { isTuSachEnabled } from "@/lib/flags";
import { getPublicUrl, r2DaCauHinh } from "@/lib/storage/r2-client";
import { daMoKhoa } from "@/lib/cong-thong-tin/doc-the";
import { EBOOKS, khoaSach, soTrangDocThu } from "@/lib/tu-sach/ebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ so: string; n: string }> }) {
  if (!isTuSachEnabled()) return new NextResponse(null, { status: 404 });
  const { so, n } = await ctx.params;
  if (!/^[0-9]{1,3}$/.test(so) || !/^[0-9]{1,4}$/.test(n)) return new NextResponse(null, { status: 404 });
  const ebook = EBOOKS.find((e) => e.so === Number(so));
  const trang = Number(n);
  if (!ebook || trang < 1 || trang > ebook.soTrang) return new NextResponse(null, { status: 404 });
  if (!r2DaCauHinh()) return new NextResponse(null, { status: 404 });
  // Đọc thử 1/4 số trang đầu không cần thẻ; từ trang kế tiếp phải ĐÃ để lại thông tin (thẻ mở khoá, kiểm ở máy chủ). Cố ý 401 chứ không 302: không lộ địa chỉ ảnh.
  if (trang > soTrangDocThu(ebook.soTrang) && !(await daMoKhoa())) return new NextResponse(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.redirect(getPublicUrl(khoaSach.trang(ebook.so, trang)), { status: 302, headers: { "Cache-Control": trang <= soTrangDocThu(ebook.soTrang) ? "public, max-age=3600, s-maxage=86400" : "private, max-age=3600" } });
}
