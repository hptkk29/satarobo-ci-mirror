// @vitest-environment node
/**
 * F-01 — QUẢN LÝ CƠ SỞ mở được báo cáo R1, và CHỈ thấy người của cơ sở mình (Postgres thật).
 *
 * Bẫy đã đo (khảo sát 24/10): `TrnAssignment.centerId` là cơ sở của NGƯỜI TẠO lượt giao, còn lượt học mang cơ sở của NGƯỜI
 * HỌC. Lượt giao do Hội sở tạo cho nhiều cơ sở nằm ở cơ sở Hội sở — mở cổng quyền mà vẫn đọc `trnAssignment` qua `scopedDb`
 * thì quản lý CS1 thấy danh sách RỖNG và xuất file 404, tức G03 vẫn hỏng. Fixture cũ của `cach-ly-co-so.spec.ts` che lỗi này
 * vì không có lượt giao nào "do Hội sở tạo, có người ở cả hai cơ sở".
 *
 * Ca có ĐỐI CHỨNG DƯƠNG ở mỗi cặp âm tính (luật 11): "không thấy CS2" chỉ có nghĩa khi cùng người ĐÓ thấy CS1.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE; dọn theo tiền tố `CI_ELBC_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const h = vi.hoisted(() => ({ phien: null as null | { user: Record<string, unknown> } }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.phien }));
vi.mock("@/lib/auth/live-session", () => ({ requireLiveSession: async () => h.phien }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { scopedDb } from "../../lib/db-scope";
import { RUN_DB_TESTS as RUN } from "../_helpers/db-gate";
import {
  coSoCuaPhamVi,
  docLuotGiaoTrongTamNhin,
  loaiQuyenBaoCao,
  luotGiaoHienThiDuoc,
  whereCoSoHienThi,
} from "../../lib/elearning/report-scope";
import { traDongBaoCao } from "../../lib/elearning/report-query";
import { GET as xuatR1 } from "../../app/api/elearning/bao-cao-r1/route";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_ELBC_";

let F: {
  qlCs1: string;
  qlCs12: string;
  qlGrant: string;
  traHo: string;
  hv1: string;
  hv2: string;
  aHoCaHai: string; // Hội sở tạo, người ở CẢ HAI cơ sở
  aCs1: string;
  aCs2: string;
  aHoChiCs2: string; // Hội sở tạo, chỉ có người CS2
};

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnEnrollment.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { assignment: { title: { startsWith: P } } }] },
  });
  await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  // Chỉ xoá Center "HO" do CHÍNH bộ này dựng (slug riêng) — không đụng dữ liệu có sẵn.
  await db.center.deleteMany({ where: { slug: "ho-test-elbc", address: "CI_ELBC" } });
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

const phienCua = (userId: string, role: string) => ({
  user: { id: userId, role, roles: [role], name: `${P}x`, email: `${P}x@ci.test` },
});

async function xuat(a: string) {
  return xuatR1(new Request(`http://localhost/api/elearning/bao-cao-r1?assignmentId=${a}`) as never);
}

function tenTrongFile(buf: ArrayBuffer): string[] {
  const wb = XLSX.read(Buffer.from(buf), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["TuanThu"]!, { header: 1 });
  return rows.flat().filter((x): x is string => typeof x === "string" && x.startsWith(P));
}

describe.skipIf(!RUN)("F-01 · báo cáo R1 cho quản lý cơ sở (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    process.env.ELEARNING_ENABLED = "true";
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const [ho, cs1, cs2] = await Promise.all(
      ["HO", "CS1", "CS2"].map((code) =>
        db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true, centerId: true } }),
      ),
    );

    const qlCs1 = await seedUser({ email: `${P}ql1@ci.test`, name: `${P}QL1`, role: "CENTER_MANAGER" });
    const qlCs12 = await seedUser({ email: `${P}ql12@ci.test`, name: `${P}QL12`, role: "CENTER_MANAGER" });
    const qlGrant = await seedUser({ email: `${P}qlgrant@ci.test`, name: `${P}QLG`, role: "CENTER_MANAGER" });
    const traHo = await seedUser({ email: `${P}ho@ci.test`, name: `${P}HO`, role: "TRAINING" });
    const hv1 = await seedUser({ email: `${P}hv1@ci.test`, name: `${P}HV1`, role: "TEACHER" });
    const hv2 = await seedUser({ email: `${P}hv2@ci.test`, name: `${P}HV2`, role: "TEACHER" });
    await gan(qlCs1.id, cs1.id, "CENTER_MANAGER");
    await gan(qlCs12.id, cs1.id, "CENTER_MANAGER");
    await gan(qlCs12.id, cs2.id, "CENTER_MANAGER");
    await gan(qlGrant.id, cs1.id, "CENTER_MANAGER");
    // Grant cá nhân `elearning:*` ⇒ `scopedDb` nới thành MỌI cơ sở (db-scope getModelVisibleCenterIds). Đây là cái bẫy F-01 phải chịu được.
    await db.userPermissionGrant.create({
      data: { userId: qlGrant.id, action: ["elearning", "exam", "grade"].join(":"), grant: "ALLOW", grantedBy: qlGrant.id, reason: "CI_ELBC" },
    });
    await gan(traHo.id, ho.id, "TRAINING");

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
    // Lượt giao do Hội sở tạo neo về Center mã "HO" (`coSoCuaLuotGiao`) — đúng thứ đã gây lỗi: cơ sở của lượt giao ≠ cơ sở người học.
    const coSoHoCo = await db.center.findFirst({ where: { code: "HO" }, select: { id: true } });
    const coSoHo =
      coSoHoCo ??
      (await db.center.create({
        data: { code: "HO", name: "Hội sở (test)", slug: "ho-test-elbc", address: "CI_ELBC" },
        select: { id: true },
      }));
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
          centerId: cs.id === ho.id ? coSoHo.id : (cs.centerId as string),
          orgUnitId: cs.id,
          createdByUserId: traHo.id,
        },
        select: { id: true },
      });
    const aHoCaHai = await giao(ho, "HO_CA_HAI");
    const aCs1 = await giao(cs1, "CS1");
    const aCs2 = await giao(cs2, "CS2");
    const aHoChiCs2 = await giao(ho, "HO_CHI_CS2");

    const han = new Date(Date.now() + 30 * 86_400_000);
    let cycle = 0;
    const ghiDanh = (userId: string, assignmentId: string, cs: { id: string; centerId: string | null }) =>
      db.trnEnrollment.create({
        data: {
          courseId: khoa.id,
          userId,
          assignmentId,
          cycle: ++cycle,
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
    await ghiDanh(hv1.id, aHoCaHai.id, cs1);
    await ghiDanh(hv2.id, aHoCaHai.id, cs2);
    await ghiDanh(hv1.id, aCs1.id, cs1);
    await ghiDanh(hv2.id, aCs2.id, cs2);
    await ghiDanh(hv2.id, aHoChiCs2.id, cs2);

    F = {
      qlCs1: qlCs1.id,
      qlCs12: qlCs12.id,
      qlGrant: qlGrant.id,
      traHo: traHo.id,
      hv1: hv1.id,
      hv2: hv2.id,
      aHoCaHai: aHoCaHai.id,
      aCs1: aCs1.id,
      aCs2: aCs2.id,
      aHoChiCs2: aHoChiCs2.id,
    };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  const tatCa = () => [F.aHoCaHai, F.aCs1, F.aCs2, F.aHoChiCs2];
  const trongBon = (ds: { id: string }[]) => ds.map((x) => x.id).filter((i) => tatCa().includes(i)).sort();

  it(
    "[quyền] CENTER_MANAGER ⇒ TEAM · TRAINING ⇒ ALL · người học thuần ⇒ không có",
    async () => {
      expect(loaiQuyenBaoCao(await resolveActorUncached(F.qlCs1))).toBe("TEAM");
      expect(loaiQuyenBaoCao(await resolveActorUncached(F.traHo))).toBe("ALL");
      expect(loaiQuyenBaoCao(await resolveActorUncached(F.hv1))).toBeNull();
    },
    CASE_TIMEOUT,
  );

  it(
    "[danh sách] QLCS CS1 thấy lượt giao do Hội sở tạo CÓ người CS1 + lượt CS1; KHÔNG thấy lượt CS2 và lượt Hội sở chỉ có người CS2",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      const ds = await docLuotGiaoTrongTamNhin(scopedDb(a), "TEAM", coSoCuaPhamVi("TEAM", a));
      expect(trongBon(ds)).toEqual([F.aHoCaHai, F.aCs1].sort());
    },
    CASE_TIMEOUT,
  );

  it(
    "[ĐỐI CHỨNG DƯƠNG] Hội sở (ALL) thấy cả bốn lượt giao",
    async () => {
      const a = await resolveActorUncached(F.traHo);
      const ds = await docLuotGiaoTrongTamNhin(scopedDb(a), "ALL", coSoCuaPhamVi("ALL", a));
      expect(trongBon(ds)).toEqual(tatCa().sort());
    },
    CASE_TIMEOUT,
  );

  it(
    "[ĐỐI CHỨNG DƯƠNG] QLCS quản lý CS1+CS2 thấy cả bốn — phạm vi đi theo NƠI NEO VAI, không theo một mã cứng",
    async () => {
      const a = await resolveActorUncached(F.qlCs12);
      const ds = await docLuotGiaoTrongTamNhin(scopedDb(a), "TEAM", coSoCuaPhamVi("TEAM", a));
      expect(trongBon(ds)).toEqual(tatCa().sort());
    },
    CASE_TIMEOUT,
  );

  it(
    "[IDOR] lượt giao theo id: CS1 ⇒ có; CS2 ⇒ null; Hội sở-chỉ-CS2 ⇒ null; Hội sở-cả-hai ⇒ có",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      const sdb = scopedDb(a);
      const cs = coSoCuaPhamVi("TEAM", a);
      expect(await luotGiaoHienThiDuoc(sdb, "TEAM", cs, F.aCs1)).not.toBeNull();
      expect(await luotGiaoHienThiDuoc(sdb, "TEAM", cs, F.aHoCaHai)).not.toBeNull();
      expect(await luotGiaoHienThiDuoc(sdb, "TEAM", cs, F.aCs2)).toBeNull();
      expect(await luotGiaoHienThiDuoc(sdb, "TEAM", cs, F.aHoChiCs2)).toBeNull();
      expect(await luotGiaoHienThiDuoc(sdb, "TEAM", cs, "khong-ton-tai")).toBeNull();
    },
    CASE_TIMEOUT,
  );

  it(
    "[dòng báo cáo] cùng một lượt giao Hội sở: QLCS CS1 chỉ thấy người CS1, Hội sở thấy cả hai",
    async () => {
      const aQl = await resolveActorUncached(F.qlCs1);
      const ql = await traDongBaoCao(scopedDb(aQl), F.aHoCaHai, coSoCuaPhamVi("TEAM", aQl));
      expect(ql.map((r) => r.userId)).toEqual([F.hv1]);
      const aHo = await resolveActorUncached(F.traHo);
      const ho = await traDongBaoCao(scopedDb(aHo), F.aHoCaHai, coSoCuaPhamVi("ALL", aHo));
      expect(ho.map((r) => r.userId).sort()).toEqual([F.hv1, F.hv2].sort());
    },
    CASE_TIMEOUT,
  );

  it(
    "[XUẤT FILE] QLCS CS1 xuất lượt Hội sở-cả-hai ⇒ file chỉ có HV1; lượt CS2 và Hội sở-chỉ-CS2 ⇒ 404",
    async () => {
      h.phien = phienCua(F.qlCs1, "CENTER_MANAGER");
      const ok = await xuat(F.aHoCaHai);
      expect(ok.status).toBe(200);
      expect(tenTrongFile(await ok.arrayBuffer())).toEqual([`${P}HV1`]);
      expect((await xuat(F.aCs2)).status).toBe(404);
      expect((await xuat(F.aHoChiCs2)).status).toBe(404);
    },
    CASE_TIMEOUT,
  );

  it(
    "[ĐỐI CHỨNG DƯƠNG · XUẤT FILE] Hội sở xuất cùng lượt ⇒ file có CẢ HV1 và HV2",
    async () => {
      h.phien = phienCua(F.traHo, "TRAINING");
      const res = await xuat(F.aHoCaHai);
      expect(res.status).toBe(200);
      expect(tenTrongFile(await res.arrayBuffer()).sort()).toEqual([`${P}HV1`, `${P}HV2`]);
    },
    CASE_TIMEOUT,
  );

  it(
    "[GRANT CÁ NHÂN] QLCS CS1 có grant `elearning:*`: scopedDb bị NỚI (đối chứng — bẫy có thật) nhưng báo cáo VẪN chỉ CS1 (danh sách, dòng, IDOR, xuất file)",
    async () => {
      const a = await resolveActorUncached(F.qlGrant);
      // ĐỐI CHỨNG: không có phạm vi tường minh thì scopedDb của người này thấy cả CS2 — nếu không, ca này không chứng minh gì.
      const rong = await scopedDb(a).trnEnrollment.findMany({ where: { assignmentId: F.aCs2 }, select: { id: true } });
      expect(rong.length, "bẫy không còn: scopedDb không còn nới theo grant — xem lại giả định").toBeGreaterThan(0);

      expect(loaiQuyenBaoCao(a)).toBe("TEAM");
      const cs = coSoCuaPhamVi("TEAM", a);
      const ds = await docLuotGiaoTrongTamNhin(scopedDb(a), "TEAM", cs);
      expect(trongBon(ds)).toEqual([F.aHoCaHai, F.aCs1].sort());
      const dong = await traDongBaoCao(scopedDb(a), F.aHoCaHai, cs);
      expect(dong.map((r) => r.userId)).toEqual([F.hv1]);
      expect(await luotGiaoHienThiDuoc(scopedDb(a), "TEAM", cs, F.aCs2)).toBeNull();

      h.phien = phienCua(F.qlGrant, "CENTER_MANAGER");
      const ok = await xuat(F.aHoCaHai);
      expect(ok.status).toBe(200);
      expect(tenTrongFile(await ok.arrayBuffer())).toEqual([`${P}HV1`]);
      expect((await xuat(F.aCs2)).status).toBe(404);
    },
    CASE_TIMEOUT,
  );

  it("[F-02] whereCoSoHienThi: Hội sở/Quản trị thấy mọi cơ sở (undefined); còn lại giới hạn theo visibleCenterIds; rỗng ⇒ không cơ sở nào", () => {
    const ids = ["c1", "c2"];
    expect(whereCoSoHienThi({ isHoLevel: true, isSuperAdmin: false, visibleCenterIds: ids })).toBeUndefined();
    expect(whereCoSoHienThi({ isHoLevel: false, isSuperAdmin: true, visibleCenterIds: [] })).toBeUndefined();
    expect(whereCoSoHienThi({ isHoLevel: false, isSuperAdmin: false, visibleCenterIds: ids })).toEqual({ id: { in: ids } });
    expect(whereCoSoHienThi({ isHoLevel: false, isSuperAdmin: false, visibleCenterIds: [] })).toEqual({ id: { in: [] } });
  });

  it(
    "[XUẤT FILE] người không có quyền xem/xuất (giáo viên) ⇒ 403, không file",
    async () => {
      h.phien = phienCua(F.hv1, "TEACHER");
      expect((await xuat(F.aCs1)).status).toBe(403);
    },
    CASE_TIMEOUT,
  );
});
