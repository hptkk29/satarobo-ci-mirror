// tests/cham-cong/parttime-nen.spec.ts — Công Parttime SR.QD.238 · P1: ràng buộc DB trên Postgres THẬT.
// Thứ test thuần không chứng minh được: chỉ mục từng phần, trigger bất biến, khoá ngoại RESTRICT, CHECK, và chính
// sách đã thật sự nằm trong DB sau migration.
import { PrismaClient, Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { chinhSachTaiNgay, docThamSo } from "../../lib/parttime/chinh-sach";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-nen] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "pt-nen";
const ngay = new Date(Date.UTC(2026, 9, 20));

d("[PT1-DB] Công Parttime — ràng buộc DB", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });

  async function cleanup() {
    const pcs = await db.sessionStaffAssignment.findMany({ where: { sourceId: { startsWith: TAG } }, select: { id: true } });
    // Xác nhận bất biến ⇒ dọn bằng cách tắt trigger trong phiên test (chỉ DB test).
    if (pcs.length) {
      await db.$transaction([
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
        db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcs.map((p) => p.id) } } }),
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      ]);
    }
    await db.sessionStaffAssignment.deleteMany({ where: { sourceId: { startsWith: TAG } } });
    await db.teacherRankHistory.deleteMany({ where: { userId: { startsWith: TAG } } });
  }

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  const pc = (p: Partial<Prisma.SessionStaffAssignmentUncheckedCreateInput> = {}) =>
    db.sessionStaffAssignment.create({
      data: {
        sourceType: "CLASS_SESSION",
        sourceId: `${TAG}-s1`,
        centerId: `${TAG}-cs1`,
        ngay,
        gioBatDau: "18:00",
        gioKetThuc: "19:30",
        userId: `${TAG}-gv1`,
        role: "MAIN_TEACHER",
        activityType: "REGULAR_CLASS",
        ...p,
      },
    });

  it("[PT1-DB-01] chính sách LEGACY + SR.QD.238 có trong DB sau migration, tham số đọc được, ranh giới 14/15-10", async () => {
    const rows = await db.compensationPolicyVersion.findMany({ orderBy: { effectiveFrom: "asc" } });
    const ds = rows.map((r) => ({
      id: r.id,
      code: r.code,
      hieuLucTu: r.effectiveFrom.toISOString().slice(0, 10),
      hieuLucDen: r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : null,
      thamSo: docThamSo(r.paramsJson),
    }));
    expect(chinhSachTaiNgay(ds, "2026-10-14")?.code).toBe("LEGACY");
    expect(chinhSachTaiNgay(ds, "2026-10-15")?.code).toBe("SR.QD.238");
  });

  it("[PT1-DB-02] [24] tối đa MỘT GV đứng chính SỐNG mỗi buổi; phân công cũ REPLACED thì thêm người thay được", async () => {
    const a = await pc({ sourceId: `${TAG}-s2` });
    await expect(pc({ sourceId: `${TAG}-s2`, userId: `${TAG}-gv2` })).rejects.toMatchObject({ code: "P2002" });
    await db.sessionStaffAssignment.update({ where: { id: a.id }, data: { status: "REPLACED" } });
    const thay = await pc({ sourceId: `${TAG}-s2`, userId: `${TAG}-gv2`, assignmentType: "SUBSTITUTE", replacesAssignmentId: a.id });
    expect(thay.assignmentType).toBe("SUBSTITUTE");
  });

  it("[PT1-DB-03] một người một vai sống / buổi; lịch sử (DECLINED) được trùng; TA và MAIN là hai vai", async () => {
    await pc({ sourceId: `${TAG}-s3`, userId: `${TAG}-ta1`, role: "TEACHING_ASSISTANT" });
    await expect(pc({ sourceId: `${TAG}-s3`, userId: `${TAG}-ta1`, role: "TEACHING_ASSISTANT" })).rejects.toMatchObject({ code: "P2002" });
    const tuChoi = await pc({ sourceId: `${TAG}-s4`, userId: `${TAG}-gv3`, status: "DECLINED" });
    const tuChoi2 = await pc({ sourceId: `${TAG}-s4`, userId: `${TAG}-gv3`, status: "DECLINED" });
    expect(tuChoi.id).not.toBe(tuChoi2.id);
    await pc({ sourceId: `${TAG}-s4`, userId: `${TAG}-gv3` }); // MAIN sống đầu tiên của buổi s4
  });

  it("[PT1-DB-04] xác nhận nhận lớp BẤT BIẾN: UPDATE/DELETE bị DB chặn; một quyết định mỗi phiên bản", async () => {
    const a = await pc({ sourceId: `${TAG}-s5` });
    const x = await db.staffAssignmentAcceptance.create({
      data: {
        assignmentId: a.id,
        assignmentVersion: 1,
        userId: a.userId,
        decision: "ACCEPTED",
        roleSnapshot: "MAIN_TEACHER",
        scheduleSnapshot: { ngay: "2026-10-20", gioBatDau: "18:00", gioKetThuc: "19:30" },
        requestedAt: new Date(),
        centerId: a.centerId,
      },
    });
    await expect(db.staffAssignmentAcceptance.update({ where: { id: x.id }, data: { decisionNote: "sửa" } })).rejects.toThrow(/SAA_IMMUTABLE/);
    await expect(db.staffAssignmentAcceptance.delete({ where: { id: x.id } })).rejects.toThrow(/SAA_IMMUTABLE/);
    await expect(
      db.staffAssignmentAcceptance.create({
        data: {
          assignmentId: a.id,
          assignmentVersion: 1,
          userId: a.userId,
          decision: "DECLINED",
          roleSnapshot: "MAIN_TEACHER",
          scheduleSnapshot: {},
          requestedAt: new Date(),
          centerId: a.centerId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    // Phiên bản mới ⇒ được quyết định lại.
    await db.sessionStaffAssignment.update({ where: { id: a.id }, data: { assignmentVersion: 2, status: "WAITING_ACCEPTANCE" } });
    await db.staffAssignmentAcceptance.create({
      data: {
        assignmentId: a.id,
        assignmentVersion: 2,
        userId: a.userId,
        decision: "ACCEPTED",
        roleSnapshot: "MAIN_TEACHER",
        scheduleSnapshot: {},
        requestedAt: new Date(),
        centerId: a.centerId,
      },
    });
    // Phân công đã có xác nhận KHÔNG xoá được (RESTRICT) — dấu vết không mất theo.
    await expect(db.sessionStaffAssignment.delete({ where: { id: a.id } })).rejects.toThrow();
  });

  it("[PT1-DB-05] Rank chỉ 1–4; một người một mốc hiệu lực mỗi ngày", async () => {
    await expect(
      db.teacherRankHistory.create({ data: { userId: `${TAG}-gv1`, rank: 5, effectiveFrom: ngay, reason: "x" } }),
    ).rejects.toThrow();
    await db.teacherRankHistory.create({ data: { userId: `${TAG}-gv1`, rank: 1, effectiveFrom: ngay, reason: "mặc định" } });
    await expect(
      db.teacherRankHistory.create({ data: { userId: `${TAG}-gv1`, rank: 2, effectiveFrom: ngay, reason: "trùng ngày" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
