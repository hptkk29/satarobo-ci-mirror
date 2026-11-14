// R4-01 — token activeSite ký HMAC (C1.3: studentId trong cookie ký, không trên URL). Pure.
import { describe, it, expect } from "vitest";
import { makeToken, verifyToken, signValue } from "@/lib/portal/active-site-token";

const SECRET = "test-portal-secret";

describe("[R4-01] active-site token (C1.3)", () => {
  it("roundtrip: makeToken → verifyToken trả đúng value", () => {
    const tok = makeToken("student-123", SECRET);
    expect(verifyToken(tok, SECRET)).toBe("student-123");
  });

  it("[R4-01-C1.4] đổi value (chuyển sang con khác) mà giữ chữ ký cũ → null", () => {
    const tok = makeToken("student-A", SECRET);
    const forged = "student-B." + tok.split(".")[1]; // value đổi, sig cũ
    expect(verifyToken(forged, SECRET)).toBeNull();
  });

  it("chữ ký sai / secret sai → null", () => {
    const tok = makeToken("student-A", SECRET);
    expect(verifyToken("student-A.deadbeef", SECRET)).toBeNull();
    expect(verifyToken(tok, "secret-khac")).toBeNull();
    expect(verifyToken("no-dot", SECRET)).toBeNull();
  });

  it("signValue ổn định cùng input", () => {
    expect(signValue("x", SECRET)).toBe(signValue("x", SECRET));
  });
});
