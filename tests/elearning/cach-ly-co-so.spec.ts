// @vitest-environment node
/**
 * EL-03 · AC3 — CÁCH LY CƠ SỞ CỦA `TrnEnrollment` trên Postgres THẬT (sáu góc đọc).
 *
 * Vì sao phải đo trên DB thật: mọi test đơn vị của khu truyền một `db` giả, nên không ca nào chứng minh được
 * rằng `scopedDb` thật sự lọc `TrnEnrollment` theo cơ sở — chỉ có kiểm tra CẤU TRÚC (model có trong
 * `SCOPED_MODELS`). Khai thiếu `getModelPrefixes()` hay `centerId` NULL là lỗi âm thầm: trang vẫn render, dữ
 * liệu cơ sở khác lộ ra. Đây là bộ duy nhất của khu hỏi thẳng câu "quản lý CS1 có thấy hồ sơ học của CS2 không".
 *
 * Sáu góc: danh sách · lấy một dòng theo id (IDOR) · lấy duy nhất theo id (IDOR) · đếm · gộp nhóm · lọc theo
 * người học. Cộng ĐỐI CHỨNG DƯƠNG (luật 11): quản lý CS1 THẤY dòng của CS1, và người cấp Hội sở thấy cả hai —
 * không thì "không thấy gì cả" cũng làm sáu góc xanh.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE; dọn theo tiền tố `CI_ELC_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { scopedDb } from "../../lib/db-scope";
import { RUN_DB_TESTS as RUN } from "../_helpers/db-gate";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_ELC_";

let F: {
  qlCs1: string;
  nguoiHo: string;
  e1: string;
  e2: string;
  a1: string;
  a2: string;
  hv1: string;
  hv2: string;
  cs1: string;
  cs2: string;
};

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnEnrollment.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { assignment: { title: { startsWith: P } } }] },
  });
  await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function gan(userId: string, orgUnitId: string, vai: string) {
  const rd = await db.roleDef.findUniqueOrThrow({ where: { code: vai }, select: { id: true } });
  await db.userOrgRole.create({
    data: { userId, orgUnitId, roleId: rd.id, status: "ACTIVE", grantedById: userId },
  });
}

describe.skipIf(!RUN)("EL-03 · cách ly cơ sở của TrnEnrollment (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const [ho, cs1, cs2] = await Promise.all(
      ["HO", "CS1", "CS2"].map((code) =>
        db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true, centerId: true } }),
      ),
    );

    const qlCs1 = await seedUser({ email: `${P}ql1@ci.test`, name: `${P}QL1`, role: "CENTER_MANAGER" });
    const nguoiHo = await seedUser({ email: `${P}ho@ci.test`, name: `${P}HO`, role: "TRAINING" });
    const hv1 = await seedUser({ email: `${P}hv1@ci.test`, name: `${P}HV1`, role: "TEACHER" });
    const hv2 = await seedUser({ email: `${P}hv2@ci.test`, name: `${P}HV2`, role: "TEACHER" });
    await gan(qlCs1.id, cs1.id, "CENTER_MANAGER");
    await gan(nguoiHo.id, ho.id, "TRAINING");

    const khoa = await db.trnCourse.create({
      data: {
        code: `${P}KHOA`,
        slug: `${P.toLowerCase()}khoa`,
        title: `${P}Khoá`,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });

    const giao = (cs: { id: string; centerId: string | null }, ten: string) =>
      db.trnAssignment.create({
        data: {
          title: `${P}${ten}`,
          contentType: "COURSE",
          contentId: khoa.id,
          audienceMode: "STATIC",
          status: "ACTIVE",
          allowLate: true,
          completionRuleJson: { kieu: "MOI_BAI_BAT_BUOC" },
          centerId: cs.centerId as string,
          orgUnitId: cs.id,
          createdByUserId: nguoiHo.id,
        },
        select: { id: true },
      });
    const [a1, a2] = [await giao(cs1, "CS1"), await giao(cs2, "CS2")];

    const han = new Date(Date.now() + 30 * 86_400_000);
    const ghiDanh = (userId: string, assignmentId: string, cs: { id: string; centerId: string | null }) =>
      db.trnEnrollment.create({
        data: {
          courseId: khoa.id,
          userId,
          assignmentId,
          cycle: 1,
          status: "NOT_STARTED",
          dueAt: han,
          dueAtOriginal: han,
          centerId: cs.centerId as string,
          orgUnitId: cs.id,
          source: "ASSIGNMENT",
          snapJobTitle: "Nhân viên",
        },
        select: { id: true },
      });
    const e1 = await ghiDanh(hv1.id, a1.id, cs1);
    const e2 = await ghiDanh(hv2.id, a2.id, cs2);

    F = {
      qlCs1: qlCs1.id,
      nguoiHo: nguoiHo.id,
      e1: e1.id,
      e2: e2.id,
      a1: a1.id,
      a2: a2.id,
      hv1: hv1.id,
      hv2: hv2.id,
      cs1: cs1.centerId as string,
      cs2: cs2.centerId as string,
    };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  const trongBoHai = () => ({ id: { in: [F.e1, F.e2] } });

  it(
    "[góc 1 · danh sách] quản lý CS1 chỉ thấy dòng của CS1",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      expect(a.isHoLevel).toBe(false);
      const ds = await scopedDb(a).trnEnrollment.findMany({ where: trongBoHai(), select: { id: true } });
      expect(ds.map((x) => x.id)).toEqual([F.e1]);
    },
    CASE_TIMEOUT,
  );

  it(
    "[góc 2 · findFirst theo id CS2] ⇒ null (IDOR)",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      expect(await scopedDb(a).trnEnrollment.findFirst({ where: { id: F.e2 }, select: { id: true } })).toBeNull();
    },
    CASE_TIMEOUT,
  );

  it(
    "[góc 3 · findUnique theo id CS2] ⇒ null (IDOR)",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      expect(await scopedDb(a).trnEnrollment.findUnique({ where: { id: F.e2 }, select: { id: true } })).toBeNull();
    },
    CASE_TIMEOUT,
  );

  it(
    "[góc 4 · đếm] chỉ đếm dòng CS1",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      expect(await scopedDb(a).trnEnrollment.count({ where: trongBoHai() })).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[góc 5 · gộp nhóm] groupBy không cộng dòng CS2 vào",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      const nhom = await scopedDb(a).trnEnrollment.groupBy({
        by: ["status"],
        where: trongBoHai(),
        _count: { _all: true },
      });
      expect(nhom.reduce((s, g) => s + g._count._all, 0)).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[góc 6 · lọc theo người học CS2] hỏi thẳng người học của CS2 ⇒ rỗng",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      expect(await scopedDb(a).trnEnrollment.findMany({ where: { userId: F.hv2 }, select: { id: true } })).toEqual([]);
    },
    CASE_TIMEOUT,
  );

  it(
    "[cùng cách ly cho lượt giao] TrnAssignment của CS2 vô hình với quản lý CS1",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      const ds = await scopedDb(a).trnAssignment.findMany({
        where: { id: { in: [F.a1, F.a2] } },
        select: { id: true },
      });
      expect(ds.map((x) => x.id)).toEqual([F.a1]);
    },
    CASE_TIMEOUT,
  );

  it(
    "[ĐỐI CHỨNG DƯƠNG] người cấp Hội sở thấy CẢ HAI cơ sở — không thì sáu góc trên xanh vì 'không thấy gì cả'",
    async () => {
      const a = await resolveActorUncached(F.nguoiHo);
      expect(a.isHoLevel).toBe(true);
      const ds = await scopedDb(a).trnEnrollment.findMany({ where: trongBoHai(), select: { id: true } });
      expect(ds.map((x) => x.id).sort()).toEqual([F.e1, F.e2].sort());
      expect(await scopedDb(a).trnEnrollment.findUnique({ where: { id: F.e2 }, select: { id: true } })).not.toBeNull();
    },
    CASE_TIMEOUT,
  );

  it(
    "[ĐỐI CHỨNG DƯƠNG] quản lý CS1 THẤY dòng của CS1 (fixture thật sự có dòng để thấy)",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      expect(await scopedDb(a).trnEnrollment.findUnique({ where: { id: F.e1 }, select: { id: true } })).not.toBeNull();
    },
    CASE_TIMEOUT,
  );
});
