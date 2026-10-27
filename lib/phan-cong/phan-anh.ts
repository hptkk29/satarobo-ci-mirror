// lib/phan-cong/phan-anh.ts — LUẬT phản ánh ô công Parttime (GĐ6, docs/phan-cong-gop/KHAO-SAT.md chốt 4, 5, 8). THUẦN — không DB, không
// đồng hồ (`homNay` truyền vào). Màn site GV, màn admin và đường ghi CÙNG gọi — nút bị khoá nói đúng câu mà máy chủ từ chối (luật 12).
import { chanSuaKyDaChot } from "@/lib/cham-cong/ky-gac";
import { luatKy } from "./cong-o";

export const LY_DO_PHAN_ANH_TOI_THIEU = 5;
export const LY_DO_KHONG_DUYET_TOI_THIEU = 10;

/** Cổng GỬI phản ánh. `trangThaiKy` = `AttendancePeriod.status` của cơ sở × kỳ (null = chưa có kỳ). */
export function lyDoKhongGuiDuoc(p: {
  ngay: string;
  homNay: string;
  trangThaiKy: string | null;
  lyDo: string;
  /** Người gửi có việc (phân công / trực còn sống) ở ô này. */
  coViec: boolean;
  /** Cờ theo kỳ — BẮT BUỘC (luật 7). */
  tuKyLuatMoi: string | null;
}): string | null {
  const periodKey = p.ngay.slice(0, 7);
  if (luatKy(periodKey, p.tuKyLuatMoi) !== "MOI") return `Kỳ ${periodKey} đi luồng xác nhận cũ — phản ánh ô công chỉ áp cho kỳ đi luật công mới.`;
  if (p.ngay > p.homNay) return "Ngày chưa tới — chưa có gì để phản ánh.";
  const chot = chanSuaKyDaChot({ status: p.trangThaiKy, periodKey });
  if (chot) return `Kỳ ${periodKey} đã chốt — hết hạn phản ánh.`;
  if (!p.coViec) return "Bạn không có việc ở ô này.";
  if (p.lyDo.trim().length < LY_DO_PHAN_ANH_TOI_THIEU) return `Ghi lý do (ít nhất ${LY_DO_PHAN_ANH_TOI_THIEU} ký tự).`;
  return null;
}

/** Cổng DUYỆT / KHÔNG DUYỆT. Chặn tự duyệt (như `kiemXacNhan` của P5). */
export function lyDoKhongDuyetDuoc(p: {
  status: string;
  nguoiDuyet: string;
  nguoiGui: string;
  periodKey: string;
  trangThaiKy: string | null;
  duyet: boolean;
  ghiChu: string | null;
  /** Cờ theo kỳ — BẮT BUỘC (luật 7). */
  tuKyLuatMoi: string | null;
}): string | null {
  if (p.status !== "CHO_DUYET") return "Phản ánh không còn chờ duyệt — tải lại trang.";
  if (p.nguoiDuyet === p.nguoiGui) return "Không tự duyệt phản ánh của chính mình.";
  if (luatKy(p.periodKey, p.tuKyLuatMoi) !== "MOI") return `Kỳ ${p.periodKey} đi luồng xác nhận cũ.`;
  if (chanSuaKyDaChot({ status: p.trangThaiKy, periodKey: p.periodKey })) return `Kỳ ${p.periodKey} đã chốt — không duyệt được nữa.`;
  if (!p.duyet && (p.ghiChu ?? "").trim().length < LY_DO_KHONG_DUYET_TOI_THIEU) {
    return `Không duyệt thì ghi lý do (ít nhất ${LY_DO_KHONG_DUYET_TOI_THIEU} ký tự) — giáo viên cần biết vì sao.`;
  }
  return null;
}

/** Nhãn lý do "cần xem" của ô — MỘT bảng cho màn admin và site GV. */
export const NHAN_LY_DO_O: Record<string, string> = {
  THIEU_VAO: "Thiếu lượt vào",
  THIEU_RA: "Thiếu lượt ra",
  VAO_MUON: "Vào muộn",
  RA_SOM: "Về sớm",
  TRUNG_GIO: "Trùng giờ",
  KHONG_CO_CAP: "Không có cặp quét",
};

export const NHAN_TRANG_THAI_PHAN_ANH: Record<string, string> = {
  CHO_DUYET: "Chờ duyệt",
  DA_DUYET: "Đã duyệt",
  KHONG_DUYET: "Không duyệt",
  RUT_LAI: "Đã rút",
};
