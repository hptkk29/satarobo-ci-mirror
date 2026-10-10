// tests/finance/them-con-vao-don.test.ts — F3 · US-19 trên Postgres THẬT.
//
// Chạy: `pnpm test:finance-db`. `pnpm test:unit` trần sẽ SKIP (thiếu `ALLOW_DB_RESET=1`).
//
// Hình dạng fixture = TS-40 (`docs/thanh-toan-linh-hoat/05-TestScenarios…`):
//   *"gia đình chỉ có Bình (12.000.000, Đợt 1 đã trả, Đợt 2 chưa trả) … thêm An Sata3 mẫu
//   FULL … An (học phí thấp hơn) nhận 10% → 8.640.000; Bình không đổi; không có quyết toán
//   âm nào; kỳ thu gom được Bình·Đợt 2 và An·Full"*.
//
// ─────────────────────────────────────────────────────────────────────────────
// THỨ BỘ NÀY KIỂM MÀ TEST THUẦN KHÔNG KIỂM ĐƯỢC
//
//   · dòng hàng có thật sự SINH RA trên đơn không — trước F3 `orderItem.create` có 0 đường;
//   · `Order.subtotal/discountAmount/totalAmount` có bằng ĐÚNG tổng các dòng không (hai
//     đường nhập cho cùng một con tiền là định nghĩa của sổ lệch);
//   · đợt giảm số có đi qua VOID + TẠO LẠI không, và `matchKey`/QR cũ có hết hiệu lực không;
//   · đợt ĐÃ CÓ TIỀN có thật sự không bị chạm không — câu này chỉ trả lời được bằng cách
//     đọc lại `amountDue` trên DB;
//   · cổng soát giá có ăn `Course.price` từ DB không (không nhận giá từ người gọi).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { themConVaoDon, xemTruocThemCon } from "@/lib/finance/them-con-vao-don";
import { noTheoCon } from "@/lib/finance/debt";
import {
  CACH_HAP_THU,
  CHINH_SACH_MAC_DINH,
  type ChinhSachUuDai,
} from "@/lib/orders/chinh-sach-uu-dai";

if (!RUN_DB_TESTS) console.warn(`[TCD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-tcd-";
const ACTOR = { id: `${T}actor`, name: "Sale fixture TCD" };
const CENTER = `${T}center`;
/** Khoá của Bình — ĐẮT hơn. */
const KHOA_BINH = `${T}khoa-binh`;
/** Khoá của An — RẺ hơn, nên An là "con thứ hai" theo chính sách mặc định. */
const KHOA_AN = `${T}khoa-an`;
/** Khoá chưa khai giá — dùng kiểm cổng. */
const KHOA_KHONG_GIA = `${T}khoa-khong-gia`;
const DON = `${T}don`;
const OI_BINH = `${T}oi-binh`;

const GIA_BINH = 12_000_000;
const GIA_AN = 9_600_000;
const TRAN_PHAN_TRAM = 50;

const HAN_DOT_1 = new Date("2699-08-01T00:00:00Z");
const HAN_DOT_2 = new Date("2699-10-01T00:00:00Z");
const HAN_DOT_3 = new Date("2699-12-01T00:00:00Z");

/** Chính sách BẬT — quản lý đã cài. Mặc định của repo là TẮT, xem `[UDC-09]`. */
const BAT: ChinhSachUuDai = { ...CHINH_SACH_MAC_DINH, tuDong: true };

async function don() {
  await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: DON } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.bankTransaction.deleteMany({ where: { id: { in: [`${T}txn-1`, `${T}txn-2`] } } });
  await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.course.deleteMany({ where: { id: { in: [KHOA_BINH, KHOA_AN, KHOA_KHONG_GIA] } } });
  await db.center.deleteMany({ where: { id: CENTER } });
}

/**
 * Bình 12.000.000: đợt 1 ĐÃ TRẢ 6.000.000, đợt 2 và 3 chưa thu.
 *
 * ⚠️ "Đã trả" phải là `PaymentAllocation` THẬT, không phải một cột `status: "PAID"` gõ tay:
 * phép hấp thụ đọc `Σ allocations` để biết đợt nào không được chạm, nên một fixture đặt
 * status bằng tay sẽ làm mọi ca dưới xanh vì cổng không thấy tiền.
 */
async function dungFixture(opts: { soDot?: 2 | 3 } = {}) {
  await don();
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture TCD", slug: `${T}cs`, address: "211 Nguyễn Hữu Thọ" },
  });
  await db.course.create({
    data: { id: KHOA_BINH, name: "Sata 5 fixture", slug: `${T}sata-5`, price: GIA_BINH, totalSessions: 48 },
  });
  await db.course.create({
    data: { id: KHOA_AN, name: "Sata 3 fixture", slug: `${T}sata-3`, price: GIA_AN, totalSessions: 48 },
  });
  await db.course.create({
    data: { id: KHOA_KHONG_GIA, name: "Khoá chưa khai giá", slug: `${T}chua-gia`, price: null },
  });

  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269922-000003",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture TCD",
      customerPhone: "0999000924",
      subtotal: GIA_BINH,
      discountAmount: 0,
      totalAmount: GIA_BINH,
      centerId: CENTER,
    },
  });
  await db.orderItem.create({
    data: {
      id: OI_BINH,
      orderId: DON,
      type: "COURSE_ENROLLMENT",
      itemName: "Bé Bình TCD",
      quantity: 1,
      unitPrice: GIA_BINH,
      totalPrice: GIA_BINH,
      discountAmount: 0,
    },
  });

  const soDot = opts.soDot ?? 3;
  const dot: { id: string; installmentNo: number; amountDue: number; dueDate: Date }[] = [
    { id: `${T}pr-1`, installmentNo: 1, amountDue: 6_000_000, dueDate: HAN_DOT_1 },
    { id: `${T}pr-2`, installmentNo: 2, amountDue: 3_000_000, dueDate: HAN_DOT_2 },
  ];
  if (soDot === 3) {
    dot.push({ id: `${T}pr-3`, installmentNo: 3, amountDue: 3_000_000, dueDate: HAN_DOT_3 });
  } else {
    dot[1]!.amountDue = 6_000_000;
  }
  for (const d of dot) {
    await db.paymentRequest.create({
      data: { ...d, orderId: DON, orderItemId: OI_BINH, centerId: CENTER, status: "PENDING" },
    });
  }

  // Đợt 1 ĐÃ TRẢ — tiền thật: `Payment` (Ledger-A) + `BankTransaction` → `PaymentAllocation`
  // (Ledger-B). `PaymentAllocation` BẮT BUỘC có `bankTransactionId`: mọi đồng rót vào một
  // phiếu phải truy được về một giao dịch ngân hàng, nên fixture không đi đường tắt được.
  await db.payment.create({
    data: {
      id: `${T}pay-1`,
      orderId: DON,
      orderItemId: OI_BINH,
      amount: 6_000_000,
      method: "BANK_TRANSFER",
      accountantStatus: "CONFIRMED",
      paidDate: HAN_DOT_1,
      centerId: CENTER,
    },
  });
  const txn = await db.bankTransaction.create({
    data: {
      id: `${T}txn-1`,
      provider: "sepay",
      providerTxnId: `${T}txn-1`,
      amount: 6_000_000,
      transferredAt: HAN_DOT_1,
      status: "MATCHED",
      centerId: CENTER,
    },
    select: { id: true },
  });
  await db.paymentAllocation.create({
    data: {
      bankTransactionId: txn.id,
      paymentRequestId: `${T}pr-1`,
      amount: 6_000_000,
      centerId: CENTER,
    },
  });
  await db.paymentRequest.update({ where: { id: `${T}pr-1` }, data: { status: "PAID" } });
}

const conAn = (them: Record<string, unknown> = {}) => ({
  itemName: "Bé An TCD",
  courseId: KHOA_AN,
  quantity: 1,
  unitPrice: GIA_AN,
  ...them,
});

const them = (chinhSach = BAT, conMoi = conAn(), lyDo = "Em thứ hai vào học từ tháng 10") =>
  themConVaoDon({
    orderId: DON,
    conMoi,
    chinhSach,
    tranPhanTram: TRAN_PHAN_TRAM,
    lyDo,
    actor: ACTOR,
  });

const dotCua = (orderItemId: string) =>
  db.paymentRequest.findMany({
    where: { orderItemId },
    select: { id: true, installmentNo: true, amountDue: true, status: true, dueDate: true },
    orderBy: { installmentNo: "asc" },
  });

describe.skipIf(!RUN_DB_TESTS)("[TCD] thêm con vào đơn đang học", () => {
  beforeEach(() => dungFixture());
  afterAll(don);

  it("[TCD-00] fixture đúng hình dạng TS-40: Bình 12tr, đợt 1 ĐÃ TRẢ bằng tiền thật", async () => {
    // Ca kiểm chính FIXTURE. Thiếu nó thì ca "đợt đã có tiền không bị chạm" xanh vì không có
    // đợt nào có tiền.
    const d = await dotCua(OI_BINH);
    expect(d.map((x) => x.amountDue)).toEqual([6_000_000, 3_000_000, 3_000_000]);
    expect(d[0]!.status).toBe("PAID");
    const rot = await db.paymentAllocation.aggregate({
      where: { paymentRequestId: `${T}pr-1` },
      _sum: { amount: true },
    });
    expect(rot._sum.amount, "đợt 1 phải có tiền THẬT đã rót").toBe(6_000_000);
  });

  it("[TCD-01] TS-40: An nhận 10% → 8.640.000; Bình KHÔNG đổi; tổng đơn đúng", async () => {
    const r = await them();
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.soCon).toBe(2);
    // Bình không đổi ⇒ không đợt nào phải tạo lại.
    expect(r.soDotDaDoi, "Bình không đổi nên không đợt nào bị sửa").toBe(0);

    const so = await noTheoCon(DON);
    const an = so.con.find((c) => c.ten === "Bé An TCD")!;
    const binh = so.con.find((c) => c.orderItemId === OI_BINH)!;
    expect(an.phaiThu, "học phí thực của An").toBe(8_640_000);
    expect(binh.phaiThu, "Bình KHÔNG đổi").toBe(GIA_BINH);

    // `Order` phải bằng ĐÚNG tổng các dòng — không phải một số nhập độc lập.
    const donSau = await db.order.findUniqueOrThrow({ where: { id: DON } });
    expect(donSau.subtotal).toBe(GIA_BINH + GIA_AN);
    expect(donSau.discountAmount).toBe(960_000);
    expect(donSau.totalAmount).toBe(GIA_BINH + GIA_AN - 960_000);
    expect(r.tongDonMoi).toBe(donSau.totalAmount);
  });

  it("[TCD-02] dòng mới mang đủ dấu vết ưu đãi để người đọc đơn hiểu được", async () => {
    const r = await them();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dong = await db.orderItem.findUniqueOrThrow({ where: { id: r.orderItemId } });
    expect(dong.totalPrice).toBe(GIA_AN);
    expect(dong.discountAmount).toBe(960_000);
    expect(dong.discountPercent, "một khoản % duy nhất ⇒ % của dòng có nghĩa").toBe(10);
    expect(dong.discountReason ?? "").toContain("anh chị em");
    expect(Array.isArray(dong.discounts) ? dong.discounts : []).toHaveLength(1);
  });

  it("[TCD-03] AC3 — thêm con ĐẮT HƠN: ưu đãi chuyển sang Bình, đợt CHƯA THU bị tạo lại", async () => {
    // Đây là ca đắt nhất của F3. Bình 12tr rẻ hơn con mới 20tr ⇒ Bình thành con thứ hai và
    // được giảm 1.200.000 MUỘN, sau khi đã chia đợt và đã thu một đợt.
    const r = await them(BAT, conAn({ itemName: "Bé Cường TCD", courseId: KHOA_BINH, unitPrice: 20_000_000 }));
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.soDotDaDoi).toBe(1);

    const d = await dotCua(OI_BINH);
    // Đợt 1 ĐÃ TRẢ — tuyệt đối không chạm.
    const dot1 = d.find((x) => x.id === `${T}pr-1`)!;
    expect(dot1.amountDue, "đợt đã thu KHÔNG bị sửa số").toBe(6_000_000);
    expect(dot1.status).toBe("PAID");
    // Đợt 3 (xa nhất) bị VOID và có một đợt MỚI thay nó với số thấp hơn.
    expect(d.find((x) => x.id === `${T}pr-3`)!.status).toBe("VOID");
    expect(d.find((x) => x.id === `${T}pr-2`)!.amountDue, "đợt gần nhất giữ nguyên").toBe(3_000_000);
    const moi = d.filter((x) => !x.id.startsWith(`${T}pr-`));
    expect(moi).toHaveLength(1);
    expect(moi[0]!.amountDue).toBe(3_000_000 - 1_200_000);
    expect(moi[0]!.dueDate!.getTime(), "đợt tạo lại giữ HẠN của đợt cũ").toBe(HAN_DOT_3.getTime());

    // Học phí thực của Bình giảm đúng 1.200.000, và tổng đợt mở khớp phần còn phải thu.
    const so = await noTheoCon(DON);
    const binh = so.con.find((c) => c.orderItemId === OI_BINH)!;
    expect(binh.phaiThu).toBe(GIA_BINH - 1_200_000);
    expect(binh.tongDotDangMo).toBe(GIA_BINH - 1_200_000 - 6_000_000);

    // ⚠️ `Order.discountAmount` phải là ĐÚNG tổng giảm của MỌI dòng, kể cả dòng CŨ vừa được
    // giảm muộn. Đo bằng cấy lỗi: bản đầu của bộ này KHÔNG có ba dòng dưới, và cấy
    // "tổng giảm của đơn chỉ tính dòng mới" ra **0 ca đỏ** — tức cột mà hoá đơn · tin nhắn ·
    // báo cáo doanh thu đều đọc có thể lệch mà không lưới nào biết. `[TCD-01]` không bắt
    // được vì ở đó bé cũ không đổi gì nên hai phép tính ra cùng một số.
    const donSau = await db.order.findUniqueOrThrow({ where: { id: DON } });
    expect(donSau.discountAmount, "Σ giảm của MỌI dòng").toBe(1_200_000);
    expect(donSau.subtotal).toBe(GIA_BINH + 20_000_000);
    expect(donSau.totalAmount).toBe(GIA_BINH + 20_000_000 - 1_200_000);
  });

  it("[TCD-04] đợt tạo lại làm mã QR CŨ hết hiệu lực", async () => {
    // `PaymentRequest.matchKey` bền theo ĐỜI của phiếu, nên một QR còn sống trỏ vào phiếu vừa
    // VOID là tiền về khớp vào một phiếu đã huỷ.
    await db.qrSession.create({
      data: {
        id: `${T}qr-3`,
        paymentRequestId: `${T}pr-3`,
        status: "ACTIVE",
        // `amountShown` = số IN TRÊN mã QR, và nó BẮT BUỘC. Không có cột `amount` ở đây:
        // phiên QR không giữ số tiền của phiếu, nó giữ số đã in ra cho phụ huynh.
        amountShown: 3_000_000,
        expiresAt: new Date("2699-12-31T00:00:00Z"),
        centerId: CENTER,
      },
    });
    const r = await them(BAT, conAn({ itemName: "Bé Cường TCD", courseId: KHOA_BINH, unitPrice: 20_000_000 }));
    expect(r.ok).toBe(true);
    const qr = await db.qrSession.findUniqueOrThrow({ where: { id: `${T}qr-3` } });
    expect(qr.status).toBe("EXPIRED");
  });

  it("[TCD-05] chính sách TẮT ⇒ thêm con KHÔNG đổi học phí bé nào", async () => {
    const r = await them(CHINH_SACH_MAC_DINH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.soDotDaDoi).toBe(0);
    const so = await noTheoCon(DON);
    expect(so.con.find((c) => c.ten === "Bé An TCD")!.phaiThu, "không giảm gì").toBe(GIA_AN);
    expect(so.con.find((c) => c.orderItemId === OI_BINH)!.phaiThu).toBe(GIA_BINH);
    expect((await dotCua(OI_BINH)).every((d) => d.status !== "VOID")).toBe(true);
  });

  it("[TCD-06] CHIA ĐỀU: cả hai đợt chưa thu đều đổi, tổng khớp KHÍT", async () => {
    const r = await them(
      { ...BAT, hapThu: CACH_HAP_THU.CHIA_DEU },
      conAn({ itemName: "Bé Cường TCD", courseId: KHOA_BINH, unitPrice: 20_000_000 }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.soDotDaDoi).toBe(2);
    const d = await dotCua(OI_BINH);
    const conMo = d.filter((x) => x.status === "PENDING");
    expect(conMo.reduce((s, x) => s + x.amountDue, 0)).toBe(6_000_000 - 1_200_000);
  });

  it("[TCD-07] hạ giá dòng THẤP HƠN niêm yết ⇒ CHẶN, không ghi gì", async () => {
    const truoc = await db.orderItem.count({ where: { orderId: DON } });
    const r = await them(BAT, conAn({ unitPrice: GIA_AN - 1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("THẤP HƠN giá niêm yết");
    expect(await db.orderItem.count({ where: { orderId: DON } })).toBe(truoc);
  });

  it("[TCD-08] khoá CHƯA KHAI GIÁ ⇒ CHẶN", async () => {
    const r = await them(BAT, conAn({ courseId: KHOA_KHONG_GIA, unitPrice: 5_000_000 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("chưa cấu hình giá");
  });

  it("[TCD-09] THIẾU LÝ DO ⇒ CHẶN, và cổng đứng TRƯỚC phép ghi đầu tiên", async () => {
    const truoc = await db.orderItem.count({ where: { orderId: DON } });
    const r = await them(BAT, conAn(), "   ");
    expect(r.ok).toBe(false);
    expect(await db.orderItem.count({ where: { orderId: DON } })).toBe(truoc);
  });

  it("[TCD-10] đơn ĐÃ HUỶ / ĐÃ HOÀN ⇒ CHẶN", async () => {
    for (const status of ["CANCELLED", "REFUNDED", "DRAFT"] as const) {
      await db.order.update({ where: { id: DON }, data: { status } });
      const r = await them();
      expect(r.ok, status).toBe(false);
      if (!r.ok) expect(r.error).toContain("không thêm con được");
    }
  });

  it("[TCD-11] khoản giảm THIẾU GIẢI TRÌNH ⇒ CHẶN", async () => {
    const r = await them(BAT, conAn({ giam: [{ kieu: "PHAN_TRAM", giaTri: 5 }] }));
    expect(r.ok).toBe(false);
  });

  it("[TCD-12] khoản giảm VƯỢT TRẦN % ⇒ CHẶN", async () => {
    const r = await them(
      BAT,
      conAn({ giam: [{ kieu: "PHAN_TRAM", giaTri: 80, lyDo: "học bổng" }] }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("vượt trần");
  });

  it("[TCD-13] khoản sale GÕ TAY được GIỮ, ưu đãi tự tính CỘNG THÊM", async () => {
    // Máy không được xoá quyết định của người: sale có thể đã hứa một mức riêng.
    const r = await them(
      BAT,
      conAn({ giam: [{ kieu: "SO_TIEN", giaTri: 500_000, lyDo: "giới thiệu", loai: "GIOI_THIEU" }] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dong = await db.orderItem.findUniqueOrThrow({ where: { id: r.orderItemId } });
    expect(dong.discountAmount).toBe(500_000 + 960_000);
    expect(Array.isArray(dong.discounts) ? dong.discounts : []).toHaveLength(2);
    // Hai khoản ⇒ "% của dòng" không tồn tại như một con số.
    expect(dong.discountPercent).toBeNull();
  });

  it("[TCD-14] THÊM CON THỨ BA: không chồng thêm một khoản ưu đãi nữa lên con cũ", async () => {
    // ⚠️ Lỗi này chỉ lộ ra ở nhà có ba con: nếu không gỡ khoản tự tính CŨ trước khi thêm
    // khoản mới, học phí của bé tụt dần mỗi lần gia đình có thêm em.
    expect((await them()).ok).toBe(true);
    const r3 = await them(BAT, conAn({ itemName: "Bé Ba TCD", courseId: KHOA_AN, unitPrice: GIA_AN }));
    expect(r3.ok).toBe(true);

    const so = await noTheoCon(DON);
    const an = so.con.find((c) => c.ten === "Bé An TCD")!;
    const dongAn = await db.orderItem.findUniqueOrThrow({ where: { id: an.orderItemId } });
    // An vẫn là con thứ 2 (9,6tr = con Ba, phá thế hoà theo thứ tự vào đơn ⇒ An trước).
    expect(Array.isArray(dongAn.discounts) ? dongAn.discounts : []).toHaveLength(1);
    expect(dongAn.discountAmount).toBe(960_000);
    // Con thứ ba nhận bậc thứ hai.
    const ba = so.con.find((c) => c.ten === "Bé Ba TCD")!;
    expect(ba.phaiThu).toBe(GIA_AN - Math.round((GIA_AN * 15) / 100));
  });

  it("[TCD-15] nhật ký ghi ĐỦ số trước/sau của từng con + chính sách đã dùng", async () => {
    expect((await them()).ok).toBe(true);
    const vet = await db.auditLog.findFirst({
      where: { entityType: "Order", entityId: DON, action: "THEM_CON_VAO_DON" },
    });
    expect(vet, "phải ghi AuditLog").not.toBeNull();
    const moi = vet!.newValues as {
      tongDon: number;
      chinhSach: { phanTramConThu2: number };
      con: { ten: string; thanhTienCu: number; thanhTienMoi: number }[];
    };
    expect(moi.tongDon).toBe(GIA_BINH + GIA_AN - 960_000);
    // Chính sách ĐANG dùng phải nằm trong nhật ký: quản lý đổi % tuần sau thì không ai dựng
    // lại được con số của hôm nay nếu chỉ ghi kết quả.
    expect(moi.chinhSach.phanTramConThu2).toBe(10);
    expect(moi.con.find((c) => c.ten === "Bé An TCD")!.thanhTienMoi).toBe(8_640_000);
    expect(vet!.reason).toContain("Em thứ hai");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[TCD] xem trước — chỉ đọc", () => {
  beforeEach(() => dungFixture());
  afterAll(don);

  it("[TCD-16] xem trước KHÔNG ghi một dòng nào", async () => {
    const truoc = {
      dong: await db.orderItem.count({ where: { orderId: DON } }),
      dot: await db.paymentRequest.count({ where: { orderId: DON } }),
      log: await db.auditLog.count({ where: { entityType: "Order", entityId: DON } }),
    };
    const r = await xemTruocThemCon({
      orderId: DON,
      conMoi: conAn(),
      chinhSach: BAT,
      tranPhanTram: TRAN_PHAN_TRAM,
    });
    expect(r.ok).toBe(true);
    expect({
      dong: await db.orderItem.count({ where: { orderId: DON } }),
      dot: await db.paymentRequest.count({ where: { orderId: DON } }),
      log: await db.auditLog.count({ where: { entityType: "Order", entityId: DON } }),
    }).toEqual(truoc);
  });

  it("[TCD-17] xem trước nói ĐÚNG số sẽ xảy ra — so với lượt ghi thật", async () => {
    // ⚠️ Ca này canh một thứ không lưới nào khác canh: xem trước và lượt ghi phải chạy CÙNG
    // một phép tính. Hai phép tính song song là màn hình hứa một số rồi sổ ghi một số khác.
    const conDat = conAn({ itemName: "Bé Cường TCD", courseId: KHOA_BINH, unitPrice: 20_000_000 });
    const xem = await xemTruocThemCon({
      orderId: DON,
      conMoi: conDat,
      chinhSach: BAT,
      tranPhanTram: TRAN_PHAN_TRAM,
    });
    expect(xem.ok).toBe(true);
    if (!xem.ok) return;
    const binhXem = xem.data.con.find((c) => c.orderItemId === OI_BINH)!;
    expect(binhXem.thanhTienCu).toBe(GIA_BINH);
    expect(binhXem.thanhTienMoi).toBe(GIA_BINH - 1_200_000);
    expect(binhXem.doiDot.map((d) => d.installmentNo)).toEqual([3]);
    // ⚠️ Đợt 1 `PAID` KHÔNG có trong `dotDaCoTien`, và đúng là vậy: nó không thuộc tập đợt
    // MỞ nên không có gì để báo. `dotDaCoTien` nói về đợt CÒN MỞ mà đã nhận một phần —
    // `PARTIAL` — tức đúng những đợt mà người bấm có thể tưởng là sửa được. Ca `[TCD-17b]`
    // đo vế ấy. (Khẳng định đầu tiên của tôi ở đây SAI, và phép chạy bắt được.)
    expect(binhXem.dotDaCoTien).toEqual([]);

    const ghi = await them(BAT, conDat);
    expect(ghi.ok).toBe(true);
    if (!ghi.ok) return;
    expect(ghi.tongDonMoi, "số xem trước phải BẰNG số đã ghi").toBe(xem.data.tongDonMoi);
  });

  it("[TCD-17b] đợt CÒN MỞ mà đã nhận một phần ⇒ KHÔNG sửa, và được liệt kê ra", async () => {
    // Đây là đợt nguy hiểm nhất: nó còn mở nên trông như sửa được, nhưng sửa `amountDue` của
    // nó là đúng con bug đang GHIM ở repo (`[PR-02d]` — phiếu hoá "thu vượt").
    const txn = await db.bankTransaction.create({
      data: {
        id: `${T}txn-2`,
        provider: "sepay",
        providerTxnId: `${T}txn-2`,
        amount: 1_000_000,
        transferredAt: HAN_DOT_2,
        status: "MATCHED",
        centerId: CENTER,
      },
      select: { id: true },
    });
    await db.paymentAllocation.create({
      data: {
        bankTransactionId: txn.id,
        paymentRequestId: `${T}pr-2`,
        amount: 1_000_000,
        centerId: CENTER,
      },
    });
    await db.paymentRequest.update({ where: { id: `${T}pr-2` }, data: { status: "PARTIAL" } });

    // ⚠️ `DOT_GAN_NHAT` có chủ đích: đợt PARTIAL là đợt có hạn SỚM HƠN, nên chỉ chiều này
    // đặt nó vào ĐẦU hàng chờ bị trừ — tức chỉ chiều này CẮN. Với `DOT_XA_NHAT` thì đợt 3
    // hút hết phần giảm và ca này xanh dù cổng "đợt đã có tiền" có bị gỡ (đã đo).
    const csGan = { ...BAT, hapThu: CACH_HAP_THU.DOT_GAN_NHAT };
    const xem = await xemTruocThemCon({
      orderId: DON,
      conMoi: conAn({ itemName: "Bé Cường TCD", courseId: KHOA_BINH, unitPrice: 20_000_000 }),
      chinhSach: csGan,
      tranPhanTram: TRAN_PHAN_TRAM,
    });
    expect(xem.ok).toBe(true);
    if (!xem.ok) return;
    const binh = xem.data.con.find((c) => c.orderItemId === OI_BINH)!;
    expect(binh.dotDaCoTien).toEqual([{ id: `${T}pr-2`, installmentNo: 2, daRot: 1_000_000 }]);
    // Chỉ đợt 3 (chưa có đồng nào) được sửa — dù đợt 3 có hạn XA hơn.
    expect(binh.doiDot.map((d) => d.installmentNo)).toEqual([3]);

    // Và lượt GHI cũng vậy: đợt 2 giữ nguyên cả số lẫn trạng thái.
    expect((await them(csGan, conAn({ itemName: "Bé Cường TCD", courseId: KHOA_BINH, unitPrice: 20_000_000 }))).ok).toBe(true);
    const dot2 = await db.paymentRequest.findUniqueOrThrow({ where: { id: `${T}pr-2` } });
    expect(dot2.amountDue).toBe(3_000_000);
    expect(dot2.status).toBe("PARTIAL");

    await db.paymentAllocation.deleteMany({ where: { bankTransactionId: txn.id } });
    await db.bankTransaction.delete({ where: { id: txn.id } });
  });

  it("[TCD-18] hấp thụ KHÔNG đủ ⇒ xem trước nói rõ bé sẽ ĐÓNG THỪA bao nhiêu", async () => {
    // Bình chỉ còn 6tr chưa thu. Đổi sang chính sách 15% cho con thứ hai bằng cách... không
    // được: mức là tham số. Thay vào đó dựng lại fixture chỉ còn MỘT đợt chưa thu 3tr, rồi
    // thêm con đắt hơn ⇒ cần giảm 1,2tr nhưng chỉ hấp thụ được 3tr — vẫn đủ. Nên ca này
    // dùng mức cao: quản lý cài 50% (trần), phần giảm 6tr > 3tr còn mở.
    await db.paymentRequest.deleteMany({ where: { id: `${T}pr-3` } });
    await db.paymentRequest.update({
      where: { id: `${T}pr-2` },
      data: { amountDue: 3_000_000 },
    });
    const xem = await xemTruocThemCon({
      orderId: DON,
      conMoi: conAn({ itemName: "Bé Cường TCD", courseId: KHOA_BINH, unitPrice: 20_000_000 }),
      chinhSach: { ...BAT, phanTramConThu2: 50 },
      tranPhanTram: TRAN_PHAN_TRAM,
    });
    expect(xem.ok).toBe(true);
    if (!xem.ok) return;
    const binh = xem.data.con.find((c) => c.orderItemId === OI_BINH)!;
    expect(binh.thanhTienMoi).toBe(GIA_BINH / 2);
    // Cần giảm 6tr, chỉ còn 3tr đợt mở ⇒ đóng thừa 3tr.
    expect(binh.seDongThua).toBe(3_000_000);
  });
});
