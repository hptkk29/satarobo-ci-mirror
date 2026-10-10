/**
 * VÒNG ĐỜI PHIẾU THU (PaymentRequest) — 03/08. Postgres LOCAL (.env.test).
 *
 * Hai quyết định của chủ dự án được kiểm ở đây:
 *  QĐ-1 — ⚠️ ĐÃ ĐẢO 03/08 (chủ dự án chốt trong chat). Luật CŨ: "phiếu đợt chỉ ra
 *         đời khi QLCS bấm DUYỆT". Luật MỚI: **bấm Lưu kế hoạch là có phiếu thu +
 *         QR theo đợt NGAY**, vì khách đứng ở quầy không thể chờ người duyệt mới
 *         quét được mã. "Duyệt" nay chỉ còn nghĩa **KHOÁ** kế hoạch lại.
 *  QĐ-2 — phiếu đợt 1 sinh ra ở PENDING, dù sổ CŨ (`OrderInstallment`) vẫn đánh
 *         đợt 1 = PAID. Chỉ tiền THẬT (PaymentAllocation) mới đẩy phiếu sang PAID.
 *
 * Test ở tầng service (mẫu bulk-convert / attendance-edit): Server Action gọi
 * `auth()` nên không chạy được trong runner này ⇒ ca "tạo đơn" gọi thẳng
 * `ensureFullOrderRequest` — đúng thứ `createOrderManualAction` gọi trong tx của nó.
 *
 * Chạy: $env:R7_SKIP_WEBSERVER='1'; pnpm test:e2e:r7 payment-request-lifecycle
 */
import { test, expect } from "@playwright/test";
import type { Prisma, Role } from "@prisma/client";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { scopedDb } from "../../../lib/db-scope";
import {
  ensureFullOrderRequest,
  recomputeRequestStatuses,
  getOrderPaymentRequests,
  paymentMatchKey,
  FULL_ORDER_INSTALLMENT_NO,
} from "../../../lib/payments/payment-request";
import {
  recordInstallmentPlan,
  approveInstallmentPlan,
  rejectInstallmentPlan,
  getOrderInstallments,
} from "../../../lib/orders/installments";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${seq++}`;

async function centerIdOf(code: string): Promise<string> {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function orgIdOf(code: string): Promise<string> {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function roleIdOf(code: string): Promise<string> {
  return (await db.roleDef.findUnique({ where: { code }, select: { id: true } }))!.id;
}

/** Mã đơn thật (ORD-YYMMDD-NNNNNN) — matchKey suy ra từ đây nên phải đúng dạng. */
function orderCode(n: number): string {
  return `ORD-260803-${String(n).padStart(6, "0")}`;
}

async function makeOrder(total: number, centerId: string | null, n: number) {
  return db.order.create({
    data: {
      code: orderCode(n),
      type: "COURSE",
      customerName: "PH Phiếu thu",
      customerPhone: "0900000001",
      totalAmount: total,
      status: "PENDING_PAYMENT",
      centerId,
    },
    select: { id: true, code: true, totalAmount: true, centerId: true },
  });
}

/** Đúng thứ createOrderManualAction làm trong transaction tạo đơn. */
async function createOrderWithRequest(total: number, centerId: string | null, n: number) {
  const order = await makeOrder(total, centerId, n);
  await db.$transaction(async (tx) => {
    await ensureFullOrderRequest(tx as unknown as Prisma.TransactionClient, order);
  });
  return order;
}

async function requestsOf(orderId: string) {
  return db.paymentRequest.findMany({
    where: { orderId },
    orderBy: { installmentNo: "asc" },
  });
}

/** Tiền THẬT về: 1 giao dịch ngân hàng + 1 dòng phân bổ vào phiếu chỉ định. */
async function allocate(paymentRequestId: string, amount: number, centerId: string | null) {
  const txn = await db.bankTransaction.create({
    data: {
      provider: "PAYOS",
      providerTxnId: `TXN-${uniq()}`,
      amount,
      transferredAt: new Date(),
      status: "MATCHED",
      centerId,
    },
    select: { id: true },
  });
  await db.paymentAllocation.create({
    data: { bankTransactionId: txn.id, paymentRequestId, amount, centerId },
  });
}

async function recompute(orderId: string) {
  await db.$transaction(async (tx) => {
    await recomputeRequestStatuses(tx as unknown as Prisma.TransactionClient, orderId);
  });
}

async function makeUser(slug: string, orgCode: string, roleCode: string, primaryRole: Role) {
  const u = await seedUser({ email: testEmail(slug, uniq()), role: primaryRole });
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgIdOf(orgCode),
    roleId: await roleIdOf(roleCode),
    reason: "seed phiếu thu",
  });
  return u;
}

test.describe("[PR] Vòng đời phiếu thu — duyệt trả góp mới sinh phiếu đợt", () => {
  let cs1 = "";
  let cs2 = "";
  /** Người duyệt: v1 matrix cho CENTER_MANAGER quyền installments:approve. */
  let approver: { id: string; name: string; role: Role };

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: `cs1-${uniq()}`, address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: `cs2-${uniq()}`, address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    cs1 = await centerIdOf("CS1");
    cs2 = await centerIdOf("CS2");
    const u = await seedUser({ email: testEmail("qlcs", uniq()), role: "CENTER_MANAGER", name: "QL Cơ sở" });
    approver = { id: u.id, name: "QL Cơ sở", role: "CENTER_MANAGER" };
  });

  // ───────────────────────────────────────────────────────────────────────────
  test("[PR-01] tạo đơn → đúng 1 phiếu thu toàn đơn (installmentNo=0) = tổng đơn", async () => {
    const order = await createOrderWithRequest(10_000_000, cs1, 1);

    const rows = await requestsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].installmentNo).toBe(FULL_ORDER_INSTALLMENT_NO);
    expect(rows[0].amountDue).toBe(10_000_000);
    expect(rows[0].sortOrder).toBe(0);
    expect(rows[0].status).toBe("PENDING");
    expect(rows[0].centerId).toBe(cs1);
    expect(rows[0].matchKey).toBe("ORD260803000001D0");

    // Idempotent: gọi lại KHÔNG nhân đôi.
    await db.$transaction(async (tx) => {
      await ensureFullOrderRequest(tx as unknown as Prisma.TransactionClient, order);
    });
    expect(await requestsOf(order.id)).toHaveLength(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  test("[PR-02] lưu kế hoạch 2 đợt (CHƯA duyệt) → CÓ NGAY 2 phiếu đợt + phiếu toàn đơn VOID", async () => {
    // Luật MỚI 03/08 (đảo QĐ-1): không bắt khách chờ duyệt mới quét được QR.
    const order = await createOrderWithRequest(10_000_000, cs1, 20);
    const res = await recordInstallmentPlan({
      orderId: order.id,
      dot1Amount: 6_000_000,
      dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-09-01"),
      actorId: approver.id,
    });
    expect(res.ok).toBe(true);

    // ⚠️ ĐẢO 14/09/2026 — ca này TRƯỚC ĐÂY khẳng định đơn mang `PENDING_APPROVAL`.
    // Chủ dự án chốt BỎ cơ chế duyệt đơn hàng, nên khối sinh cờ đó ở
    // `lib/orders/installments.ts` đã gỡ: lưu kế hoạch KHÔNG còn đẩy đơn vào hàng chờ.
    // Cột giữ trong schema cho dữ liệu cũ, chỉ không có đường ghi mới.
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.installmentApprovalStatus).toBeNull();

    // Phần CÒN LẠI của ca này vẫn là luật sống và phải giữ: phiếu thu theo đợt có NGAY,
    // đúng số tiền, và phiếu "thu toàn đơn" bị VOID.
    const rows = await requestsOf(order.id);
    const dots = rows.filter((r) => r.installmentNo > 0);
    expect(dots).toHaveLength(2);
    expect(dots.map((d) => d.amountDue)).toEqual([6_000_000, 4_000_000]);
    expect(dots.every((d) => d.status === "PENDING")).toBe(true);
    expect(rows.find((r) => r.installmentNo === 0)!.status).toBe("VOID");
  });

  // ───────────────────────────────────────────────────────────────────────────
  test("[PR-02b] sửa kế hoạch trước khi duyệt → phiếu đổi số tiền VÀ mã QR đang sống bị hết hạn", async () => {
    // Lỗi chủ dự án báo 03/08: "sửa giá / sửa 2 đợt nhưng QR không nhảy theo".
    // QrSession.amountShown là ảnh chụp số tiền lúc xuất mã ⇒ không hết hạn phiên cũ
    // thì khách quét mã in số CŨ.
    const order = await createOrderWithRequest(10_000_000, cs1, 21);
    await recordInstallmentPlan({
      orderId: order.id, dot1Amount: 6_000_000, dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-09-01"), actorId: approver.id,
    });
    const dot1 = (await requestsOf(order.id)).find((r) => r.installmentNo === 1)!;

    // Sale đã xuất QR cho đợt 1 với số tiền 6tr.
    await db.qrSession.create({
      data: {
        paymentRequestId: dot1.id,
        centerId: cs1,
        amountShown: 6_000_000,
        qrContent: "https://img.vietqr.io/x.png",
        expiresAt: new Date(Date.now() + 30 * 60_000),
        status: "ACTIVE",
      },
    });

    // Đổi kế hoạch: 6tr/4tr → 3tr/7tr.
    const again = await recordInstallmentPlan({
      orderId: order.id, dot1Amount: 3_000_000, dot2Amount: 7_000_000,
      dot2DueDate: new Date("2026-10-01"), actorId: approver.id,
    });
    expect(again.ok).toBe(true);

    const after = (await requestsOf(order.id)).filter((r) => r.installmentNo > 0);
    expect(after.map((d) => d.amountDue)).toEqual([3_000_000, 7_000_000]);

    // Mã cũ KHÔNG được còn sống.
    const live = await db.qrSession.count({
      where: { paymentRequestId: dot1.id, status: "ACTIVE" },
    });
    expect(live).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⚠️ VIẾT LẠI 14/09/2026. Ca cũ là "[PR-02c] DUYỆT = KHOÁ: kế hoạch đã duyệt thì
  // không sửa được nữa". Cơ chế duyệt đã bỏ theo chốt của chủ dự án, nên khoá đó không
  // còn cửa nào để bám — NHƯNG thứ nó bảo vệ vẫn thật: phiếu thu và mã QR đã phát cho
  // khách bám theo kế hoạch, sửa sau lưng là tiền về một đằng sổ ghi một nẻo.
  //
  // Khoá MỚI hỏi TIỀN chứ không hỏi ai đã bấm duyệt: cổng R-02 (`keHoachLamMatTien`).
  // Nó CHẶT HƠN khoá cũ — cờ duyệt có thể chưa ai bấm trong khi tiền đã về.
  test("[PR-02c] lượt sửa bị TỪ CHỐI vẫn không làm phiếu VOID, không mất đồng nào", async () => {
    const order = await createOrderWithRequest(10_000_000, cs1, 22);
    await recordInstallmentPlan({
      orderId: order.id, dot1Amount: 6_000_000, dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-09-01"), actorId: approver.id,
    });

    // Khách chuyển tiền vào phiếu đợt 1 — từ đây kế hoạch không còn là nháp.
    // Dùng helper `allocate` của chính spec này: nó dựng cả BankTransaction (cột bắt
    // buộc) nên đường đi giống tiền thật về, không phải một dòng phân bổ mồ côi.
    const dot1Before = (await requestsOf(order.id)).find((r) => r.installmentNo === 1)!;
    await allocate(dot1Before.id, 6_000_000, cs1);

    // ⚠️ SỬA 17/09/2026 — ca này ĐỎ TRÊN CI và nó MÂU THUẪN THẲNG với `[PR-02d]` ngay
    // dưới. Bản cũ kỳ vọng `ok: true` kèm một khối chú thích dài giải thích vì sao "đi qua
    // được mà KHÔNG phải lỗ hổng". Khối ấy viết ngày 14/09; ngày 15/09 lỗ ĐƯỢC VÁ
    // (`doiTienDotDaThu` trong `plan-money-guard.ts`) và `[PR-02d]` được gỡ ghim với kỳ
    // vọng NGƯỢC LẠI: lượt lưu bị TỪ CHỐI. Ca này thì không ai sửa theo.
    //
    // Hai ca test nói ngược nhau về CÙNG một thao tác tiền là thứ tệ hơn thiếu ca: người
    // đọc sau sẽ tin ca nào đang xanh.
    //
    // Nay ca này giữ đúng phần RIÊNG của nó — những bất biến mà `[PR-02d]` không kiểm:
    // phiếu đang giữ tiền không bị VOID, và không đồng nào rơi khỏi sổ phân bổ khi lượt
    // lưu bị từ chối và transaction rollback.
    const sua = await recordInstallmentPlan({
      orderId: order.id, dot1Amount: 1_000_000, dot2Amount: 9_000_000,
      dot2DueDate: new Date("2026-11-01"), actorId: approver.id,
    });
    expect(sua.ok, "sửa số tiền của đợt ĐÃ THU phải bị từ chối — xem [PR-02d]").toBe(false);
    if (!sua.ok) {
      expect(sua.error).toContain("đã nhận");
    }

    // BẤT BIẾN GIỮ ĐƯỢC: phiếu đang giữ tiền KHÔNG bị VOID, và tiền vẫn còn nguyên
    // trong sổ phân bổ — không đồng nào rơi khỏi đơn.
    const sau = await requestsOf(order.id);
    const dot1Sau = sau.find((r) => r.id === dot1Before.id);
    expect(dot1Sau, "phiếu đang giữ tiền bị xoá mất").toBeTruthy();
    expect(dot1Sau!.status).not.toBe("VOID");

    const tongRot = await db.paymentAllocation.aggregate({
      where: { paymentRequest: { orderId: order.id } },
      _sum: { amount: true },
    });
    expect(tongRot._sum.amount).toBe(6_000_000);
  });

  // ⚠️ GHIM NỢ ĐO ĐƯỢC 14/09/2026 — `test.fail` nghĩa là: HÔM NAY ca này ĐỎ, và vì đã
  // ghim nên CI vẫn xanh. Vá xong thì nó CHUYỂN SANG XANH và Playwright báo lỗi
  // "expected to fail" — buộc người vá gỡ ghim. Đừng đổi thành `test.skip`: skip là
  // quên, ghim là hẹn.
  //
  // LỖ: `materializeInstallmentRequests` THA VOID cho phiếu đang có phân bổ
  // (`allocated > 0 → continue`) nhưng KHÔNG tha việc GHI ĐÈ `amountDue`. Đo thật:
  // phiếu đợt 1 đang giữ 6.000.000đ đã rót, sửa kế hoạch xuống 1.000.000đ thì
  // `amountDue` thành 1.000.000đ ⇒ phiếu hoá "thu vượt 5.000.000đ" và số còn-phải-thu
  // của đơn sai theo.
  //
  // A6: "KHÔNG sửa `amountDue` của phiếu đã có allocation. VOID + tạo phiếu mới."
  //
  // ✅ ĐÃ GỠ GHIM [15/09/2026]. Cổng nằm ở `doiTienDotDaThu` (plan-money-guard.ts), cắm
  // trong vòng UPSERT của `materializeInstallmentRequests` — MỘT chỗ che cả ba đường gọi
  // (`installments.ts:332`, `:500`, `crm/backfill-order.ts:153`), vì vá ở đường gọi là vá
  // một cửa rồi để hai cửa mở.
  //
  // ⚠️ KỲ VỌNG CỦA CA NÀY ĐÃ ĐỔI, và đổi có chủ đích. Bản ghim cũ kỳ vọng lượt lưu thứ
  // hai THÀNH CÔNG và `amountDue` âm thầm ở lại 6tr. Giữ im lặng như vậy đẻ ra
  // split-brain: `OrderInstallment` ghi 1tr còn `PaymentRequest` giữ 6tr — hai sổ nói hai
  // số cho cùng một đợt và KHÔNG AI được báo. Nay lượt lưu bị TỪ CHỐI, cả transaction
  // rollback, nên không sổ nào lệch và người bấm nút biết ngay.
  test("[PR-02d] TỪ CHỐI sửa amountDue của phiếu đã có tiền rót vào (A6)", async () => {
    const order = await createOrderWithRequest(10_000_000, cs1, 23);
    await recordInstallmentPlan({
      orderId: order.id, dot1Amount: 6_000_000, dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-09-01"), actorId: approver.id,
    });
    const dot1 = (await requestsOf(order.id)).find((r) => r.installmentNo === 1)!;
    await allocate(dot1.id, 6_000_000, cs1);

    // Đổi số của ĐỢT ĐÃ THU ⇒ phải bị chặn, và câu chặn phải nêu SỐ TIỀN đang bị đe doạ.
    const kq = await recordInstallmentPlan({
      orderId: order.id, dot1Amount: 1_000_000, dot2Amount: 9_000_000,
      dot2DueDate: new Date("2026-11-01"), actorId: approver.id,
    });
    expect(kq.ok).toBe(false);
    expect(kq.error ?? "").toContain("6.000.000");

    // Và sổ KHÔNG lệch một đồng: phiếu giữ nguyên, kế hoạch cũng không bị ghi nửa vời.
    const dot1Sau = (await requestsOf(order.id)).find((r) => r.id === dot1.id)!;
    expect(dot1Sau.amountDue).toBe(6_000_000);
  });

  // Nửa còn lại của A6, và là luồng THẬT mà chủ dự án mô tả 15/09: "chỉ cho sửa các đợt
  // sau đó với số tiền còn thiếu". Không có ca này thì cổng trên có thể được cài quá
  // rộng (chặn mọi lượt lưu khi đơn đã có tiền) mà vẫn xanh — tức khoá cứng màn đơn.
  test("[PR-02e] VẪN sửa được đợt CHƯA thu khi đợt trước đã thu (A6, nửa cho-qua)", async () => {
    const order = await createOrderWithRequest(10_000_000, cs1, 24);
    await recordInstallmentPlan({
      orderId: order.id, dot1Amount: 6_000_000, dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-09-01"), actorId: approver.id,
    });
    const dot1 = (await requestsOf(order.id)).find((r) => r.installmentNo === 1)!;
    await allocate(dot1.id, 6_000_000, cs1);

    // Đợt 1 giữ NGUYÊN số (6tr — đúng như màn hình khoá lại), chỉ đổi hạn + số đợt 2.
    const kq = await recordInstallmentPlan({
      orderId: order.id, dot1Amount: 6_000_000, dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-12-01"), actorId: approver.id,
    });
    expect(kq.ok).toBe(true);

    const sau = await requestsOf(order.id);
    expect(sau.find((r) => r.id === dot1.id)!.amountDue).toBe(6_000_000);
    const dot2 = sau.find((r) => r.installmentNo === 2)!;
    expect(dot2.amountDue).toBe(4_000_000);
    expect(dot2.dueDate?.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  test("[PR-03] lưu kế hoạch → sinh đúng 2 phiếu đợt, phiếu toàn đơn VOID, matchKey ORD…D1/D2", async () => {
    const order = await createOrderWithRequest(10_000_000, cs1, 3);
    await recordInstallmentPlan({
      orderId: order.id,
      dot1Amount: 6_000_000,
      dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-09-01"),
      actorId: approver.id,
    });

    // ⚠️ 14/09/2026 — bỏ bước `approveInstallmentPlan`: cơ chế duyệt đã gỡ, và phiếu
    // theo đợt vốn đã sinh NGAY lúc lưu kế hoạch (đảo QĐ-1 từ 03/08). Mọi khẳng định
    // bên dưới — matchKey D1/D2, phiếu toàn đơn VOID, sortOrder, centerId — là luật
    // SỐNG và giữ nguyên.
    const rows = await requestsOf(order.id);
    expect(rows).toHaveLength(3);

    const full = rows.find((r) => r.installmentNo === 0)!;
    expect(full.status).toBe("VOID");

    const dot1 = rows.find((r) => r.installmentNo === 1)!;
    const dot2 = rows.find((r) => r.installmentNo === 2)!;
    expect(dot1.amountDue).toBe(6_000_000);
    expect(dot2.amountDue).toBe(4_000_000);
    expect(dot1.sortOrder).toBe(1);
    expect(dot2.sortOrder).toBe(2);
    expect(dot2.dueDate?.toISOString()).toBe(new Date("2026-09-01").toISOString());
    expect(dot1.matchKey).toBe("ORD260803000003D1");
    expect(dot2.matchKey).toBe("ORD260803000003D2");
    expect(dot1.matchKey).toBe(paymentMatchKey(order.code, 1));
    expect(dot1.centerId).toBe(cs1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⚠️ VIẾT LẠI 14/09/2026. Ca cũ là "duyệt lại lần 2 → idempotent". Không còn khâu
  // duyệt để bấm lại, nhưng thứ ca này bảo vệ vẫn thật và nay còn dễ xảy ra hơn: LƯU
  // KẾ HOẠCH LẦN HAI (sale sửa số rồi bấm lại) không được đẻ phiếu thu thứ hai —
  // matchKey là định danh đối khớp tiền về, sinh phiếu mới là tiền khách chuyển không
  // khớp vào đâu.
  test("[PR-04] lưu kế hoạch lần 2 (cùng số) → idempotent, vẫn đúng 2 phiếu đợt", async () => {
    const order = await createOrderWithRequest(10_000_000, cs1, 4);
    const lan1 = {
      orderId: order.id,
      dot1Amount: 6_000_000,
      dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-09-01"),
      actorId: approver.id,
    };
    await recordInstallmentPlan(lan1);
    const idsAfterFirst = (await requestsOf(order.id)).map((r) => r.id).sort();

    const again = await recordInstallmentPlan(lan1);
    expect(again.ok).toBe(true);

    const rows = await requestsOf(order.id);
    expect(rows.filter((r) => r.installmentNo > 0)).toHaveLength(2);
    expect(rows).toHaveLength(3);
    // Cùng phiếu, không phải phiếu mới → matchKey (định danh đối khớp) giữ nguyên.
    expect(rows.map((r) => r.id).sort()).toEqual(idsAfterFirst);
  });

  // ───────────────────────────────────────────────────────────────────────────
  test("[PR-05] QĐ-2: phiếu đợt 1 sinh ra ở PENDING dù OrderInstallment đợt 1 = PAID", async () => {
    const order = await createOrderWithRequest(10_000_000, cs1, 5);
    await recordInstallmentPlan({
      orderId: order.id,
      dot1Amount: 6_000_000,
      dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-09-01"),
      actorId: approver.id,
    });
    await approveInstallmentPlan({ orderId: order.id, actor: approver });

    // Sổ CŨ giữ nguyên hành vi (không phá công nợ đang chạy)…
    const old = await getOrderInstallments(order.id);
    expect(old.find((i) => i.soDot === 1)!.status).toBe("PAID");

    // …sổ MỚI theo luật mới: chưa có đồng nào về ⇒ PENDING.
    const views = await getOrderPaymentRequests(order.id);
    const dot1 = views.find((v) => v.installmentNo === 1)!;
    expect(dot1.status).toBe("PENDING");
    expect(dot1.allocated).toBe(0);
    expect(dot1.outstanding).toBe(6_000_000);
    expect(views.find((v) => v.installmentNo === 2)!.status).toBe("PENDING");
  });

  // ───────────────────────────────────────────────────────────────────────────
  test("[PR-06] từ chối kế hoạch sau khi đã duyệt → phiếu đợt VOID, phiếu toàn đơn sống lại", async () => {
    const order = await createOrderWithRequest(10_000_000, cs1, 6);
    await recordInstallmentPlan({
      orderId: order.id,
      dot1Amount: 6_000_000,
      dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-09-01"),
      actorId: approver.id,
    });
    // ⚠️ 14/09/2026 — `approveInstallmentPlan`/`rejectInstallmentPlan` nay CHỈ chạy được
    // trên đơn ĐÃ CÓ cờ duyệt, vì đường sinh cờ đã gỡ cùng cơ chế duyệt. Hai hàm được
    // GIỮ có chủ đích cho DỮ LIỆU CŨ (`applyInstallmentApproval` là đường ghi bù Ledger-A
    // duy nhất cho đơn sinh dưới luật cũ), nên ca này nay khoá đúng đường đó: đặt cờ
    // thủ công để mô phỏng một đơn cũ, rồi từ chối.
    //
    // Hành vi được khoá vẫn SỐNG và quan trọng: `revertInstallmentRequests` VOID phiếu
    // theo đợt rồi HỒI SINH phiếu "thu toàn đơn" — đó là thứ `isInstallmentPlanActive`
    // dựa vào khi nó loại `REJECTED`, và là lý do hàm đó chưa được xoá.
    await db.order.update({
      where: { id: order.id },
      data: { installmentApprovalStatus: "APPROVED" },
    });

    const rej = await rejectInstallmentPlan({
      orderId: order.id,
      actor: approver,
      reason: "Khách đổi ý, đóng 1 lần",
    });
    expect(rej.ok).toBe(true);

    const rows = await requestsOf(order.id);
    expect(rows.filter((r) => r.installmentNo > 0).every((r) => r.status === "VOID")).toBe(true);
    const full = rows.find((r) => r.installmentNo === 0)!;
    expect(full.status).toBe("PENDING");
    expect(full.amountDue).toBe(10_000_000);
    // Vẫn đúng 3 dòng — hồi sinh chứ không đẻ phiếu toàn đơn thứ hai.
    expect(rows).toHaveLength(3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  test("[PR-07] recomputeRequestStatuses: PENDING → PARTIAL → PAID theo sổ phân bổ; đủ hết → đơn CONFIRMED", async () => {
    const order = await createOrderWithRequest(10_000_000, cs1, 7);
    await recordInstallmentPlan({
      orderId: order.id,
      dot1Amount: 6_000_000,
      dot2Amount: 4_000_000,
      dot2DueDate: new Date("2026-09-01"),
      actorId: approver.id,
    });
    await approveInstallmentPlan({ orderId: order.id, actor: approver });
    const rows = await requestsOf(order.id);
    const dot1 = rows.find((r) => r.installmentNo === 1)!;
    const dot2 = rows.find((r) => r.installmentNo === 2)!;

    // Rót thiếu → PARTIAL (KHÔNG từ chối vì lệch tiền).
    await allocate(dot1.id, 2_000_000, cs1);
    await recompute(order.id);
    let views = await getOrderPaymentRequests(order.id);
    expect(views.find((v) => v.installmentNo === 1)!.status).toBe("PARTIAL");
    expect(views.find((v) => v.installmentNo === 1)!.outstanding).toBe(4_000_000);

    // Rót nốt → PAID. Đơn chưa đủ (còn đợt 2) nên chưa CONFIRMED.
    await allocate(dot1.id, 4_000_000, cs1);
    await recompute(order.id);
    views = await getOrderPaymentRequests(order.id);
    expect(views.find((v) => v.installmentNo === 1)!.status).toBe("PAID");
    expect(views.find((v) => v.installmentNo === 1)!.outstanding).toBe(0);
    expect(views.find((v) => v.installmentNo === 2)!.status).toBe("PENDING");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "PENDING_PAYMENT",
    );

    // Đóng nốt đợt 2 → mọi phiếu còn sống đều PAID ⇒ rollup lên Order.
    await allocate(dot2.id, 4_000_000, cs1);
    await recompute(order.id);
    views = await getOrderPaymentRequests(order.id);
    expect(views.find((v) => v.installmentNo === 2)!.status).toBe("PAID");
    // Phiếu toàn đơn đã VOID thì đứng ngoài phép tính "đơn đã đủ chưa".
    expect(views.find((v) => v.installmentNo === 0)!.status).toBe("VOID");
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.paidAt).not.toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  test("[PR-08] cách ly cơ sở: phiếu thu mang centerId của đơn — actor CS1 không đọc được phiếu CS2", async () => {
    const o1 = await createOrderWithRequest(5_000_000, cs1, 8);
    const o2 = await createOrderWithRequest(7_000_000, cs2, 9);
    const r1 = (await requestsOf(o1.id))[0];
    const r2 = (await requestsOf(o2.id))[0];
    expect(r1.centerId).toBe(cs1);
    expect(r2.centerId).toBe(cs2);

    const u = await makeUser("qllop-cs1", "CS1", "CENTER_CLASS_MANAGER", "SALES_CSM");
    const actor = await resolveActorUncached(u.id);
    const sdb = scopedDb(actor);

    expect(await sdb.paymentRequest.findUnique({ where: { id: r1.id } })).not.toBeNull();
    expect(await sdb.paymentRequest.findUnique({ where: { id: r2.id } })).toBeNull();

    const visible = await sdb.paymentRequest.findMany({ select: { id: true, centerId: true } });
    expect(visible.map((v) => v.id)).toContain(r1.id);
    expect(visible.map((v) => v.id)).not.toContain(r2.id);
  });
});
