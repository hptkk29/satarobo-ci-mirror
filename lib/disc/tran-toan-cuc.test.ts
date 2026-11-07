import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));

import { CUA_SO_TRAN_TOAN_CUC_MS, TRAN_BAI_MOI_TOAN_CUC_MAC_DINH, TRAN_OTP_CLAIM_TOAN_CUC_MAC_DINH, docTranToanCuc } from "./chinh-sach";
import { choPhepBaiMoiToanCuc, choPhepOtpClaimToanCuc, tranBaiMoiToanCuc, tranOtpClaimToanCuc } from "./tran-toan-cuc";

beforeEach(() => {
  m.rateLimit.mockReset();
  m.rateLimit.mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
});

describe("[DISC-CS-20] S-04: đọc trần toàn cục từ env", () => {
  it("số nguyên dương thập phân ⇒ dùng; còn lại ⇒ mặc định (không bao giờ 0/âm/NaN/vô hạn)", () => {
    expect(docTranToanCuc("500", 7)).toBe(500);
    expect(docTranToanCuc(" 42 ", 7)).toBe(42);
    for (const x of [undefined, "", "abc", "0", "-5", "1e3", "12.5", "Infinity", "NaN", "9999999999", "007x"]) expect(docTranToanCuc(x, 7)).toBe(7);
  });
  it("mặc định hợp lý và env ghi đè", () => {
    expect(tranBaiMoiToanCuc({})).toBe(TRAN_BAI_MOI_TOAN_CUC_MAC_DINH);
    expect(tranOtpClaimToanCuc({})).toBe(TRAN_OTP_CLAIM_TOAN_CUC_MAC_DINH);
    expect(tranBaiMoiToanCuc({ DISC_TRAN_BAI_MOI_NGAY: "12" })).toBe(12);
    expect(tranOtpClaimToanCuc({ DISC_TRAN_OTP_CLAIM_NGAY: "34" })).toBe(34);
  });
});

describe("[DISC-TC-01] S-04: cầu chì ngân sách toàn cục", () => {
  it("bài mới: khoá CỐ ĐỊNH (không chứa IP/SĐT), cửa sổ 24 giờ, trần theo env; chạm trần ⇒ false", async () => {
    expect(await choPhepBaiMoiToanCuc({ DISC_TRAN_BAI_MOI_NGAY: "12" })).toBe(true);
    expect(m.rateLimit).toHaveBeenCalledWith({ key: "disc:luu:toan-cuc:ngay", max: 12, windowMs: CUA_SO_TRAN_TOAN_CUC_MS });
    m.rateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    expect(await choPhepBaiMoiToanCuc({})).toBe(false);
  });
  it("OTP claim: khoá riêng, cửa sổ 24 giờ; chạm trần ⇒ false", async () => {
    expect(await choPhepOtpClaimToanCuc({ DISC_TRAN_OTP_CLAIM_NGAY: "34" })).toBe(true);
    expect(m.rateLimit).toHaveBeenCalledWith({ key: "disc:otp-claim:toan-cuc:ngay", max: 34, windowMs: CUA_SO_TRAN_TOAN_CUC_MS });
    m.rateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    expect(await choPhepOtpClaimToanCuc({})).toBe(false);
  });
  it("hạ tầng đếm lỗi ⇒ ném (route bắt và trả 503 chung — fail-closed), không âm thầm cho qua", async () => {
    m.rateLimit.mockRejectedValueOnce(new Error("redis"));
    await expect(choPhepBaiMoiToanCuc({})).rejects.toThrow();
  });
});
