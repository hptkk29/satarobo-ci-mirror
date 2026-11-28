import { describe, expect, it } from "vitest";
import { LOI_PHIEN, LOI_SAI_THONG_TIN, loiTuKetQuaSignIn } from "./loi-dang-nhap";

describe("loiTuKetQuaSignIn", () => {
  it("[LDN-01] không lỗi ⇒ null", () => {
    expect(loiTuKetQuaSignIn({ error: undefined })).toBeNull();
  });
  it("[LDN-02] CredentialsSignin ⇒ câu sai thông tin (giữ nguyên câu cũ)", () => {
    expect(loiTuKetQuaSignIn({ error: "CredentialsSignin", code: "credentials" })).toBe(LOI_SAI_THONG_TIN);
  });
  it("[LDN-03] lỗi KHÁC (MissingCSRF…) ⇒ KHÔNG đổ cho mật khẩu", () => {
    const r = loiTuKetQuaSignIn({ error: "MissingCSRF" });
    expect(r).toBe(LOI_PHIEN);
    expect(r).not.toBe(LOI_SAI_THONG_TIN);
  });
  it("[LDN-04] signIn trả undefined ⇒ coi là không có phiên, không im lặng chuyển trang", () => {
    expect(loiTuKetQuaSignIn(undefined)).toBe(LOI_PHIEN);
  });
});
