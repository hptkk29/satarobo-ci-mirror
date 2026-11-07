// lib/finance/doi-chieu-hoc-vien.ts — khớp một em trong sheet với hồ sơ trong hệ thống.
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐÂY LÀ CHỖ QUYẾT ĐỊNH TIỀN VÀO HỒ SƠ NÀO
//
// Gán nhầm thì công nợ HAI em đều sai mà TỔNG vẫn đúng — không báo cáo nào lộ ra, và
// phụ huynh bị đòi khoản đã đóng. Vì thế luật nằm ở một hàm THUẦN có test, không phải
// vài dòng `find()` nằm trong action.
//
// ─────────────────────────────────────────────────────────────────────────────
// KHOÁ: SĐT PHỤ HUYNH + HỌ TÊN  (chủ dự án chốt 14/09/2026)
//
// Mã học viên trong sheet và mã trên hệ thống là HAI HỆ ĐÁNH SỐ KHÁC NHAU — khớp bằng mã
// là gán tiền cho người lạ. Mã sheet vẫn được giữ lại để soi ngược dòng gốc, không để
// khớp.
//
// ⚠️ "TÌM THẤY SĐT" KHÔNG BAO GIỜ ĐỦ. Đo file thật: 102 SĐT cho 115 em ⇒ 9 SĐT là của
// HAI em (anh chị em ruột cùng phụ huynh: `0905167198` → HOÀNG VĨNH KHANG và HOÀNG BẢO
// THẠNH). Khớp bằng mỗi SĐT là dồn học phí hai em vào một.
//
// ⚠️ KHÔNG TỰ CHỌN KHI TÊN LỆCH, kể cả khi chỉ có ĐÚNG MỘT ứng viên. Cám dỗ lớn nhất ở
// đây là "chỉ có một em thôi, chắc là em đó" — sai một lần là tiền vào hồ sơ người khác
// và không có đường nào phát hiện ngược. Tên lệch thì đưa danh sách cho người chọn.
// ─────────────────────────────────────────────────────────────────────────────
import { chuanTenSoSanh } from "./nhap-giao-dich-sheet";

export const MUC_KHOP = {
  /** Đúng một hồ sơ khớp cả SĐT lẫn tên — ghi được ngay. */
  KHOP: "KHOP",
  /** Có hồ sơ cùng SĐT nhưng tên không khớp — người phải chọn. */
  LECH_TEN: "LECH_TEN",
  /** Nhiều hồ sơ khớp cả SĐT lẫn tên — hồ sơ trùng lặp, người phải chọn. */
  TRUNG_HO_SO: "TRUNG_HO_SO",
  /** Không hồ sơ nào cùng SĐT. */
  KHONG_THAY: "KHONG_THAY",
} as const;

export type MucKhop = (typeof MUC_KHOP)[keyof typeof MUC_KHOP];

/** Hồ sơ học viên rút gọn — chỉ những trường cần để khớp và để người nhìn mà quyết. */
export type HoSoHocVien = {
  id: string;
  name: string;
  /** Dạng chuẩn `84…` như DB đang lưu. */
  parentPhone: string | null;
  studentCode: string | null;
  centerName: string | null;
};

export type KetQuaKhop = {
  muc: MucKhop;
  /** Chỉ có giá trị khi `muc === KHOP`. Mọi mức khác đều để null — không đoán. */
  hocVienId: string | null;
  /** Hồ sơ cùng SĐT, để màn hình bày ra cho người chọn. */
  ungVien: HoSoHocVien[];
};

export function khopHocVien(
  can: { sdt: string | null; hoTen: string | null },
  hoSoCungSdt: HoSoHocVien[],
): KetQuaKhop {
  // Thiếu SĐT thì DỪNG — cố ý không dò theo mỗi tên trên toàn hệ thống, vì hai em trùng
  // tên ở hai cơ sở là chuyện thường và dò tên là mời gán nhầm.
  if (!can.sdt || !can.hoTen) {
    return { muc: MUC_KHOP.KHONG_THAY, hocVienId: null, ungVien: [] };
  }

  const ungVien = hoSoCungSdt.filter((h) => h.parentPhone && h.parentPhone === can.sdt);
  if (ungVien.length === 0) {
    return { muc: MUC_KHOP.KHONG_THAY, hocVienId: null, ungVien: [] };
  }

  const tenCan = chuanTenSoSanh(can.hoTen);
  const trungTen = ungVien.filter((h) => chuanTenSoSanh(h.name) === tenCan);

  if (trungTen.length === 1) {
    return { muc: MUC_KHOP.KHOP, hocVienId: trungTen[0]!.id, ungVien };
  }
  if (trungTen.length > 1) {
    return { muc: MUC_KHOP.TRUNG_HO_SO, hocVienId: null, ungVien: trungTen };
  }
  return { muc: MUC_KHOP.LECH_TEN, hocVienId: null, ungVien };
}

/** Nhãn tiếng Việt cho màn hình — một chỗ, để màn và báo cáo nói cùng một câu. */
export const NHAN_MUC_KHOP: Record<MucKhop, string> = {
  KHOP: "Khớp",
  LECH_TEN: "SĐT khớp, tên lệch — cần chọn",
  TRUNG_HO_SO: "Hệ thống có 2 hồ sơ giống nhau — cần chọn",
  KHONG_THAY: "Không tìm thấy trong hệ thống",
};
