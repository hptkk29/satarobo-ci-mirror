// @vitest-environment node
/**
 * [DISC-KHA-*] Server action nhận bài DISC: dây nối giữa phiên đăng nhập · trần IP · dịch vụ `lib/disc/nhan`. Không DB, không OTP/ZNS thật, dữ liệu GIẢ.
 * Phần luật (thách đố, trần theo số, ACTIVE chưa đăng nhập) đã có test ở lib/disc/nhan.test.ts; ở đây chỉ ghim DÂY NỐI mà test thuần không thấy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  auth: vi.fn(async () => null as { user?: { id?: string } } | null),
  userFind: vi.fn(async (_a: unknown) => null as { phone: string | null } | null),
  rateLimit: vi.fn(async (_a: { key: string; max: number; windowMs: number }) => ({ success: true })),
  yeuCau: vi.fn(async (_a: Record<string, unknown>) => ({ ok: true as const, cooldownSec: 60 })),
  nhan: vi.fn(async (_a: Record<string, unknown>) => ({ ok: true as const, submissionId: "s1", taoTaiKhoanMoi: false }) as { ok: boolean; submissionId?: string; loi?: string; thongBao?: string }),
}));

vi.mock("@/lib/auth", () => ({ auth: M.auth }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: M.userFind } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: M.rateLimit }));
vi.mock("@/lib/audit/headers", () => ({ getRequestMetadata: async () => ({ ip: "203.0.113.7" }) }));
vi.mock("@/lib/settings/service", () => ({ getSetting: async (k: string) => (k === "otp.ipMaxPerHour" ? 10 : 60) }));
vi.mock("@/lib/disc/nhan", () => ({ yeuCauOtpNhan: M.yeuCau, nhanBaiDisc: M.nhan }));
vi.mock("@/lib/disc/nhan-prisma", () => ({ taoNhanDeps: () => ({ marker: "deps-gia" }) }));

import { claimDiscResult, requestDiscClaimOtp } from "./nhan-disc-actions";

const cu = process.env.DISC_ENABLED;
beforeEach(() => {
  process.env.DISC_ENABLED = "true";
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  if (cu === undefined) delete process.env.DISC_ENABLED;
  else process.env.DISC_ENABLED = cu;
  vi.clearAllMocks();
});

/** Chạy một lời gọi action rồi tua qua sàn thời gian 900 ms. */
async function chay<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(1000);
  return p;
}

describe("[DISC-KHA-01] xin OTP: phiên đăng nhập được chuyển cho dịch vụ", () => {
  it("chưa đăng nhập ⇒ phien=null; đã đăng nhập ⇒ phien={userId, SĐT của chính tài khoản đó}", async () => {
    await chay(requestDiscClaimOtp("0905000111"));
    expect(M.yeuCau.mock.calls[0]![0]).toMatchObject({ soDienThoai: "0905000111", cooldownMacDinhSec: 60, phien: null });

    M.auth.mockResolvedValueOnce({ user: { id: "u1" } });
    M.userFind.mockResolvedValueOnce({ phone: "84905000111" });
    await chay(requestDiscClaimOtp("0905000111"));
    expect(M.yeuCau.mock.calls[1]![0]).toMatchObject({ phien: { userId: "u1", phoneKey: "84905000111" } });
  });
  it("trần IP: khoá theo IP, hết ⇒ từ chối TRƯỚC khi chạm dịch vụ", async () => {
    M.rateLimit.mockResolvedValueOnce({ success: false });
    const r = await chay(requestDiscClaimOtp("0905000111"));
    expect(r.ok).toBe(false);
    expect(M.rateLimit.mock.calls[0]![0]).toMatchObject({ key: "otp:disc-claim:ip:203.0.113.7", max: 10, windowMs: 3_600_000 });
    expect(M.yeuCau).not.toHaveBeenCalled();
  });
  it("cờ tắt hoặc SĐT sai dạng ⇒ không làm gì", async () => {
    delete process.env.DISC_ENABLED;
    expect((await chay(requestDiscClaimOtp("0905000111"))).ok).toBe(false);
    process.env.DISC_ENABLED = "true";
    expect((await chay(requestDiscClaimOtp("abc"))).ok).toBe(false);
    expect(M.yeuCau).not.toHaveBeenCalled();
    expect(M.rateLimit).not.toHaveBeenCalled();
  });
});

describe("[DISC-KHA-02] nhận bài: năm sinh của con đi cùng lượt nhận", () => {
  it("chuyển namSinhCon (và mã, OTP, mật khẩu, phiên) xuống dịch vụ", async () => {
    await chay(claimDiscResult({ soDienThoai: "0905000111", otp: "123456", maNhan: "ABCDE-23456", namSinhCon: "2015", matKhau: "matkhau-gia-1" }));
    expect(M.nhan.mock.calls[0]![0]).toMatchObject({ soDienThoai: "0905000111", otp: "123456", maNhan: "ABCDE-23456", namSinhCon: "2015", matKhau: "matkhau-gia-1", phien: null });
  });
  it("lỗi: trả đúng câu của dịch vụ và canDangNhap chỉ khi loi=CAN_DANG_NHAP", async () => {
    M.nhan.mockResolvedValueOnce({ ok: false, loi: "MA_KHONG_KHOP", thongBao: "chung" });
    expect(await chay(claimDiscResult({ soDienThoai: "0905000111", otp: "123456", maNhan: "x", namSinhCon: "2015" }))).toEqual({ ok: false, error: "chung", canDangNhap: false });
    M.nhan.mockResolvedValueOnce({ ok: false, loi: "CAN_DANG_NHAP", thongBao: "dang-nhap" });
    expect(await chay(claimDiscResult({ soDienThoai: "0905000111", otp: "123456", maNhan: "x", namSinhCon: "2015" }))).toMatchObject({ canDangNhap: true });
  });
  it("trần IP riêng cho lượt nhận (20/giờ), hết ⇒ không chạm dịch vụ", async () => {
    M.rateLimit.mockResolvedValueOnce({ success: false });
    expect((await chay(claimDiscResult({ soDienThoai: "0905000111", otp: "123456", maNhan: "x", namSinhCon: "2015" }))).ok).toBe(false);
    expect(M.rateLimit.mock.calls[0]![0]).toMatchObject({ key: "disc-claim:ip:203.0.113.7", max: 20 });
    expect(M.nhan).not.toHaveBeenCalled();
  });
});
