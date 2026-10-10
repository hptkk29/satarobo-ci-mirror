import type { LoaiHoSo, TrangThai } from "@/lib/bao-luu/trang-thai";
import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";
import { vnStartOfDay } from "@/lib/time/vn";

// lib/bao-luu/gia-han.ts — GIA HẠN bảo lưu (BR-11, BR-23). THUẦN, không DB. PHIÊN 5.
//
//   · tối đa `extendTimes` lần; mỗi lần thêm ≤ `extendMaxMonths` THÁNG LỊCH tính từ hạn hiện tại (TC-08: 30 ngày được, 31 ngày chặn
//     khi hạn rơi vào tháng 30 ngày — vì là THÁNG LỊCH, không phải 30 ngày cứng);
//   · tổng ≤ `maxMonths + extendMaxMonths` tính từ ngày bắt đầu; vượt ⇒ chỉ còn đường `bao-luu:exception` (`vuotTran`);
//   · lý do bắt buộc; loại CENTER không gia hạn (BR-23: không áp BR-08/10/11).
//
// Gia hạn từ OVERDUE/NOTICE_SENT là CÁCH đưa hồ sơ về ACTIVE (máy trạng thái có cạnh `* → ACTIVE`, "nếu còn lượt") — nên trạng thái hợp lệ
// là ACTIVE · OVERDUE · NOTICE_SENT. RESUME_PENDING (phụ huynh đã báo phục học) thì KHÔNG: gia hạn là đi ngược ý phụ huynh.

export type DauVaoGiaHan = {
  type: LoaiHoSo;
  status: TrangThai;
  startedAt: Date;
  standardEndDate: Date | null;
  extendedEndDate: Date | null;
  extendCount: number;
  coDeNghiDangCho: boolean;
};

export type ChinhSachGiaHan = { maxMonths: number; extendTimes: number; extendMaxMonths: number };

export const TRANG_THAI_GIA_HAN_DUOC: readonly TrangThai[] = ["ACTIVE", "OVERDUE", "NOTICE_SENT"];

export type KetQuaGiaHan = { ok: true; denNgay: Date; vuotTran: boolean } | { ok: false; loi: string[] };

export function kiemGiaHan(
  hoSo: DauVaoGiaHan,
  p: { denNgay: Date; lyDo: string; vuotTran: boolean },
  cs: ChinhSachGiaHan,
): KetQuaGiaHan {
  const loi: string[] = [];
  if (hoSo.type === "CENTER") loi.push("Bảo lưu do Trung tâm không gia hạn — chờ hoặc chuyển khoá.");
  if (!TRANG_THAI_GIA_HAN_DUOC.includes(hoSo.status)) loi.push("Chỉ gia hạn được hồ sơ đang bảo lưu (hoặc quá hạn).");
  if (p.lyDo.trim().length < 5) loi.push("Ghi lý do gia hạn (ít nhất 5 ký tự).");
  if (hoSo.coDeNghiDangCho) loi.push("Đã có đề nghị gia hạn đang chờ duyệt.");
  if (hoSo.extendCount >= cs.extendTimes) loi.push(`Đã dùng hết ${cs.extendTimes} lần gia hạn.`);
  const hanHienTai = hoSo.extendedEndDate ?? hoSo.standardEndDate;
  if (!hanHienTai) {
    loi.push("Hồ sơ chưa có hạn bảo lưu — không gia hạn được.");
  } else {
    if (vnStartOfDay(p.denNgay).getTime() <= vnStartOfDay(hanHienTai).getTime()) loi.push("Hạn mới phải sau hạn hiện tại.");
    const tranMoiLan = hanToiDaBaoLuu(hanHienTai, cs.extendMaxMonths);
    if (vnStartOfDay(p.denNgay).getTime() > tranMoiLan.getTime()) {
      loi.push(`Mỗi lần gia hạn tối đa ${cs.extendMaxMonths} tháng (tới ${ngayDmy(tranMoiLan)}).`);
    }
    const tranTong = hanToiDaBaoLuu(hoSo.startedAt, cs.maxMonths + cs.extendMaxMonths);
    if (vnStartOfDay(p.denNgay).getTime() > tranTong.getTime() && !p.vuotTran) {
      loi.push(`Tổng thời gian bảo lưu vượt ${cs.maxMonths + cs.extendMaxMonths} tháng — chỉ Quản trị tối cao cho phép ngoại lệ.`);
    }
  }
  if (loi.length > 0) return { ok: false, loi };
  return { ok: true, denNgay: p.denNgay, vuotTran: p.vuotTran };
}

function ngayDmy(d: Date): string {
  return d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
}
