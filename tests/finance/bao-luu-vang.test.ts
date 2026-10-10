// tests/finance/bao-luu-vang.test.ts — BUỔI VẮNG × khoảng bảo lưu (BR-09), trên POSTGRES THẬT. PHIÊN 4.
//
// Chạy:  pnpm test:finance-db
// "Các buổi trong khoảng bảo lưu không tính vắng, không trừ hạn mức bù" — kiểm ở BA nơi đọc: nhu cầu học bù (`createMakeupNeed`),
// danh sách buổi vắng (`getStudentAbsences`), chuyên cần (`attendanceSummary` + bản gộp `attendanceSummaryForEnrollments`).
// Mốc thời gian là độ lệch TƯƠNG ĐỐI từ đồng hồ thật (các hàm trên đọc `new Date()` bên trong, không tiêm `now` được).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createMakeupNeed } from "@/lib/makeup/service";
import { dongBoDongSauDiemDanh } from "@/lib/hoc-bu/dong-diem-danh";
import { getStudentAbsences } from "@/lib/students/progress";
import { attendanceSummary, attendanceSummaryForEnrollments } from "@/lib/attendance/summary";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

if (!RUN_DB_TESTS) console.warn(`[BL4-VG] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl4v-";
const CS = `${T}cs`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HV = `${T}hv`;
const HV2 = `${T}hv2`; // đối chứng: không có hồ sơ bảo lưu
const GD = `${T}gd`;
const GD2 = `${T}gd2`;
const NGAY = 86_400_000;
const bay = (n: number) => new Date(Date.now() - n * NGAY);

const S = { truoc: `${T}s-truoc`, trong: `${T}s-trong`, sau: `${T}s-sau`, tuongLai: `${T}s-tl` };

async function don() {
  await db.makeupNeed.deleteMany({ where: { studentId: { in: [HV, HV2] } } });
  await db.attendance.deleteMany({ where: { studentId: { in: [HV, HV2] } } });
  await db.studentReserve.deleteMany({ where: { studentId: { in: [HV, HV2] } } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.enrollment.deleteMany({ where: { id: { in: [GD, GD2] } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: [HV, HV2] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "CS BL4V", slug: CS, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Khoá BL4V", slug: KHOA, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp BL4V", courseId: KHOA, centerId: CS } });
  for (const [h, g] of [[HV, GD], [HV2, GD2]] as const) {
    await db.student.create({ data: { id: h, name: `HV ${h}`, centerId: CS } });
    await db.enrollment.create({ data: { id: g, studentId: h, classId: LOP, courseId: KHOA, status: "STUDYING", centerId: CS } });
  }
  // Hồ sơ đã duyệt, đã KẾT THÚC: khoảng [NOW-20d, NOW-5d). Buổi: trước (40d), trong (10d), sau (2d), tương lai (+5d).
  await db.studentReserve.create({
    data: { studentId: HV, enrollmentId: GD, reason: "fx", createdByName: "x", centerId: CS, status: "ENDED", isActive: false, approvedAt: bay(21), startedAt: bay(20), endedAt: bay(5) },
  });
  for (const [id, d] of [[S.truoc, bay(40)], [S.trong, bay(10)], [S.sau, bay(2)], [S.tuongLai, bay(-5)]] as const) {
    await db.classSession.create({ data: { id, classId: LOP, date: d, centerId: CS } });
  }
  // Cả hai học viên cùng vắng ba buổi đã qua.
  for (const h of [HV, HV2]) {
    for (const s of [S.truoc, S.trong, S.sau]) {
      await db.attendance.create({ data: { studentId: h, sessionId: s, status: "ABSENT", makeupStatus: "NEEDS_MAKEUP" } });
    }
  }
}

describe.skipIf(!RUN_DB_TESTS)("[BL4-VG] buổi vắng × bảo lưu theo quy chế", () => {
  beforeEach(dung);
  afterAll(don);

  it("[BL4-VG-01] createMakeupNeed: buổi TRONG khoảng ⇒ KHÔNG sinh nhu cầu bù (ok, boQuaVi); buổi trước/sau khoảng ⇒ sinh bình thường", async () => {
    const trong = await createMakeupNeed({ studentId: HV, missedSessionId: S.trong });
    expect(trong).toMatchObject({ ok: true, boQuaVi: "BAO_LUU" });
    expect(trong.id).toBeUndefined();
    expect(await db.makeupNeed.count({ where: { studentId: HV, missedSessionId: S.trong } })).toBe(0);

    for (const s of [S.truoc, S.sau]) {
      const r = await createMakeupNeed({ studentId: HV, missedSessionId: s });
      expect(r.ok && r.id, s).toBeTruthy();
    }
    // ĐỐI CHỨNG: học viên không bảo lưu vắng đúng buổi đó vẫn sinh nhu cầu bù.
    expect((await createMakeupNeed({ studentId: HV2, missedSessionId: S.trong })).id).toBeTruthy();
  });

  it("[BL4-VG-02] danh sách buổi vắng: buổi TRONG khoảng bị bỏ; học viên không bảo lưu giữ đủ 3", async () => {
    const hv = (await getStudentAbsences(HV)).map((a) => a.date.getTime()).sort();
    expect(hv).toHaveLength(2);
    const trong = (await db.classSession.findUniqueOrThrow({ where: { id: S.trong } })).date.getTime();
    expect(hv).not.toContain(trong);
    expect(await getStudentAbsences(HV2)).toHaveLength(3);
  });

  it("[BL4-VG-03] chuyên cần: vắng giảm 3→2 và MẪU SỐ (buổi đã diễn ra) giảm 3→2; học viên không bảo lưu giữ 3/3 — cả bản đơn lẻ lẫn bản gộp", async () => {
    const don1 = await attendanceSummary(GD);
    expect(don1).toMatchObject({ needMakeup: 2, daDienRa: 2 });
    const don2 = await attendanceSummary(GD2);
    expect(don2).toMatchObject({ needMakeup: 3, daDienRa: 3 });

    const gop = await attendanceSummaryForEnrollments([GD, GD2]);
    expect(gop.get(GD)).toEqual(don1); // hai đường tính PHẢI cho cùng một số
    expect(gop.get(GD2)).toEqual(don2);
  });

  it("[BL4-VG-04] đường nhanh: không ai có hồ sơ ⇒ kết quả y hệt trước Phiên 4 (3/3 cho cả hai)", async () => {
    await db.studentReserve.deleteMany({ where: { studentId: HV } });
    expect(await attendanceSummary(GD)).toMatchObject({ needMakeup: 3, daDienRa: 3 });
    const gop = await attendanceSummaryForEnrollments([GD, GD2]);
    expect(gop.get(GD)).toMatchObject({ needMakeup: 3, daDienRa: 3 });
    expect((await getStudentAbsences(HV)).length).toBe(3);
  });

  it("[BL4-VG-05] hồ sơ CŨ (không approvedAt) KHÔNG đổi gì: vẫn tính vắng như trước", async () => {
    await db.studentReserve.updateMany({ where: { studentId: HV }, data: { approvedAt: null } });
    expect(await attendanceSummary(GD)).toMatchObject({ needMakeup: 3, daDienRa: 3 });
    expect((await createMakeupNeed({ studentId: HV, missedSessionId: S.trong })).id).toBeTruthy();
  });
  it("[BL4-VG-06] ĐƯỜNG ĐIỂM DANH THẬT (`dongBoDongSauDiemDanh`, T05): buổi TRONG khoảng bảo lưu cũng KHÔNG sinh nhu cầu; học viên khác cùng buổi vẫn sinh", async () => {
    // Điểm danh thật đi qua `dongBoDongSauDiemDanh → taoDongHocBu`, KHÔNG qua `createMakeupNeed` — luật BR-09 phải che cả đường này.
    const bg = async (studentId: string) => {
      const a = await db.attendance.findFirstOrThrow({ where: { studentId, sessionId: S.trong }, select: { id: true } });
      return { studentId, attendanceId: a.id, status: "ABSENT" as const, makeupStatus: "NEEDS_MAKEUP" as const, makeupStatusTruoc: undefined, absenceReason: null };
    };
    const ghi = [await bg(HV), await bg(HV2)];
    const kq = await db.$transaction((tx) => dongBoDongSauDiemDanh(tx, { sessionId: S.trong, createdById: null, ghi }));
    expect(kq.tao).toBe(1); // chỉ HV2
    expect(await db.makeupNeed.count({ where: { studentId: HV, missedSessionId: S.trong } })).toBe(0);
    expect(await db.makeupNeed.count({ where: { studentId: HV2, missedSessionId: S.trong } })).toBe(1);
    // Buổi SAU khoảng: học viên bảo lưu vắng bình thường ⇒ sinh nhu cầu.
    const sau = await db.attendance.findFirstOrThrow({ where: { studentId: HV, sessionId: S.sau }, select: { id: true } });
    await db.$transaction((tx) =>
      dongBoDongSauDiemDanh(tx, {
        sessionId: S.sau,
        createdById: null,
        ghi: [{ studentId: HV, attendanceId: sau.id, status: "ABSENT", makeupStatus: "NEEDS_MAKEUP", makeupStatusTruoc: undefined, absenceReason: null }],
      }),
    );
    expect(await db.makeupNeed.count({ where: { studentId: HV, missedSessionId: S.sau } })).toBe(1);
  });
});
