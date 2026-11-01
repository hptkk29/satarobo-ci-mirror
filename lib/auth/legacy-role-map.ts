// lib/auth/legacy-role-map.ts — ánh xạ Role (enum v1, `User.roles[]`) → RoleDef (RBAC v2).
//
// VÌ SAO CÓ FILE NÀY: trước 07/08/2026 bảng ánh xạ chỉ nằm trong `prisma/patch-rbac-staff.ts`
// (script chạy tay). Màn tạo tài khoản admin chỉ ghi `User.roles[]` mà KHÔNG sinh
// `UserOrgRole` ⇒ trên prod (RBAC_V2_ENABLED=true) actor rỗng quyền: GV vào được site,
// thấy lớp, nhưng bấm Lưu điểm danh thì "Không có quyền điểm danh lớp này". Tách bảng ra
// đây để action tạo/sửa user và script patch dùng CHUNG một nguồn — không drift.
//
// THUẦN: không chạm DB, không import server-only → unit-test không cần Postgres.
import type { Role } from "@prisma/client";

/** Vai trò này phải neo vào đơn vị nào để có nghĩa. */
export type OrgAnchor = "HO" | "CENTER" | "CENTER_OR_HO";

type Mapping = { roleCode: string; org: OrgAnchor };

/**
 * Role (v1) → RoleDef.code (v2) + đơn vị neo.
 * PARENT CỐ Ý không có mặt: portal phụ huynh gác bằng ownership (`portalDb` +
 * `assertOwnsStudent`), không đi qua `UserOrgRole` — thêm vào đây là cấp quyền thừa.
 */
export const LEGACY_TO_ROLEDEF = {
  SUPER_ADMIN: { roleCode: "SUPER_ADMIN", org: "HO" },
  CENTER_MANAGER: { roleCode: "CENTER_MANAGER", org: "CENTER" },
  SALES_CSM: { roleCode: "CENTER_SALES_CSM", org: "CENTER" },
  TEACHER: { roleCode: "TEACHER", org: "CENTER" },
  ACCOUNTANT: { roleCode: "HO_ACCOUNTANT", org: "CENTER_OR_HO" },
  MARKETING: { roleCode: "HO_MARKETING", org: "HO" },
  // 06/07/2026 (Phương án A, addendum HR): HR gắn cơ sở → CENTER_HR, không suy được
  // cơ sở → HO_HR. Trước đây hard-code HO khiến thực tập sinh 1 cơ sở thành HR toàn hệ thống.
  HR: { roleCode: "HO_HR", org: "CENTER_OR_HO" },
  TRAINING: { roleCode: "TRAINING", org: "HO" },
} as const satisfies Record<string, Mapping>;

/** Neo tại OrgUnit type=CENTER thì dùng biến thể CENTER_* thay cho HO_*. */
export const CENTER_OVERRIDE = {
  ACCOUNTANT: "CENTER_ACCOUNTANT",
  HR: "CENTER_HR",
} as const satisfies Record<string, string>;

/** Ánh xạ 1 role legacy; null = role không thuộc RBAC v2 (PARENT). */
export function mappingFor(legacy: Role): Mapping | null {
  return (LEGACY_TO_ROLEDEF as Record<string, Mapping>)[legacy] ?? null;
}

/** RoleDef.code cho 1 role legacy, biết nó neo ở cơ sở hay không. */
export function roleDefCodeFor(legacy: Role, atCenter: boolean): string | null {
  const m = mappingFor(legacy);
  if (!m) return null;
  if (!atCenter) return m.roleCode;
  return (CENTER_OVERRIDE as Record<string, string>)[legacy] ?? m.roleCode;
}

/**
 * Tập RoleDef.code do bảng này QUẢN LÝ. Dòng `UserOrgRole` có code ngoài tập này là do
 * người gán tay ở /admin/users/[id]/org-roles (vd ASSISTANT_TEACHER, HO_SALE,
 * CENTER_CLASS_MANAGER) — đồng bộ tự động KHÔNG được đụng vào.
 */
export const MANAGED_ROLE_CODES: ReadonlySet<string> = new Set<string>([
  ...Object.values(LEGACY_TO_ROLEDEF).map((m) => m.roleCode),
  ...Object.values(CENTER_OVERRIDE),
]);

export type OrgRoleTarget = {
  legacy: Role;
  roleCode: string;
  orgUnitId: string;
};

export type PlanInput = {
  roles: readonly Role[];
  /** Đơn vị admin chọn trên form (`User.orgUnitId`). null = chưa gán. */
  anchorOrgUnitId: string | null;
  /** Đơn vị neo có phải type=CENTER không → quyết định CENTER_OVERRIDE. */
  anchorIsCenter: boolean;
  /** OrgUnit Hội sở — nơi neo các vai cross-center theo chức năng. */
  hoOrgUnitId: string;
};

export type PlanResult = {
  targets: OrgRoleTarget[];
  /** Role cần đơn vị nhưng form không chọn — KHÔNG bỏ qua im lặng, caller phải báo lỗi. */
  missingAnchor: Role[];
};

/**
 * Suy danh sách (RoleDef, OrgUnit) cần có, từ `roles[]` + đơn vị của tài khoản.
 *
 * Quy tắc neo:
 *   • org="HO"            → luôn neo ở Hội sở (SUPER_ADMIN chỉ là super khi ở HO/ROOT —
 *                           xem `buildActor`, `lib/auth/actor.ts:129`).
 *   • org="CENTER"/"CENTER_OR_HO" → neo đúng đơn vị admin chọn. Chọn Hội sở là hợp lệ
 *                           (quyết định 06/08: GV về Hội sở rồi phân lịch xuống cơ sở),
 *                           ⚠️ nhưng vai neo ở HO ⇒ `isHoLevel` ⇒ scopedDb mở "ALL" cơ sở.
 */
export function planOrgRoleTargets(input: PlanInput): PlanResult {
  const targets: OrgRoleTarget[] = [];
  const missingAnchor: Role[] = [];
  const seen = new Set<string>();

  for (const legacy of new Set(input.roles)) {
    const m = mappingFor(legacy);
    if (!m) continue; // PARENT — không thuộc RBAC v2

    const orgUnitId =
      m.org === "HO" ? input.hoOrgUnitId : input.anchorOrgUnitId;
    if (!orgUnitId) {
      missingAnchor.push(legacy);
      continue;
    }
    const atCenter = m.org === "HO" ? false : input.anchorIsCenter;
    const roleCode = roleDefCodeFor(legacy, atCenter);
    if (!roleCode) continue;

    const key = `${orgUnitId}:${roleCode}`;
    if (seen.has(key)) continue; // 2 role legacy có thể dồn về 1 RoleDef
    seen.add(key);
    targets.push({ legacy, roleCode, orgUnitId });
  }

  return { targets, missingAnchor };
}
