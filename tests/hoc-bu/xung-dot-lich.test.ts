// tests/hoc-bu/xung-dot-lich.test.ts — T09: LÕI TRÙNG LỊCH đa nguồn trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
//
// Ba nguồn (lớp chính · lớp trial · case dạy bù) × ba chiều (giáo viên · phòng · học viên). Mỗi ca ghim một lỗ T09 (HB-28):
//   · lớp chính và lớp trial KHÔNG thấy MakeupCase;  case dạy bù KHÔNG kiểm gì khi xếp;
//   · chiều HỌC VIÊN chưa từng có ở bất kỳ module nào ngoài checker (đọc lại sau khi đã ghi).
// Các mốc dựng bằng `vnDateAt`; không đọc đồng hồ thật (luật 19).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { Actor } from "@/lib/auth/actor";
import type { NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { LoiTrungLich, kiemLichTrongTx, xepVaoCaseCoSan } from "@/lib/hoc-bu/case-db";
import { adjustSession, cancelSession } from "@/lib/classes/adjust";
import { kiemXungDotBuoiLop } from "@/lib/classes/xung-dot-buoi";
import { trialTrungHocBu } from "@/lib/trial/xung-dot-hoc-bu";
import {
  checkScheduleConflicts,
  detectBatchConflicts,
  detectSessionConflicts,
  dungThongDiepXungDot,
  khoaLichTrongTx,
  layHocVienDangHocCuaLop,
} from "@/lib/lms/schedule-conflict";
import { layLichBanGiaoVien } from "@/app/(admin)/admin/lop-trial/_lib/queries";
import { vnDateAt, vnYmd } from "@/lib/time/vn";

if (!RUN_DB_TESTS) console.warn(`[XDD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-t09-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const KHOA = id("khoa");
const CUR = id("cur");
const BAI1 = id("bai1");
const BAI2 = id("bai2");
const GVA = id("gv-a"); // dạy lớp 6A
const GVB = id("gv-b"); // dạy lớp 7B
const GVC = id("gv-c"); // dạy buổi trial
const GVX = id("gv-x"); // GV của case dùng để xếp (không đụng ai)
const R1 = id("r1");
const R2 = id("r2");
const R3 = id("r3");
const LOP_A = id("lop-a");
const LOP_B = id("lop-b");
const LOP_F = id("lop-f");
const HVA = id("hv-a"); // học lớp 6A — bận 15/10 18:00–19:30
const HVB = id("hv-b"); // không lịch nào
const HVC = id("hv-c"); // học lớp 7B — chỉ bận 18/10
const HVT = id("hv-t"); // có ghi danh trial 15/10 18:00–19:30
const HVF = id("hv-f"); // bé tự do (lớp F không có buổi nào ngày 15/10)
const ADMIN = {
  userId: GVA,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
  chiCuaSale: null, // T10: phạm vi Sale — null = thấy hết trong tầm nhìn cơ sở
} as unknown as NguoiHocBu;

/** Giờ VN của ngày d/10/2026. */
const t = (d: number, h: number, mi = 0) => vnDateAt(2026, 9, d, h, mi);
const ngayDb = (d: number) => new Date(`2026-10-${String(d).padStart(2, "0")}T00:00:00.000Z`);

async function don() {
  const needs = await db.makeupNeed.findMany({ where: { studentId: { startsWith: T } }, select: { id: true } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { in: needs.map((n) => `makeup.requested:${n.id}`) } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.makeupCase.deleteMany({ where: { centerId: CS } });
  await db.makeupNeed.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.makeupCreditAccount.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.trialEnrollment.deleteMany({ where: { trialClass: { centerId: CS } } });
  await db.trialClassV2.deleteMany({ where: { centerId: CS } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.leadChild.deleteMany({ where: { lead: { parentName: `${T}ph` } } });
  await db.lead.deleteMany({ where: { parentName: `${T}ph` } });
  await db.classSession.deleteMany({ where: { classId: { in: [LOP_A, LOP_B, LOP_F] } } });
  await db.enrollment.deleteMany({ where: { classId: { in: [LOP_A, LOP_B, LOP_F] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP_A, LOP_B, LOP_F] } } });
  await db.lesson.deleteMany({ where: { id: { in: [BAI1, BAI2] } } });
  await db.curriculum.deleteMany({ where: { id: CUR } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.room.deleteMany({ where: { id: { in: [R1, R2, R3] } } });
  await db.user.deleteMany({ where: { id: { in: [GVA, GVB, GVC, GVX] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

/**
 * Thế giới 15/10/2026:
 *   · lớp 6A  GV-A · R1 · buổi 15/10 18:00–19:30 (+ một buổi 16/10 ĐÃ HUỶ); HV-A học lớp này
 *   · lớp 7B  GV-B · R2 · buổi 18/10 18:00–19:30; HV-C học lớp này
 *   · trial   GV-C · R3 · buổi 15/10 18:00–19:30; HV-T (qua Student.leadChildId) ghi danh ACTIVE vào ĐÚNG buổi đó
 *   · lớp F   không buổi nào ngày 15/10; HV-F học lớp này. HV-A và HV-F mỗi bé một dòng cần bù (cùng bài) ở buổi vắng 10/10.
 */
async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở T09", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  for (const [u, ten] of [[GVA, "GV A"], [GVB, "GV B"], [GVC, "GV C"], [GVX, "GV X"]] as const) {
    await db.user.create({ data: { id: u, name: ten, email: `${u}@test.local`, role: "TEACHER", roles: ["TEACHER"], centerId: CS } });
  }
  for (const [r, ten] of [[R1, "R01"], [R2, "R02"], [R3, "R03"]] as const) {
    await db.room.create({ data: { id: r, code: `${T}${ten}`, name: ten, centerId: CS } });
  }
  await db.course.create({ data: { id: KHOA, name: "Khoá T09", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "GT T09" } });
  await db.lesson.create({ data: { id: BAI1, curriculumId: CUR, order: 1, title: "Bài 1", moduleCode: "M1" } });
  await db.lesson.create({ data: { id: BAI2, curriculumId: CUR, order: 2, title: "Bài 2", moduleCode: "M2" } });
  const lop = (lid: string, ten: string, gv: string | null, phong: string | null) => ({
    id: lid, name: ten, courseId: KHOA, centerId: CS, status: "ACTIVE" as const, startTime: "18:00", endTime: "19:30", teacherId: gv, roomId: phong,
  });
  await db.class.create({ data: lop(LOP_A, "Robotics 6A", GVA, R1) });
  await db.class.create({ data: lop(LOP_B, "Robotics 7B", GVB, R2) });
  await db.class.create({ data: lop(LOP_F, "Robotics F", null, null) });
  const buoi = (sid: string, lop: string, date: Date, status: "SCHEDULED" | "CANCELLED" | "COMPLETED" = "SCHEDULED") => ({
    id: sid, classId: lop, date, lessonId: BAI1, status, centerId: CS,
  });
  await db.classSession.createMany({
    data: [
      buoi(id("sa-15"), LOP_A, t(15, 18)),
      buoi(id("sa-16-huy"), LOP_A, t(16, 18), "CANCELLED"),
      buoi(id("sb-18"), LOP_B, t(18, 18)),
      buoi(id("sa-10"), LOP_A, t(10, 18), "COMPLETED"), // buổi vắng của HV-A
      buoi(id("sf-10"), LOP_F, t(10, 18), "COMPLETED"), // buổi vắng của HV-F
    ],
  });
  for (const [hv, ten, lopId] of [[HVA, "Nguyễn A", LOP_A], [HVB, "Nguyễn B", null], [HVC, "Nguyễn C", LOP_B], [HVF, "Nguyễn F", LOP_F]] as const) {
    await db.student.create({ data: { id: hv, name: ten, centerId: CS } });
    if (lopId) await db.enrollment.create({ data: { id: id(`gd-${hv}`), studentId: hv, classId: lopId, courseId: KHOA, status: "ACTIVE" } });
  }
  // Trial: lead → đứa trẻ → học viên nối về đứa trẻ → ghi danh ACTIVE vào ĐÚNG buổi 15/10.
  const lead = await db.lead.create({ data: { parentName: `${T}ph`, phone: "0900000009" } });
  const tre = await db.leadChild.create({ data: { leadId: lead.id, fullName: "Bé Trial" } });
  await db.student.create({ data: { id: HVT, name: "Nguyễn T", centerId: CS, leadChildId: tre.id } });
  const tc = await db.trialClassV2.create({ data: { id: id("trial"), code: `${T}trial`, name: "Trial Sata 1", centerId: CS, sessionCount: 1 } });
  const ts = await db.trialClassSession.create({
    data: { id: id("ts-15"), trialClassId: tc.id, seq: 1, date: ngayDb(15), startTime: "18:00", endTime: "19:30", teacherId: GVC, roomId: R3, status: "SCHEDULED" },
  });
  await db.trialEnrollment.create({ data: { trialClassId: tc.id, leadChildId: tre.id, status: "ACTIVE", scheduledSessionId: ts.id } });
  // Dòng cần bù: HV-A (buổi vắng 10/10 lớp A) và HV-F (buổi vắng 10/10 lớp F), cùng bài 1.
  await db.makeupNeed.createMany({
    data: [
      { id: id("need-a"), studentId: HVA, classId: LOP_A, centerId: CS, courseId: KHOA, sourceType: "ABSENCE", missedSessionId: id("sa-10"), missedLessonId: BAI1, status: "PENDING" },
      { id: id("need-f"), studentId: HVF, classId: LOP_F, centerId: CS, courseId: KHOA, sourceType: "ABSENCE", missedSessionId: id("sf-10"), missedLessonId: BAI1, status: "PENDING" },
    ],
  });
}

/** Tạo một case dạy bù (giờ VN) — mặc định 15/10 18:00–19:30, GV-X, không phòng. */
async function taoCase(p: { id: string; gv?: string | null; phong?: string | null; ngay?: number; tu?: string; den?: string; status?: "SCHEDULED" | "CANCELLED" | "COMPLETED"; hocVien?: { hv: string; status?: "PLACED" | "PRESENT" | "ABSENT" }[] }) {
  await db.makeupCase.create({
    data: {
      id: p.id, centerId: CS, courseId: KHOA, lessonId: BAI1, date: ngayDb(p.ngay ?? 15), startTime: p.tu ?? "18:00", endTime: p.den ?? "19:30",
      teacherId: p.gv === undefined ? GVX : (p.gv as string), roomId: p.phong ?? null, status: p.status ?? "SCHEDULED", createdById: GVA,
    },
  });
  for (const h of p.hocVien ?? []) {
    const nid = id(`n-${p.id}-${h.hv}`);
    await db.makeupNeed.create({
      data: { id: nid, studentId: h.hv, classId: LOP_F, centerId: CS, courseId: KHOA, sourceType: "MANUAL", missedSessionId: id("sf-10"), missedLessonId: BAI1, status: "SCHEDULED" },
    }).catch(async () => {
      // HV đã có dòng ở buổi này (unique học viên×buổi gốc) — lấy dòng đó.
    });
    const dong = await db.makeupNeed.findFirst({ where: { studentId: h.hv, missedSessionId: id("sf-10") } });
    const need = dong ?? (await db.makeupNeed.findFirstOrThrow({ where: { studentId: h.hv } }));
    await db.makeupCaseStudent.create({
      data: { caseId: p.id, makeupNeedId: need.id, status: h.status ?? "PLACED", dungLuot: false, centerId: CS, addedById: GVA },
    });
  }
}

const NGAY15 = (tu: string, den: string) => ({ ymd: "2026-10-15", startTime: tu, endTime: den });
const kiem = (p: Omit<Parameters<typeof checkScheduleConflicts>[0], "khung"> & { tu?: string; den?: string }) =>
  checkScheduleConflicts({ ...p, khung: NGAY15(p.tu ?? "18:30", p.den ?? "20:00") });
const ids = (xs: { nguon: string; id: string }[]) => xs.map((x) => `${x.nguon}:${x.id}`).sort();
const bat = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};

describe.skipIf(!RUN_DB_TESTS)("[XDD] lõi trùng lịch đa nguồn — T09", () => {
  beforeEach(dung);
  afterAll(don);

  // ── biên ──────────────────────────────────────────────────────────────────────────────
  it("[XDD-01] BIÊN trên dữ liệu thật: lớp 18:00–19:30 và case 19:30–20:30 KHÔNG trùng; 19:29 thì TRÙNG", async () => {
    expect((await kiem({ teacherId: GVA, tu: "19:30", den: "20:30" })).coXungDot).toBe(false);
    expect((await kiem({ teacherId: GVA, tu: "19:29", den: "20:30" })).teacherConflicts).toHaveLength(1);
    expect((await kiem({ teacherId: GVA, tu: "17:00", den: "18:00" })).coXungDot).toBe(false);
    expect((await kiem({ teacherId: GVA, tu: "17:00", den: "18:01" })).coXungDot).toBe(true);
  });

  // ── giáo viên ─────────────────────────────────────────────────────────────────────────
  it("[XDD-02] GV: Class ↔ Makeup — GV-A đang dạy lớp 6A 18:00–19:30, xếp case 18:30–20:00 ⇒ TRÙNG, kèm dữ liệu cấu trúc", async () => {
    const kq = await kiem({ teacherId: GVA });
    expect(kq.teacherConflicts).toHaveLength(1);
    expect(kq.teacherConflicts[0]).toMatchObject({ nguon: "CLASS_SESSION", id: id("sa-15"), tieuDe: "Robotics 6A", teacherId: GVA, roomId: R1, classId: LOP_A, centerId: CS });
    expect(kq.teacherConflicts[0]!.startAt.getTime()).toBe(t(15, 18).getTime());
    expect(kq.teacherConflicts[0]!.endAt.getTime()).toBe(t(15, 19, 30).getTime());
    expect(await dungThongDiepXungDot(kq)).toEqual(["GV GV A đang có lớp Robotics 6A từ 18:00–19:30."]);
  });

  it("[XDD-03] GV: Trial ↔ Makeup — GV-C có buổi trial 18:00–19:30 ⇒ TRÙNG", async () => {
    const kq = await kiem({ teacherId: GVC });
    expect(ids(kq.teacherConflicts)).toEqual([`TRIAL_CLASS_SESSION:${id("ts-15")}`]);
    expect(kq.teacherConflicts[0]!.tieuDe).toBe("Trial Sata 1");
  });

  it("[XDD-04] GV: Makeup ↔ Makeup — case đã có của GV-X ⇒ case thứ hai chồng giờ bị TRÙNG", async () => {
    await taoCase({ id: id("case-1") });
    expect(ids((await kiem({ teacherId: GVX })).teacherConflicts)).toEqual([`MAKEUP_CASE:${id("case-1")}`]);
  });

  // ── phòng ─────────────────────────────────────────────────────────────────────────────
  it("[XDD-05] PHÒNG: Class ↔ Makeup (R01 đang dùng bởi lớp 6A)", async () => {
    expect(ids((await kiem({ roomId: R1 })).roomConflicts)).toEqual([`CLASS_SESSION:${id("sa-15")}`]);
  });
  it("[XDD-06] PHÒNG: Trial ↔ Makeup (R03 của buổi trial)", async () => {
    expect(ids((await kiem({ roomId: R3 })).roomConflicts)).toEqual([`TRIAL_CLASS_SESSION:${id("ts-15")}`]);
  });
  it("[XDD-07] PHÒNG: Makeup ↔ Makeup", async () => {
    await taoCase({ id: id("case-2"), phong: R2, gv: GVX });
    expect(ids((await kiem({ roomId: R2 })).roomConflicts)).toEqual([`MAKEUP_CASE:${id("case-2")}`]);
  });

  // ── học viên ──────────────────────────────────────────────────────────────────────────
  it("[XDD-08] HỌC VIÊN: Class ↔ Makeup — Nguyễn A đang có lớp 6A 18:00–19:30 ⇒ TRÙNG, nói đúng tên + lớp", async () => {
    const kq = await kiem({ studentIds: [HVA] });
    expect(kq.studentConflicts).toHaveLength(1);
    expect(kq.studentConflicts[0]).toMatchObject({ studentId: HVA });
    expect(ids(kq.studentConflicts[0]!.xungDot)).toEqual([`CLASS_SESSION:${id("sa-15")}`]);
    expect(await dungThongDiepXungDot(kq)).toEqual(["Học viên Nguyễn A đang có lịch học lớp Robotics 6A từ 18:00–19:30."]);
  });

  it("[XDD-09] HỌC VIÊN: Trial ↔ Makeup — bé có ghi danh trial ACTIVE vào buổi 15/10 (qua Student.leadChildId) ⇒ TRÙNG; ghi danh WITHDRAWN thì KHÔNG", async () => {
    expect(ids((await kiem({ studentIds: [HVT] })).studentConflicts.flatMap((h) => h.xungDot))).toEqual([`TRIAL_CLASS_SESSION:${id("ts-15")}`]);
    await db.trialEnrollment.updateMany({ where: { trialClass: { centerId: CS } }, data: { status: "WITHDRAWN" } });
    expect((await kiem({ studentIds: [HVT] })).coXungDot).toBe(false);
  });

  it("[XDD-10] HỌC VIÊN: Makeup ↔ Makeup — bé đang PLACED/PRESENT ở case khác cùng giờ ⇒ TRÙNG; ABSENT (đã không tới) thì KHÔNG", async () => {
    await taoCase({ id: id("case-3"), hocVien: [{ hv: HVB }] });
    expect(ids((await kiem({ studentIds: [HVB] })).studentConflicts.flatMap((h) => h.xungDot))).toEqual([`MAKEUP_CASE:${id("case-3")}`]);
    await db.makeupCaseStudent.updateMany({ where: { caseId: id("case-3") }, data: { status: "PRESENT" } });
    expect((await kiem({ studentIds: [HVB] })).studentConflicts).toHaveLength(1);
    await db.makeupCaseStudent.updateMany({ where: { caseId: id("case-3") }, data: { status: "ABSENT" } });
    expect((await kiem({ studentIds: [HVB] })).coXungDot).toBe(false);
  });

  it("[XDD-11] LÔ học viên: chỉ trả ĐÚNG bé bị trùng (A: lớp, T: trial); B, C (chỉ bận 18/10), F không có phần tử", async () => {
    const kq = await kiem({ studentIds: [HVA, HVB, HVC, HVT, HVF] });
    expect(kq.studentConflicts.map((h) => h.studentId)).toEqual([HVA, HVT]);
  });

  // ── loại trừ / sống chết / ngày / khác khoá ───────────────────────────────────────────
  it("[XDD-12] EXCLUDE khi SỬA: loại chính case đang sửa ⇒ không trùng với chính nó; case KHÁC vẫn bị thấy; loại cả lớp", async () => {
    await taoCase({ id: id("case-4"), hocVien: [{ hv: HVB }] });
    const yc = { teacherId: GVX, studentIds: [HVB] };
    expect((await kiem({ ...yc, exclude: [{ type: "MAKEUP_CASE", id: id("case-4") }] })).coXungDot).toBe(false);
    expect((await kiem(yc)).coXungDot).toBe(true);
    await taoCase({ id: id("case-5"), gv: GVX });
    expect(ids((await kiem({ teacherId: GVX, exclude: [{ type: "MAKEUP_CASE", id: id("case-4") }] })).teacherConflicts)).toEqual([`MAKEUP_CASE:${id("case-5")}`]);
    expect((await kiem({ teacherId: GVA, exclude: [{ type: "CLASS", id: LOP_A }] })).coXungDot).toBe(false);
  });

  it("[XDD-13] CANCELLED không trùng — buổi lớp huỷ, case huỷ, buổi trial huỷ, lớp trial huỷ; lớp đã xoá mềm", async () => {
    await taoCase({ id: id("case-huy"), gv: GVX, phong: R2, status: "CANCELLED", hocVien: [{ hv: HVB }] });
    expect((await kiem({ teacherId: GVX, roomId: R2, studentIds: [HVB] })).coXungDot).toBe(false);
    // buổi lớp 6A ngày 16/10 đã HUỶ — cùng GV/phòng/giờ mà vẫn không trùng
    const huy = await checkScheduleConflicts({ khung: { ymd: "2026-10-16", startTime: "18:00", endTime: "19:30" }, teacherId: GVA, roomId: R1, studentIds: [HVA] });
    expect(huy.coXungDot).toBe(false);
    await db.trialClassSession.update({ where: { id: id("ts-15") }, data: { status: "CANCELLED" } });
    expect((await kiem({ teacherId: GVC, roomId: R3, studentIds: [HVT] })).coXungDot).toBe(false);
    await db.trialClassSession.update({ where: { id: id("ts-15") }, data: { status: "SCHEDULED" } });
    await db.trialClassV2.update({ where: { id: id("trial") }, data: { status: "CANCELLED" } });
    expect((await kiem({ teacherId: GVC, roomId: R3, studentIds: [HVT] })).coXungDot).toBe(false);
    await db.class.update({ where: { id: LOP_A }, data: { deletedAt: new Date("2026-10-01T00:00:00Z") } });
    expect((await kiem({ teacherId: GVA, studentIds: [HVA] })).coXungDot).toBe(false);
  });

  it("[XDD-14] khác NGÀY không trùng; khác GV / phòng / học viên không trùng", async () => {
    const khac = await checkScheduleConflicts({ khung: { ymd: "2026-10-17", startTime: "18:00", endTime: "19:30" }, teacherId: GVA, roomId: R1, studentIds: [HVA, HVT] });
    expect(khac.coXungDot).toBe(false);
    expect((await kiem({ teacherId: GVX, roomId: id("phong-la"), studentIds: [HVB, HVF] })).coXungDot).toBe(false);
  });

  it("[XDD-15] yêu cầu KHÔNG có GV/phòng/học viên ⇒ không có chiều nào, không lỗi", async () => {
    expect((await kiem({})).coXungDot).toBe(false);
    await expect(checkScheduleConflicts({ khung: { ymd: "2026-10-15", startTime: "19:00", endTime: "18:00" }, teacherId: GVA })).rejects.toThrow(/Khung giờ không hợp lệ/);
  });

  it("[XDD-16] NHIỀU trùng cùng lúc ⇒ trả đủ từng chiều, từng nguồn (không chỉ trùng đầu tiên)", async () => {
    await taoCase({ id: id("case-6"), gv: GVA, phong: R1 });
    const kq = await kiem({ teacherId: GVA, roomId: R1, studentIds: [HVA] });
    expect(ids(kq.teacherConflicts)).toEqual([`CLASS_SESSION:${id("sa-15")}`, `MAKEUP_CASE:${id("case-6")}`].sort());
    expect(ids(kq.roomConflicts)).toEqual([`CLASS_SESSION:${id("sa-15")}`, `MAKEUP_CASE:${id("case-6")}`].sort());
    expect((await dungThongDiepXungDot(kq)).length).toBe(5); // 2 GV + 2 phòng + 1 học viên
  });

  // ── caller class / trial / makeup nay THẤY nhau (HB-28) ───────────────────────────────
  it("[XDD-17] LỚP CHÍNH thấy MakeupCase: `detectSessionConflicts` (đường tạo/sửa buổi) và `detectBatchConflicts` (sinh/dời hàng loạt) bắt case của cùng GV/phòng", async () => {
    await taoCase({ id: id("case-7"), gv: GVB, phong: R3, ngay: 20, tu: "18:00", den: "19:30" });
    const don = await detectSessionConflicts({ excludeClassId: LOP_B, centerId: null, teacherId: GVB, roomId: R3, startAt: t(20, 18), endAt: t(20, 19, 30) });
    expect(don.teacherConflict).toBe(true);
    expect(don.roomConflict).toBe(true);
    expect(don.chiTiet.map((x) => x.nguon)).toEqual(["MAKEUP_CASE", "MAKEUP_CASE"]);
    const lo = await detectBatchConflicts({ centerId: null, excludeClassId: LOP_B, classStartTime: "18:00", classEndTime: "19:30", teacherId: GVB, roomId: null, dates: [t(20, 0), t(21, 0)] });
    expect(lo).toHaveLength(1);
    expect(lo[0]!.date.getTime()).toBe(t(20, 0).getTime());
  });

  it("[XDD-18] LỚP CHÍNH thấy buổi TRIAL (trước chỉ trial thấy lớp chính, không ngược lại)", async () => {
    const r = await detectSessionConflicts({ excludeClassId: LOP_B, centerId: null, teacherId: GVC, roomId: null, startAt: t(15, 18), endAt: t(15, 19, 30) });
    expect(r.teacherConflict).toBe(true);
    expect(r.chiTiet[0]!.nguon).toBe("TRIAL_CLASS_SESSION");
  });

  it("[XDD-19] LỚP TRIAL thấy MakeupCase: note đỏ của màn chọn GV (`layLichBanGiaoVien`) có nguồn HOC_BU, nhãn chung (không tên lớp), sắp theo giờ", async () => {
    await taoCase({ id: id("case-8"), gv: GVB, ngay: 15, tu: "17:00", den: "18:30" });
    const ban = await layLichBanGiaoVien(ADMIN, { ymd: "2026-10-15", excludeSessionId: null });
    expect(ban[GVB]!.map((b) => `${b.nguon}:${b.startTime}`)).toEqual(["HOC_BU:17:00"]);
    expect(ban[GVB]![0]!.nhan).toBe("case dạy bù");
    expect(ban[GVA]!.map((b) => b.nguon)).toEqual(["LOP_CHINH"]);
    expect(ban[GVC]!.map((b) => b.nguon)).toEqual(["TRIAL"]);
    // sửa chính buổi trial thì LOẠI nó
    const sua = await layLichBanGiaoVien(ADMIN, { ymd: "2026-10-15", excludeSessionId: id("ts-15") });
    expect(sua[GVC]).toBeUndefined();
  });

  it("[XDD-20] SỬA buổi lớp chính vào giờ của case dạy bù cùng GV ⇒ TỪ CHỐI với câu CỤ THỂ; buổi KHÔNG bị đổi (không ghi nửa chừng)", async () => {
    await taoCase({ id: id("case-9"), gv: GVA, ngay: 17, tu: "18:00", den: "19:30" });
    const truoc = await db.classSession.findUniqueOrThrow({ where: { id: id("sa-15") } });
    const kq = await adjustSession({ sessionId: id("sa-15"), date: t(17, 18), actorId: GVA, actorName: "QL" });
    expect(kq.ok).toBe(false);
    expect(kq.error).toContain("Trùng lịch");
    // Tên nguồn hiện hay ẩn tuỳ tầm nhìn của người sửa (GV-A trong fixture không có vai quản lý) — câu luôn nói AI đang bận, LOẠI việc và GIỜ.
    expect(kq.error).toMatch(/GV GV A đang có (Case dạy bù|một case dạy bù) từ 18:00–19:30/);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: id("sa-15") } })).date.getTime()).toBe(truoc.date.getTime());
    // đối chứng: dời sang NGÀY không có case thì được (khung của buổi luôn neo theo giờ lớp 18:00–19:30)
    const ok = await adjustSession({ sessionId: id("sa-15"), date: t(19, 18), actorId: GVA, actorName: "QL" });
    expect(ok.ok).toBe(true);
  });

  // ── Makeup: xếp bé ───────────────────────────────────────────────────────────────────
  it("[XDD-21] XẾP bé vào case có sẵn: lô [bé tự do, bé đang học lớp 6A cùng giờ] ⇒ TỪ CHỐI cả lô, câu nêu đúng bé; KHÔNG mục case nào, dòng còn PENDING, sổ lượt không bị tạo", async () => {
    await taoCase({ id: id("case-10") });
    const loi = await bat(xepVaoCaseCoSan(ADMIN, { caseId: id("case-10"), needIds: [id("need-f"), id("need-a")] }));
    expect(loi).toBeInstanceOf(LoiTrungLich);
    expect((loi as LoiTrungLich).message).toContain("Học viên Nguyễn A đang có lịch học lớp Robotics 6A từ 18:00–19:30");
    expect((loi as LoiTrungLich).message).not.toContain("Nguyễn F");
    expect((loi as LoiTrungLich).ketQua.studentConflicts.map((h) => h.studentId)).toEqual([HVA]);
    expect(await db.makeupCaseStudent.count({ where: { caseId: id("case-10") } })).toBe(0);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: id("need-f") } })).status).toBe("PENDING");
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: id("need-a") } })).status).toBe("PENDING");
    expect(await db.makeupCreditAccount.count({ where: { studentId: { in: [HVA, HVF] } } })).toBe(0);
    // đối chứng: chỉ bé tự do thì xếp được
    await xepVaoCaseCoSan(ADMIN, { caseId: id("case-10"), needIds: [id("need-f")] });
    expect(await db.makeupCaseStudent.count({ where: { caseId: id("case-10") } })).toBe(1);
  });

  it("[XDD-22] `kiemLichTrongTx` (đường tạo case): GV + phòng + học viên cùng lúc; đúng câu nói; ném `LoiTrungLich` trong transaction", async () => {
    const loi = await bat(
      db.$transaction((tx) =>
        kiemLichTrongTx(tx, { actor: ADMIN, khung: NGAY15("18:30", "20:00"), teacherId: GVA, roomId: R3, studentIds: [HVT, HVB] }),
      ),
    );
    expect(loi).toBeInstanceOf(LoiTrungLich);
    const m = (loi as LoiTrungLich).message;
    expect(m).toContain("GV GV A đang có lớp Robotics 6A");
    expect(m).toContain("Phòng R03 đang được dùng bởi lớp trải nghiệm Trial Sata 1");
    expect(m).toContain("Học viên Nguyễn T đang có lịch học lớp trải nghiệm Trial Sata 1");
  });

  // ── đua ───────────────────────────────────────────────────────────────────────────────
  it("[XDD-23] ĐUA: hai transaction cùng xếp MỘT GV vào cùng giờ ⇒ đúng MỘT thắng (khoá hẹp GV×ngày + kiểm lại dưới khoá)", async () => {
    const viec = (cid: string) =>
      db.$transaction(
        async (tx) => {
          await kiemLichTrongTx(tx, { actor: ADMIN, khung: NGAY15("21:00", "22:00"), teacherId: GVX });
          await tx.makeupCase.create({
            data: { id: cid, centerId: CS, courseId: KHOA, lessonId: BAI1, date: ngayDb(15), startTime: "21:00", endTime: "22:00", teacherId: GVX, status: "SCHEDULED", createdById: GVA },
          });
        },
        { timeout: 30_000 },
      );
    const kq = await Promise.allSettled([viec(id("dua-1")), viec(id("dua-2"))]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const thua = kq.find((k) => k.status === "rejected") as PromiseRejectedResult;
    expect(thua.reason).toBeInstanceOf(LoiTrungLich);
    expect(await db.makeupCase.count({ where: { id: { in: [id("dua-1"), id("dua-2")] } } })).toBe(1);
  }, 30_000);

  it("[XDD-24] ĐUA khác GV/khác ngày KHÔNG chặn nhau (khoá hẹp, không serialize cả hệ thống): hai lượt cho hai GV cùng giờ đều thành công", async () => {
    const viec = (cid: string, gv: string) =>
      db.$transaction(async (tx) => {
        await kiemLichTrongTx(tx, { actor: ADMIN, khung: NGAY15("21:00", "22:00"), teacherId: gv });
        await tx.makeupCase.create({
          data: { id: cid, centerId: CS, courseId: KHOA, lessonId: BAI1, date: ngayDb(15), startTime: "21:00", endTime: "22:00", teacherId: gv, status: "SCHEDULED", createdById: GVA },
        });
      });
    const kq = await Promise.allSettled([viec(id("dua-3"), GVX), viec(id("dua-4"), GVB)]);
    expect(kq.map((k) => k.status)).toEqual(["fulfilled", "fulfilled"]);
  }, 30_000);

  // ── lớp trial: bé thuộc buổi nào, và dữ liệu cũ ở cấp lớp ───────────────────────────
  it("[XDD-25] TRIAL: bé ghi danh vào buổi TS1 KHÔNG bận ở buổi TS2 khác của cùng lớp (chỉ lớp slot CŨ chưa chọn buổi mới là 'học cả lớp')", async () => {
    await db.trialClassSession.create({
      data: { id: id("ts-15b"), trialClassId: id("trial"), seq: 2, date: ngayDb(15), startTime: "21:00", endTime: "22:00", teacherId: GVC, roomId: R3, status: "SCHEDULED" },
    });
    expect((await kiem({ studentIds: [HVT], tu: "21:00", den: "22:00" })).coXungDot).toBe(false); // TS1 mới là buổi của bé
    // Lớp slot CŨ (theoKhung=false) + chưa chọn buổi ⇒ học CẢ LỚP ⇒ bận cả hai buổi.
    await db.trialEnrollment.updateMany({ where: { trialClassId: id("trial") }, data: { scheduledSessionId: null } });
    expect(ids((await kiem({ studentIds: [HVT], tu: "21:00", den: "22:00" })).studentConflicts.flatMap((h) => h.xungDot))).toEqual([`TRIAL_CLASS_SESSION:${id("ts-15b")}`]);
    // Lớp THEO KHUNG mà chưa xếp case ⇒ bé chưa chiếm giờ nào.
    await db.trialClassV2.update({ where: { id: id("trial") }, data: { theoKhung: true } });
    expect((await kiem({ studentIds: [HVT], tu: "21:00", den: "22:00" })).coXungDot).toBe(false);
  });

  it("[XDD-26] TRIAL cũ: GV/phòng còn ở CẤP LỚP (buổi để trống) vẫn được tính là bận — hiệu lực = buổi ?? lớp", async () => {
    await db.trialClassV2.update({ where: { id: id("trial") }, data: { teacherId: GVX, roomId: R2 } });
    await db.trialClassSession.update({ where: { id: id("ts-15") }, data: { teacherId: null, roomId: null } });
    const kq = await kiem({ teacherId: GVX, roomId: R2 });
    expect(ids(kq.teacherConflicts)).toEqual([`TRIAL_CLASS_SESSION:${id("ts-15")}`]);
    expect(ids(kq.roomConflicts)).toEqual([`TRIAL_CLASS_SESSION:${id("ts-15")}`]);
  });

  it("[XDD-27] khoá HẸP: đang giữ khoá GV-X ngày 15 thì lượt CÙNG GV ngày 16 vẫn chạy ngay; lượt cùng GV cùng ngày phải CHỜ", async () => {
    let nha!: () => void;
    const giu = new Promise<void>((r) => (nha = r));
    let daKhoa!: () => void;
    const khoaXong = new Promise<void>((r) => (daKhoa = r));
    const tx1 = db.$transaction(
      async (tx) => {
        await khoaLichTrongTx(tx, { khung: NGAY15("21:00", "22:00"), teacherId: GVX });
        daKhoa();
        await giu;
      },
      { timeout: 30_000 },
    );
    await khoaXong;
    const xin = (ymd: string) => db.$transaction((tx) => khoaLichTrongTx(tx, { khung: { ymd, startTime: "21:00", endTime: "22:00" }, teacherId: GVX }), { timeout: 30_000 });
    const treo = <T>(p: Promise<T>) => Promise.race([p.then(() => "xong" as const), new Promise<"treo">((r) => setTimeout(() => r("treo"), 1500))]);
    expect(await treo(xin("2026-10-16"))).toBe("xong"); // khác NGÀY: không bị chặn
    const cungNgay = xin("2026-10-15");
    expect(await treo(cungNgay)).toBe("treo"); // cùng GV cùng ngày: xếp hàng
    nha();
    await tx1;
    await cungNgay; // được nhả ⇒ chạy tiếp, không treo vĩnh viễn
  }, 30_000);

  // ═══ T09-F1 — học viên ĐỐI XỨNG: lớp chính / trial cũng thấy case dạy bù của học viên ═══════════════
  const hv2 = async (ten: string, lopId: string | null, tre = false) => {
    const sid = id(`hv-${ten}`);
    let leadChildId: string | null = null;
    if (tre) {
      const lead = await db.lead.create({ data: { parentName: `${T}ph`, phone: `0900000${ten.length}${ten.charCodeAt(0)}` } });
      leadChildId = (await db.leadChild.create({ data: { leadId: lead.id, fullName: `Bé ${ten}` } })).id;
    }
    await db.student.create({ data: { id: sid, name: `Nguyễn ${ten}`, centerId: CS, leadChildId } });
    if (lopId) await db.enrollment.create({ data: { id: id(`gd-${sid}`), studentId: sid, classId: lopId, courseId: KHOA, status: "ACTIVE" } });
    return { sid, leadChildId };
  };

  it("[XDD-28] SỬA buổi lớp chính (adjustSession đổi ngày): học viên của lớp có case dạy bù chồng giờ ⇒ TỪ CHỐI, câu nêu đúng bé; buổi KHÔNG đổi", async () => {
    await taoCase({ id: id("case-f1a"), gv: GVX, ngay: 17, hocVien: [{ hv: HVA }] }); // GV-X, không phòng ⇒ chỉ chiều HỌC VIÊN trùng
    const truoc = await db.classSession.findUniqueOrThrow({ where: { id: id("sa-15") } });
    const kq = await adjustSession({ sessionId: id("sa-15"), date: t(17, 18), actorId: GVA, actorName: "QL" });
    expect(kq.ok).toBe(false);
    expect(kq.error).toMatch(/Học viên Nguyễn A đang có (lịch học bù|một case dạy bù) từ 18:00–19:30/);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: id("sa-15") } })).date.getTime()).toBe(truoc.date.getTime());
    // Đối chứng: chỉ đổi PHÒNG (không dời giờ học của bé) thì không vấp trùng học viên; dời sang ngày không có case thì được.
    expect((await adjustSession({ sessionId: id("sa-15"), roomId: R2, actorId: GVA, actorName: "QL" })).ok).toBe(true);
    expect((await adjustSession({ sessionId: id("sa-15"), date: t(19, 18), actorId: GVA, actorName: "QL" })).ok).toBe(true);
  });

  it("[XDD-29] TẠO buổi lớp chính (đường tạo/sửa buổi): bé của lớp có case dạy bù chồng giờ ⇒ câu lỗi; SỬA không đổi ngày thì không kiểm học viên; lớp khác không dính", async () => {
    await taoCase({ id: id("case-f1b"), gv: GVX, ngay: 17, hocVien: [{ hv: HVA }] });
    const tao = await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(17, 0), kiemHocVien: true });
    expect(tao).toContain("Học viên Nguyễn A đang có lịch học bù từ 18:00–19:30");
    // sửa chủ đề/ghi chú (không đổi ngày): không được vấp một trùng cũ không liên quan
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(17, 0), sessionId: id("sa-15"), kiemHocVien: false })).toBeNull();
    // lớp khác (bé khác) cùng ngày: không trùng; ngày khác: không trùng
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_B, date: t(17, 0), kiemHocVien: true })).toBeNull();
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(19, 0), kiemHocVien: true })).toBeNull();
  });

  it("[XDD-30] TRIAL: buổi trial dời giờ mà bé THẬT SỰ thuộc buổi đó đang có case dạy bù chồng giờ ⇒ TỪ CHỐI, câu nêu đúng bé", async () => {
    await taoCase({ id: id("case-f1c"), gv: GVX, ngay: 15, tu: "18:00", den: "19:30", hocVien: [{ hv: HVT }] });
    const loi = await trialTrungHocBu({ actor: ADMIN, ymd: "2026-10-15", startTime: "18:30", endTime: "20:00", nguoiThamGia: { buoiTrialId: id("ts-15") } });
    expect(loi).toBe("Trùng lịch học bù — Học viên Nguyễn T đang có lịch học bù từ 18:00–19:30.");
    // xếp THẲNG một đứa trẻ vào buổi: cùng cổng
    const tre = await db.student.findUniqueOrThrow({ where: { id: HVT }, select: { leadChildId: true } });
    expect(await trialTrungHocBu({ actor: ADMIN, ymd: "2026-10-15", startTime: "18:30", endTime: "20:00", nguoiThamGia: { leadChildIds: [tre.leadChildId!] } })).toContain("Học viên Nguyễn T");
  });

  it("[XDD-31] TRIAL: bé có case dạy bù nhưng KHÔNG phải người tham gia buổi trial ⇒ không trùng học viên (không suy đoán người chưa được xếp)", async () => {
    await taoCase({ id: id("case-f1d"), gv: GVX, ngay: 15, hocVien: [{ hv: HVB }] });
    expect(await trialTrungHocBu({ actor: ADMIN, ymd: "2026-10-15", startTime: "18:30", endTime: "20:00", nguoiThamGia: { buoiTrialId: id("ts-15") } })).toBeNull();
    // ghi danh ACTIVE của lớp THEO KHUNG nhưng chưa xếp case ⇒ chưa thuộc buổi nào ⇒ không tham gia
    await taoCase({ id: id("case-f1e"), gv: GVX, ngay: 15, hocVien: [{ hv: HVT }] });
    await db.trialClassV2.update({ where: { id: id("trial") }, data: { theoKhung: true } });
    await db.trialEnrollment.updateMany({ where: { trialClassId: id("trial") }, data: { scheduledSessionId: null } });
    expect(await trialTrungHocBu({ actor: ADMIN, ymd: "2026-10-15", startTime: "18:30", endTime: "20:00", nguoiThamGia: { buoiTrialId: id("ts-15") } })).toBeNull();
  });

  it("[XDD-32] LÔ tham gia (một lượt, không N+1): lớp 3 bé / trial 2 bé — chỉ ĐÚNG bé bận có mặt trong studentConflicts", async () => {
    const c = await hv2("c2", LOP_A);
    const d = await hv2("d2", LOP_A);
    await taoCase({ id: id("case-f1f"), gv: GVX, ngay: 17, hocVien: [{ hv: HVA }] });
    const roster = await layHocVienDangHocCuaLop(db, LOP_A);
    expect([...roster].sort()).toEqual([HVA, c.sid, d.sid].sort());
    const kq = await checkScheduleConflicts({ khung: { ymd: "2026-10-17", startTime: "18:00", endTime: "19:30" }, studentIds: roster, nguonHocVien: ["MAKEUP_CASE"] });
    expect(kq.studentConflicts.map((h) => h.studentId)).toEqual([HVA]);
    // nguồn học viên hẹp: lớp chính của chính các bé KHÔNG bị tính (chỉ case dạy bù)
    const khong = await checkScheduleConflicts({ khung: NGAY15("18:00", "19:30"), studentIds: roster, nguonHocVien: ["MAKEUP_CASE"] });
    expect(khong.coXungDot).toBe(false);
    // trial: hai bé cùng thuộc buổi, một bé có case ⇒ chỉ bé đó
    const e = await hv2("e2", null, true);
    const f = await hv2("f2", null, true);
    for (const x of [e, f]) await db.trialEnrollment.create({ data: { trialClassId: id("trial"), leadChildId: x.leadChildId!, status: "ACTIVE", scheduledSessionId: id("ts-15") } });
    await taoCase({ id: id("case-f1g"), gv: GVX, ngay: 15, hocVien: [{ hv: e.sid }] });
    const loi = (await trialTrungHocBu({ actor: ADMIN, ymd: "2026-10-15", startTime: "18:30", endTime: "20:00", nguoiThamGia: { buoiTrialId: id("ts-15") } }))!;
    expect(loi).toContain("Học viên Nguyễn e2 đang có lịch học bù");
    expect(loi).not.toContain("f2");
    expect(loi).not.toContain("Nguyễn T"); // HVT có ghi danh nhưng KHÔNG có case
    // lô batch (cảnh báo hàng loạt): đếm đúng 1 bé
    const lo = await detectBatchConflicts({ centerId: null, excludeClassId: LOP_A, hocVienCuaLop: LOP_A, classStartTime: "18:00", classEndTime: "19:30", teacherId: null, roomId: null, dates: [t(17, 0), t(19, 0)] });
    expect(lo.map((x) => x.date.getTime())).toEqual([t(17, 0).getTime()]);
    expect(lo[0]!.messages).toEqual(["Trùng lịch 1 học viên với case học bù cùng giờ"]);
  });

  it("[XDD-33] bé ABSENT ở case cũ, hoặc đã bị gỡ khỏi case (mục case biến mất) ⇒ KHÔNG còn chiếm lịch — rule hiện tại: chỉ PLACED/PRESENT", async () => {
    await taoCase({ id: id("case-f1h"), gv: GVX, ngay: 17, hocVien: [{ hv: HVA }] });
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(17, 0), kiemHocVien: true })).not.toBeNull();
    await db.makeupCaseStudent.updateMany({ where: { caseId: id("case-f1h") }, data: { status: "ABSENT" } });
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(17, 0), kiemHocVien: true })).toBeNull();
    await db.makeupCaseStudent.updateMany({ where: { caseId: id("case-f1h") }, data: { status: "PRESENT" } });
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(17, 0), kiemHocVien: true })).not.toBeNull();
    await db.makeupCaseStudent.deleteMany({ where: { caseId: id("case-f1h") } }); // gỡ khỏi case
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(17, 0), kiemHocVien: true })).toBeNull();
    // case đã HUỶ thì cả case không chiếm
    await taoCase({ id: id("case-f1i"), gv: GVX, ngay: 17, status: "CANCELLED", hocVien: [{ hv: HVA }] });
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(17, 0), kiemHocVien: true })).toBeNull();
  });

  // ═══ T09-F2 — buổi THAY THẾ do cancelSession sinh ra không được bypass lõi ══════════════════════════════
  // Buổi thay thế rơi vào 22/10 (sau buổi muộn nhất còn sống = 15/10, +7 ngày), 18:00–19:30, GV/phòng của lớp A.
  const huy = () => cancelSession({ sessionId: id("sa-15"), reason: "Nghỉ lễ", actorId: GVA, actorName: "QL" });
  const trangThai = async () => ({
    cu: (await db.classSession.findUniqueOrThrow({ where: { id: id("sa-15") } })).status,
    soBuoi: await db.classSession.count({ where: { classId: LOP_A } }),
    audit: await db.auditLog.count({ where: { entityId: id("sa-15"), action: "CANCEL_SESSION" } }),
  });
  const khongDoiGi = async (truoc: Awaited<ReturnType<typeof trangThai>>) => expect(await trangThai()).toEqual(truoc);

  it("[XDD-34] HUỶ buổi: buổi thay thế trùng GV (case dạy bù của GV-A ngày 22/10) ⇒ TỪ CHỐI, TOÀN BỘ rollback: buổi cũ còn nguyên, không buổi thay thế, không audit", async () => {
    await taoCase({ id: id("case-f2a"), gv: GVA, ngay: 22 });
    const truoc = await trangThai();
    const kq = await huy();
    expect(kq.ok).toBe(false);
    expect(kq.error).toContain("buổi thay thế");
    expect(kq.error).toContain("22/10/2026");
    expect(kq.error).toMatch(/GV GV A đang có (Case dạy bù|một case dạy bù) từ 18:00–19:30/);
    expect(truoc.cu).toBe("SCHEDULED");
    await khongDoiGi(truoc);
  });

  it("[XDD-35] HUỶ buổi: buổi thay thế trùng PHÒNG (case của GV khác dùng R1 ngày 22/10) ⇒ TỪ CHỐI + rollback", async () => {
    await taoCase({ id: id("case-f2b"), gv: GVX, phong: R1, ngay: 22 });
    const truoc = await trangThai();
    const kq = await huy();
    expect(kq.ok).toBe(false);
    expect(kq.error).toMatch(/Phòng R01 đang được dùng bởi (Case dạy bù|một case dạy bù) từ 18:00–19:30/);
    await khongDoiGi(truoc);
  });

  it("[XDD-36] HUỶ buổi: buổi thay thế trùng HỌC VIÊN (bé của lớp có case dạy bù ngày 22/10) ⇒ TỪ CHỐI + rollback, câu nêu đúng bé", async () => {
    await taoCase({ id: id("case-f2c"), gv: GVX, ngay: 22, hocVien: [{ hv: HVA }] });
    const truoc = await trangThai();
    const kq = await huy();
    expect(kq.ok).toBe(false);
    expect(kq.error).toMatch(/Học viên Nguyễn A đang có (lịch học bù|một case dạy bù) từ 18:00–19:30/);
    await khongDoiGi(truoc);
  });

  it("[XDD-37] HUỶ buổi: buổi thay thế KHÔNG trùng ⇒ huỷ buổi cũ và tạo ĐÚNG MỘT buổi thay thế (22/10), có audit", async () => {
    // đối chứng: case khác NGÀY / khác GV-phòng-bé không cản
    await taoCase({ id: id("case-f2d"), gv: GVX, ngay: 23, hocVien: [{ hv: HVB }] });
    const truoc = await trangThai();
    const kq = await huy();
    expect(kq.ok).toBe(true);
    const sau = await trangThai();
    expect(sau.cu).toBe("CANCELLED");
    expect(sau.soBuoi).toBe(truoc.soBuoi + 1);
    expect(sau.audit).toBe(1);
    const tt = await db.classSession.findMany({ where: { classId: LOP_A, status: "SCHEDULED", date: { gte: t(22, 0) } } });
    expect(tt).toHaveLength(1);
    expect(tt[0]!.id).toBe(kq.makeupSessionId);
    expect(vnYmd(tt[0]!.date)).toBe("2026-10-22");
  });

  // ═══ Ranh giới quyền xem ═════════════════════════════════════════════════════════════════════════
  it("[XDD-38] NGUỒN NGOÀI TẦM NHÌN: backend vẫn PHÁT HIỆN và CHẶN, nhưng câu nói VÀ kết quả cấu trúc không lộ tên lớp / cơ sở / id", async () => {
    const hanChe = {
      userId: GVX,
      isSuperAdmin: false,
      isHoLevel: false,
      orgRoles: [],
      permissions: [],
      visibleCenterIds: [id("co-so-khac")], // KHÔNG thấy CS của lớp 6A / case
      visibleOrgUnitIds: [],
      grantsAllow: new Set<string>(),
      assignedClassIds: new Set<string>(),
    } as unknown as Actor;
    // (1) lớp chính ngoài tầm nhìn: HVB xếp case 18:30 ngày 15/10 trong khi HV-A (lớp 6A)… dùng HV-A trực tiếp
    const loi = await bat(db.$transaction((tx) => kiemLichTrongTx(tx, { actor: hanChe, khung: NGAY15("18:30", "20:00"), teacherId: GVA, studentIds: [HVA] })));
    expect(loi).toBeInstanceOf(LoiTrungLich); // vẫn CHẶN — "không thấy" không có nghĩa là "không bận"
    const m = (loi as LoiTrungLich).message;
    expect(m).toContain("một buổi lớp chính");
    expect(m).not.toContain("Robotics 6A");
    expect(m).not.toContain(CS);
    // kết quả cấu trúc đi theo lỗi cũng đã gỡ metadata
    const x = (loi as LoiTrungLich).ketQua.teacherConflicts[0]!;
    expect(x).toMatchObject({ nguon: "CLASS_SESSION", id: "", tieuDe: "một buổi lớp chính", centerId: null, classId: null });
    expect(x.teacherId).toBe(GVA); // id của chính thứ đang được xếp — không phải dữ liệu cơ sở khác
    const h = (loi as LoiTrungLich).ketQua.studentConflicts[0]!.xungDot[0]!;
    expect(h).toMatchObject({ id: "", centerId: null, classId: null });
    // (2) đối chứng: người có quyền nhìn THẤY tên (đã khẳng định ở XDD-22) và dữ liệu thô vẫn nguyên ở phía máy chủ
    const day = await checkScheduleConflicts({ khung: NGAY15("18:30", "20:00"), teacherId: GVA });
    expect(day.teacherConflicts[0]).toMatchObject({ tieuDe: "Robotics 6A", centerId: CS, classId: LOP_A });
  });

  it("[XDD-39] CHIỀU HỌC VIÊN của lớp CHỈ nhìn case dạy bù: bé ghi danh HAI lớp trùng giờ (dữ liệu cũ) KHÔNG phải lý do chặn sửa/tạo buổi — luật mới chưa ai chốt", async () => {
    await db.enrollment.create({ data: { id: id("gd-hva-lop-b"), studentId: HVA, classId: LOP_B, courseId: KHOA, status: "ACTIVE" } });
    // HV-A còn học lớp 7B (buổi 18/10 18:00–19:30); xếp một buổi lớp 6A vào đúng giờ đó: lớp ↔ lớp theo học viên không chặn…
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(18, 0), kiemHocVien: true })).toBeNull();
    // …nhưng nguồn case dạy bù thì chặn (đối chứng: lõi VẪN thấy lớp 7B khi hỏi đủ nguồn)
    const day = await checkScheduleConflicts({ khung: { ymd: "2026-10-18", startTime: "18:00", endTime: "19:30" }, studentIds: [HVA] });
    expect(ids(day.studentConflicts.flatMap((h) => h.xungDot))).toEqual([`CLASS_SESSION:${id("sb-18")}`]);
    await taoCase({ id: id("case-f1j"), gv: GVX, ngay: 18, hocVien: [{ hv: HVA }] });
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(18, 0), kiemHocVien: true })).toContain("Học viên Nguyễn A đang có lịch học bù");
  });

  it("[XDD-40] adjustSession đổi PHÒNG/GV dạy thay (không dời giờ học của bé) KHÔNG vấp trùng học viên cũ không liên quan; đổi NGÀY thì có", async () => {
    // Trùng CÓ SẴN: HV-A có case dạy bù đúng giờ buổi lớp hiện tại (15/10 18:00).
    await taoCase({ id: id("case-f1k"), gv: GVX, ngay: 15, hocVien: [{ hv: HVA }] });
    expect((await adjustSession({ sessionId: id("sa-15"), roomId: R2, actorId: GVA, actorName: "QL" })).ok).toBe(true);
    expect((await adjustSession({ sessionId: id("sa-15"), teacherId: GVB, actorId: GVA, actorName: "QL" })).ok).toBe(true);
    const doiNgay = await adjustSession({ sessionId: id("sa-15"), date: t(15, 19), actorId: GVA, actorName: "QL" });
    // cùng NGÀY 15/10 (khung neo theo giờ lớp 18:00–19:30) — đổi ngày bật kiểm học viên ⇒ chặn
    expect(doiNgay.ok).toBe(false);
    expect(doiNgay.error).toMatch(/Học viên Nguyễn A đang có (lịch học bù|một case dạy bù)/);
  });

  it("[XDD-41] TRIAL — PHÒNG: buổi trial đè case dạy bù ở cùng phòng ⇒ TỪ CHỐI (kể cả khi chưa có bé); phòng khác / giờ sát nhau thì không", async () => {
    await taoCase({ id: id("case-f1l"), gv: GVX, phong: R2, ngay: 16, tu: "18:00", den: "19:30" });
    const loi = await trialTrungHocBu({ actor: ADMIN, ymd: "2026-10-16", startTime: "19:00", endTime: "20:30", roomId: R2, nguoiThamGia: null });
    expect(loi).toMatch(/^Trùng lịch học bù — Phòng R02 đang được dùng bởi Case dạy bù từ 18:00–19:30\.$/);
    expect(await trialTrungHocBu({ actor: ADMIN, ymd: "2026-10-16", startTime: "19:00", endTime: "20:30", roomId: R3, nguoiThamGia: null })).toBeNull();
    expect(await trialTrungHocBu({ actor: ADMIN, ymd: "2026-10-16", startTime: "19:30", endTime: "20:30", roomId: R2, nguoiThamGia: null })).toBeNull();
    // chỉ nguồn CASE: trùng phòng với buổi LỚP CHÍNH ở trial vẫn là luật cũ (không chặn) — R1 đang dùng bởi lớp 6A 15/10 18:00
    expect(await trialTrungHocBu({ actor: ADMIN, ymd: "2026-10-15", startTime: "18:00", endTime: "19:30", roomId: R1, nguoiThamGia: null })).toBeNull();
  });

  it("[XDD-42] học viên của lớp = ghi danh ĐANG HỌC: ghi danh đã HUỶ không chiếm lịch, không vào danh sách kiểm", async () => {
    const c = await hv2("c3", LOP_A);
    await db.enrollment.updateMany({ where: { studentId: c.sid }, data: { status: "CANCELLED" } });
    expect(await layHocVienDangHocCuaLop(db, LOP_A)).toEqual([HVA]);
    await taoCase({ id: id("case-f1m"), gv: GVX, ngay: 17, hocVien: [{ hv: c.sid }] });
    expect(await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_A, date: t(17, 0), kiemHocVien: true })).toBeNull();
  });

  it("[XDD-43] CHUNG KHOÁ với phía lớp chính: đang giữ khoá khi TẠO buổi lớp (helper có `tx`) thì xếp case dạy bù cùng GV cùng ngày phải CHỜ, rồi thấy buổi lớp vừa commit và bị TỪ CHỐI", async () => {
    let nha!: () => void;
    const giu = new Promise<void>((r) => (nha = r));
    let daKhoa!: () => void;
    const khoaXong = new Promise<void>((r) => (daKhoa = r));
    // Lớp 7B (GV-B, R2, 18:00–19:30) tạo thêm một buổi ngày 20/10, rồi GIỮ transaction mở.
    const lop = db.$transaction(
      async (tx) => {
        const loi = await kiemXungDotBuoiLop({ actor: ADMIN, classId: LOP_B, date: t(20, 0), kiemHocVien: false, tx });
        expect(loi).toBeNull();
        daKhoa();
        await giu;
        await tx.classSession.create({ data: { id: id("sb-20"), classId: LOP_B, date: t(20, 18), status: "SCHEDULED", centerId: CS } });
      },
      { timeout: 30_000 },
    );
    await khoaXong;
    const caseTx = db.$transaction(
      (tx) => kiemLichTrongTx(tx, { actor: ADMIN, khung: { ymd: "2026-10-20", startTime: "18:00", endTime: "19:30" }, teacherId: GVB }),
      { timeout: 30_000 },
    );
    const treo = await Promise.race([caseTx.then(() => "xong" as const, () => "loi" as const), new Promise<"treo">((r) => setTimeout(() => r("treo"), 1500))]);
    expect(treo).toBe("treo"); // phía case xếp hàng sau phía lớp — cùng khoá
    nha();
    await lop;
    const loi = await bat(caseTx);
    expect(loi).toBeInstanceOf(LoiTrungLich);
    expect((loi as LoiTrungLich).message).toContain("GV GV B đang có lớp Robotics 7B từ 18:00–19:30");
  }, 30_000);
});
