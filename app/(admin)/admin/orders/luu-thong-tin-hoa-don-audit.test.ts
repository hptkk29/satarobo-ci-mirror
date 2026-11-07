// @vitest-environment node
/**
 * Ca [TTHD-*] — CỔNG của `luuThongTinHoaDonAction` (khối «Người mua trên hoá đơn», 8 ô — 01/11/2026).
 *
 * Phiên bản trước của file này (TTHD-01..06) kiểm VẾT + CAS bằng một transaction giả. Từ 01/11 phép ghi chuyển
 * sang `lib/finance/hoa-don/ghi-nguoi-mua.ts` (một transaction KHÔNG scope ghi đơn + hồ sơ) nên những ca đó đã dời
 * sang Postgres thật — `tests/finance/ghi-nguoi-mua-db.test.ts`: vết cùng transaction và chỉ-tên-cột cho CCCD
 * ([HDN-DB-05]), CAS `updatedAt` ([HDN-DB-09]), không đẻ vết rỗng ([HDN-DB-12]). Giả lập transaction ở đây là kiểm
 * cái giả.
 *
 * Còn lại ở đây là phần CỔNG của action — thứ lib KHÔNG tự kiểm (giao kèo ghi ở đầu lib):
 *   · đăng nhập + (`orders:manage` HOẶC `orders:edit-invoice-buyer`) + `orders:view-pii` ĐỨNG TRƯỚC mọi đọc / ghi; luật «ai sửa được đơn nào» (Sale chỉ đơn mình tạo, đơn đã xuất hoá đơn thì không ai sửa) = `quyenSuaNguoiMua` [TTHD-A8..A11];
 *   · đầu vào sai bị chặn TRƯỚC khi chạm DB;
 *   · đơn ngoài phạm vi cơ sở ⇒ từ chối, lib không được gọi;
 *   · hai quyền riêng của phần ghi sang HỒ SƠ (`students:edit`, `payments:view-pii`) được hỏi ĐÚNG khoá và truyền
 *     xuống; cổng cơ sở của học viên là `passesScope("Student", …)`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
  orderFind: vi.fn(),
  ghi: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  daXuat: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn, revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: vi.fn(() => ({ order: { findUnique: h.orderFind } })),
}));
vi.mock("@/lib/finance/hoa-don/ghi-nguoi-mua", () => ({ ghiNguoiMuaHoaDon: h.ghi }));
// Phần đọc DB «đơn đã xuất hoá đơn chưa» giả lập; luật `quyenSuaNguoiMua` giữ NGUYÊN BẢN THẬT (đó là thứ cần kiểm).
vi.mock("@/lib/finance/hoa-don/quyen-sua-nguoi-mua", async (goc) => ({ ...(await goc<typeof import("@/lib/finance/hoa-don/quyen-sua-nguoi-mua")>()), docDonDaXuatHoaDon: h.daXuat }));
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

import { luuThongTinHoaDonAction } from "./_actions";
import { FORM_TRONG, type FormNguoiMua } from "@/lib/finance/hoa-don/form-nguoi-mua";

const LUC = new Date("2026-11-01T02:00:00.000Z");
const FORM: FormNguoiMua = { ...FORM_TRONG, hocVienTen: "Nguyễn Đức Huy Hoàng", phuHuynhTen: "Phan Thị Hồng", phuHuynhEmail: "hong@example.com" };
const KET_QUA_OK = {
  stale: false as const,
  doi: [],
  con: [],
  canhBao: null,
  dongBo: { muc: "HOC_VIEN" as const, daGhi: [], boQua: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale", name: "Sale CS1" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue({ userId: "u-sale" });
  h.passesScope.mockReturnValue(true);
  h.orderFind.mockResolvedValue({ id: "don1", centerId: "cs1", createdById: "u-sale" });
  h.daXuat.mockResolvedValue(false);
  h.redirect.mockReset();
  h.ghi.mockResolvedValue(KET_QUA_OK);
});

describe("[TTHD] luuThongTinHoaDonAction — cổng", () => {
  it("[TTHD-A1] thiếu orders:view-pii (có orders:manage) ⇒ từ chối TRƯỚC mọi đọc / ghi; đối chứng: có quyền ⇒ ghi", async () => {
    h.checkPermission.mockImplementation(async (p: string) => p !== "orders:view-pii");
    const res = await luuThongTinHoaDonAction("don1", { form: FORM, banDau: FORM }, LUC.toISOString());
    expect(res).toEqual({ ok: false, error: "Cần quyền xem thông tin khách để sửa người mua trên hoá đơn" });
    expect(h.checkPermission).toHaveBeenCalledWith("orders:view-pii");
    expect(h.orderFind).not.toHaveBeenCalled();
    expect(h.ghi).not.toHaveBeenCalled();

    h.checkPermission.mockResolvedValue(true);
    expect((await luuThongTinHoaDonAction("don1", { form: FORM, banDau: FORM }, LUC.toISOString())).ok).toBe(true);
    expect(h.ghi).toHaveBeenCalledTimes(1);
  });

  it("[TTHD-A2] đầu vào sai (CCCD 5 số, email hỏng, ngày sinh tương lai, quá dài) ⇒ lỗi và KHÔNG chạm DB", async () => {
    const goc = { ...FORM_TRONG };
    for (const sai of [
      { hocVienCccd: "12345" },
      { phuHuynhEmail: "khong-phai-email" },
      { hocVienNgaySinh: "2099-01-01" },
      { hocVienTen: "a".repeat(201) },
    ]) {
      const res = await luuThongTinHoaDonAction("don1", { form: { ...goc, ...sai }, banDau: goc }, LUC.toISOString());
      expect(res.ok, JSON.stringify(sai)).toBe(false);
    }
    expect(h.orderFind).not.toHaveBeenCalled();
    expect(h.ghi).not.toHaveBeenCalled();
  });

  it("[TTHD-A3] đơn ngoài phạm vi ⇒ 'Không tìm thấy đơn hàng', lõi ghi KHÔNG được gọi", async () => {
    h.passesScope.mockReturnValue(false);
    expect(await luuThongTinHoaDonAction("don1", { form: FORM, banDau: FORM }, LUC.toISOString())).toEqual({
      ok: false,
      error: "Không tìm thấy đơn hàng",
    });
    expect(h.ghi).not.toHaveBeenCalled();
    h.passesScope.mockReturnValue(true);
    h.orderFind.mockResolvedValue(null);
    expect((await luuThongTinHoaDonAction("don1", { form: FORM, banDau: FORM }, LUC.toISOString())).ok).toBe(false);
    expect(h.ghi).not.toHaveBeenCalled();
  });

  it("[TTHD-A4] bản đã thấy hỏng / lõi báo stale ⇒ STALE_WRITE", async () => {
    expect(await luuThongTinHoaDonAction("don1", { form: FORM, banDau: FORM }, "không-phải-ngày")).toEqual({ ok: false, error: "STALE_WRITE" });
    expect(h.ghi).not.toHaveBeenCalled();
    h.ghi.mockResolvedValue({ stale: true });
    expect(await luuThongTinHoaDonAction("don1", { form: FORM, banDau: FORM }, LUC.toISOString())).toEqual({ ok: false, error: "STALE_WRITE" });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("[TTHD-A5] truyền xuống lõi: form đã chuẩn hoá (trim, thiếu khoá ⇒ ''), người sửa, bản đã thấy, và ĐÚNG hai quyền hồ sơ", async () => {
    h.checkPermission.mockImplementation(async (p: string) => p !== "payments:view-pii");
    await luuThongTinHoaDonAction(
      "don1",
      { form: { ...FORM, phuHuynhTen: "  Phan Thị Hồng  " }, banDau: { hocVienTen: "Tên cũ" } as unknown as FormNguoiMua },
      LUC.toISOString(),
    );
    const arg = h.ghi.mock.calls[0]![0] as {
      orderId: string; expectedUpdatedAt: Date; form: FormNguoiMua; banDau: FormNguoiMua;
      actor: { id: string; name: string }; quyen: { suaHoSo: boolean; cccdHoSo: boolean; hocVienTrongTam: (s: object) => boolean };
    };
    expect(arg.orderId).toBe("don1");
    expect(arg.expectedUpdatedAt).toEqual(LUC);
    expect(arg.form.phuHuynhTen).toBe("Phan Thị Hồng");
    expect(arg.banDau).toEqual({ ...FORM_TRONG, hocVienTen: "Tên cũ" });
    expect(arg.actor).toEqual({ id: "u-sale", name: "Sale CS1" });
    expect(arg.quyen.suaHoSo).toBe(true);
    expect(arg.quyen.cccdHoSo).toBe(false);
    expect(h.checkPermission).toHaveBeenCalledWith("students:edit");
    expect(h.checkPermission).toHaveBeenCalledWith("payments:view-pii");
  });

  it("[TTHD-A6] cổng cơ sở của học viên là passesScope('Student', …) với actor thật", async () => {
    await luuThongTinHoaDonAction("don1", { form: FORM, banDau: FORM }, LUC.toISOString());
    const { quyen } = h.ghi.mock.calls[0]![0] as { quyen: { hocVienTrongTam: (s: object) => boolean } };
    h.passesScope.mockClear();
    h.passesScope.mockReturnValue(false);
    const s = { id: "hv1", centerId: "cs2", orgUnitId: null };
    expect(quyen.hocVienTrongTam(s)).toBe(false);
    expect(h.passesScope).toHaveBeenCalledWith("Student", s, { userId: "u-sale" });
  });

  it("[TTHD-A7] thành công: trả cảnh báo + kết quả đồng bộ; làm mới trang đơn; chỉ làm mới /students khi hồ sơ thật sự đổi", async () => {
    h.ghi.mockResolvedValue({ ...KET_QUA_OK, doi: ["invoiceBuyerName"], canhBao: "cảnh báo", dongBo: { muc: "HOC_VIEN", daGhi: ["phuHuynhTen"], boQua: [] } });
    const res = await luuThongTinHoaDonAction("don1", { form: FORM, banDau: FORM }, LUC.toISOString());
    expect(res).toEqual({ ok: true, canhBao: "cảnh báo", dongBo: { muc: "HOC_VIEN", daGhi: ["phuHuynhTen"], boQua: [] } });
    expect(h.revalidatePath).toHaveBeenCalledWith("/orders/don1");
    expect(h.revalidatePath).toHaveBeenCalledWith("/students");

    h.revalidatePath.mockClear();
    h.ghi.mockResolvedValue(KET_QUA_OK);
    await luuThongTinHoaDonAction("don1", { form: FORM, banDau: FORM }, LUC.toISOString());
    expect(h.revalidatePath).toHaveBeenCalledWith("/orders/don1");
    expect(h.revalidatePath).not.toHaveBeenCalledWith("/students");
  });

  // ── 06/11/2026 — Sale sửa người mua trên hoá đơn: quyền hẹp + «đơn của mình» + «chưa xuất» ──
  const chiCo = (...quyen: string[]) => h.checkPermission.mockImplementation(async (p: string) => quyen.includes(p));
  const goi = () => luuThongTinHoaDonAction("don1", { form: FORM, banDau: FORM }, LUC.toISOString());

  it("[TTHD-A8] Sale (chỉ `orders:edit-invoice-buyer` + `orders:view-pii`) sửa đơn do CHÍNH MÌNH TẠO ⇒ ghi được", async () => {
    chiCo("orders:edit-invoice-buyer", "orders:view-pii");
    expect((await goi()).ok).toBe(true);
    expect(h.ghi).toHaveBeenCalledTimes(1);
  });

  it("[TTHD-A9] Sale sửa đơn của NGƯỜI KHÁC ⇒ từ chối, lõi KHÔNG được gọi; đối chứng: người có `orders:manage` sửa đúng đơn đó được", async () => {
    h.orderFind.mockResolvedValue({ id: "don1", centerId: "cs1", createdById: "u-khac" });
    chiCo("orders:edit-invoice-buyer", "orders:view-pii");
    const res = await goi();
    expect(res).toEqual({ ok: false, error: "Bạn chỉ sửa được người mua trên hoá đơn của đơn do chính bạn tạo." });
    expect(h.ghi).not.toHaveBeenCalled();

    chiCo("orders:manage", "orders:view-pii");
    expect((await goi()).ok).toBe(true);
    expect(h.ghi).toHaveBeenCalledTimes(1);
  });

  it("[TTHD-A10] đơn ĐÃ XUẤT hoá đơn ⇒ từ chối với MỌI vai (kể cả `orders:manage`), lõi KHÔNG được gọi; đối chứng: chưa xuất thì ghi được", async () => {
    h.daXuat.mockResolvedValue(true);
    for (const quyen of [
      ["orders:manage", "orders:view-pii"],
      ["orders:edit-invoice-buyer", "orders:view-pii"],
      ["orders:manage", "orders:edit-invoice-buyer", "orders:view-pii"],
    ]) {
      chiCo(...quyen);
      const res = await goi();
      expect(res.ok).toBe(false);
      expect(res).toMatchObject({ error: expect.stringContaining("Đơn đã xuất hoá đơn") });
    }
    expect(h.ghi).not.toHaveBeenCalled();
    h.daXuat.mockResolvedValue(false);
    chiCo("orders:manage", "orders:view-pii");
    expect((await goi()).ok).toBe(true);
  });

  it("[TTHD-A11] không có `orders:manage` lẫn quyền hẹp ⇒ chuyển hướng TRƯỚC mọi đọc / ghi (không nạp đơn, không đọc hoá đơn)", async () => {
    h.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    chiCo("orders:view-pii");
    await expect(goi()).rejects.toThrow("NEXT_REDIRECT");
    expect(h.orderFind).not.toHaveBeenCalled();
    expect(h.daXuat).not.toHaveBeenCalled();
    expect(h.ghi).not.toHaveBeenCalled();
  });
});
