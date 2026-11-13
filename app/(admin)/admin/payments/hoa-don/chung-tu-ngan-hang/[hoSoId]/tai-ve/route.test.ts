// @vitest-environment node
//
// Ca [CTR-*] — ROUTE TẢI TỆP CHỨNG TỪ NGÂN HÀNG (P7-E): chỉ kế toán ĐÚNG cơ sở, audit TRƯỚC khi cấp URL, redirect 302 no-store, khoá tệp
// KHÔNG BAO GIỜ ra khỏi server. Khác route hoá đơn: KHÔNG có nhánh «orders:view-pii» (sao kê mang số tài khoản, tên người chuyển).
// Test HÀNH VI cố ý (lưới «audit trước ký» soi chuỗi từng khớp NHẦM vào dòng import — lưới chết).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  findUnique: vi.fn(),
  ghiAudit: vi.fn(async (_i: unknown) => undefined),
  khoOk: vi.fn(() => true),
  kyGet: vi.fn(async (khoa: string, ten: string, ttl: number) => `https://r2.test/${khoa}?ttl=${ttl}&ten=${encodeURIComponent(ten)}`),
}));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ chungTuNganHang: { findUnique: h.findUnique } }) }));
vi.mock("@/lib/finance/hoa-don/kho-tep", () => ({ khoHoaDonDaCauHinh: h.khoOk }));
vi.mock("@/lib/finance/hoa-don/kho-chung-tu", () => ({ kyUrlTaiVeChungTu: h.kyGet }));
vi.mock("@/lib/finance/hoa-don/chung-tu-ngan-hang-db", () => ({ ghiAuditTaiVeChungTu: h.ghiAudit }));

import { GET } from "./route";

const HS = {
  id: "hs1",
  paymentId: "cmpay0000000001abcdef12",
  centerId: "cs1",
  orgUnitId: "ou-cs1",
  trangThai: "DA_TAI_LEN",
  tepKhoa: "chung-tu-ngan-hang/CS1/2026/cmpay0000000001abcdef12/u.pdf" as string | null,
  tepLoai: "pdf" as string | null,
};
const perm = (action: string, centerScope: "ALL" | string[]) => ({ action, scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope });
const KE_TOAN_CS1 = { isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm("payments:confirm", ["cs1"])] };
const KE_TOAN_CS2_THAY_CS1 = { isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm("payments:confirm", ["cs2"]), perm("payments:record", ["cs1"])] };

const goi = (id = "hs1") => GET(new Request(`https://admin.test/payments/hoa-don/chung-tu-ngan-hang/${id}/tai-ve`), { params: Promise.resolve({ hoSoId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Kế toán" } });
  h.checkPermission.mockImplementation(async (k: string) => k === "payments:confirm");
  h.resolveActor.mockResolvedValue(KE_TOAN_CS1);
  h.findUnique.mockResolvedValue({ ...HS });
  h.khoOk.mockReturnValue(true);
});

describe("[CTR-01] ai tải được", () => {
  it("đối chứng DƯƠNG: kế toán đúng cơ sở ⇒ 302 no-store tới URL ký 300 giây, tên tải về không mang PII", async () => {
    const res = await goi();
    expect(res.status).toBe(302);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const dich = res.headers.get("location") ?? "";
    expect(dich).toContain("ttl=300");
    expect(decodeURIComponent(dich)).toContain("chung-tu-ngan-hang-abcdef12.pdf");
  });

  it("KHÔNG có nhánh PII: người có `orders:view-pii` nhưng không là kế toán ⇒ 403; kế toán nhưng khác cơ sở ⇒ 404 (không lộ sự tồn tại)", async () => {
    h.checkPermission.mockImplementation(async (k: string) => k === "orders:view-pii");
    expect((await goi()).status).toBe(403);
    h.checkPermission.mockImplementation(async (k: string) => k === "payments:confirm");
    h.resolveActor.mockResolvedValue(KE_TOAN_CS2_THAY_CS1);
    expect((await goi()).status).toBe(404);
    expect(h.kyGet).not.toHaveBeenCalled();
    expect(h.ghiAudit).not.toHaveBeenCalled();
  });

  it("cờ tắt ⇒ 404 TRƯỚC khi đăng nhập; chưa đăng nhập ⇒ 401; hồ sơ không thấy ⇒ 404", async () => {
    h.bat.mockResolvedValue(false);
    expect((await goi()).status).toBe(404);
    expect(h.auth).not.toHaveBeenCalled();
    h.bat.mockResolvedValue(true);
    h.auth.mockResolvedValue(null);
    expect((await goi()).status).toBe(401);
    h.auth.mockResolvedValue({ user: { id: "u1" } });
    h.findUnique.mockResolvedValue(null);
    expect((await goi()).status).toBe(404);
  });

  it("hồ sơ chưa có tệp ⇒ 404; kho chưa cấu hình ⇒ 503 (không ký)", async () => {
    h.findUnique.mockResolvedValue({ ...HS, tepKhoa: null, tepLoai: null });
    expect((await goi()).status).toBe(404);
    h.findUnique.mockResolvedValue({ ...HS });
    h.khoOk.mockReturnValue(false);
    expect((await goi()).status).toBe(503);
    expect(h.kyGet).not.toHaveBeenCalled();
  });
});

describe("[CTR-02] audit TRƯỚC khi ký — audit ném ⇒ 503 và KHÔNG ký", () => {
  it("thứ tự: audit rồi mới ký; audit mang id hồ sơ + khoản + trạng thái, KHÔNG mang khoá tệp", async () => {
    await goi();
    expect(h.ghiAudit).toHaveBeenCalledTimes(1);
    expect(h.ghiAudit.mock.invocationCallOrder[0]!).toBeLessThan(h.kyGet.mock.invocationCallOrder[0]!);
    const tham = h.ghiAudit.mock.calls[0]![0] as { nguoi: { id: string }; hoSo: Record<string, unknown> };
    expect(tham.nguoi.id).toBe("u1");
    expect(tham.hoSo).toEqual({ id: "hs1", paymentId: HS.paymentId, trangThai: "DA_TAI_LEN", orgUnitId: "ou-cs1", centerId: "cs1" });
    expect(JSON.stringify(tham)).not.toContain("chung-tu-ngan-hang/");
  });

  it("audit ném ⇒ 503, không ký URL", async () => {
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.ghiAudit.mockRejectedValueOnce(new Error("audit hỏng"));
    const res = await goi();
    expect(res.status).toBe(503);
    expect(h.kyGet).not.toHaveBeenCalled();
    loi.mockRestore();
  });

  it("ký URL ném ⇒ 503 (không rò lỗi kho)", async () => {
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.kyGet.mockRejectedValueOnce(new Error("R2 down"));
    const res = await goi();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("R2 down");
    loi.mockRestore();
  });
});
