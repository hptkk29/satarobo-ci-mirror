// tests/hoc-bu/hoan-mot-phan.test.ts — T14 (theo dõi T06): PHÍ HỌC BÙ BỊ HOÀN MỘT PHẦN, trên Postgres THẬT, đi đúng đường tiền thật (`refundPayment` → DomainEvent
// `payment.refunded` trong giao dịch hoàn → dispatcher → xét lại).
//
// Luật: "đủ điều kiện xếp case bằng phí" là `đã thu ≥ tổng tiền đơn phí`, không chỉ trạng thái đơn. Hoàn một phần làm đơn vẫn sống mà đã thu < tổng ⇒
//   · bé CHƯA điểm danh ⇒ gỡ khỏi case, dòng về PENDING (derive `CHO_THU`), audit + báo Sale thu bổ sung, báo phụ huynh bé bị gỡ;
//   · bé ĐÃ học ⇒ KHÔNG đảo kết quả học, ghi ngoại lệ tài chính (audit) cho kế toán;
//   · vẫn đủ tiền ⇒ không làm gì; chạy lại ⇒ không nhân đôi.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dispatchPendingEvents } from "@/lib/events/dispatcher";
import { ensureHandlersRegistered } from "@/lib/events/register";
import { refundPayment } from "@/lib/finance/payment";
import { taoPhiBu } from "@/lib/hoc-bu/case-db";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import { xetLaiHoanMotPhan } from "@/lib/hoc-bu/don-doi-db";
import { scopedDb } from "@/lib/db-scope";
import { ADMIN, BAI, CS, GV, HV, QL, SALE, beCua, diemDanh, don, dung, kiem, needId, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[HMP] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const chay = async () => {
  ensureHandlersRegistered();
  await dispatchPendingEvents({ flagOn: true, batchSize: 500 });
  await dispatchPendingEvents({ flagOn: true, batchSize: 500 });
};
const thu = (orderId: string, amount: number) =>
  db.payment.create({
    data: { orderId, amount, method: "BANK_TRANSFER", accountantStatus: "CONFIRMED", paidDate: new Date("2026-10-07T03:00:00.000Z"), centerId: CS },
  });
const nkNeed = (id: string) => db.auditLog.findMany({ where: { module: "hoc-bu", entityId: id }, orderBy: { action: "asc" } });
const phiCua = async (needId_: string) => (await docDongTheoId(scopedDb(ADMIN), [needId_], null))[0]?.phi.loai ?? "KHONG_CO";

/** A hết lượt: tạo phí cho dòng 5, thu ĐỦ (`tong`), rồi xếp A (bài 5) cùng B (còn lượt) vào MỘT case. Trả {orderId, payment, caseId, tong}. */
async function dungPhiDaThu() {
  await dung({ A: 0, B: 3, C: 3, D: 3 });
  await db.user.create({ data: { id: SALE, name: "Sale T14", email: `${SALE}@test.local`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS } });
  await db.user.create({ data: { id: QL, name: "Quản lý T14", email: `${QL}@test.local`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
  await db.enrollment.updateMany({ where: { studentId: { in: Object.values(HV) } }, data: { saleId: SALE } });
  const { orderId } = await taoPhiBu(ADMIN, needId("A", 5));
  const tong = (await db.order.findUniqueOrThrow({ where: { id: orderId } })).totalAmount;
  const payment = await thu(orderId, tong);
  const c = await tao([needId("A", 5), needId("B", 6)], { lessonIds: [BAI[5], BAI[6]] });
  return { orderId, payment, caseId: c, tong };
}

describe.skipIf(!RUN_DB_TESTS)("[HMP] phí học bù bị hoàn một phần — T14", () => {
  beforeEach(() => dung());
  afterAll(async () => {
    await db.payment.deleteMany({ where: { centerId: CS } });
    await don();
  });

  it("[HMP-01] NGHIỆM THU: phí đủ ⇒ xếp case; HOÀN MỘT PHẦN thật ⇒ bé chưa học bị gỡ khỏi case, dòng về chờ thu phí, Sale + phụ huynh được báo, bé còn lại không bị đụng", async () => {
    const { orderId, payment, caseId, tong } = await dungPhiDaThu();
    const hoan = Math.round(tong / 3);
    const kq = await refundPayment({ paymentId: payment.id, confirmedById: GV, reason: "Hoàn một phần theo yêu cầu phụ huynh", amount: hoan });
    expect(kq.ok).toBe(true);
    await chay();

    // Dòng của A về PENDING; mục RELEASED; A bị gỡ khỏi case; B còn nguyên; case vẫn SCHEDULED.
    const dongA = await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("A", 5) } });
    expect(dongA.status).toBe("PENDING");
    expect((await beCua(caseId, "A")).attendanceStatus).toBe("REMOVED");
    expect((await beCua(caseId, "B")).attendanceStatus).toBe("PENDING");
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("SCHEDULED");
    // Derive "chờ thu phí": đơn phí còn sống, chưa thu đủ ⇒ CHO_THU (không phải CAN_THU: phí đã tồn tại).
    expect(await phiCua(needId("A", 5))).toBe("CHO_THU");

    // Nhật ký: gỡ mục + gỡ vì phí thiếu (kèm số tiền), do "Hệ thống".
    const au = await nkNeed(needId("A", 5));
    const thieu = au.find((r) => r.action === "hoc-bu.go-khoi-case-vi-phi-thieu")!;
    expect(thieu).toBeTruthy();
    expect(thieu.actorName).toContain("Hệ thống");
    expect(thieu.newValues).toMatchObject({ daThu: tong - hoan, tongTien: tong, conThieu: hoan, khoanHoan: kq.ok ? kq.refundId : null });
    expect(thieu.reason).toContain("gỡ khỏi case");
    // Báo Sale thu bổ sung (số thiếu trong lời) + phụ huynh của A biết bé bị gỡ.
    const sale = await db.staffNotification.findMany({ where: { userId: SALE, dedupeKey: { startsWith: "makeup.payment-required:" } } });
    expect(sale).toHaveLength(1);
    expect(sale[0]!.title).toBe("Phí học bù thu thiếu — cần thu bổ sung");
    expect(sale[0]!.body).toContain(`${hoan.toLocaleString("vi-VN")}đ`);
    expect(await db.notification.count({ where: { studentId: HV.A, dedupeKey: { startsWith: "makeup.case.cancelled:" } } })).toBe(1);
    expect(await db.notification.count({ where: { studentId: HV.B, dedupeKey: { startsWith: "makeup.case.cancelled:" } } })).toBe(0);

    // Thu bổ sung đủ ⇒ lại đủ điều kiện xếp (DA_THU).
    await thu(orderId, hoan);
    expect(await phiCua(needId("A", 5))).toBe("DA_THU");
  });

  it("[HMP-02] ĐÃ HỌC: hoàn một phần SAU khi bé học xong ⇒ KHÔNG đảo kết quả (dòng vẫn COMPLETED, mục vẫn COMPLETED); ghi ngoại lệ tài chính; checker nêu cho kế toán", async () => {
    const { orderId, payment, caseId, tong } = await dungPhiDaThu();
    await diemDanh(caseId, "A", true, { 5: "COMPLETED" });
    await diemDanh(caseId, "B", true, { 6: "COMPLETED" });
    const hoan = Math.round(tong / 2);
    await refundPayment({ paymentId: payment.id, confirmedById: GV, reason: "Hoàn một nửa", amount: hoan });
    await chay();
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("A", 5) } })).status).toBe("COMPLETED");
    expect((await beCua(caseId, "A")).attendanceStatus).toBe("PRESENT");
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("COMPLETED");
    const au = (await nkNeed(needId("A", 5))).map((r) => r.action);
    expect(au).toContain("hoc-bu.phi-thieu-sau-khi-bu");
    expect(au).not.toContain("hoc-bu.go-khoi-case-vi-phi-thieu");
    // Không báo Sale "cần thu bổ sung để xếp lại" (bé đã học, không xếp lại).
    expect(await db.staffNotification.count({ where: { userId: SALE, dedupeKey: { startsWith: "makeup.payment-required:" } } })).toBe(0);
    const tv = (await kiem()).filter((f) => f.luat === "TV-50");
    expect(tv.map((f) => [f.id, f.nghiemTrong, f.phanLoai])).toEqual([[needId("A", 5), "MEDIUM", "NEEDS_MANUAL_REVIEW"]]);
    expect(orderId).toBeTruthy();
  });

  it("[HMP-03] vẫn ĐỦ TIỀN sau hoàn (đóng dư rồi hoàn phần dư) ⇒ không làm gì; không audit, không gỡ", async () => {
    const { orderId, caseId } = await dungPhiDaThu();
    const du = await thu(orderId, 500_000);
    await refundPayment({ paymentId: du.id, confirmedById: GV, reason: "Hoàn phần đóng dư", amount: 500_000 });
    await chay();
    expect((await beCua(caseId, "A")).attendanceStatus).toBe("PENDING");
    expect((await nkNeed(needId("A", 5))).map((r) => r.action)).not.toContain("hoc-bu.go-khoi-case-vi-phi-thieu");
    expect(await db.payment.count({ where: { orderId, accountantStatus: "REFUNDED" } })).toBe(1);
  });

  it("[HMP-04] IDEMPOTENT: chạy xét lại hai lần (và outbox phát lại) ⇒ chỉ MỘT lần gỡ, MỘT dòng nhật ký, MỘT tin cho Sale", async () => {
    const { orderId, payment, tong } = await dungPhiDaThu();
    const kq = await refundPayment({ paymentId: payment.id, confirmedById: GV, reason: "Hoàn một phần", amount: Math.round(tong / 4) });
    await chay();
    const lai = await xetLaiHoanMotPhan({ orderId, paymentId: kq.ok ? kq.refundId : null });
    expect(lai).toMatchObject({ khongThieu: false, goKhoiCase: 0, daBuXong: 0 });
    await chay();
    expect((await nkNeed(needId("A", 5))).filter((r) => r.action === "hoc-bu.go-khoi-case-vi-phi-thieu")).toHaveLength(1);
    expect(await db.staffNotification.count({ where: { userId: SALE, dedupeKey: { startsWith: "makeup.payment-required:" } } })).toBe(1);
  });

  it("[HMP-05] HOÀN LẦN HAI (bù đủ rồi lại hoàn) là sự việc MỚI: gỡ lại và báo Sale lần nữa — khoá tin theo khoản hoàn", async () => {
    const { orderId, payment, caseId, tong } = await dungPhiDaThu();
    const h1 = Math.round(tong / 4);
    await refundPayment({ paymentId: payment.id, confirmedById: GV, reason: "Hoàn lần một", amount: h1 });
    await chay();
    await thu(orderId, h1); // thu bổ sung ⇒ đủ lại
    expect(await phiCua(needId("A", 5))).toBe("DA_THU");
    // Xếp lại A vào case mới (đủ điều kiện), rồi hoàn lần hai.
    const c2 = await tao([needId("A", 5)], { ymd: "2026-10-16" });
    expect((await beCua(c2, "A")).attendanceStatus).toBe("PENDING");
    const phai = await db.payment.findFirstOrThrow({ where: { orderId, accountantStatus: "CONFIRMED", amount: { gt: 0 } }, orderBy: { amount: "desc" } });
    await refundPayment({ paymentId: phai.id, confirmedById: GV, reason: "Hoàn lần hai", amount: h1 });
    await chay();
    expect((await beCua(c2, "A")).attendanceStatus).toBe("REMOVED");
    expect(await db.staffNotification.count({ where: { userId: SALE, dedupeKey: { startsWith: "makeup.payment-required:" } } })).toBe(2);
    expect(caseId).toBeTruthy();
  });

  it("[HMP-06] CHECKER TV-50: dòng SCHEDULED mà phí thu thiếu (hoàn KHÔNG qua sự kiện, vd dữ liệu cũ) ⇒ HIGH AUTO_FIXABLE; sau `xetLaiHoanMotPhan` thì hết", async () => {
    const { orderId, payment, tong } = await dungPhiDaThu();
    // Tạo dòng âm trực tiếp, không qua `refundPayment` ⇒ không có sự kiện.
    await db.payment.create({
      data: { orderId, amount: -Math.round(tong / 3), method: "BANK_TRANSFER", accountantStatus: "REFUNDED", adjustmentOfId: payment.id, paidDate: new Date(), centerId: CS },
    });
    const truoc = (await kiem()).filter((f) => f.luat === "TV-50");
    expect(truoc.map((f) => [f.id, f.nghiemTrong, f.phanLoai])).toEqual([[needId("A", 5), "HIGH", "AUTO_FIXABLE"]]);
    await xetLaiHoanMotPhan({ orderId, paymentId: null });
    expect((await kiem()).filter((f) => f.luat === "TV-50")).toEqual([]);
  });
});
