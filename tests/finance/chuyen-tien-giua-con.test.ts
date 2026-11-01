// tests/finance/chuyen-tien-giua-con.test.ts — F1 trên Postgres THẬT.
//
// Chạy: `pnpm test:finance-db`. `pnpm test:unit` trần sẽ SKIP (thiếu `ALLOW_DB_RESET=1`).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG THỂ CHỈ LÀ TEST THUẦN
//
// Luật đã phủ kín ở `lib/finance/chuyen-tien-con.test.ts` (9 ca, không cần Postgres). Thứ
// bộ này kiểm là những thứ chỉ tồn tại khi có DB:
//
//   · cặp bút toán −/+ có LÀM ĐỔI đúng `daThu`/`conNo` của cả hai bé không;
//   · **tổng tiền của ĐƠN có giữ nguyên không** — đây là câu hỏi đắt nhất: một phép chuyển
//     làm tổng đơn nhúc nhích là tiền tự sinh hoặc tự mất;
//   · cổng có được cho ăn con số đọc TRONG transaction không (luật 9);
//   · khoản `PENDING` có thật sự KHÔNG chuyển được không — chỗ này test thuần chỉ chứng
//     minh được phép so, không chứng minh được `docSoTheoCon` đưa đúng số vào cổng.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { noTheoCon } from "@/lib/finance/debt";
import { chuyenTienGiuaCon } from "@/lib/finance/ghi-tien-don";

if (!RUN_DB_TESTS) console.warn(`[CTG] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ctg-";
const ACTOR = { id: `${T}actor`, name: "Kế toán fixture" };
const CENTER = `${T}center`;
const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;

const HOC_PHI = 8_000_000;
/** Bé A đã thu 5tr (CONFIRMED) + 2tr còn chờ kế toán — hai trục, hai con số. */
const A_DA_XAC_NHAN = 5_000_000;
const A_CHO_XAC_NHAN = 2_000_000;

async function don() {
  await db.auditLog.deleteMany({
    where: { OR: [{ actorId: ACTOR.id }, { entityId: { in: [DON, A, B] } }] },
  });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.center.deleteMany({ where: { id: CENTER } });
}

async function dungFixture() {
  await don();
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture CTG", slug: `${T}cs`, address: "114 Hoàng Diệu" },
  });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269922-000001",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture CTG",
      customerPhone: "0999000922",
      totalAmount: HOC_PHI * 2,
      centerId: CENTER,
    },
  });
  for (const [id, ten] of [
    [A, "Bé A CTG"],
    [B, "Bé B CTG"],
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
      },
    });
  }
  await db.payment.create({
    data: {
      id: `${T}pay-xn`,
      orderId: DON,
      orderItemId: A,
      amount: A_DA_XAC_NHAN,
      method: "BANK_TRANSFER",
      accountantStatus: "CONFIRMED",
      paidDate: new Date("2699-09-20T03:00:00Z"),
      centerId: CENTER,
    },
  });
  await db.payment.create({
    data: {
      id: `${T}pay-cho`,
      orderId: DON,
      orderItemId: A,
      amount: A_CHO_XAC_NHAN,
      method: "BANK_TRANSFER",
      accountantStatus: "PENDING",
      paidDate: new Date("2699-09-21T03:00:00Z"),
      centerId: CENTER,
    },
  });
}

const chuyen = (soTien: number, them: Record<string, unknown> = {}) =>
  chuyenTienGiuaCon({
    orderId: DON,
    tuOrderItemId: A,
    denOrderItemId: B,
    soTien,
    lyDo: "Gắn nhầm bé lúc đối soát",
    centerId: CENTER,
    actor: ACTOR,
    ...them,
  });

describe.skipIf(!RUN_DB_TESTS)("[CTG] chuyển tiền giữa hai con — DB thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[CTG-00] fixture đúng hình dạng: A đã thu 5tr + chờ 2tr, B chưa đóng gì", async () => {
    // Ca kiểm chính FIXTURE. Thiếu nó thì mọi ca dưới có thể xanh vì cổng không thấy tiền.
    const so = await noTheoCon(DON);
    const a = so.con.find((c) => c.orderItemId === A)!;
    const b = so.con.find((c) => c.orderItemId === B)!;
    expect(a.daThu).toBe(A_DA_XAC_NHAN);
    expect(a.choXacNhan, "2tr phải nằm ở CHỜ XÁC NHẬN, không lẫn vào đã thu").toBe(
      A_CHO_XAC_NHAN,
    );
    expect(a.conNo).toBe(HOC_PHI - A_DA_XAC_NHAN);
    expect(b.daThu).toBe(0);
    expect(b.conNo).toBe(HOC_PHI);
  });

  it("[CTG-01] CA GỐC: chuyển 3tr từ A sang B — hai bé đổi, TỔNG ĐƠN không đổi", async () => {
    const truoc = await noTheoCon(DON);
    const r = await chuyen(3_000_000);
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.tenCho).toBe("Bé A CTG");
    expect(r.tenNhan).toBe("Bé B CTG");

    const sau = await noTheoCon(DON);
    const a = sau.con.find((c) => c.orderItemId === A)!;
    const b = sau.con.find((c) => c.orderItemId === B)!;
    expect(a.daThu).toBe(A_DA_XAC_NHAN - 3_000_000);
    expect(b.daThu).toBe(3_000_000);
    expect(a.conNo).toBe(HOC_PHI - (A_DA_XAC_NHAN - 3_000_000));
    expect(b.conNo).toBe(HOC_PHI - 3_000_000);

    // ⚠️ Câu hỏi đắt nhất của cả bộ: tổng tiền của ĐƠN phải y nguyên. Cặp −/+ triệt tiêu.
    expect(sau.tongDaThu, "tổng đã thu của ĐƠN không được nhúc nhích").toBe(truoc.tongDaThu);
    expect(sau.conNoDon, "còn nợ của ĐƠN cũng vậy").toBe(truoc.conNoDon);
    expect(sau.chuaGanCon).toBe(truoc.chuaGanCon);
    // Và tập RỘNG (`daVe`, gồm cả khoản chưa xác nhận) cũng phải triệt tiêu — cặp −/+ nằm
    // trong tập ấy nữa, nên lệch ở đây là dấu hiệu hai dòng khác trạng thái.
    const tongDaVe = (k: typeof sau) => k.con.reduce((s, c) => s + c.daVe, 0);
    expect(tongDaVe(sau)).toBe(tongDaVe(truoc));
  });

  it("[CTG-02] khoản CHỜ XÁC NHẬN không chuyển được — trần đúng bằng phần CONFIRMED", async () => {
    // A đang giữ 7tr tiền đã về, nhưng chỉ 5tr được kế toán xác nhận. Xin 5.000.001đ phải
    // bị chặn — tức cổng đọc TRỤC A, không đọc tập rộng.
    const r = await chuyen(A_DA_XAC_NHAN + 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("tối đa 5.000.000đ");

    // Và KHÔNG ghi gì: đúng 2 dòng Payment của fixture.
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(2);
  });

  it("[CTG-03] vượt phần CÒN NỢ của bé nhận ⇒ CHẶN, không đẩy bé nhận thành đóng thừa", async () => {
    // Bé B nợ 8tr; A chỉ có 5tr nên trần thật là 5tr. Dựng ca ngược: cho B đóng gần đủ.
    await db.payment.create({
      data: {
        id: `${T}pay-b`,
        orderId: DON,
        orderItemId: B,
        amount: HOC_PHI - 1_000_000,
        method: "BANK_TRANSFER",
        accountantStatus: "CONFIRMED",
        paidDate: new Date("2699-09-20T03:00:00Z"),
        centerId: CENTER,
      },
    });
    const r = await chuyen(1_000_001);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("tối đa 1.000.000đ");
    // Đúng 1.000.000 thì qua.
    expect((await chuyen(1_000_000)).ok).toBe(true);
    const sau = await noTheoCon(DON);
    expect(sau.con.find((c) => c.orderItemId === B)!.conNo, "vừa khít, không âm").toBe(0);
  });

  it("[CTG-04] THIẾU LÝ DO ⇒ CHẶN, và cổng đứng TRƯỚC phép ghi đầu tiên", async () => {
    const r = await chuyen(1_000_000, { lyDo: "   " });
    expect(r.ok).toBe(false);
    // Luật rollback: `return` trong callback `$transaction` KHÔNG cuộn ngược. Cổng đặt sau
    // phép ghi nghĩa là bút toán đã commit trong khi người dùng nhận thông báo từ chối.
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(2);
  });

  it("[CTG-05] tự chuyển cho CHÍNH MÌNH ⇒ CHẶN", async () => {
    const r = await chuyen(1_000_000, { denOrderItemId: A });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("Bé nhận phải khác bé cho");
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(2);
  });

  it("[CTG-06] cặp bút toán mang CHUNG một mã nghiệp vụ, và ghi nhật ký", async () => {
    const r = await chuyen(2_000_000);
    expect(r.ok).toBe(true);

    const moi = await db.payment.findMany({
      where: { orderId: DON, method: "chuyen-noi-bo" },
      select: { orderItemId: true, amount: true, paymentType: true, accountantStatus: true, note: true },
      orderBy: { amount: "asc" },
    });
    expect(moi).toHaveLength(2);
    const [ra, vao] = moi;
    // Dòng RA: âm, mang tên bé cho, là bút toán ĐIỀU CHỈNH.
    expect(ra!.amount).toBe(-2_000_000);
    expect(ra!.orderItemId).toBe(A);
    expect(ra!.paymentType).toBe("ADJUSTMENT");
    // Dòng VÀO: dương, mang tên bé nhận, là khoản THU bình thường (để kế toán xuất được
    // phiếu thu cho bé ấy).
    expect(vao!.amount).toBe(2_000_000);
    expect(vao!.orderItemId).toBe(B);
    expect(vao!.paymentType).toBe("PAYMENT");
    // ⚠️ CẢ HAI phải cùng trục A. Trái dấu mà khác trục thì tổng của trục kia không về 0,
    // và công nợ một trong hai bé lệch vĩnh viễn.
    expect(ra!.accountantStatus).toBe("CONFIRMED");
    expect(vao!.accountantStatus).toBe("CONFIRMED");

    // Chung một mã nghiệp vụ ⇒ nhật ký nối lại được cặp này.
    const ma = /\[chuyen:([^\]]+)\]/.exec(ra!.note ?? "")?.[1];
    expect(ma, "dòng ra phải mang marker").toBeTruthy();
    expect(vao!.note).toContain(`[chuyen:${ma}]`);

    const vet = await db.auditLog.findFirst({
      where: { entityType: "Order", entityId: DON, action: "CHUYEN_TIEN_GIUA_CON" },
    });
    expect(vet, "phải ghi AuditLog").not.toBeNull();
    expect(vet!.reason).toBe("Gắn nhầm bé lúc đối soát");
  });

  it("[CTG-07] chuyển HAI LẦN: trần của lần sau đọc số đã đổi, không đọc số cũ", async () => {
    // Đây là vế "cổng phải được cho ăn con số đọc TRONG transaction" (luật 9). Lần đầu
    // chuyển 4tr ⇒ A còn 1tr đã xác nhận. Lần hai xin 2tr phải bị chặn.
    expect((await chuyen(4_000_000)).ok).toBe(true);
    const hai = await chuyen(2_000_000);
    expect(hai.ok).toBe(false);
    if (hai.ok) return;
    expect(hai.error).toContain("tối đa 1.000.000đ");
    // Và đúng 1tr thì qua ⇒ A về 0 đã thu.
    expect((await chuyen(1_000_000)).ok).toBe(true);
    const so = await noTheoCon(DON);
    expect(so.con.find((c) => c.orderItemId === A)!.daThu).toBe(0);
    expect(so.con.find((c) => c.orderItemId === B)!.daThu).toBe(A_DA_XAC_NHAN);
  });
});
