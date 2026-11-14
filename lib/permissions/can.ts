// lib/permissions/can.ts — Nền Hệ thống P0 · US-02: engine can() hợp nhất (TS-02 phần ROLE).
//
// PURE + SYNC: chỉ đọc grant ĐÃ NẠP SẴN trên Actor (actor.permissionGrants — bảng
// PermissionGrant MỚI). TUYỆT ĐỐI không đọc UserPermissionGrant cũ — DENY của bảng cũ
// phải tiếp tục bị bỏ qua (test ghim [A0-03-T6-02] xanh nguyên trạng).
//
// Chuỗi resolve (thiết kế duyệt 09/08/2026):
//   1. SUPER_ADMIN → bỏ qua grant (hit:false — chống tự khoá admin bằng DENY nhầm).
//   2. Gom grant khớp key với subjectId ∈ actor.roleIds (ROLE) ∪ actor.groupIds (GROUP,
//      rỗng tới US-03). Không có grant khớp → hit:false → fallback NGUYÊN TRẠNG canV2.
//   3. DENY fieldMask RỖNG + scope khớp target → chặn hẳn action (DENY > ALLOW).
//   4. DENY fieldMask KHÁC rỗng = DENY cấp trường: không chặn action, chỉ góp mask.
//   5. ALLOW: grant ĐÃ nói về key thì nó là nguồn sự thật — scope thoả → true (+mask),
//      scope KHÔNG thoả → false, KHÔNG rơi xuống đường cũ.
import type { Actor, Target } from "@/lib/auth/actor";
import { can as canV2, PermissionError } from "@/lib/auth/can";
import type { GrantRow } from "@/lib/permissions/grant-types";
import { phatScopeShadow } from "@/lib/permissions/scope-shadow-sink";

// Re-export giữ nguyên API public (test + consumer import GrantRow từ đây);
// định nghĩa thật nằm ở grant-types.ts (type-lá, phá vòng actor→can→actor).
export type { GrantRow } from "@/lib/permissions/grant-types";

export type GrantDecision =
  | { hit: true; allowed: boolean; fieldMask: string[] }
  | { hit: false };

/**
 * dataScope khớp target? — đơn vị đo vẫn là `centerId` (luật cứng #2: trước P4 không đổi
 * hành vi đường cũ; `Target` cố ý CHƯA mang orgUnitId, đó là việc của P3/P4).
 * - ALL: không lọc (target null vẫn true).
 * - UNIT_AND_BELOW / UNIT_ONLY: target.centerId ∈ mức TƯƠNG ỨNG của
 *   roleCenterScope[grant.subjectId] — PER-ROLE cả hai (review 09/08: neo UNIT_AND_BELOW
 *   vào union visibleCenterIds toàn actor làm grant của role CS1 vươn NGANG sang CS2 qua
 *   role kiêm nhiệm không liên quan). "ALL" = mọi centerId nhưng target null vẫn false;
 *   thiếu mapping → false (fail-closed).
 *
 *   P1 · US-05 — HAI MỨC NAY KHÁC NHAU THẬT. Trước P1 chúng dùng chung một danh sách
 *   (nợ ghi ở documentation/permissions.md). Hệ quả cụ thể: role gán tại một REGION có
 *   grant UNIT_ONLY nay KHÔNG còn với tới cơ sở nào — `unitOnly` của REGION là rỗng vì
 *   vùng không phải cơ sở. Đây là SIẾT quyền, không phải nới, và đúng bảng chân trị
 *   TS-04 mà P0 đã ký.
 * - OWN: target.createdById === actor.userId (target null → false).
 */
function scopeSatisfied(grant: GrantRow, actor: Actor, target?: Target): boolean {
  switch (grant.dataScope) {
    case "ALL":
      return true;
    case "UNIT_AND_BELOW":
    case "UNIT_ONLY": {
      // P4 · US-13 · AC2 — cutover đổi đơn vị đo. Cờ TẮT ⇒ nhánh dưới y nguyên.
      if (actor.orgScopeCutover) {
        if (!target?.orgUnitId) return false;
        const os = actor.roleOrgScope?.[grant.subjectId];
        if (os == null) return false;
        if (os === "ALL") return true;
        return (grant.dataScope === "UNIT_ONLY" ? os.unitOnly : os.unitAndBelow).includes(
          target.orgUnitId,
        );
      }
      if (!target?.centerId) return false;
      const scope = actor.roleCenterScope?.[grant.subjectId];
      if (scope == null) return false; // thiếu mapping → an toàn = false
      if (scope === "ALL") return true;
      const centers = grant.dataScope === "UNIT_ONLY" ? scope.unitOnly : scope.unitAndBelow;
      return centers.includes(target.centerId);
    }
    case "OWN":
      // US-13 · AC4 — xem lib/auth/can.ts: "của mình" gồm cả quan hệ giám hộ.
      if (target?.studentId && actor.guardedStudentIds?.has(target.studentId)) return true;
      return !!target?.createdById && target.createdById === actor.userId;
    default:
      return false;
  }
}

/**
 * Row ALLOW mang fieldMask khác rỗng là dữ liệu VÔ NGHĨA với engine (mask chỉ dành
 * cho DENY cấp trường — BA §2.5). Bỏ qua row + warn 1 lần/process để không mở quyền
 * RỘNG HƠN ý người cấp một cách im lặng (review 09/08). US-03 sẽ chặn cứng ở write path.
 */
const warnedInvalidAllow = new Set<string>();
function isValidGrantRow(g: GrantRow): boolean {
  if (g.effect === "ALLOW" && g.fieldMask.length > 0) {
    const k = `${g.subjectType}:${g.subjectId}:${g.permissionKey}`;
    if (!warnedInvalidAllow.has(k)) {
      warnedInvalidAllow.add(k);
      console.warn(
        `[permissions] Bỏ qua grant ALLOW có fieldMask (chỉ DENY được mang mask) — ${k}`,
      );
    }
    return false;
  }
  return true;
}

/** Grant thuộc về actor? — subjectId phải nằm trong roleIds/groupIds actor ĐANG giữ. */
function matchesSubject(grant: GrantRow, actor: Actor): boolean {
  const ids = grant.subjectType === "ROLE" ? actor.roleIds : actor.groupIds;
  return ids != null && ids.includes(grant.subjectId);
}

/**
 * Tra bảng grant MỚI cho (actor, key, target). PURE + SYNC.
 * hit:false = bảng grant KHÔNG nói gì về key này → caller fallback đường cũ.
 * Lưu ý: chỉ có DENY cấp trường (không ALLOW nào cùng key) cũng là hit:false —
 * DENY cấp trường không quyết action, chỉ che trường (đọc qua getFieldMask).
 */
export function resolveGrant(actor: Actor, permissionKey: string, target?: Target): GrantDecision {
  if (actor.isSuperAdmin) return { hit: false };

  const matched = (actor.permissionGrants ?? []).filter(
    (g) => g.permissionKey === permissionKey && matchesSubject(g, actor) && isValidGrantRow(g),
  );
  if (matched.length === 0) return { hit: false };

  // DENY toàn action (fieldMask rỗng) thắng mọi ALLOW cùng key — khi scope khớp target.
  for (const g of matched) {
    if (g.effect === "DENY" && g.fieldMask.length === 0 && scopeSatisfied(g, actor, target)) {
      return { hit: true, allowed: false, fieldMask: [] };
    }
  }

  // DENY cấp trường: góp mask (khi scope khớp), không chặn action.
  const fieldMask: string[] = [];
  for (const g of matched) {
    if (g.effect === "DENY" && g.fieldMask.length > 0 && scopeSatisfied(g, actor, target)) {
      for (const f of g.fieldMask) if (!fieldMask.includes(f)) fieldMask.push(f);
    }
  }

  const allows = matched.filter((g) => g.effect === "ALLOW");
  if (allows.length === 0) return { hit: false }; // chỉ DENY cấp trường → không quyết action

  // Grant là nguồn sự thật về key nó nói: scope fail → false, KHÔNG fallback.
  const allowed = allows.some((g) => scopeSatisfied(g, actor, target));
  return { hit: true, allowed, fieldMask };
}

/**
 * can() hợp nhất (luật cứng #1/#2): bảng grant mới nói gì thì theo đó;
 * không nói gì (hit:false) → fallback NGUYÊN TRẠNG can() v2 hiện hành.
 */
export function can(actor: Actor, permissionKey: string, target?: Target): boolean {
  const decision = resolveGrant(actor, permissionKey, target);
  const ketQua = decision.hit ? decision.allowed : canV2(actor, permissionKey, target);

  // P3 · US-12 — báo cho pha shadow SAU KHI đã có kết quả, đúng MỘT lần mỗi lượt gọi.
  //
  // Sau chứ không trước: thứ tự này làm rõ shadow không tham gia vào quyết định. Hàm
  // trả void và tự nuốt lỗi (AC3) — dòng dưới không thể đổi `ketQua`.
  // Một lần mỗi lượt chứ không mỗi dòng grant: `can()` là ALLOW-wins trên nhiều dòng,
  // lệch một dòng mà kết quả cuối không đổi thì người dùng không thấy gì khác.
  phatScopeShadow(actor, permissionKey, target);

  return ketQua;
}

/**
 * Danh sách trường bị che cho (actor, key, target) — từ DENY cấp trường khớp scope.
 * Tính ĐỘC LẬP với quyết định action: ALLOW có thể đến từ đường cũ (TS-02 nhóm US-03)
 * mà trường vẫn phải che.
 */
export function getFieldMask(actor: Actor, permissionKey: string, target?: Target): string[] {
  if (actor.isSuperAdmin) return [];
  const mask: string[] = [];
  for (const g of actor.permissionGrants ?? []) {
    if (
      g.permissionKey === permissionKey &&
      g.effect === "DENY" &&
      g.fieldMask.length > 0 &&
      matchesSubject(g, actor) &&
      scopeSatisfied(g, actor, target)
    ) {
      for (const f of g.fieldMask) if (!mask.includes(f)) mask.push(f);
    }
  }
  return mask;
}

/** Bản assert cho Server Action — throw PermissionError (tái dùng từ lib/auth/can). */
export function assertCan(actor: Actor, permissionKey: string, target?: Target): void {
  if (!can(actor, permissionKey, target)) throw new PermissionError();
}
