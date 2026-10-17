// tests/hoc-bu/phi-hoc-bu.test.ts — T06: PHÍ học bù + xét lại khi đơn bị huỷ/hoàn, trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
//
// Mỗi ca là MỘT lỗ T06 bịt (audit 07/10/2026):
//   · HB-31  miễn phí chỉ đặt cờ — đơn phí + mã QR của nó vẫn sống, phụ huynh còn trả được tiền cho khoản đã miễn (checker TV-06)
//   · HB-22  huỷ không bù khi đã thu phí ⇒ tiền bị bỏ rơi, không ai nói
//   · HB-21  đơn phí bị huỷ/hoàn sau khi bé đã vào case / bù xong ⇒ bù không thu tiền, không ai thấy
//   · HB-18  đơn khoá học bị huỷ/hoàn ⇒ lượt bù của bé không đổi
// Khoá T06B có hạn mức học bù 0 ở cả hai học phần ⇒ công thức cấp 0 lượt ⇒ mọi dòng cần thu phí.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { LoiHocBu, canhBaoPhiKhiHuy, goMienPhiBu, mienPhiBu, taoPhiBu } from "@/lib/hoc-bu/case-db";
import { xetLaiSauKhiDonBiLoai } from "@/lib/hoc-bu/don-doi-db";
import { khoaTaiKhoan } from "@/lib/hoc-bu/so-luot";
import { onOrderVoided } from "@/lib/_handlers/hoc-bu-don-doi";

if (!RUN_DB_TESTS) console.warn(`[PHB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-t06b-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const KHOA = id("khoa");
const CUR = id("cur");
const BAI1 = id("bai1");
const BAI2 = id("bai2");
const GV = id("gv");
const LOP = id("lop");
const HV = id("hv");
const BUOI = [id("b0"), id("b1")] as const;
const CASE = id("case");
const NEED = [id("n0"), id("n1")] as const;

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
  chiCuaSale: null, // T10: phạm vi Sale — null = thấy hết trong tầm nhìn cơ sở
} as unknown as NguoiHocBu;

async function don() {
  const items = await db.orderItem.findMany({ where: { studentId: HV }, select: { orderId: true } });
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  await db.auditLog.deleteMany({ where: { entityId: { in: [...NEED, ...orderIds] } } });
  await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { in: NEED.map((n) => `makeup.requested:${n}`) } } });
  await db.makeupCase.deleteMany({ where: { id: CASE } });
  await db.makeupNeed.deleteMany({ where: { studentId: HV } });
  await db.makeupCreditAccount.deleteMany({ where: { studentId: HV } });
  await db.courseModuleMakeupQuota.deleteMany({ where: { courseId: KHOA } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.enrollment.deleteMany({ where: { studentId: HV } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.lesson.deleteMany({ where: { id: { in: [BAI1, BAI2] } } });
  await db.curriculum.deleteMany({ where: { id: CUR } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HV } });
  await db.user.deleteMany({ where: { id: GV } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở T06B", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  await db.user.create({ data: { id: GV, name: "QL T06B", email: `${GV}@test.local`, role: "TEACHER", roles: ["TEACHER"], centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá T06B", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "GT T06B" } });
  await db.lesson.create({ data: { id: BAI1, curriculumId: CUR, order: 1, title: "Bài 1", moduleCode: "M1" } });
  await db.lesson.create({ data: { id: BAI2, curriculumId: CUR, order: 2, title: "Bài 2", moduleCode: "M2" } });
  await db.courseModuleMakeupQuota.createMany({ data: [{ courseId: KHOA, moduleCode: "M1", luotBu: 0 }, { courseId: KHOA, moduleCode: "M2", luotBu: 0 }] });
  await db.class.create({ data: { id: LOP, name: LOP, courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
  await db.student.create({ data: { id: HV, name: "Bé T06B", centerId: CS, parentName: "PH T06B", parentPhone: "0900000000" } });
  await db.enrollment.create({ data: { id: id("gd"), studentId: HV, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  for (const [i, b] of BUOI.entries()) {
    await db.classSession.create({ data: { id: b, classId: LOP, date: new Date(`2026-10-0${i + 1}T11:00:00.000Z`), lessonId: BAI1, status: "COMPLETED", centerId: CS } });
  }
  await db.makeupNeed.createMany({
    data: NEED.map((n, i) => ({
      id: n, studentId: HV, classId: LOP, centerId: CS, courseId: KHOA, sourceType: "ABSENCE" as const,
      missedSessionId: BUOI[i]!, missedLessonId: BAI1, status: "PENDING" as const,
    })),
  });
  await db.makeupCase.create({
    data: { id: CASE, centerId: CS, courseId: KHOA, lessonId: BAI1, date: new Date("2026-10-15T00:00:00.000Z"), startTime: "18:00", endTime: "19:30", teacherId: GV, status: "SCHEDULED", createdById: GV },
  });
}

const need = (n: string) => db.makeupNeed.findUniqueOrThrow({ where: { id: n } });
const donCua = async (n: string) => {
  const d = await need(n);
  const item = await db.orderItem.findUniqueOrThrow({ where: { id: d.feeOrderItemId! }, select: { order: { select: { id: true, code: true, status: true } } } });
  return item.order;
};
const thu = (orderId: string, amount: number) =>
  db.payment.create({ data: { orderId, amount, method: "BANK_TRANSFER", accountantStatus: "CONFIRMED", paidDate: new Date("2026-10-07T03:00:00.000Z"), centerId: CS } });
const bat = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
const MIEN = (n: string) => ({ needId: n, lyDo: "Phụ huynh khó khăn, BGĐ duyệt", ten: "QL T06B" });

describe.skipIf(!RUN_DB_TESTS)("[PHB] phí học bù + xét lại khi đơn đổi — T06", () => {
  beforeEach(dung);
  afterAll(don);

  // ── HB-31 miễn phí ────────────────────────────────────────────────────────────────────
  it("[PHB-00] đối chứng: công thức cấp 0 ⇒ dòng cần thu phí; tạo phí được MỘT đơn PENDING_PAYMENT có phiếu thu", async () => {
    await taoPhiBu(ADMIN, NEED[0]);
    const o = await donCua(NEED[0]);
    expect(o.status).toBe("PENDING_PAYMENT");
    expect(await db.paymentRequest.count({ where: { orderId: o.id, status: { in: ["PENDING", "PARTIAL"] } } })).toBeGreaterThan(0);
  });

  it("[PHB-01] HB-31: miễn phí khi đơn phí CHƯA thu ⇒ đơn bị HUỶ cùng lúc, phiếu thu VOID, có dòng lịch sử đơn, dòng được miễn", async () => {
    await taoPhiBu(ADMIN, NEED[0]);
    const truoc = await donCua(NEED[0]);
    const kq = await mienPhiBu(ADMIN, MIEN(NEED[0]));
    expect(kq.donPhiDaHuy).toBe(truoc.code);
    expect((await donCua(NEED[0])).status).toBe("CANCELLED");
    expect(await db.paymentRequest.count({ where: { orderId: truoc.id, status: { in: ["PENDING", "PARTIAL"] } } })).toBe(0);
    expect(await db.qrSession.count({ where: { paymentRequest: { orderId: truoc.id }, status: "ACTIVE" } })).toBe(0);
    const ls = await db.orderStatusHistory.findFirstOrThrow({ where: { orderId: truoc.id } });
    expect(ls).toMatchObject({ fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", changedByUserId: GV });
    expect(ls.reason).toContain("Miễn phí học bù");
    expect(await need(NEED[0])).toMatchObject({ freeReason: "Phụ huynh khó khăn, BGĐ duyệt" });
    expect((await need(NEED[0])).freeApprovedAt).not.toBeNull();
  });

  it("[PHB-02] HB-31: đơn phí ĐÃ CÓ tiền một phần ⇒ TỪ CHỐI, đơn và dòng nguyên vẹn (hoàn tiền không phải tác dụng phụ của nút miễn phí)", async () => {
    await taoPhiBu(ADMIN, NEED[0]);
    const o = await donCua(NEED[0]);
    await thu(o.id, 300_000);
    const loi = await bat(mienPhiBu(ADMIN, MIEN(NEED[0])));
    expect(loi).toBeInstanceOf(LoiHocBu);
    expect((loi as LoiHocBu).message).toContain("300.000");
    expect((await donCua(NEED[0])).status).toBe("PENDING_PAYMENT");
    expect((await need(NEED[0])).freeApprovedAt).toBeNull();
  });

  it("[PHB-03] miễn phí khi CHƯA có đơn phí ⇒ như cũ, không huỷ gì", async () => {
    const kq = await mienPhiBu(ADMIN, MIEN(NEED[1]));
    expect(kq.donPhiDaHuy).toBeNull();
    expect((await need(NEED[1])).freeApprovedAt).not.toBeNull();
    expect(await db.orderStatusHistory.count({ where: { order: { items: { some: { studentId: HV } } } } })).toBe(0);
  });

  it("[PHB-04] hai lượt miễn phí ĐỒNG THỜI ⇒ đúng MỘT thắng; đơn phí chỉ huỷ một lần", async () => {
    await taoPhiBu(ADMIN, NEED[0]);
    const kq = await Promise.allSettled([mienPhiBu(ADMIN, MIEN(NEED[0])), mienPhiBu(ADMIN, MIEN(NEED[0]))]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const o = await donCua(NEED[0]);
    expect(await db.orderStatusHistory.count({ where: { orderId: o.id } })).toBe(1);
  });

  it("[PHB-05] miễn phí khi dòng đã thu phí ĐỦ (hoặc còn lượt) ⇒ từ chối như cũ", async () => {
    await taoPhiBu(ADMIN, NEED[0]);
    const o = await donCua(NEED[0]);
    await thu(o.id, 1_000_000);
    expect(await bat(mienPhiBu(ADMIN, MIEN(NEED[0])))).toBeInstanceOf(LoiHocBu);
  });

  it("[PHB-06] GỠ miễn phí: dòng PENDING ⇒ xoá cờ; dòng đã xếp case (SCHEDULED) ⇒ từ chối; chưa miễn ⇒ từ chối", async () => {
    expect(await bat(goMienPhiBu(ADMIN, { needId: NEED[0], lyDo: "Đổi ý người duyệt", ten: "Admin" }))).toBeInstanceOf(LoiHocBu); // chưa miễn
    await mienPhiBu(ADMIN, MIEN(NEED[0]));
    await goMienPhiBu(ADMIN, { needId: NEED[0], lyDo: "Đổi ý người duyệt", ten: "Admin" });
    expect(await need(NEED[0])).toMatchObject({ freeApprovedAt: null, freeApprovedById: null, freeReason: null });
    await mienPhiBu(ADMIN, MIEN(NEED[0]));
    await db.makeupNeed.update({ where: { id: NEED[0] }, data: { status: "SCHEDULED" } });
    const loi = await bat(goMienPhiBu(ADMIN, { needId: NEED[0], lyDo: "Đổi ý người duyệt", ten: "Admin" }));
    expect(loi).toBeInstanceOf(LoiHocBu);
    // Câu nói ĐÚNG lý do (đã xếp case), không phải câu chung "vừa đổi trạng thái": người bấm cần biết phải làm gì.
    expect((loi as LoiHocBu).message).toContain("gỡ bé khỏi case");
    expect((await need(NEED[0])).freeApprovedAt).not.toBeNull();
  });

  // ── HB-22 ─────────────────────────────────────────────────────────────────────────────
  it("[PHB-07] HB-22: câu cảnh báo khi huỷ không bù mà đã thu phí — nêu SỐ TIỀN và MÃ ĐƠN; chưa thu / đơn đã huỷ / không có phí ⇒ null", async () => {
    expect(await canhBaoPhiKhiHuy(null)).toBeNull();
    await taoPhiBu(ADMIN, NEED[0]);
    const d = await need(NEED[0]);
    expect(await canhBaoPhiKhiHuy(d.feeOrderItemId)).toBeNull(); // chưa thu
    const o = await donCua(NEED[0]);
    await thu(o.id, 400_000);
    const nhac = await canhBaoPhiKhiHuy(d.feeOrderItemId);
    expect(nhac).toContain("400.000");
    expect(nhac).toContain(o.code);
    expect(nhac).toContain("KHÔNG tự hoàn");
    await db.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    expect(await canhBaoPhiKhiHuy(d.feeOrderItemId)).toBeNull(); // đơn đã huỷ ⇒ không còn "phí đang giữ"
  });

  // ── HB-21 ─────────────────────────────────────────────────────────────────────────────
  async function xepBangPhi(n: string, trangThai: "SCHEDULED" | "COMPLETED") {
    await taoPhiBu(ADMIN, n);
    const o = await donCua(n);
    await thu(o.id, 1_000_000);
    await db.makeupNeed.update({ where: { id: n }, data: { status: trangThai } });
    const sv = await db.makeupCaseStudent.create({
      data: { id: id(`sv-${n}`), caseId: CASE, makeupNeedId: n, status: trangThai === "COMPLETED" ? "PRESENT" : "PLACED", dungLuot: false, centerId: CS, addedById: GV },
    });
    return { o, sv };
  }

  it("[PHB-08] HB-21: đơn phí bị HUỶ khi bé đã xếp case (chưa điểm danh) ⇒ gỡ khỏi case, dòng về PENDING, có audit; chạy lại không đổi gì", async () => {
    const { o, sv } = await xepBangPhi(NEED[0], "SCHEDULED");
    await db.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    const kq = await db.$transaction((tx) => xetLaiSauKhiDonBiLoai(tx, { orderId: o.id, denTrangThai: "CANCELLED" }));
    expect(kq.goKhoiCase).toBe(1);
    // T07: mục bị gỡ được GIỮ làm lịch sử (RELEASED), không xoá.
    expect(await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: sv.id } })).toMatchObject({ status: "RELEASED", result: "RELEASED" });
    expect((await need(NEED[0])).status).toBe("PENDING");
    expect(await db.auditLog.count({ where: { entityId: NEED[0], action: "hoc-bu.go-khoi-case-vi-phi-bi-loai" } })).toBe(1);
    const lai = await db.$transaction((tx) => xetLaiSauKhiDonBiLoai(tx, { orderId: o.id, denTrangThai: "CANCELLED" }));
    expect(lai).toMatchObject({ goKhoiCase: 0, daBuXong: 0 });
  });

  it("[PHB-09] HB-21: bé ĐÃ BÙ XONG mà đơn phí bị hoàn ⇒ KHÔNG rút lại buổi đã học — chỉ audit để kế toán đối soát", async () => {
    const { o, sv } = await xepBangPhi(NEED[0], "COMPLETED");
    await db.order.update({ where: { id: o.id }, data: { status: "REFUNDED" } });
    const kq = await db.$transaction((tx) => xetLaiSauKhiDonBiLoai(tx, { orderId: o.id, denTrangThai: "REFUNDED" }));
    expect(kq).toMatchObject({ goKhoiCase: 0, daBuXong: 1 });
    expect((await need(NEED[0])).status).toBe("COMPLETED");
    expect(await db.makeupCaseStudent.count({ where: { id: sv.id, status: "PRESENT" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: NEED[0], action: "hoc-bu.phi-bi-loai-sau-khi-bu" } })).toBe(1);
  });

  it("[PHB-10] HB-21: suất dựa vào MIỄN PHÍ (không phải đơn phí) không bị gỡ khi một đơn phí cũ bị huỷ", async () => {
    const { o, sv } = await xepBangPhi(NEED[0], "SCHEDULED");
    await db.makeupNeed.update({ where: { id: NEED[0] }, data: { freeApprovedAt: new Date(), freeApprovedById: GV, freeReason: "BGĐ duyệt miễn" } });
    await db.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    const kq = await db.$transaction((tx) => xetLaiSauKhiDonBiLoai(tx, { orderId: o.id, denTrangThai: "CANCELLED" }));
    expect(kq.goKhoiCase).toBe(0);
    expect(await db.makeupCaseStudent.count({ where: { id: sv.id } })).toBe(1);
  });

  // ── HB-18 ─────────────────────────────────────────────────────────────────────────────
  async function donKhoa(status: "CONFIRMED" | "CANCELLED") {
    return db.order.create({
      data: {
        code: `${T}khoa-${status}`, type: "COURSE", status, customerName: "PH", customerPhone: "0900000000", studentId: HV, centerId: CS,
        createdById: GV, subtotal: 1, totalAmount: 1,
        items: { create: [{ type: "COURSE_ENROLLMENT", itemName: "Khoá", quantity: 1, unitPrice: 1, totalPrice: 1, studentId: HV, metadata: { courseId: KHOA, soBuoi: 12 } }] },
      },
    });
  }

  it("[PHB-11] HB-18: đơn khoá học bị HUỶ ⇒ lượt bù tính lại: ADJUSTMENT âm CÓ LÝ DO; chạy lại không ghi hai lần", async () => {
    await db.courseModuleMakeupQuota.deleteMany({ where: { courseId: KHOA } }); // mặc định 1 lượt mỗi học phần ⇒ công thức 2
    const o = await donKhoa("CONFIRMED");
    await db.$transaction((tx) => khoaTaiKhoan(tx, { studentId: HV, courseId: KHOA, classId: LOP }, GV));
    expect(await db.makeupCreditAccount.findFirstOrThrow({ where: { studentId: HV } })).toMatchObject({ granted: 2 });
    await db.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    const kq = await db.$transaction((tx) => xetLaiSauKhiDonBiLoai(tx, { orderId: o.id, denTrangThai: "CANCELLED" }));
    expect(kq.dieuChinhLuot).toEqual([{ studentId: HV, courseId: KHOA, delta: -2 }]);
    const tk = await db.makeupCreditAccount.findFirstOrThrow({ where: { studentId: HV } });
    expect(tk).toMatchObject({ granted: 0 });
    const adj = await db.makeupCreditEntry.findMany({ where: { accountId: tk.id, type: "ADJUSTMENT" } });
    expect(adj).toHaveLength(1);
    expect(adj[0]!.reason).toContain("bị huỷ");
    const lai = await db.$transaction((tx) => xetLaiSauKhiDonBiLoai(tx, { orderId: o.id, denTrangThai: "CANCELLED" }));
    expect(lai.dieuChinhLuot).toEqual([]);
    expect(await db.makeupCreditEntry.count({ where: { accountId: tk.id, type: "ADJUSTMENT" } })).toBe(1);
  });

  it("[PHB-12] HB-18: lượt ĐÃ giữ không rút lại được — đơn huỷ chỉ giảm được phần còn; lý do GHI phần giữ lại", async () => {
    await db.courseModuleMakeupQuota.deleteMany({ where: { courseId: KHOA } });
    const o = await donKhoa("CONFIRMED");
    await db.$transaction((tx) => khoaTaiKhoan(tx, { studentId: HV, courseId: KHOA, classId: LOP }, GV));
    await db.makeupCreditAccount.updateMany({ where: { studentId: HV }, data: { held: 1 } }); // giữ 1 (đã xếp case) — dựng thẳng, bút toán dưới
    const tk0 = await db.makeupCreditAccount.findFirstOrThrow({ where: { studentId: HV } });
    await db.makeupCreditEntry.create({ data: { accountId: tk0.id, type: "HOLD", heldDelta: 1, idemKey: "HOLD:dung-tay" } });
    await db.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    const kq = await db.$transaction((tx) => xetLaiSauKhiDonBiLoai(tx, { orderId: o.id, denTrangThai: "CANCELLED" }));
    expect(kq.dieuChinhLuot).toEqual([{ studentId: HV, courseId: KHOA, delta: -1 }]);
    const tk = await db.makeupCreditAccount.findFirstOrThrow({ where: { studentId: HV } });
    expect(tk).toMatchObject({ granted: 1, held: 1 });
    const adj = await db.makeupCreditEntry.findFirstOrThrow({ where: { accountId: tk.id, type: "ADJUSTMENT" } });
    expect(adj.reason).toMatch(/không rút được/);
  });

  it("[PHB-13] bé CHƯA có tài khoản ⇒ không tạo gì (công thức mới đã loại đơn huỷ)", async () => {
    const o = await donKhoa("CANCELLED");
    const kq = await db.$transaction((tx) => xetLaiSauKhiDonBiLoai(tx, { orderId: o.id, denTrangThai: "CANCELLED" }));
    expect(kq.dieuChinhLuot).toEqual([]);
    expect(await db.makeupCreditAccount.count({ where: { studentId: HV } })).toBe(0);
  });

  it("[PHB-14] handler `order.voided`: payload đủ ⇒ chạy xét lại; payload thiếu/lạ ⇒ bỏ qua không ném", async () => {
    const { o } = await xepBangPhi(NEED[0], "SCHEDULED");
    await db.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    await onOrderVoided({ id: "e1", type: "order.voided", payload: { orderId: "khong-co", denTrangThai: "CONFIRMED" } });
    expect((await need(NEED[0])).status).toBe("SCHEDULED");
    await onOrderVoided({ id: "e2", type: "order.voided", payload: { orderId: o.id, denTrangThai: "CANCELLED" } });
    expect((await need(NEED[0])).status).toBe("PENDING");
  });
});
