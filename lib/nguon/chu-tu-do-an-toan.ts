/**
 * lib/nguon/chu-tu-do-an-toan.ts — CHỮ TỰ DO của tab Nguồn mà người nhập gõ: nhãn nguồn Excel (`signals.nhanGoc`) và giải trình nhóm «Khác» (`LeadAttribution.otherSourceNote`).
 * THUẦN (không DB, không đồng hồ).
 *
 * ── Vì sao có tệp này (review vòng 7, 11/10/2026) ───────────────────────────────────────────────────────────
 * Ô «Nguồn» của Excel là chữ tự do: 'Chị Lan 0905123456 giới thiệu' được LƯU NGUYÊN VĂN vào `signals.nhanGoc` (kèm xem tay NHAN_NGUON_LA), và hàng chờ nguồn + khối «Nguồn» trên lead
 * từng trả nó cho MỌI người xem tab Nguồn — kể cả GIAM_DOC (`sources:view`, không có `leads:*`) và HO_ACCOUNTANT (không `leads:view-pii`) — trong khi tên lead cạnh đó đã được che.
 * Cùng lớp lỗi với `signals.maNvSai.raw` (vòng 6, `docMaNvSai` ở `ma-nv-an-toan.ts`); chú thích cũ «signals (KHÔNG PII)» ở `quy-nguon.ts` là SAI.
 *
 * ── Luật ────────────────────────────────────────────────────────────────────────────────────────────────────
 * LƯU nguyên văn (người duyệt có quyền cần chuỗi gốc để quyết) — chỗ rò thật là HIỂN THỊ. Nên: MỘT hàm phía SERVER, `canViewPii` BẮT BUỘC (luật 7, không mặc định);
 *   · CÓ `leads:view-pii` ⇒ nguyên văn (đã trim);
 *   · KHÔNG ⇒ `nhanGoc`: chỉ hiện khi KHỚP CHÍNH XÁC một nhãn trong bảng 28 nhãn đã chốt 06/10 (`BANG_ANH_XA_0610`, bỏ hoa/thường + khoảng trắng thừa) — tiện lợi tối thiểu cho
 *     người duyệt mà không có cách nào chứa SĐT/tên; mọi chữ khác ⇒ «đã ẩn (N ký tự)». `giaiTrinh`: không có bảng chuẩn ⇒ ẩn hẳn.
 * Cố ý KHÔNG «che từng phần» (thay dãy số bằng •••, giữ phần còn lại): tên người không có dấu hiệu nhận biết, nên che từng phần là chữa SĐT mà bỏ tên — còn lại vẫn là PII. Ẩn cả chuỗi là cách duy nhất không
 * phụ thuộc vào việc đoán «đâu là PII». Lọc ở DỮ LIỆU server trả về, KHÔNG ở CSS/client.
 *
 * Tệp này import `anh-xa-nhan-cu.ts` (thuần, chỉ kéo `danh-muc-goc` + `ma-nv-an-toan`) để dùng chính bảng nhãn đã chốt — không chép bảng thứ hai.
 */
import { BANG_ANH_XA_0610, chuanHoaNhanNguon } from "./anh-xa-nhan-cu";

/** Dấu thay cho chuỗi bị ẩn: nói THẬT «có chữ nhưng bạn không có quyền xem», kèm độ dài (không có nội dung). */
export const VET_AN = (doDai: number): string => `đã ẩn (${doDai} ký tự)`;

/** Tập khoá nhãn chuẩn (đã `chuanHoaNhanNguon`). Dựng một lần từ bảng đã chốt. */
const NHAN_CHUAN: ReadonlySet<string> = new Set(
  BANG_ANH_XA_0610.map((r) => chuanHoaNhanNguon(r.nhan)).filter((k): k is string => k !== null),
);

/** JSON tuỳ ý trong DB ⇒ không tin kiểu: chuỗi không rỗng sau trim, hoặc null. */
function chuoiHopLe(luu: unknown): string | null {
  if (typeof luu !== "string") return null;
  const s = luu.trim();
  return s === "" ? null : s;
}

/**
 * Nhãn nguồn người nhập gõ (`signals.nhanGoc`) → chuỗi ĐƯỢC PHÉP hiện cho người xem. Hình lạ/rỗng ⇒ null.
 * ⚠️ `canViewPii` BẮT BUỘC, KHÔNG mặc định; chạy thật mà thiếu (any/JS) thì rơi về «không quyền» (`=== true`), không bao giờ về «có quyền».
 */
export function docNhanGoc(luu: unknown, canViewPii: boolean): string | null {
  const s = chuoiHopLe(luu);
  if (s === null) return null;
  if (canViewPii === true) return s;
  const khoa = chuanHoaNhanNguon(s);
  return khoa !== null && NHAN_CHUAN.has(khoa) ? s : VET_AN(s.length);
}

/**
 * ĐƯỜNG VÀO của lead (`Lead.source`) → chuỗi được phép hiện. Cột này là «khoá định tuyến» nhưng đường nhập Excel ghi NGUYÊN VĂN ô «Nguồn» của người nhập vào đó
 * (probe `[EMNV-D19]`: `Chị Lan 0905123456 giới thiệu`), nên nó là CHỮ TỰ DO như `nhanGoc` — cùng luật: nhãn chuẩn thì hiện, còn lại «đã ẩn (N ký tự)» khi không có `leads:view-pii`.
 * Giá trị máy (`sale-form`, `lien-he`, `quatang`… có trong bảng 28 nhãn) vẫn hiện; giá trị máy khác (`import-excel`, `MANUAL`…) bị ẩn với người không quyền — an toàn trước, tiện sau.
 */
export function docDuongVao(luu: unknown, canViewPii: boolean): string | null {
  return docNhanGoc(luu, canViewPii);
}

/**
 * Giải trình nhóm «Khác» (`otherSourceNote`) → chuỗi ĐƯỢC PHÉP hiện. Không có bảng chuẩn cho chữ giải trình ⇒ người KHÔNG có quyền chỉ thấy «đã ẩn (N ký tự)»
 * (đủ để biết lead đã CÓ giải trình, như cổng `THIEU_GIAI_TRINH` cần). Hình lạ/rỗng ⇒ null. `canViewPii` BẮT BUỘC như `docNhanGoc`.
 */
export function docGiaiTrinh(luu: unknown, canViewPii: boolean): string | null {
  const s = chuoiHopLe(luu);
  if (s === null) return null;
  return canViewPii === true ? s : VET_AN(s.length);
}
