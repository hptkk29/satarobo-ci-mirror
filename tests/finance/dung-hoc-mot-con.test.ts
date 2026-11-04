// tests/finance/dung-hoc-mot-con.test.ts — DỪNG HỌC MỘT CON, trên Postgres THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy:  pnpm test:finance-db      (CI: job "Chat DB invariants", một required check)
// `pnpm test:unit` trần sẽ SKIP — thiếu `ALLOW_DB_RESET=1`, xem tests/_helpers/db-gate.ts.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG THỂ CHỈ LÀ TEST THUẦN
//
// Phép số học đã phủ hết ở `lib/finance/dung-hoc.test.ts` (23 ca, không cần Postgres). Thứ
// bộ này kiểm là những thứ chỉ tồn tại khi có DB thật, và mỗi cái đều là một chỗ tiền có
// thể rò:
//
//   · công nợ của bé có THỰC SỰ đọc `usedValue` sau khi dừng không, hay vẫn đọc học phí gốc;
//   · đợt đã nhận một phần có bị VOID không, và `recomputeRequestStatuses` chạy sau có lật
//     ngược nó về PARTIAL không (`deriveStatus` trả VOID vĩnh viễn — nếu ai sửa chỗ đó thì
//     ca ở đây phải đỏ);
//   · tiền chuyển sang bé kia có làm `conNo` của bé kia GIẢM đúng số không;
//   · `RefundRequest` sinh ra có **nhìn thấy được** ở màn kế toán không (dòng
//     `enrollmentId = NULL` từng vô hình — xem `listRefundRequests`);
//   · cổng chống hoàn kép có cắn khi bấm "Nghỉ học hẳn" sau đó không.
//
// Luật 9: *cổng phải được cho ăn bằng thứ đường THẬT cho nó ăn*.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { noTheoCon } from "@/lib/finance/debt";
import { dungHocMotCon, docTrangThaiDungHoc, xemTruocDungHoc } from "@/lib/finance/dung-hoc-con";
import { huyDotChoCon, taoDotChoCon } from "@/lib/finance/ghi-tien-don";
import { taoPhieuGop, docPhieuGopDangMo } from "@/lib/finance/phieu-gop";
import { recomputeRequestStatuses } from "@/lib/payments/payment-request";
import { createRefundRequest, listRefundRequests } from "@/lib/finance/refund";
import { nghiHocHan } from "@/lib/students/withdraw";

if (!RUN_DB_TESTS) console.warn(`[DHC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-dhc-";
const ACTOR = { id: `${T}actor`, name: "Sale fixture" };

const CENTER = `${T}center`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HS_A = `${T}hs-a`;
const HS_B = `${T}hs-b`;
const GD_A = `${T}gd-a`;
const GD_B = `${T}gd-b`;
/** Lớp + ghi danh THỨ HAI của bé A — để kiểm "nghỉ học hẳn" không bị chặn cả thao tác. */
const KHOA2 = `${T}khoa2`;
const LOP2 = `${T}lop2`;
const GD_A2 = `${T}gd-a2`;
const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;

/** Số của chủ dự án: 12.000.000đ / 48 buổi = 250.000đ/buổi. */
const HOC_PHI = 12_000_000;
const SO_BUOI_CAM_KET = 48;
const DA_THU = 6_000_000;
/**
 * Dư khi dừng ở BUỔI 20: 20 buổi có ngày ≤, TRỪ buổi 3 đã huỷ ⇒ **19 buổi**.
 * 6.000.000 − 19 × 250.000 = 1.250.000đ.
 *
 * ⚠️ Con số này KHÔNG phải 1.000.000 như trực giác — và đó là điểm: phép đếm loại buổi huỷ.
 * Bản đầu của ca test viết 1.000.000 và cổng `kiemPhanDu` bắt được ("Còn 250.000đ chưa
 * phân"). Cổng đúng, ca sai; ghi lại để người sau đừng "sửa" cổng cho khớp trực giác.
 */
const DU_SAU_BUOI_20 = DA_THU - 19 * 250_000;

/** 48 buổi, mỗi tuần một buổi, 19:30 giờ VN — `ClassSession.date` MANG GIỜ THẬT. */
const NGAY_BUOI = (i: number) => new Date(Date.UTC(2699, 0, 5 + i * 7, 12, 30, 0));
const BUOI = (i: number) => `${T}buoi-${i}`;

async function don() {
  // ⚠️ DỌN CẢ `AuditLog`. Bỏ bảng này ra khỏi phép dọn là một lỗ CÁCH LY thật, và nó đã
  // bị bắt bằng phép cấy: gỡ `writeAudit` của lượt bỏ qua hoàn tiền vẫn cho **0 ca đỏ**,
  // vì dòng nhật ký của lượt chạy TRƯỚC còn nằm đó và ca `[DHC-09c]` tìm thấy nó. Luật 18:
  // mỗi ca phải xanh khi chạy một mình — và ở đây "một mình" gồm cả "trên DB sạch".
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: ACTOR.id },
        { entityId: { in: [DON, A, B, GD_A, GD_B, GD_A2] } },
      ],
    },
  });
  await db.refundRequest.deleteMany({ where: { orderItem: { orderId: DON } } });
  await db.refundRequest.deleteMany({ where: { enrollmentId: { in: [GD_A, GD_B] } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: T } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: DON } } });
  await db.paymentBill.deleteMany({ where: { orderId: DON } });
  await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.refundRequest.deleteMany({ where: { enrollmentId: GD_A2 } });
  await db.enrollmentAuditLog.deleteMany({
    where: { enrollmentId: { in: [GD_A, GD_B, GD_A2] } },
  });
  await db.payment.deleteMany({ where: { enrollmentId: GD_A2 } });
  await db.enrollment.deleteMany({ where: { id: { in: [GD_A, GD_B, GD_A2] } } });
  await db.classSession.deleteMany({ where: { classId: { in: [LOP, LOP2] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP2] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA2] } } });
  await db.student.deleteMany({ where: { id: { in: [HS_A, HS_B] } } });
  await db.center.deleteMany({ where: { id: CENTER } });
}

/**
 * Đơn HAI CON × 12.000.000đ. Bé A đã thu 6.000.000đ CONFIRMED; bé B chưa đóng đồng nào.
 * Lớp có 48 buổi, buổi 1..20 đã qua ngày và **CỐ Ý còn `SCHEDULED`**.
 *
 * ⚠️ Hình dạng "buổi quá khứ chưa ai chốt" là hình dạng THẬT của prod (đo 07/09: 209/287).
 * Fixture để hết `COMPLETED` sẽ làm mọi ca dưới xanh vì lý do sai — và che mất đúng con bug
 * mà luật "đếm theo NGÀY" sinh ra để tránh (luật: fixture phải mang hình dạng dữ liệu thật).
 */
async function dungFixture(opts: { coGhiDanhA?: boolean; soBuoiCamKet?: number | null } = {}) {
  await don();
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture DHC", slug: `${T}co-so`, address: "114 Hoàng Diệu" },
  });
  await db.course.create({
    data: {
      id: KHOA,
      name: "Sata 3 fixture",
      slug: `${T}sata-3`,
      totalSessions: opts.soBuoiCamKet === undefined ? SO_BUOI_CAM_KET : opts.soBuoiCamKet,
    },
  });
  await db.class.create({ data: { id: LOP, name: "Lớp fixture DHC", courseId: KHOA } });
  await db.student.create({ data: { id: HS_A, name: "Bé A DHC" } });
  await db.student.create({ data: { id: HS_B, name: "Bé B DHC" } });

  await db.classSession.createMany({
    data: Array.from({ length: SO_BUOI_CAM_KET }, (_, i) => ({
      id: BUOI(i + 1),
      classId: LOP,
      date: NGAY_BUOI(i),
      // Buổi 3 bị HUỶ — buổi huỷ không được tính là đã dùng dù ngày đã qua.
      status: i + 1 === 3 ? ("CANCELLED" as const) : ("SCHEDULED" as const),
    })),
  });

  const coGhiDanh = opts.coGhiDanhA !== false;
  if (coGhiDanh) {
    await db.enrollment.create({
      data: { id: GD_A, studentId: HS_A, classId: LOP, courseId: KHOA, status: "ACTIVE" },
    });
  }
  await db.enrollment.create({
    data: { id: GD_B, studentId: HS_B, classId: LOP, courseId: KHOA, status: "ACTIVE" },
  });

  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269905-000001",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture DHC",
      customerPhone: "0999000905",
      totalAmount: HOC_PHI * 2,
      centerId: CENTER,
    },
  });
  for (const [id, ten, gd] of [
    [A, "Bé A DHC", coGhiDanh ? GD_A : null],
    [B, "Bé B DHC", GD_B],
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
        enrollmentId: gd,
      },
    });
  }

  await db.payment.create({
    data: {
      id: `${T}pay-a`,
      orderId: DON,
      orderItemId: A,
      ...(coGhiDanh ? { enrollmentId: GD_A } : {}),
      amount: DA_THU,
      method: "BANK_TRANSFER",
      accountantStatus: "CONFIRMED",
      paidDate: new Date("2699-01-05T03:00:00Z"),
      centerId: CENTER,
    },
  });
}

const dungSauBuoi20 = (them: Partial<Parameters<typeof dungHocMotCon>[0]> = {}) =>
  dungHocMotCon({
    orderId: DON,
    orderItemId: A,
    lyDo: "PH_CHU_DONG",
    buoiCuoiId: BUOI(20),
    ghiChu: null,
    phanDu: [],
    actor: ACTOR,
    // Mốc "hôm nay" ĐÓNG BĂNG (luật 19). Buổi 20 = 05/01/2699 + 19×7 ngày; đặt mốc ngay sau
    // nó thì buổi 20 chính là gợi ý của hệ thống ⇒ không cần ghi chú.
    now: new Date(Date.UTC(2699, 0, 5 + 19 * 7, 23, 0, 0)),
    ...them,
  });

describe.skipIf(!RUN_DB_TESTS)("[DHC] dừng học một con — DB thật", () => {
  beforeEach(async () => {
    await dungFixture();
  });
  afterAll(don);

  it("[DHC-00] fixture đúng hình dạng: 2 bé × 12tr · bé A đã thu 6tr · 20 buổi đã qua còn SCHEDULED", async () => {
    // Ca kiểm chính FIXTURE. Thiếu nó thì mọi ca dưới có thể xanh vì cổng không thấy tiền —
    // bài học `[CTD-01]`.
    const so = await noTheoCon(DON);
    expect(so.tongPhaiThu).toBe(HOC_PHI * 2);
    expect(so.con.find((c) => c.orderItemId === A)?.daThu).toBe(DA_THU);
    expect(so.con.find((c) => c.orderItemId === B)?.conNo).toBe(HOC_PHI);

    const chuaChot = await db.classSession.count({
      where: { classId: LOP, status: "SCHEDULED", date: { lte: NGAY_BUOI(19) } },
    });
    expect(chuaChot, "buổi quá khứ phải còn SCHEDULED — hình dạng thật của prod").toBe(19);
    expect(await db.classSession.count({ where: { classId: LOP, status: "COMPLETED" } })).toBe(0);
  });

  it("[DHC-01] CA GỐC: dừng sau buổi 20 → dùng 5.000.000, dư 1.000.000 chuyển sang bé kia", async () => {
    const r = await dungSauBuoi20({
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: DU_SAU_BUOI_20 }],
    });
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;

    // 20 buổi có ngày ≤ buổi 20, TRỪ buổi 3 đã huỷ ⇒ 19 buổi đã dùng.
    expect(r.soBuoiDaDung).toBe(19);
    expect(r.giaTriDaDung).toBe(19 * 250_000);
    expect(r.chenh).toBe(DA_THU - 19 * 250_000);
    expect(r.daChuyen).toBe(DU_SAU_BUOI_20);

    const so = await noTheoCon(DON);
    const conA = so.con.find((c) => c.orderItemId === A)!;
    const conB = so.con.find((c) => c.orderItemId === B)!;
    // Bé A: phải thu nay là GIÁ TRỊ QUYẾT TOÁN, không phải 12tr.
    expect(conA.phaiThu).toBe(19 * 250_000);
    expect(conA.conNo, "chuyển hết dư ⇒ bé dừng học hết nợ, không còn đóng thừa").toBe(0);
    // Bé B nhận đúng phần chuyển sang.
    expect(conB.conNo).toBe(HOC_PHI - DU_SAU_BUOI_20);
    expect(conB.daThu).toBe(DU_SAU_BUOI_20);
    // Tổng tiền của ĐƠN không đổi một đồng: cặp −/+ triệt tiêu.
    expect(so.tongDaThu).toBe(DA_THU);
  });

  it("[DHC-01b] đúng con số chủ dự án đưa: dừng ở buổi 21 ⇒ 20 buổi · 5.000.000đ · dư 1.000.000", async () => {
    // Buổi 3 huỷ nên phải lùi một buổi mới ra đủ 20. Ca này ghim CHÍNH con số trong đề bài,
    // và nó chỉ đúng khi phép đếm loại buổi huỷ — đó là điểm nó canh.
    const r = await dungSauBuoi20({
      buoiCuoiId: BUOI(21),
      ghiChu: "Chốt với phụ huynh: buổi 21 là buổi cuối",
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: 1_000_000 }],
    });
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.soBuoiDaDung).toBe(20);
    expect(r.giaTriDaDung).toBe(5_000_000);
    expect(r.chenh).toBe(1_000_000);
  });

  it("[DHC-02] HỌC LỐ tới buổi 26 → bé còn NỢ 500.000, và tạo được đợt đúng số đó", async () => {
    const r = await dungSauBuoi20({
      buoiCuoiId: BUOI(27), // 27 buổi có ngày ≤, trừ buổi 3 huỷ ⇒ 26 buổi
      ghiChu: "Bé học thêm 6 buổi so với gợi ý",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.soBuoiDaDung).toBe(26);
    expect(r.giaTriDaDung).toBe(6_500_000);
    expect(r.chenh).toBe(-500_000);

    const so = await noTheoCon(DON);
    expect(so.con.find((c) => c.orderItemId === A)?.conNo).toBe(500_000);

    // Phần thiếu thu qua ĐÚNG cổng hiện có, không có đường riêng.
    const dot = await taoDotChoCon({
      orderId: DON,
      orderItemId: A,
      soTien: 500_000,
      dueDate: null,
      centerId: CENTER,
      actor: ACTOR,
    });
    expect(dot.ok, `không tạo được đợt phần thiếu: ${!dot.ok ? dot.error : ""}`).toBe(true);

    // Và cổng vẫn cắn đúng ở 1đ vượt — quyết toán KHÔNG nới trần của bé.
    const vuot = await taoDotChoCon({
      orderId: DON,
      orderItemId: A,
      soTien: 1,
      dueDate: null,
      centerId: CENTER,
      actor: ACTOR,
    });
    expect(vuot.ok).toBe(false);
  });

  it("[DHC-03] Σ phân dư ≠ chênh ⇒ CHẶN, và KHÔNG ghi gì cả", async () => {
    for (const phan of [
      [],
      [{ kieu: "CHUYEN" as const, orderItemId: B, soTien: DU_SAU_BUOI_20 - 1 }],
      [{ kieu: "CHUYEN" as const, orderItemId: B, soTien: DU_SAU_BUOI_20 + 1 }],
    ]) {
      const r = await dungSauBuoi20({ phanDu: phan });
      expect(r.ok, `phải chặn với phần = ${JSON.stringify(phan)}`).toBe(false);
    }
    // ⚠️ Vế quan trọng nhất của ca: cổng đứng TRƯỚC phép ghi đầu tiên (luật rollback).
    // Cổng đúng mà đặt sau `updateMany` thì dòng đơn đã STOPPED trong khi người dùng nhận
    // "không làm được" — đúng hình dạng `[GDC-c2]` đã bắt được một lần.
    const dong = await db.orderItem.findUnique({ where: { id: A }, select: { status: true } });
    expect(dong?.status, "dòng đơn phải còn nguyên ACTIVE sau 3 lượt bị chặn").toBe("ACTIVE");
    expect(await db.refundRequest.count({ where: { orderItemId: A } })).toBe(0);
    expect(await db.payment.count({ where: { orderId: DON } }), "không đẻ bút toán nào").toBe(1);
  });

  it("[DHC-04] ĐỢT ĐÃ NHẬN MỘT PHẦN vẫn bị VOID — và `recompute` KHÔNG lật ngược nó", async () => {
    // Đợt 6.000.000 của bé A, đã nhận 2.000.000 (đúng ca chủ dự án mô tả).
    const dot = await taoDotChoCon({
      orderId: DON,
      orderItemId: A,
      soTien: 6_000_000,
      dueDate: null,
      centerId: CENTER,
      actor: ACTOR,
    });
    expect(dot.ok).toBe(true);
    if (!dot.ok) return;
    const txn = await db.bankTransaction.create({
      data: {
        id: `${T}txn`,
        provider: "SEPAY",
        providerTxnId: `${T}txn-1`,
        amount: 2_000_000,
        content: "fixture DHC",
        transferredAt: new Date("2699-01-20T03:00:00Z"),
        status: "MATCHED",
        centerId: CENTER,
      },
    });
    await db.paymentAllocation.create({
      data: {
        bankTransactionId: txn.id,
        paymentRequestId: dot.paymentRequestId,
        amount: 2_000_000,
        centerId: CENTER,
      },
    });
    // ⚠️ BẮT BUỘC: đẩy đợt sang PARTIAL bằng ĐÚNG hàm mà đường thật dùng.
    //
    // Bản đầu của ca này bỏ bước đó, nên đợt vẫn ở `PENDING` dù đã có 2.000.000đ rót vào —
    // và ca TỰ NÓ thành tautology: cấy lỗi `status: { in: ["PENDING"] }` vào
    // `huyDotKhiDungHoc` (tức đúng con bug "bỏ qua đợt đã nhận một phần") vẫn cho **0 ca
    // đỏ**. Phép cấy của luật 14 bắt được; test xanh KHÔNG chứng minh gì cả nếu fixture
    // chưa mang hình dạng mà ca nói là nó đang kiểm.
    await db.$transaction(async (tx) => {
      await recomputeRequestStatuses(tx, DON);
    });
    expect(
      (await db.paymentRequest.findUnique({ where: { id: dot.paymentRequestId } }))?.status,
      "fixture phải thật sự ở PARTIAL, nếu không ca này không kiểm gì",
    ).toBe("PARTIAL");

    // Sale bấm "Huỷ đợt" THƯỜNG trên đợt đang giữ tiền ⇒ vẫn bị chặn như trước. Luật cũ
    // KHÔNG bị nới; ngoại lệ chỉ sống bên trong đường dừng học.
    const huyThuong = await huyDotChoCon({
      orderId: DON,
      paymentRequestId: dot.paymentRequestId,
      centerId: CENTER,
      actor: ACTOR,
    });
    expect(huyThuong.ok, "kiemHuyDot phải giữ nguyên luật cũ").toBe(false);

    const r = await dungSauBuoi20({
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: DU_SAU_BUOI_20 }],
    });
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.soDotDaHuy).toBe(1);

    const sau = await db.paymentRequest.findUnique({
      where: { id: dot.paymentRequestId },
      select: { status: true, allocations: { select: { amount: true } } },
    });
    // VOID, và `recomputeRequestStatuses` chạy ở bước 7 KHÔNG lật nó về PARTIAL
    // (`deriveStatus` trả VOID vĩnh viễn). Sửa `deriveStatus` là ca này đỏ.
    expect(sau?.status).toBe("VOID");
    // Phân bổ KHÔNG bị xoá, KHÔNG bị đảo — tiền đã nhận vẫn là tiền đã nhận.
    expect(sau?.allocations.map((a) => a.amount)).toEqual([2_000_000]);
  });

  it("[DHC-05] PHIẾU GỘP: chưa nhận đồng nào ⇒ HUỶ; đã nhận một phần ⇒ ĐÓNG", async () => {
    const dotA = await taoDotChoCon({
      orderId: DON,
      orderItemId: A,
      soTien: 3_000_000,
      dueDate: null,
      centerId: CENTER,
      actor: ACTOR,
    });
    const dotB = await taoDotChoCon({
      orderId: DON,
      orderItemId: B,
      soTien: 3_000_000,
      dueDate: null,
      centerId: CENTER,
      actor: ACTOR,
    });
    expect(dotA.ok && dotB.ok).toBe(true);
    if (!dotA.ok || !dotB.ok) return;

    const phieu = await taoPhieuGop({
      orderId: DON,
      paymentRequestIds: [dotA.paymentRequestId, dotB.paymentRequestId],
      actor: ACTOR,
    });
    expect(phieu.ok, `không phát được phiếu: ${!phieu.ok ? phieu.error : ""}`).toBe(true);

    const r = await dungSauBuoi20({
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: DU_SAU_BUOI_20 }],
    });
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);

    // Phiếu chưa nhận đồng nào ⇒ VOID, và màn đơn không còn phiếu mở nào.
    const con = await docPhieuGopDangMo(DON);
    expect(con, "phiếu gộp phải bị huỷ, không còn mở").toBeNull();
    const trangThai = await db.paymentBill.findFirst({
      where: { orderId: DON },
      select: { status: true },
    });
    expect(trangThai?.status).toBe("VOID");
  });

  it("[DHC-06] chọn HOÀN ⇒ 1 RefundRequest PENDING đúng số, và Payment KHÔNG đổi", async () => {
    const truoc = await db.payment.findMany({
      where: { orderId: DON },
      select: { id: true, amount: true, accountantStatus: true },
      orderBy: { id: "asc" },
    });

    const r = await dungSauBuoi20({ phanDu: [{ kieu: "HOAN", soTien: DU_SAU_BUOI_20 }] });
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.daDatHoan).toBe(DU_SAU_BUOI_20);
    expect(r.refundRequestId).toBeTruthy();

    const yc = await db.refundRequest.findMany({ where: { orderItemId: A } });
    expect(yc).toHaveLength(1);
    expect(yc[0]!.status).toBe("PENDING");
    expect(yc[0]!.proposedAmount).toBe(DU_SAU_BUOI_20);
    expect(yc[0]!.approvedAmount, "chưa duyệt thì chưa có số duyệt").toBeNull();
    // Snapshot phải giải thích được con số: 19 buổi / 48 buổi cam kết × 250.000.
    expect(yc[0]!.sessionsTotal).toBe(SO_BUOI_CAM_KET);
    expect(yc[0]!.sessionsLearned).toBe(19);
    expect(yc[0]!.unitPrice).toBe(250_000);

    // ⚠️ KHÔNG chi tiền: sổ `Payment` phải y nguyên. Đây là toàn bộ nghĩa của "kế toán hoàn".
    const sau = await db.payment.findMany({
      where: { orderId: DON },
      select: { id: true, amount: true, accountantStatus: true },
      orderBy: { id: "asc" },
    });
    expect(sau).toEqual(truoc);

    // Và bé hiện "Chờ hoàn", KHÔNG hiện như đóng thừa vô cớ.
    const tt = await docTrangThaiDungHoc(DON);
    expect(tt[A]?.daDung).toBe(true);
    expect(tt[A]?.choHoan).toBe(DU_SAU_BUOI_20);
    expect(tt[A]?.coHoanBiTuChoi).toBe(false);
  });

  it("[DHC-07] kế toán TỪ CHỐI ⇒ khoản dư quay về 'chưa xử lý', đơn có cảnh báo", async () => {
    const r = await dungSauBuoi20({ phanDu: [{ kieu: "HOAN", soTien: DU_SAU_BUOI_20 }] });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.refundRequestId) return;

    await db.refundRequest.update({
      where: { id: r.refundRequestId },
      data: { status: "REJECTED", note: "Phụ huynh xin giữ lại" },
    });

    const tt = await docTrangThaiDungHoc(DON);
    expect(tt[A]?.choHoan, "không còn khoản nào đang chờ").toBe(0);
    expect(tt[A]?.coHoanBiTuChoi).toBe(true);
    // Và bé vẫn đang giữ 1.000.000 dư ⇒ `conNo` âm ⇒ màn đơn in "Dư … CHƯA xử lý".
    const so = await noTheoCon(DON);
    expect(so.con.find((c) => c.orderItemId === A)?.conNo).toBe(-DU_SAU_BUOI_20);
  });

  it("[DHC-08] dòng đơn CHƯA gắn ghi danh vẫn dừng học + đặt hoàn được", async () => {
    await dungFixture({ coGhiDanhA: false });

    // Không có lớp ⇒ không buổi nào ⇒ chưa học buổi nào ⇒ quyết toán 0đ, cả 6tr là dư.
    const r = await dungHocMotCon({
      orderId: DON,
      orderItemId: A,
      lyDo: "PH_CHU_DONG",
      buoiCuoiId: null,
      ghiChu: null,
      phanDu: [{ kieu: "HOAN", soTien: DA_THU }],
      actor: ACTOR,
      now: new Date(Date.UTC(2699, 0, 5 + 19 * 7, 23, 0, 0)),
    });
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.soBuoiDaDung).toBe(0);
    expect(r.giaTriDaDung).toBe(0);

    const yc = await db.refundRequest.findFirst({ where: { orderItemId: A } });
    expect(yc?.enrollmentId, "không có ghi danh thì cột đó là NULL — và đó là hợp lệ").toBeNull();
    expect(yc?.proposedAmount).toBe(DA_THU);
  });

  it("[DHC-08b] yêu cầu hoàn KHÔNG có ghi danh vẫn HIỆN ở màn kế toán", async () => {
    // ⚠️ Ca canh đúng con bug mà khảo sát 21/09 tìm ra: `listRefundRequests` lọc bằng
    // `enrollment: { classId: { in } }`, và bộ lọc quan hệ ấy KHÔNG BAO GIỜ khớp dòng
    // `enrollmentId = NULL` ⇒ kế toán không thấy yêu cầu nào ⇒ tiền dư biến mất trong im
    // lặng. Ca này đỏ nếu ai đó bỏ nhánh thứ hai của bộ lọc.
    await dungFixture({ coGhiDanhA: false });
    await dungHocMotCon({
      orderId: DON,
      orderItemId: A,
      lyDo: "PH_CHU_DONG",
      buoiCuoiId: null,
      ghiChu: null,
      phanDu: [{ kieu: "HOAN", soTien: DA_THU }],
      actor: ACTOR,
      now: new Date(Date.UTC(2699, 0, 5 + 19 * 7, 23, 0, 0)),
    });

    // `ScopedDb` của một người thấy MỌI lớp + MỌI đơn (SUPER_ADMIN) — điều đang kiểm là
    // bộ lọc, không phải phạm vi.
    const rows = await listRefundRequests(
      db as unknown as Parameters<typeof listRefundRequests>[0],
    );
    const cua = rows.filter((x) => x.orderItemId === A);
    expect(cua, "yêu cầu hoàn của dòng không có ghi danh phải HIỆN").toHaveLength(1);
    expect(cua[0]!.studentName, "rơi về tên trên dòng đơn").toBe("Bé A DHC");
    expect(cua[0]!.orderCode).toBe("ORD-269905-000001");
  });

  it("[DHC-09] LƯỚI CUỐI: gọi thẳng `createRefundRequest` cho ghi danh đã quyết toán ⇒ NÉM", async () => {
    const r = await dungSauBuoi20({
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: DU_SAU_BUOI_20 }],
    });
    expect(r.ok).toBe(true);

    await expect(
      createRefundRequest({
        enrollmentId: GD_A,
        trigger: "WITHDRAW",
        reason: "Nghỉ học hẳn",
        actorName: "Admin",
      }),
      "phải NÉM, không được im lặng trả null",
    ).rejects.toThrow(/quyết toán/i);

    expect(await db.refundRequest.count({ where: { enrollmentId: GD_A } })).toBe(0);
  });

  it("[DHC-09b] 'NGHỈ HỌC HẲN' vẫn CHẠY: rời cả hai lớp, chỉ bỏ qua phần TIỀN của ghi danh đã quyết toán", async () => {
    // ⚠️ Ca này ghim bản SỬA của chủ dự án (21/09, sau khi duyệt PR #322): bản đầu để
    // `createRefundRequest` ném mà không ai bắt ⇒ một học viên có MỘT dòng đơn đã STOPPED
    // thì **không bao giờ** cho nghỉ hẳn được nữa, kể cả khi em còn ghi danh khoá khác chưa
    // ai đụng tới. Cổng đúng chỗ, sai TẦM.
    //
    // Bé A có ghi danh THỨ HAI ở một khoá khác, đã đóng đủ tiền và sổ buổi ĐÃ CHỐT (để
    // `createRefundRequest` thật sự sinh được đề xuất — nếu không, ca sẽ xanh vì lý do sai:
    // "0 đề xuất" do lưới sổ-buổi chặn chứ không do đường tiền chạy đúng).
    await db.course.create({
      data: { id: KHOA2, name: "Sata 4 fixture", slug: `${T}sata-4`, totalSessions: 10 },
    });
    await db.class.create({ data: { id: LOP2, name: "Lớp fixture DHC 2", courseId: KHOA2 } });
    await db.classSession.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        id: `${T}buoi2-${i + 1}`,
        classId: LOP2,
        date: new Date(Date.UTC(2699, 0, 6 + i * 7, 12, 30, 0)),
        status: "COMPLETED" as const,
      })),
    });
    await db.enrollment.create({
      data: {
        id: GD_A2,
        studentId: HS_A,
        classId: LOP2,
        courseId: KHOA2,
        status: "ACTIVE",
        finalPrice: 5_000_000,
      },
    });
    await db.payment.create({
      data: {
        id: `${T}pay-a2`,
        orderId: DON,
        enrollmentId: GD_A2,
        amount: 5_000_000,
        method: "BANK_TRANSFER",
        accountantStatus: "CONFIRMED",
        paidDate: new Date("2699-01-06T03:00:00Z"),
        centerId: CENTER,
      },
    });

    const r = await dungSauBuoi20({
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: DU_SAU_BUOI_20 }],
    });
    expect(r.ok, `dừng học hỏng: ${!r.ok ? r.error : ""}`).toBe(true);

    const kq = await db.$transaction(async (tx) =>
      nghiHocHan({
        tx,
        studentId: HS_A,
        actorId: ACTOR.id,
        actorName: ACTOR.name,
        reason: "Học viên nghỉ học: chuyển trường",
        orgUnitId: CENTER,
        // Mốc đóng băng: sau buổi cuối của CẢ HAI lớp (luật 19).
        now: new Date(Date.UTC(2699, 2, 20, 0, 0, 0)),
      }),
    );

    // 1 · THAO TÁC CHẠY ĐƯỢC — đây là toàn bộ điểm của bản sửa.
    // Ghi danh 1 đã WITHDREW từ lượt dừng học nên không còn "sống"; ghi danh 2 rời lớp ở
    // lượt này. Cả hai đều KHÔNG còn nằm trong lớp — đó mới là điều cần khẳng định.
    expect(kq.daGo.map((x) => x.id)).toEqual([GD_A2]);
    for (const id of [GD_A, GD_A2]) {
      const e = await db.enrollment.findUnique({ where: { id }, select: { status: true } });
      expect(e?.status, `ghi danh ${id} phải đã rời lớp`).toBe("WITHDREW");
    }

    // 2 · Ghi danh CÒN LẠI vẫn tính hoàn như cũ.
    const cuaA2 = await db.refundRequest.findMany({ where: { enrollmentId: GD_A2 } });
    expect(cuaA2, "ghi danh chưa quyết toán vẫn phải có đề xuất hoàn").toHaveLength(1);
    expect(cuaA2[0]!.status).toBe("PENDING");

    // 3 · Ghi danh ĐÃ quyết toán: KHÔNG có đề xuất thứ hai.
    expect(await db.refundRequest.count({ where: { enrollmentId: GD_A } })).toBe(0);

    // ⚠️ Và `boQuaHoanTien` ở lượt này RỖNG — đó không phải thiếu sót, đó là phép đo:
    // lượt dừng học đã đẩy ghi danh sang `WITHDREW`, nên nó KHÔNG còn nằm trong
    // `REMOVABLE_ENROLLMENT_STATUSES` và **không bao giờ vào tới vòng lặp tiền**.
    //
    // Nghĩa là con "throw chặn cả thao tác" của bản đầu hiếm khi cắn qua đúng đường này —
    // nhưng "hiếm" không phải "không", và ca `[DHC-09c]` ngay dưới dựng đúng lúc nó cắn.
    expect(kq.boQuaHoanTien).toHaveLength(0);
  });

  it("[DHC-09c] ghi danh đã quyết toán mà bị KÍCH HOẠT LẠI ⇒ bỏ qua phần tiền, KHÔNG im lặng", async () => {
    // Đây là lúc đường bỏ qua thật sự cắn: admin mở `/admin/enrollments/<id>/edit` và đưa
    // ghi danh về `ACTIVE` sau khi nó đã được quyết toán. Ghi danh quay lại tập "còn sống"
    // ⇒ lượt "Nghỉ học hẳn" sau đó sẽ đi qua vòng lặp tiền và gặp một dòng đơn STOPPED.
    //
    // Bản ĐẦU của PHIÊN D ném ở đây và cuốn ngược cả transaction ⇒ **không cho bé nghỉ**.
    // Chủ dự án chốt 21/09: chặn hoàn KÉP, không chặn cho bé nghỉ.
    const r = await dungSauBuoi20({
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: DU_SAU_BUOI_20 }],
    });
    expect(r.ok).toBe(true);
    await db.enrollment.update({ where: { id: GD_A }, data: { status: "ACTIVE" } });

    const kq = await db.$transaction(async (tx) =>
      nghiHocHan({
        tx,
        studentId: HS_A,
        actorId: ACTOR.id,
        actorName: ACTOR.name,
        reason: "Học viên nghỉ học: chuyển trường",
        orgUnitId: CENTER,
        now: new Date(Date.UTC(2699, 2, 20, 0, 0, 0)),
      }),
    );

    // Thao tác CHẠY ĐƯỢC và bé rời lớp.
    expect(kq.daGo.map((x) => x.id)).toEqual([GD_A]);
    expect(
      (await db.enrollment.findUnique({ where: { id: GD_A }, select: { status: true } }))?.status,
    ).toBe("WITHDREW");

    // Không đề xuất hoàn thứ hai — và nói ra vì sao.
    expect(await db.refundRequest.count({ where: { enrollmentId: GD_A } })).toBe(0);
    expect(kq.boQuaHoanTien).toHaveLength(1);
    expect(kq.boQuaHoanTien[0]!.enrollmentId).toBe(GD_A);
    expect(kq.boQuaHoanTien[0]!.lyDo).toContain("Đã quyết toán khi dừng học");
    expect(kq.boQuaHoanTien[0]!.orderCode).toBe("ORD-269905-000001");

    // Vết trong nhật ký — "không có đề xuất hoàn" phải trả lời được "vì sao", kẻo ba tháng
    // sau không ai phân biệt nó với một lượt bỏ sót.
    const vet = await db.auditLog.findFirst({
      where: { entityType: "Enrollment", entityId: GD_A, action: "REFUND_REQUEST_SKIPPED" },
    });
    expect(vet, "phải ghi AuditLog cho lượt bỏ qua").not.toBeNull();
  });

  it("[DHC-10] GHI DANH rời lớp, ngày hiệu lực = NGÀY BUỔI CUỐI (không phải lúc bấm nút)", async () => {
    const r = await dungSauBuoi20({
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: DU_SAU_BUOI_20 }],
    });
    expect(r.ok).toBe(true);

    const gd = await db.enrollment.findUnique({
      where: { id: GD_A },
      select: { status: true, endedAt: true },
    });
    expect(gd?.status).toBe("WITHDREW");
    expect(gd?.endedAt?.toISOString()).toBe(NGAY_BUOI(19).toISOString());
    // Bé B KHÔNG bị đụng tới — dừng học là việc của MỘT dòng đơn.
    expect((await db.enrollment.findUnique({ where: { id: GD_B } }))?.status).toBe("ACTIVE");

    const nhatKy = await db.enrollmentAuditLog.findFirst({ where: { enrollmentId: GD_A } });
    expect(nhatKy?.toStatus).toBe("WITHDREW");
  });

  it("[DHC-11] TRUNG_TAM_HUY ⇒ phí 0, toàn bộ đã thu thành dư", async () => {
    const r = await dungSauBuoi20({
      lyDo: "TRUNG_TAM_HUY",
      phanDu: [{ kieu: "HOAN", soTien: DA_THU }],
    });
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.giaTriDaDung).toBe(0);
    expect(r.chenh).toBe(DA_THU);

    const so = await noTheoCon(DON);
    expect(so.con.find((c) => c.orderItemId === A)?.phaiThu).toBe(0);
    const yc = await db.refundRequest.findFirst({ where: { orderItemId: A } });
    expect(yc?.trigger, "trung tâm huỷ ⇒ trigger CLASS_CANCELLED").toBe("CLASS_CANCELLED");
  });

  it("[DHC-12] khoá CHƯA khai số buổi cam kết ⇒ TỪ CHỐI, không ghi gì", async () => {
    await dungFixture({ soBuoiCamKet: null });
    const r = await dungSauBuoi20();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("chưa khai số buổi cam kết");
    expect(
      (await db.orderItem.findUnique({ where: { id: A }, select: { status: true } }))?.status,
    ).toBe("ACTIVE");
  });

  it("[DHC-13] sửa buổi cuối khác gợi ý mà KHÔNG ghi chú ⇒ CHẶN", async () => {
    const r = await dungSauBuoi20({ buoiCuoiId: BUOI(10), ghiChu: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("ghi chú");
  });

  it("[DHC-14] bấm dừng HAI LẦN ⇒ lần hai bị chặn, không quyết toán chồng", async () => {
    const mot = await dungSauBuoi20({
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: DU_SAU_BUOI_20 }],
    });
    expect(mot.ok).toBe(true);
    const hai = await dungSauBuoi20({
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: DU_SAU_BUOI_20 }],
    });
    expect(hai.ok).toBe(false);
    expect(await db.refundRequest.count({ where: { orderItemId: A } })).toBe(0);
    // Bé B chỉ nhận ĐÚNG MỘT lần.
    const so = await noTheoCon(DON);
    expect(so.con.find((c) => c.orderItemId === B)?.daThu).toBe(DU_SAU_BUOI_20);
  });

  it("[DHC-16] PHIÊN E — đơn có ưu đãi ANH_EM ⇒ CẢNH BÁO, và KHÔNG đồng nào đổi", async () => {
    // Chủ dự án chốt 21/09/2026: *"KHÔNG tự động tăng nợ bé còn lại… Không đổi số tiền
    // nào."* Ca này canh CẢ HAI vế — có cảnh báo, và công nợ bé còn lại y nguyên.
    await db.orderItem.update({
      where: { id: B },
      data: {
        discounts: [
          { kieu: "PHAN_TRAM", giaTri: 15, giam: 1_800_000, lyDo: "con thứ hai", loai: "ANH_EM" },
        ],
        // ⚠️ KHÔNG đụng `discountAmount`: nhãn là nhãn, tiền là tiền. Đặt cả hai trong
        // một ca là ca không còn phân biệt được "nhãn làm đổi tiền" với "fixture đổi tiền".
      },
    });

    const truoc = await noTheoCon(DON);
    const conBTruoc = truoc.con.find((c) => c.orderItemId === B)!;

    const xem = await xemTruocDungHoc({
      orderId: DON,
      orderItemId: A,
      lyDo: "PH_CHU_DONG",
      now: new Date(Date.UTC(2699, 0, 5 + 19 * 7, 23, 0, 0)),
    });
    expect(xem.ok).toBe(true);
    if (!xem.ok) return;
    expect(xem.data.canhBaoUuDaiAnhEm).toContain("Muốn thu hồi, báo QLCS");
    expect(xem.data.dauVetUuDaiAnhEm).toEqual([
      { orderItemId: B, ten: "Bé B DHC", theoNhan: true },
    ]);

    const r = await dungSauBuoi20({
      phanDu: [{ kieu: "CHUYEN", orderItemId: B, soTien: DU_SAU_BUOI_20 }],
    });
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);

    const sau = await noTheoCon(DON);
    const conBSau = sau.con.find((c) => c.orderItemId === B)!;
    // Bé còn lại GIỮ NGUYÊN học phí phải thu. Chỉ `daThu` tăng đúng phần dư vừa chuyển —
    // đó là phép chuyển tiền của PHIÊN D, không phải phép thu hồi ưu đãi.
    expect(conBSau.phaiThu, "phải thu của bé còn lại KHÔNG được đổi").toBe(conBTruoc.phaiThu);
    expect(conBSau.daThu - conBTruoc.daThu).toBe(DU_SAU_BUOI_20);
    const dongB = await db.orderItem.findUnique({
      where: { id: B },
      select: { discountAmount: true, totalPrice: true, status: true },
    });
    expect(dongB?.discountAmount, "giảm giá của bé còn lại y nguyên").toBe(0);
    expect(dongB?.status, "bé còn lại KHÔNG bị dừng theo").toBe("ACTIVE");
  });

  it("[DHC-16b] đơn KHÔNG có ưu đãi anh em ⇒ KHÔNG cảnh báo", async () => {
    const xem = await xemTruocDungHoc({
      orderId: DON,
      orderItemId: A,
      lyDo: "PH_CHU_DONG",
      now: new Date(Date.UTC(2699, 0, 5 + 19 * 7, 23, 0, 0)),
    });
    expect(xem.ok).toBe(true);
    if (!xem.ok) return;
    expect(xem.data.canhBaoUuDaiAnhEm).toBeNull();
    expect(xem.data.dauVetUuDaiAnhEm).toEqual([]);
  });

  it("[DHC-15] XEM TRƯỚC không ghi một dòng nào", async () => {
    const truocDong = await db.orderItem.findUnique({
      where: { id: A },
      select: { status: true, usedValue: true },
    });
    const xem = await xemTruocDungHoc({
      orderId: DON,
      orderItemId: A,
      lyDo: "PH_CHU_DONG",
      now: new Date(Date.UTC(2699, 0, 5 + 19 * 7, 23, 0, 0)),
    });
    expect(xem.ok).toBe(true);
    if (!xem.ok) return;
    expect(xem.data.goiYBuoiCuoiId, "gợi ý = buổi gần nhất đã qua").toBe(BUOI(20));
    expect(xem.data.soBuoiDaDung).toBe(19);
    expect(xem.data.chenh).toBe(DA_THU - 19 * 250_000);
    expect(xem.data.conConLai.map((c) => c.orderItemId)).toEqual([B]);

    const sauDong = await db.orderItem.findUnique({
      where: { id: A },
      select: { status: true, usedValue: true },
    });
    expect(sauDong).toEqual(truocDong);
  });
});
