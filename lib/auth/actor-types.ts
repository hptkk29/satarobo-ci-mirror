// lib/auth/actor-types.ts — KIỂU DÙNG CHUNG của tầng quyền, tách ra làm MODULE LÁ.
//
// ⚠️ VÌ SAO TÁCH: `lib/org/positions.ts` cần đúng khuôn hàng vai để đổ vào `buildActor`,
// còn `lib/auth/actor.ts` lại gọi `loadPositionRoleRows` — hai file import ngược nhau
// thành vòng (dependency-cruiser `no-circular` chặn ở CI). File này không import gì, nên
// cắt được vòng mà không phải nới luật.
//
// `actor.ts` re-export lại hai kiểu này, nên mọi `import { ScopeType } from "@/lib/auth/actor"`
// cũ vẫn chạy nguyên.

export type ScopeType = "GLOBAL" | "CENTER" | "CLASS" | "OWN" | "CHILDREN" | "ASSIGNED";

/** Một dòng "vai X tại đơn vị Y, hiệu lực từ… đến…" — khuôn `buildActor` ăn được. */
export type UserOrgRoleRow = {
  orgUnitId: string;
  /** US-02 — RoleDef.id (optional additive: test/caller cũ không truyền vẫn compile). */
  roleId?: string;
  status: string; // AssignStatus
  effectiveFrom: Date;
  effectiveTo: Date | null;
  role: {
    code: string;
    isActive: boolean;
    permissions: { action: string; scopeType: ScopeType }[];
  };
  /**
   * P2 · US-10 — đơn vị NƠI TÁC NGHIỆP (WorkScope) còn hiệu lực của phân công sinh ra
   * hàng này. Chỉ NỚI PHẠM VI DỮ LIỆU của chính hàng đó; KHÔNG thêm permission, KHÔNG
   * đụng `isHoLevel`/`orgRoles` — người được điều đi vẫn giữ nguyên vai và biên chế.
   */
  workScopeOrgUnitIds?: string[];
};
