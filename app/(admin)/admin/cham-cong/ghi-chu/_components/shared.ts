// Kiểu + nhãn dùng chung của màn Ghi chú lịch.
//
// Vì sao tách: bảng (`note-manager`) mở form (`note-form`), còn form cần đúng kiểu dòng và bộ nhãn
// để vẽ ⇒ hai file import lẫn nhau và `depcruise` chặn (`no-circular`). Nhãn đứng riêng thì cả hai
// cùng nhìn về một chỗ — và quan trọng hơn: chỉ có MỘT bản nhãn, không phải hai bản lệch nhau.
export type NoteRow = {
  id: string;
  centerId: string;
  centerLabel: string;
  /** 0 = CN … 6 = T7; có giá trị khi là việc cố định theo thứ. */
  weekday: number | null;
  /** "YYYY-MM-DD"; có giá trị khi là ghi đè theo ngày. Đúng MỘT trong hai có giá trị. */
  date: string | null;
  audience: "ALL" | "KINH_DOANH" | "GIAO_VIEN";
  mode: "APPEND" | "SUPPRESS" | "REPLACE";
  text: string;
  isActive: boolean;
};

export type NoteBlock = { id: string; label: string; canAssign: boolean };

/** Thứ Hai đứng đầu, Chủ Nhật cuối (khớp cột Sheet và khung ca tuần). */
export const WD = [1, 2, 3, 4, 5, 6, 0];

export const WD_LABEL: Record<number, string> = { 1: "T2", 2: "T3", 3: "T4", 4: "T5", 5: "T6", 6: "T7", 0: "CN" };

export const WD_FULL: Record<number, string> = {
  1: "Thứ Hai",
  2: "Thứ Ba",
  3: "Thứ Tư",
  4: "Thứ Năm",
  5: "Thứ Sáu",
  6: "Thứ Bảy",
  0: "Chủ Nhật",
};

export const AUD_LABEL: Record<NoteRow["audience"], string> = {
  ALL: "Cả khối",
  KINH_DOANH: "Kinh doanh",
  GIAO_VIEN: "Giáo viên",
};

export const MODE_LABEL: Record<NoteRow["mode"], string> = {
  APPEND: "Gửi kèm",
  SUPPRESS: "Không gửi tin",
  REPLACE: "Thay toàn bộ",
};
