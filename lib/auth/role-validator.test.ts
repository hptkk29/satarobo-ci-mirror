// A0-02 — Zod validator role (reason bắt buộc, code format, effective dates). Pure.
import { describe, it, expect } from "vitest";
import {
  createRoleSchema,
  assignUserOrgRoleSchema,
  setRolePermissionsSchema,
} from "@/lib/validators/role";

describe("[A0-02] role validators", () => {
  it("createRoleSchema: hợp lệ + chuẩn hóa code uppercase", () => {
    const r = createRoleSchema.parse({ code: "ho_sale", name: "Sale HO", reason: "khởi tạo" });
    expect(r.code).toBe("HO_SALE");
  });

  it("[A0-02-T2-01] createRole thiếu reason → fail", () => {
    expect(createRoleSchema.safeParse({ code: "X1", name: "X" }).success).toBe(false);
    expect(createRoleSchema.safeParse({ code: "X1", name: "X", reason: "" }).success).toBe(false);
  });

  it("[A0-02-T2-04] code sai định dạng → fail", () => {
    expect(createRoleSchema.safeParse({ code: "1bad", name: "X", reason: "abc" }).success).toBe(false);
    expect(createRoleSchema.safeParse({ code: "a b", name: "X", reason: "abc" }).success).toBe(false);
  });

  it("[A0-02-T2-05] assign: effectiveTo < effectiveFrom → fail", () => {
    const bad = assignUserOrgRoleSchema.safeParse({
      userId: "u", orgUnitId: "o", roleId: "r", reason: "abc",
      effectiveFrom: "2026-06-10", effectiveTo: "2026-06-01",
    });
    expect(bad.success).toBe(false);
    const ok = assignUserOrgRoleSchema.safeParse({
      userId: "u", orgUnitId: "o", roleId: "r", reason: "abc",
      effectiveFrom: "2026-06-01", effectiveTo: "2026-06-10",
    });
    expect(ok.success).toBe(true);
  });

  it("setRolePermissions yêu cầu reason", () => {
    expect(setRolePermissionsSchema.safeParse({ permissions: [] }).success).toBe(false);
    expect(
      setRolePermissionsSchema.safeParse({ permissions: [], reason: "cập nhật" }).success,
    ).toBe(true);
  });
});
