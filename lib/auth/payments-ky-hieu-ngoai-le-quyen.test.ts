// lib/auth/payments-ky-hieu-ngoai-le-quyen.test.ts — quyền "dùng ký hiệu hoá đơn NGOÀI cấu hình" (ngoại lệ có lý do + audit).
//
// Thiết kế cố ý: quyền này KHÔNG được cấp cho vai nào ở RBAC v2 (seed) — fail-closed. Cấp sau, có chủ đích, bằng
// `seed-roles` + `seed-prod-roles.yml`. SUPER_ADMIN đi qua đường bypass của `can()` v2 và là chủ duy nhất ở v1.
// Nếu ai đó "cho kế toán dùng tiện" mà không qua chủ dự án thì test này đỏ — đó là mục đích.
import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { ALL_ACTIONS, PERMISSIONS, can } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../prisma/seed-roles";
import { financeModule } from "@/lib/permissions/registry/finance";

const KEY = "payments:ky-hieu-ngoai-le";
const MOI_VAI: Role[] = ["SUPER_ADMIN", "CENTER_MANAGER", "HR", "SALES_CSM", "TEACHER", "TRAINING", "MARKETING", "ACCOUNTANT", "PARENT"];

describe("[KHN] payments:ky-hieu-ngoai-le", () => {
  it("[KHN-01] là action có thật, khai ở registry v2 VÀ ma trận v1", () => {
    expect(ALL_ACTIONS).toContain(KEY);
    expect(financeModule.permissions.some((p) => p.key === KEY)).toBe(true);
  });
  it("[KHN-02] v1: CHỈ SUPER_ADMIN (kế toán KHÔNG tự có quyền ngoại lệ)", () => {
    expect(PERMISSIONS[KEY]).toEqual(["SUPER_ADMIN"]);
    for (const vai of MOI_VAI.filter((v) => v !== "SUPER_ADMIN")) expect(can(vai, KEY), `${vai} không có quyền này`).toBe(false);
    expect(can("SUPER_ADMIN", KEY)).toBe(true);
  });
  it("[KHN-03] v2: KHÔNG vai nào trong seed được cấp (fail-closed) — kể cả kế toán Hội sở / cơ sở", () => {
    const duoc = ROLE_SEED.filter((r) => r.perms.some((p) => p.action === KEY)).map((r) => r.code);
    expect(duoc).toEqual([]);
  });
});
