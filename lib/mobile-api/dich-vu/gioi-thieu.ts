import { coGioiThieuChoNguoiDung, docGioiThieuCuaToi } from "@/lib/affiliate/doc-cua-toi";
import { docLinkChoQrCuaToi } from "@/lib/affiliate/doc-link";
import { dungUrlChuyenHuong } from "@/lib/affiliate/dung-url-theo-doi";
import { LY_DO_THIEU_GOC, gocCongKhai } from "@/lib/affiliate/goc-cong-khai";
import { dungQrChoToken, svgThanhDataUri } from "@/lib/affiliate/qr-link";
import type { GioiThieuCuaToi } from "@/lib/affiliate/cua-toi";
import { tuTaoLink, tuTaoLinkSchema } from "@/lib/affiliate/tu-tao-link";

import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * V8.6 — GIỚI THIỆU BẠN BÈ / HOA HỒNG phía phụ huynh: lớp MỎNG bọc đúng domain Affiliate của web (`lib/affiliate/*`) — KHÔNG có công thức / sổ / chính sách hoa hồng riêng cho Mobile, KHÔNG chuyển tiền.
 *
 *   · Ai dùng được: phụ huynh có hồ sơ ĐỐI TÁC Affiliate đang hoạt động (bảng nối `AffiliatePartyUser`) VÀ cờ Affiliate bật. Không phải đối tác / cờ tắt / lỗi đọc cờ ⇒ cùng 404 (không phân biệt, như web).
 *   · Cách ly nằm ở TRUY VẤN của web (`partyIdsVaoDuoc` từ PHIÊN, không nhận id từ client); lược đồ trả về của web CHỈ có: link/QR của chính mình, số lượt bấm, số referral + ngày + chương trình (KHÔNG tên/SĐT/email khách, KHÔNG trạng thái hồ sơ CRM), hoa hồng CHỈ khi chương trình cho phép hiện số tiền.
 *   · Trạng thái hoa hồng đọc từ sổ web (`CommissionTransaction`: PENDING/APPROVED/EXPORTED/PAID/ON_HOLD…) — hoa hồng chỉ tồn tại SAU khi tiền thực thu và theo chính sách đã duyệt; khoản hoàn/điều chỉnh là dòng ÂM «Điều chỉnh» của sổ. App chỉ ĐỌC.
 *   · Tạo link / QR dùng đúng lõi của web (`tuTaoLink`: hạn mức link, cổng chuỗi, nhật ký; QR dựng từ token CỦA CHÍNH đối tác; id link của người khác ⇒ 404).
 *   · Chế độ học sinh KHÔNG truy cập (không có trong allow-list H-S3; kiểm lại ở đây).
 */
const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

export const VERSION_GIOI_THIEU = "2026-11-20.r6";
export type GioiThieuDto = GioiThieuCuaToi & { phienBan: string };

function chanHocSinh(nguoi: NguoiGoi): void {
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
}

export async function docGioiThieu(nguoi: NguoiGoi, now = new Date()): Promise<GioiThieuDto> {
  chanHocSinh(nguoi);
  const d = await docGioiThieuCuaToi(nguoi.userId, now).catch(() => null); // lỗi đọc ⇒ như «chưa là đối tác» (fail-closed)
  if (d === null) throw khongThay();
  return { ...d, phienBan: VERSION_GIOI_THIEU };
}

export const taoLinkSchema = tuTaoLinkSchema;

export async function taoLinkDoiTac(nguoi: NguoiGoi, vao: unknown, now = new Date()): Promise<{ id: string }> {
  chanHocSinh(nguoi);
  if (!(await coGioiThieuChoNguoiDung(nguoi.userId).catch(() => false))) throw khongThay();
  const kq = await tuTaoLink({ nguoi: { userId: nguoi.userId, ten: nguoi.name || nguoi.email || "Đối tác" }, vao, now });
  if (!kq.ok) {
    if (kq.truong === "quyen" || kq.truong === "khongTimThay") throw khongThay();
    throw new LoiApiMobile("VALIDATION", 400, kq.loi);
  }
  return { id: kq.id };
}

export type QrDto = { dinhDang: "svg"; dataUri: string; tenTep: string; lienKetNgan: string };

export async function taoQrDoiTac(nguoi: NguoiGoi, linkId: string): Promise<QrDto> {
  chanHocSinh(nguoi);
  if (!(await coGioiThieuChoNguoiDung(nguoi.userId).catch(() => false))) throw khongThay();
  const id = linkId.trim();
  if (!id || id.length > 64) throw khongThay();
  const link = await docLinkChoQrCuaToi(nguoi.userId, id);
  if (!link) throw khongThay(); // id của người khác ra cùng kết quả với id không tồn tại
  if (link.status !== "ACTIVE") throw new LoiApiMobile("VALIDATION", 409, "Link này đã thu hồi — không tạo QR cho link đã thu hồi.", undefined, "LINK_DA_THU_HOI");
  const goc = gocCongKhai(process.env);
  if (goc === null) throw new LoiApiMobile("SERVER", 503, LY_DO_THIEU_GOC);
  const svg = await dungQrChoToken(goc, link.token);
  return { dinhDang: "svg", dataUri: svgThanhDataUri(svg), tenTep: `qr-${link.token}.svg`, lienKetNgan: dungUrlChuyenHuong(goc, link.token) };
}
