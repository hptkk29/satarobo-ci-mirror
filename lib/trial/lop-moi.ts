// lib/trial/lop-moi.ts — luật THUẦN cho lớp trải nghiệm kiểu mới (28/08/2026,
// tên lớp đổi quy ước 29/08 — thêm mã khoá quan tâm).
//
// Chủ dự án 28/08: lớp chỉ còn "tên lớp (tự sinh) · cơ sở · khoá trải nghiệm"; giờ,
// phòng, giáo viên chuyển xuống TỪNG BUỔI. Hai luật mới sinh ra từ đó nằm ở đây, tách
// khỏi Server Action để kiểm được không cần Postgres.
//
// File THUẦN: không import Prisma/auth, client component kéo theo được.

/** Bỏ dấu tiếng Việt rồi giữ lại chữ-số, viết hoa. "Cơ sở 1" → "COSO1". */
function chuanHoaMaCoSo(raw: string): string {
  const khongDau = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
  return khongDau.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** Mã khoá cho tên lớp: giữ chữ-số của slug, viết THƯỜNG. "sata-4" → "sata4". */
function chuanHoaMaKhoa(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}

/**
 * Tên lớp theo quy ước 29/08: `Cơ sở-Khoá quan tâm-Lớp trial số` — vd `CS2-sata4-Lớp trial 3`.
 *
 * (Quy ước 28/08 là `CS2_Lớp trial 3`, không có khoá. Đổi vì một cơ sở chạy song song
 * nhiều khoá trải nghiệm; thiếu mã khoá thì nhìn danh sách lớp không biết lớp nào của
 * khoá nào, phải mở từng lớp ra xem.)
 *
 * Mã cơ sở do người nhập nên đã gặp đủ kiểu ("cs1", "Cơ sở 1", "CS-1") — chuẩn hoá ở
 * đây vì tên lớp đi thẳng vào phiếu gửi phụ huynh. Mã rỗng vẫn ra tên đọc được ("CS-…")
 * thay vì một chuỗi cụt bắt đầu bằng dấu gạch.
 *
 * `maKhoa` rỗng (lớp không gắn khoá — khoá là tuỳ chọn khi tạo) thì BỎ HẲN đoạn giữa
 * thay vì để lại hai gạch liền: `CS2-Lớp trial 3`.
 */
export function tenLopTrial(
  maCoSo: string,
  maKhoa: string | null | undefined,
  so: number,
): string {
  const cs = chuanHoaMaCoSo(maCoSo) || "CS";
  const kh = chuanHoaMaKhoa(maKhoa);
  return kh ? `${cs}-${kh}-Lớp trial ${so}` : `${cs}-Lớp trial ${so}`;
}

/**
 * Tên lớp THEO NGÀY — quy ước cho lớp theo khung (chủ dự án 23/09/2026: "tên lớp:
 * CS-Lớp trial 23/09/2026"), vd `CS1-Lớp trial 23/09/2026`.
 *
 * Lớp theo khung là MỘT NGÀY, nên ngày mới là thứ người đọc cần — số thứ tự
 * (`tenLopTrial`) không nói gì với Sale đang tìm lớp theo ngày hẹn khách. Mã lớp
 * (`code`) vẫn mang số thứ tự và vẫn là định danh duy nhất.
 *
 * ⚠️ Hai lớp CÙNG NGÀY (T7 sáng + chiều) ra CÙNG tên — cố ý: `name` không `@unique`, và
 * màn danh sách có cột "Khung giờ" đứng ngay cạnh để phân biệt.
 *
 * @param ymd ngày lớp theo lịch VN, "YYYY-MM-DD".
 */
export function tenLopTrialTheoNgay(
  maCoSo: string,
  maKhoa: string | null | undefined,
  ymd: string,
): string {
  const cs = chuanHoaMaCoSo(maCoSo) || "CS";
  const kh = chuanHoaMaKhoa(maKhoa);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const ngay = m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
  return kh ? `${cs}-${kh}-Lớp trial ${ngay}` : `${cs}-Lớp trial ${ngay}`;
}

export type KhungGio = { startTime: string; endTime: string };

/** "HH:MM" → phút. `null` nếu không đúng định dạng. */
export function phutTuHhmm(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const p = Number(m[2]);
  if (h > 23 || p > 59) return null;
  return h * 60 + p;
}

/**
 * Hai khung giờ có ĐÈ LÊN NHAU không — dùng để đánh dấu giáo viên đang bận.
 *
 * Sát nhau KHÔNG tính là trùng: dạy 18:00–19:30 rồi 19:30–21:00 là lịch hợp lệ, đánh
 * dấu bận ở đó là ép người xếp lịch bỏ qua cảnh báo, và cảnh báo bị bỏ qua thường
 * xuyên thì thành vô dụng.
 *
 * Giờ hỏng (thiếu / sai định dạng — buổi cũ có thể có) trả `false` chứ KHÔNG ném: hậu
 * quả đúng của dữ liệu hỏng là "không đánh dấu được", không phải "cả form chết".
 */
export function trungKhungGio(a: KhungGio, b: KhungGio): boolean {
  const a1 = phutTuHhmm(a.startTime);
  const a2 = phutTuHhmm(a.endTime);
  const b1 = phutTuHhmm(b.startTime);
  const b2 = phutTuHhmm(b.endTime);
  if (a1 === null || a2 === null || b1 === null || b2 === null) return false;
  return a1 < b2 && b1 < a2;
}
