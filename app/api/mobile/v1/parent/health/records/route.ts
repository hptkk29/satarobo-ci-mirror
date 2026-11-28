import { fail } from "@/lib/api/response";
import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, motMobileTat, traThanhCong } from "@/lib/mobile-api/cong";
import { docSucKhoeMobile, luuSucKhoeMobile, motSucKhoeTat, xoaSucKhoeMobile } from "@/lib/mobile-api/dich-vu/suc-khoe-luu";
import { luuSucKhoeSchema, THAN_TOI_DA_BYTE_SUC_KHOE } from "@/lib/suc-khoe/luu-may-chu";

export const dynamic = "force-dynamic";

/**
 * /api/mobile/v1/parent/health/records — SỨC KHOẺ LƯU CÓ CHỦ ĐÍCH (HL-01). Chủ tài khoản từ PHIÊN; Student Mode ⇒ 403; cờ `SUC_KHOE_ENABLED` tắt ⇒ 404 TRƯỚC khi đọc thân.
 *   GET    — xem/khôi phục khi đổi máy: `{ coDuLieu, dongY?, capNhatLuc?, hetHanLuc?, nguoi?, luuTru }` (hết hạn/chưa lưu ⇒ `coDuLieu:false`)
 *   PUT    — lưu THAY THẾ toàn bộ (idempotent): `{ truocCapNhatLuc?, dongY:{phienBan,luc}, nguoi:[…≤6 người, ≤3 bản] }` strict; thân ≤ 64 KB; lệch `truocCapNhatLuc` ⇒ 409 `SUC_KHOE_DA_THAY_DOI`; thiếu khoá mã hoá ⇒ 503
 *   DELETE — xoá cứng toàn bộ (NĐ 13/2023): `{ daXoa }`
 * Không log thân; nội dung lưu mã hoá AES-256-GCM; không có studentId.
 */
export async function GET(req: Request) {
  const tat = motMobileTat() ?? motSucKhoeTat();
  if (tat) return tat;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await docSucKhoeMobile(nguoi.userId)));
}

export async function PUT(req: Request) {
  const tat = motMobileTat() ?? motSucKhoeTat();
  if (tat) return tat;
  const cl = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(cl) && cl > THAN_TOI_DA_BYTE_SUC_KHOE) return fail("PAYLOAD_TOO_LARGE", "Yêu cầu quá lớn.", { status: 413, headers: { "Cache-Control": "no-store" } });
  return chayChoPhuHuynhCoThan(req, luuSucKhoeSchema, async (nguoi, _ctx, than) => traThanhCong(await luuSucKhoeMobile(nguoi.userId, than)));
}

export async function DELETE(req: Request) {
  const tat = motMobileTat() ?? motSucKhoeTat();
  if (tat) return tat;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await xoaSucKhoeMobile(nguoi.userId)));
}
