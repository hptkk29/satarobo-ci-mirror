import { describe, expect, it } from "vitest";

import { MOBILE_AUTH } from "./hang-so";
import { bamBiMat, bamKhoaDem, bamKhop, ghepToken, phatCapToken, sinhMaTra, tachToken } from "./token";

/** Token di động — hàm thuần. Mã ca: MT (token). */
describe("token di động", () => {
  it("[MT-01] dạng token: tiền tố + mã tra 22 ký tự + bí mật 43 ký tự (base64url); ghép rồi tách ra đúng", () => {
    const maTra = sinhMaTra();
    expect(maTra).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const cap = phatCapToken(maTra);
    expect(cap.accessToken).toMatch(/^sma_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(cap.refreshToken).toMatch(/^smr_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    const a = tachToken(cap.accessToken, "access");
    expect(a?.maTra).toBe(maTra);
    expect(bamBiMat(a!.biMat)).toBe(cap.accessHash);
    expect(tachToken(cap.refreshToken, "refresh")?.maTra).toBe(maTra);
  });

  it("[MT-02] sai tiền tố / sai dạng / không phải chuỗi ⇒ null; access gửi vào chỗ refresh (và ngược lại) ⇒ null (dòng R0)", () => {
    const cap = phatCapToken(sinhMaTra());
    expect(tachToken(cap.accessToken, "refresh")).toBeNull();
    expect(tachToken(cap.refreshToken, "access")).toBeNull();
    for (const x of [undefined, null, 42, {}, "", "sma_", "sma_abc.def", `${cap.accessToken}.x`, cap.accessToken.replace(".", "-"), `sma_${"A".repeat(22)}.${"A".repeat(42)}`, "x".repeat(500)]) {
      expect([x, tachToken(x, "access")]).toEqual([x, null]);
    }
  });

  it("[MT-03] mỗi lần phát là một cặp NGẪU NHIÊN khác; access ≠ refresh; băm là SHA-256 hex 64", () => {
    const m = sinhMaTra();
    const a = phatCapToken(m);
    const b = phatCapToken(m);
    expect(a.accessToken).not.toBe(b.accessToken);
    expect(a.refreshToken).not.toBe(b.refreshToken);
    expect(a.accessToken.split(".")[1]).not.toBe(a.refreshToken.split(".")[1]);
    for (const h of [a.accessHash, a.refreshHash]) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sinhMaTra()).not.toBe(sinhMaTra());
  });

  it("[MT-04] so băm: đúng ⇒ true; sai / thiếu / sai dạng ⇒ false, không ném", () => {
    const h = bamBiMat("x".repeat(43));
    expect(bamKhop(h, h)).toBe(true);
    expect(bamKhop(h, bamBiMat("y".repeat(43)))).toBe(false);
    for (const x of [null, undefined, "", "abc", "g".repeat(64), "A".repeat(64)]) expect(bamKhop(h, x)).toBe(false);
    expect(bamKhop(null, null)).toBe(false);
  });

  it("[MT-05] khoá bộ đếm: khác ngăn / khác giá trị ⇒ khác khoá; không chứa giá trị rõ", () => {
    const k = bamKhoaDem("login:id", "84966100001");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toContain("84966100001");
    expect(bamKhoaDem("login:ip", "84966100001")).not.toBe(k);
    expect(bamKhoaDem("login:id", "84966100002")).not.toBe(k);
    expect(bamKhoaDem("login:id", "84966100001")).toBe(k);
  });

  it("[MT-06] hằng số đúng đề xuất tài liệu: access 15 phút · không dùng 30 ngày · tuyệt đối 180 ngày · 5 phiên · 10/IP + 5/định danh mỗi phút (bằng web)", () => {
    expect(MOBILE_AUTH.accessTtlMs).toBe(15 * 60_000);
    expect(MOBILE_AUTH.khongDungTtlMs).toBe(30 * 86_400_000);
    expect(MOBILE_AUTH.tuyetDoiTtlMs).toBe(180 * 86_400_000);
    expect(MOBILE_AUTH.toiDaPhienSong).toBe(5);
    expect(MOBILE_AUTH.dangNhap).toEqual({ cuaSoMs: 60_000, nguongIp: 10, nguongDinhDanh: 5 });
    expect(ghepToken("access", "A".repeat(22), "B".repeat(43))).toBe(`sma_${"A".repeat(22)}.${"B".repeat(43)}`);
  });
});
