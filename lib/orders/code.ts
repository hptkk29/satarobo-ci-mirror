import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { nextSeq } from "@/lib/codegen";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * FIX-C5 — chống trùng mã đơn.
 *
 * Trước đây dùng read-then-write (`findFirst` + `parseInt`): race condition khi
 * 2 đơn tạo song song cùng đọc seq cũ → trùng mã. Nay dùng `Counter` atomic
 * (`nextSeq`, mẫu `lib/codegen.ts`) gọi BÊN TRONG `$transaction` của caller.
 *
 * Format mã giữ nguyên: ORD-YYMMDD-NNNNNN (vd ORD-260521-000001).
 * Counter key theo ngày: `ORDER:<yymmdd>` → seq reset mỗi ngày.
 */

/** YYMMDD theo local date (vd 2026-05-21 -> "260521"). THUẦN. */
export function orderCodeYymmdd(date = new Date()): string {
  return (
    String(date.getFullYear()).slice(2) +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0")
  );
}

/** Ghép mã đơn từ yymmdd + seq (pad 6 số). THUẦN. */
export function formatOrderCode(yymmdd: string, seq: number): string {
  return `ORD-${yymmdd}-${String(seq).padStart(6, "0")}`;
}

/**
 * Sinh mã đơn kế tiếp bằng counter atomic.
 *
 * Nhận `client: DbClient` để gọi ĐƯỢC bên trong `$transaction` (truyền `tx`),
 * giữ codegen + `order.create` cùng 1 transaction → mã chắc chắn được dùng
 * (rollback cũng rollback luôn counter increment).
 */
export async function generateOrderCode(
  client: DbClient = db,
  date = new Date(),
): Promise<string> {
  const yymmdd = orderCodeYymmdd(date);
  const seq = await nextSeq(`ORDER:${yymmdd}`, client);
  return formatOrderCode(yymmdd, seq);
}

/**
 * Chạy `fn` với retry khi đụng unique-violation (Prisma P2002) — backstop cho
 * `@unique` mã đơn. Counter atomic gần như loại bỏ va chạm; retry chỉ phòng
 * trường hợp counter lệch / chèn thủ công. Lỗi khác → ném ngay (không retry).
 */
export async function withUniqueRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        attempt < maxRetries
      ) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
