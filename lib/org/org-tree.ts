// lib/org/org-tree.ts — Thuật toán cây OrgUnit THUẦN (ticket A0-01 §3 helper).
//
// ⚠️ HÌNH CÂY ĐÃ ĐỔI Ở P1 (chủ dự án chốt 11/08/2026 theo BA 08/08 §1.1):
//   HO (gốc) → REGION → CENTER.
// Trước đó Doc 15 OI-1 quy định ROOT → HO, CS1, CS2 NGANG HÀNG, và `getSubtreeCenterIds(HO)`
// trả [] là hành vi CỐ Ý. Sau khi dời cây, HO là tổ tiên của mọi CENTER nên hàm đó trả đủ
// danh sách cơ sở. Đây KHÔNG phải nới quyền: `isHoLevel` trong buildActor vốn đã cấp
// cross-center cho mọi role đặt tại HO/ROOT bằng một nhánh riêng — nay hai đường cho cùng
// một kết quả, tức bớt đi một chỗ để lệch.
//
// Việc DỜI node trên DB đang chạy làm bằng `scripts/nen-p1-reshape-org-tree.ts` (dry-run
// mặc định), không nhét vào migration — luật cứng #4.

import { isOrgUnitLive } from "./status";
import type { OrgUnitNode, OrgUnitType } from "./types";

/** Một định nghĩa "còn sống" duy nhất cho cả repo — xem lib/org/status.ts. */
const isLive = isOrgUnitLive;

function indexBy(nodes: OrgUnitNode[]): Map<string, OrgUnitNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

/** Con trực tiếp (mặc định chỉ node còn sống). */
export function getChildren(
  nodes: OrgUnitNode[],
  id: string,
  opts: { includeDeleted?: boolean } = {},
): OrgUnitNode[] {
  return nodes.filter(
    (n) => n.parentId === id && (opts.includeDeleted || isLive(n)),
  );
}

/** Toàn bộ hậu duệ (BFS, không gồm chính nó; mặc định chỉ node còn sống). */
export function getDescendants(
  nodes: OrgUnitNode[],
  id: string,
  opts: { includeDeleted?: boolean } = {},
): OrgUnitNode[] {
  const out: OrgUnitNode[] = [];
  const queue = [...getChildren(nodes, id, opts)];
  const seen = new Set<string>();
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n.id)) continue; // chống vòng dữ liệu bẩn
    seen.add(n.id);
    out.push(n);
    queue.push(...getChildren(nodes, n.id, opts));
  }
  return out;
}

/**
 * Mọi centerId thuộc subtree của `id` (gồm chính nó nếu là CENTER).
 * Dùng cho scopedDb (ticket A0-04): visibleCenterIds của role tại 1 OrgUnit.
 */
export function getSubtreeCenterIds(
  nodes: OrgUnitNode[],
  id: string,
  opts: { includeDeleted?: boolean } = {},
): string[] {
  const self = indexBy(nodes).get(id);
  const scope = self ? [self, ...getDescendants(nodes, id, opts)] : getDescendants(nodes, id, opts);
  const ids: string[] = [];
  for (const n of scope) {
    if (!opts.includeDeleted && !isLive(n)) continue;
    if (n.type === "CENTER" && n.centerId) ids.push(n.centerId);
  }
  return ids;
}

/**
 * Mọi OrgUnit ID thuộc subtree của `id` (GỒM chính nó). Khác getSubtreeCenterIds:
 * trả về node.id cho MỌI type (không chỉ CENTER) → dùng cho scope theo orgUnitId
 * (Phase 0 migrate Center→OrgUnit, Doc 15 §4.4). HO không có con → [HO.id] (OI-1).
 */
export function getSubtreeOrgUnitIds(
  nodes: OrgUnitNode[],
  id: string,
  opts: { includeDeleted?: boolean } = {},
): string[] {
  const self = indexBy(nodes).get(id);
  const scope = self ? [self, ...getDescendants(nodes, id, opts)] : getDescendants(nodes, id, opts);
  const ids: string[] = [];
  for (const n of scope) {
    if (!opts.includeDeleted && !isLive(n)) continue;
    ids.push(n.id);
  }
  return ids;
}

/**
 * P1 · US-05 — phạm vi CƠ SỞ của một vị trí trong cây, TÁCH LÀM HAI MỨC.
 *
 * Đây là thứ P0 ký nợ: `documentation/permissions.md` ghi "pre-P1 hai mức UNIT_ONLY /
 * UNIT_AND_BELOW trùng nhau… phân biệt thật ở P1 bằng OrgUnit.path". Trước P1,
 * `Actor.roleCenterScope[roleId]` là MỘT danh sách nên can() không thể phân biệt; nay nó
 * mang cả hai mức và can() chọn theo `grant.dataScope`.
 *
 * - `unitOnly`   = cơ sở của CHÍNH node đó. REGION/HO không phải cơ sở ⇒ [] (khớp
 *                  `resolveRoleCenterScope` của matrix-fixture, ô biên đã ghim ở TS-04).
 * - `unitAndBelow` = mọi cơ sở trong nhánh, GỒM chính nó.
 *
 * ⚠️ CỐ Ý CHỈ CÓ MỘT HIỆN THỰC: duyệt `parentId`. KHÔNG dùng `path` ở đây, dù P1 vừa
 * thêm cột đó. Lý do — hai đường KHÔNG tương đương về ngữ nghĩa:
 *   · duyệt parentId dừng ở node cha đã chết ⇒ cả nhánh dưới rơi khỏi phạm vi;
 *   · so prefix `path` chỉ kiểm liveness của CHÍNH node CENTER ⇒ cơ sở nằm dưới một vùng
 *     đang SUSPENDED vẫn lọt vào.
 * Thay `path` vào đây là NỞ QUYỀN im lặng. `path` là cột để P3 truy vấn ở TẦNG DB
 * (`WHERE path LIKE prefix || '%'` kèm điều kiện liveness của cả nhánh) — không phải để
 * thay thuật toán trong RAM ở P1. Tính đúng đắn của cột được ghim bằng [US-05-IT-08]
 * ("path lưu trong DB khớp path tính lại từ parentId").
 */
export function centerScopeForOrgUnit(
  nodes: OrgUnitNode[],
  orgUnitId: string,
  opts: { includeDeleted?: boolean } = {},
): { unitOnly: string[]; unitAndBelow: string[] } {
  const self = indexBy(nodes).get(orgUnitId);
  const unitOnly = self && self.type === "CENTER" && self.centerId ? [self.centerId] : [];
  return { unitOnly, unitAndBelow: getSubtreeCenterIds(nodes, orgUnitId, opts) };
}

/** Đường đi từ node lên ROOT, GỒM chính nó: [self, parent, ..., root]. */
export function getAncestors(nodes: OrgUnitNode[], id: string): OrgUnitNode[] {
  const byId = indexBy(nodes);
  const out: OrgUnitNode[] = [];
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur != null) {
    const node = byId.get(cur);
    if (!node || seen.has(cur)) break;
    seen.add(cur);
    out.push(node);
    cur = node.parentId;
  }
  return out;
}

/** a có là tổ tiên (strict) của b không. */
export function isAncestor(nodes: OrgUnitNode[], a: string, b: string): boolean {
  if (a === b) return false;
  return getAncestors(nodes, b)
    .slice(1) // bỏ chính b
    .some((n) => n.id === a);
}

/** OrgUnit hiển thị được trên picker/filter (gồm cả HO — Doc 15 OI-1, sửa lỗi "HO không hiện"). */
export type SelectableOrgUnit = {
  orgUnitId: string;
  code: string;
  name: string;
  type: OrgUnitType;
  /** Chỉ CENTER mới có — Center.id cũ để gán Lead/Class (HO/ROOT = null). */
  centerId: string | null;
};

/** Phạm vi của actor để lọc đơn vị chọn được (rút từ Actor — không phụ thuộc Prisma). */
export type SelectableScope = {
  isSuperAdmin?: boolean;
  /** Có role tại HO/ROOT → cross-center theo chức năng → thấy mọi đơn vị. */
  isHoLevel?: boolean;
  /** Center IDs trong tầm nhìn (CENTER orgunit khớp centerId này mới hiện). */
  visibleCenterIds?: string[];
  /** OrgUnit IDs mà actor có role trực tiếp (cho HO/ROOT non-center). */
  roleOrgUnitIds?: string[];
};

// ROOT là gốc kỹ thuật, không phải "đơn vị" chọn được.
//
// ⚠️ P1 CỐ Ý KHÔNG thêm REGION/DEPARTMENT vào đây. 6 màn đang gọi getSelectableOrgUnits()
// KHÔNG truyền `types` (holidays ×2, nhan-su ×2, users ×2) và ghi kết quả vào cột
// `centerId`. Node REGION có centerId = null, mà `centerId = NULL` ở nhiều bảng mang nghĩa
// "ÁP DỤNG TOÀN HỆ THỐNG" (lib/db-scope.ts:62-70) — nên cho REGION lọt vào picker là biến
// "nghỉ lễ của Vùng Đà Nẵng" thành "nghỉ lễ toàn hệ thống" mà không ai báo lỗi.
// Vùng chỉ hiện ở màn cây tổ chức mới (/admin/to-chuc), nơi truyền `types` tường minh.
// Mở rộng picker cho REGION là việc của P2 (khi mỗi bảng đã có orgUnitId thật sự dùng được).
const DEFAULT_SELECTABLE_TYPES: OrgUnitType[] = [
  "HO",
  "CENTER",
  "CAMPUS",
  "PARTNER",
  "FRANCHISE",
];

/**
 * Đơn vị tổ chức actor được phép chọn/lọc — THUẦN (test không cần DB).
 * - SUPER_ADMIN / HO-level: thấy mọi đơn vị khớp `types`.
 * - Còn lại: CENTER khớp `visibleCenterIds`, hoặc đơn vị actor có role trực tiếp.
 * Mặc định loại ROOT; truyền `types: ["CENTER"]` khi chỉ cần cơ sở vận hành (vd gán lead).
 */
export function selectableOrgUnits(
  nodes: (OrgUnitNode & { name?: string })[],
  scope: SelectableScope,
  opts: { types?: OrgUnitType[]; includeDeleted?: boolean } = {},
): SelectableOrgUnit[] {
  const types = new Set(opts.types ?? DEFAULT_SELECTABLE_TYPES);
  const visible = new Set(scope.visibleCenterIds ?? []);
  const roleUnits = new Set(scope.roleOrgUnitIds ?? []);
  const seeAll = scope.isSuperAdmin || scope.isHoLevel;

  return nodes
    .filter((n) => opts.includeDeleted || isLive(n))
    .filter((n) => types.has(n.type))
    .filter((n) => {
      if (seeAll) return true;
      if (n.type === "CENTER" && n.centerId) return visible.has(n.centerId);
      return roleUnits.has(n.id);
    })
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((n) => ({
      orgUnitId: n.id,
      code: n.code,
      name: (n as { name?: string }).name ?? n.code,
      type: n.type,
      centerId: n.type === "CENTER" ? (n.centerId ?? null) : null,
    }));
}
