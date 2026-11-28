// tests/finance/gan-khoan-cho-con.test.ts — ĐƯỜNG B: gắn khoản ĐÃ THU vào một bé. Postgres THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy:  pnpm test:finance-db      (CI: job "Chat DB invariants", một required check)
// `pnpm test:unit` trần sẽ SKIP — thiếu `ALLOW_DB_RESET=1`, xem tests/_helpers/db-gate.ts.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO ĐƯỜNG NÀY TỒN TẠI — đo trên prod 18/09/2026, không phải phòng xa
//
// `ganTienTheoCon` đi từ một `BankTransaction` đang `UNMATCHED` và TẠO ra `Payment` mới. Tiền
// ĐÃ VÀO thì không đi qua đó được: đơn `ORD-260917-000001` có 4 dòng `Payment` (`sepay`,
// `PENDING`, `orderItemId = NULL`) do người vận hành nhập tay để khớp số phụ huynh đã chuyển
// — **không có `BankTransaction` nào phía sau**, nên không có gì để gỡ và không có gì để gắn.
// 4.836.000đ nằm trong DB mà không đường nào — giao diện hay script — chạm tới được.
//
// ⚠️ GIỚI HẠN CÓ CHỦ ĐÍCH: một khoản gắn cho ĐÚNG MỘT bé. Hàm này KHÔNG bao giờ chia tiền —
// "chỉ điền một cột đang trống" chính là thứ làm nó kiểm được.
//
// ⚠️ **[ĐẢO 20/09/2026 — phần "không tách được một khoản cho hai bé" ĐÃ HẾT ĐÚNG.]** Việc ấy
// nay có đường riêng: `tachKhoanChoCon` (mục 6 của `ghi-tien-don.ts`, bộ
// `tests/finance/tach-khoan-cho-con.test.ts`), và nó KHÔNG sửa `amount` của dòng nào — nó đảo
// dòng gốc rồi đẻ n dòng mới. Câu trên vẫn đúng cho CHÍNH hàm này, đừng đọc nó như một lệnh
// cấm cho cả module.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { noTheoCon } from "@/lib/finance/debt";
import { ganKhoanDaThuChoCon, boGanKhoanKhoiCon } from "@/lib/finance/ghi-tien-don";

if (!RUN_DB_TESTS) console.warn(`[GKC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-gkc-";
const ACTOR = { id: `${T}actor`, name: "Sale fixture" };

const DON = `${T}don`;
/** Đơn THỨ HAI — để kiểm "gắn cho con thuộc đơn khác ⇒ chặn". */
const DON_KHAC = `${T}don-khac`;
const AN = `${T}item-an`;
const BINH = `${T}item-binh`;
const CON_DON_KHAC = `${T}item-khac`;

/** Bốn khoản THẬT của `ORD-260917-000001`. Cố ý không phải số tròn. */
const KHOAN = [1_188_000, 1_230_000, 1_188_000, 1_230_000] as const;
const TONG_KHOAN = 4_836_000;
/** Học phí hai bé — Σ = 20.064.000đ, đúng tổng đơn thật. */
const HOC_PHI_AN = 10_560_000;
const HOC_PHI_BINH = 9_504_000;

const ma = (i: number) => `${T}pay-${i}`;

async function don() {
  for (const id of [DON, DON_KHAC]) {
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: id } } });
    await db.payment.deleteMany({ where: { orderId: id } });
    await db.paymentRequest.deleteMany({ where: { orderId: id } });
    await db.orderItem.deleteMany({ where: { orderId: id } });
    await db.order.deleteMany({ where: { id } });
    // ⚠️ DỌN CẢ AuditLog — và đây là một lỗi cách ly THẬT đã bắt được, không phải phòng xa.
    //
    // Bản đầu dọn 5 bảng và quên bảng này. `beforeEach` dựng lại đơn với CÙNG `entityId`, nên
    // log của các ca trước ở lại và `[GKC-10]` đọc được **11 dòng thay vì 2**. Ca ấy ĐỎ khi
    // chạy cả bộ và XANH khi chạy một mình — đúng chữ ký của luật 18, chỉ khác chiều.
    //
    // Vá ở CHỖ DỌN, không vá bằng cách nới khẳng định xuống "có ít nhất 2 dòng": một khẳng
    // định nới ra để né lỗi cách ly sẽ thôi bắt được cả lỗi thật.
    await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: id } });
  }
}

/**
 * Dựng đúng hình dạng `ORD-260917-000001`: hai bé, bốn khoản `PENDING` chưa gắn con, KHÔNG
 * có `BankTransaction` nào.
 *
 * ⚠️ `accountantStatus: "PENDING"` là MẤU CHỐT, không phải chi tiết. Đặt `CONFIRMED` cho
 * "dễ" thì ca test kiểm một tình huống KHÁC — và đúng tình huống mà đường B **không** cần
 * tồn tại để giải.
 */
async function dungFixture() {
  await don();
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269917-000001",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture B",
      customerPhone: "0999000917",
      totalAmount: HOC_PHI_AN + HOC_PHI_BINH,
    },
  });
  for (const [id, ten, gia] of [
    [AN, "Bé An 917", HOC_PHI_AN],
    [BINH, "Bé Bình 917", HOC_PHI_BINH],
  ] as const) {
    await db.orderItem.create({
      data: {
        id,
        orderId: DON,
        type: "COURSE_ENROLLMENT",
        itemName: ten,
        quantity: 1,
        unitPrice: gia,
        totalPrice: gia,
      },
    });
  }
  for (const [i, tien] of KHOAN.entries()) {
    await db.payment.create({
      data: {
        id: ma(i),
        orderId: DON,
        orderItemId: null,
        amount: tien,
        method: "sepay",
        accountantStatus: "PENDING",
        saleStatus: "RECORDED",
        paidDate: new Date(`2699-09-17T0${i + 1}:00:00Z`),
      },
    });
  }

  // Đơn THỨ HAI, một bé — chỉ để thử gắn chéo đơn.
  await db.order.create({
    data: {
      id: DON_KHAC,
      code: "ORD-269917-000002",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh khác",
      customerPhone: "0999000919",
      totalAmount: 5_000_000,
    },
  });
  await db.orderItem.create({
    data: {
      id: CON_DON_KHAC,
      orderId: DON_KHAC,
      type: "COURSE_ENROLLMENT",
      itemName: "Bé của đơn khác",
      quantity: 1,
      unitPrice: 5_000_000,
      totalPrice: 5_000_000,
    },
  });
}

describe.skipIf(!RUN_DB_TESTS)("[GKC] gắn khoản đã thu vào con — DB thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[GKC-01] fixture đúng hình dạng: 4 khoản PENDING, chưa bé nào nhận đồng nào", async () => {
    // Ca kiểm FIXTURE. `khoanDaVeChiTiet` RỖNG thì mọi ca dưới xanh vì không có gì để gắn —
    // bộ test vô dụng mà trông vẫn xanh.
    const so = await noTheoCon(DON);
    expect(so.khoanDaVeChiTiet, "tập rộng phải thấy đủ 4 khoản").toHaveLength(4);
    expect(so.khoanDaVeChiTiet.every((k) => k.orderItemId === null)).toBe(true);
    expect(so.tongDaVe).toBe(TONG_KHOAN);
    expect(so.tongDaThu, "trục A: chưa xác nhận nên bằng 0").toBe(0);
    expect(so.chuaGanCon, "trục A: cũng bằng 0 — đây là lý do màn cũ câm").toBe(0);
  });

  it("[GKC-02] gắn 4 khoản cho 2 con ⇒ công nợ TỪNG CON đổi đúng", async () => {
    // An nhận hai khoản 1.188.000; Bình nhận hai khoản 1.230.000.
    for (const [i, item] of [
      [0, AN],
      [2, AN],
      [1, BINH],
      [3, BINH],
    ] as const) {
      const r = await ganKhoanDaThuChoCon({
        orderId: DON,
        paymentId: ma(i),
        orderItemId: item,
        actor: ACTOR,
      });
      expect(r.ok, `gắn khoản ${i}`).toBe(true);
    }

    const so = await noTheoCon(DON);
    expect(so.khoanDaVeChiTiet.filter((k) => k.orderItemId === null), "không còn khoản treo").toHaveLength(0);

    // ⚠️ Khoản vẫn `PENDING` ⇒ TRỤC A vẫn chưa ghi nhận. Gắn con KHÔNG phải xác nhận kế toán,
    // và ca này khoá điều đó: nếu một ngày `daThu` nhảy lên mà `accountantStatus` không đổi
    // thì ai đó vừa nối gắn-con vào trục A.
    expect(so.tongDaThu, "gắn con ≠ kế toán xác nhận").toBe(0);
    expect(so.con.map((c) => c.choXacNhan), "nay tiền thuộc về đúng bé, ở cột CHỜ XÁC NHẬN").toEqual([
      1_188_000 * 2,
      1_230_000 * 2,
    ]);
    // Vế ĐƠN không đổi — tiền vẫn nằm trong đơn, chỉ là nay biết của ai.
    expect(so.tongDaVe).toBe(TONG_KHOAN);
  });

  it("[GKC-03] gắn cho con thuộc ĐƠN KHÁC ⇒ CHẶN, và DB không đổi dòng nào", async () => {
    const r = await ganKhoanDaThuChoCon({
      orderId: DON,
      paymentId: ma(0),
      orderItemId: CON_DON_KHAC,
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("không thuộc đơn này");

    const con = await db.payment.findUnique({ where: { id: ma(0) }, select: { orderItemId: true } });
    expect(con?.orderItemId, "vẫn treo, không bị gắn nhầm").toBeNull();
  });

  it("[GKC-04] gắn khoản của ĐƠN KHÁC vào con của đơn này ⇒ CHẶN", async () => {
    // Chiều ngược lại của [GKC-03]: id khoản không thuộc đơn đang thao tác.
    await db.payment.create({
      data: {
        id: `${T}pay-ngoai`,
        orderId: DON_KHAC,
        orderItemId: null,
        amount: 1_000_000,
        method: "sepay",
        accountantStatus: "PENDING",
        saleStatus: "RECORDED",
        paidDate: new Date("2699-09-17T09:00:00Z"),
      },
    });
    const r = await ganKhoanDaThuChoCon({
      orderId: DON,
      paymentId: `${T}pay-ngoai`,
      orderItemId: AN,
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("Không tìm thấy khoản thu");
  });

  it("[GKC-05] khoản ĐÃ gắn rồi ⇒ CHẶN gắn đè, phải bỏ gắn trước", async () => {
    const lan1 = await ganKhoanDaThuChoCon({
      orderId: DON,
      paymentId: ma(0),
      orderItemId: AN,
      actor: ACTOR,
    });
    expect(lan1.ok).toBe(true);

    const lan2 = await ganKhoanDaThuChoCon({
      orderId: DON,
      paymentId: ma(0),
      orderItemId: BINH,
      actor: ACTOR,
    });
    expect(lan2.ok, "gắn đè âm thầm = chuyển tiền từ bé này sang bé kia").toBe(false);
    // ⚠️ KHẲNG ĐỊNH CẢ CÂU LỖI, không chỉ `ok === false`. Bước cấy chỉ ra vì sao:
    // gỡ hẳn cổng tường minh thì ca này VẪN XANH, vì `updateMany` có `orderItemId: null`
    // trong `WHERE` khớp 0 dòng và rơi vào nhánh chống-đua. Hai lớp cùng chặn — nhưng chúng
    // nói hai câu KHÁC NHAU và bảo người dùng làm hai việc khác nhau:
    //   · cổng tường minh → "đã gắn cho một bé rồi, BỎ GẮN TRƯỚC"  (việc cần làm)
    //   · nhánh chống-đua → "vừa được người khác gắn, TẢI LẠI TRANG" (sai hướng, gây hoang mang)
    // Không ghim câu chữ thì lưới không phân biệt được lớp nào đang đỡ.
    expect(lan2.ok === false && lan2.error).toContain("đã gắn cho một bé rồi");

    const con = await db.payment.findUnique({ where: { id: ma(0) }, select: { orderItemId: true } });
    expect(con?.orderItemId, "vẫn của An").toBe(AN);
  });

  it("[GKC-06] khoản REJECTED ⇒ CHẶN gắn (nó không phải tiền)", async () => {
    await db.payment.update({
      where: { id: ma(0) },
      data: { accountantStatus: "REJECTED" },
    });
    const r = await ganKhoanDaThuChoCon({
      orderId: DON,
      paymentId: ma(0),
      orderItemId: AN,
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("từ chối");
  });

  it("[GKC-07] BỎ GẮN đưa về NULL, có lý do, và KHÔNG sinh bút toán đảo", async () => {
    await ganKhoanDaThuChoCon({ orderId: DON, paymentId: ma(0), orderItemId: AN, actor: ACTOR });

    const truoc = await db.payment.count({ where: { orderId: DON, deletedAt: null } });
    const r = await boGanKhoanKhoiCon({
      orderId: DON,
      paymentId: ma(0),
      lyDo: "Gắn nhầm bé",
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);

    const con = await db.payment.findUnique({ where: { id: ma(0) }, select: { orderItemId: true } });
    expect(con?.orderItemId).toBeNull();

    // ⚠️ KHÁC `goGanTheoCon`: ở đây KHÔNG có giao dịch nào bị gỡ, tiền vẫn nằm trong đơn, nên
    // KHÔNG được sinh bút toán đảo. Sinh đảo là công nợ đơn tụt thêm một lần nữa.
    expect(await db.payment.count({ where: { orderId: DON, deletedAt: null } })).toBe(truoc);
    expect(
      await db.payment.count({ where: { orderId: DON, paymentType: "ADJUSTMENT" } }),
      "không bút toán ADJUSTMENT nào",
    ).toBe(0);

    const so = await noTheoCon(DON);
    expect(so.tongDaVe, "tiền vẫn ở trong đơn").toBe(TONG_KHOAN);
  });

  it("[GKC-08] bỏ gắn KHÔNG có lý do ⇒ CHẶN", async () => {
    await ganKhoanDaThuChoCon({ orderId: DON, paymentId: ma(0), orderItemId: AN, actor: ACTOR });
    const r = await boGanKhoanKhoiCon({
      orderId: DON,
      paymentId: ma(0),
      lyDo: "   ",
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    const con = await db.payment.findUnique({ where: { id: ma(0) }, select: { orderItemId: true } });
    expect(con?.orderItemId, "vẫn gắn — từ chối thì DB không đổi").toBe(AN);
  });

  it("[GKC-09] gắn CHỈ đụng `orderItemId`, không cột nào khác", async () => {
    // ⚠️ Đây là khẳng định quan trọng nhất của cả bộ: toàn bộ lý do đường B an toàn là nó chỉ
    // điền MỘT cột đang trống. Chụp trước/sau và so từng trường.
    const truoc = await db.payment.findUniqueOrThrow({
      where: { id: ma(0) },
      select: {
        amount: true,
        method: true,
        accountantStatus: true,
        saleStatus: true,
        paymentType: true,
        enrollmentId: true,
        paidDate: true,
        deletedAt: true,
        note: true,
        evidenceUrl: true,
      },
    });

    const r = await ganKhoanDaThuChoCon({
      orderId: DON,
      paymentId: ma(0),
      orderItemId: AN,
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);

    const sau = await db.payment.findUniqueOrThrow({
      where: { id: ma(0) },
      select: {
        amount: true,
        method: true,
        accountantStatus: true,
        saleStatus: true,
        paymentType: true,
        enrollmentId: true,
        paidDate: true,
        deletedAt: true,
        note: true,
        evidenceUrl: true,
        orderItemId: true,
      },
    });
    const { orderItemId, ...conLai } = sau;
    expect(orderItemId).toBe(AN);
    expect(conLai, "mọi cột khác phải y nguyên").toEqual(truoc);
  });

  it("[GKC-10] có ghi AuditLog cho cả gắn lẫn bỏ gắn", async () => {
    await ganKhoanDaThuChoCon({ orderId: DON, paymentId: ma(0), orderItemId: AN, actor: ACTOR });
    await boGanKhoanKhoiCon({
      orderId: DON,
      paymentId: ma(0),
      lyDo: "Đổi ý",
      actor: ACTOR,
    });

    const log = await db.auditLog.findMany({
      where: { entityType: "Order", entityId: DON, action: { in: ["KHOAN_GAN_CHO_CON", "KHOAN_BO_GAN_CON"] } },
      select: { action: true, reason: true },
      orderBy: { createdAt: "asc" },
    });
    expect(log.map((l) => l.action)).toEqual(["KHOAN_GAN_CHO_CON", "KHOAN_BO_GAN_CON"]);
    expect(log[1]?.reason, "lý do bỏ gắn phải vào log").toBe("Đổi ý");
  });
});
