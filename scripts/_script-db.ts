/**
 * scripts/_script-db.ts — PrismaClient cho script chạy NGOÀI Next.
 *
 * VÌ SAO CÓ FILE NÀY. Supabase có hai pooler:
 *   · :6543 transaction pooler (`DATABASE_URL`) — pgbouncer, KHÔNG giữ prepared statement
 *     giữa các câu lệnh.
 *   · :5432 session pooler (`DIRECT_URL`) — giữ, dùng cho migration/seed.
 *
 * `new PrismaClient()` trần đọc `DATABASE_URL` ⇒ đi qua :6543 ⇒ Prisma dùng prepared
 * statement và dính lỗi `prepared statement "sN" does not exist` (26000) hoặc
 * `already exists` (42P05). Đã ăn thật HAI lần:
 *   · 09/08 — `permissions:list --db` khi nghiệm thu US-01;
 *   · 11/08 — `nen-p1-backfill-orgunit.ts` ngay lần dry-run đầu trên DB dev (52 truy vấn
 *     liên tiếp, chết ở câu thứ 36).
 *
 * Lần thứ ba thì tách ra dùng chung thay vì chép tiếp.
 *
 * `lib/db.ts` KHÔNG dính vì nó tự thêm `pgbouncer=true` (Prisma tắt prepared statement).
 * Script nào import `db` từ `lib/db` cũng an toàn; file này dành cho script tự dựng client.
 */
import { PrismaClient } from "@prisma/client";

/** URL nên dùng cho script: ưu tiên session pooler, không có thì ép `pgbouncer=true`. */
export function scriptDatabaseUrl(): string | undefined {
  const direct = process.env.DIRECT_URL;
  if (direct) return direct;

  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  if (raw.includes("pgbouncer=")) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}pgbouncer=true`;
}

/** PrismaClient an toàn cho script. Nhớ `$disconnect()` ở cuối. */
export function scriptDb(): PrismaClient {
  const url = scriptDatabaseUrl();
  return new PrismaClient(url ? { datasourceUrl: url } : undefined);
}
