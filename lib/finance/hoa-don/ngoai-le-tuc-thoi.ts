// lib/finance/hoa-don/ngoai-le-tuc-thoi.ts — luật THUẦN của đường báo ngoại lệ TỨC THỜI (Invoice Hub, hợp đồng đợt 2 §6). Không DB, không đồng hồ.
//
// Scanner định kỳ (S8) chỉ là LƯỚI BẮT SÓT + đối soát; lỗi ký / API / cơ quan thuế phải được ghi nhận NGAY tại chỗ nó xảy ra (đường phát hành), cùng bảng
// `HoaDonNgoaiLe` với scanner và cùng khuôn chuông. Ở đây chỉ ba quyết định kiểm được không cần DB: loại nào báo tức thời kèm mức nào, khoá chống trùng, và chuông mang gì.
import type { MucNgoaiLe } from "./quet-nghia-vu-ke-hoach";
import { HREF_NGOAI_LE, TIEN_TO_NGOAI_LE, type ThongBaoNgoaiLe } from "./quet-nghia-vu-thong-bao";

export type { MucNgoaiLe };

/** Loại ngoại lệ do ĐƯỜNG PHÁT HÀNH báo tức thời — KHÔNG phải loại scanner sở hữu: scanner không bao giờ tự đóng chúng. */
export const LOAI_TUC_THOI = ["TU_CHOI_NHA_CUNG_CAP", "KHONG_RO_QUA_HAN", "LOI_TEP_QUA_HAN", "LOI_KY"] as const;
export type LoaiTucThoi = (typeof LOAI_TUC_THOI)[number];


/**
 * Mức theo loại.
 *  · TỪ CHỐI của nhà cung cấp: chắc chắn CHƯA có hoá đơn nào — kế toán sửa dữ liệu rồi phát hành lại ⇒ CẦN XỬ LÝ.
 *  · KHÔNG RÕ quá hạn: hoá đơn có thể ĐÃ phát hành thật mà ta không biết ⇒ phát hành lại là nguy cơ trùng, để yên là nguy cơ mất ⇒ KHẨN.
 * Hạn xử lý (SLA) và leo thang theo thời gian chờ OD-14 — chưa đặt ở đây (không gõ cứng một số kế toán chưa duyệt).
 */
export function mucTucThoi(loai: LoaiTucThoi): MucNgoaiLe {
  return loai === "KHONG_RO_QUA_HAN" ? "KHAN" : "CAN_XU_LY";
}

/**
 * Mốc «quá hạn» của một bản đang phát hành, tính từ lúc gửi (hoặc lúc tạo nếu chưa gửi lần nào). `slaPhut = null` ⇒ không báo. `slaPhut` KHÔNG có mặc định ở đây (tham số nguy hiểm — luật 7):
 * con số đến từ CẤU HÌNH, mặc định kỹ thuật cho thử nghiệm; ngưỡng chính thức do kế toán duyệt. Đã có số hoá đơn mà thiếu tệp ⇒ `LOI_TEP_QUA_HAN`; chưa có số ⇒ `KHONG_RO_QUA_HAN`.
 */
export function loaiQuaHan(input: { guiLuc: Date | null; taoLuc: Date; soHoaDon: string | null; now: Date; slaPhut: number | null }): "KHONG_RO_QUA_HAN" | "LOI_TEP_QUA_HAN" | null {
  if (input.slaPhut === null || !Number.isFinite(input.slaPhut) || input.slaPhut < 1) return null;
  const tu = (input.guiLuc ?? input.taoLuc).getTime();
  if (input.now.getTime() - tu < input.slaPhut * 60_000) return null;
  return input.soHoaDon !== null && input.soHoaDon !== "" ? "LOI_TEP_QUA_HAN" : "KHONG_RO_QUA_HAN";
}

/**
 * Khoá chống trùng: loại + hoá đơn + khoá lượt (refId của lần gửi). Cùng một lần lỗi gọi lại ⇒ cùng khoá; phát hành lại (refId MỚI) rồi lại lỗi ⇒ khoá mới,
 * ngoại lệ mới. Bắt đầu bằng loại để bộ lọc / chỉ mục đọc theo tiền tố. Chỉ gồm định danh nội bộ — không PII, không thông điệp của nhà cung cấp.
 */
export function khoaNgoaiLeTucThoi(loai: LoaiTucThoi, hoaDonId: string, khoa: string): string {
  return `${loai}:${hoaDonId}:${khoa}`;
}

/** Mỗi ngoại lệ tức thời là MỘT thông báo riêng. Khoá `…:tuc-thoi:<id ngoại lệ>`, nằm dưới tiền tố đã khai trong catalog (`hoa-don.ngoai-le:`). */
export const khoaThongBaoTucThoi = (ngoaiLeId: string): string => `${TIEN_TO_NGOAI_LE}tuc-thoi:${ngoaiLeId}`;

const CAU_THEO_LOAI: Readonly<Record<LoaiTucThoi, { tieuDe: string; viec: string }>> = {
  TU_CHOI_NHA_CUNG_CAP: { tieuDe: "Hoá đơn điện tử bị nhà cung cấp từ chối", viec: "Một hoá đơn bị nhà cung cấp từ chối phát hành" },
  KHONG_RO_QUA_HAN: { tieuDe: "Hoá đơn điện tử: chưa rõ kết quả phát hành (khẩn)", viec: "Một hoá đơn chưa rõ đã phát hành hay chưa, quá hạn chờ" },
  LOI_TEP_QUA_HAN: { tieuDe: "Hoá đơn điện tử: đã có số nhưng chưa lưu được tệp", viec: "Một hoá đơn đã được cấp số nhưng PDF / XML chưa lưu được, quá hạn chờ" },
  LOI_KY: { tieuDe: "Hoá đơn điện tử: ký số bị lỗi", viec: "Một lệnh ký số hoá đơn bị lỗi" },
};

/**
 * Chuông của MỘT ngoại lệ tức thời. Lý do không dùng chung khoá theo ngày của scanner (`…:<cơ sở>:<ngày>`): hệ thông báo cập nhật nội dung của khoá đã có nhưng
 * KHÔNG rung lại và giữ trạng thái "đã đọc" — lỗi thứ hai trong ngày ở cùng cơ sở sẽ bị nuốt im lặng, trái lời hứa "báo ngay". Mỗi ngoại lệ một khoá ⇒ mỗi lỗi một lần rung.
 * Nội dung chỉ có TÊN CƠ SỞ — không tên phụ huynh, SĐT, mã đơn, số tiền, thông điệp của nhà cung cấp.
 */
export function dungThongBaoTucThoi(input: {
  ngoaiLeId: string;
  loai: LoaiTucThoi;
  muc: MucNgoaiLe;
  tenCoSo: string;
  nguoiNhan: readonly string[];
}): ThongBaoNgoaiLe | null {
  const userIds = [...new Set(input.nguoiNhan.filter((id) => !!id))];
  if (userIds.length === 0) return null;
  const c = CAU_THEO_LOAI[input.loai];
  const khan = input.muc === "KHAN" ? " (KHẨN)" : "";
  return {
    userIds,
    dedupeKey: khoaThongBaoTucThoi(input.ngoaiLeId),
    title: c.tieuDe,
    body: `${c.viec} tại ${input.tenCoSo}${khan}. Mở tab Cảnh báo để xử lý.`,
    href: HREF_NGOAI_LE,
  };
}
