// tests/finance/go-gan-doi-cu.test.ts — GỠ GẮN trên PHÂN BỔ ĐỜI CŨ. Postgres THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy:  pnpm test:finance-db      (CI: job "Chat DB invariants")
//
// ⚠️ VÌ SAO BỘ NÀY TỒN TẠI RIÊNG
//
// Gỡ gắn **KHÔNG nằm sau công tắc**. Ngay khi merge, nó chạy được trên MỌI phân bổ đang có
// trên prod — mà phân bổ trên prod hôm nay KHÔNG do màn gắn tay sinh ra, chúng do WEBHOOK sinh
// (`allocateToOrder`). Hai đường ghi hai họ marker khác nhau:
//
//   gắn tay  → `Payment.note` chứa `[gan-tay:<bankTransactionId>]`
//   webhook  → `Payment.note` chứa `[auto:<provider>:<providerTxnId>]`
//
// Bản đầu của `goGanTheoCon` chỉ tìm họ thứ nhất. Hậu quả KHÔNG phải một lỗi ném ra, mà là một
// lượt gỡ NỬA VỜI: `PaymentAllocation` bị xoá (Ledger-B mất dấu) trong khi `Payment` còn nguyên
// (Ledger-A vẫn tính là đã thu). Giao dịch quay về hàng chờ, công nợ vẫn báo ĐÃ ĐÓNG, và không
// lỗi nào báo. Ba ca dưới đây là ba hình dạng phân bổ đời cũ có thật.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { noTheoCon } from "@/lib/finance/debt";
import { goGanTheoCon } from "@/lib/finance/ghi-tien-don";
import { xacNhanKhoanTrongTx } from "@/lib/finance/payment";

if (!RUN_DB_TESTS) console.warn(`[GDC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-gdc-";
const ACTOR = { id: `${T}actor`, name: "Kế toán fixture" };

const CENTER = `${T}center`;
const COURSE = `${T}course`;
const CLASS = `${T}class`;
const STUDENT = `${T}student`;
const ENROLL = `${T}enroll`;
const DON = `${T}don`;
const ITEM = `${T}item`;
const PR1 = `${T}pr1`;
const PR2 = `${T}pr2`;
const TXN = `${T}txn`;

/** Chuỗi provider phải khớp TỪNG KÝ TỰ với `markerWebhook`. */
const PROVIDER = "SEPAY";
const MARKER_CU = `[auto:${PROVIDER.toLowerCase()}:${TXN}]`;

const HOC_PHI = 6_000_000;

async function don() {
  // Hoá đơn giữ khoản bằng khoá ngoại RESTRICT — dọn TRƯỚC khoản (dòng nối xoá theo Cascade).
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  // Nhật ký thu hồi phiếu (PR4a) mang entityId = id phiếu — cùng id qua các ca, nên phải dọn kẻo ca sau đọc nhầm dòng của ca trước.
  await db.auditLog.deleteMany({ where: { entityType: "Receipt", entityId: { startsWith: T } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransactionId: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: T } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollment.deleteMany({ where: { id: ENROLL } });
  await db.student.deleteMany({ where: { id: STUDENT } });
  await db.class.deleteMany({ where: { id: CLASS } });
  await db.course.deleteMany({ where: { id: COURSE } });
  await db.center.deleteMany({ where: { id: CENTER } });
}

/** Nền: một đơn MỘT con, học phí 6tr, có ghi danh thật (cần cho ca (c)). */
async function dungNen() {
  await don();
  await db.center.create({
    data: { id: CENTER, name: "GDC cơ sở", slug: `${T}slug`, address: "không có thật" },
  });
  await db.course.create({ data: { id: COURSE, name: "GDC khoá", slug: `${T}course-slug` } });
  await db.class.create({
    data: { id: CLASS, name: "GDC lớp", classCode: `${T}cls`, courseId: COURSE, centerId: CENTER },
  });
  await db.student.create({ data: { id: STUDENT, name: "GDC học viên", centerId: CENTER } });
  await db.enrollment.create({
    data: {
      id: ENROLL,
      studentId: STUDENT,
      classId: CLASS,
      courseId: COURSE,
      status: "ACTIVE",
      finalPrice: HOC_PHI,
      centerId: CENTER,
    },
  });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269904-000001",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "GDC phụ huynh",
      customerPhone: "0999000333",
      totalAmount: HOC_PHI,
      centerId: CENTER,
      studentId: STUDENT,
    },
  });
  await db.orderItem.create({
    data: {
      id: ITEM,
      orderId: DON,
      type: "COURSE_ENROLLMENT",
      itemName: "GDC học viên",
      enrollmentId: ENROLL,
      quantity: 1,
      unitPrice: HOC_PHI,
      totalPrice: HOC_PHI,
    },
  });
  await db.bankTransaction.create({
    data: {
      id: TXN,
      provider: PROVIDER,
      providerTxnId: TXN,
      amount: HOC_PHI,
      transferredAt: new Date("2699-04-01T03:00:00Z"),
      status: "MATCHED",
      centerId: CENTER,
    },
  });
}

/** Một phiếu thu (đợt) của LUỒNG CŨ — `orderItemId` NULL. */
async function dungDot(id: string, installmentNo: number, amountDue: number) {
  await db.paymentRequest.create({
    data: {
      id,
      orderId: DON,
      orderItemId: null,
      installmentNo,
      amountDue,
      status: "PENDING",
      sortOrder: installmentNo,
      centerId: CENTER,
    },
  });
}

/** Dòng `Payment` ĐỜI CŨ — marker `[auto:…]`, không phải `[gan-tay:…]`. */
async function dungKhoanCu(opts: {
  id: string;
  amount: number;
  accountantStatus: "PENDING" | "CONFIRMED";
  enrollmentId: string | null;
}) {
  return db.payment.create({
    data: {
      id: opts.id,
      orderId: DON,
      orderItemId: null,
      enrollmentId: opts.enrollmentId,
      amount: opts.amount,
      method: PROVIDER.toLowerCase(),
      paidDate: new Date("2699-04-01T03:00:00Z"),
      note: `Tiền về qua ${PROVIDER} ${TXN} ${MARKER_CU}`,
      saleStatus: "RECORDED",
      accountantStatus: opts.accountantStatus,
      centerId: CENTER,
    },
    select: { id: true },
  });
}

async function phanBo(paymentRequestId: string, amount: number) {
  await db.paymentAllocation.create({
    data: { bankTransactionId: TXN, paymentRequestId, amount, centerId: CENTER },
  });
  await db.paymentRequest.update({
    where: { id: paymentRequestId },
    data: { status: "PAID" },
  });
}

/** Σ khoản của một ghi danh — thứ học bạ / công nợ ghi danh đọc. */
async function tongTheoGhiDanh() {
  const r = await db.payment.aggregate({
    where: { enrollmentId: ENROLL, deletedAt: null, accountantStatus: "CONFIRMED" },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

describe.skipIf(!RUN_DB_TESTS)("[GDC] gỡ gắn trên phân bổ ĐỜI CŨ", () => {
  beforeEach(dungNen);
  afterAll(don);

  it("[GDC-a] webhook TỰ KHỚP (CONFIRMED, orderItemId NULL) → đảo đúng trục, sổ về số cũ", async () => {
    await dungDot(PR1, 1, HOC_PHI);
    await dungKhoanCu({ id: `${T}pay-a`, amount: HOC_PHI, accountantStatus: "CONFIRMED", enrollmentId: null });
    await phanBo(PR1, HOC_PHI);

    // Trước khi gỡ: tiền nằm ở ô "chưa gắn con" (trục A, `orderItemId` NULL).
    const truoc = await noTheoCon(DON);
    expect(truoc.chuaGanCon).toBe(HOC_PHI);

    const r = await goGanTheoCon({
      bankTransactionId: TXN,
      orderId: DON,
      lyDo: "Khách báo chuyển nhầm",
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);
    // ⚠️ Vế quan trọng nhất: PHẢI có bút toán đảo. Bản đầu tìm sai họ marker ⇒ `soDongDao = 0`,
    // phân bổ vẫn bị xoá, và đây là lượt gỡ NỬA VỜI.
    if (r.ok) expect(r.soDongDao).toBe(1);

    const dao = await db.payment.findMany({
      where: { orderId: DON, paymentType: "ADJUSTMENT", deletedAt: null },
    });
    expect(dao).toHaveLength(1);
    // Đảo phải mang ĐÚNG trục của dòng gốc — trái dấu mà khác trục thì tổng trục kia không về 0.
    expect(dao[0]!.accountantStatus).toBe("CONFIRMED");
    expect(dao[0]!.amount).toBe(-HOC_PHI);

    // Công nợ đơn quay lại ĐÚNG số trước khi gắn.
    const sau = await noTheoCon(DON);
    expect(sau.chuaGanCon).toBe(0);
    expect(sau.con[0]!.conNo).toBe(HOC_PHI);

    // Đợt về PENDING (không còn phân bổ nào), giao dịch về hàng chờ.
    const pr = await db.paymentRequest.findUniqueOrThrow({ where: { id: PR1 } });
    expect(pr.status).toBe("PENDING");
    const txn = await db.bankTransaction.findUniqueOrThrow({ where: { id: TXN } });
    expect(txn.status).toBe("UNMATCHED");

    // Nhật ký có ảnh chụp.
    const nk = await db.auditLog.findFirstOrThrow({
      where: { entityType: "BankTransaction", entityId: TXN, action: "TXN_GO_GAN" },
      orderBy: { createdAt: "desc" },
    });
    const cu = nk.oldValues as unknown as { phanBo: Record<string, unknown>[] };
    expect(cu.phanBo).toHaveLength(1);
    expect(cu.phanBo[0]!.amount).toBe(HOC_PHI);
    expect(cu.phanBo[0]!.paymentRequestId).toBe(PR1);
  });

  it("[GDC-b] waterfall chia MỘT giao dịch vào HAI đợt → gỡ cả hai, một bút toán đảo", async () => {
    await dungDot(PR1, 1, 4_000_000);
    await dungDot(PR2, 2, 2_000_000);
    // `allocateToOrder` ghi MỘT dòng `Payment` cho cả lượt rót, không phải mỗi đợt một dòng.
    await dungKhoanCu({ id: `${T}pay-b`, amount: HOC_PHI, accountantStatus: "CONFIRMED", enrollmentId: null });
    await phanBo(PR1, 4_000_000);
    await phanBo(PR2, 2_000_000);

    const r = await goGanTheoCon({
      bankTransactionId: TXN,
      orderId: DON,
      lyDo: "Đối soát lại",
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.soDongDao).toBe(1); // một dòng gốc ⇒ một bút toán đảo
      expect(r.tienDao).toBe(HOC_PHI);
    }

    // CẢ HAI đợt về PENDING — gỡ nửa vời (chỉ một đợt) là số còn phải thu của đơn sai.
    const dot = await db.paymentRequest.findMany({
      where: { orderId: DON },
      select: { installmentNo: true, status: true },
      orderBy: { installmentNo: "asc" },
    });
    expect(dot.map((d) => d.status)).toEqual(["PENDING", "PENDING"]);

    const sau = await noTheoCon(DON);
    expect(sau.chuaGanCon).toBe(0);
    expect(sau.con[0]!.conNo).toBe(HOC_PHI);

    // Ảnh chụp phải có ĐỦ HAI dòng phân bổ, kèm số đợt — đó là thứ dựng lại được lượt rót.
    const nk = await db.auditLog.findFirstOrThrow({
      where: { entityType: "BankTransaction", entityId: TXN, action: "TXN_GO_GAN" },
      orderBy: { createdAt: "desc" },
    });
    const cu = nk.oldValues as unknown as { phanBo: { amount: number; installmentNo: number }[] };
    expect(cu.phanBo).toHaveLength(2);
    expect(cu.phanBo.map((p) => [p.installmentNo, p.amount]).sort()).toEqual(
      [
        [1, 4_000_000],
        [2, 2_000_000],
      ].sort(),
    );
  });

  it("[GDC-c1] khoản ĐÃ CÓ `enrollmentId` → GỠ ĐƯỢC, và tổng theo ghi danh về 0", async () => {
    // Có `enrollmentId` KHÔNG phải lý do chặn: bút toán đảo mang đúng ghi danh đó và trái dấu,
    // nên học bạ / công nợ ghi danh không lệch một đồng.
    await dungDot(PR1, 1, HOC_PHI);
    await dungKhoanCu({
      id: `${T}pay-c1`,
      amount: HOC_PHI,
      accountantStatus: "CONFIRMED",
      enrollmentId: ENROLL,
    });
    await phanBo(PR1, HOC_PHI);

    expect(await tongTheoGhiDanh()).toBe(HOC_PHI);

    const r = await goGanTheoCon({
      bankTransactionId: TXN,
      orderId: DON,
      lyDo: "Gắn nhầm đơn",
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);

    const dao = await db.payment.findFirstOrThrow({
      where: { orderId: DON, paymentType: "ADJUSTMENT", deletedAt: null },
    });
    // Đảo phải CHÉP LẠI `enrollmentId`; để null là tổng theo ghi danh không về 0.
    expect(dao.enrollmentId).toBe(ENROLL);
    expect(await tongTheoGhiDanh()).toBe(0);
  });

  /** Dựng khoản CONFIRMED đã xuất phiếu thu ACTIVE + phân bổ — hình dạng của khoản bộ quét tự xác nhận (chủ chốt 08/11/2026). */
  async function dungKhoanDaCoPhieu(ma = "RCP-GDC-99-0001") {
    await dungDot(PR1, 1, HOC_PHI);
    const khoan = await dungKhoanCu({ id: `${T}pay-c2`, amount: HOC_PHI, accountantStatus: "CONFIRMED", enrollmentId: ENROLL });
    await phanBo(PR1, HOC_PHI);
    await db.receipt.create({ data: { id: `${T}rcp`, code: ma, enrollmentId: ENROLL, paymentId: khoan.id, status: "ACTIVE" } });
    return khoan;
  }

  it("[GDC-c2] khoản ĐÃ XUẤT PHIẾU THU, người bấm CHƯA xác nhận thu hồi → từ chối + TRẢ mã phiếu, và KHÔNG gỡ nửa vời", async () => {
    // ⚠️ `Receipt` là chứng từ ĐÃ GIAO cho phụ huynh. [ĐẢO 08/11/2026, PR4a] bản cũ CHẶN cứng («huỷ phiếu trước») — nhưng khoản tự xác nhận
    // khớp SAI đơn thì không có đường huỷ phiếu nào, nên chủ chốt «đảo khoản + phiếu thu». Thu hồi là việc hệ quả ⇒ người bấm phải thấy mã phiếu trước.
    await dungKhoanDaCoPhieu();

    const r = await goGanTheoCon({ bankTransactionId: TXN, orderId: DON, lyDo: "Gắn nhầm đơn", actor: ACTOR });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("phiếu thu");
      expect(r.error).toContain("RCP-GDC-99-0001");
      // Mã phiếu THẬT đi ngược lên giao diện để hỏi lại — không phải chuỗi để người đọc tự bóc.
      expect("canThuHoiPhieu" in r ? r.canThuHoiPhieu : null).toEqual(["RCP-GDC-99-0001"]);
    }

    // ⚠️ KHÔNG GỠ NỬA VỜI: transaction rollback nên phân bổ, đợt, giao dịch, phiếu còn nguyên.
    expect(await db.paymentAllocation.count({ where: { bankTransactionId: TXN } })).toBe(1);
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: PR1 } })).status).toBe("PAID");
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: TXN } })).status).toBe("MATCHED");
    expect((await db.receipt.findUniqueOrThrow({ where: { id: `${T}rcp` } })).status).toBe("ACTIVE");
    expect(await db.payment.count({ where: { orderId: DON, paymentType: "ADJUSTMENT" } })).toBe(0);
    expect(await tongTheoGhiDanh()).toBe(HOC_PHI);
  });

  it("[GDC-c2b] ĐÃ xác nhận đúng mã phiếu → THU HỒI phiếu + đảo khoản: phiếu VOID, đảo CONFIRMED âm giữ ngày thu gốc, giao dịch về hàng chờ, sổ về 0, có nhật ký", async () => {
    const khoan = await dungKhoanDaCoPhieu();

    const r = await goGanTheoCon({ bankTransactionId: TXN, orderId: DON, lyDo: "Khách ghi nhầm mã đơn", actor: ACTOR, phieuThuDaXacNhan: ["RCP-GDC-99-0001"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.phieuThuThuHoi).toEqual(["RCP-GDC-99-0001"]);
      expect(r.soDongDao).toBe(1);
    }

    expect((await db.receipt.findUniqueOrThrow({ where: { id: `${T}rcp` } })).status).toBe("VOID");
    const dao = await db.payment.findFirstOrThrow({ where: { orderId: DON, paymentType: "ADJUSTMENT", deletedAt: null } });
    expect(dao.amount).toBe(-HOC_PHI);
    expect(dao.accountantStatus).toBe("CONFIRMED"); // cùng trục với gốc ⇒ Σ CONFIRMED về 0
    expect(dao.adjustmentOfId).toBe(khoan.id);
    // Ngày thu KẾ THỪA gốc (24/10/2026): doanh thu tháng gốc về 0 chứ không âm ở tháng bấm.
    expect(dao.paidDate.toISOString()).toBe("2699-04-01T03:00:00.000Z");
    expect(await tongTheoGhiDanh()).toBe(0);
    expect(await db.paymentAllocation.count({ where: { bankTransactionId: TXN } })).toBe(0);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: TXN } })).status).toBe("UNMATCHED");
    // Vết RIÊNG cho phiếu bị thu hồi — «RCP-… bị huỷ vì sao, ai huỷ» không chỉ nằm trong JSON của nhật ký giao dịch.
    const vet = await db.auditLog.findFirst({ where: { entityType: "Receipt", entityId: `${T}rcp`, action: "RECEIPT_VOID_GO_GAN" } });
    expect(vet?.reason).toBe("Khách ghi nhầm mã đơn");
    expect(vet?.actorId).toBe(ACTOR.id);
  });

  it("[GDC-c2c] mã đã xác nhận KHÔNG khớp phiếu thật (đủ phiếu cũ nhưng thiếu phiếu mới) → từ chối, MỌI phiếu còn ACTIVE", async () => {
    const khoan = await dungKhoanDaCoPhieu();
    // Giữa hai lần bấm có thêm một phiếu: người bấm mới thấy RCP-0001.
    await db.receipt.create({ data: { id: `${T}rcp2`, code: "RCP-GDC-99-0002", enrollmentId: ENROLL, paymentId: khoan.id, status: "ACTIVE" } });

    const r = await goGanTheoCon({ bankTransactionId: TXN, orderId: DON, lyDo: "Gắn nhầm", actor: ACTOR, phieuThuDaXacNhan: ["RCP-GDC-99-0001"] });
    expect(r.ok).toBe(false);
    expect(!r.ok && "canThuHoiPhieu" in r ? [...r.canThuHoiPhieu].sort() : null).toEqual(["RCP-GDC-99-0001", "RCP-GDC-99-0002"]);
    expect(await db.receipt.count({ where: { paymentId: khoan.id, status: "ACTIVE" } })).toBe(2);
    expect(await db.paymentAllocation.count({ where: { bankTransactionId: TXN } })).toBe(1);
    expect(await db.payment.count({ where: { orderId: DON, paymentType: "ADJUSTMENT" } })).toBe(0);
  });

  it("[GDC-c4] đơn hết «trả đủ» sau khi đảo → xoá Order.paidAt (cổng đơn cọc không còn coi là trả đủ); KHÔNG hạ Order.status", async () => {
    await dungKhoanDaCoPhieu();
    await db.order.update({ where: { id: DON }, data: { status: "CONFIRMED", paidAt: new Date("2699-04-02T03:00:00Z") } });

    const r = await goGanTheoCon({ bankTransactionId: TXN, orderId: DON, lyDo: "Gắn nhầm", actor: ACTOR, phieuThuDaXacNhan: ["RCP-GDC-99-0001"] });
    expect(r.ok).toBe(true);

    const o = await db.order.findUniqueOrThrow({ where: { id: DON } });
    expect(o.paidAt).toBeNull();
    expect(o.status).toBe("CONFIRMED"); // hạ trạng thái đơn kéo theo ghi danh / hoa hồng — việc riêng, người quyết
  });

  it("[GDC-race] bộ quét xác nhận ‖ gỡ gắn cùng MỘT khoản PENDING (12 lượt): KHÔNG BAO GIỜ có phiếu ACTIVE đứng cạnh bút toán đảo", async () => {
    // Kẽ hở PR4a đóng: bộ quét (`xacNhanKhoanTrongTx`) và gỡ gắn ở hai transaction riêng. Trước khi khoá DÒNG khoản ở cả hai đầu, gỡ gắn đọc «chưa phiếu»
    // trong lúc bộ quét cấp phiếu ⇒ khoản gốc CONFIRMED + phiếu ACTIVE + bút toán đảo PENDING. Hai kết cục HỢP LỆ: (A) gỡ gắn đi trước ⇒ bộ quét
    // thấy tiền ròng ≤ 0 và từ chối; (B) bộ quét đi trước ⇒ gỡ gắn thấy phiếu và đòi người bấm xác nhận thu hồi.
    for (let lan = 0; lan < 12; lan++) {
      await dungNen();
      await dungDot(PR1, 1, HOC_PHI);
      const khoan = await dungKhoanCu({ id: `${T}pay-race`, amount: HOC_PHI, accountantStatus: "PENDING", enrollmentId: ENROLL });
      await phanBo(PR1, HOC_PHI);

      await Promise.allSettled([
        goGanTheoCon({ bankTransactionId: TXN, orderId: DON, lyDo: `đua ${lan}`, actor: ACTOR }),
        db.$transaction((tx) =>
          xacNhanKhoanTrongTx(tx, { paymentId: khoan.id, confirmedById: "system", actor: ACTOR, now: new Date("2699-04-03T03:00:00Z"), choPhepTruocGhiDanh: false }),
        ),
      ]);

      const gocSau = await db.payment.findUniqueOrThrow({ where: { id: khoan.id } });
      const coDao = (await db.payment.count({ where: { orderId: DON, paymentType: "ADJUSTMENT", adjustmentOfId: khoan.id, deletedAt: null } })) > 0;
      const phieuActive = await db.receipt.count({ where: { paymentId: khoan.id, status: "ACTIVE" } });
      const conPhanBo = await db.paymentAllocation.count({ where: { bankTransactionId: TXN } });

      expect(coDao && phieuActive > 0, `lượt ${lan}: gốc ${gocSau.accountantStatus}, đảo=${coDao}, phiếu ACTIVE=${phieuActive}`).toBe(false);
      // Đã đảo thì dây nối phân bổ phải mất; chưa đảo thì còn nguyên — không có trạng thái giữa chừng.
      expect(coDao ? conPhanBo === 0 : conPhanBo === 1, `lượt ${lan}: đảo=${coDao}, phân bổ=${conPhanBo}`).toBe(true);
      // Gốc CONFIRMED mà không có phiếu ACTIVE chỉ hợp lệ khi đã có bút toán đảo CONFIRMED đi kèm; PENDING thì không có phiếu nào.
      if (gocSau.accountantStatus === "PENDING") expect(phieuActive).toBe(0);
    }
  });

  it("[GDC-hd] khoản đang nằm trong HOÁ ĐƠN → CHẶN gỡ, nói đúng hoá đơn, KHÔNG gỡ nửa vời", async () => {
    // docs/ke-toan-hoa-don/PLAN.md §5 — gỡ gắn đảo tiền dòng gốc; tờ hoá đơn đã chụp số đó.
    // Đối chứng dương: [GDC-a] (cùng hình dạng, KHÔNG có hoá đơn) gỡ được.
    await dungDot(PR1, 1, HOC_PHI);
    const khoan = await dungKhoanCu({ id: `${T}pay-hd`, amount: HOC_PHI, accountantStatus: "PENDING", enrollmentId: null });
    await phanBo(PR1, HOC_PHI);
    await db.hoaDonDienTu.create({
      data: {
        id: `${T}hd`,
        orderId: DON,
        centerId: CENTER,
        trangThai: "DA_XAC_NHAN",
        kyHieu: "1C26TSR",
        soHoaDon: "4321",
        tongTien: HOC_PHI,
        taoBoiId: ACTOR.id,
        khoan: { create: [{ paymentId: khoan.id, soTien: HOC_PHI }] },
      },
    });

    const r = await goGanTheoCon({ bankTransactionId: TXN, orderId: DON, lyDo: "Gắn nhầm đơn", actor: ACTOR });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("1C26TSR-4321");

    expect(await db.paymentAllocation.count({ where: { bankTransactionId: TXN } })).toBe(1);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: TXN } })).status).toBe("MATCHED");
    expect(await db.payment.count({ where: { orderId: DON, paymentType: "ADJUSTMENT" } })).toBe(0);
  });

  it("[GDC-c3] phiếu thu đã THU HỒI (VOID) thì không chặn nữa", async () => {
    // Cổng phải đo tờ phiếu CÒN HIỆU LỰC, không phải "từng có phiếu". Đo bằng "từng có" là
    // khoá cứng mọi khoản đã đối soát, kể cả sau khi kế toán đã huỷ phiếu đúng quy trình.
    await dungDot(PR1, 1, HOC_PHI);
    const khoan = await dungKhoanCu({
      id: `${T}pay-c3`,
      amount: HOC_PHI,
      accountantStatus: "CONFIRMED",
      enrollmentId: ENROLL,
    });
    await phanBo(PR1, HOC_PHI);
    await db.receipt.create({
      data: {
        id: `${T}rcp3`,
        code: `RCP-GDC-99-0003`,
        enrollmentId: ENROLL,
        paymentId: khoan.id,
        status: "VOID",
      },
    });

    const r = await goGanTheoCon({
      bankTransactionId: TXN,
      orderId: DON,
      lyDo: "Đã huỷ phiếu, gỡ lại",
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.soDongDao).toBe(1);
  });
});
