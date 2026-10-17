/**
 * lib/nguon/ly-do-hang-cho.ts — LÝ DO một dòng quy nguồn nằm trong "hàng chờ nguồn". THUẦN (không DB, không auth).
 *
 * Tách khỏi `doc-hang-cho.ts` (11/10/2026) để hai bên cùng gọi MỘT hàm mà không kéo `scopedDb`/`auth` vào:
 *  · màn hàng chờ (`doc-hang-cho.ts`) in pill cho từng dòng;
 *  · hai đường nhập Excel (`phanLoaiDongNhap`) hỏi «lead vừa tạo có vào hàng chờ không» để nói THẬT với người nhập
 *    rằng nguồn của lead đang chờ duyệt, thay vì «đã ghi nguồn».
 * `dieuKienLyDo` (điều kiện Prisma) ở `doc-hang-cho.ts` PHẢI cùng nghĩa với `lyDoCuaDong` — ca đối chiếu hai bên: `doc-hang-cho.test.ts` + ca DB `[NHH-FE-HC-05]`.
 */
import { docMaNvSai, type MaNvSaiDoc } from "./ma-nv-an-toan";
import { LY_DO_XEM_TAY_HANG_CHO, type LyDoHangCho } from "./nhan-hien-thi";

/**
 * Mã NV sai ĐỂ HIỂN THỊ. `ma` null = người nhập gõ thứ KHÔNG phải dạng mã nhân viên (có thể là SĐT/tên) nên đã bị che; `doDai` = số ký tự họ đã gõ.
 * `raw` = CHUỖI GỐC họ gõ — CHỈ có khi người xem có quyền PII (`coQuyenXem`); không quyền ⇒ null (lọc ở server, trong `docMaNvSai`).
 */
export type MaNvSaiHienThi = MaNvSaiDoc;

export type DongAttr = {
  referrerMissing: boolean;
  otherSourceNote: string | null;
  canhBao: string[];
  group: { code: string; requiresNote: boolean };
  /** `LeadAttribution.signals` (JSON tuỳ ý trong DB ⇒ không tin kiểu). Chỉ `xemTay[]` được đọc. */
  signals: unknown;
};

const laDoiTuong = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Các lý do xem tay trong DANH SÁCH HẸP (`LY_DO_XEM_TAY_HANG_CHO`) mà `signals.xemTay[]` của dòng đang mang — cùng nghĩa với điều kiện `XEM_TAY` của `dieuKienLyDo`. */
export function xemTayHangChoCuaDong(signals: unknown): string[] {
  if (!laDoiTuong(signals) || !Array.isArray(signals.xemTay)) return [];
  const co = new Set(signals.xemTay.filter((x): x is string => typeof x === "string"));
  return LY_DO_XEM_TAY_HANG_CHO.filter((r) => co.has(r));
}

/**
 * Các lý do mà MỘT dòng đang vướng — phép THUẦN, cùng nghĩa với `dieuKienLyDo` (ca đối chiếu hai bên ở
 * `doc-hang-cho.test.ts` + ca DB `[NHH-FE-HC-05]`). Dùng để in pill cho từng dòng đã đọc.
 */
export function lyDoCuaDong(a: DongAttr): LyDoHangCho[] {
  const ra: LyDoHangCho[] = [];
  if (a.group.code === "UNKNOWN") ra.push("UNKNOWN");
  if (a.referrerMissing) ra.push("THIEU_NGUOI");
  if (a.group.requiresNote && (a.otherSourceNote === null || a.otherSourceNote === "")) ra.push("THIEU_GIAI_TRINH");
  if (a.canhBao.length > 0) ra.push("CANH_BAO");
  if (xemTayHangChoCuaDong(a.signals).length > 0) ra.push("XEM_TAY");
  return ra;
}

/**
 * `signals.maNvSai` → `{ ma, loai }` hoặc null (hình lạ ⇒ null, không đoán). Cho dòng hàng chờ in «Mã NV `X` không hợp lệ (…)».
 * CHỈ khi dấu xem tay `INVALID_EMPLOYEE_REFERRER_CODE` còn sống: người duyệt đã chọn người (`BO_SUNG_NGUOI`) thì `doiNguonLead` gỡ `xemTay` nhưng GIỮ `maNvSai` làm vết gốc —
 * không có điều kiện này, màn lead đã xử lý xong vẫn in «mã không dùng được» như thể còn chờ.
 */
export function maNvSaiCuaDong(signals: unknown, canViewPii: boolean): MaNvSaiHienThi | null {
  if (!laDoiTuong(signals) || !laDoiTuong(signals.maNvSai)) return null;
  if (!Array.isArray(signals.xemTay) || !signals.xemTay.includes("INVALID_EMPLOYEE_REFERRER_CODE")) return null;
  // `docMaNvSai` che LẠI lúc đọc (lớp thứ hai): dòng ghi TRƯỚC bản vá có thể mang nguyên chữ người nhập (SĐT/tên) — chỉ chuỗi có dạng mã nhân viên được đi tiếp.
  return docMaNvSai(signals.maNvSai, canViewPii);
}
