/**
 * lib/nguon/ma-nv-an-toan.ts — ô «Mã NV giới thiệu» của Excel là CHỮ TỰ DO: người nhập có thể dán nhầm SỐ ĐIỆN THOẠI phụ huynh, TÊN người, email. THUẦN (không DB, không đồng hồ).
 *
 * ── Luật (vòng UAT cuối, §22/§23 — ĐẢO luật 11/10) ────────────────────────────────────────────────────────
 * Luật 11/10: «chuỗi không có dạng mã KHÔNG được lưu», vì `signals.maNvSai.ma` được in không che cho MỌI người xem tab Nguồn. Chủ dự án đòi người duyệt thấy chuỗi người nhập gõ
 * (`rawEmployeeCode`) — mà `Lead` đã chứa SĐT phụ huynh trong chính DB, nên chỗ rò thật không phải LƯU mà là HIỂN THỊ cho người không có quyền xem PII. Nay:
 *   · LƯU: `signals.maNvSai.raw` = chuỗi gốc (`chuoiGocDeLuu`: trim, tối đa `RAW_TOI_DA` = 40 ký tự);
 *   · `signals.maNvSai.ma` (phần hiện cho MỌI người) VẪN chỉ là chuỗi có DẠNG MÃ NHÂN VIÊN — mọi thứ khác `ma = null` kèm độ dài, «đã ẩn»;
 *   · ĐỌC: MỘT hàm phía server (`docMaNvSai`, qua `maNvSaiCuaDong`) nhận cờ `canViewPii` BẮT BUỘC (không mặc định). `raw` chỉ ra khỏi hàm khi cờ = true; không thì `raw = null` và
 *     không có dãy chữ số nào trong kết quả — ở dữ liệu server trả về, không phải ẩn bằng CSS.
 * Hình dạng mã (`laDangMaNv`) CHỈ quyết định việc HIỆN `ma` cho người không có quyền, KHÔNG BAO GIỜ quyết định việc GIẢI MÃ: mã hợp lệ hiện hữu luôn được `quyetDinhMaNvGioiThieu` giải ra nhân viên.
 *
 * ── Dạng mã nhân viên ───────────────────────────────────────────────────────────────────────────────────────
 * Mã thật: `SR.NV.002`, `NV.SR.002`, `EMNV.NV.001` — chữ HOA/số ASCII ngăn bằng `.` `-` `_`, luôn có phần số, rất ít chữ số. Nên KHÔNG phải dạng mã nếu:
 *  · có khoảng trắng / `@` / chữ có dấu / ký tự lạ (tên người, email, câu chữ) — bộ ký tự ASCII HOA + số + `.` `-` `_`;
 *  · KHÔNG có chữ số nào (chữ trơn = tên);
 *  · TỔNG số chữ số ≥ 8 (SĐT, kể cả `0905.123.456`, `+84 905…` đã bị loại ở bước ký tự; dãy số dài). Đếm TỔNG chứ không đếm dãy liền: SĐT hay bị ngăn bằng dấu chấm.
 *  · dài quá `MA_NV_TOI_DA` ký tự.
 * Cố ý nghiêng về CHE: mã thật bị che nhầm thì người duyệt mất tiện lợi (mở ô gốc trong file Excel vẫn đọc được); SĐT bị lộ thì không lấy lại được.
 */
// ⚠️ Tệp này KHÔNG import gì: `anh-xa-nhan-cu.ts` (đồ thị import của script CHỈ-ĐỌC, lưới [QN-DT-01]) dùng nó, mà kiểu `MaNvSai` ở `tin-hieu.ts` kéo theo `nguon-chup.ts` (zod).
// Hàm dựng `MaNvSai` (cần kiểu đó) nằm ở `ma-nv-gioi-thieu.ts`.

/** Dài nhất một mã nhân viên thật có thể có. */
export const MA_NV_TOI_DA = 24;
/** Từ ngần này chữ số (TỔNG, không cần liền nhau) trở lên là nghi SĐT / dãy số — `ma` hiện cho mọi người bị che (`raw` vẫn lưu, chỉ người có quyền thấy). */
export const SO_CHU_SO_NGHI_SDT = 8;

const KHUON_MA = /^[A-Z0-9]+(?:[._-][A-Z0-9]+)*$/;

/** `ma` ĐÃ chuẩn hoá (`chuanHoaMaNhanVien`: cắt khoảng trắng đầu/cuối + HOA). Đúng dạng mã nhân viên? */
export function laDangMaNv(ma: string): boolean {
  if (ma.length < 3 || ma.length > MA_NV_TOI_DA) return false;
  if (!KHUON_MA.test(ma)) return false;
  // Mã nhân viên thật luôn có ít nhất MỘT chữ cái (SR.NV.001). Dãy toàn chữ số là SĐT/số nào đó, kể cả khi ngắn hơn ngưỡng: SĐT bị cắt đôi qua hai dòng Excel («0905123» + «456789»)
  // từng lọt qua và được nối lại bằng « | » ở loại KHAC_MA (reviewer vòng 3, 11/10/2026).
  if (!/[A-Z]/.test(ma)) return false;
  const soChuSo = ma.replace(/\D/g, "").length;
  return soChuSo >= 1 && soChuSo < SO_CHU_SO_NGHI_SDT;
}

/** Dài nhất chuỗi GỐC lưu cho MỘT ô (cắt, không từ chối — người nhập có dán gì thì lead vẫn được tạo). */
export const RAW_TOI_DA = 40;
/** Loại `KHAC_MA` lưu nhiều ứng viên nối « | »: trần chung (5 ứng viên × 40 + dấu nối + «… +N»), dùng để cắt LẠI lúc đọc nếu dữ liệu hỏng. */
export const RAW_KHAC_MA_TOI_DA = 240;
/** Số ứng viên xung đột tối đa liệt kê trong `raw` của `KHAC_MA` (dư ⇒ «… +N»). */
export const UNG_VIEN_TOI_DA = 5;

// eslint-disable-next-line no-control-regex -- cố ý: bắt ký tự điều khiển để thay bằng khoảng trắng
const KY_TU_DIEU_KHIEN = /[\u0000-\u001f\u007f-\u009f]/g;
const DAU_NGAT_CAP_THAY_THE = /[\ud800-\udbff]$/;

/**
 * Chuỗi GỐC để LƯU của một ô: ký tự điều khiển (xuống dòng · tab · NUL…) thành khoảng trắng, trim, cắt `RAW_TOI_DA`. KHÔNG chuẩn hoá hoa/thường — đây là chữ người gõ.
 * Không cắt đôi một cặp thay thế UTF-16 (emoji) ở ranh giới.
 */
export function chuoiGocDeLuu(s: string): string {
  const cat = s.replace(KY_TU_DIEU_KHIEN, " ").trim().slice(0, RAW_TOI_DA).replace(DAU_NGAT_CAP_THAY_THE, "");
  return cat.trim();
}

/** Dấu nối các mã xung đột của loại `KHAC_MA` — MỘT nguồn cho phía ghi (`maNvSaiKhacMa`) và phía đọc (`docMaNvSai`). */
export const PHAN_CACH_KHAC_MA = " | ";
const LOAI_KHAC_MA = "KHAC_MA";

/** `ma` có dạng mã ⇒ chính nó; không ⇒ `null` (KHÔNG BAO GIỜ trả về chữ người nhập khi nó không phải dạng mã). */
export function maNvLuuDuoc(ma: string): string | null {
  return laDangMaNv(ma) ? ma : null;
}

/** Kết quả ĐỌC `signals.maNvSai` để hiển thị. `raw` null = không quyền xem HOẶC dòng cũ chưa lưu chuỗi gốc; `coQuyenXem` cho giao diện phân biệt hai ca đó. */
export type MaNvSaiDoc = { ma: string | null; loai: string; doDai: number; raw: string | null; coQuyenXem: boolean };

/** `raw` đã lưu (JSON tuỳ ý ⇒ không tin kiểu) → chuỗi dùng được, hoặc null. Cắt LẠI theo trần của loại (dữ liệu hỏng/cũ không được phình giao diện). */
function docRaw(r: Record<string, unknown>, loai: string): string | null {
  if (typeof r.raw !== "string") return null;
  const tran = loai === LOAI_KHAC_MA ? RAW_KHAC_MA_TOI_DA : RAW_TOI_DA;
  const s = r.raw.replace(KY_TU_DIEU_KHIEN, " ").trim().slice(0, tran).replace(DAU_NGAT_CAP_THAY_THE, "").trim();
  return s === "" ? null : s;
}

/**
 * Dạng ĐỌC LẠI từ `signals` (JSON tuỳ ý trong DB ⇒ không tin kiểu). Hình lạ ⇒ null. Dòng cũ lưu nguyên chữ ⇒ che tại đây (lớp thứ hai).
 * Loại `KHAC_MA` là các mã xung đột đã nối bằng `PHAN_CACH_KHAC_MA`: kiểm TỪNG phần (chuỗi nối có khoảng trắng nên kiểm cả chuỗi thì LUÔN bị che — người duyệt không thấy các mã xung đột).
 * Chỉ cần một phần không có dạng mã là che TOÀN BỘ; loại khác không được hưởng cách tách này.
 *
 * ⚠️ `canViewPii` BẮT BUỘC, KHÔNG mặc định (luật 7): đây là CHỖ DUY NHẤT chuỗi gốc đi ra khỏi tầng server. Quên truyền = tsc báo, không phải lặng lẽ lộ SĐT.
 */
export function docMaNvSai(luu: unknown, canViewPii: boolean): MaNvSaiDoc | null {
  if (typeof luu !== "object" || luu === null || Array.isArray(luu)) return null;
  const r = luu as Record<string, unknown>;
  if (typeof r.loai !== "string") return null;
  const raw = canViewPii ? docRaw(r, r.loai) : null;
  const ma = r.ma;
  if (ma === null || ma === undefined) {
    return { ma: null, loai: r.loai, doDai: typeof r.doDai === "number" && Number.isFinite(r.doDai) && r.doDai >= 0 ? Math.trunc(r.doDai) : 0, raw, coQuyenXem: canViewPii };
  }
  if (typeof ma !== "string" || ma === "") return null;
  const doDai = typeof r.doDai === "number" && Number.isFinite(r.doDai) && r.doDai >= 0 ? Math.trunc(r.doDai) : ma.length;
  return { ma: r.loai === LOAI_KHAC_MA ? kiemTungPhan(ma) : maNvLuuDuoc(ma), loai: r.loai, doDai, raw, coQuyenXem: canViewPii };
}

/** `a | b | c` ⇒ chính chuỗi nếu MỌI phần có dạng mã, ngược lại `null`. */
function kiemTungPhan(ma: string): string | null {
  const phan = ma.split(PHAN_CACH_KHAC_MA);
  return phan.every((p) => maNvLuuDuoc(p) !== null) ? ma : null;
}
