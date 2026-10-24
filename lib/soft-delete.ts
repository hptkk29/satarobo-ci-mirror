// lib/soft-delete.ts — FIX-C3 (B1): soft-delete filter dùng chung cho CẢ base `db`
// (mọi read kể cả `db` trần) lẫn `scopedDb`. Tách riêng để TRÁNH circular import
// (db.ts ↔ db-scope.ts). THUẦN, không import `db`/`db-scope` → test được độc lập.
//
// ⚠️ GIỚI HẠN Prisma: query extension chỉ chạy cho query TOP-LEVEL. Nested `include`/
// `_count` KHÔNG được auto-filter → chỗ đọc lồng phải tự thêm `deletedAt: null`.

/**
 * Model (PascalCase) dùng soft-delete: read mặc định ẩn row đã xóa (`deletedAt != null`).
 * Call-site cố ý đọc cả row đã xóa (vd "Thùng rác") tự truyền `deletedAt: ...` để OVERRIDE.
 */
export const SOFT_DELETE_MODELS = new Set<string>([
  "Order",
  "Payment",
  "Receipt",
  "Enrollment",
]);

/**
 * Inject filter `deletedAt: null` cho model soft-delete (THUẦN — test được).
 * Idempotent + không ghi đè: nếu where đã nhắc tới `deletedAt` (call-site cố ý đọc trash) → giữ nguyên.
 * Không phải model soft-delete → trả nguyên args.
 */
export function injectSoftDelete<A>(model: string, args: A): A {
  if (!SOFT_DELETE_MODELS.has(model)) return args;

  const a = (args ?? {}) as { where?: Record<string, unknown> };
  const where = a.where;

  // Call-site đã chủ động đề cập deletedAt (top-level) → tôn trọng, không override.
  if (where && Object.prototype.hasOwnProperty.call(where, "deletedAt")) return args;

  const softWhere = { deletedAt: null };
  return { ...a, where: where ? { AND: [where, softWhere] } : softWhere } as A;
}
