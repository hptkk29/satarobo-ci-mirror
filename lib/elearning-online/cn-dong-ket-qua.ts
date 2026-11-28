/**
 * "Dòng kết quả" của giấy chứng nhận Online (thiết kế QoCN: `Hoàn thành {số bài} bài · điểm thi {điểm}/100`) — phần THUẦN, không import gì (dùng được ở cả client lẫn server, và để
 * `cai-dat-hoc-tap.ts` kiểm mẫu mà không kéo theo `node:crypto` của `cn-mau.ts`).
 */
export const TOKEN_DONG_KET_QUA = ["{số bài}", "{điểm}"] as const;
export const DO_DAI_TOI_DA_DONG_KET_QUA = 120;

const CHO_TRONG = /\{[^{}]*\}/g;
// Ký tự điều khiển viết bằng mã (không gõ thẳng ký tự thô vào mã nguồn).
const KY_TU_DIEU_KHIEN = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`);

/** Mẫu hợp lệ: ≤120 ký tự, một dòng, không ký tự điều khiển, chỉ có hai chỗ trống đã biết (`{số bài}`, `{điểm}`) — `{...}` lạ bị từ chối thay vì in nguyên ra giấy chứng nhận. */
export function kiemDongKetQuaMau(m: string): { ok: true } | { ok: false; thongBao: string } {
  if (m.length > DO_DAI_TOI_DA_DONG_KET_QUA) return { ok: false, thongBao: `Dòng kết quả tối đa ${DO_DAI_TOI_DA_DONG_KET_QUA} ký tự` };
  if (KY_TU_DIEU_KHIEN.test(m)) return { ok: false, thongBao: "Dòng kết quả phải nằm trên một dòng, không có ký tự điều khiển" };
  const lanh = (m.match(CHO_TRONG) ?? []).find((x) => !(TOKEN_DONG_KET_QUA as readonly string[]).includes(x));
  if (lanh) return { ok: false, thongBao: `Chỗ trống ${lanh} không hợp lệ — chỉ dùng {số bài} và {điểm}` };
  if (/[{}]/.test(m.replace(CHO_TRONG, ""))) return { ok: false, thongBao: "Dấu ngoặc nhọn chưa đóng/mở đủ cặp" };
  return { ok: true };
}

/** Thay chỗ trống bằng số thật; thiếu số ⇒ "—" (không in "undefined" hay để trống lủng lẳng ra giấy). */
export function dungDongKetQua(mau: string, v: { soBai: number | null | undefined; diem: number | null | undefined }): string {
  return mau
    .replaceAll("{số bài}", v.soBai == null ? "—" : String(v.soBai))
    .replaceAll("{điểm}", v.diem == null ? "—" : String(v.diem))
    .trim();
}
