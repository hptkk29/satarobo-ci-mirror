// lib/permissions/grant-types.ts — type lá KHÔNG import gì (US-02).
// Tách khỏi lib/permissions/can.ts có chủ đích: actor.ts cần GrantRow nhưng
// can.ts lại cần Actor (từ actor.ts) → import chéo tạo vòng actor→can→actor
// mà dependency-cruiser (no-circular) chặn ở CI, dù chỉ là type-only.

/** 1 dòng bảng PermissionGrant đã nạp lên Actor (shape đông cứng — permissions.md AS-BUILT US-01). */
export type GrantRow = {
  subjectType: "ROLE" | "GROUP";
  /** RoleDef.id khi ROLE · UserGroup.id khi GROUP (US-03). */
  subjectId: string;
  permissionKey: string;
  effect: "ALLOW" | "DENY";
  dataScope: "ALL" | "UNIT_AND_BELOW" | "UNIT_ONLY" | "OWN";
  /** Rỗng = toàn action; khác rỗng (DENY) = chỉ che các trường này, không chặn action. */
  fieldMask: string[];
};
