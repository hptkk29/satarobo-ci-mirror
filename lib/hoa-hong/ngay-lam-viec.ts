// lib/hoa-hong/ngay-lam-viec.ts — NGÀY LÀM VIỆC cho luật "hiệu lực ≥ công bố + 15 ngày làm việc".
//
// Nguồn: docs/source-commission/04 §6.6 (guardrail Hiệu lực), 05 POL-06, sổ quyết định A9. THUẦN.
//
// ⚠️ Vì sao KHÔNG dùng `lib/elearning/ngay-lam-viec.ts`: tệp đó (a) tính theo UTC và (b) cố ý KHÔNG trừ ngày
// lễ ("repo không có bảng lịch nghỉ" — nay đã có `Holiday`). Hạn tính tiền hoa hồng phải theo NGÀY VN và
// trừ lễ; chép phép cộng sang đây là dựng nguồn thứ hai, nhưng dùng nguyên bản kia là sai hạn đúng vào kỳ
// Tết. Hai tệp khác nhau ở đúng hai điểm trên — đừng gộp.
//
// Quy ước:
//   · Ngày là chuỗi "YYYY-MM-DD" theo lịch VN. Giờ VN = UTC+7 cố định, không có giờ mùa hè.
//   · Cột `@db.Date` (nửa đêm UTC) đọc bằng `ngayCuaCotDate` — KHÔNG đi qua `ngayVN` (cộng 7 giờ vào nửa đêm
//     UTC vẫn ra đúng ngày, nhưng đó là trùng hợp; hai hàm hai nghĩa).
//   · Ngày KHÔNG làm việc = thứ Bảy, Chủ nhật, và ngày `Holiday` có `type = HOLIDAY` mà `centerId` NULL
//     (toàn hệ) hoặc thuộc tập cơ sở trong phạm vi version. `MAINTENANCE`/`EVENT`/`OTHER` KHÔNG trừ
//     (hoà giải 07/10: đó là lịch vận hành, không phải ngày nghỉ).
//   · Đếm từ ngày KẾ TIẾP: công bố thứ Sáu + 1 ngày làm việc = thứ Hai.
//   · Mọi tham số là BẮT BUỘC (luật 7): không có mặc định "15 ngày", không có mặc định "mọi cơ sở".

export type LoaiNgayNghi = "HOLIDAY" | "MAINTENANCE" | "EVENT" | "OTHER";

/** Một dòng `Holiday` đã chuẩn hoá: khoảng [tuNgay, denNgay] ĐÓNG hai đầu. */
export type NgayNghiLe = {
  tuNgay: string;
  denNgay: string;
  loai: LoaiNgayNghi;
  /** `null` = toàn hệ thống. */
  centerId: string | null;
};

const MS_NGAY = 86_400_000;
const LECH_GIO_VN_MS = 7 * 3_600_000;

/** Ngày lịch VN của một thời điểm. */
export function ngayVN(moc: Date): string {
  return new Date(moc.getTime() + LECH_GIO_VN_MS).toISOString().slice(0, 10);
}

/** Ngày của cột `@db.Date` (nửa đêm UTC). */
export function ngayCuaCotDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ra(ngay: string): number {
  const t = Date.parse(`${ngay}T00:00:00.000Z`);
  // Khứ hồi: `Date.parse` của V8 nhận "2026-02-30" và trượt sang 02/03 (không ném). Một hạn pháp lý tính từ ngày
  // trượt âm thầm là hạn sai ⇒ chỉ nhận ngày mà đổi ra lại ĐÚNG chuỗi ấy.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay) || Number.isNaN(t) || tuMoc(t) !== ngay) throw new Error(`Ngày không hợp lệ: "${ngay}"`);
  return t;
}

function tuMoc(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Chuỗi có phải MỘT ngày lịch có thật dạng YYYY-MM-DD không (30/02, tháng 13, thiếu số 0 ⇒ không). Cùng luật với `ra`. */
export function ngayHopLe(ngay: string): boolean {
  try {
    ra(ngay);
    return true;
  } catch {
    return false;
  }
}

/** 00:00 GIỜ VN của một ngày lịch (= 17:00Z của ngày hôm trước). Ngày không có thật ⇒ ném, không trượt sang ngày khác. */
export function dauNgayVN(ngay: string): Date {
  return new Date(ra(ngay) - LECH_GIO_VN_MS);
}

function cuoiTuan(ngay: string): boolean {
  const thu = new Date(ra(ngay)).getUTCDay();
  return thu === 0 || thu === 6;
}

/** Ngày có phải ngày làm việc không (xem quy ước đầu tệp). */
export function laNgayLamViec(
  ngay: string,
  nghi: readonly NgayNghiLe[],
  coSoTrongPhamVi: ReadonlySet<string>,
): boolean {
  if (cuoiTuan(ngay)) return false;
  for (const n of nghi) {
    if (n.loai !== "HOLIDAY") continue;
    if (n.centerId !== null && !coSoTrongPhamVi.has(n.centerId)) continue;
    if (ngay >= n.tuNgay && ngay <= n.denNgay) return false;
  }
  return true;
}

/**
 * `tuNgay` cộng `soNgay` NGÀY LÀM VIỆC, đếm từ ngày KẾ TIẾP. `soNgay = 0` trả chính `tuNgay`.
 * Số âm / không nguyên bị TỪ CHỐI: một phép cộng ngày đoán số là chỗ hạn pháp lý trôi.
 */
export function congNgayLamViec(
  tuNgay: string,
  soNgay: number,
  nghi: readonly NgayNghiLe[],
  coSoTrongPhamVi: ReadonlySet<string>,
): string {
  if (!Number.isInteger(soNgay) || soNgay < 0) throw new Error(`Số ngày làm việc không hợp lệ: ${soNgay}`);
  let t = ra(tuNgay);
  let con = soNgay;
  while (con > 0) {
    t += MS_NGAY;
    if (laNgayLamViec(tuMoc(t), nghi, coSoTrongPhamVi)) con -= 1;
  }
  return tuMoc(t);
}

/** Ngày hiệu lực SỚM NHẤT cho một văn bản công bố ngày `congBo`. */
export function ngayHieuLucSomNhat(
  congBo: string,
  soNgayLamViec: number,
  nghi: readonly NgayNghiLe[],
  coSoTrongPhamVi: ReadonlySet<string>,
): string {
  return congNgayLamViec(congBo, soNgayLamViec, nghi, coSoTrongPhamVi);
}

/**
 * Guardrail "Hiệu lực": `hieuLuc` (theo NGÀY VN) phải ≥ mốc sớm nhất. Trả mốc để câu lỗi nói được
 * "sớm nhất là ngày X".
 */
export function kiemHieuLucSauCongBo(input: {
  congBo: string;
  hieuLuc: Date;
  soNgayLamViec: number;
  nghi: readonly NgayNghiLe[];
  coSoTrongPhamVi: ReadonlySet<string>;
}): { ok: true; somNhat: string } | { ok: false; somNhat: string; hieuLucNgay: string } {
  const somNhat = ngayHieuLucSomNhat(input.congBo, input.soNgayLamViec, input.nghi, input.coSoTrongPhamVi);
  const hieuLucNgay = ngayVN(input.hieuLuc);
  return hieuLucNgay >= somNhat ? { ok: true, somNhat } : { ok: false, somNhat, hieuLucNgay };
}

/**
 * Chủ dự án chốt (A9): chính sách hoa hồng chỉ có hiệu lực sau công bố ÍT NHẤT chừng này ngày LÀM VIỆC.
 * Hằng DUY NHẤT — guardrail kích hoạt và mọi màn hiển thị "sớm nhất là ngày X" cùng đọc nó.
 */
export const SO_NGAY_LAM_VIEC_SAU_CONG_BO = 15;
