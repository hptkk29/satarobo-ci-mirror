// lib/auth/actor.ts — A0-03: ActorResolver (Doc 15 §2.4, OI-5/OI-7).
// Tách 2 lớp: buildActor() THUẦN (test không cần DB) + resolveActor() DB-backed
// (React.cache → 1 query/request). Quyền resolve per-request từ DB, KHÔNG nằm trong JWT.
import { cache } from "react";
import { db } from "@/lib/db";
import { ACTION_REGISTRY } from "@/lib/auth/action-registry";
import { getGlobalSetting } from "@/lib/settings/read-global";
import {
  centerScopeForOrgUnit,
  getSubtreeCenterIds,
  getSubtreeOrgUnitIds,
} from "@/lib/org/org-tree";
import type { OrgUnitNode } from "@/lib/org/types";
// US-02 — type-only (erased khi compile, không tạo cycle runtime với lib/permissions/can.ts).
// GrantRow lấy từ module type-lá (KHÔNG phải lib/permissions/can) — tránh vòng
// actor→can→actor bị dependency-cruiser no-circular chặn ở CI.
import type { GrantRow } from "@/lib/permissions/grant-types";
import { loadPositionRoleRows } from "@/lib/org/positions";

// REQ-02 (REVERTED) — cây OrgUnit đọc TRẦN mỗi request. Trước đây bọc unstable_cache
// (TTL 300s) nhưng: (a) bảng OrgUnit RẤT NHỎ (HO+CS1+CS2…) → full-scan không đáng kể,
// lợi ích cache ~0; (b) mutation NGOÀI app (SQL/seed e2e) không invalidate được cache
// trong server → resolveActor trả cây STALE → sai visibleCenterIds → scope rỗng (đã làm
// smoke mobile-chrome đỏ: inbox rỗng do actor thấy center cũ). Bỏ cache = an toàn đúng đắn.
async function getOrgTree(): Promise<OrgUnitNode[]> {
  const orgUnits = await db.orgUnit.findMany({ where: { deletedAt: null } });
  return orgUnits.map((o) => ({
    id: o.id,
    code: o.code,
    type: o.type as OrgUnitNode["type"],
    parentId: o.parentId,
    centerId: o.centerId,
    isActive: o.isActive,
    deletedAt: null,
  }));
}

// Hai kiểu này ở module lá `actor-types` để cắt vòng import với `lib/org/positions.ts`;
// re-export tại đây nên mọi caller cũ không phải sửa gì.
export type { ScopeType, UserOrgRoleRow } from "./actor-types";
import type { ScopeType, UserOrgRoleRow } from "./actor-types";

/** 1 permission đã "nở" theo role + orgUnit của actor. */
export type PermEntry = {
  action: string;
  scopeType: ScopeType;
  orgUnitId: string;
  roleCode: string;
  /**
   * Tầm nhìn cơ sở của CHÍNH permission này: "ALL" khi role gắn ở HO/ROOT (cross-center
   * theo chức năng — Doc 15 §2), ngược lại là list centerId trong subtree của orgUnit.
   * Gán cho MỌI perm (không riêng scopeType CENTER) — `getModelVisibleCenterIds` gom
   * union theo prefix action của model, nhờ đó một người kiêm TRAINING@HO + CM@CS1
   * thấy học viên/lớp cả 2 cơ sở nhưng chỉ thấy lead/doanh thu CS1.
   */
  centerScope: "ALL" | string[] | null;
  /**
   * P3 · US-12 — bản SONG SONG của `centerScope`, đo bằng `orgUnitId`. Cùng công thức,
   * cùng ý nghĩa `null` (vai quan hệ → không bao giờ khớp scope CENTER, fail-closed).
   *
   * OPTIONAL có chủ đích: ~35 chỗ dựng `Actor` literal (system-actor, test cũ) không
   * mang field này. Thiếu ⇒ shadow đếm là "chưa phủ", KHÔNG phải lệch — xem
   * `soSanhPermEntry`. Chỉ dùng cho pha shadow; đường enforce vẫn đọc `centerScope`
   * cho tới P4 (luật cứng #2).
   */
  orgUnitScope?: "ALL" | string[] | null;
};

export type Actor = {
  userId: string;
  isSuperAdmin: boolean;
  /** Có ≥1 role tại OrgUnit type HO/ROOT → cross-center theo chức năng (A0-04 bypass scope). */
  isHoLevel: boolean;
  orgRoles: { orgUnitId: string; roleCode: string }[];
  permissions: PermEntry[];
  visibleCenterIds: string[];
  /**
   * OrgUnit IDs actor nhìn thấy (Phase 0 migrate Center→OrgUnit). Song song với
   * visibleCenterIds; scopedDb sẽ chuyển sang dùng field này ở Phase D. HO/ROOT →
   * mọi đơn vị; CENTER → subtree theo orgUnitId.
   */
  visibleOrgUnitIds: string[];
  grantsAllow: Set<string>;
  assignedClassIds: Set<string>;
  /**
   * P4 · US-13 · AC4 — học viên mà actor là NGƯỜI GIÁM HỘ (liên kết Guardian–Student,
   * hiện là `Student.parentUserId`). Nền của scope `OWN` cho phụ huynh.
   *
   * Vì sao không dùng `CHILDREN`: `CHILDREN` so `target.parentUserId` — tức chỗ gọi
   * phải tự nạp học viên rồi truyền cha/mẹ vào, và mỗi chỗ gọi tự nhớ. Đó đúng là hình
   * dạng đã đẻ ra `assertOwnsStudent` nằm NGOÀI `can()` (vi phạm luật cứng #1). Giữ
   * danh sách trên Actor thì `can(actor, key, { studentId })` là đủ.
   *
   * OPTIONAL: ~35 chỗ dựng Actor literal không có field này (⇒ tập rỗng ⇒ fail-closed).
   */
  guardedStudentIds?: Set<string>;
  /**
   * 28/09/2026 — cơ sở (`Class.centerId`) của các lớp actor ĐỨNG LỚP / TRỢ GIẢNG
   * (cùng nguồn với `assignedClassIds`). Giáo viên neo vai tại CS1 mà được phân dạy lớp
   * ở CS2 thì CS2 nằm ở đây. BẢN THÂN field này không nới gì — chỉ có tác dụng khi
   * `phamViGiangDay` bật (xem `actorGiangDay` ở lib/db-scope.ts).
   * OPTIONAL: Actor literal cũ không có ⇒ rỗng ⇒ không nới.
   */
  teachingCenterIds?: string[];
  /**
   * Bật bởi `actorGiangDay()` — CHỈ site giáo viên dùng. Khi bật, scopedDb cộng
   * `teachingCenterIds` vào tầm nhìn của các model ĐÀO TẠO (GIANG_DAY_MODELS).
   * Không ảnh hưởng `can()`.
   */
  phamViGiangDay?: boolean;
  /**
   * P4 · US-13 · AC2 — cutover đơn vị đo của scope: `centerId` → `orgUnitId`.
   *
   * Nguồn là `SystemSetting("orgScope.cutoverEnabled")` chứ KHÔNG phải env, vì AC2 đòi
   * rollback 1 thao tác KHÔNG cần deploy (đổi env trên Vercel là phải redeploy, và
   * trong lúc chờ thì quyền vẫn sai). Đọc lúc dựng Actor mỗi request nên `can()` vẫn
   * thuần + đồng bộ.
   */
  orgScopeCutover?: boolean;
  // ── US-02 (Nền Hệ thống P0) — ADDITIVE OPTIONAL: nạp sẵn cho engine lib/permissions/can.ts.
  // Optional có chủ đích: ~35 file dựng Actor literal (system-actor, test cũ) không vỡ.
  /** RoleDef.id của các role ĐANG hiệu lực (đối chiếu PermissionGrant subjectType=ROLE). */
  roleIds?: string[];
  /** US-03 — UserGroup.id các nhóm actor là thành viên (chỉ nhóm CHƯA xoá mềm). */
  groupIds?: string[];
  /** Grant từ bảng PermissionGrant MỚI (KHÔNG phải UserPermissionGrant cũ). */
  permissionGrants?: GrantRow[];
  /**
   * Tầm nhìn cơ sở per RoleDef.id cho dataScope UNIT_* — cùng công thức PermEntry.centerScope.
   *
   * P1 · US-05 ĐỔI SHAPE: trước đây là MỘT danh sách nên `can()` không phân biệt nổi
   * UNIT_ONLY với UNIT_AND_BELOW (nợ đã ghi ở documentation/permissions.md). Nay mang cả
   * hai mức, `lib/permissions/can.ts` chọn theo `grant.dataScope`.
   * "ALL" giữ nguyên nghĩa: role đặt tại HO/ROOT → cross-center theo chức năng.
   */
  roleCenterScope?: Record<string, RoleCenterScope>;
  /**
   * P3 · US-12 — bản SONG SONG của `roleCenterScope`, đo bằng `orgUnitId` thay vì
   * `centerId`. Dùng cho resolver mới chạy shadow (lib/permissions/scope-shadow.ts).
   *
   * Hai mức tính từ CÂY: `unitOnly` = chính đơn vị neo vai; `unitAndBelow` = cả cây
   * con (`getSubtreeOrgUnitIds`, tức resolve bằng path — BA §2.5). Tính sẵn ở đây để
   * lúc chạy chỉ còn một phép `includes`, cùng hình dạng với `roleCenterScope` nên
   * hai vế shadow so được công bằng.
   *
   * KHÁC `roleCenterScope` ở một điểm đáng nhớ: vai neo tại REGION có `unitOnly` là
   * CHÍNH REGION đó (khác rỗng), trong khi bản centerId thì rỗng vì vùng không phải
   * cơ sở. Đây là chênh lệch THẬT giữa hai mô hình, và là thứ shadow sinh ra để đo.
   */
  roleOrgScope?: Record<string, RoleOrgScope>;
};

/** Phạm vi cơ sở của MỘT role, tách 2 mức (BA §2.5). Xem lib/org/org-tree.ts. */
export type RoleCenterScope = "ALL" | { unitOnly: string[]; unitAndBelow: string[] };

/** Phạm vi ĐƠN VỊ của MỘT role — bản song song, đo bằng orgUnitId (P3 · US-12). */
export type RoleOrgScope = "ALL" | { unitOnly: string[]; unitAndBelow: string[] };

/** Đối tượng bị kiểm tra quyền (tùy action mà cần field nào). */
export type Target = {
  centerId?: string | null;
  /**
   * P3 · US-12 — đơn vị của đối tượng. Chỗ gọi truyền được thì resolver mới so được;
   * chưa truyền thì shadow đếm vào `chua-phu` (KHÔNG phải lệch).
   *
   * Khi cờ `orgScopeCutover` TẮT (mặc định), field này KHÔNG ảnh hưởng quyết định —
   * đường cũ đo bằng `centerId`. Khi BẬT, nó là thứ quyết định, và THIẾU nó = TỪ CHỐI.
   */
  orgUnitId?: string | null;
  createdById?: string | null;
  parentUserId?: string | null;
  classId?: string | null;
  /**
   * P4 · US-13 · AC4 — học viên mà đối tượng này thuộc về. Cho scope `OWN` của phụ
   * huynh: `can(actor, key, { studentId })` thay cho `assertOwnsStudent` gọi tay.
   */
  studentId?: string | null;
} | null;

/**
 * VAI QUAN HỆ — vai KHÔNG gắn vào đơn vị tổ chức, quyền suy ra từ QUAN HỆ với dữ liệu
 * (con mình, hội thoại mình là thành viên), không từ chỗ đứng trong cây OrgUnit.
 *
 * ⚠️ VÌ SAO PHẢI CÓ — SỰ CỐ ĐO ĐƯỢC 10/08/2026: phụ huynh KHÔNG gửi được tin nào, cả
 * chữ lẫn ảnh, trên test lẫn prod. `sendChatMessageAction` trả `PERMISSION_DENIED` trong
 * khi `permissions.md` ghi rõ "PH ✅ Gửi CHAT". Đo trên DB: **114 tài khoản PARENT, 0
 * dòng `UserOrgRole`**. RBAC v2 lấy quyền DUY NHẤT từ `UserOrgRole` ⇒ `actor.permissions`
 * rỗng ⇒ mọi scope đều vô nghĩa vì không có gì để khớp. Đọc thì vẫn chạy nên lỗi ẩn kỹ:
 * đường đọc chat kiểm theo tư cách THÀNH VIÊN HỘI THOẠI, không qua `can()`.
 *
 * Vì sao KHÔNG vá bằng cách tạo `UserOrgRole` cho từng phụ huynh:
 *  1. Sẽ phải backfill 114 tài khoản cũ VÀ nhớ gắn cho mọi tài khoản tạo sau — quên một
 *     lần là một phụ huynh câm lặng không ai biết. Chủ dự án yêu cầu dứt điểm 10/08.
 *  2. `buildActor` suy `isHoLevel` + `visibleCenterIds` TỪ CHÍNH các dòng `UserOrgRole`.
 *     Gắn phụ huynh vào ROOT là biến họ thành "HO-level, thấy mọi cơ sở" — nới quyền ở
 *     đúng chỗ nguy hiểm nhất, để đổi lấy một thứ họ không cần.
 *
 * Cho nên: vai quan hệ nạp thẳng từ `RoleDef` theo `User.roles`, và **CỐ Ý KHÔNG** đóng
 * góp vào `isHoLevel` / `visibleCenterIds` / `visibleOrgUnitIds`. `centerScope: null` ⇒
 * mọi permission scope CENTER của vai này (nếu ai đó lỡ khai) sẽ KHÔNG BAO GIỜ khớp —
 * fail-closed đúng hướng.
 *
 * RoleDef vẫn là NƠI DUY NHẤT định nghĩa vai này được làm gì: sửa quyền phụ huynh = sửa
 * `prisma/seed-roles.ts` rồi chạy seed, y hệt mọi vai khác.
 */
export const RELATIONSHIP_ROLE_CODES = ["PARENT"] as const;

export type RelationshipRole = {
  code: string;
  isActive: boolean;
  permissions: { action: string; scopeType: ScopeType }[];
};



const isLiveNode = (n: OrgUnitNode): boolean =>
  n.deletedAt == null && n.isActive !== false;
const isHoRoot = (n: OrgUnitNode | undefined): boolean =>
  n?.type === "HO" || n?.type === "ROOT";

function allCenterIds(orgNodes: OrgUnitNode[]): string[] {
  return orgNodes
    .filter((n) => n.type === "CENTER" && isLiveNode(n) && n.centerId)
    .map((n) => n.centerId as string);
}

/**
 * Xây Actor THUẦN từ dữ liệu đã nạp — lọc role hiệu lực (status ACTIVE,
 * RoleDef.isActive, effectiveFrom<=now<=effectiveTo). Không chạm DB.
 */
export function buildActor(input: {
  userId: string;
  rows: UserOrgRoleRow[];
  orgNodes: OrgUnitNode[];
  grants?: { action: string; grant: "ALLOW" | "DENY" }[];
  assignedClassIds?: string[];
  /** 28/09 — cơ sở của các lớp trong `assignedClassIds` (xem Actor.teachingCenterIds). */
  teachingCenterIds?: string[];
  now?: Date;
  validActions?: Set<string>;
  /** US-02 — grant bảng MỚI (PermissionGrant) đã query theo roleIds/groupIds của actor. */
  permissionGrants?: GrantRow[];
  /** US-03 — UserGroup.id của các nhóm actor đang là thành viên (nhóm CHƯA xoá mềm). */
  groupIds?: string[];
  /** Vai KHÔNG gắn đơn vị (xem {@link RELATIONSHIP_ROLE_CODES}). */
  relationshipRoles?: RelationshipRole[];
  /** US-13 · AC4 — học viên actor giám hộ (Guardian–Student). */
  guardedStudentIds?: string[];
  /** US-13 · AC2 — cờ cutover đơn vị đo (nguồn: SystemSetting, đọc mỗi request). */
  orgScopeCutover?: boolean;
}): Actor {
  const now = input.now ?? new Date();
  const orgById = new Map(input.orgNodes.map((n) => [n.id, n]));
  const everyCenter = allCenterIds(input.orgNodes);
  const everyOrgUnit = input.orgNodes.filter(isLiveNode).map((n) => n.id);
  const validActions = input.validActions ?? new Set(ACTION_REGISTRY);

  // Lọc role ĐANG hiệu lực (T7).
  const liveRows = input.rows.filter(
    (r) =>
      r.status === "ACTIVE" &&
      r.role.isActive &&
      r.effectiveFrom <= now &&
      (r.effectiveTo == null || r.effectiveTo >= now),
  );

  const isSuperAdmin = liveRows.some(
    (r) => r.role.code === "SUPER_ADMIN" && isHoRoot(orgById.get(r.orgUnitId)),
  );
  // HO-level = bất kỳ role nào tại HO/ROOT (cross-center theo chức năng).
  const isHoLevel = liveRows.some((r) => isHoRoot(orgById.get(r.orgUnitId)));

  const orgRoles = liveRows.map((r) => ({ orgUnitId: r.orgUnitId, roleCode: r.role.code }));

  const permissions: PermEntry[] = [];
  const visible = new Set<string>();
  const visibleOrg = new Set<string>();
  // US-02 — RoleDef.id đang hiệu lực + tầm nhìn cơ sở per role (cho dataScope UNIT_*).
  const roleIdSet = new Set<string>();
  const roleCenterScope: Record<string, RoleCenterScope> = {};
  // P3 · US-12 — bản song song đo bằng orgUnitId, cho resolver shadow.
  const roleOrgScope: Record<string, RoleOrgScope> = {};

  for (const r of liveRows) {
    const node = orgById.get(r.orgUnitId);
    const hoRoot = isHoRoot(node);
    // P2 · US-10 — NƠI TÁC NGHIỆP cộng vào NƠI TRỰC THUỘC (AC2: phạm vi = đơn vị trực
    // thuộc ∪ WorkScope còn hiệu lực). Caller đã lọc theo mốc thời gian, nên hết hạn là
    // đơn vị đó BIẾN MẤT khỏi mảng này ⇒ mất truy cập ngay ở request kế tiếp (AC3),
    // không cron nào phải dọn. WorkScope CHỈ nới phạm vi của CHÍNH hàng này — không đổi
    // `isHoLevel`, không thêm vai, không thêm permission.
    const scopeUnits = [r.orgUnitId, ...(r.workScopeOrgUnitIds ?? [])];
    // visibleCenterIds: HO/ROOT → mọi center (cross-center theo chức năng); CENTER → subtree.
    const rowCenters = hoRoot
      ? everyCenter
      : [...new Set(scopeUnits.flatMap((u) => getSubtreeCenterIds(input.orgNodes, u)))];
    rowCenters.forEach((c) => visible.add(c));
    // visibleOrgUnitIds (song song): HO/ROOT → mọi đơn vị; còn lại → subtree orgUnitId.
    const rowOrgUnits = hoRoot
      ? everyOrgUnit
      : [...new Set(scopeUnits.flatMap((u) => getSubtreeOrgUnitIds(input.orgNodes, u)))];
    rowOrgUnits.forEach((o) => visibleOrg.add(o));

    // US-02/US-05 — roleCenterScope: CÙNG công thức PermEntry.centerScope (hoRoot → "ALL");
    // ngược lại tách 2 mức qua centerScopeForOrgUnit (P1). Role gán ở nhiều orgUnit →
    // "ALL" thắng, còn lại hợp (union) TỪNG MỨC — không trộn hai mức vào nhau, vì trộn là
    // đúng cái làm UNIT_ONLY nở ra bằng UNIT_AND_BELOW.
    if (r.roleId) {
      roleIdSet.add(r.roleId);
      const prev = roleCenterScope[r.roleId];
      if (hoRoot || prev === "ALL") {
        roleCenterScope[r.roleId] = "ALL";
      } else {
        // US-10: điều động cộng vào CẢ HAI mức. `unitOnly` phải có, nếu không thì vai
        // mang dataScope UNIT_ONLY (mặc định của học viên/lớp — BA §4) vẫn không với tới
        // cơ sở được điều đến, tức điều động không có tác dụng gì cho đúng nghiệp vụ
        // sinh ra nó.
        const scopes = scopeUnits.map((u) => centerScopeForOrgUnit(input.orgNodes, u));
        const prevObj = prev ?? { unitOnly: [], unitAndBelow: [] };
        roleCenterScope[r.roleId] = {
          unitOnly: [...new Set([...prevObj.unitOnly, ...scopes.flatMap((x) => x.unitOnly)])],
          unitAndBelow: [
            ...new Set([...prevObj.unitAndBelow, ...scopes.flatMap((x) => x.unitAndBelow)]),
          ],
        };
      }

      // P3 · US-12 — CÙNG công thức, đổi đơn vị đo sang orgUnitId.
      // `unitOnly` = chính đơn vị neo vai (kể cả REGION — khác bản centerId, nơi vùng
      // cho ra rỗng vì không phải cơ sở). `unitAndBelow` = cả cây con, tính từ path.
      // Điều động tác nghiệp (US-10) cộng vào cả hai mức, y như bản centerId.
      const prevOrg = roleOrgScope[r.roleId];
      if (hoRoot || prevOrg === "ALL") {
        roleOrgScope[r.roleId] = "ALL";
      } else {
        const prevOrgObj = prevOrg ?? { unitOnly: [], unitAndBelow: [] };
        roleOrgScope[r.roleId] = {
          unitOnly: [...new Set([...prevOrgObj.unitOnly, ...scopeUnits])],
          unitAndBelow: [
            ...new Set([
              ...prevOrgObj.unitAndBelow,
              ...scopeUnits.flatMap((u) => getSubtreeOrgUnitIds(input.orgNodes, u)),
            ]),
          ],
        };
      }
    }

    for (const p of r.role.permissions) {
      permissions.push({
        action: p.action,
        scopeType: p.scopeType,
        orgUnitId: r.orgUnitId,
        roleCode: r.role.code,
        centerScope: hoRoot ? "ALL" : rowCenters,
        // P3 · US-12 — bản song song đo bằng đơn vị. CÙNG công thức, cùng nguồn
        // (`rowOrgUnits` đã tính ở trên cho visibleOrgUnitIds). Chỉ pha shadow đọc;
        // đường enforce vẫn dùng `centerScope` cho tới P4 (luật cứng #2).
        orgUnitScope: hoRoot ? "ALL" : rowOrgUnits,
      });
    }
  }

  // Vai quan hệ: CHỈ đổ permission vào, KHÔNG chạm `visible`/`visibleOrg`/`isHoLevel`/
  // `orgRoles` — đó là chỗ suy ra tầm nhìn theo cây tổ chức, mà vai này không đứng ở
  // đâu trong cây cả. `orgUnitId: ""` là dấu hiệu "không thuộc đơn vị nào".
  for (const role of input.relationshipRoles ?? []) {
    if (!role.isActive) continue;
    for (const p of role.permissions) {
      permissions.push({
        action: p.action,
        scopeType: p.scopeType,
        orgUnitId: "",
        roleCode: role.code,
        centerScope: null,
        // `null` KHÔNG phải "chưa tính" — là "cố ý không bao giờ khớp scope CENTER".
        // Bản đo bằng đơn vị phải giữ y hệt, nếu không P4 nới quyền phụ huynh im lặng.
        orgUnitScope: null,
      });
    }
  }

  const grantsAllow = new Set(
    (input.grants ?? [])
      .filter((g) => g.grant === "ALLOW" && validActions.has(g.action))
      .map((g) => g.action),
  );

  warnIfScopeConflict({
    userId: input.userId,
    isSuperAdmin,
    isHoLevel,
    visibleCenterIdCount: visible.size,
    assignedClassCount: (input.assignedClassIds ?? []).length,
    orgRoleCount: orgRoles.length,
  });

  return {
    userId: input.userId,
    isSuperAdmin,
    isHoLevel,
    orgRoles,
    permissions,
    visibleCenterIds: [...visible],
    visibleOrgUnitIds: [...visibleOrg],
    roleOrgScope,
    grantsAllow,
    assignedClassIds: new Set(input.assignedClassIds ?? []),
    teachingCenterIds: [...new Set(input.teachingCenterIds ?? [])],
    guardedStudentIds: new Set(input.guardedStudentIds ?? []),
    orgScopeCutover: input.orgScopeCutover === true,
    // US-02 — additive: engine mới (lib/permissions/can.ts) đọc các field này.
    roleIds: [...roleIdSet],
    groupIds: input.groupIds ?? [], // US-03 — membership nhóm (caller đã lọc nhóm sống)
    permissionGrants: input.permissionGrants ?? [],
    roleCenterScope,
  };
}

/**
 * Vai quan hệ của user, suy TỪ `User.role`/`User.roles` — không cần `UserOrgRole`.
 * Trả mảng rỗng (không truy vấn RoleDef) với người không mang vai nào trong
 * {@link RELATIONSHIP_ROLE_CODES}, tức đại đa số nhân viên: đường nóng không tốn thêm gì.
 */
async function loadRelationshipRoles(userId: string): Promise<RelationshipRole[]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, roles: true },
  });
  if (!user) return [];
  const codes = new Set<string>([user.role as string, ...(user.roles as string[])]);
  const wanted = RELATIONSHIP_ROLE_CODES.filter((c) => codes.has(c));
  if (wanted.length === 0) return [];

  const defs = await db.roleDef.findMany({
    where: { code: { in: [...wanted] } },
    select: { code: true, isActive: true, permissions: true },
  });
  return defs.map((d) => ({
    code: d.code,
    isActive: d.isActive,
    permissions: d.permissions.map((p) => ({
      action: p.action,
      scopeType: p.scopeType as ScopeType,
    })),
  }));
}

export async function resolveActorUncached(userId: string): Promise<Actor> {
  const now = new Date();
  const [rows, orgNodes, grants, classes, groupMemberships, relationshipRoles, positionRows] =
    await Promise.all([
    db.userOrgRole.findMany({
      where: {
        userId,
        status: "ACTIVE",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      include: { role: { include: { permissions: true } } },
    }),
    getOrgTree(), // REQ-02: cây OrgUnit cache cross-request (thay findMany mỗi request).
    db.userPermissionGrant.findMany({
      where: { userId },
      select: { action: true, grant: true },
    }),
    // QA 21/07 — lớp XOÁ MỀM không còn là "lớp được gán": thiếu filter này site GV
    // vẫn hiện lớp đã xoá ở grid Ảnh lớp/Lớp của tôi + ownership vẫn nhận buổi của nó.
    db.class.findMany({
      where: { deletedAt: null, OR: [{ teacherId: userId }, { assistantId: userId }] },
      select: { id: true, centerId: true },
    }),
    // US-03 — membership nhóm, CHỈ nhóm còn sống (group.deletedAt null): nhóm xoá mềm
    // → grant GROUP của nó vô hiệu ngay lần resolve kế, không cần dọn PermissionGrant.
    db.userGroupMember.findMany({
      where: { userId, group: { deletedAt: null } },
      select: { groupId: true },
    }),
      loadRelationshipRoles(userId),
      // P2 · US-08 — vai hưởng QUA VỊ TRÍ. Trả về cùng khuôn `UserOrgRoleRow` nên nhập
      // thẳng vào `rows` bên dưới; mọi logic scope của `buildActor` áp dụng y hệt, không
      // có đường quyền thứ hai để trôi lệch. Xem khối chú thích đầu lib/org/positions.ts.
      loadPositionRoleRows(userId, now),
    ]);

  // US-02/US-03 — query grant (phụ thuộc roleIds/groupIds nên nằm SAU Promise.all):
  // grant bảng MỚI PermissionGrant theo ROLE ∪ GROUP; cả hai rỗng → skip (PARENT
  // không tốn query).
  const roleIds = [...new Set(rows.map((r) => r.roleId))];
  const groupIds = groupMemberships.map((m) => m.groupId);
  const permissionGrants =
    roleIds.length === 0 && groupIds.length === 0
      ? []
      : await db.permissionGrant.findMany({
          where: {
            OR: [
              ...(roleIds.length > 0
                ? [{ subjectType: "ROLE" as const, subjectId: { in: roleIds } }]
                : []),
              ...(groupIds.length > 0
                ? [{ subjectType: "GROUP" as const, subjectId: { in: groupIds } }]
                : []),
            ],
          },
          select: {
            subjectType: true,
            subjectId: true,
            permissionKey: true,
            effect: true,
            dataScope: true,
            fieldMask: true,
          },
        });

  // US-13 · AC4 — học viên actor đang giám hộ. CHỈ hỏi khi actor thực sự có vai quan hệ:
  // nhân sự không giám hộ ai, bắt họ trả thêm một query mỗi request là phí thuần tuý.
  // AC2 — cờ cutover đọc từ SystemSetting (không phải env) để rollback không cần deploy.
  const [guardedStudents, cutover] = await Promise.all([
    relationshipRoles.length > 0
      ? db.student.findMany({
          where: { parentUserId: userId, deletedAt: null },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
    getGlobalSetting("orgScope.cutoverEnabled").catch(() => false),
  ]);

  return buildActor({
    userId,
    now,
    orgNodes,
    permissionGrants,
    groupIds,
    relationshipRoles,
    guardedStudentIds: guardedStudents.map((s) => s.id),
    orgScopeCutover: cutover === true,
    rows: [
      ...rows.map((r) => ({
        orgUnitId: r.orgUnitId,
        roleId: r.roleId,
        status: r.status,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        role: {
          code: r.role.code,
          isActive: r.role.isActive,
          permissions: r.role.permissions.map((p) => ({
            action: p.action,
            scopeType: p.scopeType as ScopeType,
          })),
        },
      })),
      ...positionRows,
    ],
    grants: grants.map((g) => ({ action: g.action, grant: g.grant })),
    assignedClassIds: classes.map((c) => c.id),
    teachingCenterIds: classes.flatMap((c) => (c.centerId ? [c.centerId] : [])),
  });
}

/** Resolve Actor cho 1 user — React.cache → 1 lần truy vấn/request (AC11). */
export const resolveActor = cache(resolveActorUncached);


/**
 * Actor TỰ MÂU THUẪN: được phân lớp để dạy nhưng không nhìn thấy cơ sở nào.
 *
 * Xảy ra khi user có `Class.teacherId` trỏ tới mình nhưng KHÔNG có dòng `UserOrgRole`
 * nào còn hiệu lực — `visibleCenterIds` dựng THUẦN từ `UserOrgRole`, không có đường lùi
 * về `User.centerId`. Đây là sự cố có thật trên prod 07/08/2026, và cùng hình dạng với
 * sự cố phụ huynh 10/08 (114 tài khoản PARENT / 0 dòng UserOrgRole).
 *
 * Hậu quả trước đây là hỏng CÂM: `Class` nằm trong SCOPED_MODELS nên scopedDb chèn
 * `centerId IN ()` rỗng ⇒ khoảng 24 màn của site giáo viên trả rỗng, mỗi màn hỏng một
 * kiểu riêng — bảng "x/0", lưới trắng, hoặc 404 "không thuộc lớp bạn phụ trách" — mà
 * không màn nào ném lỗi. Người dùng báo "site hỏng", dev đi soi từng màn.
 *
 * Hàm này KHÔNG đổi cách ly (fail-closed vẫn là fail-closed, cố ý). Nó chỉ làm sự lệch
 * NÓI RA ĐƯỢC, để một dòng log chỉ thẳng vào nguyên nhân thay vì phải suy từ triệu
 * chứng. Cách chữa vẫn là gắn `UserOrgRole` cho user đó (xem docs/nen-he-thong).
 *
 * Tách hàm thuần để test được — đừng nhúng điều kiện này thẳng vào `buildActor`.
 */
export function detectActorScopeConflict(a: {
  isSuperAdmin: boolean;
  isHoLevel: boolean;
  visibleCenterIdCount: number;
  assignedClassCount: number;
  orgRoleCount: number;
}): "MISSING_ORG_ROLE" | "NO_VISIBLE_CENTER" | null {
  // SUPER_ADMIN và vai cấp Hội sở đi nhánh cross-center riêng, không cần visibleCenterIds.
  if (a.isSuperAdmin || a.isHoLevel) return null;
  // Không được phân lớp nào thì không có gì mâu thuẫn (nhân sự văn phòng, phụ huynh…).
  if (a.assignedClassCount === 0) return null;
  if (a.visibleCenterIdCount > 0) return null;
  return a.orgRoleCount === 0 ? "MISSING_ORG_ROLE" : "NO_VISIBLE_CENTER";
}

function warnIfScopeConflict(a: {
  userId: string;
  isSuperAdmin: boolean;
  isHoLevel: boolean;
  visibleCenterIdCount: number;
  assignedClassCount: number;
  orgRoleCount: number;
}): void {
  const kind = detectActorScopeConflict(a);
  if (!kind) return;
  const why =
    kind === "MISSING_ORG_ROLE"
      ? "user KHÔNG có dòng UserOrgRole nào còn hiệu lực"
      : "có UserOrgRole nhưng không vai nào neo vào một cơ sở nhìn thấy được";
  console.warn(
    `[actor] Phạm vi tự mâu thuẫn: user ${a.userId} được phân ${a.assignedClassCount} lớp ` +
      `nhưng visibleCenterIds rỗng — ${why}. Mọi màn đọc Class qua scopedDb sẽ trả RỖNG ` +
      `(bảng x/0, lưới trắng, 404 "không thuộc lớp bạn phụ trách"). Chữa bằng cách gắn ` +
      `UserOrgRole cho user này, KHÔNG nới cách ly.`,
  );
}
