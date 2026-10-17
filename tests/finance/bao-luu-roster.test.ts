// tests/finance/bao-luu-roster.test.ts — DANH SÁCH LỚP khi có bảo lưu theo quy chế (BR-09/BR-13), trên POSTGRES THẬT. PHIÊN 4.
//
// Chạy:  pnpm test:finance-db
// Hai loại bảo lưu phải được phân biệt: hồ sơ ĐỜI MỚI đã duyệt (approvedAt ≠ NULL) RỜI lớp trong khoảng hiệu lực của nó; còn lại
// (đường cũ, PAUSED mồ côi, hồ sơ cũ) GIỮ NGUYÊN như trước Phiên 4 — nên cờ TẮT ⇒ mọi truy vấn cho kết quả y hệt hôm qua.
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi mốc đều tính từ NOW.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { CHON_HO_SO_BAO_LUU, ghiDanhDangBaoLuuTai, laDangBaoLuuTheoQuyChe, trongLop } from "@/lib/bao-luu/roster";
import { buildSessionAttendanceRows } from "@/lib/attendance/roster";
import { completeSession } from "@/lib/lms/session-lifecycle";
import { listSessionGaps } from "@/lib/dashboard/tuong-tac/session-gaps";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

if (!RUN_DB_TESTS) console.warn(`[BL4-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl4r-";
const CS = `${T}cs`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const NOW = new Date("2026-10-07T03:00:00Z");
const NGAY = 86_400_000;
const truoc = (n: number) => new Date(NOW.getTime() - n * NGAY);

// A: đang học · B: PAUSED + hồ sơ ĐỜI MỚI đang mở từ NOW-20d · C: PAUSED + hồ sơ CŨ (không approvedAt) · D: PAUSED mồ côi
// E: đang học lại, hồ sơ đời mới ĐÃ KẾT THÚC (cửa sổ NOW-60d → NOW-30d)
const HS = ["a", "b", "c", "d", "e"] as const;
type K = (typeof HS)[number];
const hv = (k: K) => `${T}hv-${k}`;
const gd = (k: K) => `${T}gd-${k}`;

async function don() {
  await db.attendance.deleteMany({ where: { studentId: { in: HS.map(hv) } } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.studentReserve.deleteMany({ where: { studentId: { in: HS.map(hv) } } });
  await db.enrollment.deleteMany({ where: { id: { in: HS.map(gd) } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: HS.map(hv) } } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "CS BL4R", slug: CS, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Khoá BL4R", slug: KHOA, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp BL4R", courseId: KHOA, centerId: CS } });
  const trang = { a: "ACTIVE", b: "PAUSED", c: "PAUSED", d: "PAUSED", e: "STUDYING" } as const;
  for (const k of HS) {
    await db.student.create({ data: { id: hv(k), name: `HV ${k}`, centerId: CS } });
    await db.enrollment.create({ data: { id: gd(k), studentId: hv(k), classId: LOP, courseId: KHOA, status: trang[k], centerId: CS } });
  }
  const hoSo = (k: K, o: object) =>
    db.studentReserve.create({ data: { studentId: hv(k), enrollmentId: gd(k), reason: "fx", createdByName: "x", centerId: CS, ...o } });
  await hoSo("b", { status: "ACTIVE", isActive: true, approvedAt: truoc(20), startedAt: truoc(20) });
  await hoSo("c", { status: "ACTIVE", isActive: true, startedAt: truoc(20) }); // đường cũ: không approvedAt
  await hoSo("e", { status: "ENDED", isActive: false, approvedAt: truoc(60), startedAt: truoc(60), endedAt: truoc(30) });
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
const mong = (...k: K[]) => k.map(gd).sort();
const lop = (ngay: Date) =>
  db.enrollment.findMany({ where: trongLop({ classId: LOP, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } }, ngay), select: { id: true } });

describe.skipIf(!RUN_DB_TESTS)("[BL4-RS] roster loại học viên đang bảo lưu theo quy chế", () => {
  beforeEach(dung);
  afterAll(don);

  it("[BL4-RS-01] hôm nay: chỉ B (hồ sơ đời mới đang mở) rời lớp; C (hồ sơ cũ), D (mồ côi), E (đã phục học) GIỮ NGUYÊN", async () => {
    const cu = await db.enrollment.findMany({ where: { classId: LOP, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } }, select: { id: true } });
    expect(ids(cu)).toEqual(mong("a", "b", "c", "d", "e")); // hành vi CŨ — đối chứng
    expect(ids(await lop(NOW))).toEqual(mong("a", "c", "d", "e"));
  });

  it("[BL4-RS-02] hỏi về QUÁ KHỨ: buổi TRƯỚC khi bảo lưu vẫn hiện em ấy, buổi TRONG khoảng bảo lưu thì không — kể cả khi em đã phục học", async () => {
    // NOW-70d: chưa ai bảo lưu ⇒ đủ cả năm
    expect(ids(await lop(truoc(70)))).toEqual(mong("a", "b", "c", "d", "e"));
    // NOW-40d: E đang trong cửa sổ (60d→30d) ⇒ E vắng; B chưa bắt đầu (20d) ⇒ B còn
    expect(ids(await lop(truoc(40)))).toEqual(mong("a", "b", "c", "d"));
    // NOW-25d: E đã phục học (sau 30d) ⇒ E về; B chưa bắt đầu
    expect(ids(await lop(truoc(25)))).toEqual(mong("a", "b", "c", "d", "e"));
    // biên: đúng lúc E kết thúc (NOW-30d) ⇒ E đã ra khỏi khoảng (hiệu lực tới TRƯỚC endedAt)
    expect(ids(await lop(truoc(30)))).toContain(gd("e"));
    // biên: đúng lúc E bắt đầu (NOW-60d) ⇒ E đã nằm trong khoảng
    expect(ids(await lop(truoc(60)))).not.toContain(gd("e"));
  });

  it("[BL4-RS-03] hồ sơ B kết thúc ⇒ B vào lại danh sách hôm nay, nhưng các buổi TRONG khoảng bảo lưu vẫn không có B; `count` loại đúng", async () => {
    expect(await db.enrollment.count({ where: trongLop({ classId: LOP, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } }, NOW) })).toBe(4);
    await db.studentReserve.updateMany({ where: { studentId: hv("b") }, data: { status: "ENDED", isActive: false, endedAt: truoc(1) } });
    await db.enrollment.update({ where: { id: gd("b") }, data: { status: "STUDYING" } });
    expect(ids(await lop(NOW))).toEqual(mong("a", "b", "c", "d", "e"));
    expect(ids(await lop(truoc(10)))).not.toContain(gd("b"));
  });

  it("[BL4-RS-04] dùng được lồng trong `select` của lớp (đường điểm danh GV) và không đè điều kiện sẵn có của người gọi", async () => {
    const l = await db.class.findUniqueOrThrow({
      where: { id: LOP },
      select: { enrollments: { where: trongLop({ status: { in: ENROLLMENT_ACTIVE_STATUS_LIST }, deletedAt: null }, NOW), select: { id: true } } },
    });
    expect(ids(l.enrollments)).toEqual(mong("a", "c", "d", "e"));
    const r = await db.enrollment.findMany({
      where: trongLop({ classId: LOP, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST }, NOT: { id: gd("a") } }, NOW),
      select: { id: true },
    });
    expect(ids(r)).toEqual(mong("c", "d", "e")); // A bị NOT của người gọi, B bị trongLop — cả hai cùng hiệu lực
  });

  const SES = { cu: `${T}s-cu`, trongB: `${T}s-trongB` }; // NOW-70d (chưa ai bảo lưu) · NOW-10d (B đang bảo lưu)
  const actorHo = {
    userId: `${T}u`, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
  } as unknown as Actor;
  const taoBuoi = async () => {
    await db.classSession.create({ data: { id: SES.cu, classId: LOP, date: truoc(70), centerId: CS } });
    await db.classSession.create({ data: { id: SES.trongB, classId: LOP, date: truoc(10), centerId: CS } });
  };

  it("[BL4-RS-06] điểm danh GV/admin: buổi TRONG khoảng bảo lưu của B không có B; buổi cũ TRƯỚC khoảng bảo lưu vẫn đủ (không xoá lịch sử)", async () => {
    await taoBuoi();
    const ten = async (s: string) => (await buildSessionAttendanceRows(actorHo, s)).rows.map((r) => r.studentId).sort();
    expect(await ten(SES.cu)).toEqual((["a", "b", "c", "d", "e"] as const).map(hv).sort());
    expect(await ten(SES.trongB)).toEqual((["a", "c", "d", "e"] as const).map(hv).sort());
  });

  it("[BL4-RS-07] sĩ số chốt buổi (rosterSize, nuôi bậc đơn giá dạy): không đếm em đang bảo lưu TẠI NGÀY BUỔI; buổi cũ vẫn đủ", async () => {
    await taoBuoi();
    const chot = async (s: string) => {
      const r = await completeSession({ sessionId: s, confirmNoAttendance: true, assignMode: "DEFER", nguonChot: "BACKFILL", actorId: null, actorName: "fx", now: NOW });
      expect(r.ok).toBe(true);
      return (await db.classSession.findUniqueOrThrow({ where: { id: s } })).rosterSize;
    };
    expect(await chot(SES.cu)).toBe(5);
    expect(await chot(SES.trongB)).toBe(4);
  });

  it("[BL4-RS-08] bảng \"buổi còn thiếu\": sĩ số của buổi lấy roster TẠI NGÀY BUỔI — điểm danh đủ 4 em (không B) thì buổi đó ĐÃ XONG điểm danh", async () => {
    await taoBuoi();
    for (const k of ["a", "c", "d", "e"] as const) {
      await db.attendance.create({ data: { studentId: hv(k), sessionId: SES.trongB, status: "PRESENT" } });
      await db.attendance.create({ data: { studentId: hv(k), sessionId: SES.cu, status: "PRESENT" } });
    }
    const filters = { centerIds: [CS], isAllCenters: false, dateFrom: truoc(100), dateTo: NOW, groupByCenter: false };
    const kq = await listSessionGaps(actorHo, filters, { now: NOW, pageSize: 200 });
    const dong = (id: string) => kq.rows.find((r) => r.id === id);
    // Buổi TRONG khoảng bảo lưu của B: roster 4, đã điểm danh đủ 4 ⇒ xong điểm danh.
    expect(dong(SES.trongB)).toMatchObject({ roster: 4, marked: 4, attendanceDone: true });
    // Buổi CŨ trước khi B bảo lưu: roster 5, mới điểm danh 4 ⇒ vẫn thiếu 1 (đối chứng: lịch sử không bị xoá).
    expect(dong(SES.cu)).toMatchObject({ roster: 5, marked: 4, attendanceDone: false });
  });

  it("[BL4-RS-05] bản trong bộ nhớ `laDangBaoLuuTheoQuyChe` khớp ĐÚNG bản `where` — ở nhiều mốc, kể cả hai biên", async () => {
    const hang = await db.enrollment.findMany({ where: { classId: LOP }, select: { id: true, ...CHON_HO_SO_BAO_LUU } });
    for (const ngay of [truoc(70), truoc(60), truoc(40), truoc(30), truoc(25), truoc(20), truoc(1), NOW]) {
      const bonho = hang.filter((e) => laDangBaoLuuTheoQuyChe(e, ngay)).map((e) => e.id).sort();
      const tuWhere = ids(await db.enrollment.findMany({ where: { classId: LOP, ...ghiDanhDangBaoLuuTai(ngay) }, select: { id: true } }));
      expect(bonho, ngay.toISOString()).toEqual(tuWhere);
    }
  });
});
