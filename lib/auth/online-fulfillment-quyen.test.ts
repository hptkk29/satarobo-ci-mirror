// lib/auth/online-fulfillment-quyen.test.ts — hai quyền CHUYÊN BIỆT của giao hàng Online: đọc PII người nhận ≠ đổi trạng thái.
//
// Thiết kế cố ý (Owner M8, 28/11/2026): chỉ ĐỊNH NGHĨA khoá — KHÔNG vai nào trong seed được cấp sẵn. Quản trị tối cao đi đường bypass của `can()` v2
// và là chủ duy nhất ở ma trận v1. Ai muốn gán cho nhân viên kho phải có Owner duyệt. Nếu ai đó "cấp tiện cho kế toán/kho" mà không qua Owner thì test này đỏ.
import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";

import { getActionMeta } from "@/lib/auth/action-labels";
import { ALL_ACTIONS, PERMISSIONS, can, type Action } from "@/lib/auth/permissions";
import { inventoryModule } from "@/lib/permissions/registry/inventory";
import { ROLE_SEED } from "../../prisma/seed-roles";

const KHOA = ["online_fulfillment:view-pii", "online_fulfillment:update"] as const;
const MOI_VAI: Role[] = ["SUPER_ADMIN", "CENTER_MANAGER", "HR", "SALES_CSM", "TEACHER", "TRAINING", "MARKETING", "ACCOUNTANT", "PARENT"];

describe("[GHQ] quyền chuyên biệt giao hàng Online", () => {
  it.each(KHOA)("[GHQ-01] %s: khai ở registry v2 (module inventory) và ma trận v1", (k) => {
    expect(ALL_ACTIONS).toContain(k);
    const mo = inventoryModule.permissions.find((p) => p.key === k);
    expect(mo?.action).toBe(k.split(":")[1]);
    expect(mo?.description?.length ?? 0).toBeGreaterThan(20);
  });

  it.each(KHOA)("[GHQ-02] %s — v1: CHỈ SUPER_ADMIN", (k) => {
    expect(PERMISSIONS[k as Action]).toEqual(["SUPER_ADMIN"]);
    for (const vai of MOI_VAI.filter((v) => v !== "SUPER_ADMIN")) expect(can(vai, k as Action), `${vai} không có ${k}`).toBe(false);
    expect(can("SUPER_ADMIN", k as Action)).toBe(true);
  });

  it.each(KHOA)("[GHQ-03] %s — v2: KHÔNG vai nào trong seed được cấp sẵn", (k) => {
    expect(ROLE_SEED.filter((r) => r.perms.some((p) => p.action === k)).map((r) => r.code)).toEqual([]);
  });

  it.each(KHOA)("[GHQ-04] %s có nhãn tiếng Việt ở màn cấp quyền (không lộ chuỗi khoá thô)", (k) => {
    const m = getActionMeta(k);
    expect(m.category).not.toBe(k.split(":")[0]);
    expect(m.label).not.toBe(k.split(":")[1]);
  });
});
