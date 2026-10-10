// tests/hoc-bu/diem-danh-bu.test.ts — T02: `diemDanhBu` và `taoPhiBu` trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db      (cùng bộ với T01; `pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
//
// Mỗi ca ở đây là MỘT lỗ T02 bịt:
//   · HB-13  điểm danh bù KHÔNG ghi đè trạng thái vắng gốc
//   · HB-03  cổng thời gian: mở trước giờ 15 phút; GV đến 23:59; quản lý 3 ngày; quá thì ghi đè có lý do + audit
//   · HB-17  bấm tạo phí hai lần (đồng thời) chỉ ra MỘT đơn
// và `[DDB-05]` chạy hai lượt điểm danh ĐỒNG THỜI trên một bé — đúng cái mà test thuần không dựng được.
//
// Oracle: chạy lại CHECKER T01 trên chính DB sau mỗi thao tác — nếu thao tác để lại dữ liệu hỏng (đơn phí mồ côi,
// bé kẹt, buổi gốc bị ghi đè) thì checker nói, không cần ta nhớ tự khẳng định từng cột.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { Actor } from "@/lib/auth/actor";
import { LoiHocBu, diemDanhBu, taoPhiBu } from "@/lib/hoc-bu/case-db";
import { docSnapshot } from "@/lib/hoc-bu/toan-ven-db";
import { chayToanVen, type Finding } from "@/lib/hoc-bu/toan-ven";
import { vnDateAt } from "@/lib/time/vn";

if (!RUN_DB_TESTS) console.warn(`[DDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-t02-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const KHOA = id("khoa");
const CUR = id("cur");
const BAI = id("bai");
const PHONG = id("phong");
const GV = id("gv");
const LOP = id("lop");
const HV = id("hv");
const HV2 = id("hv2");
const BUOI = id("buoi");
const BUOI2 = id("buoi2");
const NEED = id("need");
const NEED2 = id("need2");
const CASE = id("case");
const SV = id("sv");
const SV2 = id("sv2");
const MA_HP = "T02HP1";

/** Case 15/10/2026 18:00–19:30 giờ VN. */
const NGAY_CASE = "2026-10-15";
const luc = (d: number, h: number, mi: number, ms = 0) => new Date(vnDateAt(2026, 9, d, h, mi).getTime() + ms);

/** Quản trị tối cao — `scopedDb` không cách ly; đủ cho phần nghiệp vụ (quyền do server action hỏi, không ở đây). */
const ADMIN = {
  userId: GV,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
} as unknown as Actor;

async function don() {
  const items = await db.orderItem.findMany({ where: { studentId: { in: [HV, HV2] } }, select: { orderId: true } });
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  await db.paymentRequest.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [SV, SV2] } } });
  await db.makeupCase.deleteMany({ where: { id: CASE } });
  await db.makeupNeed.deleteMany({ where: { id: { in: [NEED, NEED2] } } });
  await db.courseModuleMakeupQuota.deleteMany({ where: { courseId: KHOA } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.enrollment.deleteMany({ where: { classId: LOP } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.lesson.deleteMany({ where: { id: BAI } });
  await db.curriculum.deleteMany({ where: { id: CUR } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: [HV, HV2] } } });
  await db.room.deleteMany({ where: { id: PHONG } });
  await db.user.deleteMany({ where: { id: GV } });
  await db.center.deleteMany({ where: { id: CS } });
}

/**
 * Thế giới: một bé vắng CÓ PHÉP buổi gốc (đã đánh dấu cần bù), dòng cần bù SCHEDULED, bé đang CHỜ điểm danh ở case
 * 15/10 18:00. Bé thứ hai (cùng case) để thử hai lượt điểm danh song song trên HAI bé khác nhau.
 */
async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở T02", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  await db.user.create({ data: { id: GV, name: "GV T02", email: `${GV}@test.local`, role: "TEACHER", roles: ["TEACHER"], centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá T02", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "Giáo trình T02" } });
  await db.lesson.create({ data: { id: BAI, curriculumId: CUR, order: 1, title: "Bài 1", moduleCode: MA_HP } });
  await db.room.create({ data: { id: PHONG, code: `${T}p`, name: "Phòng T02", centerId: CS } });
  await db.class.create({ data: { id: LOP, name: "Lớp T02", courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
  for (const [hv, ten] of [[HV, "Bé T02 A"], [HV2, "Bé T02 B"]] as const) {
    await db.student.create({ data: { id: hv, name: ten, centerId: CS } });
    await db.enrollment.create({ data: { id: id(`gd-${hv}`), studentId: hv, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  }
  await db.classSession.create({ data: { id: BUOI, classId: LOP, date: new Date("2026-10-10T11:00:00.000Z"), lessonId: BAI, status: "COMPLETED", centerId: CS } });
  await db.classSession.create({ data: { id: BUOI2, classId: LOP, date: new Date("2026-10-11T11:00:00.000Z"), lessonId: BAI, status: "COMPLETED", centerId: CS } });
  await db.attendance.createMany({
    data: [
      { sessionId: BUOI, studentId: HV, status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", absenceReason: "Con ốm", centerId: CS },
      { sessionId: BUOI2, studentId: HV2, status: "ABSENT_UNEXCUSED", makeupStatus: "NEEDS_MAKEUP", centerId: CS },
    ],
  });
  const dong = (nid: string, hv: string, buoi: string) => ({
    id: nid, studentId: hv, classId: LOP, centerId: CS, missedSessionId: buoi, missedLessonId: BAI, status: "SCHEDULED" as const,
  });
  await db.makeupNeed.createMany({ data: [dong(NEED, HV, BUOI), dong(NEED2, HV2, BUOI2)] });
  await db.makeupCase.create({
    data: {
      id: CASE, centerId: CS, courseId: KHOA, lessonId: BAI, date: new Date(`${NGAY_CASE}T00:00:00.000Z`),
      startTime: "18:00", endTime: "19:30", roomId: PHONG, teacherId: GV, status: "SCHEDULED", createdById: GV,
    },
  });
  await db.makeupCaseStudent.createMany({
    data: [
      { id: SV, caseId: CASE, makeupNeedId: NEED, status: "PLACED", dungLuot: true, centerId: CS, addedById: GV },
      { id: SV2, caseId: CASE, makeupNeedId: NEED2, status: "PLACED", dungLuot: true, centerId: CS, addedById: GV },
    ],
  });
}

const THANG_10 = { now: luc(15, 18, 30) }; // giữa buổi dạy

/** Chạy checker T01 như script: chỉ-đọc, REPEATABLE READ. Trả các phát hiện NHẮC TỚI fixture này. */
async function kiem(): Promise<Finding[]> {
  // 18:45 = GIỮA buổi dạy: không "case quá giờ" (TV-13) và không "case ở tương lai" (TV-12).
  const o = { now: luc(15, 18, 45), tuNgayYmd: "2026-09-20" };
  const r = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      return chayToanVen(await docSnapshot(tx, o), o);
    },
    { timeout: 60_000, isolationLevel: "RepeatableRead" },
  );
  return r.findings.filter((f) => f.id.includes(T) || Object.values(f.lienQuan ?? {}).some((v) => v.includes(T)));
}

const gvDiemDanh = (coMat: boolean, now: Date, sv = SV) => diemDanhBu(null, { caseStudentId: sv, coMat, chiGiaoVien: GV, now });
const lyDoLoi = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiHocBu ? e.message : `LOI-KHAC: ${String(e)}`;
  }
};

describe.skipIf(!RUN_DB_TESTS)("[DDB] điểm danh buổi dạy bù — T02", () => {
  beforeEach(dung);
  afterAll(don);

  it("[DDB-00] fixture sạch: checker T01 ra 0 phát hiện (đối chứng — thiếu nó thì các ca dưới có thể xanh vì không thấy gì)", async () => {
    expect(await db.makeupCaseStudent.count({ where: { caseId: CASE, status: "PLACED" } })).toBe(2);
    expect(await kiem()).toEqual([]);
  });

  // ── HB-13 ──────────────────────────────────────────────────────────────────────────────
  it("[DDB-01] HB-13: bé CÓ MẶT buổi bù ⇒ dòng COMPLETED, buổi gốc giữ NGUYÊN 'vắng có phép' + dấu MADE_UP, lý do vắng còn", async () => {
    await gvDiemDanh(true, THANG_10.now);
    const a = await db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: BUOI, studentId: HV } } });
    expect(a.status).toBe("ABSENT_EXCUSED"); // KHÔNG còn bị ghi đè thành PRESENT
    expect(a.makeupStatus).toBe("MADE_UP");
    expect(a.absenceReason).toBe("Con ốm");
    const n = await db.makeupNeed.findUniqueOrThrow({ where: { id: NEED } });
    expect(n.status).toBe("COMPLETED");
    expect(n.usedQuota).toBe(true);
    expect((await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: SV } })).status).toBe("PRESENT");
    // Oracle: không còn TV-20 (buổi gốc bị ghi đè) — chính lỗi mà checker T01 sinh ra để bắt.
    expect((await kiem()).filter((f) => f.luat === "TV-20")).toEqual([]);
  });

  it("[DDB-02] bé VẮNG buổi bù ⇒ dòng về PENDING, KHÔNG tiêu lượt, buổi gốc không đổi gì", async () => {
    await gvDiemDanh(false, THANG_10.now);
    const a = await db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: BUOI, studentId: HV } } });
    expect(a).toMatchObject({ status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP" });
    const n = await db.makeupNeed.findUniqueOrThrow({ where: { id: NEED } });
    expect(n).toMatchObject({ status: "PENDING", usedQuota: false });
  });

  // ── HB-03: cổng thời gian ──────────────────────────────────────────────────────────────
  it("[DDB-03] HB-03: TRƯỚC giờ mở (17:44 VN) ⇒ từ chối và KHÔNG đổi gì — bé còn PLACED, dòng còn SCHEDULED, không tiêu lượt", async () => {
    const loi = await lyDoLoi(gvDiemDanh(true, luc(15, 17, 44)));
    expect(loi).toContain("Chưa tới giờ điểm danh");
    expect((await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: SV } })).status).toBe("PLACED");
    expect(await db.makeupNeed.findUniqueOrThrow({ where: { id: NEED } })).toMatchObject({ status: "SCHEDULED", usedQuota: false });
    expect((await db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: BUOI, studentId: HV } } })).makeupStatus).toBe("NEEDS_MAKEUP");
    // 17:45 thì mở.
    await gvDiemDanh(true, luc(15, 17, 45));
    expect((await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: SV } })).status).toBe("PRESENT");
  });

  it("[DDB-04] giáo viên quá 23:59 ngày dạy ⇒ từ chối; quản lý còn được 3 ngày; quản lý QUÁ 3 ngày không ghi đè ⇒ từ chối", async () => {
    expect(await lyDoLoi(gvDiemDanh(true, luc(16, 0, 1)))).toContain("quá hạn");
    const ql = (now: Date, ghiDe?: { lyDo: string; ten: string }, sv = SV) => diemDanhBu(ADMIN, { caseStudentId: sv, coMat: true, now, ghiDe });
    await ql(luc(18, 23, 59)); // D+3 23:59
    expect((await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: SV } })).status).toBe("PRESENT");
    expect(await lyDoLoi(ql(luc(19, 0, 1), undefined, SV2))).toContain("ghi đè");
    expect((await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: SV2 } })).status).toBe("PLACED");
  });

  it("[DDB-05] ghi đè quá hạn: lý do < 10 ký tự bị từ chối; đủ lý do ⇒ điểm danh + MỘT dòng audit cùng transaction; giáo viên không ghi đè được", async () => {
    const qua = luc(25, 9, 0);
    expect(await lyDoLoi(diemDanhBu(ADMIN, { caseStudentId: SV, coMat: true, now: qua, ghiDe: { lyDo: "quên", ten: "QL" } }))).toContain("ít nhất 10 ký tự");
    expect((await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: SV } })).status).toBe("PLACED");
    expect(await db.auditLog.count({ where: { entityId: SV } })).toBe(0);
    // Giáo viên (actor = null) không có đường ghi đè dù truyền gì.
    expect(await lyDoLoi(diemDanhBu(null, { caseStudentId: SV, coMat: true, chiGiaoVien: GV, now: qua, ghiDe: { lyDo: "giáo viên tự ghi đè", ten: "GV" } }))).toContain("quá hạn");
    await diemDanhBu(ADMIN, { caseStudentId: SV, coMat: true, now: qua, ghiDe: { lyDo: "Giáo viên báo ốm, bù điểm danh sau", ten: "QL Nguyễn" } });
    expect((await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: SV } })).status).toBe("PRESENT");
    const au = await db.auditLog.findMany({ where: { entityId: SV } });
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ action: "hoc-bu.diem-danh-ghi-de-qua-han", actorName: "QL Nguyễn", module: "hoc-bu" });
    expect(au[0]!.reason).toBe("Giáo viên báo ốm, bù điểm danh sau");
    // Điểm danh TRONG hạn dù có truyền ghiDe thì KHÔNG audit (không đánh dấu ghi đè khi không cần).
    await diemDanhBu(ADMIN, { caseStudentId: SV2, coMat: true, now: luc(15, 19, 0), ghiDe: { lyDo: "không cần ghi đè đâu", ten: "QL" } });
    expect(await db.auditLog.count({ where: { entityId: SV2 } })).toBe(0);
  });

  it("[DDB-06] ghi đè KHÔNG mở sớm: quá hạn thì cứu được, nhưng 'ghi đè' trước giờ mở vẫn bị chặn", async () => {
    const loi = await lyDoLoi(diemDanhBu(ADMIN, { caseStudentId: SV, coMat: true, now: luc(14, 9, 0), ghiDe: { lyDo: "muốn điểm danh sớm hơn", ten: "QL" } }));
    expect(loi).toContain("Chưa tới giờ điểm danh");
    expect(await db.auditLog.count({ where: { entityId: SV } })).toBe(0);
  });

  // ── Đồng thời ──────────────────────────────────────────────────────────────────────────
  it("[DDB-07] hai lượt điểm danh ĐỒNG THỜI trên CÙNG một bé: đúng MỘT lượt thành công, lượt kia ném — không tiêu lượt hai lần", async () => {
    const kq = await Promise.allSettled([gvDiemDanh(true, THANG_10.now), gvDiemDanh(true, THANG_10.now)]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const loi = kq.find((k) => k.status === "rejected") as PromiseRejectedResult;
    expect(loi.reason).toBeInstanceOf(LoiHocBu);
    expect(await db.makeupNeed.findUniqueOrThrow({ where: { id: NEED } })).toMatchObject({ status: "COMPLETED", usedQuota: true });
    expect((await kiem()).filter((f) => f.luat === "TV-15" || f.luat === "TV-17")).toEqual([]);
  });

  it("[DDB-08] hai lượt điểm danh đồng thời trên HAI bé của cùng case: cả hai thành công, case chốt COMPLETED đúng một lần", async () => {
    await Promise.all([gvDiemDanh(true, THANG_10.now, SV), gvDiemDanh(true, THANG_10.now, SV2)]);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: CASE } })).status).toBe("COMPLETED");
    expect(await db.makeupCaseStudent.count({ where: { caseId: CASE, status: "PRESENT" } })).toBe(2);
    expect(await kiem()).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// HB-17 — tạo phí
describe.skipIf(!RUN_DB_TESTS)("[PHI] tạo phí học bù — HB-17", () => {
  /** Bé đã HẾT lượt (không dòng nào đang giữ lượt, bài không có hạn mức) và dòng chờ PENDING: đủ điều kiện thu phí. */
  async function dongChoThuPhi() {
    await dung();
    // Hạn mức học bù của học phần = 0 ⇒ bé HẾT lượt ngay từ đầu (mặc định mỗi học phần 1 lượt).
    await db.courseModuleMakeupQuota.create({ data: { courseId: KHOA, moduleCode: MA_HP, luotBu: 0 } });
    await db.makeupCaseStudent.deleteMany({ where: { caseId: CASE } });
    await db.makeupCase.delete({ where: { id: CASE } });
    await db.makeupNeed.updateMany({ where: { id: { in: [NEED, NEED2] } }, data: { status: "PENDING" } });
  }
  const donPhiCua = () => db.orderItem.findMany({ where: { studentId: HV, type: "MAKEUP_FEE" }, select: { id: true, orderId: true } });

  beforeEach(dongChoThuPhi);
  afterAll(don);

  it("[PHI-00] đối chứng: thế giới này THẬT SỰ ở trạng thái 'cần thu phí' — tạo phí một lần thành công và để lại đúng một đơn, một con trỏ", async () => {
    const kq = await taoPhiBu(ADMIN, NEED);
    const items = await donPhiCua();
    expect(items).toHaveLength(1);
    expect(items[0]!.orderId).toBe(kq.orderId);
    const n = await db.makeupNeed.findUniqueOrThrow({ where: { id: NEED } });
    expect(n.feeOrderItemId).toBe(items[0]!.id);
    expect(await kiem()).toEqual([]); // không đơn mồ côi
  });

  it("[PHI-01] HB-17: hai lượt bấm ĐỒNG THỜI ⇒ đúng MỘT đơn, lượt kia ném LoiHocBu, không đơn mồ côi", async () => {
    const kq = await Promise.allSettled([taoPhiBu(ADMIN, NEED), taoPhiBu(ADMIN, NEED)]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const loi = kq.find((k) => k.status === "rejected") as PromiseRejectedResult;
    expect(loi.reason).toBeInstanceOf(LoiHocBu);
    expect(await donPhiCua()).toHaveLength(1);
    expect(await db.orderItem.count({ where: { studentId: HV, type: "MAKEUP_FEE" } })).toBe(1);
    expect((await kiem()).filter((f) => f.luat === "TV-07")).toEqual([]);
  });

  it("[PHI-02] ba lượt đồng thời ⇒ vẫn đúng MỘT đơn", async () => {
    // Ba, không phải nhiều hơn: mỗi lượt giữ MỘT kết nối cho transaction tương tác + một kết nối cho các câu đọc
    // trước nó, mà hồ kết nối của Prisma ở máy test chỉ vài chỗ — nhiều hơn là test đi đo hồ kết nối, không đo cổng.
    const kq = await Promise.allSettled(Array.from({ length: 3 }, () => taoPhiBu(ADMIN, NEED)));
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    expect(await donPhiCua()).toHaveLength(1);
  }, 30_000);

  it("[PHI-03] bấm lần hai SAU khi đã có phí còn sống ⇒ từ chối; đơn phí đã HUỶ thì tạo lại được (con trỏ chết không chặn)", async () => {
    const dau = await taoPhiBu(ADMIN, NEED);
    expect(await lyDoLoi(taoPhiBu(ADMIN, NEED))).toContain("phí bù đang chờ thu");
    await db.order.update({ where: { id: dau.orderId }, data: { status: "CANCELLED" } });
    const sau = await taoPhiBu(ADMIN, NEED);
    expect(sau.orderId).not.toBe(dau.orderId);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: NEED } })).feeOrderItemId).toBe((await db.orderItem.findFirstOrThrow({ where: { orderId: sau.orderId } })).id);
  });

  it("[PHI-04] vừa được MIỄN PHÍ giữa hai lượt ⇒ không tạo đơn (cổng đọc lại trong khoá)", async () => {
    await db.makeupNeed.update({ where: { id: NEED }, data: { freeApprovedAt: new Date("2026-10-07T03:00:00Z"), freeApprovedById: GV, freeReason: "Ngoại lệ fixture" } });
    expect(await lyDoLoi(taoPhiBu(ADMIN, NEED))).not.toBeNull();
    expect(await donPhiCua()).toHaveLength(0);
  });
});
