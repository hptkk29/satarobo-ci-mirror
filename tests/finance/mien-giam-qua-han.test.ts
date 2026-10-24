// tests/finance/mien-giam-qua-han.test.ts — G1 + G2 trên Postgres THẬT.
//
// Chạy: `pnpm test:finance-db`. `pnpm test:unit` trần sẽ SKIP (thiếu `ALLOW_DB_RESET=1`).
//
// Hình dạng fixture = TS-44 + TS-45:
//   TS-44 — *"QLCS miễn 600.000 → chặn (vượt còn nợ 500.000); miễn 500.000 có lý do → Bình
//            còn nợ 0."*
//   TS-45 — *"An và Bình cùng quá hạn Đợt 2, Chi PAUSED quá hạn … 1 dòng gia đình gồm An,
//            Bình (không có Chi)."*
//
// ─────────────────────────────────────────────────────────────────────────────
// THỨ BỘ NÀY KIỂM MÀ TEST THUẦN KHÔNG KIỂM ĐƯỢC
//
//   · miễn giảm có hạ ĐÚNG CỘT mà `docSoTheoCon` đang đọc không — `discountAmount` cho bé
//     còn học, `usedValue` cho bé đã dừng. Sai cột thì màn hình KHÔNG nhúc nhích;
//   · đợt đang mở có tụt theo phần nợ vừa miễn không (VOID + tạo lại), và QR cũ có hết hiệu
//     lực không;
//   · `Order.discountAmount` có bằng ĐÚNG tổng các dòng không;
//   · bé đang BẢO LƯU có thật sự rơi khỏi danh sách quá hạn không (AC4) — câu này chỉ trả
//     lời được khi có một `StudentReserve` thật trong DB.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { mienGiamNoChoCon } from "@/lib/finance/mien-giam-db";
import { docNhaQuaHan } from "@/lib/finance/qua-han-db";
import { noTheoCon } from "@/lib/finance/debt";
import { CACH_HAP_THU } from "@/lib/orders/chinh-sach-uu-dai";

if (!RUN_DB_TESTS) console.warn(`[MQH] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-mqh-";
const ACTOR = { id: `${T}actor`, name: "QLCS fixture MQH" };
const CENTER = `${T}center`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const DON = `${T}don`;
const SALE = `${T}sale`;
/** Sale CHĂM lead — khác người TẠO đơn. Luật: người chăm thắng. */
const SALE_CHAM = `${T}sale-cham`;
const LEAD = `${T}lead`;
/** Ba bé: An, Bình (cùng quá hạn) và Chi (quá hạn nhưng ĐANG BẢO LƯU). */
const OI_AN = `${T}oi-an`;
const OI_BINH = `${T}oi-binh`;
const OI_CHI = `${T}oi-chi`;
const HS_CHI = `${T}hs-chi`;
const GD_CHI = `${T}gd-chi`;
const RESERVE = `${T}reserve`;

const HOC_PHI = 12_000_000;
/** Bình đã đóng 11.500.000 ⇒ còn nợ 500.000 — đúng TS-44. */
const BINH_DA_DONG = 11_500_000;
const TRAN_PHAN_TRAM = 50;

const HAN_QUA = new Date("2699-10-10T00:00:00Z");
const NAY = new Date("2699-10-20T03:00:00Z");

async function don() {
  await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: DON } });
  await db.studentReserve.deleteMany({ where: { studentId: HS_CHI } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: `${T}txn` } } });
  await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollment.deleteMany({ where: { studentId: HS_CHI } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.student.deleteMany({ where: { id: HS_CHI } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.lead.deleteMany({ where: { id: LEAD } });
  await db.user.deleteMany({ where: { id: { in: [SALE, SALE_CHAM] } } });
  await db.center.deleteMany({ where: { id: CENTER } });
}

async function dungFixture() {
  await don();
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture MQH", slug: `${T}cs`, address: "114 Hoàng Diệu" },
  });
  await db.course.create({
    data: { id: KHOA, name: "Sata 3 fixture MQH", slug: `${T}s3`, price: HOC_PHI, totalSessions: 48 },
  });
  await db.class.create({
    data: { id: LOP, name: "Lớp MQH", courseId: KHOA, centerId: CENTER, maxStudents: 12 },
  });
  await db.user.create({
    data: { id: SALE, name: "Sale phụ trách MQH", phone: "0999000926", role: "SALES_CSM", centerId: CENTER },
  });
  await db.user.create({
    data: { id: SALE_CHAM, name: "Sale CHĂM lead MQH", phone: "0999000928", role: "SALES_CSM", centerId: CENTER },
  });
  // Chi có ghi danh THẬT để gắn lượt bảo lưu vào.
  await db.student.create({ data: { id: HS_CHI, name: "Bé Chi MQH", centerId: CENTER } });
  await db.enrollment.create({
    data: { id: GD_CHI, studentId: HS_CHI, classId: LOP, courseId: KHOA, centerId: CENTER, status: "ACTIVE" },
  });

  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269922-000005",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture MQH",
      customerPhone: "0999000927",
      subtotal: HOC_PHI * 3,
      discountAmount: 0,
      totalAmount: HOC_PHI * 3,
      centerId: CENTER,
      createdById: SALE,
    },
  });
  for (const [id, ten, gd] of [
    [OI_AN, "Bé An MQH", null],
    [OI_BINH, "Bé Bình MQH", null],
    [OI_CHI, "Bé Chi MQH", GD_CHI],
  ] as const) {
    await db.orderItem.create({
      data: {
        id,
        orderId: DON,
        type: "COURSE_ENROLLMENT",
        itemName: ten,
        quantity: 1,
        unitPrice: HOC_PHI,
        totalPrice: HOC_PHI,
        discountAmount: 0,
        enrollmentId: gd,
      },
    });
  }

  // Ba bé, mỗi bé MỘT đợt ĐÃ QUÁ HẠN.
  for (const [id, oi, tien] of [
    [`${T}pr-an`, OI_AN, HOC_PHI],
    [`${T}pr-binh`, OI_BINH, 500_000],
    [`${T}pr-chi`, OI_CHI, HOC_PHI],
  ] as const) {
    await db.paymentRequest.create({
      data: {
        id,
        orderId: DON,
        orderItemId: oi,
        centerId: CENTER,
        installmentNo: 2,
        amountDue: tien,
        dueDate: HAN_QUA,
        status: "PENDING",
      },
    });
  }

  // Bình đã đóng 11.500.000 ⇒ còn nợ ĐÚNG 500.000 (TS-44).
  await db.payment.create({
    data: {
      id: `${T}pay-binh`,
      orderId: DON,
      orderItemId: OI_BINH,
      amount: BINH_DA_DONG,
      method: "BANK_TRANSFER",
      accountantStatus: "CONFIRMED",
      paidDate: new Date("2699-09-01T00:00:00Z"),
      centerId: CENTER,
    },
  });

  // Chi ĐANG BẢO LƯU — AC4: không vào danh sách quá hạn.
  await db.studentReserve.create({
    data: {
      id: RESERVE,
      studentId: HS_CHI,
      enrollmentId: null,
      reason: "Gia đình về quê",
      startedAt: new Date("2699-10-01T00:00:00Z"),
      expectedEndAt: new Date("2699-11-01T00:00:00Z"),
      createdByUserId: ACTOR.id,
      createdByName: ACTOR.name,
      isActive: true,
    },
  });
}

const mien = (soTien: number, them: Record<string, unknown> = {}) =>
  mienGiamNoChoCon({
    orderId: DON,
    orderItemId: OI_BINH,
    soTien,
    lyDo: "Hoàn cảnh gia đình, QLCS duyệt",
    hapThu: CACH_HAP_THU.DOT_GAN_NHAT,
    tranPhanTram: TRAN_PHAN_TRAM,
    actor: ACTOR,
    ...them,
  });

describe.skipIf(!RUN_DB_TESTS)("[MQH] G1 — miễn giảm nợ", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[MQH-00] fixture đúng TS-44: Bình còn nợ ĐÚNG 500.000, đợt đã quá hạn", async () => {
    // Ca kiểm chính FIXTURE. Thiếu nó thì ca "vượt trần" xanh vì trần là một số khác.
    const so = await noTheoCon(DON);
    const binh = so.con.find((c) => c.orderItemId === OI_BINH)!;
    expect(binh.daThu).toBe(BINH_DA_DONG);
    expect(binh.conNo).toBe(500_000);
    expect(await db.paymentRequest.count({ where: { orderId: DON, status: "PENDING" } })).toBe(3);
  });

  it("[MQH-01] TS-44: miễn 500.000 ⇒ Bình còn nợ 0, và đợt tụt theo", async () => {
    const r = await mien(500_000);
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.soTien).toBe(500_000);
    expect(r.soDotDaDoi, "đợt 500.000 phải được huỷ & tạo lại ở 0đ ⇒ chỉ VOID").toBe(1);
    expect(r.chuaHapThu).toBe(0);

    const so = await noTheoCon(DON);
    const binh = so.con.find((c) => c.orderItemId === OI_BINH)!;
    expect(binh.phaiThu).toBe(HOC_PHI - 500_000);
    expect(binh.conNo, "TS-44: còn nợ 0").toBe(0);
    expect(binh.tongDotDangMo, "không còn đợt nào mở").toBe(0);
  });

  it("[MQH-02] TS-44: miễn 600.000 khi còn nợ 500.000 ⇒ CHẶN, không ghi gì", async () => {
    const truoc = {
      dong: await db.orderItem.findUniqueOrThrow({ where: { id: OI_BINH } }),
      dot: await db.paymentRequest.count({ where: { orderId: DON, status: "PENDING" } }),
      log: await db.auditLog.count({ where: { entityType: "Order", entityId: DON } }),
    };
    const r = await mien(600_000);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("tối đa 500.000đ");
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: OI_BINH } })).toEqual(truoc.dong);
    expect(await db.paymentRequest.count({ where: { orderId: DON, status: "PENDING" } })).toBe(truoc.dot);
    expect(await db.auditLog.count({ where: { entityType: "Order", entityId: DON } })).toBe(truoc.log);
  });

  it("[MQH-03] khoản miễn mang NHÃN để báo cáo tháng lọc được (AC4)", async () => {
    expect((await mien(500_000)).ok).toBe(true);
    const dong = await db.orderItem.findUniqueOrThrow({ where: { id: OI_BINH } });
    expect(dong.discountAmount).toBe(500_000);
    const khoan = (Array.isArray(dong.discounts) ? dong.discounts : []) as { lyDo?: string; loai?: string }[];
    expect(khoan).toHaveLength(1);
    expect(khoan[0]!.lyDo ?? "").toContain("Miễn giảm");
    expect(khoan[0]!.loai).toBe("KHAC");
  });

  it("[MQH-04] `Order.discountAmount` bằng ĐÚNG tổng các dòng", async () => {
    // Hai đường nhập cho cùng một con tiền là định nghĩa của sổ lệch — cột này được hoá đơn,
    // tin nhắn và báo cáo doanh thu đọc.
    expect((await mien(500_000)).ok).toBe(true);
    const donSau = await db.order.findUniqueOrThrow({ where: { id: DON } });
    const dong = await db.orderItem.findMany({ where: { orderId: DON } });
    expect(donSau.discountAmount).toBe(dong.reduce((s, d) => s + d.discountAmount, 0));
    expect(donSau.subtotal).toBe(dong.reduce((s, d) => s + d.totalPrice, 0));
    expect(donSau.totalAmount).toBe(donSau.subtotal - donSau.discountAmount);
  });

  it("[MQH-05] bé ĐÃ DỪNG HỌC ⇒ hạ `usedValue`, và phải thu trên màn TỤT THẬT", async () => {
    // ⚠️ Ca quan trọng nhất của G1. `phaiThu` của bé đã dừng đọc `usedValue`, nên ghi vào
    // `discountAmount` là con số trên màn KHÔNG nhúc nhích trong khi nhật ký nói đã miễn.
    await db.orderItem.update({
      where: { id: OI_AN },
      data: { status: "STOPPED", usedValue: 4_000_000, stoppedAt: NAY },
    });
    const truoc = await noTheoCon(DON);
    expect(truoc.con.find((c) => c.orderItemId === OI_AN)!.phaiThu).toBe(4_000_000);

    const r = await mienGiamNoChoCon({
      orderId: DON,
      orderItemId: OI_AN,
      soTien: 1_000_000,
      lyDo: "Trung tâm bù buổi không xếp được",
      hapThu: CACH_HAP_THU.DOT_GAN_NHAT,
      tranPhanTram: TRAN_PHAN_TRAM,
      actor: ACTOR,
    });
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);

    const dong = await db.orderItem.findUniqueOrThrow({ where: { id: OI_AN } });
    expect(dong.usedValue).toBe(3_000_000);
    expect(dong.discountAmount, "KHÔNG đụng cột giảm giá").toBe(0);
    const sau = await noTheoCon(DON);
    expect(sau.con.find((c) => c.orderItemId === OI_AN)!.phaiThu).toBe(3_000_000);
  });

  it("[MQH-06] đợt bị tạo lại làm mã QR CŨ hết hiệu lực", async () => {
    await db.qrSession.create({
      data: {
        id: `${T}qr`,
        paymentRequestId: `${T}pr-an`,
        status: "ACTIVE",
        amountShown: HOC_PHI,
        expiresAt: new Date("2699-12-31T00:00:00Z"),
        centerId: CENTER,
      },
    });
    const r = await mienGiamNoChoCon({
      orderId: DON,
      orderItemId: OI_AN,
      soTien: 2_000_000,
      lyDo: "QLCS duyệt",
      hapThu: CACH_HAP_THU.DOT_GAN_NHAT,
      tranPhanTram: TRAN_PHAN_TRAM,
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);
    expect((await db.qrSession.findUniqueOrThrow({ where: { id: `${T}qr` } })).status).toBe("EXPIRED");
    // Đợt cũ VOID, đợt mới mang số đã trừ.
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: `${T}pr-an` } })).status).toBe("VOID");
    const moi = await db.paymentRequest.findFirst({
      where: { orderItemId: OI_AN, status: "PENDING" },
    });
    expect(moi?.amountDue).toBe(HOC_PHI - 2_000_000);
  });

  it("[MQH-07] nhật ký ghi ĐỦ số trước và sau", async () => {
    expect((await mien(500_000)).ok).toBe(true);
    const vet = await db.auditLog.findFirst({
      where: { entityType: "Order", entityId: DON, action: "MIEN_GIAM_NO" },
    });
    expect(vet).not.toBeNull();
    expect((vet!.oldValues as { conNo: number }).conNo).toBe(500_000);
    expect((vet!.newValues as { soTien: number; conNo: number }).soTien).toBe(500_000);
    expect((vet!.newValues as { conNo: number }).conNo).toBe(0);
    expect(vet!.reason).toContain("Hoàn cảnh");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[MQH] G2 — danh sách quá hạn", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[MQH-08] TS-45: MỘT nhà gồm An và Bình — KHÔNG có Chi (bé bảo lưu)", async () => {
    const r = await docNhaQuaHan({ now: NAY });
    expect(r.nha).toHaveLength(1);
    expect(r.nha[0]!.con.map((c) => c.tenCon).sort()).toEqual(["Bé An MQH", "Bé Bình MQH"]);
    expect(r.thaViBaoLuu, "đúng một đợt được tha vì bảo lưu").toBe(1);
    expect(r.nha[0]!.nenGopPhieu, "hai bé cùng quá hạn ⇒ gợi ý phiếu gộp").toBe(true);
  });

  it("[MQH-09] HỌC LẠI (kết thúc bảo lưu) ⇒ Chi quay lại danh sách ngay", async () => {
    await db.studentReserve.update({
      where: { id: RESERVE },
      data: { isActive: false, endedAt: new Date("2699-10-15T00:00:00Z") },
    });
    const r = await docNhaQuaHan({ now: NAY });
    expect(r.nha[0]!.con.map((c) => c.tenCon).sort()).toEqual([
      "Bé An MQH",
      "Bé Bình MQH",
      "Bé Chi MQH",
    ]);
    expect(r.thaViBaoLuu).toBe(0);
  });

  it("[MQH-10] sale phụ trách suy đúng, và số nhà KHÔNG suy được thì ĐẾM ra", async () => {
    const r = await docNhaQuaHan({ now: NAY });
    expect(r.nha[0]!.saleUserId).toBe(SALE);
    expect(r.khongCoSale).toBe(0);

    // Đơn không có người tạo và không có lead ⇒ không ai nhận tin. Phải ĐẾM, không lặng lẽ bỏ.
    await db.order.update({ where: { id: DON }, data: { createdById: null } });
    const r2 = await docNhaQuaHan({ now: NAY });
    expect(r2.nha[0]!.saleUserId).toBeNull();
    expect(r2.khongCoSale).toBe(1);
  });

  it("[MQH-10b] sale CHĂM LEAD thắng người TẠO đơn", async () => {
    // ⚠️ Ca này sinh ra sau một phép cấy ra 0 ĐỎ: luật "người chăm thắng" không ca nào canh,
    // nên đổi nó thành `createdById` đơn thuần vẫn xanh cả bộ. Mà người TẠO đơn rất hay là
    // kế toán nhập hộ hoặc một lượt chốt hàng loạt — nhắc họ là nhắc nhầm người mỗi sáng.
    await db.lead.create({
      data: { id: LEAD, parentName: "PH fixture MQH", phone: "0999000927", assignedToId: SALE_CHAM },
    });
    await db.order.update({ where: { id: DON }, data: { leadId: LEAD } });

    const r = await docNhaQuaHan({ now: NAY });
    expect(r.nha[0]!.saleUserId, "người CHĂM, không phải người TẠO").toBe(SALE_CHAM);

    // Lead không có người chăm ⇒ rơi về người tạo đơn.
    await db.lead.update({ where: { id: LEAD }, data: { assignedToId: null } });
    expect((await docNhaQuaHan({ now: NAY })).nha[0]!.saleUserId).toBe(SALE);
  });

  it("[MQH-11] đơn ĐÃ HUỶ / ĐÃ HOÀN ⇒ rơi khỏi danh sách", async () => {
    // Nhắc nợ trên một đơn đã huỷ là gọi điện đòi tiền một hợp đồng không còn tồn tại.
    for (const status of ["CANCELLED", "REFUNDED", "DRAFT"] as const) {
      await db.order.update({ where: { id: DON }, data: { status } });
      expect((await docNhaQuaHan({ now: NAY })).nha, status).toHaveLength(0);
    }
  });

  it("[MQH-12] đợt CHƯA tới hạn không vào danh sách", async () => {
    await db.paymentRequest.updateMany({
      where: { orderId: DON },
      data: { dueDate: new Date("2699-12-01T00:00:00Z") },
    });
    expect((await docNhaQuaHan({ now: NAY })).nha).toHaveLength(0);
  });

  it("[MQH-13] đợt PARTIAL đã rót ĐỦ ⇒ không còn thiếu ⇒ rơi khỏi danh sách", async () => {
    // ⚠️ Không tin mỗi `status`: `deriveStatus` có ngưỡng dung sai làm tròn riêng, nên một
    // đợt vẫn mang nhãn `PARTIAL` mà số đã rót bằng (hoặc hơn) `amountDue`. Đo bằng SỐ.
    const txn = await db.bankTransaction.create({
      data: {
        id: `${T}txn-an`,
        provider: "sepay",
        providerTxnId: `${T}txn-an`,
        amount: HOC_PHI,
        transferredAt: HAN_QUA,
        status: "MATCHED",
        centerId: CENTER,
      },
      select: { id: true },
    });
    await db.paymentAllocation.create({
      data: { bankTransactionId: txn.id, paymentRequestId: `${T}pr-an`, amount: HOC_PHI, centerId: CENTER },
    });
    await db.paymentRequest.update({ where: { id: `${T}pr-an` }, data: { status: "PARTIAL" } });

    const r = await docNhaQuaHan({ now: NAY });
    expect(r.nha[0]!.con.map((c) => c.tenCon)).toEqual(["Bé Bình MQH"]);
  });

  it("[MQH-14] số ngày quá hạn và số tiền thiếu đúng trên dữ liệu thật", async () => {
    const r = await docNhaQuaHan({ now: NAY });
    const nha = r.nha[0]!;
    expect(nha.soNgayQuaNhieuNhat).toBe(10);
    expect(nha.tongConThieu).toBe(HOC_PHI + 500_000);
    expect(nha.orderCode).toBe("ORD-269922-000005");
  });

  it("[MQH-15] MIỄN GIẢM xong ⇒ bé rơi khỏi danh sách quá hạn ngay", async () => {
    // Hai nửa của phiên G gặp nhau: miễn hết nợ thì không còn gì để nhắc. Nếu đợt không được
    // VOID theo, sale vẫn bị nhắc mỗi sáng về một khoản đã được xoá.
    expect((await mien(500_000)).ok).toBe(true);
    const r = await docNhaQuaHan({ now: NAY });
    expect(r.nha[0]!.con.map((c) => c.tenCon)).toEqual(["Bé An MQH"]);
  });
});
