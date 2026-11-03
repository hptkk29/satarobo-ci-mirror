// tests/finance/tach-khoan-cho-con.test.ts — TÁCH một khoản đã thu cho n bé. Postgres THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy:  pnpm test:finance-db      (CI: job "Chat DB invariants", một required check)
// `pnpm test:unit` trần sẽ SKIP — thiếu `ALLOW_DB_RESET=1`, xem tests/_helpers/db-gate.ts.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// ─────────────────────────────────────────────────────────────────────────────
// CA THẬT — `ORD-260918-000001`, số do chủ dự án cấp 20/09/2026
//
//     đơn        19.008.000     =  8.976.000 (bé A)  +  10.032.000 (bé B)
//     khoản       9.530.000     `PENDING`, `orderItemId = NULL`, một lần chuyển cho CẢ HAI con
//     đợt đang mở 9.478.000     (19.008.000 − 9.530.000 — cổng vế ĐƠN đã chặn tạo thêm)
//
// Đây là ca CHÍNH của module, không phải ca biên: phụ huynh có hai con thì chuyển một lần.
// Trước bản này màn hình chỉ có câu "chưa hỗ trợ".
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG THỂ CHỈ LÀ TEST THUẦN
//
// Phép CHIA đã thuần và đã phủ ở `lib/finance/tach-khoan.test.ts` (`[TKP-01..12]`). Thứ bộ
// này kiểm là những điều chỉ DB nói được:
//   · ghi ra ĐÚNG mấy dòng, và dòng gốc có bị đụng không;
//   · TỔNG TIỀN của đơn trước = sau (`[TKD-03]`) — bất biến quan trọng nhất;
//   · dấu vết của gốc có theo sang từng phần không (`[TKD-08]`);
//   · `goGanTheoCon` sau khi tách có đảo ĐÚNG n phần không (`[TKD-09]`) — chỗ này hai hàm
//     gặp nhau qua MARKER trong `note`, và không test thuần nào chạm tới được.
//
// ─────────────────────────────────────────────────────────────────────────────
// KHÔNG THUỘC PHẠM VI BỘ NÀY, và nói thẳng để không ai tưởng đã phủ:
//
//   · **Cờ `billing.flexV1Enabled`** — nó gác ở TẦNG ACTION (`congDuongB`), không ở tầng
//     `lib/finance`. Các hàm dưới đây gọi thẳng nên không thấy cờ. Cờ được phủ ở
//     `lib/finance/quyen-doi-soat.test.ts` (`[QDB-08]` + ca "cờ TẮT ⇒ action TỪ CHỐI").
//
//   · **`confirmPayment` / `rejectPayment` chạy thật** — chúng cần `Receipt`, `User`,
//     `centerCode`, `publishEvent`, và đã có bộ test riêng. `[TKD-10]` kiểm HỆ QUẢ SỔ SÁCH
//     của "xác nhận phần A, từ chối phần B", còn `[TKD-08]` kiểm ĐIỀU KIỆN CẦN mà
//     `confirmPayment` đòi (`enrollmentId` khác null). Ranh giới đó là có chủ ý.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { noTheoCon } from "@/lib/finance/debt";
import {
  tachKhoanChoCon,
  ganKhoanDaThuChoCon,
  goGanTheoCon,
  markerWebhook,
} from "@/lib/finance/ghi-tien-don";

if (!RUN_DB_TESTS) console.warn(`[TKD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-tkd-";
const ACTOR = { id: `${T}actor`, name: "Sale fixture" };

const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;
const GOC = `${T}pay-goc`;
const TXN = `${T}txn`;
const PR = `${T}pr`;
const HOC_SINH = `${T}hs`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const GHI_DANH = `${T}ghi-danh`;
const CENTER = `${T}center`;

/** Số THẬT của `ORD-260918-000001`. Cố ý không phải số tròn. */
const HOC_PHI_A = 8_976_000;
const HOC_PHI_B = 10_032_000;
const TONG_DON = 19_008_000;
const KHOAN = 9_530_000;
/**
 * Nửa học phí từng bé. Σ = 9.504.000 — **THIẾU 26.000đ** so với khoản thật.
 *
 * ⚠️ CHỈ dùng ở `[TKD-14]`, tức ca CHẶN. Đừng mượn chúng làm cặp hợp lệ ở đâu khác.
 */
const NUA_A = 4_488_000;
const NUA_B = 5_016_000;

/**
 * Cặp số TRUNG TÍNH để chạy các ca "tách thành công".
 *
 * ⚠️ **CỐ Ý KHÔNG PHẢI cặp số đề xuất cho `ORD-260918-000001`** — chủ dự án chốt 20/09/2026:
 *
 *   *"26.000đ chênh là tiền thật chưa ai giải thích được — có thể PH làm tròn, có thể số
 *   học phí sai, có thể phụ phí. Hệ thống KHÔNG được tự dồn nó vào một bé."*
 *
 * Bản đầu của tệp này dùng `4.488.000 + 5.042.000` (nửa học phí bé A, rồi dồn trọn 26.000đ
 * vào bé B). Cặp ấy ĐÃ BỊ GỠ: một con số nằm trong test là một con số người ta sẽ chép, và
 * chép nó đi nghĩa là chốt một quyết định nghiệp vụ mà không ai ra quyết định.
 *
 * Hai số dưới đây cộng đúng 9.530.000đ và nằm dưới trần của cả hai bé — **chỉ có thế**.
 * Chúng không mang ý nghĩa nghiệp vụ nào và không được đọc như một gợi ý.
 */
const PHAN_A = 3_777_000;
const PHAN_B = 5_753_000;

const PROVIDER = "SEPAY";
const TXN_ID = "FT269918";
/** Đúng chuỗi mà đường webhook ghi ra — `goGanTheoCon` tìm dòng gốc bằng nó. */
const MARKER_NH = markerWebhook(PROVIDER, TXN_ID);

async function don() {
  // Hoá đơn giữ khoản bằng khoá ngoại RESTRICT — dọn TRƯỚC khoản (dòng nối xoá theo Cascade).
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: { id: TXN } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: { id: TXN } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollment.deleteMany({ where: { id: GHI_DANH } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HOC_SINH } });
  await db.center.deleteMany({ where: { id: CENTER } });
  // Nhật ký dọn theo đơn — `[TKD-12]` đếm số dòng, nên rác của ca trước làm nó đỏ vì lý do
  // chẳng liên quan. Vá ở CHỖ DỌN, không nới khẳng định xuống "có ít nhất 1 dòng" (luật 18).
  await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: DON } });
}

/**
 * Dựng đúng hình dạng `ORD-260918-000001`.
 *
 * ⚠️ `accountantStatus: "PENDING"` là MẤU CHỐT: đó là trạng thái thật của khoản trên prod,
 * và cũng là trạng thái DUY NHẤT tách được (cổng 5). Đặt `CONFIRMED` cho "dễ" là dựng một
 * tình huống mà chính hàm này từ chối.
 *
 * ⚠️ Bé A CÓ ghi danh, bé B KHÔNG — cố ý, để `[TKD-08]` thấy được cả hai nhánh của phép suy
 * `enrollmentId`. Một fixture cho cả hai bé cùng một trạng thái thì nhánh kia không ai đi.
 */
async function dungFixture() {
  await don();

  // `Order.centerId` CÓ khoá ngoại (khác `Payment.centerId` — cột trần). Nên cơ sở phải
  // tồn tại thật, và nhờ vậy `[TKD-08]` kiểm được phép chép `centerId` sang từng phần.
  await db.center.create({
    data: {
      id: CENTER,
      name: "Cơ sở fixture 918",
      slug: `${T}co-so-918`,
      address: "114 Hoàng Diệu",
    },
  });
  await db.student.create({ data: { id: HOC_SINH, name: "Bé A 918" } });
  await db.course.create({
    data: { id: KHOA, name: "Sata 3 fixture", slug: `${T}sata-3` },
  });
  await db.class.create({ data: { id: LOP, name: "Lớp fixture 918", courseId: KHOA } });
  await db.enrollment.create({
    data: { id: GHI_DANH, studentId: HOC_SINH, classId: LOP, courseId: KHOA },
  });

  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269918-000001",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture 918",
      customerPhone: "0999000918",
      totalAmount: TONG_DON,
      centerId: CENTER,
    },
  });
  await db.orderItem.create({
    data: {
      id: A,
      orderId: DON,
      type: "COURSE_ENROLLMENT",
      itemName: "Bé A 918",
      quantity: 1,
      unitPrice: HOC_PHI_A,
      totalPrice: HOC_PHI_A,
      enrollmentId: GHI_DANH,
    },
  });
  await db.orderItem.create({
    data: {
      id: B,
      orderId: DON,
      type: "COURSE_ENROLLMENT",
      itemName: "Bé B 918",
      quantity: 1,
      unitPrice: HOC_PHI_B,
      totalPrice: HOC_PHI_B,
    },
  });

  // Giao dịch ngân hàng + phiếu + phân bổ: cần cho `[TKD-09]` (gỡ gắn sau khi tách).
  await db.bankTransaction.create({
    data: {
      id: TXN,
      provider: PROVIDER,
      providerTxnId: TXN_ID,
      amount: KHOAN,
      transferredAt: new Date("2699-09-18T02:00:00Z"),
      status: "MATCHED",
      centerId: CENTER,
    },
  });
  await db.paymentRequest.create({
    data: {
      id: PR,
      orderId: DON,
      orderItemId: null,
      installmentNo: 1,
      amountDue: KHOAN,
      status: "PAID",
      centerId: CENTER,
    },
  });
  await db.paymentAllocation.create({
    data: { bankTransactionId: TXN, paymentRequestId: PR, amount: KHOAN, centerId: CENTER },
  });

  await db.payment.create({
    data: {
      id: GOC,
      orderId: DON,
      orderItemId: null,
      amount: KHOAN,
      method: "sepay",
      paidDate: new Date("2699-09-18T02:00:00Z"),
      evidenceUrl: "https://vi-du/chung-tu-918.jpg",
      note: `Tự động khớp ${PROVIDER} ${TXN_ID} ${MARKER_NH}`,
      recordedById: `${T}nguoi-thu`,
      accountantStatus: "PENDING",
      saleStatus: "RECORDED",
      centerId: CENTER,
    },
  });
}

const chia = () =>
  tachKhoanChoCon({
    orderId: DON,
    paymentId: GOC,
    phan: [
      { orderItemId: A, soTien: PHAN_A },
      { orderItemId: B, soTien: PHAN_B },
    ],
    actor: ACTOR,
  });

describe.skipIf(!RUN_DB_TESTS)("[TKD] tách khoản cho nhiều con — DB thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[TKD-01] fixture đúng hình dạng: đơn 19.008.000 · khoản 9.530.000 chưa gắn bé", async () => {
    // Ca này KHÔNG kiểm phép tách — nó kiểm FIXTURE. Thiếu nó thì mọi ca dưới có thể xanh
    // vì không có gì để tách, và bộ test vô dụng mà trông vẫn xanh (bài học `[CTD-01]`).
    const so = await noTheoCon(DON);
    expect(so.tongPhaiThu).toBe(TONG_DON);
    expect(so.tongDaVe, "tiền đã về, tập RỘNG").toBe(KHOAN);
    expect(so.conNoDon, "19.008.000 − 9.530.000 — đúng con số chủ dự án đọc được").toBe(
      9_478_000,
    );
    // Chưa gắn bé nào ⇒ trần nhận của mỗi bé = trọn học phí, và bằng đúng `conNo`.
    expect(so.con.map((c) => c.conCoTheNhan)).toEqual([HOC_PHI_A, HOC_PHI_B]);
    expect(so.con.map((c) => c.conNo)).toEqual([HOC_PHI_A, HOC_PHI_B]);
    expect(so.con.map((c) => c.daVe)).toEqual([0, 0]);
    // Một dòng chờ gắn, và nó mời bấm được.
    const choGan = so.khoanDaVeChiTiet.filter((k) => k.orderItemId == null);
    expect(choGan).toHaveLength(1);
    expect(choGan[0]!.loaiButToan).toBe("PAYMENT");
    expect(choGan[0]!.daDao).toBe(false);
  });

  it("[TKD-02] tách 9.530.000 cho hai bé ⇒ công nợ TỪNG BÉ đúng", async () => {
    const r = await chia();
    expect(r.ok).toBe(true);
    expect(r.ok && r.soPhan).toBe(2);
    expect(r.ok && r.tenCon).toEqual(["Bé A 918", "Bé B 918"]);

    const so = await noTheoCon(DON);
    // Tiền đã về ĐÚNG từng bé. Trục A vẫn 0 — kế toán chưa xác nhận, và tách không phải
    // xác nhận.
    expect(so.con.map((c) => c.daVe)).toEqual([PHAN_A, PHAN_B]);
    expect(so.con.map((c) => c.choXacNhan)).toEqual([PHAN_A, PHAN_B]);
    expect(so.con.map((c) => c.daThu), "tách ≠ xác nhận kế toán").toEqual([0, 0]);
    // Trần nhận thêm của mỗi bé đã trừ đúng phần vừa nhận.
    expect(so.con.map((c) => c.conCoTheNhan)).toEqual([
      HOC_PHI_A - PHAN_A,
      HOC_PHI_B - PHAN_B,
    ]);

    // Không còn khoản nào chờ gắn — cặp gốc/đảo bị lọc khỏi danh sách mời bấm.
    const choGan = so.khoanDaVeChiTiet.filter(
      (k) => k.orderItemId == null && k.loaiButToan === "PAYMENT" && !k.daDao,
    );
    expect(choGan, "khối 'chưa gắn cho con nào' phải RỖNG").toHaveLength(0);
  });

  it("[TKD-03] TỔNG TIỀN CỦA ĐƠN KHÔNG ĐỔI — bất biến quan trọng nhất", async () => {
    // Tách là đổi cách ghi tên chủ của tiền, KHÔNG phải thu thêm hay trả bớt. Mọi con số ở
    // cấp ĐƠN phải y nguyên — kể cả `conNoDon`, tức cổng tạo đợt vẫn chặn đúng như trước.
    const truoc = await noTheoCon(DON);
    expect((await chia()).ok).toBe(true);
    const sau = await noTheoCon(DON);

    expect(sau.tongDaVe, "Σ tiền đã về").toBe(truoc.tongDaVe);
    expect(sau.conNoDon, "còn nợ CẢ ĐƠN").toBe(truoc.conNoDon);
    expect(sau.tongPhaiThu).toBe(truoc.tongPhaiThu);

    // Và đọc thẳng từ DB: Σ MỌI dòng `Payment` chưa xoá mềm (kể cả bút toán đảo âm).
    const tong = await db.payment.aggregate({
      where: { orderId: DON, deletedAt: null },
      _sum: { amount: true },
    });
    expect(tong._sum.amount, "gốc + đảo + hai phần = đúng số tiền ban đầu").toBe(KHOAN);

    // Ba dòng MỚI, dòng gốc còn nguyên vẹn.
    const goc = await db.payment.findUniqueOrThrow({ where: { id: GOC } });
    expect(goc.amount, "dòng gốc BẤT BIẾN — không sửa `amount`").toBe(KHOAN);
    expect(goc.orderItemId, "cũng không gắn gốc cho bé nào").toBeNull();
    expect(goc.deletedAt, "cũng không xoá mềm gốc").toBeNull();
    expect(await db.payment.count({ where: { orderId: DON, deletedAt: null } })).toBe(4);
  });

  it("[TKD-04] Σ lệch 1đ ⇒ CHẶN, và KHÔNG ghi một dòng nào", async () => {
    const truoc = await db.payment.count({ where: { orderId: DON } });
    const r = await tachKhoanChoCon({
      orderId: DON,
      paymentId: GOC,
      phan: [
        { orderItemId: A, soTien: PHAN_A },
        { orderItemId: B, soTien: PHAN_B - 1 },
      ],
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Còn THIẾU 1đ");
    // ⚠️ Luật rollback: `return` trong callback `$transaction` KHÔNG rollback. Ca này đo
    // bằng SỐ DÒNG chứ không tin vào việc cổng đứng ở đâu trong mã.
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(truoc);
  });

  it("[TKD-14] CẶP SỐ THẬT của pilot (nửa học phí mỗi bé) lệch 26.000đ ⇒ CHẶN", async () => {
    // ⚠️ GHIM MỘT SỰ THẬT VỀ DỮ LIỆU, KHÔNG PHẢI MỘT LỖI CỦA MÃ.
    //
    // Chủ dự án cấp cặp số để pilot: 4.488.000 (nửa học phí bé A) + 5.016.000 (nửa học phí
    // bé B). Hai nửa khít tuyệt đối, nhưng Σ = 9.504.000 trong khi khoản là 9.530.000 ⇒
    // **phụ huynh chuyển DƯ 26.000đ**. Cổng Σ-đúng-bằng chặn đúng cặp số ấy, và đó là hành
    // vi ĐÚNG: 26.000đ là tiền thật đã vào đơn, nó phải thuộc về một bé chứ không bốc hơi.
    //
    // ⚠️ VÀ HỆ THỐNG KHÔNG TỰ DỒN 26.000đ VÀO BÉ NÀO. Chủ dự án chốt 20/09: khoản chênh ấy
    // là tiền thật CHƯA AI GIẢI THÍCH ĐƯỢC (phụ huynh làm tròn? số học phí sai? phụ phí?),
    // nên phải HỎI phụ huynh / kế toán rồi mới tách. Không test nào, không runbook nào được
    // in ra một cặp số "chữa cháy" — in ra là chốt hộ một quyết định nghiệp vụ.
    //
    // Việc của ca này chỉ là: chứng minh cổng CHẶN, và ghim phép trừ để không ai phải tính
    // lại bằng tay giữa lúc pilot.
    expect(NUA_A + NUA_B).toBe(9_504_000);
    expect(KHOAN - (NUA_A + NUA_B), "phần chuyển DƯ").toBe(26_000);

    const r = await tachKhoanChoCon({
      orderId: DON,
      paymentId: GOC,
      phan: [
        { orderItemId: A, soTien: NUA_A },
        { orderItemId: B, soTien: NUA_B },
      ],
      actor: ACTOR,
    });
    expect(r.ok, "cặp số 'đẹp' vẫn phải bị chặn — Σ là Σ").toBe(false);
    expect(!r.ok && r.error).toBe("Còn THIẾU 26.000đ — tổng phải đúng bằng 9.530.000đ");
  });

  it("[TKD-05] một phần VƯỢT còn nợ của bé ⇒ CHẶN", async () => {
    const truoc = await db.payment.count({ where: { orderId: DON } });
    const r = await tachKhoanChoCon({
      orderId: DON,
      paymentId: GOC,
      phan: [
        { orderItemId: A, soTien: 9_000_000 }, // > 8.976.000
        { orderItemId: B, soTien: KHOAN - 9_000_000 },
      ],
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Bé A 918");
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(truoc);
  });

  it("[TKD-06] khoản ĐÃ GẮN cho một bé ⇒ KHÔNG tách được", async () => {
    // Quyết định "tiền này của bé A" là quyết định của một người. Tách đè lên nó sẽ âm thầm
    // chuyển tiền sang bé khác. Đường sửa: bỏ gắn (kế toán, có lý do) rồi tách.
    expect(
      (await ganKhoanDaThuChoCon({ orderId: DON, paymentId: GOC, orderItemId: A, actor: ACTOR }))
        .ok,
    ).toBe(true);

    const r = await chia();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("bỏ gắn trước");
  });

  it("[TKD-HD] khoản đang nằm trong HOÁ ĐƠN nháp ⇒ KHÔNG tách được, KHÔNG ghi một dòng nào", async () => {
    // docs/ke-toan-hoa-don/PLAN.md §5 — tách là đảo dòng gốc + đẻ n dòng mới, tờ hoá đơn đã
    // chụp dòng gốc. Đối chứng dương: [TKD-02] tách được đúng khoản này khi CHƯA có hoá đơn.
    await db.hoaDonDienTu.create({
      data: {
        id: `${T}hd`,
        orderId: DON,
        centerId: CENTER,
        trangThai: "NHAP",
        tongTien: KHOAN,
        taoBoiId: ACTOR.id,
        khoan: { create: [{ paymentId: GOC, soTien: KHOAN }] },
      },
    });
    const truoc = await db.payment.count({ where: { orderId: DON } });

    const r = await chia();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("hoá đơn nháp");
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(truoc);
  });

  it("[TKD-07] tách HAI LẦN ⇒ lần thứ hai bị CHẶN (tách hai lần là đẻ tiền)", async () => {
    expect((await chia()).ok).toBe(true);
    const r = await chia();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("đã được tách");
    // Và tiền vẫn đúng — không có lượt nào lọt nửa chừng.
    const tong = await db.payment.aggregate({
      where: { orderId: DON, deletedAt: null },
      _sum: { amount: true },
    });
    expect(tong._sum.amount).toBe(KHOAN);
  });

  it("[TKD-08] dấu vết của GỐC theo sang TỪNG PHẦN", async () => {
    expect((await chia()).ok).toBe(true);
    const phan = await db.payment.findMany({
      where: { orderId: DON, orderItemId: { not: null }, deletedAt: null },
      orderBy: { amount: "asc" },
    });
    expect(phan).toHaveLength(2);
    const goc = await db.payment.findUniqueOrThrow({ where: { id: GOC } });

    for (const p of phan) {
      expect(p.method, "phương thức").toBe(goc.method);
      expect(p.paidDate.toISOString(), "NGÀY THU của gốc, không phải hôm nay").toBe(
        goc.paidDate.toISOString(),
      );
      expect(p.evidenceUrl, "chứng từ").toBe(goc.evidenceUrl);
      expect(p.accountantStatus, "trục kế toán").toBe(goc.accountantStatus);
      expect(p.saleStatus, "trục sale").toBe(goc.saleStatus);
      expect(p.centerId, "cơ sở").toBe(goc.centerId);
      expect(p.recordedById, "người thu").toBe(goc.recordedById);
      expect(p.paymentType).toBe("PAYMENT");
      // ⚠️ `Payment` KHÔNG có cột `bankTransactionId`. Dây duy nhất nối một khoản với giao
      // dịch ngân hàng là MARKER trong `note`, và `goGanTheoCon` tìm dòng gốc bằng chính nó.
      // Mất marker = gỡ gắn NỬA VỜI. Xem `[TKD-09]`.
      expect(p.note, "marker ngân hàng phải theo sang").toContain(MARKER_NH);
      expect(p.note, "và marker của chính lượt tách").toContain(`[tach:${GOC}]`);
    }

    // `enrollmentId` suy từ DÒNG HÀNG, KHÔNG chép từ gốc — bé A có ghi danh, bé B thì chưa.
    // Đây là điều kiện `confirmPayment` đòi ("Khoản chưa gắn ghi danh, không thể sinh phiếu
    // thu"), tức là thứ làm cho "kế toán xác nhận từng phần" chạy được thật.
    const cuaA = phan.find((p) => p.orderItemId === A)!;
    const cuaB = phan.find((p) => p.orderItemId === B)!;
    expect(cuaA.enrollmentId, "bé A có ghi danh ⇒ phần của A gắn thẳng vào đó").toBe(GHI_DANH);
    expect(cuaB.enrollmentId, "bé B chưa có ghi danh ⇒ null, KHÔNG mượn của A").toBeNull();

    // Bút toán đảo mang `enrollmentId` của GỐC (ở đây là null) — trái dấu mà khác trục thì
    // tổng theo ghi danh không về 0.
    const dao = await db.payment.findFirstOrThrow({
      where: { orderId: DON, paymentType: "ADJUSTMENT" },
    });
    expect(dao.amount).toBe(-KHOAN);
    expect(dao.adjustmentOfId).toBe(GOC);
    expect(dao.enrollmentId).toBe(goc.enrollmentId);
    expect(dao.accountantStatus).toBe(goc.accountantStatus);
    expect(dao.note, "bút toán đảo KHÔNG mang marker ngân hàng").not.toContain(MARKER_NH);
  });

  it("[TKD-09] GỠ GẮN sau khi tách ⇒ đảo ĐÚNG n phần, tiền về 0", async () => {
    // ─────────────────────────────────────────────────────────────────────────
    // Chỗ hai hàm gặp nhau, và là ca dễ hỏng nhất của cả bản vá.
    //
    // `goGanTheoCon` tìm dòng gốc bằng MARKER trong `note` (`[auto:sepay:…]`) rồi sinh một
    // bút toán đảo cho mỗi dòng tìm được — NHƯNG nó bỏ qua dòng đã có bút toán đảo còn sống
    // (`daDao > 0 → continue`) và chỉ lấy `paymentType: "PAYMENT"`.
    //
    // Nên sau khi tách, nó phải thấy 3 dòng mang marker (gốc + 2 phần), bỏ qua gốc, và đảo
    // đúng 2 phần = 9.530.000đ. Nếu các phần KHÔNG chép `note` thì nó chỉ thấy gốc, gốc lại
    // bị bỏ qua ⇒ **0 bút toán đảo**: giao dịch về hàng chờ trong khi công nợ vẫn báo đã
    // đóng. Hai sổ nói hai chuyện, không lỗi nào báo.
    // ─────────────────────────────────────────────────────────────────────────
    expect((await chia()).ok).toBe(true);

    const go = await goGanTheoCon({
      bankTransactionId: TXN,
      orderId: DON,
      lyDo: "fixture: kiểm gỡ sau khi tách",
      actor: ACTOR,
    });
    expect(go.ok).toBe(true);
    expect(go.ok && go.soDongDao, "đảo hai PHẦN, KHÔNG đảo lại dòng gốc").toBe(2);
    expect(go.ok && go.tienDao).toBe(KHOAN);

    const tong = await db.payment.aggregate({
      where: { orderId: DON, deletedAt: null },
      _sum: { amount: true },
    });
    expect(tong._sum.amount, "gỡ hết ⇒ đơn không còn đồng nào đã thu").toBe(0);

    const so = await noTheoCon(DON);
    expect(so.tongDaVe).toBe(0);
    expect(so.con.map((c) => c.daVe), "nợ của từng bé quay lại đủ").toEqual([0, 0]);
    expect(so.con.map((c) => c.conCoTheNhan)).toEqual([HOC_PHI_A, HOC_PHI_B]);
  });

  it("[TKD-10] kế toán XÁC NHẬN phần A + TỪ CHỐI phần B ⇒ mỗi bé một ngả", async () => {
    // Đây là lý do các phần phải là n dòng `Payment` RIÊNG: `confirmPayment`/`rejectPayment`
    // làm việc theo `paymentId`. Ca này kiểm HỆ QUẢ SỔ SÁCH (xem ranh giới ở đầu tệp).
    expect((await chia()).ok).toBe(true);
    const cuaA = await db.payment.findFirstOrThrow({ where: { orderId: DON, orderItemId: A } });
    const cuaB = await db.payment.findFirstOrThrow({ where: { orderId: DON, orderItemId: B } });

    await db.payment.update({
      where: { id: cuaA.id },
      data: { accountantStatus: "CONFIRMED", confirmedAt: new Date("2699-09-19T02:00:00Z") },
    });
    await db.payment.update({
      where: { id: cuaB.id },
      data: { accountantStatus: "REJECTED", rejectReason: "fixture: chứng từ không khớp" },
    });

    const so = await noTheoCon(DON);
    // Bé A: tiền vào TRỤC A ⇒ còn nợ giảm thật, và đó là con số nói với phụ huynh.
    expect(so.con[0]!.daThu).toBe(PHAN_A);
    expect(so.con[0]!.conNo).toBe(HOC_PHI_A - PHAN_A);
    // Bé B: bị từ chối ⇒ RỜI tập rộng ⇒ nợ quay lại đủ, và trần nhận thêm mở lại.
    expect(so.con[1]!.daThu).toBe(0);
    expect(so.con[1]!.daVe, "khoản REJECTED không còn là tiền đã về").toBe(0);
    expect(so.con[1]!.conNo).toBe(HOC_PHI_B);
    expect(so.con[1]!.conCoTheNhan).toBe(HOC_PHI_B);

    // Ở cấp ĐƠN: phần bị từ chối thành nợ thật trở lại, nên `conNoDon` TĂNG đúng bằng nó.
    expect(so.conNoDon).toBe(9_478_000 + PHAN_B);
  });

  it("[TKD-11] khoản kế toán ĐÃ XÁC NHẬN ⇒ KHÔNG tách được", async () => {
    // `CONFIRMED` đã có phiếu thu đứng tên số tiền gốc. Đảo dòng gốc mà tờ phiếu vẫn nằm
    // trong tay phụ huynh là chữa SỔ chứ không chữa được tờ giấy.
    await db.payment.update({
      where: { id: GOC },
      data: { accountantStatus: "CONFIRMED" },
    });
    const r = await chia();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Kế toán đã xử lý");
    expect(await db.payment.count({ where: { orderId: DON, deletedAt: null } })).toBe(1);
  });

  it("[TKD-13] trần là `conCoTheNhan`, KHÔNG phải `conNo` — tiền CHỜ XÁC NHẬN cũng chặn", async () => {
    // ─────────────────────────────────────────────────────────────────────────
    // CA DUY NHẤT TRONG BỘ NÀY MÀ HAI CON SỐ TÁCH NHAU, nên là ca duy nhất chứng minh được
    // vì sao trần không lấy `conNo`.
    //
    // Bé A nhận trước 4.488.000đ (`PENDING` — kế toán chưa duyệt). Trục A KHÔNG thấy đồng
    // nào, nên `conNo` của A vẫn nguyên 8.976.000. Lấy `conNo` làm trần thì tách tiếp
    // 5.000.000 cho A sẽ LỌT ⇒ A nhận 9.488.000 trên một học phí 8.976.000, và không cổng
    // nào cắn. Tách vài lần nữa thì bé A "đã đóng" gấp đôi phần của mình.
    // ─────────────────────────────────────────────────────────────────────────
    const KHOAN_2 = `${T}pay-2`;
    await db.payment.create({
      data: {
        id: KHOAN_2,
        orderId: DON,
        orderItemId: null,
        amount: PHAN_A,
        method: "sepay",
        paidDate: new Date("2699-09-17T02:00:00Z"),
        accountantStatus: "PENDING",
        saleStatus: "RECORDED",
        centerId: CENTER,
      },
    });
    expect(
      (
        await ganKhoanDaThuChoCon({
          orderId: DON,
          paymentId: KHOAN_2,
          orderItemId: A,
          actor: ACTOR,
        })
      ).ok,
    ).toBe(true);

    const so = await noTheoCon(DON);
    expect(so.con[0]!.conNo, "TRỤC A không thấy khoản PENDING ⇒ còn nợ KHÔNG đổi").toBe(
      HOC_PHI_A,
    );
    expect(so.con[0]!.daVe).toBe(PHAN_A);
    expect(so.con[0]!.conCoTheNhan, "trần thì ĐÃ trừ — đây là chỗ hai số tách nhau").toBe(
      HOC_PHI_A - PHAN_A,
    );

    const r = await tachKhoanChoCon({
      orderId: DON,
      paymentId: GOC,
      phan: [
        // 6.000.000 < conNo (8.976.000) nhưng > conCoTheNhan (5.199.000).
        { orderItemId: A, soTien: 6_000_000 },
        { orderItemId: B, soTien: KHOAN - 6_000_000 },
      ],
      actor: ACTOR,
    });
    expect(r.ok, "lấy `conNo` làm trần thì ca này LỌT").toBe(false);
    expect(!r.ok && r.error).toContain(`tối đa ${(HOC_PHI_A - PHAN_A).toLocaleString("vi-VN")}đ`);
    expect(!r.ok && r.error, "và nói VÌ SAO trần nhỏ hơn số trên màn").toContain(
      `đã có ${PHAN_A.toLocaleString("vi-VN")}đ vào đơn rồi`,
    );
  });

  it("[TKD-12] nhật ký ghi ĐỦ từng phần, không chỉ ghi 'đã tách'", async () => {
    expect((await chia()).ok).toBe(true);
    const log = await db.auditLog.findMany({
      where: { entityType: "Order", entityId: DON, action: "KHOAN_TACH_CHO_CON" },
    });
    expect(log).toHaveLength(1);
    const moi = log[0]!.newValues as { butToanDaoId: string; phan: { soTien: number }[] };
    expect(moi.butToanDaoId, "id bút toán đảo — để tra ngược").toBeTruthy();
    expect(moi.phan.map((p) => p.soTien)).toEqual([PHAN_A, PHAN_B]);
    const cu = log[0]!.oldValues as { amount: number; accountantStatus: string };
    expect(cu.amount, "số tiền gốc TRƯỚC khi tách").toBe(KHOAN);
    expect(cu.accountantStatus).toBe("PENDING");
  });
});
