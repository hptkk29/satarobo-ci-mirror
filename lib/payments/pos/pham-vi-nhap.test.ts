// [POS-PV] Cổng PHẠM VI của lượt import file POS (Q-D: chỉ Kế toán HO + Quản trị tối cao). THUẦN.
//
// Mã TRƯỚC bản vá: `nhapLoPosAction` chỉ `checkPermission("payments:import-pos")` (không target)
// — vai cấp cơ sở được cấp quyền này ghi được giao dịch + khớp tiền cho MỌI cơ sở.
import { describe, it, expect } from "vitest";
import type { Actor, PermEntry } from "@/lib/auth/actor";
import { nhapPosDuocMoiCoSo } from "./pham-vi-nhap";

const perm = (action: string, centerScope: "ALL" | string[]): PermEntry => ({
  action,
  scopeType: "GLOBAL",
  orgUnitId: centerScope === "ALL" ? "org-ho" : "org-cs1",
  roleCode: centerScope === "ALL" ? "HO_ACCOUNTANT" : "CENTER_ACCOUNTANT",
  centerScope,
});

function actor(p: Partial<Actor>): Actor {
  return {
    userId: "u",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set(),
    assignedClassIds: new Set(),
    ...p,
  };
}

describe("[POS-PV] nhapPosDuocMoiCoSo", () => {
  it("[POS-PV-01] Kế toán HO (payments:* neo tại HO ⇒ ALL) ĐƯỢC import — đối chứng dương", () => {
    expect(
      nhapPosDuocMoiCoSo(
        actor({ isHoLevel: true, permissions: [perm("payments:import-pos", "ALL"), perm("payments:record", "ALL")] }),
      ),
    ).toBe(true);
  });

  it("[POS-PV-02] Quản trị tối cao ĐƯỢC import", () => {
    expect(nhapPosDuocMoiCoSo(actor({ isSuperAdmin: true }))).toBe(true);
  });

  it("[POS-PV-03] vai CẤP CƠ SỞ dù được cấp payments:import-pos ⇒ BỊ CHẶN", () => {
    expect(
      nhapPosDuocMoiCoSo(
        actor({
          visibleCenterIds: ["cs1"],
          permissions: [perm("payments:import-pos", ["cs1"]), perm("payments:record", ["cs1"])],
        }),
      ),
    ).toBe(false);
  });
});
