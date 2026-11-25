// lib/hoa-hong/trang-thai-phien-ban.ts — NHÃN trạng thái của MỘT phiên bản chính sách: ánh xạ (status DB + ngày) → chữ + tông,
// ở MỘT chỗ (06 §7: "ánh xạ trạng thái → tone ở một chỗ"). THUẦN.
//
// `status = ACTIVE` KHÔNG có nghĩa "đang áp dụng": bản đã kích hoạt nhưng chưa tới `effectiveFrom` là "Chờ hiệu lực", bản đã
// quá `effectiveTo` mà chưa ai đóng là "Hết hiệu lực". Hiển thị status thô sẽ báo "đang chạy" cho thứ chưa chạy.
import type { TrangThaiPhienBan } from "./chon-quy-tac";

export type KhoaTrangThaiPhienBan = "NHAP" | "CHO_HIEU_LUC" | "DANG_AP_DUNG" | "HET_HIEU_LUC" | "DA_THAY_THE" | "DA_HUY";
export type ToneTrangThai = "success" | "warning" | "danger" | "info" | "muted";

export function trangThaiPhienBanHienThi(
  v: { status: TrangThaiPhienBan; effectiveFrom: Date; effectiveTo: Date | null },
  now: Date,
): { khoa: KhoaTrangThaiPhienBan; nhan: string; tone: ToneTrangThai } {
  switch (v.status) {
    case "DRAFT":
      return { khoa: "NHAP", nhan: "Nháp", tone: "muted" };
    case "SUPERSEDED":
      return { khoa: "DA_THAY_THE", nhan: "Đã thay thế", tone: "muted" };
    case "EXPIRED":
      return { khoa: "HET_HIEU_LUC", nhan: "Hết hiệu lực", tone: "muted" };
    case "CANCELLED":
      return { khoa: "DA_HUY", nhan: "Đã huỷ", tone: "danger" };
    case "ACTIVE":
      if (v.effectiveFrom.getTime() > now.getTime()) return { khoa: "CHO_HIEU_LUC", nhan: "Chờ hiệu lực", tone: "info" };
      // Biên PHẢI MỞ: tại đúng `effectiveTo` bản đã hết (khớp `chonQuyTac`).
      if (v.effectiveTo !== null && v.effectiveTo.getTime() <= now.getTime()) return { khoa: "HET_HIEU_LUC", nhan: "Hết hiệu lực", tone: "muted" };
      return { khoa: "DANG_AP_DUNG", nhan: "Đang áp dụng", tone: "success" };
  }
}
