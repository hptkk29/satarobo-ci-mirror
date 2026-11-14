/**
 * GET /api/portal/tu-sach/tai/<so> — xin LINK TẢI PDF một ebook, dành cho PHỤ HUYNH ĐÃ ĐĂNG NHẬP (08/11/2026).
 *
 *  → 200 { ok:true, url } (link R2 ký sẵn, hết hạn 5 phút, ép tải về) · 401 chưa đăng nhập / hồ sơ chưa có phường/xã · 404 (cờ tắt / không có sách / chưa nhập tệp) · 429 · 503.
 *  - cờ TU_SACH_ENABLED tắt ⇒ 404 rỗng TRƯỚC mọi việc khác;
 *  - `userId` từ PHIÊN; điều kiện tải = hồ sơ (phiếu lead cùng SĐT) ĐÃ có phường/xã — không dùng thẻ mở khoá của trang công khai;
 *  - trả JSON để giao diện báo bằng lời (không lộ JSON thô).
 */
import { NextResponse } from "next/server";
import { isTuSachEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { docPhienMienPhi } from "@/lib/portal/phien-mien-phi";
import { phuHuynhDuocTai } from "@/lib/portal/tu-sach";
import { xinLinkTai } from "@/lib/tu-sach/tai";
import { khoTepR2 } from "@/lib/tu-sach/kho-r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_USER = { max: 60, windowMs: 10 * 60_000 };
const KHONG_LUU_DEM = { "Cache-Control": "no-store" } as const;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: KHONG_LUU_DEM });

export async function GET(_req: Request, ctx: { params: Promise<{ so: string }> }) {
  const phien = await docPhienMienPhi(isTuSachEnabled());
  if (!phien.ok) return phien.loai === "CO_TAT" ? new NextResponse(null, { status: 404 }) : json({ ok: false, loi: "CHUA_DANG_NHAP" }, 401);

  const gioiHan = await rateLimit({ key: `portal-tu-sach-tai:${phien.userId}`, ...LIMIT_USER });
  if (!gioiHan.success) return json({ ok: false, loi: "QUA_NHIEU_LAN" }, 429);

  const { so } = await ctx.params;
  const kq = await xinLinkTai({ soTho: so, daMoKhoa: await phuHuynhDuocTai(phien.userId), kho: khoTepR2 });
  if (kq.ok) return json({ ok: true, url: kq.url }, 200);
  return json({ ok: false, loi: kq.loi }, kq.trangThai);
}
