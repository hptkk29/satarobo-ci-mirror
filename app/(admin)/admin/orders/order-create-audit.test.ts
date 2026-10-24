// @vitest-environment node
/**
 * S-6 (a) — TẠO đơn hàng phải để lại vết trong nhật ký hợp nhất.
 *
 * Hiện trạng đo được: `createOrderManualAction` KHÔNG ghi `AuditLog` dòng nào.
 * Mọi lượt đổi đơn về sau thì có — `changeOrderStatusAction` ghi
 * `OrderStatusHistory`, duyệt/từ chối giảm giá ghi `writeAudit`, ghi nhận tiền
 * ghi `writeAudit` — nhưng cái ĐẦU TIÊN, nơi con số tiền được ấn định
 * (subtotal / giảm giá / tổng), thì trống.
 *
 * Hậu quả là thứ chỉ lộ ra lúc tranh chấp: khách kêu "tôi được giảm 500k",
 * người bán bảo "không", còn hệ thống chỉ có giá trị HIỆN TẠI của đơn cộng lịch
 * sử TRẠNG THÁI — không ai trả lời được đơn ra đời với con số nào, do ai, lúc
 * nào, từ máy nào. `Order.createdAt` + `discountRequestedById` là mảnh vụn, và
 * `orders:create` nay mở cho cả Sale (G-A) nên số người chạm vào đã tăng.
 *
 * Ba điều test khoá lại:
 *   1. có vết, đúng module/thực thể/hành động để viewer hợp nhất lọc ra được;
 *   2. vết mang đủ con số tiền + đường nối (lead/con/khách) — vết không có số
 *      tiền thì đúng bằng không có vết trong một cuộc tranh chấp;
 *   3. vết nằm TRONG CÙNG transaction với đơn. Ghi ngoài rồi nuốt lỗi thì đơn
 *      vẫn ra đời mà vết mất — đúng lỗi đã phải vá ở `updateLeadFields` (V-6).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
  transaction: vi.fn(),
  orderCreate: vi.fn(),
  paymentMethodFindUnique: vi.fn(),
  leadFindFirst: vi.fn(),
  writeAudit: vi.fn(),
  ensureFullOrderRequest: vi.fn(),
  generateOrderCode: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({
  // 16/09/2026 — bản `main` của `actions.ts` dùng `unstable_cache`; mock thiếu nó là
  // cả tệp test chết ngay lúc nạp, không phải một ca đỏ.
  unstable_cache: <T,>(fn: T) => fn, revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: vi.fn(() => ({
    lead: { findFirst: h.leadFindFirst },
    paymentMethod: { findUnique: h.paymentMethodFindUnique },
    product: { findUnique: vi.fn() },
    order: { findUnique: vi.fn(), findMany: vi.fn() },
    // 🔴 LẠI ĐÚNG LỚP LỖI ẤY, LẦN THỨ BA — 28/09/2026.
    //
    // `createOrderManualAction` nay đọc MÃ cơ sở của đơn để xét phạm vi chương trình
    // khuyến mãi (`sdb.center.findUnique`). Thiếu mock ⇒ `Cannot read properties of
    // undefined (reading 'findUnique')`, và cả năm ca đỏ với thông báo KHÔNG nhắc gì
    // tới audit lẫn khuyến mãi.
    //
    // Trả `code: null` là mặc định AN TOÀN cho bộ này: đơn không có mã cơ sở ⇒
    // `phamViCoSo` rỗng ⇒ chỉ chương trình toàn hệ thống mới qua. Bộ ca này không khai
    // khuyến mãi nào nên nhánh đó không chạy; ca nào cần phạm vi thật thì tự ghi đè.
    center: { findUnique: vi.fn(async () => ({ code: null })) },
    $transaction: h.transaction,
  })),
}));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/audit/headers", () => ({
  getRequestMetadata: vi.fn(async () => ({ ip: "1.2.3.4", userAgent: "vitest" })),
}));
vi.mock("@/lib/audit/log", () => ({
  getAuditActor: vi.fn(() => ({ actorId: "u-sale", actorName: "Sale CS1" })),
}));
vi.mock("@/lib/orders/code", () => ({
  generateOrderCode: h.generateOrderCode,
  withUniqueRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));
vi.mock("@/lib/orders/installments", () => ({
  recordInstallmentPlan: vi.fn(),
  markInstallmentPaid: vi.fn(),
}));
// 🔴 PHỤ THUỘC DB DO LƯỢT GỘP MANG SANG (18/09/2026) — không nhánh nào tự bắt được.
//
// Bộ ca này do nhánh `test` viết, và `_actions.ts` bên `test` KHÔNG đọc cấu hình vận
// hành. Nhánh `main` thì có: `getSetting("orders.maxDiscountPercent")` cho trần % giảm
// giá theo dòng. Gộp hai bên lại là bộ ca cũ gặp lời gọi DB mới — mà job `Unit tests`
// của CI **không dựng Postgres**.
//
// ⚠️ TRIỆU CHỨNG RẤT DỄ ĐỌC NHẦM: ở máy có Postgres chạy sẵn thì `getSetting` thành
// công và CẢ NĂM ca XANH; trên CI thì `db.systemSetting.findUnique` ném và cả năm ca
// ĐỎ — nhưng thông báo lỗi nói về Prisma, không nói gì về audit, nên trông như hạ tầng
// hỏng chứ không như thiếu một mock. Tái hiện đúng CI bằng cách trỏ `DATABASE_URL` vào
// cổng không có ai nghe, đừng tin lượt chạy ở máy mình.
//
// Mock trả ĐÚNG mặc định trong `lib/settings/registry.ts` — không bịa số, để ngày ai đó
// đổi mặc định thì chỗ này còn đối chiếu được.
//
// ⚠️ TRẢ THEO KEY, không trả một số cho mọi key [23/09/2026]. Bản cũ trả 50 cho tất cả, đúng
// khi hàm chỉ đọc `orders.maxDiscountPercent`. Nay nó đọc thêm hai trần ngưỡng duyệt, và
// "50 đợt tối đa" là một fixture nói dối: nó làm mọi kế hoạch lọt cổng, nên ca test sẽ xanh
// vì lý do sai. Dữ liệu tròn trịa trong test là dữ liệu không kiểm được gì (luật đọc số).
vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (key: string) =>
    key === "orders.maxInstallments" ? 4 : key === "orders.maxDiscountItems" ? 1 : 50,
  ),
}));
// ⚠️ `orgUnitIdForCenter` là lời gọi DB. Thiếu mock ⇒ `PrismaClientInitializationError`, và
// thông báo lỗi nói về Prisma chứ KHÔNG nói gì về audit — đúng sự cố 18/09/2026 đã ghi ở
// `.claude/rules/prisma-db.md` ("bộ ca cũ × lời gọi DB mới"), lần này cùng tệp test ấy.
// Job `Unit tests` của CI KHÔNG dựng Postgres, nên lỗ này chỉ lộ khi chạy đúng cách:
//   DATABASE_URL='…@127.0.0.1:59999/khong_ton_tai' pnpm test:unit -- --run
vi.mock("@/lib/org/org-service", () => ({
  orgUnitIdForCenter: vi.fn(async () => "org-cs1"),
}));
vi.mock("@/lib/parents/provision", () => ({ ensureParentAccountForOrder: vi.fn() }));
vi.mock("@/lib/finance/payment", () => ({ ensureOrderPaymentRecorded: vi.fn() }));
vi.mock("@/lib/payments/payment-request", () => ({
  ensureFullOrderRequest: h.ensureFullOrderRequest,
}));
vi.mock("@/lib/email/trigger", () => ({ sendEmailForTrigger: vi.fn(async () => undefined) }));
vi.mock("@/lib/notify/order", () => ({ notifyOrderByZnsIfNoEmail: vi.fn() }));
vi.mock("@/lib/email/render", () => ({ renderTemplate: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));

import { createOrderManualAction } from "./_actions";

/** Đơn khoá học tối thiểu, hợp lệ với `orderCreateManualSchema`. */
const DON = {
  type: "COURSE" as const,
  status: "PENDING_PAYMENT" as const,
  customerName: "Nguyễn Văn A",
  customerPhone: "0905123456",
  customerEmail: "a@example.com",
  leadId: "lead-1",
  centerId: "cs1",
  paymentMethodId: "pm-1",
  items: [
    {
      type: "COURSE_ENROLLMENT" as const,
      itemName: "Lập trình Robot Sata 1",
      quantity: 1,
      unitPrice: 5_000_000,
      // Giảm giá khai theo TỪNG DÒNG từ 14/09/2026 (`items[].discounts`). Khuôn cũ ở
      // cấp ĐƠN bị Zod từ chối CÓ TIẾNG — cố ý, để một người gọi cũ không mất tiền im
      // lặng. Fixture đi theo cổng, không nới cổng cho fixture.
      discounts: [
        { kieu: "SO_TIEN" as const, giaTri: 500_000, lyDo: "Ưu đãi anh chị em nội bộ" },
      ],
    },
  ],
  shippingFee: 0,
};

/** Tx giả — nhận diện được bằng tham chiếu, để khẳng định audit ghi TRONG nó. */
let txGia: Record<string, unknown>;

const veAudit = () => h.writeAudit.mock.calls[0]?.[0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale", name: "Sale CS1" } });
  // Có cả `orders:manage` ⇒ bỏ qua nhánh chủ-lead, test tập trung vào cái vết.
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue({ userId: "u-sale" });
  h.passesScope.mockReturnValue(true);
  h.leadFindFirst.mockResolvedValue({
    id: "lead-1",
    assignedToId: "u-sale",
    centerId: "cs1",
    children: [{ id: "child-1", leadId: "lead-1" }],
  });
  h.paymentMethodFindUnique.mockResolvedValue({
    id: "pm-1",
    name: "Tiền mặt",
    isActive: true,
    canBuyCourse: true,
    canBuyPackage: true,
    canBuyExam: true,
    canBuyProduct: true,
  });
  h.generateOrderCode.mockResolvedValue("DH2608270001");
  h.orderCreate.mockResolvedValue({ id: "ord-1", code: "DH2608270001" });
  h.ensureFullOrderRequest.mockResolvedValue(undefined);
  h.writeAudit.mockResolvedValue({ id: "audit-1" });
  txGia = {
    order: { create: h.orderCreate, update: vi.fn() },
    product: { update: vi.fn() },
    productMovement: { create: vi.fn() },
    paymentRequest: { updateMany: vi.fn() },
  };
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txGia));
});

describe("[S-6a] createOrderManualAction — vết audit khi tạo đơn", () => {
  it("tạo đơn thành công → ghi ĐÚNG MỘT dòng audit đơn hàng", async () => {
    const res = await createOrderManualAction(DON);

    expect(res.ok).toBe(true);
    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    expect(veAudit()).toMatchObject({
      // 16/09/2026 — nhánh `main` xếp vết tạo đơn vào module "orders" (không phải
      // "finance"). Đổi theo `main`: màn xem nhật ký kiểm toán bên đó lọc theo tên này.
      module: "orders",
      entityType: "Order",
      entityId: "ord-1",
      action: "CREATE",
    });
  });

  it("vết mang đủ con số tiền — thứ duy nhất xử được tranh chấp", async () => {
    await createOrderManualAction(DON);

    expect(veAudit().newValues).toMatchObject({
      orderCode: "DH2608270001",
      subtotal: 5_000_000,
      discountAmount: 500_000,
      shippingFee: 0,
      totalAmount: 4_500_000,
    });
  });

  it("vết mang đường nối khách + người ghi + máy gọi", async () => {
    await createOrderManualAction(DON);

    const ve = veAudit();
    expect(ve.actor).toMatchObject({ id: "u-sale", name: "Sale CS1" });
    expect(ve).toMatchObject({ ip: "1.2.3.4", userAgent: "vitest" });
    expect(ve.newValues).toMatchObject({ leadId: "lead-1", leadChildId: "child-1" });
  });

  it("vết nằm TRONG CÙNG transaction với đơn (không ghi ngoài, không nuốt lỗi)", async () => {
    await createOrderManualAction(DON);

    expect(veAudit().tx).toBe(txGia);
  });

  it("ghi vết hỏng → cả lượt tạo đơn hỏng theo, không có đơn không vết", async () => {
    h.writeAudit.mockRejectedValue(new Error("audit down"));

    await expect(createOrderManualAction(DON)).rejects.toThrow("audit down");
  });

  it("đơn không qua được kiểm tra đầu vào → không ghi vết thừa", async () => {
    const res = await createOrderManualAction({ ...DON, items: [] });

    expect(res.ok).toBe(false);
    expect(h.writeAudit).not.toHaveBeenCalled();
  });
});
