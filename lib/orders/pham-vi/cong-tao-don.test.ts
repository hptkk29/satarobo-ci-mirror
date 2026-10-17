// @vitest-environment node
/**
 * Cổng SCOPE của `createOrderManualAction` — bộ UNIT (mock-based, KHÔNG DB; chạy được trong job `Unit tests` của CI).
 * Phần chạm Postgres thật nằm ở `tests/finance/don-pham-vi-db.test.ts`.
 *
 * Bộ này khoá hai chiều của "cờ":
 *   · TẮT (hoặc giá trị lạ như `50`) ⇒ đường cũ NGUYÊN VĂN: golden payload của `tx.order.create`, không khoá mới nào;
 *   · BẬT ⇒ giá/ metadata/ audit do máy chủ tính, và mọi TỪ CHỐI xảy ra TRƯỚC `$transaction`.
 *
 * Ngày TUYỆT ĐỐI (luật 19): đồng hồ `Date` bị đóng băng ở 11/10/2026 — action gọi `new Date()` để truyền cho planner, mà cửa sổ
 * PL02 kết thúc 31/12/2026, nên một ca chạy theo đồng hồ thật sẽ NỔ sau ~80 ngày với mã không đổi.
 *
 * ⚠️ Lưới `[CHN-03]`/`[FTR-PIN-01]` cấm chuỗi tên khoá cờ trong mã dưới `app/`/`components/` — nên tệp này (đặt ở `lib/`) lấy tên
 * khoá qua `KHOA_CONG_TAC_PHAM_VI` chứ không gõ lại.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
  transaction: vi.fn(),
  orderCreate: vi.fn(),
  paymentMethodFindUnique: vi.fn(),
  leadFindFirst: vi.fn(),
  leadChildFindMany: vi.fn(),
  courseFindMany: vi.fn(),
  writeAudit: vi.fn(),
  ensureFullOrderRequest: vi.fn(),
  generateOrderCode: vi.fn(),
  /** Giá trị mà `getSetting` trả cho khoá công tắc. */
  co: { v: false as unknown },
  /** Khoá công tắc — điền ở `beforeAll` từ `KHOA_CONG_TAC_PHAM_VI` (hoisted không import được). */
  khoaCo: { v: "" },
  getSettingCalls: [] as Array<[string, unknown]>,
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn, revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: vi.fn(() => ({
    lead: { findFirst: h.leadFindFirst },
    leadChild: { findMany: h.leadChildFindMany },
    course: { findMany: h.courseFindMany },
    paymentMethod: { findUnique: h.paymentMethodFindUnique },
    product: { findUnique: vi.fn() },
    order: { findUnique: vi.fn(), findMany: vi.fn() },
    center: { findUnique: vi.fn(async () => ({ code: "CS1" })) },
    $transaction: h.transaction,
  })),
}));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/audit/headers", () => ({ getRequestMetadata: vi.fn(async () => ({ ip: "1.2.3.4", userAgent: "vitest" })) }));
vi.mock("@/lib/audit/log", () => ({ getAuditActor: vi.fn(() => ({ actorId: "u-ql", actorName: "QLCS 1" })) }));
vi.mock("@/lib/orders/code", () => ({
  generateOrderCode: h.generateOrderCode,
  withUniqueRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));
vi.mock("@/lib/orders/installments", () => ({ recordInstallmentPlan: vi.fn(), markInstallmentPaid: vi.fn() }));
// `getSetting` theo KHOÁ (không trả một số cho mọi khoá — fixture "50 đợt tối đa" làm mọi kế hoạch lọt cổng). Khoá lạ trả 50 y như
// `order-create-audit.test.ts`: chính con số đó từng biến cờ thành "bật" khi helper trả thẳng giá trị; nay `=== true` chặn.
vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (key: string, opts?: unknown) => {
    h.getSettingCalls.push([key, opts]);
    if (key === h.khoaCo.v) return h.co.v;
    if (key === "orders.maxInstallments") return 4;
    if (key === "orders.maxDiscountItems") return 1;
    if (key === "pricing.policyDateBasis") return "ORDER_CREATED";
    if (key === "pricing.sameTimeChildOrder") return "LOWER_VALUE_FIRST";
    return 50;
  }),
}));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: vi.fn(async () => "org-cs1") }));
vi.mock("@/lib/parents/provision", () => ({ ensureParentAccountForOrder: vi.fn() }));
vi.mock("@/lib/finance/payment", () => ({ ensureOrderPaymentRecorded: vi.fn() }));
vi.mock("@/lib/payments/payment-request", () => ({ ensureFullOrderRequest: h.ensureFullOrderRequest }));
vi.mock("@/lib/email/trigger", () => ({ sendEmailForTrigger: vi.fn(async () => undefined) }));
vi.mock("@/lib/notify/order", () => ({ notifyOrderByZnsIfNoEmail: vi.fn() }));
vi.mock("@/lib/email/render", () => ({ renderTemplate: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
// Hai lời gọi DB phía SAU giao dịch (báo người duyệt, lịch sử lead) — nuốt lỗi nhưng vẫn mở kết nối thật nếu không mock.
vi.mock("@/lib/orders/bao-cho-duyet", () => ({ baoDonChoDuyet: vi.fn(async () => undefined) }));
vi.mock("@/lib/lead/tuong-tac/ghi", () => ({ ghiTuongTacLeadBoQuaLoi: vi.fn(async () => undefined) }));

import { createOrderManualAction } from "@/app/(admin)/admin/orders/_actions";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { docPhamViDong } from "./doc-dong";

const SATA3 = { id: "c-sata3", price: 10_560_000, totalSessions: 48 };
const SATA4 = { id: "c-sata4", price: 11_520_000, totalSessions: 48 };
const SATA1 = { id: "c-sata1", price: 5_200_003, totalSessions: 11 };

type Dong = Record<string, unknown>;
/** Dòng khoá học hợp lệ với `orderCreateManualSchema`. Mặc định: Sata3 mua đủ 48, đơn giá = ĐÚNG số máy chủ tính (8.976.000). */
function dong(o: Dong = {}): Dong {
  return {
    type: "COURSE_ENROLLMENT",
    itemName: "Sata 3",
    quantity: 1,
    unitPrice: 8_976_000,
    metadata: { courseId: SATA3.id, soBuoi: 48 },
    ...o,
  };
}
function don(items: Dong[], o: Dong = {}) {
  return {
    type: "COURSE" as const,
    status: "PENDING_PAYMENT" as const,
    customerName: "Nguyễn Thị Hồng Nhung",
    customerPhone: "0905123456",
    customerEmail: "",
    leadId: "lead-1",
    centerId: "cs1",
    paymentMethodId: "pm-1",
    items,
    shippingFee: 0,
    ...o,
  };
}

const duLieuDon = () => h.orderCreate.mock.calls[0]![0].data as Record<string, unknown> & { items: { create: Array<Record<string, unknown>> } };
const dongDaGhi = (i = 0) => duLieuDon().items.create[i]!;
const veAudit = () => h.writeAudit.mock.calls[0]![0] as { newValues: Record<string, unknown> };
const daHoiCo = () => h.getSettingCalls.filter(([k]) => k === h.khoaCo.v);

beforeAll(() => {
  h.khoaCo.v = KHOA_CONG_TAC_PHAM_VI;
  // Chỉ đóng băng `Date` (luật 19) — timer của Prisma/pool không bị đụng.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T03:00:00Z"));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  vi.clearAllMocks();
  h.getSettingCalls.length = 0;
  h.co.v = false;
  h.auth.mockResolvedValue({ user: { id: "u-ql", name: "QLCS 1" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue({ userId: "u-ql" });
  h.passesScope.mockReturnValue(true);
  h.leadFindFirst.mockResolvedValue({
    id: "lead-1",
    assignedToId: "u-ql",
    centerId: "cs1",
    children: [
      { id: "lc-a", leadId: "lead-1" },
      { id: "lc-b", leadId: "lead-1" },
    ],
  });
  h.leadChildFindMany.mockImplementation(async (a: { where: { id: { in: string[] } } }) => a.where.id.in.map((id) => ({ id })));
  h.courseFindMany.mockResolvedValue([SATA3, SATA4, SATA1]);
  h.paymentMethodFindUnique.mockResolvedValue({
    id: "pm-1",
    name: "Chuyển khoản",
    isActive: true,
    centerId: null,
    canBuyCourse: true,
    canBuyPackage: true,
    canBuyExam: true,
    canBuyProduct: true,
  });
  h.generateOrderCode.mockResolvedValue("DH2610110001");
  h.orderCreate.mockResolvedValue({ id: "ord-1", code: "DH2610110001" });
  h.ensureFullOrderRequest.mockResolvedValue(undefined);
  h.writeAudit.mockResolvedValue({ id: "audit-1" });
  const txGia = { order: { create: h.orderCreate, update: vi.fn() }, paymentRequest: { updateMany: vi.fn() } };
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txGia));
});

describe("[ĐSC-08] cờ TẮT ⇒ đường cũ NGUYÊN VĂN", () => {
  // Đơn "cũ": giá niêm yết 10.560.000, số buổi mua 48 ghi trong metadata — đúng hình dạng form gửi hôm nay.
  const DON_CU = () => don([dong({ unitPrice: 10_560_000, metadata: { courseId: SATA3.id, soBuoi: 48 } })]);

  for (const [ten, giaTri] of [["TẮT (false)", false], ["giá trị lạ 50 (mock cũ trả 50 cho mọi khoá)", 50], ["null", null], ["chuỗi 'true'", "true"]] as const) {
    it(`[ĐSC-08a] cờ = ${ten}: payload ghi xuống giống hệt đường cũ, không khoá phạm vi nào`, async () => {
      h.co.v = giaTri;
      const res = await createOrderManualAction(DON_CU());
      expect(res.ok).toBe(true);

      const d = duLieuDon();
      expect(d).toMatchObject({ subtotal: 10_560_000, discountAmount: 0, totalAmount: 10_560_000, installmentApprovalStatus: null, discountApprovalStatus: null, soBuoiApprovalStatus: null });
      const it0 = dongDaGhi();
      expect(it0).toMatchObject({ type: "COURSE_ENROLLMENT", quantity: 1, unitPrice: 10_560_000, totalPrice: 10_560_000, discountAmount: 0 });
      expect(it0.discounts).toBe(Prisma.JsonNull);
      // Metadata: CHÍNH payload client, không thêm / bớt gì.
      expect(it0.metadata).toEqual({ courseId: SATA3.id, soBuoi: 48 });
      expect(docPhamViDong(it0.metadata)).toBeNull();
      // Audit không có khoá `phamVi` (không phải `phamVi: undefined`).
      expect("phamVi" in veAudit().newValues).toBe(false);
      expect(veAudit().newValues).toMatchObject({ soBuoiKhai: [48], totalAmount: 10_560_000 });
    });
  }

  it("[ĐSC-08b] cờ TẮT: chỉ MỘT lần hỏi cờ (đúng orgUnit của cơ sở) và KHÔNG đọc thêm mốc ngày / thứ tự con", async () => {
    await createOrderManualAction(DON_CU());
    expect(daHoiCo()).toEqual([[KHOA_CONG_TAC_PHAM_VI, { orgUnitId: "org-cs1" }]]);
    const khoaDaDoc = h.getSettingCalls.map(([k]) => k);
    expect(khoaDaDoc).not.toContain("pricing.policyDateBasis");
    expect(khoaDaDoc).not.toContain("pricing.sameTimeChildOrder");
  });

  it("[ĐSC-08c] cờ TẮT: đầu vào mà khi bật sẽ bị TỪ CHỐI (giá 'sai', số buổi lẻ, kế hoạch đợt, đơn trộn) vẫn chạy y như cũ", async () => {
    const res = await createOrderManualAction(
      don(
        [
          dong({ unitPrice: 123_456, metadata: { courseId: SATA3.id, soBuoi: 13 } }),
          dong({ itemName: "Sata 1", unitPrice: 5_200_003, metadata: { courseId: SATA1.id, soBuoi: 11 } }),
        ],
        { keHoachDot: [{ amount: 2_000_000, daThu: false, dueDate: "2026-11-01" }] },
      ),
    );
    expect(res.ok).toBe(true);
    expect(h.orderCreate).toHaveBeenCalledTimes(1);
  });

  it("[ĐSC-08d] cờ TẮT: khoá dự trữ `phamVi` do client gửi bị GỠ (đường cũ không chở nó vào DB); khoá khác giữ nguyên", async () => {
    const gia = { phienBan: 1, loaiMua: "FULL", soBuoiMua: 48, niemYet: 1, giamGia: 0, thanhTien: 1 };
    await createOrderManualAction(don([dong({ unitPrice: 10_560_000, metadata: { courseId: SATA3.id, soBuoi: 48, phamVi: gia } })]));
    expect(dongDaGhi().metadata).toEqual({ courseId: SATA3.id, soBuoi: 48 });
  });
});

describe("[ĐSC-09] cờ BẬT ⇒ giá do máy chủ tính, ghi snapshot", () => {
  beforeEach(() => {
    h.co.v = true;
  });

  it("[ĐSC-09a] Sata3 đủ 48: đơn giá 8.976.000, KHÔNG khoản giảm riêng, tổng đơn = thành tiền; metadata có `soBuoi` và `phamVi`", async () => {
    const res = await createOrderManualAction(don([dong()]));
    expect(res.ok).toBe(true);
    const d = duLieuDon();
    expect(d).toMatchObject({ subtotal: 8_976_000, discountAmount: 0, totalAmount: 8_976_000 });
    const it0 = dongDaGhi();
    expect(it0).toMatchObject({ quantity: 1, unitPrice: 8_976_000, totalPrice: 8_976_000, discountAmount: 0 });
    // `totalPrice − discountAmount` = thành tiền của snapshot (số mà `giaTuDongDon` đọc cho ghi danh khi convert = số khách trả).
    const pv = docPhamViDong(it0.metadata)!;
    expect(pv).not.toBeNull();
    expect((it0.totalPrice as number) - (it0.discountAmount as number)).toBe(pv.thanhTien);
    expect(pv).toMatchObject({ loaiMua: "FULL", soBuoiMua: 48, niemYet: 10_560_000, giamGia: 1_584_000, thanhTien: 8_976_000 });
    expect(pv.pricingSnapshot.nguonGia48).toBe("Course.price");
    expect((it0.metadata as Record<string, unknown>).soBuoi).toBe(48);
  });

  it("[ĐSC-09b] cờ được hỏi đúng MỘT lần, đúng orgUnit; mốc ngày + thứ tự con chỉ đọc khi cờ bật", async () => {
    await createOrderManualAction(don([dong()]));
    expect(daHoiCo()).toEqual([[KHOA_CONG_TAC_PHAM_VI, { orgUnitId: "org-cs1" }]]);
    const khoaDaDoc = h.getSettingCalls.map(([k]) => k);
    expect(khoaDaDoc).toContain("pricing.policyDateBasis");
    expect(khoaDaDoc).toContain("pricing.sameTimeChildOrder");
  });

  it("[ĐSC-09c] audit CREATE mang tóm tắt phạm vi từng dòng", async () => {
    await createOrderManualAction(don([dong()]));
    expect(veAudit().newValues.phamVi).toEqual([
      { dong: 1, loaiMua: "FULL", soBuoi: 48, niemYet: 10_560_000, thanhTien: 8_976_000, thuTuCon: 1, thuTuSanPham48: 1, nguonGia48: "Course.price" },
    ]);
  });

  it("[ĐSC-09d] cổng soát giá lấy mốc là số MÁY CHỦ tính: đơn SCOPE hợp lệ KHÔNG bị đánh dấu lệch giá", async () => {
    await createOrderManualAction(don([dong({ unitPrice: 5_016_000, metadata: { courseId: SATA3.id, soBuoi: 24 } })]));
    expect(veAudit().newValues).toMatchObject({ giaLech: false, giaTongLechThap: 0, giaDongLech: [] });
  });

  it("[ĐSC-09e] nhiều con nhiều khoá: mỗi dòng đúng `leadChildId`, đúng giá, tổng đúng", async () => {
    const res = await createOrderManualAction(
      don([
        dong({ leadChildId: "lc-a" }),
        dong({ itemName: "Sata 4", leadChildId: "lc-b", unitPrice: 8_640_000, metadata: { courseId: SATA4.id, soBuoi: 48 } }),
      ]),
    );
    expect(res.ok).toBe(true);
    const [a, b] = [dongDaGhi(0), dongDaGhi(1)];
    expect((a.metadata as Record<string, unknown>).leadChildId).toBe("lc-a");
    expect((b.metadata as Record<string, unknown>).leadChildId).toBe("lc-b");
    expect([a.unitPrice, b.unitPrice]).toEqual([8_976_000, 8_640_000]);
    expect(duLieuDon()).toMatchObject({ subtotal: 17_616_000, totalAmount: 17_616_000, discountAmount: 0 });
    expect(docPhamViDong(b.metadata)!.pricingSnapshot).toMatchObject({ thuTuCon: 2, thuTuSanPham48: 2, phanTramApDung: 25, biCatTran: true });
    // Hai dòng hai con khác nhau ⇒ `Order.leadChildId` (một con duy nhất) phải là null, KHÔNG đoán.
    expect(duLieuDon().leadChildId).toBeNull();
  });

  it("[ĐSC-09f] khoá `phamVi` giả của client trên dòng SCOPE bị thay bằng khối do máy chủ tính; khoá lạ không lọt", async () => {
    const gia = { phienBan: 1, loaiMua: "FULL", soBuoiMua: 48, niemYet: 1, giamGia: 0, thanhTien: 1 };
    await createOrderManualAction(don([dong({ metadata: { courseId: SATA3.id, soBuoi: 48, phamVi: gia, ghiChuLa: "x" } })]));
    const m = dongDaGhi().metadata as Record<string, unknown>;
    expect(Object.keys(m).sort()).toEqual(["courseId", "phamVi", "soBuoi"]);
    expect(docPhamViDong(m)!.thanhTien).toBe(8_976_000);
  });

  it("[ĐSC-09g] dòng không phải SCOPE trong đơn LEGACY-thuần (Sata 1 = 11 buổi) vẫn đi đường cũ dù cờ bật, và không bị gắn dấu", async () => {
    const res = await createOrderManualAction(don([dong({ itemName: "Sata 1", unitPrice: 5_200_003, metadata: { courseId: SATA1.id, soBuoi: 11 } })]));
    expect(res.ok).toBe(true);
    expect(dongDaGhi().metadata).toEqual({ courseId: SATA1.id, soBuoi: 11 });
    expect("phamVi" in veAudit().newValues).toBe(false);
  });

  it("[ĐSC-09h] đơn không gắn cơ sở ⇒ LEGACY, KHÔNG đọc cờ", async () => {
    const res = await createOrderManualAction(don([dong({ unitPrice: 10_560_000 })], { centerId: null }));
    expect(res.ok).toBe(true);
    expect(daHoiCo()).toEqual([]);
    expect(dongDaGhi().metadata).toEqual({ courseId: SATA3.id, soBuoi: 48 });
  });
});

describe("[ĐSC-09i] cơ sở của đơn chưa ánh xạ OrgUnit ⇒ LEGACY dù cờ toàn hệ BẬT", () => {
  it("[ĐSC-09i] centerId có nhưng orgUnitId = null ⇒ KHÔNG đọc cờ, đường cũ nguyên văn (không rơi về cờ toàn hệ)", async () => {
    h.co.v = true;
    vi.mocked(orgUnitIdForCenter).mockResolvedValueOnce(null);
    const res = await createOrderManualAction(don([dong({ unitPrice: 10_560_000 })]));
    expect(res.ok).toBe(true);
    expect(daHoiCo()).toEqual([]);
    expect(dongDaGhi().metadata).toEqual({ courseId: SATA3.id, soBuoi: 48 });
    expect("phamVi" in veAudit().newValues).toBe(false);
  });
});

describe("[ĐSC-10] cờ BẬT: TỪ CHỐI trước giao dịch — không ghi gì, không còn gì để cuộn ngược", () => {
  beforeEach(() => {
    h.co.v = true;
  });
  const biTuChoi = (res: Awaited<ReturnType<typeof createOrderManualAction>>, chua: string) => {
    expect(res.ok).toBe(false);
    expect("error" in res ? res.error : "").toContain(chua);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.orderCreate).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.ensureFullOrderRequest).not.toHaveBeenCalled();
  };

  it("[ĐSC-10a] đơn giá client lệch số máy chủ (gửi giá niêm yết 10.560.000) ⇒ lỗi nói rõ số đúng", async () => {
    biTuChoi(await createOrderManualAction(don([dong({ unitPrice: 10_560_000 })])), "đơn giá phải là 8.976.000đ");
  });
  it("[ĐSC-10b] số buổi lẻ ⇒ từ chối", async () => {
    biTuChoi(await createOrderManualAction(don([dong({ metadata: { courseId: SATA3.id, soBuoi: 13 } })])), "không nằm trong các mốc");
  });
  it("[ĐSC-10c] không khai số buổi ⇒ từ chối (không suy về đủ khoá)", async () => {
    biTuChoi(await createOrderManualAction(don([dong({ metadata: { courseId: SATA3.id } })])), "Chưa chọn số buổi");
  });
  it("[ĐSC-10d] kế hoạch nhiều đợt trên đơn SCOPE ⇒ từ chối TRƯỚC giao dịch", async () => {
    biTuChoi(
      await createOrderManualAction(don([dong()], { keHoachDot: [{ amount: 8_976_000, daThu: false, dueDate: "2026-11-01" }] })),
      "không chia kế hoạch nhiều đợt",
    );
  });
  it("[ĐSC-10e] khoản giảm tay trên dòng SCOPE ⇒ từ chối", async () => {
    biTuChoi(
      await createOrderManualAction(don([dong({ discounts: [{ kieu: "SO_TIEN", giaTri: 100_000, lyDo: "Ưu đãi nội bộ" }] })])),
      "khoản giảm",
    );
  });
  it("[ĐSC-10f] đơn trộn dòng 48 buổi + dòng Sata 1 ⇒ từ chối, nêu đúng dòng", async () => {
    biTuChoi(
      await createOrderManualAction(don([dong(), dong({ itemName: "Sata 1", unitPrice: 5_200_003, metadata: { courseId: SATA1.id, soBuoi: 11 } })])),
      "Dòng 2 (Sata 1)",
    );
  });
  it("[ĐSC-10g] hai dòng 48 buổi mà một dòng không chọn con ⇒ từ chối", async () => {
    biTuChoi(
      await createOrderManualAction(
        don([dong({ leadChildId: "lc-a" }), dong({ itemName: "Sata 4", unitPrice: 8_640_000, metadata: { courseId: SATA4.id, soBuoi: 48 } })]),
      ),
      "chọn rõ học viên/con",
    );
  });
  it("[ĐSC-10i] số lượng 2 trên dòng 48 buổi ⇒ từ chối (qua action, không chỉ ở planner): tránh thu gấp đôi", async () => {
    biTuChoi(await createOrderManualAction(don([dong({ quantity: 2 })])), "số lượng 1");
  });
  it("[ĐSC-10j] Coach 1-1 trên khoá 48 buổi ⇒ từ chối (hình thức lớp đi từ metadata vào planner)", async () => {
    biTuChoi(await createOrderManualAction(don([dong({ metadata: { courseId: SATA3.id, soBuoi: 48, coachFormat: "ONE_ON_ONE" } })])), "Coach");
  });
  it("[ĐSC-10k] khoá 48 buổi không có giá ⇒ từ chối fail-closed (KHÔNG coi giá thiếu là 0đ)", async () => {
    h.courseFindMany.mockResolvedValue([{ ...SATA3, price: null }, SATA4, SATA1]);
    biTuChoi(await createOrderManualAction(don([dong()])), "Chưa có giá niêm yết");
  });
  it("[ĐSC-10l] khoá chưa khai tổng số buổi ⇒ KHÔNG phải khoá 48 buổi ⇒ LEGACY (không suy mặc định 48)", async () => {
    h.courseFindMany.mockResolvedValue([{ id: "c-x", price: 5_000_000, totalSessions: null }]);
    const res = await createOrderManualAction(don([dong({ itemName: "Khoá X", unitPrice: 5_000_000, metadata: { courseId: "c-x", soBuoi: 12 } })]));
    expect(res.ok).toBe(true);
    expect(dongDaGhi().metadata).toEqual({ courseId: "c-x", soBuoi: 12 });
    expect("phamVi" in veAudit().newValues).toBe(false);
  });
  it("[ĐSC-10h] ngoài cửa sổ hiệu lực chính sách (đồng hồ ở 02/01/2027) ⇒ từ chối", async () => {
    vi.setSystemTime(new Date("2027-01-02T03:00:00Z"));
    try {
      biTuChoi(await createOrderManualAction(don([dong()])), "ngoài thời gian hiệu lực");
    } finally {
      vi.setSystemTime(new Date("2026-10-11T03:00:00Z"));
    }
  });
});

describe("[ĐSC-W] lưới ghim mã nguồn: cổng nằm ĐÚNG chỗ, và chỉ các đường tạo đơn ĐÃ NÊU mới được sống ở LEGACY", () => {
  const boChuThich = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*/g, "$1");
  const doc = (tep: string) => boChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
  const ACT = doc("app/(admin)/admin/orders/_actions.ts");

  it("[ĐSC-W0] bộ bỏ chú thích thật sự bỏ được (lưới-canh-lưới)", () => {
    expect(boChuThich("a /* K */ b // D\nc")).not.toMatch(/K|D/);
    expect(ACT.length).toBeLessThan(readFileSync(resolve(process.cwd(), "app/(admin)/admin/orders/_actions.ts"), "utf8").length);
  });

  it("[ĐSC-W1] `createOrderManualAction` gọi `apDungMoHinhPhamVi(` ĐÚNG MỘT LẦN, và lời gọi nằm TRƯỚC `tienDon(` và `$transaction(`", () => {
    const goi = [...ACT.matchAll(/\bapDungMoHinhPhamVi\(/g)];
    expect(goi).toHaveLength(1);
    const viTri = goi[0]!.index!;
    // Hàm bắt đầu từ `export async function createOrderManualAction`; mọi mốc so sánh đều nằm trong hàm đó.
    const dau = ACT.indexOf("export async function createOrderManualAction");
    const tien = ACT.indexOf("tienDon(khaiDong", dau);
    const gd = ACT.indexOf("sdb.$transaction(", dau);
    expect(dau).toBeGreaterThan(-1);
    expect(tien).toBeGreaterThan(viTri);
    expect(gd).toBeGreaterThan(viTri);
  });

  it("[ĐSC-W2] kết quả REJECT được trả về TRƯỚC `$transaction` (từ chối = `return`, không `throw` trong giao dịch)", () => {
    const m = /if \(pv\.kieu === "REJECT"\) return \{ ok: false as const, error: pv\.thongBao \};/.exec(ACT);
    expect(m).not.toBeNull();
    const dau = ACT.indexOf("export async function createOrderManualAction");
    expect(ACT.indexOf("sdb.$transaction(", dau)).toBeGreaterThan(m!.index);
  });

  it("[ĐSC-W3] metadata dòng đi qua `metadataChoDong(` với `pv`; mốc soát giá của dòng SCOPE là số máy chủ tính", () => {
    expect(ACT).toMatch(/metadataChoDong\(\s*pv,\s*i,/);
    expect(ACT).toMatch(/giaNiemYet: pv\.kieu === "SCOPE" \? pv\.dong\[i\]!\.thanhTien/);
    // KHÔNG còn đường dựng metadata cũ đứng một mình.
    expect(ACT).not.toMatch(/veMetadataConLead\(\s*\(it\.metadata as Record<string, unknown> \| null\) \?\? null,/);
  });

  it("[ĐSC-W4] bốn đường tạo Order khác KHÔNG biết gì về mô hình phạm vi (giữ LEGACY — BA P2-08: đơn nhập lịch sử không bao giờ là SCOPE)", () => {
    for (const tep of ["lib/crm/backfill-order.ts", "lib/finance/ghi-giao-dich-cu.ts", "lib/hoc-bu/case-db.ts", "lib/crm/convert-lead.ts"]) {
      const nd = doc(tep);
      expect(nd, tep).not.toMatch(/\.phamVi\b|"phamVi"|pham-vi\/|apDungMoHinhPhamVi|metadataDongPhamVi/);
    }
  });

  it("[ĐSC-W6] hai mô-đun THUẦN (ke-hoach-don, doc-dong) không import DB / server-only / cài đặt; callback $transaction không gọi sdb./db. (chỉ tx.)", () => {
    for (const tep of ["lib/orders/pham-vi/ke-hoach-don.ts", "lib/orders/pham-vi/doc-dong.ts"]) {
      expect(doc(tep), tep).not.toMatch(/@\/lib\/db\b|@\/lib\/db-scope|server-only|@\/lib\/settings|@\/lib\/org\//);
    }
    const dau = ACT.indexOf("sdb.$transaction(async (txRaw)", ACT.indexOf("export async function createOrderManualAction"));
    expect(dau).toBeGreaterThan(-1);
    const cuoi = dau + ACT.slice(dau).search(/\r?\n {4}\}\),\r?\n {2}\);/);
    expect(cuoi).toBeGreaterThan(dau + 1000); // lưới-canh-lưới: lát cắt thật sự phủ thân giao dịch
    const than = ACT.slice(dau + "sdb.$transaction(".length, cuoi);
    expect(than).toMatch(/\btx\.order\.create\(/);
    expect(than).not.toMatch(/\bsdb\./);
    expect(than).not.toMatch(/(^|[^.\w])db\./m);
  });

  it("[ĐSC-W5] chỉ `lib/orders/pham-vi/ap-dung.ts` được đọc cờ trong cây `lib/orders`; `_actions.ts` không đọc cờ trực tiếp", () => {
    expect(ACT).not.toMatch(/laThuHocPhiTheoPhamViBat|chanNeuPhamViTat|scopePurchaseEnabled/);
    expect(doc("lib/orders/pham-vi/ap-dung.ts")).toMatch(/laThuHocPhiTheoPhamViBat\(vao\.orgUnitId\)/);
  });
});
