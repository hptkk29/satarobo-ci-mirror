// Bộ format ngày/giờ vi-VN dùng chung (cluster dedup — trước đây lặp inline
// `new Date(x).toLocaleDateString("vi-VN", …)` ở >60 nơi).
//
// ⚠️ Behavior-preserving: KHÔNG set `timeZone` — giữ nguyên hành vi cũ (dùng
// timezone môi trường chạy, y như code inline). Đừng thêm timeZone vào đây vì
// sẽ làm lệch output so với trước.

export type DateInput = Date | string | number;

/** Múi giờ VN — chỉ dùng cho các hàm CÓ GHIM múi bên dưới. */
const VN_TZ = "Asia/Ho_Chi_Minh";

/** `dd/M/yyyy` mặc định vi-VN — thay cho `new Date(x).toLocaleDateString("vi-VN")`. */
export function formatDateVN(input: DateInput): string {
  return new Date(input).toLocaleDateString("vi-VN");
}

/** `dd/MM/yyyy` (2 chữ số ngày+tháng) — biến thể có option cố định lặp nhiều nơi. */
export function formatDateDMY(input: DateInput): string {
  return new Date(input).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Ngày + giờ vi-VN — thay cho `new Date(x).toLocaleString("vi-VN")`. */
export function formatDateTimeVN(input: DateInput): string {
  return new Date(input).toLocaleString("vi-VN");
}

/**
 * `HH:mm dd/MM/yyyy` theo giờ VIỆT NAM — mốc có kèm GIỜ cho người đọc.
 *
 * Khác `formatDateTimeVN` ở hai điểm, cả hai đều cố ý:
 *
 *   1. **GHIM `Asia/Ho_Chi_Minh`.** Các hàm trên trong file này cố tình không set
 *      `timeZone` để giữ nguyên hành vi cũ. Nhưng Vercel chạy **UTC** còn máy dev
 *      chạy +07: một lead nhận lúc 00:30 giờ VN in ra ngày HÔM TRƯỚC trên prod và
 *      đúng ngày trên máy lập trình viên — lỗi "chạy máy tôi thì được" kinh điển.
 *      Mốc có giờ mà không ghim múi thì sai nhiều hơn đúng, nên hàm MỚI này ghim.
 *   2. **GIỜ ĐỨNG TRƯỚC NGÀY.** Trong ngày cao điểm, thứ Sale cần là thứ tự nhận
 *      lead trong cùng một ngày; để giờ ở cuối thì phải đọc hết chuỗi mới thấy nó.
 *
 * Định dạng khớp ĐÚNG cột "Ngày nhận lead" trên bảng `/leads` — cùng một mốc thì
 * phải in ra cùng một chuỗi, kẻo người dùng tưởng là hai mốc khác nhau.
 */
export function formatDateTimeVNZoned(input: DateInput): string {
  const d = new Date(input);
  const gio = d.toLocaleTimeString("vi-VN", {
    timeZone: VN_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  const ngay = d.toLocaleDateString("vi-VN", {
    timeZone: VN_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${gio} ${ngay}`;
}

/**
 * Ngày cho HIỂN THỊ khi field có thể "không có ngày". Coi các giá trị sentinel là
 * "—" thay vì in "1/1/1970":
 *   - null / undefined / chuỗi rỗng
 *   - Invalid Date (parse thất bại)
 *   - mốc epoch 1970 (seed cũ set `new Date(0)` thay vì null → getTime()=0)
 * Không có ngày vào làm / hạn nộp nào hợp lệ rơi vào năm 1970 nên cắt ở đây an toàn.
 */
export function formatDateOrDash(input: DateInput | null | undefined): string {
  if (input == null || input === "") return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() <= 1970) return "—";
  return formatDateVN(d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bộ GHIM MÚI GIỜ VN (06/09/2026) — dùng cho cổng phụ huynh/học viên
//
// Các hàm ở đầu file cố ý KHÔNG set `timeZone` để giữ nguyên hành vi cũ của >60 chỗ
// gọi. Nhưng cổng phụ huynh render ở SERVER, mà Vercel chạy **UTC**: cùng một mốc,
// máy dev (+07) in ra một đằng và prod in ra một nẻo.
//
// Hai kiểu sai người dùng thật gặp:
//   · Ngày lệch MỘT NGÀY trong khoảng 00:00–07:00 giờ VN — đúng lúc phụ huynh mở
//     portal xem lịch trước khi đưa con đi học.
//   · Giờ lệch BẢY TIẾNG ở mọi lúc: hạn nộp bài 23:59 in ra "16:59".
//
// Nên mọi chỗ in ngày/giờ cho phụ huynh dùng bộ dưới đây (hoặc nhận chuỗi đã tính sẵn
// từ `lib/portal/buoi-hoc.ts`).
// ─────────────────────────────────────────────────────────────────────────────

/** `dd/MM/yyyy` giờ VN. `—` khi không có ngày / mốc sentinel 1970. */
export function ngayVN(input: DateInput | null | undefined): string {
  const d = hopLe(input);
  if (!d) return "—";
  return d.toLocaleDateString("vi-VN", {
    timeZone: VN_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** `dd/MM` giờ VN — cho ô hẹp. `—` khi không có ngày. */
export function ngayThangVN(input: DateInput | null | undefined): string {
  const d = hopLe(input);
  if (!d) return "—";
  return d.toLocaleDateString("vi-VN", {
    timeZone: VN_TZ,
    day: "2-digit",
    month: "2-digit",
  });
}

/** `dd/MM/yyyy HH:mm` giờ VN — mốc CÓ giờ (hạn nộp, thời điểm gửi). */
export function ngayGioVN(input: DateInput | null | undefined): string {
  const d = hopLe(input);
  if (!d) return "—";
  const ngay = ngayVN(d);
  const gio = d.toLocaleTimeString("vi-VN", {
    timeZone: VN_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${ngay} ${gio}`;
}

/** `Thứ Bảy` / `Chủ Nhật` giờ VN. Chuỗi rỗng khi không có ngày. */
export function thuVN(input: DateInput | null | undefined): string {
  const d = hopLe(input);
  if (!d) return "";
  return d.toLocaleDateString("vi-VN", { timeZone: VN_TZ, weekday: "long" });
}

/**
 * Ngày hợp lệ hay không — cùng luật loại bỏ với `formatDateOrDash`:
 * null/rỗng, Invalid Date, và mốc epoch 1970 (seed cũ set `new Date(0)` thay vì null).
 */
function hopLe(input: DateInput | null | undefined): Date | null {
  if (input == null || input === "") return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() <= 1970) return null;
  return d;
}
