// lib/hoa-hong/de-xuat-nhan.ts — CHỮ HIỂN THỊ của ĐỀ XUẤT ĐIỀU CHỈNH (trạng thái duyệt · nguồn gốc · mã ngắn · việc kế tiếp). THUẦN — không DB, không đồng hồ.
//
// Một chỗ cho bảng, Sheet và hàng chờ trước sổ: hai nơi tự ghép "Chờ duyệt cấp 2" là hai nơi sẽ lệch nhau (luật 12b). Không in mã enum trần ra màn.
import type { MucQuanTri, NguonGocDeXuat } from "./quan-tri-dieu-chinh";

export type TrangThaiDeXuat = "PENDING" | "APPROVED_L1" | "POSTED" | "REJECTED" | "STALE";
export type ToneDeXuat = "success" | "warning" | "danger" | "info" | "muted";

/** Mã ngắn cho người đọc ("DX-3F9A2C") — id đầy đủ nằm trên URL (`?dx=`). */
export const maDeXuat = (id: string): string => `DX-${id.slice(-6).toUpperCase()}`;

export const NHAN_NGUON_GOC: Readonly<Record<NguonGocDeXuat, string>> = {
  DISPUTE: "Khiếu nại tiền",
  SOURCE_CHANGE: "Đổi nguồn sau thu",
};

/** Cấp duyệt KẾ TIẾP theo trạng thái; `null` = đã kết thúc. Cấp được suy từ trạng thái, không từ client. */
export function capKeTiepCuaDeXuat(status: TrangThaiDeXuat): 1 | 2 | null {
  return status === "PENDING" ? 1 : status === "APPROVED_L1" ? 2 : null;
}

/** Nhãn trạng thái duyệt: nói rõ đang chờ ai (cấp 1 hay cấp 2) và có cần hai người hay không. */
export function nhanTrangThaiDeXuat(status: TrangThaiDeXuat, quanTri: MucQuanTri): string {
  switch (status) {
    case "PENDING":
      return quanTri === "SECOND_APPROVAL_REQUIRED" ? "Chờ duyệt cấp 1 (cần 2 người)" : "Chờ duyệt";
    case "APPROVED_L1":
      return "Chờ duyệt cấp 2";
    case "POSTED":
      return "Đã duyệt và ghi sổ";
    case "REJECTED":
      return "Đã từ chối";
    case "STALE":
      return "Đã lỗi thời — không ghi sổ";
  }
}

export function toneTrangThaiDeXuat(status: TrangThaiDeXuat): ToneDeXuat {
  switch (status) {
    case "PENDING":
      return "warning";
    case "APPROVED_L1":
      return "info";
    case "POSTED":
      return "success";
    case "REJECTED":
    case "STALE":
      return "muted";
  }
}

/** Đề xuất còn ĐANG MỞ (chưa ra sổ, chưa bị đóng) — những cái cần người xử lý. */
export const deXuatDangMo = (status: TrangThaiDeXuat): boolean => status === "PENDING" || status === "APPROVED_L1";
