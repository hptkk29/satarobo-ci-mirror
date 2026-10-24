// tests/finance/bao-luu-portal.test.ts — CỔNG PHỤ HUYNH & CHAT × bảo lưu theo quy chế, trên POSTGRES THẬT. PHIÊN 4.
//
// Chạy:  pnpm test:finance-db
// Hai thứ đọc hồ sơ bảo lưu bằng đường KHÁC `trongLop` (Prisma where): màn Học phí (`getStudentBilling.tamHoanThu`) và nhóm chat lớp
// (raw SQL ở `loadDerivedMembership` — viết tay nên PHẢI có ca canh nó không lệch bản Prisma).
// Mốc thời gian tính từ đồng hồ THẬT nhưng theo độ lệch tương đối (raw SQL dùng now() của Postgres, không tiêm được `now`).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { getStudentBilling } from "@/lib/portal/billing-student";
import { loadDerivedMembership } from "@/lib/chat/sync-membership";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { trongLop } from "@/lib/bao-luu/roster";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

if (!RUN_DB_TESTS) console.warn(`[BL4-PT] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl4p-";
const CS = `${T}cs`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const NGAY = 86_400_000;
const bay = (n: number) => new Date(Date.now() - n * NGAY); // n ngày TRƯỚC (n âm = tương lai)

// A: bình thường · B: bảo lưu đời mới đang mở · C: hồ sơ CŨ (không approvedAt) · D: đời mới ĐÃ KẾT THÚC
// E1+E2: HAI con cùng một phụ huynh, E1 bảo lưu còn E2 vẫn học · F: hồ sơ đời mới chưa tới ngày bắt đầu
const HS = ["a", "b", "c", "d", "e1", "e2", "f"] as const;
type K = (typeof HS)[number];
const hv = (k: K) => `${T}hv-${k}`;
const gd = (k: K) => `${T}gd-${k}`;
const ph = (k: K) => (k === "e1" || k === "e2" ? `${T}ph-e` : `${T}ph-${k}`);
const PHS = [...new Set(HS.map(ph))];

async function don() {
  await db.studentReserve.deleteMany({ where: { studentId: { in: HS.map(hv) } } });
  await db.enrollment.deleteMany({ where: { id: { in: HS.map(gd) } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: HS.map(hv) } } });
  await db.user.deleteMany({ where: { id: { in: PHS } } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "CS BL4P", slug: CS, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Khoá BL4P", slug: KHOA, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp BL4P", courseId: KHOA, centerId: CS, status: "ACTIVE" } });
  for (const p of PHS) await db.user.create({ data: { id: p, name: `PH ${p}`, email: `${p}@example.test`, role: "PARENT", roles: ["PARENT"] } });
  for (const k of HS) {
    await db.student.create({ data: { id: hv(k), name: `HV ${k}`, centerId: CS, parentUserId: ph(k) } });
    await db.enrollment.create({
      data: { id: gd(k), studentId: hv(k), classId: LOP, courseId: KHOA, status: k === "a" ? "ACTIVE" : "PAUSED", centerId: CS },
    });
  }
  await db.enrollment.update({ where: { id: gd("d") }, data: { status: "STUDYING" } });
  await db.enrollment.update({ where: { id: gd("e2") }, data: { status: "STUDYING" } });
  await db.enrollment.update({ where: { id: gd("f") }, data: { status: "STUDYING" } });
  const hoSo = (k: K, o: object) =>
    db.studentReserve.create({ data: { studentId: hv(k), enrollmentId: gd(k), reason: "fx", createdByName: "x", centerId: CS, ...o } });
  await hoSo("b", { status: "ACTIVE", isActive: true, approvedAt: bay(20), startedAt: bay(20), standardEndDate: bay(-70) });
  await hoSo("c", { status: "ACTIVE", isActive: true, startedAt: bay(20), expectedEndAt: bay(-70) });
  await hoSo("d", { status: "ENDED", isActive: false, approvedAt: bay(60), startedAt: bay(60), endedAt: bay(30), standardEndDate: bay(-10) });
  await hoSo("e1", { status: "ACTIVE", isActive: true, approvedAt: bay(5), startedAt: bay(5), standardEndDate: bay(-100) });
  await hoSo("f", { status: "ACTIVE", isActive: true, approvedAt: bay(1), startedAt: bay(-3), standardEndDate: bay(-100) }); // bắt đầu 3 ngày NỮA
}

describe.skipIf(!RUN_DB_TESTS)("[BL4-PT] màn Học phí cổng PH", () => {
  beforeEach(dung);
  afterAll(don);

  it("[BL4-PT-01] hồ sơ đời mới đang mở ⇒ tamHoanThu = hạn bảo lưu (extendedEndDate thắng standardEndDate)", async () => {
    const now = new Date();
    const b = await getStudentBilling(hv("b"), now);
    const luu = await db.studentReserve.findFirstOrThrow({ where: { studentId: hv("b") }, select: { standardEndDate: true } });
    expect(b.tamHoanThu?.denNgay).toBe(luu.standardEndDate?.toISOString()); // đọc từ DB: `bay()` trôi vài ms giữa hai lần gọi
    const gia = bay(-160);
    await db.studentReserve.updateMany({ where: { studentId: hv("b") }, data: { extendedEndDate: gia } });
    expect((await getStudentBilling(hv("b"), now)).tamHoanThu?.denNgay).toBe(gia.toISOString());
  });

  it("[BL4-PT-02] ĐỐI CHỨNG: bé thường / hồ sơ CŨ / hồ sơ đã kết thúc / hồ sơ chưa tới ngày bắt đầu ⇒ tamHoanThu = null (hành vi cũ)", async () => {
    const now = new Date();
    for (const k of ["a", "c", "d", "f"] as const) {
      expect((await getStudentBilling(hv(k), now)).tamHoanThu, k).toBeNull();
    }
  });

  it("[BL4-PT-03] hồ sơ đời mới chưa có hạn ⇒ vẫn tamHoanThu nhưng denNgay = null (không bịa ngày)", async () => {
    await db.studentReserve.updateMany({ where: { studentId: hv("b") }, data: { standardEndDate: null, extendedEndDate: null, expectedEndAt: null } });
    expect((await getStudentBilling(hv("b"), new Date())).tamHoanThu).toEqual({ denNgay: null });
  });

  it("[BL4-PT-04] `now` quyết định: hỏi về TRƯỚC khi hồ sơ bắt đầu ⇒ null", async () => {
    expect((await getStudentBilling(hv("b"), bay(25))).tamHoanThu).toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL4-CH] nhóm chat lớp × bảo lưu theo quy chế (raw SQL phải KHỚP bản Prisma)", () => {
  beforeEach(dung);
  afterAll(don);

  const cls = { id: LOP, centerId: CS, teacherId: null, assistantId: null };
  const phHienTai = async () =>
    (await db.$transaction((tx) => loadDerivedMembership(tx, cls))).desired
      .filter((d) => d.derivedFrom === "CLASS_STUDENT_PARENT")
      .map((d) => d.userId)
      .sort();

  it("[BL4-CH-01] PH của bé đang bảo lưu (B) RỜI nhóm; PH bé thường (A), hồ sơ cũ (C), đã kết thúc (D), chưa bắt đầu (F) GIỮ NGUYÊN", async () => {
    expect(await phHienTai()).toEqual([ph("a"), ph("c"), ph("d"), ph("e1"), ph("f")].sort());
  });

  it("[BL4-CH-02] BẪY BA: PH có HAI con cùng lớp, chỉ MỘT bảo lưu ⇒ PH VẪN ở lại; cả hai bảo lưu ⇒ mới rời", async () => {
    expect(await phHienTai()).toContain(ph("e1"));
    await db.studentReserve.create({
      data: { studentId: hv("e2"), enrollmentId: gd("e2"), reason: "fx", createdByName: "x", centerId: CS, status: "ACTIVE", isActive: true, approvedAt: bay(2), startedAt: bay(2) },
    });
    expect(await phHienTai()).not.toContain(ph("e1"));
  });

  it("[BL4-CH-03] hồ sơ B kết thúc ⇒ PH của B VÀO LẠI nhóm", async () => {
    await db.studentReserve.updateMany({ where: { studentId: hv("b") }, data: { status: "ENDED", isActive: false, endedAt: bay(1) } });
    expect(await phHienTai()).toContain(ph("b"));
  });

  it("[BL4-CH-04] KHÔNG LỆCH: tập học viên mà raw SQL của chat giữ lại == tập `trongLop` (Prisma) giữ lại, trên đúng dữ liệu này", async () => {
    const tuPrisma = await db.enrollment.findMany({
      where: trongLop({ classId: LOP, deletedAt: null, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } }, new Date()),
      select: { student: { select: { parentUserId: true } } },
    });
    const phTuPrisma = [...new Set(tuPrisma.map((e) => e.student.parentUserId))].sort();
    expect(await phHienTai()).toEqual(phTuPrisma);
  });
});
