/**
 * POST /api/cong-thong-tin/de-lai — hộp «để lại thông tin» dùng chung của Tủ sách + Sức khỏe (07/11/2026).
 *
 *  → 200 { ok:true } + cookie httpOnly `sr_ctt` (thẻ mở khoá, ký HMAC) · 400 { ok:false, loi:[{truong,thongBao}] } · 413 · 429 · 404 (cờ tắt) · 503 (lỗi hạ tầng).
 *
 * Bất biến:
 *  - cả hai cờ TU_SACH_ENABLED / SUC_KHOE_ENABLED tắt ⇒ 404 TRƯỚC mọi việc; phiếu mang `nguon` của tính năng đang TẮT ⇒ 404;
 *  - body đọc theo luồng có trần byte (như các route DISC); chặn tần suất theo IP, theo CẶP (SĐT băm, IP) và trần cứng theo SĐT;
 *  - phiếu CHỈ gồm thông tin liên hệ (xem `lib/cong-thong-tin/phieu.ts`) — route không nhận/không log câu trả lời sức khỏe;
 *  - ô bẫy có chữ ⇒ trả thành công GIẢ (không đặt thẻ, không tạo lead) để bot không biết mình bị nhận ra;
 *  - phản hồi KHÔNG phân biệt SĐT đã là lead hay mới (không oracle dò SĐT);
 *  - KHÔNG log body; lỗi chỉ log MÃ.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isSucKhoeEnabled, isTuSachEnabled, isCongThongTinEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { getSigningSecret } from "@/lib/security/signing-key";
import { docBodyCoTran } from "@/lib/disc/doc-body";
import { maLoiAnToan } from "@/lib/disc/crm";
import { kiemTraPhieu } from "@/lib/cong-thong-tin/phieu";
import { taoLeadTuCong } from "@/lib/cong-thong-tin/tao-lead";
import { COOKIE_MO_KHOA, kyTheMoKhoa, TUOI_THE_MO_KHOA_GIAY } from "@/lib/cong-thong-tin/the-mo-khoa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRAN_BODY_BYTE = 8 * 1024;
const LIMIT_IP = { max: 10, windowMs: 10 * 60_000 };
const LIMIT_CAP = { max: 5, windowMs: 60 * 60_000 };
const LIMIT_SDT_CUNG = { max: 30, windowMs: 60 * 60_000 };

const KHONG_LUU_DEM = { "Cache-Control": "no-store" } as const;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: KHONG_LUU_DEM });
const bam = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

function datThe(res: NextResponse, nguon: string): NextResponse {
  res.cookies.set(COOKIE_MO_KHOA, kyTheMoKhoa({ nguon, bayGio: new Date(), khoa: getSigningSecret() }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TUOI_THE_MO_KHOA_GIAY,
  });
  return res;
}

export async function POST(req: Request) {
  if (!isCongThongTinEnabled()) return new NextResponse(null, { status: 404 });

  const ip = ipChoRateLimit(req.headers);
  const gIp = await rateLimit({ key: `ctt:ip:${bam(ip)}`, ...LIMIT_IP });
  if (!gIp.success) return json({ ok: false, loi: [{ truong: "khac", thongBao: "Anh chị thử lại sau ít phút nhé." }] }, 429);

  const doc = await docBodyCoTran(req, TRAN_BODY_BYTE);
  if (!doc.ok) return json({ ok: false, loi: [{ truong: "khac", thongBao: "Dữ liệu gửi lên quá lớn" }] }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(doc.text);
  } catch {
    return json({ ok: false, loi: [{ truong: "khac", thongBao: "Dữ liệu gửi lên chưa đúng" }] }, 400);
  }

  const kq = kiemTraPhieu(raw);
  if (!kq.ok) return json({ ok: false, loi: kq.loi }, 400);
  const { phieu } = kq;

  // Tính năng của phiếu đang TẮT ⇒ như không có route (không để một cờ bật mở lối cho cờ kia).
  if ((phieu.nguon === "tu-sach" && !isTuSachEnabled()) || (phieu.nguon === "suc-khoe" && !isSucKhoeEnabled())) return new NextResponse(null, { status: 404 });

  // Bẫy: trả thành công giả, KHÔNG tạo lead, KHÔNG đặt thẻ.
  if (kq.laMay) return json({ ok: true }, 200);

  const sdtBam = bam(phieu.soDienThoai);
  const [gCap, gSdt] = await Promise.all([
    rateLimit({ key: `ctt:cap:${sdtBam}:${bam(ip)}`, ...LIMIT_CAP }),
    rateLimit({ key: `ctt:sdt:${sdtBam}`, ...LIMIT_SDT_CUNG }),
  ]);
  if (!gCap.success || !gSdt.success) return json({ ok: false, loi: [{ truong: "khac", thongBao: "Anh chị thử lại sau ít phút nhé." }] }, 429);

  try {
    await taoLeadTuCong(phieu);
  } catch (err) {
    const ma = maLoiAnToan(err);
    console.error("[cong-thong-tin] de-lai:", ma);
    return json({ ok: false, loi: [{ truong: "khac", thongBao: "Hệ thống đang bận, anh chị thử lại giúp Sata Robo nhé." }] }, 503);
  }
  return datThe(json({ ok: true }, 200), phieu.nguon);
}
