// lib/security/lam-sach-dau-vao.ts — LÀM SẠCH CHUỖI ĐẦU VÀO của mọi đường CÔNG KHAI nhận SĐT (PHONE_ENUMERATION, reviewer độc lập 20/10/2026).
//
// Vì sao tồn tại: một đường công khai không được để MÃ TRẠNG THÁI nói «SĐT này đã có trong CRM chưa». Nhánh «lead trùng» không ghi tên/ghi chú/mã click của khách (chỉ ghi dấu vết), còn nhánh «lead mới» ghi tất cả. Nếu một
// chuỗi khiến Postgres/Prisma TỪ CHỐI (NUL `\u0000` ⇒ lỗi 22021; lone surrogate ⇒ «unexpected end of hex escape» ở lớp JSON của Prisma) thì nhánh «mới» ném ⇒ 500, nhánh «trùng» không chạm tới ⇒ 200 — dò SĐT bằng
// status, không cần token, không cần đo thời gian. Lớp thời gian chung (`dong-deu-thoi-gian.ts`) chỉ cân THỜI GIAN, không cân MÃ TRẠNG THÁI.
//
// Luật: MỌI chuỗi do khách gửi được làm sạch Ở CỬA VÀO — TRƯỚC khi lược đồ chạy và TRƯỚC khi nhánh nào rẽ — để hai nhánh nhìn cùng một đầu vào. Làm sạch (bỏ NUL, thay lone surrogate bằng U+FFFD) chứ không từ chối:
// không có khách thật nào gõ NUL, và một lead không được mất vì một ký tự rác. Đường nào chủ trương TỪ CHỐI (lược đồ affiliate `.strict()`, `SACH`) thì từ chối ở lược đồ — cũng TRƯỚC khi rẽ nhánh, nên đối xứng.

/** U+FFFD — ký tự thay thế chuẩn Unicode. */
const THAY_THE = "�";

// Surrogate cao KHÔNG theo sau bởi surrogate thấp, HOẶC surrogate thấp KHÔNG đứng sau surrogate cao. Không cờ `u` có chủ đích: ở chế độ code-unit từng nửa cặp mới khớp được. Cặp hợp lệ (emoji…) KHÔNG bị đụng.
const SURROGATE_LE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// eslint-disable-next-line no-control-regex
const NUL = /\u0000/g;

/** Bỏ NUL, thay mỗi lone surrogate bằng U+FFFD. Chuỗi sạch trả về CHÍNH NÓ. */
export function lamSachChuoi(s: string): string {
  return s.replace(NUL, "").replace(SURROGATE_LE, THAY_THE);
}

/** `true` nếu chuỗi chứa NUL hoặc lone surrogate (thứ Postgres/Prisma từ chối). */
export function chuoiCoKyTuCam(s: string): boolean {
  return s.includes("\u0000") || new RegExp(SURROGATE_LE.source).test(s);
}

const DO_SAU_TOI_DA = 8;

/**
 * Làm sạch ĐỆ QUY mọi chuỗi (giá trị VÀ khoá) trong một thân JSON/form. Quá `DO_SAU_TOI_DA` tầng thì bỏ phần sâu (thay bằng `null`) — thân công khai không có lý do nào lồng sâu hơn, và đệ quy không giới hạn
 * trên dữ liệu kẻ lạ gửi là một đường tấn công khác. Không đụng số/boolean/null. Trả bản SAO, không sửa đầu vào.
 */
export function lamSachDeep(v: unknown, sau = 0): unknown {
  if (typeof v === "string") return lamSachChuoi(v);
  if (v === null || typeof v !== "object") return v;
  if (sau >= DO_SAU_TOI_DA) return null;
  if (Array.isArray(v)) return v.map((x) => lamSachDeep(x, sau + 1));
  const ra: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) ra[lamSachChuoi(k)] = lamSachDeep(x, sau + 1);
  return ra;
}

/**
 * Lỗi DO ĐẦU VÀO mà Prisma/Postgres ném khi ghi — loại lỗi mà một kẻ lạ ÉP ĐƯỢC ở nhánh «lead mới» (khoá ngoại lạ P2003, vỡ UNIQUE P2002, giá trị quá dài P2000, kiểu sai, NUL/surrogate chưa lọt lưới).
 * KHÔNG gồm lỗi hạ tầng (mất kết nối P1xxx, hết pool P2024, giao dịch hết hạn P2028…): đó là lỗi của HỆ THỐNG, trả 500 là đúng và nó không phụ thuộc đầu vào.
 */
export function laLoiDoDauVao(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const ten = (e as { name?: unknown }).name;
  const code = (e as { code?: unknown }).code;
  const msg = String((e as { message?: unknown }).message ?? "");
  if (ten === "PrismaClientValidationError") return true;
  if (ten === "PrismaClientKnownRequestError" && typeof code === "string") return ["P2000", "P2002", "P2003", "P2005", "P2006", "P2007", "P2011", "P2012", "P2013", "P2020"].includes(code);
  if (ten === "PrismaClientUnknownRequestError") return /22021|22P05|invalid byte sequence|hex escape/i.test(msg);
  return false;
}
