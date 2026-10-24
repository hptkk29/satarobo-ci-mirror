// A0-05 — login chung + redirect theo role (decideRoute + sanitizeCallbackUrl).
// Lõi đã có từ auth-hardening; test này ánh xạ AC A0-05. Pure, không DB/browser.
import { describe, it, expect } from "vitest";
import { decideRoute, sanitizeCallbackUrl } from "@/lib/auth/route-policy";

describe("[A0-05] login chung + redirect theo role", () => {
  it("[A0-05-T1-01] staff login (admin host) → /dashboard (AC1)", () => {
    const d = decideRoute({ hostKind: "admin", pathname: "/login", role: "SUPER_ADMIN", sessionValid: true });
    expect(d).toEqual({ type: "redirectPath", path: "/dashboard" });
  });

  it("[A0-05-T1-02] parent login (portal host) → / (AC2)", () => {
    const d = decideRoute({ hostKind: "portal", pathname: "/login", role: "PARENT", sessionValid: true });
    expect(d).toEqual({ type: "redirectPath", path: "/" });
  });

  it("[A0-05-T1-03] anonymous vào admin route → /login giữ callbackUrl (AC3)", () => {
    const d = decideRoute({ hostKind: "admin", pathname: "/leads", role: null, sessionValid: false });
    expect(d).toMatchObject({ type: "redirectPath", path: "/login", callbackUrl: "/leads" });
  });

  it("[A0-05-T4-01] parent cố vào admin route → redirect portal (AC4)", () => {
    const d = decideRoute({ hostKind: "admin", pathname: "/leads", role: "PARENT", sessionValid: true });
    expect(d).toMatchObject({ type: "redirectHost", host: "portal" });
  });

  it("[A0-05-T4-02] staff cố vào portal host → redirect admin (AC5)", () => {
    const d = decideRoute({ hostKind: "portal", pathname: "/lich-hoc", role: "TEACHER", sessionValid: true });
    expect(d).toMatchObject({ type: "redirectHost", host: "admin" });
  });

  it("[A0-05-T4-03] đa vai (staff+parent) → ưu tiên khu staff", () => {
    // PARENT+TEACHER: staff duy nhất là TEACHER = GV thuần → sau flip 10/07
    // (TEACHER_SITE_ENABLED default ON) đáp xuống SITE GV, không phải admin.
    const d = decideRoute({
      hostKind: "admin", pathname: "/leads", role: "PARENT",
      roles: ["PARENT", "TEACHER"], sessionValid: true,
    });
    expect(d).toMatchObject({ type: "redirectHost", host: "teacher" });
    // Kiêm vai admin thật (PARENT + CENTER_MANAGER) → vẫn ưu tiên admin.
    const d2 = decideRoute({
      hostKind: "admin", pathname: "/leads", role: "PARENT",
      roles: ["PARENT", "CENTER_MANAGER"], sessionValid: true,
    });
    expect(d2).toMatchObject({ type: "rewrite", path: "/admin/leads" });
  });

  it("[A0-05-T10-01/02/03] sanitizeCallbackUrl chặn open-redirect (AC6)", () => {
    expect(sanitizeCallbackUrl("//evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("http://x")).toBe("/");
    expect(sanitizeCallbackUrl("https://x")).toBe("/");
    expect(sanitizeCallbackUrl("/admin\\..")).toBe("/");
    expect(sanitizeCallbackUrl("")).toBe("/");
    expect(sanitizeCallbackUrl("/leads/123")).toBe("/leads/123"); // path nội bộ hợp lệ giữ nguyên
  });
});
