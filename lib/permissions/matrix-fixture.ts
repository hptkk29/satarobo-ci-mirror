// lib/permissions/matrix-fixture.ts — US-04 (TS-04): fixture cây mẫu + builder ma trận quyền.
//
// Fixture chuẩn của 04-TestScenarios (đầu file): HO → {Vùng-A, Đà Nẵng} →
// {CS-F (FRANCHISEE, thuộc Vùng-A) · CS1 (OWNED, Đà Nẵng) · CS-L (AFFILIATE, Đà Nẵng)}.
//
// PURE, không DB: cây là hằng số, "path-resolve" làm TẠI FIXTURE-TIME — builder dịch
// (vị trí gán role × dataScope) thành roleCenterScope đúng như buildActor() sẽ làm khi
// OrgUnit.path có thật (P1, BA §2.5 `path LIKE prefix`). Nhờ vậy test ma trận đóng băng
// HÀNH VI resolver, không đóng băng cách nạp dữ liệu.
//
// unitType/relationshipType (BA §2.2) hôm nay engine CHƯA đọc — giữ trong TREE làm nguồn
// sự thật cho resolver P5 (US-14/US-15: grant derivedFrom + kiểm FranchiseContract lúc chạy).
import type { Actor, RoleCenterScope, Target } from "@/lib/auth/actor";
import type { GrantRow } from "@/lib/permissions/grant-types";

/** Key quyền cố định của ma trận (key thật trong registry v1 — trùng key can.test.ts dùng). */
export const MATRIX_KEY = "students:view-all";

/** userId của actor ma trận — matrixTarget({ ownedBy: "actor" }) trỏ createdById về id này. */
export const MATRIX_USER_ID = "user-matrix";

/** RoleDef.id giả định của role mang grant trong ma trận. */
export const MATRIX_ROLE_ID = "roledef-matrix";

export type MatrixNodeKey = "HO" | "VUNG_A" | "DA_NANG" | "CS_F" | "CS1" | "CS_L";
/** 3 node CENTER — chỗ duy nhất matrixTarget được trỏ vào. */
export type MatrixCenterKey = "CS_F" | "CS1" | "CS_L";

export type MatrixNode = {
  /** Materialized path (BA §2.2) — có "/" cuối để startsWith là prefix đúng biên node. */
  path: string;
  unitType: "HO" | "REGION" | "CENTER";
  relationshipType: "OWNED" | "FRANCHISEE" | "AFFILIATE";
  /** centerId pre-P1 (fallback AC3 của US-02) — chỉ node CENTER mới có. */
  centerId: string | null;
};

/** Cây 6 node theo thiết kế duyệt 09/08 — HO/REGION là đơn vị nội bộ (OWNED). */
export const TREE: Record<MatrixNodeKey, MatrixNode> = {
  HO: { path: "/ho/", unitType: "HO", relationshipType: "OWNED", centerId: null },
  VUNG_A: { path: "/ho/vung-a/", unitType: "REGION", relationshipType: "OWNED", centerId: null },
  DA_NANG: { path: "/ho/danang/", unitType: "REGION", relationshipType: "OWNED", centerId: null },
  CS_F: {
    path: "/ho/vung-a/cs-f/",
    unitType: "CENTER",
    relationshipType: "FRANCHISEE",
    centerId: "center-cs-f",
  },
  CS1: {
    path: "/ho/danang/cs1/",
    unitType: "CENTER",
    relationshipType: "OWNED",
    centerId: "center-cs1",
  },
  CS_L: {
    path: "/ho/danang/cs-l/",
    unitType: "CENTER",
    relationshipType: "AFFILIATE",
    centerId: "center-cs-l",
  },
};

/** Mọi centerId nằm dưới prefix path — mô phỏng `target.path LIKE actor.path || '%'` (BA §2.5). */
function centersUnder(prefix: string): string[] {
  return Object.values(TREE).flatMap((n) =>
    n.centerId && n.path.startsWith(prefix) ? [n.centerId] : [],
  );
}

/**
 * Path-resolve tại fixture-time — dịch NƠI GÁN ROLE → roleCenterScope 2 mức:
 * - HO → "ALL" (cross-center theo chức năng — cùng công thức hoRoot của buildActor).
 * - REGION → unitOnly [] (vùng KHÔNG phải cơ sở, "chỉ đơn vị mình" không chứa center nào
 *   ⇒ scope không bao giờ thoả — case biên pin ở matrix.test.ts);
 *            unitAndBelow = các centerId có TREE[x].path startsWith path vùng.
 * - CENTER → cả hai mức = [centerId của chính nó] (cơ sở không có cơ sở con).
 *
 * P1 · US-05 — KHÔNG còn nhận `scope` làm tham số. Trước P1, fixture phải tự chọn mức vì
 * `Actor.roleCenterScope` chỉ chở được MỘT danh sách; nay Actor chở cả hai và
 * `lib/permissions/can.ts` mới là chỗ chọn — đúng như buildActor() làm thật.
 * Chân trị của 24 ô TS-04 KHÔNG đổi: chỉ đường đi tới nó đổi.
 */
function resolveRoleCenterScope(at: MatrixNodeKey): RoleCenterScope {
  const node = TREE[at];
  if (node.unitType === "HO") return "ALL";
  if (node.unitType === "REGION") {
    return { unitOnly: [], unitAndBelow: centersUnder(node.path) };
  }
  const own = node.centerId ? [node.centerId] : [];
  return { unitOnly: own, unitAndBelow: own };
}

/**
 * Dựng Actor cho 1 ô ma trận: role MATRIX_ROLE_ID gán tại node `at`, mang 1 grant
 * (effect × scope) cho `key` (mặc định MATRIX_KEY). `withBaseAllow` thêm grant ALLOW
 * dataScope ALL cùng key — dùng cho 12 ô DENY (chứng minh DENY khớp scope THẮNG ALLOW
 * nền, BA §2.5). Shape mượn pattern makeActor của can.test.ts — copy tối thiểu có chủ
 * đích, không import từ file test.
 */
export function matrixActor(opts: {
  at: MatrixNodeKey;
  scope: GrantRow["dataScope"];
  effect: GrantRow["effect"];
  withBaseAllow?: boolean;
  key?: string;
}): Actor {
  const key = opts.key ?? MATRIX_KEY;
  const grants: GrantRow[] = [];
  if (opts.withBaseAllow) {
    grants.push({
      subjectType: "ROLE",
      subjectId: MATRIX_ROLE_ID,
      permissionKey: key,
      effect: "ALLOW",
      dataScope: "ALL",
      fieldMask: [],
    });
  }
  grants.push({
    subjectType: "ROLE",
    subjectId: MATRIX_ROLE_ID,
    permissionKey: key,
    effect: opts.effect,
    dataScope: opts.scope,
    fieldMask: [],
  });
  return {
    userId: MATRIX_USER_ID,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    roleIds: [MATRIX_ROLE_ID],
    groupIds: [],
    permissionGrants: grants,
    roleCenterScope: { [MATRIX_ROLE_ID]: resolveRoleCenterScope(opts.at) },
  };
}

/**
 * Dựng Target cho 1 ô ma trận: bản ghi thuộc cơ sở `at` (pre-P1: target theo centerId).
 * ownedBy "actor" → createdById = MATRIX_USER_ID (cho dataScope OWN); "other" → id khác.
 */
export function matrixTarget(opts: { at: MatrixCenterKey; ownedBy?: "actor" | "other" }): Target {
  return {
    centerId: TREE[opts.at].centerId,
    ...(opts.ownedBy
      ? { createdById: opts.ownedBy === "actor" ? MATRIX_USER_ID : "user-khac" }
      : {}),
  };
}
