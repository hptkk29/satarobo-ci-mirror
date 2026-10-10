// lib/org/path.ts — Nền Hệ thống P1 · US-05: materialized path của cây OrgUnit.
// THUẦN (không Prisma) → unit-test không cần DB. Tầng DB gọi lại các hàm này bên trong
// một transaction (xem lib/org/org-service.ts).
//
// VÌ SAO CẦN PATH, ngoài chuyện query nhanh: P0 đã KÝ NỢ ở đây. `documentation/permissions.md`
// ghi "pre-P1 hai mức UNIT_ONLY/UNIT_AND_BELOW trùng nhau khi role gán tại CENTER, phân biệt
// thật ở P1 bằng OrgUnit.path". Nghĩa là path SAI = QUYỀN SAI, không phải hiển thị sai.

import { OrgRuleError, type OrgUnitNode } from "./types";

/**
 * Segment path của một node = code viết thường, "_" đổi thành "-".
 *
 * ⚠️ Công thức này TRÙNG với SQL backfill trong migration 20260811030000
 * (`replace(lower(code),'_','-')`). Lệch nhau = path do DB sinh khác path do app sinh
 * ⇒ subtree hụt im lặng. Test [US-05-U-05] là dây nối giữ hai chỗ bằng nhau.
 */
export function slugOf(code: string): string {
  return (code ?? "").trim().toLowerCase().replace(/_/g, "-");
}

/**
 * Path của node con = path cha + slug + "/".
 * `parentPath = null` ⇒ node gốc ⇒ "/slug/".
 *
 * "/" ở CUỐI là bắt buộc, không phải thẩm mỹ: nó là thứ chặn "/cs1/" ăn nhầm "/cs10/"
 * khi so tiền tố (xem isUnderPath + test [US-05-U-04]).
 */
export function childPath(parentPath: string | null | undefined, code: string): string {
  const base = parentPath && parentPath.length > 0 ? parentPath : "/";
  return `${base}${slugOf(code)}/`;
}

/** Path đầy đủ của `id` suy từ chuỗi parentId. Trả null nếu node không tồn tại. */
export function buildPath(nodes: OrgUnitNode[], id: string): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: OrgUnitNode[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = id;
  while (cur != null) {
    if (seen.has(cur)) {
      throw new OrgRuleError(
        "ORG_CYCLE_DETECTED",
        `Cây đơn vị có vòng lặp tại "${cur}" — không tính được path.`,
        "parentId",
      );
    }
    seen.add(cur);
    const node = byId.get(cur);
    if (!node) break;
    chain.push(node);
    cur = node.parentId;
  }
  if (chain.length === 0) return null;
  // chain đang là [self ... root] → duyệt ngược để nối từ gốc xuống.
  let path = "/";
  for (let i = chain.length - 1; i >= 0; i--) path = childPath(path, chain[i]!.code);
  return path;
}

/** Độ sâu = số segment trừ 1 (gốc = 0). */
export function depthOfPath(path: string): number {
  return path.split("/").filter(Boolean).length - 1;
}

/**
 * `path` có nằm trong nhánh `prefix` không (GỒM chính nó) — bản TS của
 * `target.path LIKE actor.path || '%'` ở BA §2.5.
 * Cả hai đầu vào phải là path chuẩn (có "/" cuối); path rỗng/null → false (fail-closed).
 */
export function isUnderPath(path: string | null | undefined, prefix: string | null | undefined): boolean {
  if (!path || !prefix) return false;
  return path.startsWith(prefix);
}

export type PathRow = { id: string; path: string; depth: number };

/**
 * Tính lại path + depth cho `rootId` VÀ TOÀN BỘ hậu duệ của nó.
 *
 * Đây là hàm phục vụ US-05 AC2: dời node (đổi parentId) HOẶC đổi code đều phải kéo theo
 * cả nhánh. Trả về danh sách dòng cần ghi — người gọi ghi hết trong MỘT transaction.
 *
 * Ném OrgRuleError nếu gặp vòng lặp (dữ liệu bẩn) thay vì chạy vô hạn.
 */
export function recomputeSubtree(nodes: OrgUnitNode[], rootId: string): PathRow[] {
  const rootPath = buildPath(nodes, rootId);
  if (rootPath == null) return [];

  const childrenOf = new Map<string, OrgUnitNode[]>();
  for (const n of nodes) {
    if (n.parentId == null) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }

  const out: PathRow[] = [{ id: rootId, path: rootPath, depth: depthOfPath(rootPath) }];
  const seen = new Set<string>([rootId]);
  const queue: Array<{ id: string; path: string }> = [{ id: rootId, path: rootPath }];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of childrenOf.get(cur.id) ?? []) {
      if (seen.has(child.id)) {
        throw new OrgRuleError(
          "ORG_CYCLE_DETECTED",
          `Cây đơn vị có vòng lặp tại "${child.id}" — không tính lại được nhánh.`,
          "parentId",
        );
      }
      seen.add(child.id);
      const p = childPath(cur.path, child.code);
      out.push({ id: child.id, path: p, depth: depthOfPath(p) });
      queue.push({ id: child.id, path: p });
    }
  }
  return out;
}
