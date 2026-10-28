// tests/hoc-bu/tu-xep.test.ts — GĐ5 phân công gộp: TỰ XẾP học bù cho người đang trực (chốt 2, 3, 11), Postgres THẬT.
// Case 15/10/2026 18:00–19:30 (ca T 17:15–21:00 của SR.QD.238). Mỗi ca tự dựng lại fixture (`dung`) ⇒ xanh khi chạy một mình (luật 18).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { duyetCase, taoCaseVaXep } from "@/lib/hoc-bu/case-db";
import { addTrialSession } from "@/lib/trial/service";
import type { PermEntry } from "@/lib/auth/actor";
import { nguoiHocBu, type NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { ADMIN, CS, GV, GV2, KHUNG, PHONG, QL, SALE, don, dung, luc, needId } from "./_case-nhieu-bai-fixture";

const bat = vi.hoisted(() => ({ tuXep: true }));
vi.mock("@/lib/settings/service", async (goc) => {
  const g = await goc<typeof import("@/lib/settings/service")>();
  return {
    ...g,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) => {
      if (/^shift\.parttime\w+Enabled$/.test(key)) return true;
      if (key === "shift.phanCongTuXepBuTrialBat") return bat.tuXep;
      return g.getSetting(key as never, opts);
    }) as typeof g.getSetting,
  };
});
vi.mock("@/lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("@/lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

if (!RUN_DB_TESTS) console.warn(`[TX] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NGAY = new Date(Date.UTC(2026, 9, 15));
const truc = (userId: string, ca: string) =>
  db.operationsDutyAssignment.create({ data: { userId, centerId: CS, workDate: NGAY, shiftCode: ca, policyVersionId: "cpv_sr_qd_238", nguonGiao: "TAY", status: "ACCEPTED" } });
const dungChinh = (caseId: string) =>
  db.sessionStaffAssignment.findMany({ where: { sourceType: "MAKEUP_CASE", sourceId: caseId, role: "MAIN_TEACHER", status: "ACCEPTED" }, select: { userId: true, nguonGiao: true } });
const taoCase = (teacherId: string) => taoCaseVaXep(ADMIN, { ...KHUNG, needIds: [needId("A", 5)], teacherId, coQuyenDuyet: true });

const perm = (action: string): PermEntry => ({ action, scopeType: "GLOBAL", orgUnitId: "org-test", roleCode: "CENTER_MANAGER", centerScope: [CS] });
/** Quản lý cơ sở THẬT (duyệt case chờ duyệt) — cùng khuôn `tests/hoc-bu/duyet-case.test.ts`. */
const QL_CS = {
  userId: QL,
  isSuperAdmin: false,
  isHoLevel: false,
  orgRoles: [],
  permissions: ["makeup:view", "makeup:view-all", "makeup:manage", "makeup:waive", "classes:view-all", "sessions:view", "rooms:view", "students:view-all", "enrollments:view-all", "hr_attendance:view"].map(perm),
  visibleCenterIds: [CS],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
  chiCuaSale: null,
} as unknown as NguoiHocBu;

async function donTrial() {
  const lop = (await db.trialClassV2.findMany({ where: { centerId: CS }, select: { id: true } })).map((l) => l.id);
  await db.trialClassSession.deleteMany({ where: { trialClassId: { in: lop } } });
  await db.trialClassV2.deleteMany({ where: { id: { in: lop } } });
  await db.trialCertificate.deleteMany({ where: { userId: { in: [GV, GV2] } } });
}

async function donPhanCong() {
  await donTrial();
  await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: [GV, GV2] } } });
  await db.operationsDutyAssignment.deleteMany({ where: { centerId: CS } });
  await db.auditLog.deleteMany({ where: { action: "PT_TU_XEP_DUONG_LUI" } });
  await db.staffNotification.deleteMany({ where: { dedupeKey: { startsWith: "phan-cong.tu-xep-duong-lui:" } } });
}

describe.skipIf(!RUN_DB_TESTS)("[TX] tự xếp học bù cho người đang trực — Postgres thật", () => {
  beforeEach(async () => {
    bat.tuXep = true;
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238");
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "SR.QD.238", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]!) },
    });
    await donPhanCong();
    await dung();
    await db.orgUnit.upsert({ where: { code: "fx-t07-ou" }, update: {}, create: { type: "CENTER", code: "fx-t07-ou", name: "ĐV T07", path: "/fx-t07-ou/", depth: 0, centerId: CS } });
  });
  afterAll(async () => {
    await donPhanCong();
    await don();
    await db.orgUnit.deleteMany({ where: { code: "fx-t07-ou" } });
  });

  it("[TX-01] người trực ca T được chọn ⇒ phân công đứng chính nguồn TU_XEP_BU_TRIAL + cột GV gốc khớp; đồng bộ sau commit KHÔNG đè", async () => {
    await truc(GV2, "T");
    const caseId = await taoCase(GV2);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).teacherId).toBe(GV2);
    expect(await dungChinh(caseId)).toEqual([{ userId: GV2, nguonGiao: "TU_XEP_BU_TRIAL" }]);
    expect(await db.auditLog.count({ where: { action: "PT_TU_XEP_DUONG_LUI", entityId: caseId } })).toBe(0);
  });

  it("[TX-02] có người tự xếp nhưng người thao tác chọn người KHÁC ⇒ lựa chọn tay: không dòng TU_XEP, đồng bộ dựng như cũ (DONG_BO)", async () => {
    await truc(GV2, "T");
    const caseId = await taoCase(GV);
    expect(await dungChinh(caseId)).toEqual([{ userId: GV, nguonGiao: "DONG_BO" }]);
  });

  it("[TX-03] KHÔNG ai trực (đường lùi, chốt 2) ⇒ case vẫn tạo bằng GV chọn tay, dấu nhật ký PT_TU_XEP_DUONG_LUI trên case + báo quản lý cơ sở", async () => {
    await db.user.create({ data: { id: QL, name: "QLCS tx", email: `${QL}@test.local`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
    await truc(GV2, "S"); // trực ca SÁNG — không phải ca của buổi
    const caseId = await taoCase(GV);
    expect(await dungChinh(caseId)).toEqual([{ userId: GV, nguonGiao: "DONG_BO" }]);
    expect(await db.auditLog.findFirst({ where: { action: "PT_TU_XEP_DUONG_LUI", entityId: caseId } })).toMatchObject({ newValues: expect.objectContaining({ lyDo: "KHONG_AI_TRUC", ca: "T" }) });
    expect(await db.staffNotification.count({ where: { dedupeKey: `phan-cong.tu-xep-duong-lui:MAKEUP_CASE:${caseId}` } })).toBeGreaterThan(0);
  });

  it("[TX-04] công tắc tự xếp TẮT (đối chứng) ⇒ người trực được chọn cũng chỉ là lựa chọn tay: không dòng TU_XEP, không dấu đường lùi", async () => {
    bat.tuXep = false;
    await truc(GV2, "T");
    const caseId = await taoCase(GV2);
    expect(await dungChinh(caseId)).toEqual([{ userId: GV2, nguonGiao: "DONG_BO" }]);
    expect(await db.auditLog.count({ where: { action: "PT_TU_XEP_DUONG_LUI" } })).toBe(0);
  });

  it("[TX-05] case CHỜ DUYỆT (Sale tạo) ⇒ chưa phân công gì; quản lý cơ sở duyệt với người trực ⇒ lúc đó mới ghi TU_XEP_BU_TRIAL", async () => {
    await db.user.create({ data: { id: SALE, name: "Sale tx", email: `${SALE}@test.local`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS } });
    await db.user.create({ data: { id: QL, name: "QLCS tx", email: `${QL}@test.local`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
    await truc(GV2, "T");
    const caseId = await taoCaseVaXep(nguoiHocBu({ ...ADMIN, userId: SALE }, null), { ...KHUNG, needIds: [needId("A", 5)], teacherId: GV, coQuyenDuyet: false });
    expect(await dungChinh(caseId)).toEqual([]);
    const v = (await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).version;
    await duyetCase(QL_CS, { caseId, phienBan: v, teacherId: GV2, ten: "QLCS", now: luc(14, 9, 0) });
    expect(await dungChinh(caseId)).toEqual([{ userId: GV2, nguonGiao: "TU_XEP_BU_TRIAL" }]);
  });

  it("[TX-06] TRIAL đòi CHỨNG NHẬN: người trực có chứng nhận ⇒ TU_XEP; người trực KHÔNG có ⇒ không tự xếp, dấu đường lùi KHONG_AI_CO_CHUNG_NHAN", async () => {
    await truc(GV2, "T");
    const l = await db.trialClassV2.create({ data: { code: "fx-t07-tc", name: "Trial T07", centerId: CS, sessionCount: 0, roomId: PHONG }, select: { id: true } });
    const them = () => addTrialSession({ trialClassId: l.id, date: NGAY, startTime: "18:00", endTime: "19:30", teacherId: GV2, actorId: GV });
    const khong = await them();
    expect(khong.ok).toBe(true);
    expect(await db.auditLog.findFirst({ where: { action: "PT_TU_XEP_DUONG_LUI", entityId: khong.sessionId! } })).toMatchObject({ newValues: expect.objectContaining({ lyDo: "KHONG_AI_CO_CHUNG_NHAN" }) });
    await db.trialCertificate.create({ data: { userId: GV2, effectiveFrom: new Date("2026-10-01T00:00:00Z"), issuedById: GV } });
    await db.trialClassSession.deleteMany({ where: { trialClassId: l.id } });
    await db.sessionStaffAssignment.deleteMany({ where: { sourceType: "TRIAL_SESSION" , userId: { in: [GV, GV2] } } });
    const co = await them();
    expect(await db.sessionStaffAssignment.findMany({ where: { sourceType: "TRIAL_SESSION", sourceId: co.sessionId!, role: "MAIN_TEACHER", status: "ACCEPTED" }, select: { userId: true, nguonGiao: true } })).toEqual([
      { userId: GV2, nguonGiao: "TU_XEP_BU_TRIAL" },
    ]);
  });
});
