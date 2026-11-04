// prisma/seed-permission-registry.ts — Nền Hệ thống P0 · US-01 (TS-01).
// Nạp registry quyền (lib/permissions/registry) vào bảng PermissionDescriptor.
// Chạy lúc deploy (deploy.yml + migrate-test.yml, NGAY SAU prisma migrate deploy).
//
// Ràng buộc TS-01: key trùng giữa 2 module → throw TRƯỚC khi mở transaction
// (collectDescriptors) ⇒ deploy fail với message nêu key + 2 module, registry
// trong DB giữ nguyên trạng thái trước đó.
//
// Idempotent: upsert theo key. Key có trong DB nhưng vắng khỏi khai báo →
// isActive=false — KHÔNG DELETE (giữ vết cho audit/rollback, giống soft delete).
import { PrismaClient } from "@prisma/client";
import {
  ALL_MODULE_DECLS,
  collectDescriptors,
} from "@/lib/permissions/registry";
import type { ModuleDecl } from "@/lib/permissions/registry/types";

/**
 * Đồng bộ registry khai báo → bảng `PermissionDescriptor`.
 *
 * ⚠️ Toàn bộ ghi nằm trong MỘT `$transaction` — lỗi giữa chừng thì registry DB
 * nguyên trạng (TS-01). Check trùng key chạy TRƯỚC transaction, cùng lý do.
 *
 * `timeout` 120s (mặc định Prisma 5s): ~200 key × 1 round-trip upsert, chạy từ
 * CI vào Supabase qua pooler thì 5s không đủ (cùng bài học seed-roles.ts KB-06).
 */
export async function syncPermissionRegistry(
  client: PrismaClient,
  decls: ModuleDecl[] = ALL_MODULE_DECLS,
): Promise<{ upserted: number; deactivated: number; total: number }> {
  // Key trùng → DuplicatePermissionKeyError ném ra TẠI ĐÂY, chưa mở transaction.
  const descriptors = collectDescriptors(decls);
  const rows = [...descriptors.values()];

  return client.$transaction(
    async (tx) => {
      for (const row of rows) {
        await tx.permissionDescriptor.upsert({
          where: { key: row.key },
          update: {
            module: row.module,
            action: row.action,
            scopable: row.scopable,
            sensitiveFields: row.sensitiveFields,
            description: row.description,
            isActive: true,
          },
          create: { ...row, isActive: true },
        });
      }
      // Vắng khỏi khai báo → tắt, không xoá.
      const { count: deactivated } = await tx.permissionDescriptor.updateMany({
        where: { key: { notIn: rows.map((r) => r.key) }, isActive: true },
        data: { isActive: false },
      });
      const total = await tx.permissionDescriptor.count();
      return { upserted: rows.length, deactivated, total };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

// Chạy trực tiếp: `pnpm db:seed:permissions` (tsx prisma/seed-permission-registry.ts)
if (process.argv[1]?.includes("seed-permission-registry")) {
  const db = new PrismaClient();
  syncPermissionRegistry(db)
    .then((result) => {
      console.log(
        `✅ Permission registry: upserted=${result.upserted} deactivated=${result.deactivated} total=${result.total}`,
      );
      const byModule = new Map<string, number>();
      for (const row of collectDescriptors(ALL_MODULE_DECLS).values()) {
        byModule.set(row.module, (byModule.get(row.module) ?? 0) + 1);
      }
      for (const [mod, n] of [...byModule].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        console.log(`   · ${mod}: ${n} permission`);
      }
    })
    .catch((e) => {
      console.error("❌ syncPermissionRegistry:", e);
      process.exitCode = 1;
    })
    .finally(() => void db.$disconnect());
}
