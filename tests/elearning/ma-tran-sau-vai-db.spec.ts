// @vitest-environment node
/**
 * [MV6-*] V9.4 P4 — MA TRẬN QUYỀN LÚC CHẠY của sáu vai trên Postgres THẬT: `buildActor` đọc `UserOrgRole` → `can()` cho MỌI khoá `elearning:*` và `onl:*`.
 *
 * Khác `permissions.test.ts` (đọc `ROLE_SEED`, không DB): ở đây quyền đi qua ĐÚNG đường mà trang/action dùng — `resolveActorUncached` + `can()` —
 * nên bắt được lỗi seed không vào DB, vai gắn sai đơn vị, `isSuperAdmin` không bật…
 *
 * Kỳ vọng suy từ `ROLE_SEED` (không gõ tay); riêng Marketing có thêm danh sách ÂM tường minh (không điểm thi, không PII, không chấm, không xuất, không cấp quyền, không phát hành)
 * và danh sách DƯƠNG (xem khoá online, xem báo cáo) — để "không có X" không đạt chỉ vì Marketing không có quyền gì cả.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE; dọn theo tiền tố `CI_SV_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { can } from "../../lib/auth/can";
import { ROLE_SEED } from "../../prisma/seed-roles";
import { RUN_DB_TESTS as RUN } from "../_helpers/db-gate";

const HOOK_TIMEOUT = 180_000;
const P = "CI_SV_";
// Mốc hiệu lực CỐ ĐỊNH trong quá khứ. Để mặc định `now()` thì Prisma điền giờ ngay lúc ghi, có thể đi TRƯỚC `new Date()`
// của `resolveActorUncached` ~1 ms (đo trên Windows) ⇒ vai VỪA TẠO bị lọc `effectiveFrom <= now` loại, MV6-01/02 đỏ ngẫu nhiên.
const HIEU_LUC_TU = new Date("2026-01-01T00:00:00Z");

type Nhan = "HOC_VIEN" | "DAO_TAO" | "QLCS_CS1" | "QLCS_CS2" | "KE_TOAN" | "MARKETING" | "QTTC";
const VAI: Record<Nhan, { role: "TEACHER" | "TRAINING" | "CENTER_MANAGER" | "ACCOUNTANT" | "MARKETING" | "SUPER_ADMIN"; roleDef: string; don: "HO" | "CS1" | "CS2" }> = {
  HOC_VIEN: { role: "TEACHER", roleDef: "TEACHER", don: "CS1" },
  DAO_TAO: { role: "TRAINING", roleDef: "TRAINING", don: "HO" },
  QLCS_CS1: { role: "CENTER_MANAGER", roleDef: "CENTER_MANAGER", don: "CS1" },
  QLCS_CS2: { role: "CENTER_MANAGER", roleDef: "CENTER_MANAGER", don: "CS2" },
  KE_TOAN: { role: "ACCOUNTANT", roleDef: "HO_ACCOUNTANT", don: "HO" },
  MARKETING: { role: "MARKETING", roleDef: "HO_MARKETING", don: "HO" },
  QTTC: { role: "SUPER_ADMIN", roleDef: "SUPER_ADMIN", don: "HO" },
};

const TAT_CA_KHOA = [...new Set(ROLE_SEED.flatMap((r) => r.perms.map((p) => p.action)).filter((a) => a.startsWith("elearning:") || a.startsWith("onl:")))].sort();
const theoSeed = (nhan: Nhan, quyen: string) => VAI[nhan].roleDef === "SUPER_ADMIN" || !!ROLE_SEED.find((r) => r.code === VAI[nhan].roleDef)?.perms.some((p) => p.action === quyen);

const actor = new Map<Nhan, Awaited<ReturnType<typeof resolveActorUncached>>>();

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

describe.skipIf(!RUN)("MV6 · ma trận quyền sáu vai lúc chạy (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    for (const [nhan, v] of Object.entries(VAI) as [Nhan, (typeof VAI)[Nhan]][]) {
      const u = await seedUser({ email: `${P}${nhan.toLowerCase()}@ci.test`, name: `${P}${nhan}`, role: v.role });
      const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: v.don }, select: { id: true } });
      const rd = await db.roleDef.findUniqueOrThrow({ where: { code: v.roleDef }, select: { id: true } });
      await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: rd.id, status: "ACTIVE", grantedById: u.id, effectiveFrom: HIEU_LUC_TU } });
      const a = await resolveActorUncached(u.id);
      if (!a) throw new Error(`không dựng được actor cho ${nhan}`);
      actor.set(nhan, a);
    }
  }, HOOK_TIMEOUT);
  afterAll(async () => {
    await cleanup();
    await disconnectDb();
  }, HOOK_TIMEOUT);

  it("[MV6-01] mọi khoá elearning:* và onl:* × 7 người: can() lúc chạy = ROLE_SEED (Quản trị tối cao = tất cả)", () => {
    expect(TAT_CA_KHOA.length, "phải có đủ khoá để phép đo có nghĩa").toBeGreaterThan(25);
    const lech: string[] = [];
    for (const nhan of Object.keys(VAI) as Nhan[]) {
      for (const q of TAT_CA_KHOA) {
        const that = can(actor.get(nhan)!, q);
        if (that !== theoSeed(nhan, q)) lech.push(`${nhan} ${q}: lúc chạy=${that} · seed=${theoSeed(nhan, q)}`);
      }
    }
    expect(lech).toEqual([]);
  });

  it("[MV6-02] Marketing: ÂM tường minh (điểm thi · PII · chấm · xuất · cấp quyền · phát hành · chứng nhận) + DƯƠNG đối chứng (xem khoá, xem báo cáo online)", () => {
    const mk = actor.get("MARKETING")!;
    const AM = [
      "elearning:exam:grade", "elearning:exam:unlock", "elearning:progress:view-all", "elearning:progress:view-team", "elearning:report:export",
      "elearning:certificate:issue", "elearning:certificate:revoke", "elearning:content:publish", "elearning:content:author", "elearning:assignment:create",
      "onl:student:view", "onl:student:pii", "onl:student:grant", "onl:student:revoke", "onl:assessment:manage", "onl:assessment:grade", "onl:certificate:issue", "onl:course:manage", "onl:course:release",
    ];
    for (const q of AM) {
      expect(TAT_CA_KHOA, `${q} phải là khoá có thật (không thì ca âm vô nghĩa)`).toContain(q);
      expect(can(mk, q), `Marketing KHÔNG được có ${q}`).toBe(false);
    }
    // DƯƠNG: Marketing có quyền đọc phù hợp — không thì danh sách ÂM trên đạt chỉ vì vai rỗng quyền.
    for (const q of ["onl:course:view", "onl:report:view", "elearning:portal:access", "elearning:progress:view-own"]) expect(can(mk, q), `Marketing phải có ${q}`).toBe(true);
    // đối chứng: Đào tạo có đúng những khoá ÂM kia (phép đo phân biệt được hai vai)
    const dt = actor.get("DAO_TAO")!;
    expect(can(dt, "elearning:exam:grade") && can(dt, "onl:student:pii") && can(dt, "onl:assessment:grade")).toBe(true);
  });

  it("[MV6-03] Kế toán và người học thuần: không điểm thi, không PII online, không xuất; Quản lý cơ sở: giao bài/xem đội/xuất báo cáo (cổng vai xuất + phạm vi cơ sở còn đứng sau) — không chấm, không chứng nhận", () => {
    for (const nhan of ["KE_TOAN", "HOC_VIEN"] as const) {
      const a = actor.get(nhan)!;
      for (const q of ["elearning:exam:grade", "elearning:progress:view-all", "elearning:report:export", "elearning:certificate:issue", "onl:student:pii", "onl:student:view", "onl:assessment:grade"]) {
        expect(can(a, q), `${nhan} KHÔNG được có ${q}`).toBe(false);
      }
    }
    for (const nhan of ["QLCS_CS1", "QLCS_CS2"] as const) {
      const a = actor.get(nhan)!;
      for (const q of ["elearning:exam:grade", "elearning:certificate:issue", "elearning:certificate:revoke", "onl:student:pii", "onl:course:release"]) {
        expect(can(a, q), `${nhan} KHÔNG được có ${q}`).toBe(false);
      }
      for (const q of ["elearning:assignment:create", "elearning:progress:view-team"]) expect(can(a, q), `${nhan} phải có ${q}`).toBe(true);
    }
  });

  it("[MV6-04] hai Quản lý cơ sở cùng quyền nhưng KHÁC cơ sở: tầm nhìn chỉ gồm cơ sở của mình (không thấy CS còn lại); người cấp Hội sở thấy toàn hệ thống (đối chứng dương)", () => {
    const a = actor.get("QLCS_CS1")!;
    const b = actor.get("QLCS_CS2")!;
    expect(a.isHoLevel, "QLCS không phải cấp Hội sở").toBe(false);
    expect(b.isHoLevel).toBe(false);
    expect(a.visibleCenterIds.length, "QLCS CS1 thấy đúng một cơ sở").toBe(1);
    expect(b.visibleCenterIds.length, "QLCS CS2 thấy đúng một cơ sở").toBe(1);
    expect(a.visibleCenterIds[0]).not.toBe(b.visibleCenterIds[0]);
    const dt = actor.get("DAO_TAO")!;
    expect(dt.isHoLevel || dt.visibleCenterIds.length >= 2, "người Hội sở thấy nhiều cơ sở").toBe(true);
  });
});
