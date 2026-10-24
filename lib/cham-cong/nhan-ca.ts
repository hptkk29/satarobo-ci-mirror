/**
 * lib/cham-cong/nhan-ca.ts — NHÃN của một ô ca: loại · giờ · trạng thái ngày.
 *
 * THUẦN — không `@/lib/db`, không `next/*`. Test được không cần Postgres.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CÓ FILE NÀY — hai bug prod 10/09/2026
 *
 * **Bug 1.** Ngày nghỉ hiện như ca làm, ở CẢ site GV lẫn admin:
 *   · `X` (Nghỉ) và `P` (Nghỉ phép) hiện LOẠI = "Ca làm";
 *   · cả hai hiện GIỜ = "theo nơi làm" — vô nghĩa với một ngày nghỉ.
 *
 * Gốc, đo được: `"theo nơi làm"` là chuỗi DỰ PHÒNG cho mã ca không có đoạn giờ, viết cho
 * `LD`/`D1`/`D2` (linh động / chỉ nơi làm). `X` và `P` cũng có `segments: []` nên rơi vào
 * **đúng nhánh đó**. Một nhánh dự phòng phủ lên HAI nhóm khác hẳn nhau.
 *
 * ⚠️ Và `isLeave` **KHÔNG đủ** để tách hai nhóm — đây là chỗ dễ vá sai:
 *
 *   | mã | `kind`          | `isLeave` |
 *   |----|-----------------|-----------|
 *   | X  | `OFF`           | **false** |
 *   | P  | `LEAVE`         | true      |
 *
 * `X` là ngày nghỉ nhưng `isLeave: false` (nó không phải nghỉ PHÉP). Lọc bằng `isLeave` thì
 * `X` vẫn lọt qua và vẫn thành "Ca làm". Thứ phân biệt đúng là **`kind`**.
 *
 * **Bug 2.** Trạng thái "Đã làm" in cho MỌI dòng quá khứ, kể cả ngày chưa có lượt chấm nào.
 * Gốc: `done: dateKey < todayKey` — so NGÀY thuần, không nhìn dữ liệu chấm công.
 *
 * ⇒ Cả hai màn dùng CHUNG file này. Không vá hai nơi: hai bản nhãn cho cùng một ô thì sớm
 * muộn cũng lệch, và người dùng tin bản mình đang nhìn (luật 12).
 */

/** `ShiftTemplateKind` của Prisma, rút gọn còn phần nhãn cần. */
export type LoaiMaCa = "TIMED" | "LOCATION_ONLY" | "FLEXIBLE" | "OFF" | "LEAVE";

/** Nhãn LOẠI hiện trên cột "Loại". */
export type NhanLoai = "Ca làm" | "Nghỉ" | "Nghỉ phép";

/**
 * `X` → "Nghỉ", `P` → "Nghỉ phép", còn lại → "Ca làm".
 *
 * Đọc `kind`, KHÔNG đọc `isLeave`: `X` mang `isLeave: false` (nó không phải nghỉ phép) nên
 * lọc bằng cờ đó là để `X` lọt qua thành ca làm — đúng bug 10/09.
 */
export function nhanLoaiCa(kind: LoaiMaCa): NhanLoai {
  if (kind === "OFF") return "Nghỉ";
  if (kind === "LEAVE") return "Nghỉ phép";
  return "Ca làm";
}

/** Ngày này có phải ngày nghỉ không — dùng chung cho mọi chỗ cần rẽ nhánh. */
export function laNgayNghi(kind: LoaiMaCa): boolean {
  return kind === "OFF" || kind === "LEAVE";
}

/**
 * Nhãn GIỜ. `timeLabel` là chuỗi đã dựng từ các đoạn `WORK` ("07:45–11:30 · 13:30–17:30"),
 * rỗng khi mã ca không có đoạn nào.
 *
 *   · có giờ            → chính chuỗi đó;
 *   · nghỉ (OFF/LEAVE)  → "—"  ← ngày nghỉ KHÔNG có giờ, và cũng không "theo nơi làm";
 *   · còn lại không giờ → "theo nơi làm" (LD/D1/D2 — linh động, nơi làm quyết định).
 */
export function nhanGioCa(kind: LoaiMaCa, timeLabel: string): string {
  if (timeLabel) return timeLabel;
  if (laNgayNghi(kind)) return "—";
  return "theo nơi làm";
}

// ─────────────────────────────────────────────────────────────────────────────
// TRẠNG THÁI NGÀY
// ─────────────────────────────────────────────────────────────────────────────

export type TrangThaiNgay =
  | "SAP_TOI"
  | "NGHI"
  | "DA_LAM"
  | "CHUA_CHAM"
  | "CHUA_TINH"
  | "CHUA_CHOT";

export const NHAN_TRANG_THAI: Record<TrangThaiNgay, string> = {
  SAP_TOI: "Sắp tới",
  NGHI: "Nghỉ",
  DA_LAM: "Đã làm",
  CHUA_CHAM: "Chưa chấm",
  CHUA_TINH: "Chưa tính",
  CHUA_CHOT: "Chưa chốt",
};

export type NgayCongDaTinh = {
  /** `StaffAttendanceDay.workedMinutes`. */
  workedMinutes: number;
  /** `overrideUnits ?? dayCreditEarned`. */
  units: number;
};

/**
 * Trạng thái của một dòng ca, tính từ DỮ LIỆU THẬT chứ không từ so ngày.
 *
 * ⚠️ Bug 10/09: bản cũ là `done = dateKey < todayKey`. Ngày quá khứ mà chưa ai chấm vẫn in
 * "Đã làm" — nhãn nói một chuyện chưa xảy ra. Admin cùng ngày hiện "6h51 · Thiếu lượt ra"
 * còn site GV in "Đã làm": hai màn nói hai chuyện về cùng một ngày.
 *
 * @param ngayCong dòng `StaffAttendanceDay` của ĐÚNG ngày đó. `null` = engine chưa tính
 *   ngày này (khác hẳn "đã tính và ra 0 phút" — xem `CHUA_TINH` vs `CHUA_CHAM`).
 */
export function trangThaiNgay(input: {
  /** Ngày này còn ở tương lai (so theo ngày VN). */
  tuongLai: boolean;
  kind: LoaiMaCa;
  ngayCong: NgayCongDaTinh | null;
}): TrangThaiNgay {
  // Tương lai trước mọi thứ: ngày nghỉ tuần sau vẫn là "sắp tới", không phải "nghỉ rồi".
  if (input.tuongLai) return "SAP_TOI";
  if (laNgayNghi(input.kind)) return "NGHI";
  if (!input.ngayCong) return "CHUA_TINH";
  // Có công ghi nhận (kể cả quản lý ghi đè) HOẶC có phút làm ⇒ ngày đã diễn ra.
  if (input.ngayCong.workedMinutes > 0 || input.ngayCong.units > 0) return "DA_LAM";
  return "CHUA_CHAM";
}

/**
 * Trạng thái của một BUỔI DẠY / buổi trải nghiệm — cùng loại bug, nguồn khác.
 *
 * ⚠️ Bản cũ: `done = status === "COMPLETED" || dateKey < todayKey`. Vế thứ hai làm mọi buổi
 * quá khứ CHƯA ai bấm hoàn tất vẫn in "Đã làm" — nhãn khẳng định thay cho người dạy.
 * Nay chỉ `COMPLETED` mới là "Đã làm"; quá khứ mà chưa chốt thì NÓI RA là chưa chốt.
 *
 * `tuongLai` đứng trước `hoanTat` cho khớp `trangThaiNgay` — MỘT luật cho cả bảng: ngày chưa
 * tới thì không mang nhãn nào khác ngoài "Sắp tới".
 */
export function trangThaiBuoiDay(input: { tuongLai: boolean; hoanTat: boolean }): TrangThaiNgay {
  if (input.tuongLai) return "SAP_TOI";
  return input.hoanTat ? "DA_LAM" : "CHUA_CHOT";
}
