// tests/finance/bao-luu-hoso.test.ts — LẬP · DUYỆT · TỪ CHỐI · HUỶ hồ sơ bảo lưu trên POSTGRES THẬT. PHIÊN 3.
//
// Chạy:  pnpm test:finance-db
// Kịch bản: khoá 48 buổi, lớp Thứ 7 hằng tuần, An đã học (docs/bao-luu/spec.md §K). Đồng hồ ĐÓNG BĂNG (luật 19):
// NOW = 10:00 sáng thứ Tư 07/10/2026 giờ VN ⇒ các thứ Bảy đã qua: 26/09 và 03/10 (hai buổi), 19/09 (buổi thứ ba).
//
// Chat giả (spy): lớp thật đòi dựng cả hội thoại; điều cần khẳng định là LỜI GỌI nằm trong CÙNG giao dịch — và khi
// nó ném thì mọi thứ phía trước cuộn ngược (ca rollback).
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

const h = vi.hoisted(() => ({ sync: vi.fn(async (_tx: unknown, _classId: string) => {}) }));
vi.mock("@/lib/chat/sync-membership", () => ({ syncConversationMembership: h.sync }));

import { lapHoSo, duyetHoSo, tuChoiHoSo, huyHoSo, type LapInput, type PhuThuoc } from "@/lib/bao-luu/dich-vu";
import { dangBaoLuu } from "@/lib/bao-luu/dang-bao-luu-db";
import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";

if (!RUN_DB_TESTS) console.warn(`[BL3-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl3-";
const CS = `${T}cs`;
const OU = `${T}ou`;
const KHOA = `${T}khoa`;
const KHOA2 = `${T}khoa2`;
const LOP = `${T}lop`;
const LOP2 = `${T}lop2`;
const HV = `${T}hv-an`;
const HV_KHAC = `${T}hv-khac`;
const GD = `${T}gd-an`;
const GD2 = `${T}gd-an-2`;
const GD_KHAC = `${T}gd-khac`;
const DON = `${T}don`;
const OI = `${T}oi`;

const SALE = { id: `${T}sale`, name: "Sale fixture" };
const QLTT = { id: `${T}qltt`, name: "QLTT fixture" };
const NOW = new Date("2026-10-07T03:00:00Z");
const NGAY = 86_400_000;
const KHOA_DON = "bao-luu/2026-10/aaaaaaaa11111111.pdf";
const KHOA_MC = "bao-luu/2026-10/bbbbbbbb22222222.jpg";

const DEPS: PhuThuoc = { xacMinhTep: async () => ({ ok: true }), khoDaCauHinh: () => true };

async function don() {
  await db.makeupNeed.deleteMany({ where: { studentId: { in: [HV, HV_KHAC] } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.studentReserveEvent.deleteMany({ where: { reserve: { studentId: { in: [HV, HV_KHAC] } } } });
  await db.studentReserve.deleteMany({ where: { studentId: { in: [HV, HV_KHAC] } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: T } } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { in: [GD, GD2, GD_KHAC] } } });
  await db.enrollment.deleteMany({ where: { id: { in: [GD, GD2, GD_KHAC] } } });
  await db.classSession.deleteMany({ where: { classId: { in: [LOP, LOP2] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP2] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA2] } } });
  await db.student.deleteMany({ where: { id: { in: [HV, HV_KHAC] } } });
  await db.orgUnit.deleteMany({ where: { id: OU } });
  await db.center.deleteMany({ where: { id: CS } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["pause.enabled", "pause.maxOverdueDebtDays"] } } });
}

async function batCongTac(bat: boolean) {
  await db.systemSetting.upsert({
    where: { key: "pause.enabled" },
    create: { key: "pause.enabled", valueJson: bat },
    update: { valueJson: bat },
  });
}

async function dungFixture() {
  await don();
  h.sync.mockReset();
  h.sync.mockImplementation(async () => {});
  await db.center.create({ data: { id: CS, name: "CS BL3", slug: CS, address: "x" } });
  await db.orgUnit.create({ data: { id: OU, type: "CENTER", code: `${T}OU`, name: "ĐV BL3", centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Sata 3 BL3", slug: KHOA, totalSessions: 48 } });
  await db.course.create({ data: { id: KHOA2, name: "RoboSim BL3", slug: KHOA2, totalSessions: 12 } });
  await db.class.create({ data: { id: LOP, name: "Lớp T7 BL3", courseId: KHOA, centerId: CS } });
  await db.class.create({ data: { id: LOP2, name: "Lớp RoboSim BL3", courseId: KHOA2, centerId: CS } });
  // Các thứ Bảy hằng tuần: 05/09, 12/09, 19/09, 26/09, 03/10 (đã qua) và 10/10 (tương lai). Giờ 09:00 VN.
  for (const d of ["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03", "2026-10-10"]) {
    await db.classSession.create({ data: { classId: LOP, date: new Date(`${d}T02:00:00Z`), centerId: CS } });
  }
  await db.student.create({ data: { id: HV, name: "An BL3", centerId: CS, orgUnitId: OU } });
  await db.student.create({ data: { id: HV_KHAC, name: "Bé khác BL3", centerId: CS, orgUnitId: OU } });
  await db.enrollment.create({ data: { id: GD, studentId: HV, classId: LOP, courseId: KHOA, status: "ACTIVE", centerId: CS } });
  await db.enrollment.create({ data: { id: GD2, studentId: HV, classId: LOP2, courseId: KHOA2, status: "STUDYING", centerId: CS } });
  await db.enrollment.create({ data: { id: GD_KHAC, studentId: HV_KHAC, classId: LOP, courseId: KHOA, status: "ACTIVE", centerId: CS } });
  await batCongTac(true);
}

const lap = (o: Partial<LapInput> = {}, nguoi = SALE, deps = DEPS, now = NOW) =>
  lapHoSo(
    {
      studentId: HV, enrollmentIds: [GD], reasonCode: "FAMILY", reasonNote: "", expectedReturnDate: null, firstAbsentDate: null,
      applicationFileKey: KHOA_DON, evidenceFileKeys: [], vuotTran: null, ...o,
    },
    nguoi, now, deps,
  );
const loi = (r: { ok: boolean; loi?: string[] }) => (r.ok ? "" : (r.loi ?? []).join(" | "));
async function lapOk(o: Partial<LapInput> = {}) {
  const r = await lap(o);
  if (!r.ok) throw new Error(`lập thất bại: ${loi(r)}`);
  return r.data.reserveIds[0]!;
}
const hs = (id: string) => db.studentReserve.findUniqueOrThrow({ where: { id } });
const kinds = async (id: string) => (await db.studentReserveEvent.findMany({ where: { reserveId: id }, orderBy: { at: "asc" } })).map((e) => e.kind);

describe.skipIf(!RUN_DB_TESTS)("[BL3-DB] bảo lưu: lập · duyệt · từ chối · huỷ", () => {
  beforeEach(dungFixture);
  afterAll(don);

  describe("LẬP", () => {
    it("[BL3-DB-01] lập hợp lệ ⇒ PENDING, isActive=false, cơ sở chép từ học viên, MỘT sự kiện REQUEST; học viên/ghi danh CHƯA bị đụng", async () => {
      const id = await lapOk({ reasonCode: "SCHEDULE", reasonNote: "đổi lịch làm việc của bố" });
      const r = await hs(id);
      expect(r).toMatchObject({
        status: "PENDING", isActive: false, type: "PARENT", centerId: CS, orgUnitId: OU, enrollmentId: GD, studentId: HV,
        reasonCode: "SCHEDULE", createdByUserId: SALE.id, applicationFileKey: KHOA_DON, approvedAt: null,
      });
      expect(await kinds(id)).toEqual(["REQUEST"]);
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("ACTIVE");
      expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("ACTIVE");
      expect(await dangBaoLuu(GD, NOW)).toBe(false); // PENDING chưa nghỉ ⇒ chưa phải "đang bảo lưu"
    });

    it("[BL3-DB-02] BR-07 (TC-02) thiếu đơn ⇒ chặn, KHÔNG ghi gì", async () => {
      const r = await lap({ applicationFileKey: null });
      expect(loi(r)).toMatch(/đơn bảo lưu đã ký/);
      expect(await db.studentReserve.count({ where: { studentId: HV } })).toBe(0);
    });

    it("[BL3-DB-03] TC-22 công tắc TẮT ⇒ từ chối, không ghi; BẬT lại ⇒ qua (đối chứng dương)", async () => {
      await batCongTac(false);
      expect(loi(await lap())).toMatch(/chưa được bật/);
      expect(await db.studentReserve.count({ where: { studentId: HV } })).toBe(0);
      await batCongTac(true);
      expect((await lap()).ok).toBe(true);
    });

    it("[BL3-DB-04] BR-02 (TC-21) khoá allowPause=false ⇒ chặn", async () => {
      await db.course.update({ where: { id: KHOA }, data: { allowPause: false } });
      expect(loi(await lap())).toMatch(/không áp dụng bảo lưu/);
    });

    it("[BL3-DB-05] BR-08 (TC-19) REJECTED/CANCELLED không tính ⇒ lập lại được; đã từng ACTIVE rồi phục học (ENDED) thì tính ⇒ chặn", async () => {
      const a = await lapOk();
      expect((await tuChoiHoSo({ reserveId: a, lyDo: "thiếu chữ ký phụ huynh" }, QLTT, NOW)).ok).toBe(true);
      const b = await lapOk(); // sau REJECTED: lập lại được
      expect((await huyHoSo({ reserveId: b, lyDo: "phụ huynh đổi ý" }, SALE, NOW)).ok).toBe(true);
      const c = await lapOk(); // sau CANCELLED: lập lại được
      expect((await duyetHoSo({ reserveId: c, lui: false }, QLTT, NOW)).ok).toBe(true);
      // Phục học sớm (ACTIVE → ENDED) — mô phỏng bằng ghi trực tiếp vì luồng phục học thuộc Phiên 6.
      await db.studentReserve.update({ where: { id: c }, data: { status: "ENDED", isActive: false, endedAt: NOW } });
      await db.enrollment.update({ where: { id: GD }, data: { status: "ACTIVE" } });
      expect(loi(await lap())).toMatch(/Đã đủ 1 lần bảo lưu/);
    });

    it("[BL3-DB-06] đang có hồ sơ CHỜ DUYỆT ⇒ lập hồ sơ thứ hai bị chặn với câu nói đúng (không báo 'đã đủ lần')", async () => {
      await lapOk();
      const r = await lap();
      expect(loi(r)).toMatch(/đang có hồ sơ bảo lưu còn hiệu lực/);
      expect(loi(r)).not.toMatch(/Đã đủ/);
    });

    it("[BL3-DB-07] IDOR: ghi danh của học viên KHÁC ⇒ chặn, không tạo gì", async () => {
      const r = await lap({ enrollmentIds: [GD_KHAC] });
      expect(loi(r)).toMatch(/không thuộc học viên này/);
      expect(await db.studentReserve.count({ where: { enrollmentId: GD_KHAC } })).toBe(0);
    });

    it("[BL3-DB-08] nhiều ghi danh = nhiều hồ sơ trong MỘT giao dịch; một ghi danh hỏng ⇒ KHÔNG hồ sơ nào được tạo", async () => {
      const ok = await lap({ enrollmentIds: [GD, GD2] });
      expect(ok.ok && ok.data.reserveIds).toHaveLength(2);
      expect(await db.studentReserve.count({ where: { studentId: HV, status: "PENDING" } })).toBe(2);

      await db.studentReserve.deleteMany({ where: { studentId: HV } }); // sạch rồi thử lại với một khoá bị tắt
      await db.course.update({ where: { id: KHOA2 }, data: { allowPause: false } });
      const hong = await lap({ enrollmentIds: [GD, GD2] });
      expect(hong.ok).toBe(false);
      expect(loi(hong)).toMatch(/RoboSim BL3/); // nói rõ ghi danh nào hỏng
      expect(await db.studentReserve.count({ where: { studentId: HV } })).toBe(0);
    });

    it("[BL3-DB-09] BR-05 ốm đau dài thiếu minh chứng ⇒ chặn; có minh chứng ⇒ qua; tệp sai hình dạng ⇒ chặn", async () => {
      const dai = new Date(NOW.getTime() + 60 * NGAY);
      expect(loi(await lap({ reasonCode: "ILLNESS", expectedReturnDate: dai }))).toMatch(/minh chứng/);
      expect((await lap({ reasonCode: "ILLNESS", expectedReturnDate: dai, evidenceFileKeys: [KHOA_MC] })).ok).toBe(true);
      await db.studentReserve.deleteMany({ where: { studentId: HV } });
      expect(loi(await lap({ evidenceFileKeys: ["hoa-don/CS1/2026/don1/u.pdf"] }))).toMatch(/Tệp đính kèm không hợp lệ/);
      expect(loi(await lap({ applicationFileKey: "uploads/documents/x.pdf" }))).toMatch(/Tệp đính kèm không hợp lệ/);
    });

    it("[BL3-DB-10] tệp không có trong kho / kho chưa cấu hình ⇒ chặn trước khi ghi", async () => {
      const thieu: PhuThuoc = { xacMinhTep: async () => ({ ok: false, thongDiep: "Không thấy tệp trên kho" }), khoDaCauHinh: () => true };
      expect(loi(await lap({}, SALE, thieu))).toMatch(/Không thấy tệp/);
      expect(loi(await lap({}, SALE, { ...DEPS, khoDaCauHinh: () => false }))).toMatch(/chưa cấu hình/);
      expect(await db.studentReserve.count({ where: { studentId: HV } })).toBe(0);
    });
  });

  describe("DUYỆT", () => {
    it("[BL3-DB-20] duyệt ⇒ APPROVE rồi START trong MỘT giao dịch: ACTIVE, isActive, hạn tiêu chuẩn = ngày bắt đầu + maxMonths, policySnapshot, ghi danh + học viên PAUSED, chat đồng bộ", async () => {
      const id = await lapOk();
      const r = await duyetHoSo({ reserveId: id, lui: false, ghiChu: "đủ giấy tờ" }, QLTT, NOW);
      expect(r.ok).toBe(true);
      const x = await hs(id);
      expect(x).toMatchObject({ status: "ACTIVE", isActive: true, approvedById: QLTT.id, endedAt: null });
      expect(x.startedAt.toISOString()).toBe(NOW.toISOString());
      expect(x.approvedAt?.toISOString()).toBe(NOW.toISOString());
      expect(x.standardEndDate?.toISOString()).toBe(hanToiDaBaoLuu(NOW, 6).toISOString()); // maxMonths mặc định 6
      expect(x.policySnapshot).toMatchObject({ maxMonths: 6, backdateMaxSessions: 2, maxOverdueDebtDays: 7 });
      expect(await kinds(id)).toEqual(["REQUEST", "APPROVE", "START"]);
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("PAUSED");
      // An còn ghi danh thứ hai đang học ⇒ học viên VẪN "Đang học" (chỉ khoá bảo lưu đó nghỉ).
      expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("ACTIVE");
      expect(await dangBaoLuu(GD, NOW)).toBe(true);
      expect(await dangBaoLuu(GD2, NOW)).toBe(false);
      expect(h.sync).toHaveBeenCalledWith(expect.anything(), LOP);
      expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: GD, toStatus: "PAUSED" } })).toBe(1);
      expect(await db.auditLog.count({ where: { entityId: id } })).toBeGreaterThanOrEqual(3);
    });

    it("[BL3-DB-21] học viên chỉ còn MỘT ghi danh ⇒ bảo lưu nó thì học viên cũng PAUSED", async () => {
      await db.enrollment.update({ where: { id: GD2 }, data: { status: "COMPLETED" } });
      const id = await lapOk();
      expect((await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW)).ok).toBe(true);
      expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("PAUSED");
    });

    it("[BL3-DB-22] TC-01 MAKER–CHECKER: người lập duyệt hồ sơ của chính mình ⇒ TỪ CHỐI ở server, hồ sơ nguyên PENDING; người khác duyệt được", async () => {
      const id = await lapOk();
      const r = await duyetHoSo({ reserveId: id, lui: false }, SALE, NOW);
      expect(loi(r)).toMatch(/không được duyệt hồ sơ của chính mình/);
      expect((await hs(id)).status).toBe("PENDING");
      expect(await kinds(id)).toEqual(["REQUEST"]);
      expect((await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW)).ok).toBe(true);
    });

    it("[BL3-DB-23] TC-03 BR-06 nợ quá hạn 8 ngày ⇒ chặn DUYỆT (kiểm lại lúc duyệt); đúng 7 ngày ⇒ qua", async () => {
      await db.order.create({ data: { id: DON, code: "ORD-BL3-1", type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH", customerPhone: "0900000003", totalAmount: 5_000_000, centerId: CS } });
      await db.orderItem.create({ data: { id: OI, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 5_000_000, totalPrice: 5_000_000, enrollmentId: GD } });
      const quaHan = (ngay: number) =>
        db.paymentRequest.create({ data: { orderId: DON, orderItemId: OI, centerId: CS, installmentNo: 1, amountDue: 1_000_000, dueDate: new Date(NOW.getTime() - ngay * NGAY), status: "PENDING" } });
      const id = await lapOk(); // lập vẫn được: nợ chỉ chặn lúc DUYỆT
      const p = await quaHan(8);
      const r = await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW);
      expect(loi(r)).toMatch(/quá 8 ngày/);
      expect((await hs(id)).status).toBe("PENDING");
      await db.paymentRequest.update({ where: { id: p.id }, data: { dueDate: new Date(NOW.getTime() - 7 * NGAY) } });
      expect((await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW)).ok).toBe(true);
    });

    it("[BL3-DB-24] khoản đã đóng đủ (phân bổ ≥ số phải thu) KHÔNG tính là nợ quá hạn", async () => {
      await db.order.create({ data: { id: DON, code: "ORD-BL3-2", type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH", customerPhone: "0900000004", totalAmount: 1_000_000, centerId: CS } });
      await db.orderItem.create({ data: { id: OI, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 1_000_000, totalPrice: 1_000_000, enrollmentId: GD } });
      await db.paymentRequest.create({ data: { orderId: DON, orderItemId: OI, centerId: CS, installmentNo: 1, amountDue: 1_000_000, dueDate: new Date(NOW.getTime() - 30 * NGAY), status: "PAID" } });
      const id = await lapOk();
      expect((await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW)).ok).toBe(true);
    });

    it("[BL3-DB-23b] nợ quá hạn 8 ngày: LẬP vẫn được nhưng kèm CẢNH BÁO nói rõ lý do duyệt sẽ bị chặn; không nợ ⇒ không cảnh báo", async () => {
      const sach = await lapOk();
      expect((await huyHoSo({ reserveId: sach, lyDo: "lập lại để thử cảnh báo" }, SALE, NOW)).ok).toBe(true);
      await db.order.create({ data: { id: DON, code: "ORD-BL3-4", type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH", customerPhone: "0900000006", totalAmount: 5_000_000, centerId: CS } });
      await db.orderItem.create({ data: { id: OI, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 5_000_000, totalPrice: 5_000_000, enrollmentId: GD } });
      await db.paymentRequest.create({ data: { orderId: DON, orderItemId: OI, centerId: CS, installmentNo: 1, amountDue: 1_000_000, dueDate: new Date(NOW.getTime() - 8 * NGAY), status: "PENDING" } });
      const r = await lap();
      expect(r.ok && r.data.canhBao.join(" | ")).toMatch(/quá 8 ngày.*chưa duyệt được/);
    });

    it("[BL3-DB-24b] còn nợ = số phải thu − phân bổ: rót 600k/1tr ⇒ còn 400k ⇒ chặn; rót đủ 1tr (dù trạng thái phiếu chưa kịp tính lại) ⇒ KHÔNG chặn", async () => {
      await db.order.create({ data: { id: DON, code: "ORD-BL3-3", type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH", customerPhone: "0900000005", totalAmount: 1_000_000, centerId: CS } });
      await db.orderItem.create({ data: { id: OI, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 1_000_000, totalPrice: 1_000_000, enrollmentId: GD } });
      const p = await db.paymentRequest.create({ data: { orderId: DON, orderItemId: OI, centerId: CS, installmentNo: 1, amountDue: 1_000_000, dueDate: new Date(NOW.getTime() - 30 * NGAY), status: "PARTIAL" } });
      const gd = await db.bankTransaction.create({ data: { provider: "SEPAY", providerTxnId: `${T}tx1`, amount: 1_000_000, transferredAt: NOW } });
      const rot = (amount: number) =>
        db.paymentAllocation.upsert({
          where: { bankTransactionId_paymentRequestId: { bankTransactionId: gd.id, paymentRequestId: p.id } },
          create: { bankTransactionId: gd.id, paymentRequestId: p.id, amount, centerId: CS },
          update: { amount },
        });
      await rot(600_000);
      const id = await lapOk();
      expect(loi(await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW))).toMatch(/quá 30 ngày/);
      await rot(1_000_000);
      expect((await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW)).ok).toBe(true);
    });

    it("[BL3-DB-25] TC-04/05 BR-09: lùi 3 buổi ⇒ chặn; lùi 2 buổi ⇒ OK, ngày bắt đầu = 00:00 VN buổi nghỉ đầu tiên", async () => {
      const ba = await lapOk({ firstAbsentDate: new Date("2026-09-19T02:00:00Z") });
      const r3 = await duyetHoSo({ reserveId: ba, lui: true }, QLTT, NOW);
      expect(loi(r3)).toMatch(/tối đa 2 buổi.*đã có 3 buổi/);
      expect((await hs(ba)).status).toBe("PENDING");
      await huyHoSo({ reserveId: ba, lyDo: "làm lại với buổi nghỉ khác" }, SALE, NOW);

      const hai = await lapOk({ firstAbsentDate: new Date("2026-09-26T02:00:00Z") });
      const r2 = await duyetHoSo({ reserveId: hai, lui: true }, QLTT, NOW);
      expect(r2.ok && r2.data.soBuoiLui).toBe(2);
      const x = await hs(hai);
      expect(x.startedAt.toISOString()).toBe("2026-09-25T17:00:00.000Z"); // 26/09 00:00 VN
      // Buổi 26/09 và 03/10 nằm trong khoảng hiệu lực ⇒ KHÔNG tính vắng (BR-09) — qua dangBaoLuu, không qua enum.
      expect(await dangBaoLuu(GD, new Date("2026-09-26T02:00:00Z"))).toBe(true);
      expect(await dangBaoLuu(GD, new Date("2026-09-19T02:00:00Z"))).toBe(false); // buổi trước khoảng lùi: vẫn tính
    });

    it("[BL4-DB-01] BR-09: duyệt LÙI 2 buổi ⇒ nhu cầu bù PENDING của đúng 2 buổi đó bị thu hồi; buổi TRƯỚC khoảng lùi và nhu cầu đã SCHEDULED giữ nguyên", async () => {
      const buoi = async (ngay: string) =>
        (await db.classSession.findFirstOrThrow({ where: { classId: LOP, date: new Date(`${ngay}T02:00:00Z`) } })).id;
      const [truoc, lui1, lui2] = [await buoi("2026-09-19"), await buoi("2026-09-26"), await buoi("2026-10-03")];
      const need = (missedSessionId: string, status: "PENDING" | "SCHEDULED") =>
        db.makeupNeed.create({ data: { studentId: HV, classId: LOP, centerId: CS, missedSessionId, status } });
      const [nTruoc, nLui1, nLui2] = [await need(truoc, "PENDING"), await need(lui1, "PENDING"), await need(lui2, "SCHEDULED")];

      const id = await lapOk({ firstAbsentDate: new Date("2026-09-26T02:00:00Z") });
      const r = await duyetHoSo({ reserveId: id, lui: true }, QLTT, NOW);
      expect(r.ok && r.data.soBuoiLui).toBe(2);

      const tt = async (n: { id: string }) => (await db.makeupNeed.findUniqueOrThrow({ where: { id: n.id } })).status;
      expect(await tt(nLui1)).toBe("CANCELLED"); // PENDING trong khoảng lùi ⇒ thu hồi
      expect(await tt(nLui2)).toBe("SCHEDULED"); // đã hẹn buổi bù ⇒ KHÔNG tự huỷ sau lưng người xếp bù
      expect(await tt(nTruoc)).toBe("PENDING"); // buổi TRƯỚC khoảng lùi ⇒ vẫn là nghĩa vụ bù
      const start = await db.studentReserveEvent.findFirstOrThrow({ where: { reserveId: id, kind: "START" } });
      expect(start.after).toMatchObject({ makeupNeedDaHuy: 1 });
    });

    it("[BL3-DB-26] duyệt KHÔNG lùi dù hồ sơ có khai buổi nghỉ đầu tiên ⇒ bắt đầu từ ngày duyệt", async () => {
      const id = await lapOk({ firstAbsentDate: new Date("2026-09-19T02:00:00Z") });
      const r = await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW);
      expect(r.ok && r.data.soBuoiLui).toBe(0);
      expect((await hs(id)).startedAt.toISOString()).toBe(NOW.toISOString());
    });

    it("[BL3-DB-27] xin lùi (lui=true) mà hồ sơ không khai buổi nghỉ đầu tiên ⇒ chặn", async () => {
      const id = await lapOk();
      expect(loi(await duyetHoSo({ reserveId: id, lui: true }, QLTT, NOW))).toMatch(/không khai buổi nghỉ đầu tiên/);
    });

    it("[BL3-DB-28] ghi danh đã đổi trạng thái giữa lúc lập và lúc duyệt (không còn đang học) ⇒ chặn duyệt, không ghi", async () => {
      const id = await lapOk();
      await db.enrollment.update({ where: { id: GD }, data: { status: "WITHDREW" } });
      expect(loi(await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW))).toMatch(/không còn đang học/);
      expect((await hs(id)).status).toBe("PENDING");
    });

    it("[BL3-DB-29] ROLLBACK TRỌN: một bước giữa chừng ném (đồng bộ chat) ⇒ hồ sơ vẫn PENDING, ghi danh vẫn ACTIVE, KHÔNG sự kiện APPROVE/START, KHÔNG audit chuyển", async () => {
      const id = await lapOk();
      const truocAudit = await db.auditLog.count({ where: { entityId: { in: [id, GD, HV] } } });
      h.sync.mockRejectedValueOnce(new Error("chat down"));
      await expect(duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW)).rejects.toThrow("chat down");
      expect((await hs(id)).status).toBe("PENDING");
      expect((await hs(id)).approvedAt).toBeNull();
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("ACTIVE");
      expect(await kinds(id)).toEqual(["REQUEST"]);
      expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: GD } })).toBe(0);
      expect(await db.auditLog.count({ where: { entityId: { in: [id, GD, HV] } } })).toBe(truocAudit);
      // Đối chứng dương: thử lại sau khi chat khoẻ lại ⇒ duyệt được.
      expect((await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW)).ok).toBe(true);
    });

    it("[BL3-DB-30] ĐUA: hai người cùng duyệt một hồ sơ ⇒ đúng MỘT thắng, MỘT sự kiện APPROVE và MỘT START", async () => {
      const id = await lapOk();
      const [a, b] = await Promise.all([
        duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW),
        duyetHoSo({ reserveId: id, lui: false }, { id: `${T}qltt2`, name: "QLTT 2" }, NOW),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect((await kinds(id)).filter((k) => k === "APPROVE")).toHaveLength(1);
      expect((await kinds(id)).filter((k) => k === "START")).toHaveLength(1);
      expect((await db.enrollmentAuditLog.count({ where: { enrollmentId: GD, toStatus: "PAUSED" } }))).toBe(1);
    });

    it("[BL3-DB-31] công tắc TẮT ngay lúc duyệt ⇒ từ chối (TC-22), hồ sơ giữ nguyên", async () => {
      const id = await lapOk();
      await batCongTac(false);
      expect(loi(await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW))).toMatch(/chưa được bật/);
      expect((await hs(id)).status).toBe("PENDING");
    });

    it("[BL3-DB-32] duyệt hồ sơ KHÔNG còn chờ duyệt (đã huỷ) ⇒ chặn", async () => {
      const id = await lapOk();
      await huyHoSo({ reserveId: id, lyDo: "phụ huynh đổi ý" }, SALE, NOW);
      expect(loi(await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW))).toMatch(/chờ duyệt/);
    });

    it("[BL3-DB-33] BR-07 lúc duyệt: hồ sơ mất đơn (tệp bị gỡ) ⇒ chặn", async () => {
      const id = await lapOk();
      await db.studentReserve.update({ where: { id }, data: { applicationFileKey: null } });
      expect(loi(await duyetHoSo({ reserveId: id, lui: false }, QLTT, NOW))).toMatch(/chưa có đơn/);
    });
  });

  describe("TỪ CHỐI · HUỶ", () => {
    it("[BL3-DB-40] từ chối: bắt buộc lý do ≥5 ký tự; người lập không tự từ chối (dùng Huỷ); người khác từ chối ⇒ REJECTED, isActive=false, sự kiện REJECT", async () => {
      const id = await lapOk();
      expect(loi(await tuChoiHoSo({ reserveId: id, lyDo: "ko" }, QLTT, NOW))).toMatch(/ít nhất 5 ký tự/);
      expect(loi(await tuChoiHoSo({ reserveId: id, lyDo: "thiếu chữ ký" }, SALE, NOW))).toMatch(/không được từ chối hồ sơ của chính mình.*Huỷ/);
      expect((await hs(id)).status).toBe("PENDING");
      expect((await tuChoiHoSo({ reserveId: id, lyDo: "thiếu chữ ký phụ huynh" }, QLTT, NOW)).ok).toBe(true);
      expect(await hs(id)).toMatchObject({ status: "REJECTED", isActive: false, endReason: "thiếu chữ ký phụ huynh" });
      expect(await kinds(id)).toEqual(["REQUEST", "REJECT"]);
      // Người từ chối nằm ở sự kiện bất biến (cột endedBy* chỉ nói ai KẾT THÚC kỳ nghỉ, REJECTED chưa từng nghỉ).
      const sk = await db.studentReserveEvent.findFirstOrThrow({ where: { reserveId: id, kind: "REJECT" } });
      expect(sk).toMatchObject({ actorId: QLTT.id, note: "thiếu chữ ký phụ huynh", centerId: CS });
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("ACTIVE"); // không đụng ghi danh
    });

    it("[BL3-DB-41] huỷ: bắt buộc lý do; PENDING huỷ được; hồ sơ ĐÃ BẮT ĐẦU (ACTIVE) KHÔNG huỷ được; không đụng ghi danh", async () => {
      const id = await lapOk();
      expect(loi(await huyHoSo({ reserveId: id, lyDo: "" }, SALE, NOW))).toMatch(/lý do huỷ/);
      expect((await huyHoSo({ reserveId: id, lyDo: "phụ huynh đổi ý" }, SALE, NOW)).ok).toBe(true);
      expect(await hs(id)).toMatchObject({ status: "CANCELLED", isActive: false });
      expect(await kinds(id)).toEqual(["REQUEST", "CANCEL"]);
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("ACTIVE");

      const id2 = await lapOk();
      await duyetHoSo({ reserveId: id2, lui: false }, QLTT, NOW);
      expect(loi(await huyHoSo({ reserveId: id2, lyDo: "muốn huỷ" }, SALE, NOW))).toMatch(/chưa bắt đầu/);
      expect((await hs(id2)).status).toBe("ACTIVE");
    });

    it("[BL3-DB-42] hồ sơ bị huỷ/từ chối KHÔNG kéo ghi danh PAUSED mồ côi không liên quan về đang học", async () => {
      await db.enrollment.update({ where: { id: GD2 }, data: { status: "PAUSED" } }); // PAUSED mồ côi của khoá khác
      const id = await lapOk();
      await huyHoSo({ reserveId: id, lyDo: "phụ huynh đổi ý" }, SALE, NOW);
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD2 } })).status).toBe("PAUSED");
    });

    it("[BL3-DB-43] công tắc TẮT ⇒ từ chối và huỷ cũng bị từ chối", async () => {
      const id = await lapOk();
      await batCongTac(false);
      expect(loi(await tuChoiHoSo({ reserveId: id, lyDo: "thiếu giấy tờ" }, QLTT, NOW))).toMatch(/chưa được bật/);
      expect(loi(await huyHoSo({ reserveId: id, lyDo: "phụ huynh đổi ý" }, SALE, NOW))).toMatch(/chưa được bật/);
      expect((await hs(id)).status).toBe("PENDING");
    });
  });
});
