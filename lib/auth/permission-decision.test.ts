// US-02 — pin hành vi decidePermissionDetailWithGrant (finding review 09/08 chưa được
// phản biện vì agent lỗi → tự thẩm định, xác nhận bug thật, vá + pin tại đây):
// grant CHỈ có DENY cấp trường → resolveGrant hit:false (mask không quyết action),
// nhưng fieldMask PHẢI được trả VÔ ĐIỀU KIỆN — kể cả khi ALLOW đến từ đường cũ.
// Cả v1 (sessionUser CENTER_MANAGER) lẫn v2 (grantsAllow) cùng ALLOW để không sinh
// shadow-diff (tránh chạm DB trong unit test).
import { describe, it, expect } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { decidePermissionDetailWithGrant } from "@/lib/auth/permission-decision";
import type { GrantRow } from "@/lib/permissions/can";

const R1 = "roledef-1";

function makeActor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "u1",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    ...overrides,
  };
}

const sessionUser = { role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"] };

describe("US-02 · decidePermissionDetailWithGrant — mask vô điều kiện", () => {
  it("CHỈ DENY cấp trường (hit:false) + ALLOW từ đường cũ → allowed=true VÀ mask vẫn che", () => {
    const maskOnlyDeny: GrantRow = {
      subjectType: "ROLE",
      subjectId: R1,
      permissionKey: "students:view-all",
      effect: "DENY",
      dataScope: "ALL",
      fieldMask: ["phone"],
    };
    const actor = makeActor({
      roleIds: [R1],
      grantsAllow: new Set(["students:view-all"]), // v2 cũ ALLOW (khớp v1 CM → không shadow-diff)
      permissionGrants: [maskOnlyDeny],
    });
    const detail = decidePermissionDetailWithGrant({
      sessionUser,
      actor,
      action: "students:view-all",
    });
    expect(detail.allowed).toBe(true); // quyết định đến từ đường cũ
    expect(detail.fieldMask).toEqual(["phone"]); // mask KHÔNG bị đánh rơi theo hit:false
  });

  it("DENY toàn action (grant hit) → allowed=false, mask rỗng", () => {
    const actor = makeActor({
      roleIds: [R1],
      grantsAllow: new Set(["students:view-all"]),
      permissionGrants: [
        {
          subjectType: "ROLE",
          subjectId: R1,
          permissionKey: "students:view-all",
          effect: "DENY",
          dataScope: "ALL",
          fieldMask: [],
        },
      ],
    });
    const detail = decidePermissionDetailWithGrant({
      sessionUser,
      actor,
      action: "students:view-all",
    });
    expect(detail.allowed).toBe(false);
    expect(detail.fieldMask).toEqual([]);
  });

  it("không grant nào → allowed theo đường cũ, mask rỗng", () => {
    const actor = makeActor({ grantsAllow: new Set(["students:view-all"]) });
    const detail = decidePermissionDetailWithGrant({
      sessionUser,
      actor,
      action: "students:view-all",
    });
    expect(detail.allowed).toBe(true);
    expect(detail.fieldMask).toEqual([]);
  });
});
