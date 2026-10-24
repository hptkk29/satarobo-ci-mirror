// tests/finance/dieu-chinh.test.ts — Bước 6, tầng CHẠM POSTGRES THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy bộ này:  pnpm test:finance-db
//
// `pnpm test:unit` trần sẽ SKIP (thiếu `ALLOW_DB_RESET=1` — xem tests/_helpers/db-gate.ts).
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng + tự dọn đúng phần của mình theo tiền tố
// id, nên chạy được trên DB đang có dữ liệu làm việc.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao đây là chỗ duy nhất chứng minh được bản sửa
//
// `adjustPayment` là một transaction có `SELECT … FOR UPDATE`, một phép cộng dồn các bút
// toán trước đó, và một chốt trần đọc chéo sang bảng `Enrollment`. Mock DB cho những thứ
// đó là mock lại đúng phần đang cần kiểm — xanh mà không chứng minh gì.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { adjustPayment, updatePendingPayment } from "@/lib/finance/payment";
import { sumConfirmed } from "@/lib/finance/debt";
import { sumRecorded } from "@/lib/finance/ghi-nhan";
import {
  dungFixtureHaiTruc,
  donFixtureHaiTruc,
  FX_IDS,
  FX_TIEN_SO,
  FX_KY_VONG,
} from "@/tests/fixtures/hai-truc-tien";

if (!RUN_DB_TESTS) console.warn(`[BUOC-6] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

/** Actor giả — `Payment.recordedById` / `AuditLog.actorId` không có khoá ngoại. */
const ACTOR = "fx-hai-truc-actor";

/** Id phiếu đợt 2 (ca trả góp) — cùng `orderId` nên fixture dọn luôn. */
const ID_DOT_2 = "fx-hai-truc-pay-dot2";
const TIEN_DOT_2 = 2_000_000;

/** Chụp TOÀN BỘ field của một phiếu thu, để so "không đổi một field nào". */
async function chup(id: string) {
  const p = await db.payment.findUniqueOrThrow({ where: { id } });
  return JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
}

async function demBanGhi(orderId: string): Promise<number> {
  return db.payment.count({ where: { orderId } });
}

describe.skipIf(!RUN_DB_TESTS)("[BUOC-6] bút toán điều chỉnh — DB thật", () => {
  beforeAll(async () => {
    await dungFixtureHaiTruc();
  });
  afterAll(async () => {
    await donFixtureHaiTruc();
  });
  beforeEach(async () => {
    // Mỗi ca bắt đầu từ trạng thái gốc: các ca trước có thể đã đẻ bút toán điều chỉnh.
    await dungFixtureHaiTruc();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Tăng / giảm / chồng nhiều lần trên MỘT phiếu
  // ───────────────────────────────────────────────────────────────────────────

  it("điều chỉnh TĂNG: sinh delta dương, tổng đã xác nhận đúng số mới", async () => {
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 5_000_000,
      reason: "Kế toán nhập thiếu 1 triệu",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.delta).toBe(1_000_000);
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(5_000_000);
  });

  it("điều chỉnh GIẢM: delta ÂM lưu được vào DB", async () => {
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 2_500_000,
      reason: "Ghi nhầm sang phiếu của học viên khác",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.delta).toBe(-1_500_000);
    const dong = await db.payment.findUniqueOrThrow({ where: { id: r.adjustmentId } });
    expect(dong.amount).toBe(-1_500_000);
    expect(dong.paymentType).toBe("ADJUSTMENT");
    expect(dong.accountantStatus).toBe("CONFIRMED");
    expect(dong.adjustmentOfId).toBe(FX_IDS.khoanDaXacNhan);
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(2_500_000);
  });

  it("NHIỀU LẦN chồng nhau: lần hai tính trên kết quả của lần một", async () => {
    const a = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 5_000_000,
      reason: "lần 1",
      actorId: ACTOR,
    });
    const b = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 4_200_000,
      reason: "lần 2",
      actorId: ACTOR,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.delta).toBe(1_000_000);
    // −800.000, KHÔNG phải −5.800.000: nếu lần hai tính trên số GỐC thì nó âm thầm huỷ
    // lần một và tổng ra 4.200.000 − 5.000.000 = sai.
    expect(b.delta).toBe(-800_000);
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(4_200_000);
    const soDong = await db.payment.count({
      where: { adjustmentOfId: FX_IDS.khoanDaXacNhan, paymentType: "ADJUSTMENT" },
    });
    expect(soDong).toBe(2);
  });

  it("KHÔNG có gì để điều chỉnh (delta = 0) → từ chối, không đẻ bản ghi", async () => {
    const truoc = await demBanGhi(FX_IDS.order);
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: FX_TIEN_SO.daXacNhan,
      reason: "gõ lại đúng số cũ",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(await demBanGhi(FX_IDS.order)).toBe(truoc);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Dòng gốc BẤT BIẾN
  // ───────────────────────────────────────────────────────────────────────────

  it("dòng gốc KHÔNG đổi một field nào sau điều chỉnh (kể cả updatedAt)", async () => {
    const truoc = await chup(FX_IDS.khoanDaXacNhan);
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 6_000_000,
      reason: "so toàn bộ field",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    const sau = await chup(FX_IDS.khoanDaXacNhan);
    expect(sau).toEqual(truoc);
  });

  it("khoá lạc quan CHỈ SO SÁNH — `expectedUpdatedAt` lệch thì từ chối, không ghi", async () => {
    const truoc = await chup(FX_IDS.khoanDaXacNhan);
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 5_000_000,
      reason: "phiên bản cũ",
      actorId: ACTOR,
      expectedUpdatedAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    expect(r.ok).toBe(false);
    expect(await chup(FX_IDS.khoanDaXacNhan)).toEqual(truoc);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Trả góp — điều chỉnh đúng MỘT phiếu, phiếu kia bất động
  // ───────────────────────────────────────────────────────────────────────────

  it("trả góp: sửa phiếu đợt 1, phiếu đợt 2 không đổi field nào, tổng đúng", async () => {
    await db.payment.create({
      data: {
        id: ID_DOT_2,
        orderId: FX_IDS.order,
        enrollmentId: FX_IDS.enrollment,
        amount: TIEN_DOT_2,
        method: "CASH",
        paidDate: new Date("2026-09-10T03:00:00.000Z"),
        saleStatus: "RECORDED",
        accountantStatus: "CONFIRMED",
        centerId: FX_IDS.center,
      },
    });
    const dot2Truoc = await chup(ID_DOT_2);
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(FX_TIEN_SO.daXacNhan + TIEN_DOT_2);

    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 3_000_000, // đợt 1: 4.000.000 → 3.000.000
      reason: "đợt 1 ghi thừa",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.delta).toBe(-1_000_000);
    expect(await chup(ID_DOT_2)).toEqual(dot2Truoc);
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(3_000_000 + TIEN_DOT_2);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Từ chối đúng chỗ
  // ───────────────────────────────────────────────────────────────────────────

  it("adjustPayment trên phiếu PENDING → từ chối (nháp thì sửa thẳng)", async () => {
    const truoc = await demBanGhi(FX_IDS.order);
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanChuaXacNhan,
      correctAmount: 1_000_000,
      reason: "thử trên khoản chờ duyệt",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(await demBanGhi(FX_IDS.order)).toBe(truoc);
  });

  it("adjustPayment CHỒNG lên một bút toán điều chỉnh → từ chối", async () => {
    const a = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 5_000_000,
      reason: "lần 1",
      actorId: ACTOR,
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    // Cho phép sẽ biến `adjustmentOfId` thành cây nhiều tầng, không ai cộng nổi.
    const b = await adjustPayment({
      paymentId: a.adjustmentId,
      correctAmount: 2_000_000,
      reason: "sửa chính bút toán điều chỉnh",
      actorId: ACTOR,
    });
    expect(b.ok).toBe(false);
  });

  it("adjustPayment thiếu lý do → từ chối", async () => {
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 5_000_000,
      reason: "   ",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(false);
  });

  it("updatePendingPayment trên phiếu ĐÃ XÁC NHẬN → từ chối", async () => {
    const truoc = await chup(FX_IDS.khoanDaXacNhan);
    const r = await updatePendingPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      amount: 1_000_000,
      actorId: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(await chup(FX_IDS.khoanDaXacNhan)).toEqual(truoc);
  });

  it("updatePendingPayment trên phiếu PENDING: sửa TẠI CHỖ, không đẻ bút toán", async () => {
    const truoc = await demBanGhi(FX_IDS.order);
    const r = await updatePendingPayment({
      paymentId: FX_IDS.khoanChuaXacNhan,
      amount: 3_300_000,
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    const sau = await db.payment.findUniqueOrThrow({ where: { id: FX_IDS.khoanChuaXacNhan } });
    expect(sau.amount).toBe(3_300_000);
    expect(sau.paymentType).toBe("PAYMENT");
    expect(await demBanGhi(FX_IDS.order)).toBe(truoc);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Trần trên và đáy 0 — TỪ CHỐI, không tự cắt số
  // ───────────────────────────────────────────────────────────────────────────

  it("vượt học phí của ghi danh → từ chối, KHÔNG tự cắt về trần", async () => {
    const truoc = await demBanGhi(FX_IDS.order);
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: FX_TIEN_SO.hocPhi + 1_000_000, // 11tr > học phí 10tr
      reason: "vượt trần",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(false);
    // Cắt âm thầm về 10tr là tệ hơn từ chối: kế toán tưởng đã ghi 11tr.
    expect(await demBanGhi(FX_IDS.order)).toBe(truoc);
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(FX_TIEN_SO.daXacNhan);
  });

  it("ĐÚNG BẰNG học phí → cho qua (biên trên là hợp lệ)", async () => {
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: FX_TIEN_SO.hocPhi,
      reason: "đóng đủ học phí",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(FX_TIEN_SO.hocPhi);
  });

  it("về ĐÚNG 0 → cho qua; xuống dưới 0 thì không có đường nào tới được", async () => {
    // Phiếu này là khoản CONFIRMED duy nhất của ghi danh ⇒ correctAmount = 0 đưa tổng về
    // đúng 0, không âm. Biên dưới của trần là "tổng < 0", không phải "phiếu = 0".
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 0,
      reason: "huỷ toàn bộ khoản ghi nhầm",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(0);
  });

  it("số tiền đúng ÂM → từ chối ngay ở cửa (không phải lỗi trần)", async () => {
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: -1,
      reason: "số âm",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Xoá mềm không được cộng
  // ───────────────────────────────────────────────────────────────────────────

  it("khoản `deletedAt != null` KHÔNG được cộng vào trục A", async () => {
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(FX_TIEN_SO.daXacNhan);
    await db.payment.update({
      where: { id: FX_IDS.khoanDaXacNhan },
      data: { deletedAt: new Date() },
    });
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(0);
  });

  it("bút toán điều chỉnh bị xoá mềm cũng không được cộng", async () => {
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 5_000_000,
      reason: "rồi xoá",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await db.payment.update({ where: { id: r.adjustmentId }, data: { deletedAt: new Date() } });
    expect(await sumConfirmed(FX_IDS.enrollment)).toBe(FX_TIEN_SO.daXacNhan);
  });

  it("adjustPayment trên khoản đã xoá mềm → từ chối", async () => {
    await db.payment.update({
      where: { id: FX_IDS.khoanDaXacNhan },
      data: { deletedAt: new Date() },
    });
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 5_000_000,
      reason: "trên khoản đã xoá",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. HAI TRỤC — chênh lệch phải được BẢO TOÀN
  // ───────────────────────────────────────────────────────────────────────────

  it("trạng thái gốc: hai trục ra hai con số khác nhau, đúng như kỳ vọng", async () => {
    const a = await sumConfirmed(FX_IDS.enrollment);
    const b = await sumRecorded(FX_IDS.order);
    expect(a).toBe(FX_KY_VONG.sumConfirmedTheoGhiDanh);
    expect(b).toBe(FX_KY_VONG.sumRecordedTheoDon);
    expect(b - a).toBe(FX_KY_VONG.chenhLech);
  });

  it("sau khi điều chỉnh, CHÊNH LỆCH hai trục KHÔNG đổi", async () => {
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 5_000_000,
      reason: "tăng 1 triệu",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    const a = await sumConfirmed(FX_IDS.enrollment);
    const b = await sumRecorded(FX_IDS.order);
    expect(a).toBe(5_000_000);
    // Bút toán ADJUSTMENT kế thừa `saleStatus` của phiếu gốc nên trục B cũng nhích theo
    // ĐÚNG delta. Mô hình số-tuyệt-đối cũ sẽ cộng cả 4tr lẫn 5tr ⇒ chênh lệch phình ra.
    expect(b).toBe(FX_KY_VONG.sumRecordedTheoDon + 1_000_000);
    expect(b - a).toBe(FX_KY_VONG.chenhLech);
  });

  it("trục B vẫn cộng khoản KHÔNG gắn ghi danh (cổng thanh toán)", async () => {
    // Ép trục B khoá theo `enrollmentId` là nuốt mất đúng khoản này.
    const b = await sumRecorded(FX_IDS.order);
    expect(b).toBeGreaterThanOrEqual(FX_TIEN_SO.khongGhiDanh);
    const khoan = await db.payment.findUniqueOrThrow({ where: { id: FX_IDS.khoanKhongGhiDanh } });
    expect(khoan.enrollmentId).toBeNull();
    expect(khoan.saleStatus).toBe("RECORDED");
  });

  it("trục A KHÔNG cộng khoản chưa xác nhận, dù trục B đã cộng", async () => {
    const a = await sumConfirmed(FX_IDS.enrollment);
    expect(a).toBe(FX_TIEN_SO.daXacNhan);
    // Khoản 3.000.000 đang PENDING nằm cùng ghi danh — nếu trục A cộng nó thì con số
    // "đã thanh toán" của phụ huynh chạy trước khi kế toán đối soát xong.
    const pending = await db.payment.findUniqueOrThrow({ where: { id: FX_IDS.khoanChuaXacNhan } });
    expect(pending.enrollmentId).toBe(FX_IDS.enrollment);
    expect(pending.accountantStatus).toBe("PENDING");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Vết kiểm toán
  // ───────────────────────────────────────────────────────────────────────────

  it("mỗi lần điều chỉnh ghi AuditLog kèm số cũ / số đúng / delta / lý do", async () => {
    const r = await adjustPayment({
      paymentId: FX_IDS.khoanDaXacNhan,
      correctAmount: 5_000_000,
      reason: "kiểm vết audit",
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const log = await db.auditLog.findFirst({
      where: { entityType: "Payment", entityId: r.adjustmentId, action: "CREATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.reason).toBe("kiểm vết audit");
    const nv = (log?.newValues ?? {}) as Record<string, unknown>;
    expect(nv.soCu).toBe(FX_TIEN_SO.daXacNhan);
    expect(nv.soDung).toBe(5_000_000);
    expect(nv.delta).toBe(1_000_000);
    expect(nv.adjustmentOfId).toBe(FX_IDS.khoanDaXacNhan);
    await db.auditLog.deleteMany({ where: { entityId: r.adjustmentId } });
  });
});
