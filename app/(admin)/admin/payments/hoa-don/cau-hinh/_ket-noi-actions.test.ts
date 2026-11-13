// Ca [KNA-*] — cổng của action «Kết nối & ký»: [BGĐ 04/11/2026] CHỈ Quản trị tối cao (`settings:edit`) chạm được tầng ghi — kế toán Hội sở (có payments:confirm) cũng bị từ chối; mật khẩu chỉ đi vào, không bao giờ đi ra.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  auth: vi.fn(async () => ({ user: { id: "u1", name: "Kế toán HO" } }) as unknown),
  checkPermission: vi.fn(async (_k: string) => true),
  resolveActor: vi.fn(),
  luu: vi.fn(async (_i: unknown) => ({ ok: true as const, id: "kn1", doiMatKhau: true, truongDoi: ["dangBat"] })),
  docTk: vi.fn(),
  ghi: vi.fn(async (_i: unknown) => undefined),
  rateLimit: vi.fn(async () => ({ success: true, remaining: 9, resetAt: 0 })),
  kiemTra: vi.fn(async (_mst: string): Promise<string> => "OK"),
  revalidatePath: vi.fn(),
  production: vi.fn(() => false),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/security/client-ip", () => ({ laProductionThat: h.production }));
vi.mock("@/lib/finance/hoa-don/ket-noi/ket-noi-db", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/ket-noi/ket-noi-db")>()),
  luuKetNoi: h.luu,
  docTaiKhoanKetNoi: h.docTk,
  ghiKetQuaKiemTra: h.ghi,
}));
vi.mock("@/lib/vin-hoadon/http", () => ({ taoCongVin: () => ({ kiemTraDangNhap: h.kiemTra }) }));

import { kiemTraKetNoiAction, luuKetNoiAction } from "./_ket-noi-actions";

const actor = (centerScope: "ALL" | string[]) =>
  ({ userId: "u1", isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope }] }) as unknown as Actor;
const MAT_KHAU = "Mat-Khau-Bi-Mat-9z";

const IN = {
  phapNhanMa: "NEW_VISION",
  moiTruong: "SANDBOX",
  nhaCungCapMa: "VIN_HOADON",
  dangBat: true,
  baseUrl: "https://demows.vin-hoadon.com",
  mst: "0402341070",
  tenDangNhap: "ketoan",
  phuongThucKy: "USB_TOKEN",
  cheDoKy: "LO",
  chungThuSerial: "5400FA1B2C3D",
  chungThuHetHan: "2027-05-01",
  matKhauMoi: MAT_KHAU,
  lyDo: "Khai kết nối VIN lần đầu cho CS2",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Kế toán HO" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue(actor("ALL"));
  h.production.mockReturnValue(false);
  h.rateLimit.mockResolvedValue({ success: true, remaining: 9, resetAt: 0 });
});

describe("[KNA-L] luuKetNoiAction — cổng", () => {
  it("[KNA-L1] đối chứng dương: Quản trị tối cao (settings:edit), đủ cờ ⇒ gọi lớp ghi MỘT lần với mật khẩu nguyên văn (không cắt khoảng trắng); kết quả KHÔNG chứa mật khẩu", async () => {
    const r = await luuKetNoiAction({ ...IN, matKhauMoi: "  mk có khoảng trắng  " });
    expect(r).toEqual({ ok: true, data: { id: "kn1", doiMatKhau: true } });
    expect(h.luu).toHaveBeenCalledTimes(1);
    expect((h.luu.mock.calls[0]![0] as { matKhauMoi: string }).matKhauMoi).toBe("  mk có khoảng trắng  ");
    expect(JSON.stringify(r)).not.toContain("mk có");
    expect(h.revalidatePath).toHaveBeenCalled();
    expect(h.checkPermission).toHaveBeenCalledWith("settings:edit");
  });

  it("[KNA-L1b] kế toán HỘI SỞ có payments:confirm nhưng KHÔNG có settings:edit ⇒ từ chối, không chạm tầng ghi (trước 04/11 họ được sửa)", async () => {
    h.checkPermission.mockImplementation(async (k: string) => k === "payments:confirm");
    const r = await luuKetNoiAction(IN);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/Quản trị tối cao/);
    expect(h.luu).not.toHaveBeenCalled();
    h.checkPermission.mockReset();
    h.checkPermission.mockResolvedValue(true);
  });

  it.each([
    ["màn hoá đơn tắt", () => h.bat.mockResolvedValueOnce(false), /chưa được bật/],
    ["chưa đăng nhập", () => h.auth.mockResolvedValueOnce(null), /Chưa đăng nhập/],
    ["thiếu settings:edit", () => h.checkPermission.mockResolvedValueOnce(false), /Quản trị tối cao/],
  ])("[KNA-L2] %s ⇒ từ chối, KHÔNG chạm tầng ghi", async (_t, chuanBi, kyVong) => {
    chuanBi();
    const r = await luuKetNoiAction(IN);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(kyVong);
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("[KNA-L3] dữ liệu sai hình dạng ⇒ từ chối trước mọi cổng (không đăng nhập, không ghi)", async () => {
    for (const hong of [null, {}, { ...IN, moiTruong: "STAGING" }, { ...IN, nhaCungCapMa: "KHAC" }, { ...IN, matKhauMoi: "x".repeat(201) }, { ...IN, phapNhanMa: "" }]) {
      const r = await luuKetNoiAction(hong);
      expect(r).toEqual({ ok: false, error: "Yêu cầu không hợp lệ" });
    }
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("[KNA-L4] chỉ lưu môi trường ĐANG CHẠY: máy test chỉ SANDBOX, máy production chỉ PROD", async () => {
    expect((await luuKetNoiAction({ ...IN, moiTruong: "PROD" })).ok).toBe(false);
    expect(h.luu).not.toHaveBeenCalled();
    h.production.mockReturnValue(true);
    expect((await luuKetNoiAction({ ...IN, moiTruong: "SANDBOX" })).ok).toBe(false);
    expect((await luuKetNoiAction({ ...IN, moiTruong: "PROD" })).ok).toBe(true);
  });

  it("[KNA-L5] lỗi từ lớp ghi được chuyển nguyên, không thêm gì (không rò dữ liệu đầu vào)", async () => {
    h.luu.mockResolvedValueOnce({ ok: false, error: "Thiếu mật khẩu VIN." } as never);
    const r = await luuKetNoiAction(IN);
    expect(r).toEqual({ ok: false, error: "Thiếu mật khẩu VIN." });
    expect(JSON.stringify(r)).not.toContain(MAT_KHAU);
  });
});

describe("[KNA-K] kiemTraKetNoiAction", () => {
  const TK_OK = { hang: { nhaCungCapMa: "VIN_HOADON" }, cauHinhVin: { cheDo: "sandbox", baseUrl: "https://x.example.test", username: "u", password: MAT_KHAU }, loi: null, mst: "0402341070" };

  it("[KNA-K1] đối chứng dương: Hội sở + kết nối đủ ⇒ đăng nhập thử, GHI mã cố định, trả mã (không trả địa chỉ/mật khẩu)", async () => {
    h.docTk.mockResolvedValue(TK_OK);
    const r = await kiemTraKetNoiAction({ phapNhanMa: "NEW_VISION" });
    expect(r).toEqual({ ok: true, data: { ma: "OK" } });
    expect(h.kiemTra).toHaveBeenCalledWith("0402341070");
    expect(h.ghi).toHaveBeenCalledWith(expect.objectContaining({ phapNhanMa: "NEW_VISION", moiTruong: "SANDBOX", ketQua: "OK" }));
    expect(JSON.stringify(r)).not.toContain(MAT_KHAU);
    expect(h.docTk).toHaveBeenCalledWith("NEW_VISION", "SANDBOX", undefined, { choKiemTra: true });
  });

  it.each([
    ["thiếu settings:edit (kể cả kế toán Hội sở)", () => h.checkPermission.mockResolvedValueOnce(false)],
    ["quá giới hạn kiểm tra", () => h.rateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 })],
  ])("[KNA-K2] %s ⇒ từ chối, KHÔNG đăng nhập thử", async (_t, chuanBi) => {
    h.docTk.mockResolvedValue(TK_OK);
    chuanBi();
    const r = await kiemTraKetNoiAction({ phapNhanMa: "NEW_VISION" });
    expect(r.ok).toBe(false);
    expect(h.kiemTra).not.toHaveBeenCalled();
    expect(h.ghi).not.toHaveBeenCalled();
  });

  it("[KNA-K3] chưa khai · MISA · thiếu khoá · không giải mã được · thiếu thông tin ⇒ câu rõ, KHÔNG đăng nhập thử, KHÔNG ghi kết quả", async () => {
    const ca: [unknown, RegExp][] = [
      [{ hang: null, cauHinhVin: null, loi: null, mst: null }, /Chưa khai kết nối/],
      [{ hang: { nhaCungCapMa: "MISA_MEINVOICE" }, cauHinhVin: null, loi: null, mst: null }, /MISA/],
      [{ hang: { nhaCungCapMa: "VIN_HOADON" }, cauHinhVin: null, loi: "KHOA_THIEU", mst: "1" }, /HOA_DON_KHOA_BI_MAT/],
      [{ hang: { nhaCungCapMa: "VIN_HOADON" }, cauHinhVin: null, loi: "KHONG_GIAI_MA_DUOC", mst: "1" }, /giải mã/],
      [{ hang: { nhaCungCapMa: "VIN_HOADON" }, cauHinhVin: null, loi: null, mst: null }, /chưa đủ/],
    ];
    for (const [tk, kyVong] of ca) {
      h.docTk.mockResolvedValueOnce(tk);
      const r = await kiemTraKetNoiAction({ phapNhanMa: "NEW_VISION" });
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(kyVong);
    }
    expect(h.kiemTra).not.toHaveBeenCalled();
    expect(h.ghi).not.toHaveBeenCalled();
  });

  it("[KNA-K4] mã lỗi của nhà cung cấp được ghi nguyên (DANG_NHAP_SAI) — kết quả xấu cũng phải thấy được", async () => {
    h.docTk.mockResolvedValue(TK_OK);
    h.kiemTra.mockResolvedValueOnce("DANG_NHAP_SAI");
    const r = await kiemTraKetNoiAction({ phapNhanMa: "NEW_VISION" });
    expect(r).toEqual({ ok: true, data: { ma: "DANG_NHAP_SAI" } });
    expect(h.ghi).toHaveBeenCalledWith(expect.objectContaining({ ketQua: "DANG_NHAP_SAI" }));
  });
});
