// tests/finance/portal-tien-do-pham-vi.test.ts — [PVD] TIẾN ĐỘ CỔNG PHỤ HUYNH THEO PHẠM VI, trên POSTGRES THẬT (khu vực KV4 "portal-gv").
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts)
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (`fx-pv-`). Chạy được MỘT MÌNH (luật 18).
//
// Đi qua ĐÚNG ba hàm công khai mà trang Lịch học / Kết quả / trang chủ phụ huynh gọi (`getStudentProgressSummaries`,
// `getStudentAttendanceSummaries`, `getStudentSessions`) và `getStudentPhamVi` — không qua trang (trang cần phiên đăng nhập).
//
// Thứ test thuần KHÔNG chứng minh được:
//   1. cờ đọc THEO CƠ SỞ CỦA LỚP bằng CenterSetting thật, và TẮT ⇒ đường cũ BẰNG ĐÚNG số của hàm cũ (so với `getStudentClassProgress` /
//      `attendanceSummaryForEnrollments` chứ không so với con số gõ tay);
//   2. quyền học tra theo (học viên, khoá) và lọc theo cơ sở — hai con / hai khoá / hai cơ sở không lẫn;
//   3. số bài của buổi lấy từ plan.order+1 (cùng sổ cái điểm danh), bảo lưu vẫn bị loại khỏi chuyên cần.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import type { StudyEntitlement } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { tinhGiaTheoMoc } from "@/lib/pricing/tinh-gia-theo-moc";
import { capQuyenHoc, xepLop, type PhuThuoc } from "@/lib/entitlements/dich-vu";
import { nhanLyDo } from "@/lib/entitlements/roster";
import { attendanceSummaryForEnrollments } from "@/lib/attendance/summary";
import { getStudentClassProgress } from "@/lib/students/progress";
import {
  getStudentAttendanceSummaries,
  getStudentPhamVi,
  getStudentProgressSummaries,
  getStudentSessions,
} from "@/lib/portal/learning";

if (!RUN_DB_TESTS) console.warn(`[PVD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const T = "fx-pv-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU1 = `${T}ou1`;
const OU2 = `${T}ou2`;
const K1 = `${T}k1`;
const K2 = `${T}k2`;
const K3 = `${T}k3`;
const LOP = `${T}lop`; // K1 · CS1 · 20 buổi, bài 1..20 đều đã qua
const LOP2 = `${T}lop2`; // K1 · CS1 (lớp thứ hai CÙNG khoá)
const LOP_K2 = `${T}lop-k2`; // K2 · CS1
const LOP_X = `${T}lop-x`; // K3 · CS1 · có một buổi KHÔNG ghim giáo trình
const A = `${T}hv-a`;
const B = `${T}hv-b`;
const CU = `${T}hv-cu`; // không có quyền học nào
const C = `${T}hv-c`;
const NGUOI = { id: `${T}nguoi`, name: "Người thử cổng phụ huynh" };
const NOW = new Date("2026-10-19T03:00:00Z");
const NGAY = 24 * 3600 * 1000;
const BAT: PhuThuoc = { batChoCoSo: async () => true };
const SO_BAI = 20;

/** Bài b (1-based) của lớp diễn ra ở NOW + (b − 31) ngày ⇒ mọi buổi đều ở QUÁ KHỨ cả với đồng hồ thật lẫn `NOW`. */
const ngayBai = (b: number) => new Date(NOW.getTime() + (b - 31) * NGAY);
const buoi = (lop: string, b: number) => `${lop}-s${b}`;

async function don() {
  await db.studentReserve.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.attendance.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studyEntitlementUsage.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studyEntitlement.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: NGUOI.id }, { module: "entitlements", entityType: "StudyEntitlement", entityId: { startsWith: T } }] } });
  await db.centerSetting.deleteMany({ where: { orgUnitId: { in: [OU1, OU2] } } });
}

async function xoaHet() {
  await don();
  await db.enrollment.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.classSession.deleteMany({ where: { classId: { startsWith: T } } });
  await db.classSessionPlan.deleteMany({ where: { classId: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { startsWith: T } } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.course.deleteMany({ where: { id: { in: [K1, K2, K3] } } });
  await db.orgUnit.deleteMany({ where: { id: { in: [OU1, OU2] } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  clearSettingsCache();
}

async function dungLop(id: string, courseId: string, o: { khongGhimBai?: number; centerId?: string } = {}) {
  await db.class.create({ data: { id, name: id, courseId, centerId: o.centerId ?? CS1, status: "ACTIVE", maxStudents: 12 } });
  for (let b = 1; b <= SO_BAI; b++) {
    const khong = o.khongGhimBai === b;
    const plan = khong ? null : await db.classSessionPlan.create({ data: { id: `${id}-p${b}`, classId: id, seq: b, order: b - 1 } });
    await db.classSession.create({
      data: { id: buoi(id, b), classId: id, centerId: o.centerId ?? CS1, planId: plan?.id ?? null, date: ngayBai(b), status: "COMPLETED" },
    });
  }
}

async function ghiDanh(studentId: string, classId: string) {
  const lop = await db.class.findUniqueOrThrow({ where: { id: classId }, select: { courseId: true } });
  return db.enrollment.create({
    data: {
      id: `${T}gd-${studentId.slice(T.length)}-${classId.slice(T.length)}`,
      student: { connect: { id: studentId } },
      class: { connect: { id: classId } },
      course: { connect: { id: lop.courseId } },
      status: "STUDYING",
      centerId: CS1,
    },
  });
}

let dem = 0;
/** Quyền học 12 buổi của (học viên, khoá), xếp lớp ở bài `bai`. `consumed` đặt thẳng cột cache (đường ĐỌC không quan tâm ai ghi nó). */
async function capVaXep(studentId: string, o: { courseId: string; classId: string; centerId?: string; bai: number; consumed?: number }): Promise<StudyEntitlement> {
  const k = ++dem;
  const { quyenHoc } = await capQuyenHoc(
    {
      studentId,
      courseId: o.courseId,
      orderId: `${T}don-${k}`,
      orderItemId: `${T}dong-${k}`,
      centerId: o.centerId ?? CS1,
      gia: tinhGiaTheoMoc({ gia48: 10_560_000, soBuoi: 12, thuTuCon: 1 }),
      pricingSnapshot: { gia48: 10_560_000 },
      actor: NGUOI,
    },
    BAT,
  );
  const r = await xepLop({ entitlementId: quyenHoc.id, enrollmentId: `${T}gd-x-${k}`, classId: o.classId, baiKeTiepCuaLop: o.bai, actor: NGUOI, now: NOW }, BAT);
  if (o.consumed) await db.studyEntitlement.update({ where: { id: r.quyenHoc.id }, data: { consumedSessions: o.consumed } });
  return db.studyEntitlement.findUniqueOrThrow({ where: { id: r.quyenHoc.id } });
}

async function datCo(orgUnitId: string, bat: boolean) {
  await db.centerSetting.upsert({
    where: { orgUnitId_key: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } },
    create: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
    update: { valueJson: bat },
  });
  clearSettingsCache();
}

type St = "PRESENT" | "ABSENT_UNEXCUSED" | "ABSENT_EXCUSED";
async function diemDanh(studentId: string, classId: string, bai: number, status: St, makeupStatus: "NONE" | "NEEDS_MAKEUP" | "MADE_UP" = "NONE") {
  await db.attendance.create({ data: { sessionId: buoi(classId, bai), studentId, status, makeupStatus, centerId: CS1 } });
}

const hangTienDo = async (studentId: string, classId: string) => (await getStudentProgressSummaries(studentId, NOW)).find((r) => r.classId === classId)!;
const hangDiemDanh = async (studentId: string, classId: string) => (await getStudentAttendanceSummaries(studentId, NOW)).find((r) => r.classId === classId)!;
const hangBuoi = async (studentId: string, classId: string, bai: number) => (await getStudentSessions(studentId, NOW)).find((r) => r.id === buoi(classId, bai))!;

/** Số của ĐƯỜNG CŨ, đọc bằng chính hàm cũ — thước đo cho mọi ca "không đổi". */
async function soCu(studentId: string, classId: string) {
  const p = await getStudentClassProgress(studentId, classId);
  const gd = await db.enrollment.findFirstOrThrow({ where: { studentId, classId, deletedAt: null }, select: { id: true } });
  const tt = (await attendanceSummaryForEnrollments([gd.id])).get(gd.id)!;
  return { p, tt };
}

describe.skipIf(!RUN_DB_TESTS)("[PVD] cổng phụ huynh — tiến độ theo phạm vi (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await xoaHet();
  });
  beforeEach(async () => {
    await xoaHet();
    for (const id of [CS1, CS2]) await db.center.create({ data: { id, name: id, slug: id, address: "x" } });
    await db.orgUnit.create({ data: { id: OU1, code: "PVOU1", name: "OU1", type: "CENTER", centerId: CS1 } });
    await db.orgUnit.create({ data: { id: OU2, code: "PVOU2", name: "OU2", type: "CENTER", centerId: CS2 } });
    for (const id of [K1, K2, K3]) await db.course.create({ data: { id, name: id, slug: id, price: 10_560_000, totalSessions: 48 } });
    for (const id of [A, B, CU, C]) await db.student.create({ data: { id, name: id, centerId: CS1, status: "ACTIVE" } });
    await dungLop(LOP, K1);
    await dungLop(LOP2, K1);
    await dungLop(LOP_K2, K2);
    await dungLop(LOP_X, K3, { khongGhimBai: 7 });
    clearSettingsCache();
  });
  afterAll(xoaHet);

  // ═══ (c) CỜ BẬT + QUYỀN 12 BUỔI GIỮA KHOÁ ═══════════════════════════════════════════════════════════════════════════
  async function dungCaGiuaKhoa() {
    await ghiDanh(A, LOP);
    const e = await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
    expect([e.startLessonOrder, e.endLessonOrder, e.status]).toEqual([13, 24, "ACTIVE"]);
    await diemDanh(A, LOP, 5, "ABSENT_UNEXCUSED"); //   TRƯỚC phạm vi — không được thành 'vắng'
    await diemDanh(A, LOP, 14, "PRESENT");
    await diemDanh(A, LOP, 15, "PRESENT");
    await diemDanh(A, LOP, 16, "ABSENT_UNEXCUSED"); //  trong phạm vi, chưa bù
    await diemDanh(A, LOP, 17, "ABSENT_EXCUSED", "NEEDS_MAKEUP");
    await datCo(OU1, true);
    return e;
  }

  it("[PVD-01] cờ BẬT + quyền 13–24: thẻ tiến độ theo GÓI (12), chỉ bài 13–20 là 'đã diễn ra', vắng ở bài 5 không thành 'vắng'", async () => {
    await dungCaGiuaKhoa();
    const r = await hangTienDo(A, LOP);
    expect(r).toMatchObject({ total: 12, attended: 3, remaining: 9, currentSession: 9, theoPhamVi: true, hocVuot: 0 });
    const tt = await hangDiemDanh(A, LOP);
    // vắng: chỉ bài 16; chờ bù: bài 17; bài 5 (trước phạm vi) KHÔNG nằm ở đâu cả; mẫu số = 8 buổi trong phạm vi
    expect(tt).toMatchObject({ total: 12, daDienRa: 8, attended: 3, absent: 1, needMakeup: 1, madeUp: 0 });
    expect(tt.attended, "hai thẻ trên cùng màn hình cùng một 'đã học'").toBe(r.attended);
  });

  it("[PVD-02] lịch học: bài 5 vẫn HIỆN nhưng có nhãn 'ngoài phạm vi đăng ký' (một nguồn chữ), bài 14 không nhãn", async () => {
    await dungCaGiuaKhoa();
    const truoc = await hangBuoi(A, LOP, 5);
    expect(truoc).toMatchObject({ ngoaiPhamVi: true, nhanPhamVi: nhanLyDo("NGOAI_PHAM_VI", { start: 13, end: 24 }) });
    expect(truoc.nhanPhamVi).toMatch(/ngoài phạm vi đăng ký/i);
    expect(await hangBuoi(A, LOP, 14)).toMatchObject({ ngoaiPhamVi: false, nhanPhamVi: null });
    expect((await getStudentSessions(A, NOW)).filter((r) => r.className === LOP)).toHaveLength(SO_BAI); // không buổi nào bị ẩn
  });

  it("[PVD-03] trang Kết quả: 'Điểm danh x/y' cùng nguồn — qua getStudentPhamVi", async () => {
    await dungCaGiuaKhoa();
    const pv = (await getStudentPhamVi(A, [LOP], NOW)).get(LOP)!;
    expect(pv.quyenHoc).toHaveLength(1);
    expect([...pv.baiDenBayGio].sort((x, y) => x - y), "thứ tự dòng DB không được bảo đảm — so theo tập đã sắp").toEqual(Array.from({ length: SO_BAI }, (_, i) => i + 1));
    expect([...pv.baiVangKhongBu].sort((x, y) => x - y)).toEqual([5, 16, 17]);
  });

  // ═══ (a) CỜ TẮT ⇒ BẰNG ĐÚNG ĐƯỜNG CŨ ════════════════════════════════════════════════════════════════════════════════
  it("[PVD-04] cờ TẮT: thẻ tiến độ / chuyên cần BẰNG ĐÚNG số của hàm cũ; hàng buổi không thêm trường; Map phạm vi rỗng", async () => {
    await dungCaGiuaKhoa();
    await datCo(OU1, false);
    const cu = await soCu(A, LOP);
    expect(await hangTienDo(A, LOP)).toMatchObject({ total: cu.p.total, attended: cu.p.attended, remaining: cu.p.remaining, currentSession: cu.p.currentSession });
    expect(await hangTienDo(A, LOP)).not.toHaveProperty("theoPhamVi");
    expect(await hangDiemDanh(A, LOP)).toStrictEqual({ classId: LOP, className: LOP, courseName: K1, ...cu.tt });
    const buoi5 = await hangBuoi(A, LOP, 5);
    expect(buoi5).not.toHaveProperty("ngoaiPhamVi");
    expect(buoi5).not.toHaveProperty("nhanPhamVi");
    expect((await getStudentPhamVi(A, [LOP], NOW)).size).toBe(0);
    expect(cu.p.total, "đường cũ vẫn là mẫu số cả khoá").toBe(48);
  });

  it("[PVD-05] cờ chưa từng được đặt (mặc định) ⇒ cũng đường cũ", async () => {
    await dungCaGiuaKhoa();
    await db.centerSetting.deleteMany({ where: { orgUnitId: OU1 } });
    clearSettingsCache();
    expect((await getStudentPhamVi(A, [LOP], NOW)).size).toBe(0);
    expect((await hangTienDo(A, LOP)).total).toBe(48);
  });

  // ═══ (b) CỜ BẬT, KHÔNG CÓ QUYỀN HỌC ═════════════════════════════════════════════════════════════════════════════════
  it("[PVD-06] cờ BẬT nhưng bé KHÔNG có quyền học ⇒ bằng đúng đường cũ", async () => {
    await ghiDanh(CU, LOP);
    await datCo(OU1, true);
    await diemDanh(CU, LOP, 3, "PRESENT");
    const cu = await soCu(CU, LOP);
    expect(await hangTienDo(CU, LOP)).toMatchObject({ total: 48, attended: cu.p.attended, currentSession: cu.p.currentSession });
    expect(await hangDiemDanh(CU, LOP)).toStrictEqual({ classId: LOP, className: LOP, courseName: K1, ...cu.tt });
    expect(await hangBuoi(CU, LOP, 5)).not.toHaveProperty("nhanPhamVi");
  });

  it("[PVD-07] cờ BẬT, quyền học còn AWAITING_PLACEMENT / EXHAUSTED (không ACTIVE) ⇒ đường cũ", async () => {
    await ghiDanh(A, LOP);
    const e = await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 12 });
    await db.studyEntitlement.update({ where: { id: e.id }, data: { status: "EXHAUSTED" } });
    await datCo(OU1, true);
    expect((await getStudentPhamVi(A, [LOP], NOW)).size).toBe(0);
    expect((await hangTienDo(A, LOP)).total).toBe(48);
  });

  // ═══ (d) KHÔNG LẪN ═════════════════════════════════════════════════════════════════════════════════════════════════
  it("[PVD-08] HAI CON cùng lớp, hai quyền học khác nhau: mỗi con đọc quyền CỦA MÌNH, bài 5 'ngoài phạm vi' của con này nhưng 'trong phạm vi' của con kia", async () => {
    await ghiDanh(A, LOP);
    await ghiDanh(B, LOP);
    await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
    await capVaXep(B, { courseId: K1, classId: LOP, bai: 1, consumed: 7 });
    await datCo(OU1, true);
    expect(await hangTienDo(A, LOP)).toMatchObject({ total: 12, attended: 3 });
    expect(await hangTienDo(B, LOP)).toMatchObject({ total: 12, attended: 7, currentSession: 12 });
    expect((await hangBuoi(A, LOP, 5)).ngoaiPhamVi).toBe(true);
    expect((await hangBuoi(B, LOP, 5)).ngoaiPhamVi).toBe(false);
    expect((await hangDiemDanh(B, LOP)).daDienRa, "bé B: bài 1..12 đã diễn ra").toBe(12);
  });

  it("[PVD-09] MỘT CON HAI KHOÁ: mỗi lớp đọc quyền học của KHOÁ CỦA NÓ, không áp quyền khoá này lên lớp kia", async () => {
    await ghiDanh(A, LOP);
    await ghiDanh(A, LOP_K2);
    await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
    await capVaXep(A, { courseId: K2, classId: LOP_K2, bai: 1, consumed: 6 });
    await datCo(OU1, true);
    expect(await hangTienDo(A, LOP)).toMatchObject({ total: 12, attended: 3 });
    expect(await hangTienDo(A, LOP_K2)).toMatchObject({ total: 12, attended: 6 });
    expect((await hangBuoi(A, LOP, 5)).ngoaiPhamVi).toBe(true); //   K1: 13–24
    expect((await hangBuoi(A, LOP_K2, 5)).ngoaiPhamVi).toBe(false); // K2: 1–12
  });

  it("[PVD-10] quyền học của KHOÁ KHÁC không cứu một lớp không có quyền: bé có quyền K2 nhưng lớp K1 ⇒ lớp K1 giữ đường cũ", async () => {
    await ghiDanh(A, LOP);
    await capVaXep(A, { courseId: K2, classId: LOP_K2, bai: 1, consumed: 6 });
    await datCo(OU1, true);
    expect((await getStudentPhamVi(A, [LOP], NOW)).size).toBe(0);
    expect((await hangTienDo(A, LOP)).total).toBe(48);
  });

  it("[PVD-11] CƠ SỞ: cờ chỉ bật ở CS2 mà lớp thuộc CS1 ⇒ đường cũ; cờ bật ở CS1 mà quyền học thuộc CS2 ⇒ quyền bị lọc, đường cũ", async () => {
    await ghiDanh(A, LOP);
    await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
    await datCo(OU2, true);
    expect((await getStudentPhamVi(A, [LOP], NOW)).size).toBe(0);

    await datCo(OU1, true);
    expect((await getStudentPhamVi(A, [LOP], NOW)).size).toBe(1);
    await db.studyEntitlement.updateMany({ where: { studentId: A }, data: { centerId: CS2 } });
    const pv = (await getStudentPhamVi(A, [LOP], NOW)).get(LOP);
    expect(pv?.quyenHoc ?? []).toHaveLength(0);
    expect((await hangTienDo(A, LOP)).total).toBe(48);
  });

  it("[PVD-12] HAI LỚP CÙNG MỘT KHOÁ ⇒ không phân được quyền học cho lớp nào ⇒ cả hai giữ đường cũ", async () => {
    await ghiDanh(A, LOP);
    await ghiDanh(A, LOP2);
    await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
    await datCo(OU1, true);
    expect((await getStudentPhamVi(A, [LOP, LOP2], NOW)).size).toBe(0);
    expect((await hangTienDo(A, LOP)).total).toBe(48);
    expect((await hangTienDo(A, LOP2)).total).toBe(48);
  });

  it("[PVD-13] một buổi đã diễn ra CHƯA ghim giáo trình ⇒ lớp đó giữ đường cũ (không đếm thiếu lặng lẽ)", async () => {
    await ghiDanh(C, LOP_X);
    await capVaXep(C, { courseId: K3, classId: LOP_X, bai: 1, consumed: 2 });
    await datCo(OU1, true);
    const pv = (await getStudentPhamVi(C, [LOP_X], NOW)).get(LOP_X);
    expect(pv?.buoiKhongCoBai).toBeGreaterThan(0);
    expect((await hangTienDo(C, LOP_X)).total).toBe(48);
    expect(await hangBuoi(C, LOP_X, 3)).not.toHaveProperty("nhanPhamVi");
  });

  // ═══ (e) HỌC VƯỢT · MUA TIẾP · BẢO LƯU ═════════════════════════════════════════════════════════════════════════════
  it("[PVD-14] học vượt hiển thị RIÊNG (chỉ đếm dòng CATCH_UP còn hiệu lực) và nằm TRONG 'đã học'", async () => {
    await ghiDanh(A, LOP);
    const e = await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 5 });
    await db.studyEntitlementUsage.createMany({
      data: [
        { entitlementId: e.id, studentId: A, lessonOrder: 13, source: "CATCH_UP" },
        { entitlementId: e.id, studentId: A, lessonOrder: 14, source: "CATCH_UP" },
        { entitlementId: e.id, studentId: A, lessonOrder: 15, source: "CATCH_UP", voidedAt: NOW, voidReason: "sửa" },
        { entitlementId: e.id, studentId: A, lessonOrder: 16, source: "CLASS" },
      ],
    });
    await datCo(OU1, true);
    expect(await hangTienDo(A, LOP)).toMatchObject({ attended: 5, hocVuot: 2 });
    expect(await hangDiemDanh(A, LOP)).toMatchObject({ attended: 5, hocVuot: 2 });
  });

  it("[PVD-15] MUA TIẾP: COMPLETED 1–12 + ACTIVE 13–24 ⇒ tổng 24, bài 1–12 KHÔNG bị gắn 'ngoài phạm vi'", async () => {
    await ghiDanh(A, LOP);
    const cu = await capVaXep(A, { courseId: K1, classId: LOP, bai: 1, consumed: 12 });
    await db.studyEntitlement.update({ where: { id: cu.id }, data: { status: "COMPLETED" } });
    await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 2 });
    await datCo(OU1, true);
    expect(await hangTienDo(A, LOP)).toMatchObject({ total: 24, attended: 14, remaining: 10 });
    expect((await hangBuoi(A, LOP, 3)).ngoaiPhamVi).toBe(false);
    expect((await hangBuoi(A, LOP, SO_BAI)).ngoaiPhamVi).toBe(false); // bài 20 ∈ 13–24
  });

  it("[PVD-16] BẢO LƯU vẫn bị loại khỏi chuyên cần (mẫu số bỏ buổi trong khoảng bảo lưu; dòng điểm danh trong khoảng không tính vắng), nhưng 'đang học buổi X' giữ mốc cũ", async () => {
    await dungCaGiuaKhoa();
    const gd = await db.enrollment.findFirstOrThrow({ where: { studentId: A, classId: LOP }, select: { id: true } });
    await db.studentReserve.create({
      data: {
        studentId: A,
        enrollmentId: gd.id,
        reason: "thử",
        startedAt: new Date(ngayBai(16).getTime() - NGAY / 2),
        endedAt: new Date(ngayBai(17).getTime() + NGAY / 2),
        createdByName: "t",
        approvedAt: NOW,
        isActive: false,
        status: "ENDED",
      },
    });
    const tt = await hangDiemDanh(A, LOP);
    expect(tt).toMatchObject({ daDienRa: 6, absent: 0, needMakeup: 0 }); // 13,14,15,18,19,20
    expect((await hangTienDo(A, LOP)).currentSession, "thẻ 'đang học buổi' giữ mốc của hàm cũ (không lọc bảo lưu)").toBe(9);
  });
});
