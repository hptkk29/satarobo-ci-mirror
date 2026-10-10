// @vitest-environment node
/**
 * Ca [POS1-Q-01..04] · [POS1-Q-08] · [POS2-CD-06] — cổng của BA Server Action thu thẻ POS trên màn
 * đơn (`taoPhieuPosAction` · `kiemTraPhieuPosAction` · `baoAdminPhieuPosAction`). THUẦN — mọi module
 * chạm DB đều giả lập.
 *
 * Thiết kế: docs/pos-gd1-thiet-ke.md §6. Ba cổng, thiếu cổng nào cũng là lỗ:
 *   1. quyền `payments:pos-check` (đối chứng dương: có quyền ⇒ chạy tới lib ĐÚNG MỘT lần);
 *   2. đơn trong phạm vi người bấm (`scopedDb` + `passesScope`) — câu chữ không phân biệt "không có"
 *      với "không thuộc cơ sở bạn";
 *   3. cờ `billing.flexV1Enabled` của CƠ SỞ ĐƠN — CHỈ cho việc TẠO phiếu; Kiểm tra + Báo admin KHÔNG
 *      hỏi cờ (T8: cờ tắt giữa chừng, sale vẫn phải xem được kết quả tiền đã quẹt).
 * Cổng IDOR của phiếu: `intentId` của đơn KHÁC ⇒ "Không tìm thấy phiếu POS".
 *
 * Đầu vào của ca từ chối HỢP LỆ về schema — để nếu cổng quyền bị gỡ thì action chạy TIẾP tới lib
 * (và ca đỏ vì lib bị gọi), chứ không dừng nhờ lỗi schema rồi che mất lỗ hổng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
  orderFind: vi.fn(),
  intentFindFirst: vi.fn(),
  linhHoat: vi.fn(),
  moPhieuPos: vi.fn(),
  kiemTraPhieuPos: vi.fn(),
  baoAdminPhieuPos: vi.fn(),
  chonPosProvider: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn, revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: vi.fn(() => ({
    order: { findUnique: h.orderFind },
    posPaymentIntent: { findFirst: h.intentFindFirst },
  })),
}));
vi.mock("@/lib/finance/feature", () => ({ laThuTienLinhHoatBat: h.linhHoat }));
vi.mock("@/lib/payments/pos/phieu-pos", () => ({ moPhieuPos: h.moPhieuPos, baoAdminPhieuPos: h.baoAdminPhieuPos }));
vi.mock("@/lib/payments/pos/xu-ly-ket-qua", () => ({ kiemTraPhieuPos: h.kiemTraPhieuPos }));
vi.mock("@/lib/payments/pos/provider/chon", () => ({ chonPosProvider: h.chonPosProvider }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: vi.fn() }));
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

import { baoAdminPhieuPosAction, kiemTraPhieuPosAction, taoPhieuPosAction } from "./_actions";

const TAO = { orderId: "don1", paymentRequestId: "dot1" };
const KIEM = { orderId: "don1", intentId: "pos1" };
const BAO = { orderId: "don1", intentId: "pos1", ghiChu: "Biên lai đã báo thành công" };

const PROVIDER = { ten: "TCB_FILE", nguonDuLieu: "SMARTPOS" };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale", name: "Sale CS1" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue({ userId: "u-sale" });
  h.passesScope.mockReturnValue(true);
  h.orderFind.mockResolvedValue({ id: "don1", centerId: "cs1", orgUnitId: "ou1" });
  h.intentFindFirst.mockResolvedValue({ id: "pos1", status: "CHO_QUET", lastCheckAt: null, lastResultMessage: null });
  h.linhHoat.mockResolvedValue(true);
  h.moPhieuPos.mockResolvedValue({ ok: true, phieu: { intentId: "pos1", code5: "K7M2N" } });
  h.kiemTraPhieuPos.mockResolvedValue({ status: "CHO_QUET", doiTrangThai: false, thongDiep: "Chưa thấy…", mucDo: "thong_tin", ketLuan: null });
  h.baoAdminPhieuPos.mockResolvedValue({ ok: true, soNguoi: 2 });
  h.chonPosProvider.mockReturnValue(PROVIDER);
});

async function baAction() {
  return {
    tao: await taoPhieuPosAction(TAO),
    kiem: await kiemTraPhieuPosAction(KIEM),
    bao: await baoAdminPhieuPosAction(BAO),
  };
}

describe("[POS1-Q] cổng ba action thu thẻ POS", () => {
  it("[POS1-Q-01] thiếu `payments:pos-check` ⇒ cả ba từ chối 'Không có quyền', KHÔNG chạm actor / DB / lib", async () => {
    h.checkPermission.mockResolvedValue(false);
    const kq = await baAction();
    for (const [ten, r] of Object.entries(kq)) {
      expect(r, ten).toEqual({ ok: false, error: "Không có quyền" });
    }
    expect(h.resolveActor).not.toHaveBeenCalled();
    expect(h.orderFind).not.toHaveBeenCalled();
    expect(h.moPhieuPos, "không tạo phiếu khi thiếu quyền").not.toHaveBeenCalled();
    expect(h.kiemTraPhieuPos).not.toHaveBeenCalled();
    expect(h.baoAdminPhieuPos).not.toHaveBeenCalled();
    // Hỏi ĐÚNG quyền — không mượn `payments:record` / `orders:manage`.
    expect(new Set(h.checkPermission.mock.calls.map((c) => c[0]))).toEqual(new Set(["payments:pos-check"]));
  });

  it("[POS1-Q-02] ĐỐI CHỨNG DƯƠNG: có quyền + trong phạm vi + cờ bật ⇒ mỗi action gọi lib ĐÚNG MỘT lần", async () => {
    const kq = await baAction();
    expect(kq.tao).toMatchObject({ ok: true, phieu: { intentId: "pos1" } });
    expect(kq.kiem).toMatchObject({ ok: true, ketQua: { status: "CHO_QUET" } });
    expect(kq.bao).toMatchObject({ ok: true });
    expect(h.moPhieuPos).toHaveBeenCalledTimes(1);
    expect(h.moPhieuPos.mock.calls[0]![0]).toMatchObject({
      orderId: "don1",
      paymentRequestId: "dot1",
      actor: { id: "u-sale", name: "Sale CS1" },
    });
    expect(h.moPhieuPos.mock.calls[0]![0].now).toBeInstanceOf(Date);
    expect(h.kiemTraPhieuPos).toHaveBeenCalledTimes(1);
    expect(h.kiemTraPhieuPos.mock.calls[0]![0]).toMatchObject({ intentId: "pos1", triggeredBy: "SALE", provider: PROVIDER });
    expect(h.baoAdminPhieuPos).toHaveBeenCalledTimes(1);
  });

  it("[POS1-Q-03] đơn NGOÀI phạm vi ⇒ 'Không tìm thấy đơn hàng' ở cả ba, không chạm lib", async () => {
    h.passesScope.mockReturnValue(false);
    const kq = await baAction();
    for (const [ten, r] of Object.entries(kq)) expect(r, ten).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
    h.passesScope.mockReturnValue(true);
    h.orderFind.mockResolvedValue(null);
    const kq2 = await baAction();
    for (const [ten, r] of Object.entries(kq2)) expect(r, ten).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
    expect(h.moPhieuPos).not.toHaveBeenCalled();
    expect(h.kiemTraPhieuPos).not.toHaveBeenCalled();
    expect(h.baoAdminPhieuPos).not.toHaveBeenCalled();
  });

  it("[POS1-Q-04] cờ TẮT ⇒ TẠO bị từ chối; KIỂM TRA + BÁO ADMIN vẫn chạy (T8)", async () => {
    h.linhHoat.mockResolvedValue(false);
    const kq = await baAction();
    expect(kq.tao).toEqual({ ok: false, error: "Tính năng thu học phí linh hoạt chưa bật cho cơ sở này" });
    expect(h.moPhieuPos).not.toHaveBeenCalled();
    expect(kq.kiem.ok, "kiểm tra không hỏi cờ").toBe(true);
    expect(h.kiemTraPhieuPos).toHaveBeenCalledTimes(1);
    expect(kq.bao.ok, "báo admin không hỏi cờ").toBe(true);
  });

  it("[POS1-Q-08] phiếu POS của ĐƠN KHÁC (IDOR) ⇒ 'Không tìm thấy phiếu POS', tra theo CẢ id lẫn đơn", async () => {
    h.intentFindFirst.mockResolvedValue(null);
    const kiem = await kiemTraPhieuPosAction(KIEM);
    const bao = await baoAdminPhieuPosAction(BAO);
    expect(kiem).toEqual({ ok: false, error: "Không tìm thấy phiếu POS" });
    expect(bao).toEqual({ ok: false, error: "Không tìm thấy phiếu POS" });
    expect(h.kiemTraPhieuPos).not.toHaveBeenCalled();
    expect(h.baoAdminPhieuPos).not.toHaveBeenCalled();
    const where = h.intentFindFirst.mock.calls[0]![0].where;
    expect(where).toEqual({ id: "pos1", paymentBill: { orderId: "don1" } });
  });

  it("[POS2-CD-06] (thay [POS1-Q-10]) chống bấm dồn RỜI action: phiếu vừa kiểm xong vẫn gọi kiemTraPhieuPos ĐÚNG MỘT lần, truyền SALE + người bấm", async () => {
    // GĐ2 U1 (docs/pos-gd2-thiet-ke.md §2.2): cửa sổ 5 giây nằm TRONG `kiemTraPhieuPos`, đọc
    // `lastCheckAt` DƯỚI khoá dòng phiếu. Mã TRƯỚC bản vá đọc `lastCheckAt` ở đây, NGOÀI khoá ⇒ hai lượt
    // bấm cùng lúc đều qua cổng. Mốc tuyệt đối — không `Date.now()` (luật 19, ca cũ đọc đồng hồ thật).
    h.intentFindFirst.mockResolvedValue({
      id: "pos1",
      status: "CHO_QUET",
      lastCheckAt: new Date("2026-10-06T10:40:00Z"),
      lastResultMessage: "Chưa thấy giao dịch mang mã K7M2N.",
    });
    const r = await kiemTraPhieuPosAction(KIEM);
    expect(r).toMatchObject({ ok: true, ketQua: { status: "CHO_QUET" } });
    expect(h.kiemTraPhieuPos).toHaveBeenCalledTimes(1);
    const goi = h.kiemTraPhieuPos.mock.calls[0]![0];
    expect(goi).toMatchObject({ intentId: "pos1", triggeredBy: "SALE", nguoiKiemId: "u-sale", provider: PROVIDER });
    expect(goi.now).toBeInstanceOf(Date);
    // GĐ4 (T5): lượt SALE là lượt DUY NHẤT gác sức khoẻ máy đồng bộ + chờ ≤ 8″ ⇒ `cheDo: "SALE"` (rà đối kháng
    // GĐ4: `choDongBo: true` ⇒ chế độ ba trạng thái). Mã TRƯỚC GĐ4: `chonPosProvider()` (luôn provider file).
    expect(h.chonPosProvider).toHaveBeenCalledTimes(1);
    expect(h.chonPosProvider).toHaveBeenCalledWith({ cheDo: "SALE" });
    // Cổng IDOR giữ nguyên nhưng chỉ cần id — action không đọc gì để tự quyết "bấm dồn".
    expect(h.intentFindFirst.mock.calls[0]![0]).toEqual({
      where: { id: "pos1", paymentBill: { orderId: "don1" } },
      select: { id: true },
    });
  });

  it("[POS2-CD-06b] lưới ghim: thân kiemTraPhieuPosAction KHÔNG còn đọc lastCheckAt / CHONG_BAM_DON_MS", () => {
    const ma = readFileSync(resolve(process.cwd(), "app/(admin)/admin/orders/_actions.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .map((d) => d.replace(/(^|[^:"'`])\/\/[^\n]*$/, "$1"))
      .join("\n");
    const than = ma.match(/export async function kiemTraPhieuPosAction[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(than, "tìm thấy thân action").not.toBe("");
    expect(than).not.toMatch(/lastCheckAt/);
    expect(than).not.toMatch(/CHONG_BAM_DON_MS/);
    expect([...than.matchAll(/\bkiemTraPhieuPos\(/g)]).toHaveLength(1);
    expect(ma, "không còn import hằng chống bấm dồn vào action").not.toMatch(/CHONG_BAM_DON_MS/);
  });

  it("đầu vào hỏng ⇒ câu lỗi schema, không chạm gì", async () => {
    expect((await taoPhieuPosAction({ orderId: "" })).ok).toBe(false);
    expect((await kiemTraPhieuPosAction(null)).ok).toBe(false);
    expect((await baoAdminPhieuPosAction({ orderId: "don1", intentId: "pos1", ghiChu: "x".repeat(501) })).ok).toBe(false);
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.moPhieuPos).not.toHaveBeenCalled();
  });
});
