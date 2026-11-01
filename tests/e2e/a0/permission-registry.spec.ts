/**
 * Nền Hệ thống P0 · US-01 — Registry quyền tập trung (TS-01, tầng integration).
 * Postgres LOCAL (.env.test) — resetDb() đã có guard assertTestDb.
 *
 * Điều được bảo vệ:
 *  - Seed nạp đủ khai báo tĩnh vào bảng `PermissionDescriptor` (AC1).
 *  - Chạy lại idempotent — không nhân đôi row.
 *  - Key trùng giữa 2 module → fail RÕ RÀNG + bảng giữ NGUYÊN TRẠNG (AC2, TS-01).
 *  - Key biến mất khỏi khai báo → isActive=false, KHÔNG DELETE (2-phase, không mất vết).
 *
 * Chạy nhanh (không cần dựng Next):
 *   A0_SKIP_WEBSERVER=1 pnpm test:e2e:a0 -- permission-registry
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import {
  ALL_MODULE_DECLS,
  collectDescriptors,
  DuplicatePermissionKeyError,
} from "../../../lib/permissions/registry";
import type { ModuleDecl } from "../../../lib/permissions/registry/types";
import { syncPermissionRegistry } from "../../../prisma/seed-permission-registry";

/** Key giả chắc chắn không đụng khai báo thật. */
const DUP_KEY = "zztest:trung-key";

/** Snapshot toàn bộ bảng, thứ tự ổn định — dùng so nguyên trạng trước/sau. */
async function snapshotTable() {
  return db.permissionDescriptor.findMany({ orderBy: { key: "asc" } });
}

test.describe("[US-01] syncPermissionRegistry — PermissionDescriptor (TS-01)", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[US-01-T1] sync lần 1 nạp đủ N row, đúng phân bổ theo module (AC1)", async () => {
    const descriptors = collectDescriptors(ALL_MODULE_DECLS);
    const n = descriptors.size;
    expect(n, "khai báo tĩnh phải có ít nhất 1 permission").toBeGreaterThan(0);

    const result = await syncPermissionRegistry(db);
    expect(result.upserted).toBe(n);
    expect(result.deactivated).toBe(0);

    const rows = await db.permissionDescriptor.findMany();
    expect(rows.length).toBe(n);

    // Từng row phải khớp descriptor gốc (module/action/scopable/sensitiveFields).
    for (const row of rows) {
      const d = descriptors.get(row.key);
      expect(d, `row "${row.key}" không có trong khai báo tĩnh`).toBeDefined();
      expect(row.module).toBe(d!.module);
      expect(row.action).toBe(d!.action);
      expect(row.scopable).toBe(d!.scopable);
      expect(row.sensitiveFields).toEqual(d!.sensitiveFields);
      expect(row.isActive).toBe(true);
    }

    // Phân bổ số quyền theo module đúng với khai báo.
    const expected = new Map<string, number>();
    for (const d of descriptors.values()) {
      expected.set(d.module, (expected.get(d.module) ?? 0) + 1);
    }
    const grouped = await db.permissionDescriptor.groupBy({
      by: ["module"],
      _count: { _all: true },
    });
    expect(grouped.length).toBe(expected.size);
    for (const g of grouped) {
      expect(g._count._all, `module "${g.module}" sai số quyền`).toBe(expected.get(g.module));
    }
  });

  test("[US-01-T2] sync lần 2 idempotent — count không đổi, không nhân đôi row", async () => {
    await syncPermissionRegistry(db);
    const before = await db.permissionDescriptor.findMany({
      orderBy: { key: "asc" },
      select: { key: true, module: true, isActive: true },
    });

    const result2 = await syncPermissionRegistry(db);
    expect(result2.deactivated).toBe(0);

    const after = await db.permissionDescriptor.findMany({
      orderBy: { key: "asc" },
      select: { key: true, module: true, isActive: true },
    });
    // updatedAt ĐƯỢC PHÉP đổi (không so ở đây) — nhưng tập key/module/isActive y hệt.
    expect(after).toEqual(before);
    // Không nhân đôi: mỗi key đúng 1 row.
    expect(new Set(after.map((r) => r.key)).size).toBe(after.length);
  });

  test("[US-01-T3] key trùng giữa 2 module → DuplicatePermissionKeyError, bảng NGUYÊN TRẠNG (AC2, TS-01)", async () => {
    await syncPermissionRegistry(db);
    const before = await snapshotTable();
    expect(before.length).toBeGreaterThan(0);

    // Hai module giả cùng khai một key — tái hiện đúng kịch bản TS-01.
    const bad: ModuleDecl[] = [
      ...ALL_MODULE_DECLS,
      { module: "zzmod-a", permissions: [{ key: DUP_KEY, action: "trung-key" }] },
      { module: "zzmod-b", permissions: [{ key: DUP_KEY, action: "trung-key" }] },
    ];

    let err: unknown;
    try {
      await syncPermissionRegistry(db, bad);
    } catch (e) {
      err = e;
    }
    expect(err, "sync với key trùng PHẢI throw").toBeInstanceOf(DuplicatePermissionKeyError);
    const msg = (err as Error).message;
    // Thông báo phải nêu rõ key + CẢ HAI module xung đột (AC2).
    expect(msg).toContain(DUP_KEY);
    expect(msg).toContain("zzmod-a");
    expect(msg).toContain("zzmod-b");

    // Nguyên trạng: check trùng chạy TRƯỚC transaction ⇒ không một row nào bị đụng
    // (kể cả updatedAt / isActive).
    const after = await snapshotTable();
    expect(after).toEqual(before);
  });

  test("[US-01-T4] key vắng khỏi khai báo → isActive=false, KHÔNG bị xoá", async () => {
    await syncPermissionRegistry(db);
    const n = (await db.permissionDescriptor.count());

    // Bỏ đúng 1 permission đầu tiên khỏi khai báo.
    const [victim] = collectDescriptors(ALL_MODULE_DECLS).keys();
    expect(victim).toBeDefined();
    const trimmed: ModuleDecl[] = ALL_MODULE_DECLS.map((m) => ({
      module: m.module,
      permissions: m.permissions.filter((p) => p.key !== victim),
    }));

    const result = await syncPermissionRegistry(db, trimmed);
    expect(result.deactivated).toBe(1);

    // Row vẫn còn (soft deactivate), chỉ tắt isActive.
    const row = await db.permissionDescriptor.findUnique({ where: { key: victim } });
    expect(row, `row "${victim}" bị XOÁ thay vì deactivate`).not.toBeNull();
    expect(row!.isActive).toBe(false);
    // Tổng số row không đổi — không DELETE.
    expect(await db.permissionDescriptor.count()).toBe(n);
    // Các key còn lại vẫn active.
    expect(await db.permissionDescriptor.count({ where: { isActive: true } })).toBe(n - 1);
  });
});
