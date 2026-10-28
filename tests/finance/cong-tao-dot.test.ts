// tests/finance/cong-tao-dot.test.ts — CỔNG TẠO ĐỢT phải trừ KHOẢN CHƯA GẮN CON, trên Postgres THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy:  pnpm test:finance-db      (CI: job "Chat DB invariants", một required check)
// `pnpm test:unit` trần sẽ SKIP — thiếu `ALLOW_DB_RESET=1`, xem tests/_helpers/db-gate.ts.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT ĐANG KHOÁ — chủ dự án chốt 17/09/2026
//
//     số tiền đợt ≤ min( còn nợ con − Σ đợt mở của con ,
//                        còn nợ ĐƠN − Σ đợt mở của cả đơn )
//
// với *còn nợ đơn* = Σ học phí thực các con − Σ **mọi** Payment đã thu của đơn, **kể cả khoản
// chưa gắn con** (`Payment.orderItemId IS NULL`).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG THỂ CHỈ LÀ TEST THUẦN
//
// Phần số học của cổng đã thuần và đã phủ ở `lib/finance/no-theo-con.test.ts`
// (`[NTC-02b]`, `[NTC-02c]`). Nhưng con bug KHÔNG nằm ở số học — nó nằm ở chỗ `taoDotChoCon`
// **cho cổng ăn con số nào**. Đúng lớp lỗi của `[DS-01b]`: hàm thuần test bao nhiêu cũng xanh
// trong khi lời gọi truyền một hằng hẹp hơn sự thật.
//
// Kiểm được điều đó thì phải có đường thật: `Payment` với `orderItemId` NULL nằm trong DB,
// `docSoTheoCon` đọc nó ra, `ghiTienChoDon` khoá đơn, rồi cổng mới nhận số. Đó là luật 9 —
// *cổng phải được cho ăn bằng thứ đường THẬT cho nó ăn*; ca test gõ tay đầu vào của cổng thì
// nó kiểm cổng, không kiểm hệ thống.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { noTheoCon } from "@/lib/finance/debt";
import { taoDotChoCon } from "@/lib/finance/ghi-tien-don";
import { congNoDon } from "@/lib/finance/cong-no-don";
import { sumRecorded } from "@/lib/finance/ghi-nhan";

if (!RUN_DB_TESTS) console.warn(`[CTD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ctd-";
const ACTOR = { id: `${T}actor`, name: "Sale fixture" };

const DON = `${T}don`;
const AN = `${T}item-an`;
const BINH = `${T}item-binh`;

/** Mỗi bé 6.000.000đ ⇒ đơn phải thu 12.000.000đ. Số của chủ dự án. */
const HOC_PHI_MOI_BE = 6_000_000;
const DA_THU_CHUA_GAN = 6_000_000;

async function don() {
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
}

/**
 * Đơn HAI CON × 6.000.000đ, **chưa có đợt nào**, và **6.000.000đ đã thu mang
 * `orderItemId = NULL`** — đúng hình dạng 146 khoản đang nằm trên prod.
 *
 * ⚠️ `accountantStatus: "CONFIRMED"` là bắt buộc: "đã thu" của module này là TRỤC A
 * (`KHOAN_DA_XAC_NHAN`). Một khoản `RECORDED` sẽ ra `choXacNhan` và **không** trừ vào
 * `conNoDon` — nếu fixture đặt sai trục thì ca test xanh vì cổng không thấy tiền, chứ không
 * phải vì cổng làm việc.
 */
async function dungFixture(opts: { chuaGanCon?: number } = {}) {
  await don();
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269903-000001",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture",
      customerPhone: "0999000222",
      totalAmount: HOC_PHI_MOI_BE * 2,
    },
  });
  for (const [id, ten] of [
    [AN, "Nguyễn Minh An"],
    [BINH, "Nguyễn Minh Bình"],
  ] as const) {
    await db.orderItem.create({
      data: {
        id,
        orderId: DON,
        type: "COURSE_ENROLLMENT",
        itemName: ten,
        quantity: 1,
        unitPrice: HOC_PHI_MOI_BE,
        totalPrice: HOC_PHI_MOI_BE,
      },
    });
  }
  const tien = opts.chuaGanCon ?? DA_THU_CHUA_GAN;
  if (tien > 0) {
    await db.payment.create({
      data: {
        id: `${T}pay-chung`,
        orderId: DON,
        orderItemId: null, // ← mấu chốt: tiền đã về mà chưa biết của bé nào
        amount: tien,
        method: "BANK_TRANSFER",
        accountantStatus: "CONFIRMED",
        paidDate: new Date("2699-03-01T03:00:00Z"),
      },
    });
  }
}

describe.skipIf(!RUN_DB_TESTS)("[CTD] cổng tạo đợt vs khoản chưa gắn con — DB thật", () => {
  beforeEach(async () => {
    await dungFixture();
  });
  afterAll(don);

  it("[CTD-01] fixture đúng hình dạng: đơn 12tr · 6tr đã thu chưa gắn con · từng bé vẫn nợ đủ", async () => {
    // Ca này không kiểm cổng — nó kiểm FIXTURE. Nếu `chuaGanCon` ra 0 thì mọi ca dưới sẽ
    // xanh vì cổng không thấy tiền, và bộ test trở thành vô dụng mà trông vẫn xanh.
    const so = await noTheoCon(DON);
    expect(so.tongPhaiThu).toBe(12_000_000);
    expect(so.chuaGanCon, "6tr phải nằm ở khoản CHƯA GẮN CON, không rơi vào bé nào").toBe(
      DA_THU_CHUA_GAN,
    );
    expect(so.tongDaThu, "không bé nào được nhận 6tr ấy").toBe(0);
    expect(so.con.map((c) => c.conNo), "từng bé vẫn nợ đủ học phí của mình").toEqual([
      HOC_PHI_MOI_BE,
      HOC_PHI_MOI_BE,
    ]);
    // Hai vế của cổng, đọc qua đường thật:
    expect(so.conNoDon, "còn nợ ĐƠN = 12tr − 6tr").toBe(6_000_000);
    expect(so.tongDotDangMoDon).toBe(0);
  });

  it("[CTD-02] tạo đợt VƯỢT còn nợ ĐƠN ⇒ CHẶN, dù còn nợ của BÉ vẫn đủ", async () => {
    // Đây là ca chủ dự án yêu cầu. Bé An còn nợ 6.000.000 nên vế CON cho qua trọn số; nhưng
    // đơn chỉ còn thiếu 6.000.000 và ta xin 6.000.001 ⇒ vế ĐƠN phải cắn.
    const r = await taoDotChoCon({
      orderId: DON,
      orderItemId: AN,
      soTien: 6_000_001,
      dueDate: null,
      centerId: null,
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("đơn");

    // TỪ CHỐI THÌ DB KHÔNG ĐỔI MỘT DÒNG NÀO — luật rollback (CLAUDE.md mục 7).
    expect(await db.paymentRequest.count({ where: { orderId: DON } })).toBe(0);
    expect(await db.payment.count({ where: { orderId: DON, deletedAt: null } })).toBe(1);
  });

  it("[CTD-03] hai đợt mỗi bé trọn học phí ⇒ đợt THỨ HAI bị chặn (tổng QR không vượt đơn)", async () => {
    // Nếu chỉ có vế CON: An 6tr OK, Bình 6tr OK ⇒ hai QR cộng lại 12.000.000đ trong khi đơn
    // chỉ còn thiếu 6.000.000đ. Phụ huynh quét cả hai là trả lần thứ hai phần đã trả.
    const dotAn = await taoDotChoCon({
      orderId: DON,
      orderItemId: AN,
      soTien: HOC_PHI_MOI_BE,
      dueDate: null,
      centerId: null,
      actor: ACTOR,
    });
    expect(dotAn.ok, "đợt đầu nằm trong phần đơn còn thiếu ⇒ phải tạo được").toBe(true);

    const dotBinh = await taoDotChoCon({
      orderId: DON,
      orderItemId: BINH,
      soTien: HOC_PHI_MOI_BE,
      dueDate: null,
      centerId: null,
      actor: ACTOR,
    });
    expect(dotBinh.ok, "đợt thứ hai vượt phần còn được thu của CẢ ĐƠN").toBe(false);

    // Đúng MỘT đợt tồn tại, và Σ amountDue không vượt phần đơn còn thiếu.
    const dot = await db.paymentRequest.findMany({
      where: { orderId: DON },
      select: { orderItemId: true, amountDue: true },
    });
    expect(dot).toHaveLength(1);
    expect(dot.reduce((s, d) => s + d.amountDue, 0)).toBeLessThanOrEqual(6_000_000);
  });

  it("[CTD-04] chia 6tr còn lại làm hai đợt 3tr cho hai bé ⇒ CẢ HAI tạo được", async () => {
    // Cổng không được chặn quá tay: nó chỉ canh TỔNG, không cấm chia.
    for (const item of [AN, BINH]) {
      const r = await taoDotChoCon({
        orderId: DON,
        orderItemId: item,
        soTien: 3_000_000,
        dueDate: null,
        centerId: null,
        actor: ACTOR,
      });
      expect(r.ok, `đợt của ${item}`).toBe(true);
    }
    const so = await noTheoCon(DON);
    expect(so.tongDotDangMoDon).toBe(6_000_000);

    // Đồng thêm 1đ nữa thì hết chỗ.
    const them = await taoDotChoCon({
      orderId: DON,
      orderItemId: AN,
      soTien: 1,
      dueDate: null,
      centerId: null,
      actor: ACTOR,
    });
    expect(them.ok).toBe(false);
    expect(them.ok === false && them.error).toContain("Cả đơn không còn phần được thu thêm");
  });

  it("[CTD-05] đơn KHÔNG có khoản chưa gắn con ⇒ hành vi cũ KHÔNG đổi", async () => {
    // Bản vá không được làm hẹp đường đi của đơn sạch. Đây là ca hồi quy: bỏ hẳn khoản NULL
    // thì mỗi bé vẫn tạo được đợt trọn học phí, y như trước 17/09.
    await dungFixture({ chuaGanCon: 0 });
    const so = await noTheoCon(DON);
    expect(so.chuaGanCon).toBe(0);
    expect(so.conNoDon).toBe(12_000_000);

    for (const item of [AN, BINH]) {
      const r = await taoDotChoCon({
        orderId: DON,
        orderItemId: item,
        soTien: HOC_PHI_MOI_BE,
        dueDate: null,
        centerId: null,
        actor: ACTOR,
      });
      expect(r.ok, `đợt trọn học phí của ${item} trên đơn sạch`).toBe(true);
    }
    expect(await db.paymentRequest.count({ where: { orderId: DON } })).toBe(2);
  });

  it("[CTD-06] đợt `orderItemId` NULL của luồng cũ CŨNG chiếm chỗ", async () => {
    // Đơn trước 16/09 thì đợt nào cũng NULL. Nếu vế ĐƠN chỉ cộng `Σ con[].tongDotDangMo` thì
    // nó bỏ sạch chúng — tức mở toang đúng tập đơn cũ, là tập đang có tiền thật.
    await dungFixture({ chuaGanCon: 0 });
    await db.paymentRequest.create({
      data: {
        id: `${T}pr-cu`,
        orderId: DON,
        orderItemId: null,
        installmentNo: 1,
        amountDue: 12_000_000,
        status: "PENDING",
        sortOrder: 1,
      },
    });

    const so = await noTheoCon(DON);
    expect(so.tongDotDangMoDon, "đợt NULL phải được đếm").toBe(12_000_000);
    expect(so.con.every((c) => c.tongDotDangMo === 0), "vế CON không thấy nó — đúng").toBe(true);

    const r = await taoDotChoCon({
      orderId: DON,
      orderItemId: AN,
      soTien: 1,
      dueDate: null,
      centerId: null,
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(await db.paymentRequest.count({ where: { orderId: DON } })).toBe(1);
  });

  it("[CTD-07] khoản chưa xác nhận VẪN SIẾT vế ĐƠN — [ĐẢO LUẬT 18/09/2026]", async () => {
    // ─────────────────────────────────────────────────────────────────────────
    // ⚠️ CA NÀY TỪNG KHẲNG ĐỊNH ĐIỀU NGƯỢC LẠI, VÀ NÓ ĐÃ SAI.
    //
    // Bản 17/09 tên là *"khoản `RECORDED` (chưa xác nhận) KHÔNG nới cổng"* và chốt
    // `conNoDon === 12_000_000`, với lý lẽ: *"trục A là định nghĩa 'đã thu' của module; một
    // khoản kế toán chưa xác nhận có thể bị TỪ CHỐI."*
    //
    // Lý lẽ ấy ĐÚNG cho vế CON và SAI cho vế ĐƠN. Chủ dự án chốt 18/09/2026:
    //
    //   *"cổng này chỉ giới hạn số tiền được ĐÒI THÊM, nên đếm rộng; đòi thiếu còn thu lại
    //   được, đòi thừa là phụ huynh mất tiền."*
    //
    // Đo trên đơn thật `ORD-260917-000001` mới thấy cái giá của bản cũ: 4 khoản `PENDING`
    // tổng 4.836.000đ ⇒ trục A thấy 0 ⇒ `conNoDon` = trọn 20.064.000đ ⇒ cổng cho tạo thêm
    // đúng 4.836.000đ, tức phần phụ huynh VỪA CHUYỂN. Xem `[CTD-08]`.
    //
    // ⚠️ NẾU MỘT NGÀY CA NÀY LẠI ĐỎ vì ai đó khôi phục `toBe(12_000_000)`: đó KHÔNG phải hồi
    // quy được sửa, đó là luật bị đảo ngược lần nữa. Đọc `KhoanDaVe` trong `no-theo-con.ts`
    // trước khi đổi một con số ở đây.
    // ─────────────────────────────────────────────────────────────────────────
    await dungFixture({ chuaGanCon: 0 });
    await db.payment.create({
      data: {
        id: `${T}pay-cho`,
        orderId: DON,
        orderItemId: null,
        amount: 6_000_000,
        method: "BANK_TRANSFER",
        // ⚠️ `RECORDED` là giá trị của `saleStatus`, KHÔNG phải `accountantStatus` (enum kế
        // toán chỉ có PENDING/CONFIRMED/REJECTED/REFUNDED). "Chưa xác nhận" ở đây =
        // `accountantStatus: PENDING` + `saleStatus: RECORDED`.
        accountantStatus: "PENDING",
        saleStatus: "RECORDED",
        paidDate: new Date("2699-03-02T03:00:00Z"),
      },
    });

    const so = await noTheoCon(DON);

    // TRỤC A không đổi — vế CON vẫn nghiêm ngặt như cũ. Đó là điểm của "hai vế, hai định nghĩa".
    expect(so.chuaGanCon, "`chuaGanCon` chỉ đếm trục A ⇒ khoản PENDING không vào").toBe(0);
    expect(so.tongDaThu, "từng bé vẫn chưa được ghi nhận đồng nào").toBe(0);
    expect(so.con.map((c) => c.conNo), "còn nợ TỪNG BÉ không đổi").toEqual([
      HOC_PHI_MOI_BE,
      HOC_PHI_MOI_BE,
    ]);

    // VẾ ĐƠN thì CÓ đổi — đây là toàn bộ nội dung của bản vá 18/09.
    expect(so.tongDaVe, "tập rộng thấy khoản PENDING").toBe(6_000_000);
    expect(so.conNoDon, "12tr − 6tr, KHÔNG còn là 12tr như bản 17/09").toBe(6_000_000);

    // ⚠️ MỘT CHỖ BẤT ĐỐI XỨNG CỦA MODULE, giữ nguyên ghi chú cũ vì nó vẫn đúng:
    //   `tongChoXacNhan` là Σ theo TỪNG CON, nên một khoản chưa-xác-nhận mang
    //   `orderItemId = NULL` không xuất hiện ở đó. Trục A có `chuaGanCon` để hứng phần không
    //   thuộc bé nào; trục "chờ xác nhận" thì KHÔNG có trường tương ứng.
    // Nay đã có `tongDaVe` trả lời được câu "đơn đã về bao nhiêu", nên đừng dùng
    // `tongChoXacNhan` làm số của ĐƠN.
    expect(so.tongChoXacNhan, "khoản chờ xác nhận KHÔNG gắn con thì rơi khỏi Σ theo con").toBe(0);

    // Xin ĐÚNG phần đơn còn thiếu ⇒ vẫn tạo được (cổng không siết quá tay).
    const vua = await taoDotChoCon({
      orderId: DON,
      orderItemId: AN,
      soTien: HOC_PHI_MOI_BE,
      dueDate: null,
      centerId: null,
      actor: ACTOR,
    });
    expect(vua.ok, "6tr = đúng phần đơn còn thiếu").toBe(true);

    // …nhưng thêm 1đ thì hết chỗ. Bản 17/09 sẽ cho qua tới tận 12tr — đó là chỗ tiền rò.
    const them = await taoDotChoCon({
      orderId: DON,
      orderItemId: BINH,
      soTien: 1,
      dueDate: null,
      centerId: null,
      actor: ACTOR,
    });
    expect(them.ok, "bản 17/09 cho qua chỗ này — nay phải CHẶN").toBe(false);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[CTD-Đ] vế ĐƠN đếm RỘNG — dựng đúng `ORD-260918-000001` của prod", () => {
  // ⚠️ FIXTURE MANG HÌNH DẠNG DỮ LIỆU THẬT, không phải số tròn trịa.
  //
  // Đo prod 18/09/2026, đơn `ORD-260918-000001` (CS2, 2 con):
  //   · tổng đơn                       20.064.000đ
  //   · đã chuyển, kế toán CHƯA duyệt   4.836.000đ  (`accountantStatus = PENDING`)
  //   · ba đợt đang mở, `orderItemId` NULL (luồng cũ):
  //         5.196.000 + 5.016.000 + 5.016.000 = 15.228.000đ
  //   · màn "Công nợ đơn hàng" in: còn thiếu 15.228.000đ
  //
  // Bản cổng SÁNG 18/09 tính `conNoDon` theo TRỤC A ⇒ khoản `PENDING` không được trừ ⇒
  // `conNoDon = 20.064.000`, phần cho tạo thêm = 20.064.000 − 15.228.000 = **4.836.000đ** —
  // đúng bằng số phụ huynh vừa chuyển. Tạo thêm một đợt bấy nhiêu là tổng đợt mở thành trọn
  // đơn và QR đòi lại phần đã trả.
  const D = `${T}don918`;
  const A918 = `${T}i918-a`;
  const B918 = `${T}i918-b`;
  const TONG_DON = 20_064_000;
  const DA_CHUYEN = 4_836_000;
  const BA_DOT = [5_196_000, 5_016_000, 5_016_000] as const;

  async function don918() {
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: D } } });
    await db.payment.deleteMany({ where: { orderId: D } });
    await db.paymentRequest.deleteMany({ where: { orderId: D } });
    await db.orderItem.deleteMany({ where: { orderId: D } });
    await db.order.deleteMany({ where: { id: D } });
  }

  async function dung(trangThaiKhoan: "PENDING" | "REJECTED" | "CONFIRMED") {
    await don918();
    await db.order.create({
      data: {
        id: D,
        code: "ORD-269918-000001",
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "Phụ huynh fixture 918",
        customerPhone: "0999000918",
        totalAmount: TONG_DON,
      },
    });
    // Σ dòng hàng = tổng đơn. Cố ý KHÔNG chia đôi chẵn: hai bé học hai khoá khác giá, đúng
    // hình dạng đơn thật.
    for (const [id, ten, gia] of [
      [A918, "Bé A 918", 10_560_000],
      [B918, "Bé B 918", 9_504_000],
    ] as const) {
      await db.orderItem.create({
        data: {
          id,
          orderId: D,
          type: "COURSE_ENROLLMENT",
          itemName: ten,
          quantity: 1,
          unitPrice: gia,
          totalPrice: gia,
        },
      });
    }
    await db.payment.create({
      data: {
        id: `${T}pay918`,
        orderId: D,
        orderItemId: null,
        amount: DA_CHUYEN,
        method: "sepay",
        accountantStatus: trangThaiKhoan,
        saleStatus: "RECORDED",
        paidDate: new Date("2699-09-18T03:00:00Z"),
      },
    });
    // Ba đợt của LUỒNG CŨ — `orderItemId` NULL, đúng như đơn trước 16/09.
    let i = 0;
    for (const tien of BA_DOT) {
      i += 1;
      await db.paymentRequest.create({
        data: {
          id: `${T}pr918-${i}`,
          orderId: D,
          orderItemId: null,
          installmentNo: i,
          amountDue: tien,
          status: "PENDING",
          sortOrder: i,
        },
      });
    }
  }

  afterAll(don918);

  it("[CTD-08] khoản PENDING PHẢI trừ vào vế ĐƠN ⇒ phần cho tạo thêm = 0", async () => {
    await dung("PENDING");
    const so = await noTheoCon(D);

    // Trục A không thấy đồng nào — đó là điểm khiến bản cũ sai.
    expect(so.tongDaThu, "trục A: khoản PENDING không vào").toBe(0);
    expect(so.chuaGanCon, "trục A: cũng không vào phần chưa gắn con").toBe(0);
    // Tập RỘNG thì thấy.
    expect(so.tongDaVe, "tập rộng: tiền đã về là đã về").toBe(DA_CHUYEN);

    expect(so.tongPhaiThu).toBe(TONG_DON);
    expect(so.tongDotDangMoDon, "ba đợt NULL của luồng cũ").toBe(15_228_000);
    expect(so.conNoDon, "20.064.000 − 4.836.000").toBe(15_228_000);

    // Phần cho tạo thêm = conNoDon − tongDotDangMoDon = 0.
    expect(so.conNoDon - so.tongDotDangMoDon).toBe(0);

    const r = await taoDotChoCon({
      orderId: D,
      orderItemId: A918,
      soTien: 1,
      dueDate: null,
      centerId: null,
      actor: ACTOR,
    });
    expect(r.ok, "xin 1đ cũng phải bị chặn").toBe(false);
    expect(r.ok === false && r.error).toContain("đơn");

    // TỪ CHỐI THÌ DB KHÔNG ĐỔI DÒNG NÀO — vẫn đúng ba đợt cũ.
    expect(await db.paymentRequest.count({ where: { orderId: D } })).toBe(3);
  });

  it("[CTD-09] khoản chuyển REJECTED ⇒ lại là nợ thật ⇒ cổng mở lại đúng 4.836.000đ", async () => {
    // Kế toán TỪ CHỐI khoản (séc trượt / chuyển nhầm / khai khống): tiền ấy không về, nên nó
    // KHÔNG được trừ vào phần đòi thêm nữa. Đây là vế duy nhất mà tập rộng loại ra.
    await dung("REJECTED");
    const so = await noTheoCon(D);

    expect(so.tongDaVe, "REJECTED bị loại khỏi tập rộng").toBe(0);
    expect(so.conNoDon, "không trừ gì ⇒ trọn tổng đơn").toBe(TONG_DON);
    expect(so.conNoDon - so.tongDotDangMoDon, "phần cho tạo thêm").toBe(DA_CHUYEN);

    // Đúng 4.836.000đ thì tạo được…
    const vua = await taoDotChoCon({
      orderId: D,
      orderItemId: A918,
      soTien: DA_CHUYEN,
      dueDate: null,
      centerId: null,
      actor: ACTOR,
    });
    expect(vua.ok, "đúng phần còn lại ⇒ tạo được").toBe(true);

    // …và thêm 1đ nữa thì hết chỗ.
    const them = await taoDotChoCon({
      orderId: D,
      orderItemId: B918,
      soTien: 1,
      dueDate: null,
      centerId: null,
      actor: ACTOR,
    });
    expect(them.ok).toBe(false);
  });

  it("[CTD-10] khoản CONFIRMED cho ra CÙNG kết quả với PENDING ở vế ĐƠN", async () => {
    // Vế ĐƠN không phân biệt đã duyệt hay chưa — chỉ phân biệt "đã về" với "bị từ chối".
    // Ca này khoá điều đó: đổi trục kế toán mà vế đơn đổi theo là dấu hiệu ai đó vừa nhét
    // trục A trở lại.
    await dung("CONFIRMED");
    const so = await noTheoCon(D);
    expect(so.tongDaVe).toBe(DA_CHUYEN);
    expect(so.conNoDon).toBe(15_228_000);
    expect(so.conNoDon - so.tongDotDangMoDon).toBe(0);

    // Khác biệt DUY NHẤT so với ca PENDING: trục A nay thấy tiền.
    expect(so.chuaGanCon, "CONFIRMED + chưa gắn con ⇒ vào `chuaGanCon`").toBe(DA_CHUYEN);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ĐỐI CHIẾU VỚI KHỐI "CÔNG NỢ ĐƠN HÀNG" — chủ dự án 18/09/2026:
  //
  //     *"hai chỗ phải ra cùng một con số 'còn thiếu'; nếu lệch, nêu rõ chỗ nào lệch và vì sao."*
  //
  // Hai chỗ đó là:
  //   · khối "Công nợ đơn hàng"  → `congNoDon({ totalAmount, daGhiNhan, … }).conThieu`,
  //     với `daGhiNhan` = TRỤC B (`sumRecorded`, tức `KHOAN_DA_GHI_NHAN`);
  //   · vế ĐƠN của cổng tạo đợt  → `noTheoCon(orderId).conNoDon`.
  //
  // Chúng ra CÙNG MỘT SỐ ở ca thường — `[CTD-11]` khoá điều đó. Chúng LỆCH ở đúng ba ca, và
  // cả ba đều có tên:
  //
  //   (a) ~~khoản `REJECTED` — trục B ĐẾM nó, vế đơn thì KHÔNG~~ **[HẾT LỆCH 24/09/2026]**.
  //       Đây từng là nợ `[HT-05]`: `PaymentSaleStatus` chỉ có `RECORDED` +
  //       `COLLECT_CONFIRMED` nên vế `saleStatus` của trục B là phép so LUÔN ĐÚNG, và
  //       `rejectPayment` không đụng cột đó ⇒ khoản kế toán TỪ CHỐI vẫn được cộng như tiền
  //       đã về. Vá bằng `accountantStatus: { not: "REJECTED" }` trong
  //       `lib/finance/ghi-nhan.ts` — đúng bên SAI mà chủ dự án đã chỉ ("khoản REJECTED
  //       không tính, đã bị từ chối ⇒ là nợ thật"), chứ không nới cổng cho giống trục B.
  //       `[CTD-12]` nay khoá chiều NGƯỢC LẠI: hai chỗ ra CÙNG một số.
  //
  //   (b) `Order.totalAmount` ≠ Σ dòng hàng — khối kia lấy `totalAmount`, vế đơn cộng
  //       `totalPrice − discountAmount` của từng dòng. `[CTD-13]`.
  //
  //   (c) `scopedDb` vs `db` trần — `paidSoFar` trên trang đọc qua `sdb` (cách ly cơ sở),
  //       còn `noTheoCon` cố ý đọc `db` TRẦN (chốt *"cùng một đơn, ai mở cũng ra cùng con
  //       số"*, xem `docSoTheoCon` trong `lib/finance/debt.ts`). Một khoản mang `centerId`
  //       khác sẽ bị lọc mất ở vế trên mà không mất ở vế dưới.
  //       KHÔNG phủ được ở đây: cần dựng actor + scope, và đó là bộ test khác. Ghi ra để
  //       người đọc biết danh sách này có BA mục chứ không phải hai.
  // ───────────────────────────────────────────────────────────────────────────

  /** Bộ số của khối "Công nợ đơn hàng", đi đúng đường trang `/orders/[id]` đi. */
  async function soCuaKhoiCongNo() {
    const daGhiNhan = await sumRecorded(D);
    const order = await db.order.findUniqueOrThrow({
      where: { id: D },
      select: { totalAmount: true },
    });
    return congNoDon({ totalAmount: order.totalAmount, daGhiNhan, daXacNhan: 0 });
  }

  it("[CTD-11] ca thường: 'còn thiếu' của khối công nợ = `conNoDon` của cổng", async () => {
    await dung("PENDING");

    const khoi = await soCuaKhoiCongNo();
    const so = await noTheoCon(D);

    expect(khoi.daThu, "trục B thấy khoản PENDING").toBe(DA_CHUYEN);
    expect(khoi.conThieu, "20.064.000 − 4.836.000").toBe(15_228_000);
    expect(
      so.conNoDon,
      "hai chỗ PHẢI ra cùng con số — đây là yêu cầu của chủ dự án, không phải trùng hợp",
    ).toBe(khoi.conThieu);
  });

  it("[CTD-12] khoản REJECTED: hai chỗ ra CÙNG số — `[HT-05]` đã vá 24/09/2026", async () => {
    // ⚠️ CA NÀY TỪNG KHOÁ CHIỀU NGƯỢC LẠI. Bản cũ khẳng định hai chỗ **LỆCH** đúng số bị
    // từ chối, và ghi rõ đó là nợ `[HT-05]` chưa vá. Nay trục B đã loại khoản `REJECTED`
    // (`accountantStatus: { not: "REJECTED" }` trong `lib/finance/ghi-nhan.ts`), nên lệch
    // (a) ở khối chú thích đầu mục KHÔNG còn.
    //
    // Giữ ca lại thay vì xoá: nó là chỗ duy nhất trong repo đo BẰNG DB THẬT rằng hai đường
    // đọc — khối "Công nợ đơn hàng" và vế ĐƠN của cổng tạo đợt — nói cùng một câu về một
    // khoản đã bị kế toán từ chối. Xoá đi là mất phép đo, và lần ai đó "tối ưu" trục B thì
    // không còn gì kêu.
    await dung("REJECTED");

    const khoi = await soCuaKhoiCongNo();
    const so = await noTheoCon(D);

    // Trục B KHÔNG còn đếm khoản bị từ chối.
    expect(khoi.daThu, "khoản REJECTED không phải tiền đã về").toBe(0);
    expect(khoi.conThieu, "còn thiếu = trọn học phí").toBe(TONG_DON);

    // Cổng vẫn như cũ — nó vốn đã đúng.
    expect(so.tongDaVe, "vế đơn loại REJECTED").toBe(0);
    expect(so.conNoDon, "còn nợ đơn = trọn học phí").toBe(TONG_DON);

    // VÀ ĐÂY LÀ ĐIỀU BẢN VÁ HỨA: hết lệch. Ghi thành phép trừ ra 0 chứ không phải hai
    // khẳng định rời nhau — để người đọc thấy chính cái lệch cũ nay bằng không.
    expect(so.conNoDon - khoi.conThieu, "hai chỗ nay ra CÙNG một số").toBe(0);

    // Cổng tạo đợt vẫn cho tạo đúng phần chưa có đợt nào đang mở.
    expect(so.conNoDon - so.tongDotDangMoDon).toBe(4_836_000);
  });

  it("[CTD-13] `Order.totalAmount` lệch Σ dòng hàng ⇒ hai chỗ lệch đúng bằng phần chênh", async () => {
    await dung("PENDING");
    // Giảm giá cấp ĐƠN: tổng đơn hạ 1.000.000đ mà dòng hàng giữ nguyên. Hình dạng này có
    // thật — `Order.totalAmount` là tổng SAU giảm giá, `OrderItem.discountAmount` là giảm
    // theo từng dòng, và không gì ép hai bên khớp.
    await db.order.update({ where: { id: D }, data: { totalAmount: TONG_DON - 1_000_000 } });

    const khoi = await soCuaKhoiCongNo();
    const so = await noTheoCon(D);

    expect(so.tongPhaiThu, "vế đơn vẫn cộng theo DÒNG HÀNG").toBe(TONG_DON);
    expect(khoi.phaiDong, "khối công nợ đọc `Order.totalAmount`").toBe(TONG_DON - 1_000_000);
    expect(so.conNoDon - khoi.conThieu, "lệch đúng phần giảm giá cấp đơn").toBe(1_000_000);
  });
});
