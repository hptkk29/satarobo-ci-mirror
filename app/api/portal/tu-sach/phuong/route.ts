/**
 * POST /api/portal/tu-sach/phuong — phụ huynh ĐÃ ĐĂNG NHẬP lưu phường/xã MỘT lần để tải sách (08/11/2026).
 *
 *  body: { phuong: "<tên phường/xã của Tp Đà Nẵng>" } → 200 { ok:true } · 400 { ok:false, loi } · 401 · 404 (cờ tắt) · 429 · 503.
 *  - cờ TU_SACH_ENABLED tắt ⇒ 404 rỗng TRƯỚC mọi việc; `userId` từ PHIÊN; họ tên + SĐT lấy từ TÀI KHOẢN (không nhận từ trình duyệt);
 *  - chỉ ĐIỀN CHỖ TRỐNG của phiếu lead hiện có (đồng bộ sang học viên đang nối), hoặc tạo phiếu nếu chưa có — xem `lib/portal/tu-sach.ts`;
 *  - body có trần byte; KHÔNG log body; lỗi chỉ log MÃ.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { isTuSachEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { docBodyCoTran } from "@/lib/disc/doc-body";
import { docPhienMienPhi } from "@/lib/portal/phien-mien-phi";
import { luuPhuongPhuHuynh } from "@/lib/portal/tu-sach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRAN_BODY_BYTE = 2 * 1024;
const LIMIT_USER = { max: 10, windowMs: 60 * 60_000 };
const KHONG_LUU_DEM = { "Cache-Control": "no-store" } as const;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: KHONG_LUU_DEM });

const bodySchema = z.object({ phuong: z.string().min(1).max(120) });

export async function POST(req: Request) {
  const phien = await docPhienMienPhi(isTuSachEnabled());
  if (!phien.ok) return phien.loai === "CO_TAT" ? new NextResponse(null, { status: 404 }) : json({ ok: false, loi: "CHUA_DANG_NHAP" }, 401);

  const gioiHan = await rateLimit({ key: `portal-tu-sach-phuong:${phien.userId}`, ...LIMIT_USER });
  if (!gioiHan.success) return json({ ok: false, loi: "QUA_NHIEU_LAN" }, 429);

  const doc = await docBodyCoTran(req, TRAN_BODY_BYTE);
  if (!doc.ok) return json({ ok: false, loi: "QUA_LON" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(doc.text);
  } catch {
    return json({ ok: false, loi: "DU_LIEU_SAI" }, 400);
  }
  const b = bodySchema.safeParse(raw);
  if (!b.success) return json({ ok: false, loi: "DU_LIEU_SAI" }, 400);

  const kq = await luuPhuongPhuHuynh(phien.userId, b.data.phuong);
  if (kq.ok) return json({ ok: true }, 200);
  if (kq.ma === "LOI_HE_THONG") return json({ ok: false, loi: kq.ma }, 503);
  return json({ ok: false, loi: kq.ma }, 400);
}
