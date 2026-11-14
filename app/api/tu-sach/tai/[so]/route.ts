/**
 * GET /api/tu-sach/tai/<so> — xin LINK TẢI PDF của một ebook (07/11/2026).
 *
 *  → 200 { ok:true, url } (link R2 ký sẵn, hết hạn 5 phút, ép tải về) · 401 chưa để lại thông tin · 404 (cờ tắt / không có sách / chưa nhập tệp) · 429 · 503.
 *  - cờ TU_SACH_ENABLED tắt ⇒ 404 rỗng TRƯỚC mọi việc khác;
 *  - kiểm THẺ MỞ KHOÁ ở máy chủ (cookie httpOnly `sr_ctt`), không tin gì từ trình duyệt;
 *  - chặn tần suất theo IP; trả JSON (giao diện đọc `loi` và báo bằng lời, không để người dùng thấy JSON thô).
 */
import { NextResponse } from "next/server";
import { isTuSachEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { daMoKhoa } from "@/lib/cong-thong-tin/doc-the";
import { xinLinkTai } from "@/lib/tu-sach/tai";
import { khoTepR2 } from "@/lib/tu-sach/kho-r2";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_IP = { max: 60, windowMs: 10 * 60_000 };
const KHONG_LUU_DEM = { "Cache-Control": "no-store" } as const;

export async function GET(req: Request, ctx: { params: Promise<{ so: string }> }) {
  if (!isTuSachEnabled()) return new NextResponse(null, { status: 404 });
  const ip = createHash("sha256").update(ipChoRateLimit(req.headers)).digest("hex").slice(0, 24);
  const gioiHan = await rateLimit({ key: `tu-sach-tai:${ip}`, ...LIMIT_IP });
  if (!gioiHan.success) return NextResponse.json({ ok: false, loi: "QUA_NHIEU_LAN" }, { status: 429, headers: KHONG_LUU_DEM });

  const { so } = await ctx.params;
  const kq = await xinLinkTai({ soTho: so, daMoKhoa: await daMoKhoa(), kho: khoTepR2 });
  if (kq.ok) return NextResponse.json({ ok: true, url: kq.url }, { status: 200, headers: KHONG_LUU_DEM });
  return NextResponse.json({ ok: false, loi: kq.loi }, { status: kq.trangThai, headers: KHONG_LUU_DEM });
}
