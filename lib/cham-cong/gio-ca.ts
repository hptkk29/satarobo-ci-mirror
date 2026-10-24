// lib/cham-cong/gio-ca.ts — giờ vào/ra của từng mã ca, dạng đọc được.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH RA
//
// Chốt của chủ dự án 25/09/2026: *"ghi chú thẳng trên các trang nhiều dữ liệu để QLCS vào
// check là nắm luôn, không cần vào Cấu hình để check"*.
//
// Trước đó định nghĩa ca chỉ sống ở màn `/cham-cong/danh-muc-ca`. Người xếp ca đang đứng
// trước lưới 19 người × 30 ngày toàn mã `CG` `CS` `HC` `ST` phải mở tab khác để nhớ `CG` là
// mấy giờ — rồi quay lại thì mất chỗ đang xem.
//
// Một hàm dựng chuỗi giờ, dùng cho CẢ chip mã ca (hover một ô) LẪN bảng tra (cả trang). Hai
// đường đó mà tự ghép chuỗi riêng thì tới lượt sửa thứ hai sẽ in hai kiểu giờ khác nhau cho
// cùng một mã — người đọc không biết tin cái nào.
//
// THUẦN: không DB, không React, không đọc đồng hồ.

/** Đoạn ca như lưu trong `ShiftTemplate.segments` (Json). */
type Doan = { start?: string; end?: string; kind?: string };

export type MaCaGio = {
  code: string;
  name: string;
  /** "08:00–11:30 · 13:30–17:30". Rỗng khi mã không có đoạn giờ (LD, X, P…). */
  gio: string;
  cong: number;
  /** Số cặp quét kỳ vọng trong ngày: 0 / 1 / 2. */
  soCapQuet: number;
};

/**
 * Chuỗi giờ từ `segments`.
 *
 * CHỈ lấy đoạn `WORK`. Đoạn `PAID_BREAK` (nghỉ giữa giờ CÓ tính công, vd `CT` 16:30–17:30)
 * cố ý không in ra: người xếp ca hỏi "ca này làm từ mấy giờ tới mấy giờ", không hỏi cấu trúc
 * đoạn. In cả nghỉ vào là biến một câu trả lời thành một bài đọc.
 */
export function gioTuSegments(segments: unknown): string {
  if (!Array.isArray(segments)) return "";
  return (segments as Doan[])
    .filter((s) => s?.kind === "WORK" && s.start && s.end)
    .map((s) => `${s.start}–${s.end}`)
    .join(" · ");
}

/** Cột cần `select` khi truy vấn `ShiftTemplate` cho bảng giờ ca — khai một chỗ. */
export const MA_CA_SELECT = {
  code: true,
  name: true,
  segments: true,
  dayCredit: true,
  soCapQuetKyVong: true,
} as const;

type HangTemplate = {
  code: string;
  name: string;
  segments: unknown;
  dayCredit: number;
  soCapQuetKyVong: number;
};

export function dongGioCa(rows: readonly HangTemplate[]): MaCaGio[] {
  return rows.map((t) => ({
    code: t.code,
    name: t.name,
    gio: gioTuSegments(t.segments),
    cong: t.dayCredit,
    soCapQuet: t.soCapQuetKyVong,
  }));
}

/**
 * Một dòng cho tooltip của chip mã ca: `"HC · Giờ hành chính · 08:00–11:30 · 13:30–17:30"`.
 *
 * Trả `null` khi không biết mã — người gọi để `title` trống chứ ĐỪNG in "không rõ": một
 * tooltip nói "không rõ" tệ hơn không có tooltip, vì nó khẳng định hệ thống đã tra và chịu.
 */
export function motDongGioCa(m: MaCaGio | undefined): string | null {
  if (!m) return null;
  const phan = [m.code, m.name];
  if (m.gio) phan.push(m.gio);
  phan.push(`${m.cong} công`);
  if (m.soCapQuet > 0) phan.push(`${m.soCapQuet} lần chấm/ngày`);
  return phan.join(" · ");
}

/**
 * Chỉ giữ mã ca THỰC SỰ có mặt trong kỳ đang xem.
 *
 * Chốt 25/09/2026: *"chỉ hiện các ca đang hoạt động, ca nào ngưng thì không hiển thị, và
 * cũng chỉ hiện những ca có trong tháng đó"*. Vế đầu đã do `where: { isActive: true }` lo;
 * vế sau là hàm này.
 *
 * Vì sao quan trọng: danh mục có 21 mã, một khối trong một tháng thường chỉ dùng 4–6. Đổ cả
 * 21 mã ra là bắt người rà tự lọc bằng mắt đúng lúc họ đang cần tra nhanh — tức bảng tra
 * biến thành một việc phải làm thêm.
 *
 * @param daDung tập mã ca lấy từ CHÍNH dữ liệu đang hiện trên màn (ô ca của kỳ), không phải
 *               từ một truy vấn thứ hai — kẻo bảng tra nói khác thứ người ta đang nhìn.
 */
export function locMaCaDaDung(ds: readonly MaCaGio[], daDung: Iterable<string>): MaCaGio[] {
  const co = new Set(daDung);
  return ds.filter((m) => co.has(m.code));
}
