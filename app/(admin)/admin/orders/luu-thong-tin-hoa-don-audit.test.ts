// @vitest-environment node
/**
 * Ca [TTHD-01..07] — `luuThongTinHoaDonAction` để lại VẾT và nói thật (GĐ 8 bước 12).
 *
 * Bốn ô "Người mua trên hoá đơn" là thứ in lên tờ hoá đơn và quyết định email nhận hoá đơn. Trước
 * bản vá: sửa không ghi nhật ký dòng nào, và nếu đơn đã có hoá đơn thì sale không được báo là tờ đã
 * có KHÔNG đổi theo. Ba điều khoá lại:
 *   1. vết nằm TRONG CÙNG transaction với phép ghi (cùng đối tượng `tx`) — ghi ngoài rồi nuốt lỗi là
 *      đơn đổi mà vết mất;
 *   2. giá trị CŨ đọc TRONG transaction, không từ client, và CHỈ các ô thực sự đổi;
 *   3. đơn có hoá đơn còn hiệu lực ⇒ vết ghi kèm + kết quả trả câu cảnh báo (đối chứng: không có thì
 *      không có gì).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
  orderFind: vi.fn(),
  transaction: vi.fn(),
  txFind: vi.fn(),
  txUpdate: vi.fn(),
  writeAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn, revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: vi.fn(() => ({ order: { findUnique: h.orderFind }, $transaction: h.transaction })),
}));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/audit/headers", () => ({ getRequestMetadata: vi.fn(async () => ({ ip: "1.2.3.4", userAgent: "vitest" })) }));
vi.mock("@/lib/audit/log", () => ({ getAuditActor: vi.fn(() => ({ actorId: "u-sale", actorName: "Sale CS1" })) }));
vi.mock("@/lib/settings/service", () => ({ getSetting: vi.fn(async () => 50) }));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: vi.fn(async () => "org-cs1") }));
vi.mock("@/lib/parents/provision", () => ({ ensureParentAccountForOrder: vi.fn() }));
vi.mock("@/lib/finance/payment", () => ({ ensureOrderPaymentRecorded: vi.fn() }));
vi.mock("@/lib/payments/payment-request", () => ({ ensureFullOrderRequest: vi.fn() }));
vi.mock("@/lib/email/trigger", () => ({ sendEmailForTrigger: vi.fn(async () => undefined) }));
vi.mock("@/lib/notify/order", () => ({ notifyOrderByZnsIfNoEmail: vi.fn() }));
vi.mock("@/lib/email/render", () => ({ renderTemplate: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));

import { luuThongTinHoaDonAction } from "./_actions";

const LUC = new Date("2026-09-27T02:00:00.000Z");
const CU = {
  updatedAt: LUC,
  centerId: "cs1",
  invoiceBuyerName: "Phan Thị Hồng",
  invoiceCompanyName: null,
  invoiceTaxCode: "0401234567",
  invoiceEmail: "hong@example.com",
  hoaDonDienTu: [] as { id: string; trangThai: string; kyHieu: string | null; soHoaDon: string | null }[],
};
const GIU = { invoiceBuyerName: "Phan Thị Hồng", invoiceCompanyName: "", invoiceTaxCode: "0401234567", invoiceEmail: "hong@example.com" };

let txGia: Record<string, unknown>;
const veAudit = () => h.writeAudit.mock.calls[0]?.[0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale", name: "Sale CS1" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue({ userId: "u-sale" });
  h.passesScope.mockReturnValue(true);
  // Bản đọc NGOÀI transaction cố ý mang giá trị KHÁC — vết phải lấy từ bản đọc TRONG transaction.
  h.orderFind.mockResolvedValue({ id: "don1", centerId: "cs1", invoiceBuyerName: "GIÁ TRỊ CŨ SAI" });
  h.txFind.mockResolvedValue({ ...CU });
  h.txUpdate.mockResolvedValue({ count: 1 });
  h.writeAudit.mockResolvedValue({ id: "audit-1" });
  txGia = { order: { findUnique: h.txFind, updateMany: h.txUpdate } };
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txGia));
});

describe("[TTHD] luuThongTinHoaDonAction", () => {
  it("[TTHD-01] đổi 2/4 ô ⇒ MỘT vết, CÙNG tx với phép ghi, cũ→mới CHỈ hai ô đó (giá trị cũ đọc trong tx)", async () => {
    const res = await luuThongTinHoaDonAction("don1", { ...GIU, invoiceBuyerName: "Nguyễn Văn Bình", invoiceCompanyName: "Cty ABC" }, LUC.toISOString());
    expect(res).toEqual({ ok: true, canhBao: null });
    expect(h.txUpdate).toHaveBeenCalledWith({
      where: { id: "don1", updatedAt: LUC },
      data: { invoiceBuyerName: "Nguyễn Văn Bình", invoiceCompanyName: "Cty ABC", invoiceTaxCode: "0401234567", invoiceEmail: "hong@example.com" },
    });
    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    expect(veAudit().tx).toBe(txGia);
    expect(veAudit()).toMatchObject({
      module: "orders",
      entityType: "Order",
      entityId: "don1",
      action: "SUA_THONG_TIN_HOA_DON",
      actor: { id: "u-sale", name: "Sale CS1" },
      oldValues: { invoiceBuyerName: "Phan Thị Hồng", invoiceCompanyName: null },
      newValues: { invoiceBuyerName: "Nguyễn Văn Bình", invoiceCompanyName: "Cty ABC" },
      changedFields: ["invoiceBuyerName", "invoiceCompanyName"],
      orgUnitId: "cs1",
    });
    expect(Object.keys(veAudit().oldValues as object)).toEqual(["invoiceBuyerName", "invoiceCompanyName"]);
  });

  it("[TTHD-02] không đổi gì ⇒ KHÔNG ghi, KHÔNG vết, vẫn ok", async () => {
    expect(await luuThongTinHoaDonAction("don1", GIU, LUC.toISOString())).toEqual({ ok: true, canhBao: null });
    expect(h.txUpdate).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("[TTHD-03] phiên bản đã thấy ≠ updatedAt hiện tại ⇒ STALE_WRITE, không ghi, không vết", async () => {
    const res = await luuThongTinHoaDonAction("don1", { ...GIU, invoiceTaxCode: "999" }, "2026-09-27T01:59:59.000Z");
    expect(res).toEqual({ ok: false, error: "STALE_WRITE" });
    expect(h.txUpdate).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("[TTHD-04] ghi có điều kiện đổi 0 dòng (người khác vừa lưu) ⇒ STALE_WRITE, không vết", async () => {
    h.txUpdate.mockResolvedValue({ count: 0 });
    expect(await luuThongTinHoaDonAction("don1", { ...GIU, invoiceTaxCode: "999" }, LUC.toISOString())).toEqual({ ok: false, error: "STALE_WRITE" });
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("[TTHD-05] đơn có hoá đơn còn hiệu lực ⇒ vết ghi kèm + câu cảnh báo; đối chứng: không có ⇒ không có gì", async () => {
    h.txFind.mockResolvedValue({ ...CU, hoaDonDienTu: [{ id: "hd1", trangThai: "NHAP", kyHieu: "1C26TSR", soHoaDon: "127" }] });
    const res = await luuThongTinHoaDonAction("don1", { ...GIU, invoiceTaxCode: "0409999999" }, LUC.toISOString());
    expect(res).toMatchObject({ ok: true, canhBao: expect.stringMatching(/1C26TSR-127 \(nháp\).*tờ hoá đơn không tự đổi/) });
    expect((veAudit().newValues as Record<string, unknown>).hoaDonConHieuLuc).toEqual([{ id: "hd1", trangThai: "NHAP", so: "1C26TSR-127" }]);

    vi.clearAllMocks();
    h.txFind.mockResolvedValue({ ...CU });
    h.txUpdate.mockResolvedValue({ count: 1 });
    h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txGia));
    h.auth.mockResolvedValue({ user: { id: "u-sale", name: "Sale CS1" } });
    h.checkPermission.mockResolvedValue(true);
    h.resolveActor.mockResolvedValue({ userId: "u-sale" });
    h.passesScope.mockReturnValue(true);
    h.orderFind.mockResolvedValue({ id: "don1", centerId: "cs1" });
    const khong = await luuThongTinHoaDonAction("don1", { ...GIU, invoiceTaxCode: "0409999999" }, LUC.toISOString());
    expect(khong).toEqual({ ok: true, canhBao: null });
    expect(veAudit().newValues).not.toHaveProperty("hoaDonConHieuLuc");
  });

  it("[TTHD-06] ô trắng ghi và ghi vết là null (không phải chuỗi rỗng)", async () => {
    await luuThongTinHoaDonAction("don1", { ...GIU, invoiceTaxCode: "   " }, LUC.toISOString());
    expect((h.txUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data.invoiceTaxCode).toBeNull();
    expect(veAudit()).toMatchObject({ oldValues: { invoiceTaxCode: "0401234567" }, newValues: { invoiceTaxCode: null } });
  });

  it("[TTHD-07] đơn ngoài phạm vi ⇒ từ chối, KHÔNG mở transaction, không vết", async () => {
    h.passesScope.mockReturnValue(false);
    expect(await luuThongTinHoaDonAction("don1", { ...GIU, invoiceTaxCode: "999" }, LUC.toISOString())).toEqual({
      ok: false,
      error: "Không tìm thấy đơn hàng",
    });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });
  it("[TTHD-08] thiếu orders:view-pii (có orders:manage) ⇒ từ chối TRƯỚC mọi đọc / ghi — không ghi chuỗi đã che đè dữ liệu thật; đối chứng: có quyền ⇒ ghi", async () => {
    h.checkPermission.mockImplementation(async (p: string) => p !== "orders:view-pii");
    const res = await luuThongTinHoaDonAction("don1", { ...GIU, invoiceTaxCode: "040xxxx567", invoiceEmail: "ho**@example.com" }, LUC.toISOString());
    expect(res).toEqual({ ok: false, error: "Cần quyền xem thông tin khách để sửa người mua trên hoá đơn" });
    expect(h.checkPermission).toHaveBeenCalledWith("orders:view-pii");
    expect(h.orderFind).not.toHaveBeenCalled();
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.txUpdate).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();

    h.checkPermission.mockResolvedValue(true);
    expect(await luuThongTinHoaDonAction("don1", { ...GIU, invoiceTaxCode: "0409999999" }, LUC.toISOString())).toEqual({ ok: true, canhBao: null });
    expect(h.txUpdate).toHaveBeenCalledTimes(1);
  });
});
