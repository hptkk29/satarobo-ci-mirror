// lib/affiliate/chung.ts — phần DÙNG CHUNG của mọi hàm ghi Affiliate (đối tác · loại · nhãn · campaign · membership · website). THUẦN: không DB.
//
// Một nơi cho: người ghi, lỗi nghiệp vụ ném TRONG transaction (luật rollback — từ chối sau phép ghi là `throw`), mã danh mục và nhận diện lỗi trùng khoá.
// Không chép lại ở từng hàm ghi: ba phần này lệch nhau là câu lỗi, định dạng mã và nhật ký lệch nhau giữa các màn.

/** Người thực hiện — `ten` được chụp vào AuditLog (không tra lại lúc đọc). */
export type NguoiGhi = { userId: string; ten: string };

/** Khớp `AuditActor` của `writeAudit` (id + name). */
export function aud(n: NguoiGhi): { id: string; name: string } {
  return { id: n.userId, name: n.ten };
}

/** `module` của AuditLog cho mọi thao tác Affiliate: cùng module "nguon-hoa-hong" để màn lịch sử gom chung một chỗ. */
export const MODULE_AUDIT_AFFILIATE = "nguon-hoa-hong";

/**
 * Lỗi nghiệp vụ. Ném TRONG callback `$transaction` để rollback (luật: `return` KHÔNG rollback, chỉ `throw` mới rollback); nơi ngoài bắt và dịch ra
 * `KetQuaGhi`. `truong` = tên ô để giao diện gắn câu lỗi đúng chỗ.
 */
export class LoiGhiAffiliate extends Error {
  constructor(
    message: string,
    readonly truong?: string,
  ) {
    super(message);
    this.name = "LoiGhiAffiliate";
  }
}

/** Kết quả của một hàm ghi: thành công mang thêm dữ liệu `T`; thất bại mang câu tiếng Việt + ô lỗi. */
export type KetQuaGhi<T extends object = Record<never, never>> = ({ ok: true } & T) | { ok: false; loi: string; truong?: string };

/** Mã danh mục: chữ HOA + số + gạch dưới, 3–40 ký tự. KHỚP CHECK `*_code_chk` của migration — đổi một bên là phải đổi bên kia. */
export const MA_DANH_MUC_RE = /^[A-Z0-9_]{3,40}$/;

/**
 * Đưa chữ người gõ về dạng mã: bỏ dấu, `đ → D`, chữ HOA, mọi ký tự ngoài A–Z/0–9 thành `_`, gộp `_` liền nhau, cắt `_` hai đầu.
 * KHÔNG đảm bảo hợp lệ (có thể ngắn hơn 3) — nơi gọi vẫn phải kiểm `MA_DANH_MUC_RE`.
 */
export function chuanHoaMa(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Lỗi Prisma "vi phạm ràng buộc duy nhất" (P2002). Đua tạo cùng mã: người sau nhận lỗi này — là «mã đã có», không phải lỗi 500. */
export function laLoiTrungKhoa(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** Chuỗi tuỳ chọn từ form: rỗng/toàn khoảng trắng ⇒ null, còn lại trim. */
export function chuoiHoacNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}
