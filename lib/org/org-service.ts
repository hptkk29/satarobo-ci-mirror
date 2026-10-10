// lib/org/org-service.ts — Tầng DB-backed cho OrgUnit (ticket A0-01 §3).
// Gọi lại rule THUẦN trong orgunit-rules.ts / org-tree.ts (không lặp logic).
// Lỗi nghiệp vụ → OrgRuleError (code EN + message VI). Doc 15 §2.1, OI-1.
import { Prisma, type OrgUnit } from "@prisma/client";
import { db } from "@/lib/db";
import {
  OrgRuleError,
  type OrgRelationshipType,
  type OrgUnitNode,
  type OrgUnitStatus,
  type OrgUnitType,
} from "./types";
import {
  validateCode,
  validateCenterId,
  validateParentType,
  validateRootRule,
  wouldCreateCycle,
} from "./orgunit-rules";
import { assertLegalEntityUsable } from "./legal-entity";
import { childPath, recomputeSubtree } from "./path";
import { isActiveFromStatus } from "./status";
import {
  getAncestors as getAncestorsPure,
  getSubtreeCenterIds as getSubtreeCenterIdsPure,
  isAncestor as isAncestorPure,
  selectableOrgUnits,
  type SelectableOrgUnit,
} from "./org-tree";
import type { Actor } from "@/lib/auth/actor";

export type CreateOrgUnitInput = {
  type: OrgUnitType;
  code: string;
  name: string;
  parentId?: string | null;
  address?: string | null;
  centerId?: string | null;
  /** P1 · US-05 — trục sở hữu. Mặc định OWNED (đơn vị nội bộ). */
  relationshipType?: OrgRelationshipType;
  legalEntityId?: string | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
};

export type UpdateOrgUnitInput = Partial<{
  name: string;
  /** Đổi code kéo theo tính lại path của CẢ NHÁNH — xem recomputeSubtree. */
  code: string;
  parentId: string | null;
  address: string | null;
  relationshipType: OrgRelationshipType;
  status: OrgUnitStatus;
  legalEntityId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}>;

/** Prisma row → node tối giản cho thuật toán cây thuần. */
function toNode(o: OrgUnit): OrgUnitNode {
  return {
    id: o.id,
    code: o.code,
    type: o.type as OrgUnitType,
    parentId: o.parentId,
    centerId: o.centerId,
    path: o.path,
    depth: o.depth,
    relationshipType: o.relationshipType as OrgRelationshipType,
    status: o.status as OrgUnitStatus,
    effectiveFrom: o.effectiveFrom,
    effectiveTo: o.effectiveTo,
    legalEntityId: o.legalEntityId,
    isActive: o.isActive,
    deletedAt: o.deletedAt,
  };
}

async function loadNodes(includeDeleted = false): Promise<OrgUnitNode[]> {
  const rows = await db.orgUnit.findMany({
    where: includeDeleted ? {} : { deletedAt: null },
  });
  return rows.map(toNode);
}

function requireName(name: string): string {
  const n = (name ?? "").trim();
  if (n.length === 0) {
    throw new OrgRuleError("ORG_NAME_REQUIRED", "Tên đơn vị không được để trống.", "name");
  }
  return n;
}

/**
 * Kiểm đơn vị cha dùng được + trả về nó (cần `path`/`type` để tính path con và kiểm V9).
 */
async function assertParentUsable(parentId: string): Promise<OrgUnit> {
  const parent = await db.orgUnit.findUnique({ where: { id: parentId } });
  if (!parent || parent.deletedAt) {
    throw new OrgRuleError(
      "ORG_PARENT_NOT_FOUND",
      "Đơn vị cha không tồn tại hoặc đã bị xoá.",
      "parentId",
    );
  }
  return parent;
}

/** Tạo OrgUnit (V1–V4, V7). code/centerId reuse của bản đã soft-delete: KHÔNG (code unique toàn cục). */
export async function createOrgUnit(input: CreateOrgUnitInput): Promise<OrgUnit> {
  const code = validateCode(input.code); // V2 (+ chuẩn hóa uppercase)
  const name = requireName(input.name);
  const parentId = input.parentId ?? null;
  const centerId = input.centerId ?? null;

  validateCenterId(input.type, centerId); // V7

  // KHÔNG lọc deletedAt: "chỉ một ROOT" phải đúng kể cả khi ROOT cũ đã bị đóng bằng
  // script reshape. Lọc deletedAt sẽ cho tạo ROOT thứ hai song song với cây HO, và mọi
  // node dưới ROOT mới lại được buildActor coi là HO-level (isHoRoot nhận cả ROOT) —
  // tức mở đường cấp quyền cross-center bằng cách dựng một cây thứ hai.
  const existingRoot = await db.orgUnit.findFirst({
    where: { type: "ROOT" },
    select: { id: true },
  });
  validateRootRule({ type: input.type, parentId, existingRootId: existingRoot?.id ?? null }); // V3 + V4(parent required)

  const parent = parentId ? await assertParentUsable(parentId) : null; // V4
  validateParentType(input.type, (parent?.type as OrgUnitType) ?? null); // V9 (US-05 AC3)

  const dup = await db.orgUnit.findUnique({ where: { code }, select: { id: true } });
  if (dup) {
    throw new OrgRuleError("ORG_CODE_CONFLICT", `Mã đơn vị "${code}" đã tồn tại.`, "code");
  }

  // Pháp nhân phải CÒN SỐNG. Xoá pháp nhân là xoá MỀM nên FK RESTRICT không cứu —
  // thiếu chỗ này là AC3 của US-06 bị vòng qua trong hai bước (xoá rồi gán lại).
  if (input.legalEntityId) await assertLegalEntityUsable(input.legalEntityId);

  // P1 · US-05 — node MỚI không có con, nên path tính thẳng từ path cha; không cần đệ quy.
  // Cha chưa có path (dòng cũ chưa backfill) → path con cũng null, và script đối soát
  // US-07 sẽ nhặt ra. KHÔNG đoán path từ code cha: đoán sai là sai quyền.
  const path = parent ? (parent.path ? childPath(parent.path, code) : null) : childPath(null, code);
  const depth = path ? path.split("/").filter(Boolean).length - 1 : null;

  try {
    const created = await db.orgUnit.create({
      data: {
        type: input.type,
        code,
        name,
        address: input.address ?? null,
        parentId,
        centerId,
        path,
        depth,
        relationshipType: input.relationshipType ?? "OWNED",
        status: "ACTIVE",
        legalEntityId: input.legalEntityId ?? null,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
      },
    });
    return created;
  } catch (e) {
    // Race T6-01: 2 request cùng code → DB unique bắt (P2002) → CONFLICT, không 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new OrgRuleError("ORG_CODE_CONFLICT", `Mã đơn vị "${code}" đã tồn tại.`, "code");
    }
    throw e;
  }
}

export async function getOrgUnit(
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<OrgUnit | null> {
  const row = await db.orgUnit.findUnique({ where: { id } });
  if (!row) return null;
  if (!opts.includeDeleted && row.deletedAt) return null;
  return row;
}

export async function listOrgUnits(
  opts: { includeDeleted?: boolean } = {},
): Promise<OrgUnit[]> {
  return db.orgUnit.findMany({
    where: opts.includeDeleted ? {} : { deletedAt: null },
    orderBy: { code: "asc" },
  });
}

/**
 * Cập nhật (đổi parent → V5/V6 chống cycle, V4 parent hợp lệ, V9 loại cha hợp lệ).
 *
 * P1 · US-05 AC2 — nếu `parentId` HOẶC `code` đổi thì `path`/`depth` của node NÀY và
 * TOÀN BỘ hậu duệ được tính lại, và cả cụm ghi trong MỘT `$transaction`. Trước P1 hàm
 * này không có transaction; đổi cha giữa chừng mà hỏng là để lại cây nửa vời.
 */
export async function updateOrgUnit(id: string, input: UpdateOrgUnitInput): Promise<OrgUnit> {
  const self = await db.orgUnit.findUnique({ where: { id } });
  if (!self || self.deletedAt) {
    throw new OrgRuleError("ORG_NOT_FOUND", "Không tìm thấy đơn vị.", "id");
  }

  const data: Prisma.OrgUnitUpdateInput = {};
  if (input.name !== undefined) data.name = requireName(input.name);
  if (input.address !== undefined) data.address = input.address;
  if (input.relationshipType !== undefined) data.relationshipType = input.relationshipType;
  if (input.effectiveFrom !== undefined) data.effectiveFrom = input.effectiveFrom;
  if (input.effectiveTo !== undefined) data.effectiveTo = input.effectiveTo;
  if (input.legalEntityId !== undefined) {
    if (input.legalEntityId) await assertLegalEntityUsable(input.legalEntityId);
    data.legalEntity = input.legalEntityId
      ? { connect: { id: input.legalEntityId } }
      : { disconnect: true };
  }
  // `status` và `isActive` đi CẶP — xem lib/org/status.ts (chống trạng thái mâu thuẫn).
  if (input.status !== undefined) {
    data.status = input.status;
    data.isActive = isActiveFromStatus(input.status);
  }

  let newCode: string | undefined;
  if (input.code !== undefined && input.code !== self.code) {
    newCode = validateCode(input.code);
    const dup = await db.orgUnit.findUnique({ where: { code: newCode }, select: { id: true } });
    if (dup && dup.id !== id) {
      throw new OrgRuleError("ORG_CODE_CONFLICT", `Mã đơn vị "${newCode}" đã tồn tại.`, "code");
    }
    data.code = newCode;
  }

  const parentChanged = input.parentId !== undefined && input.parentId !== self.parentId;
  if (parentChanged) {
    const newParentId = input.parentId as string | null;
    const newParent = newParentId ? await assertParentUsable(newParentId) : null; // V4
    validateParentType(self.type as OrgUnitType, (newParent?.type as OrgUnitType) ?? null); // V9
    const nodes = await loadNodes(true);
    if (wouldCreateCycle(nodes, id, newParentId)) {
      throw new OrgRuleError(
        "ORG_CYCLE",
        "Không thể đặt đơn vị cha tạo thành vòng lặp.",
        "parentId",
      );
    }
    data.parent = newParentId ? { connect: { id: newParentId } } : { disconnect: true };
  }

  try {
    // Không đụng cấu trúc → update phẳng, khỏi mở transaction.
    if (!parentChanged && newCode === undefined) {
      return await db.orgUnit.update({ where: { id }, data });
    }

    // Đụng cấu trúc → ghi node + tính lại CẢ NHÁNH trong cùng một transaction (AC2).
    return await db.$transaction(async (tx) => {
      const updated = await tx.orgUnit.update({ where: { id }, data });

      // GỒM CẢ node đã xoá mềm: `path` là dữ liệu CẤU TRÚC, không phải dữ liệu nghiệp vụ.
      // Bỏ chúng ra thì đơn vị đã xoá mềm giữ path của nhánh cũ VĨNH VIỄN (updateOrgUnit
      // chặn node deletedAt ngay đầu hàm nên không đường nào tính lại cho nó) — tới lúc
      // có đường khôi phục đơn vị ở P5, nó sống lại với path trỏ vào nhánh không còn tồn tại.
      // Việc LỌC node chết chỉ thuộc về chỗ tính PHẠM VI QUYỀN, không thuộc chỗ tính path.
      const rows = await tx.orgUnit.findMany();
      const rowsPure = rows.map(toNode);
      for (const r of recomputeSubtree(rowsPure, id)) {
        await tx.orgUnit.update({
          where: { id: r.id },
          data: { path: r.path, depth: r.depth },
        });
      }

      return tx.orgUnit.findUniqueOrThrow({ where: { id: updated.id } });
    });
  } catch (e) {
    // Đua 2 request cùng đổi code về một giá trị: findUnique ở trên qua được cả hai,
    // DB unique mới bắt. Dịch sang lỗi nghiệp vụ như createOrgUnit, không để 500 thô.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new OrgRuleError(
        "ORG_CODE_CONFLICT",
        `Mã đơn vị "${newCode ?? self.code}" đã tồn tại.`,
        "code",
      );
    }
    throw e;
  }
}

/** Soft-delete (V8: chặn nếu còn con đang sống — vd xoá ROOT khi còn HO/CS). */
export async function softDeleteOrgUnit(id: string): Promise<OrgUnit> {
  const self = await db.orgUnit.findUnique({ where: { id } });
  if (!self || self.deletedAt) {
    throw new OrgRuleError("ORG_NOT_FOUND", "Không tìm thấy đơn vị.", "id");
  }
  const liveChildren = await db.orgUnit.count({
    where: { parentId: id, deletedAt: null },
  });
  if (liveChildren > 0) {
    throw new OrgRuleError(
      "ORG_HAS_CHILDREN",
      "Không thể xoá đơn vị còn đơn vị con đang hoạt động.",
      "id",
    );
  }
  const deleted = await db.orgUnit.update({
    where: { id },
    // `status` đi cặp với `isActive` (lib/org/status.ts): xoá mềm là CLOSED, không phải
    // SUSPENDED — SUSPENDED nghĩa "tạm dừng, sẽ mở lại", CLOSED là "đã đóng".
    data: { deletedAt: new Date(), isActive: false, status: "CLOSED" },
  });
  return deleted;
}

/**
 * Ánh xạ 2 chiều Center ↔ OrgUnit ĐANG dùng `centerId`; sau khi V7 được nới cho HO
 * (xem orgunit-rules.ts) thì Center 'hoi-so' hết mồ côi. Hàm này chỉ để test/script
 * khẳng định điều đó — không phải API mới cho app.
 */
export async function findOrphanCenters(): Promise<{ id: string; name: string }[]> {
  const [centers, mapped] = await Promise.all([
    db.center.findMany({ select: { id: true, name: true } }),
    db.orgUnit.findMany({
      where: { deletedAt: null, centerId: { not: null } },
      select: { centerId: true },
    }),
  ]);
  const covered = new Set(mapped.map((m) => m.centerId));
  return centers.filter((c) => !covered.has(c.id));
}

// ─── Tree helpers (DB-backed wrap thuật toán thuần) ───

/** Mọi centerId thuộc subtree (AC5): ROOT→[CS...], CENTER→[chính nó], HO→[] (OI-1). */
export async function getSubtreeCenterIds(orgUnitId: string): Promise<string[]> {
  const nodes = await loadNodes(false);
  return getSubtreeCenterIdsPure(nodes, orgUnitId);
}

/** Đường từ node lên ROOT (gồm chính nó). */
export async function getAncestors(orgUnitId: string): Promise<OrgUnitNode[]> {
  const nodes = await loadNodes(true);
  return getAncestorsPure(nodes, orgUnitId);
}

export async function isAncestor(a: string, b: string): Promise<boolean> {
  const nodes = await loadNodes(true);
  return isAncestorPure(nodes, a, b);
}

/**
 * Đơn vị tổ chức actor được phép chọn/lọc — NGUỒN DUY NHẤT cho mọi center-picker FE/BE.
 * Thay cho list cứng ["CS1","CS2"] và bảng Center: gồm cả HO (Doc 15 OI-1).
 * `opts.types: ["CENTER"]` khi chỉ cần cơ sở vận hành (gán lead/lớp); mặc định gồm HO.
 */
export async function getSelectableOrgUnits(
  actor: Actor,
  opts: { types?: OrgUnitType[]; includeDeleted?: boolean } = {},
): Promise<SelectableOrgUnit[]> {
  const rows = await db.orgUnit.findMany({
    where: opts.includeDeleted ? {} : { deletedAt: null },
  });
  const nodes = rows.map((o) => ({ ...toNode(o), name: o.name }));
  const selectable = selectableOrgUnits(
    nodes,
    {
      isSuperAdmin: actor.isSuperAdmin,
      isHoLevel: actor.isHoLevel,
      visibleCenterIds: actor.visibleCenterIds,
      roleOrgUnitIds: actor.orgRoles.map((r) => r.orgUnitId),
    },
    opts,
  );

  // Chuẩn hoá TÊN HIỂN THỊ: đơn vị CENTER dùng Center.name (vd "Trụ sở chính - Nguyễn
  // Hữu Thọ") thay OrgUnit.name generic ("Cơ sở 1") → đồng nhất với các màn list/filter
  // (vốn đọc từ bảng Center). Giá trị submit vẫn là orgUnitId; HO/ROOT giữ nguyên tên.
  const centerIds = selectable
    .map((s) => s.centerId)
    .filter((id): id is string => id != null);
  if (centerIds.length === 0) return selectable;
  const centers = await db.center.findMany({
    where: { id: { in: centerIds } },
    select: { id: true, name: true },
  });
  const centerName = new Map(centers.map((c) => [c.id, c.name]));
  return selectable.map((s) =>
    s.centerId && centerName.has(s.centerId)
      ? { ...s, name: centerName.get(s.centerId) as string }
      : s,
  );
}

// ─── PR-B dual-write: map Center.id ↔ OrgUnit.id ──────────────────────────────
// Giai đoạn 2-phase: mọi write set CẢ centerId + orgUnitId. OrgUnit.centerId @unique
// nên ánh xạ 1-1 (chỉ type=CENTER có centerId; HO/ROOT centerId=null).

/** Center.id → OrgUnit.id. null nếu centerId rỗng hoặc không OrgUnit nào trỏ tới. */
export async function orgUnitIdForCenter(
  centerId: string | null | undefined,
): Promise<string | null> {
  if (!centerId) return null;
  const ou = await db.orgUnit.findFirst({
    where: { centerId, deletedAt: null },
    select: { id: true },
  });
  return ou?.id ?? null;
}

/** OrgUnit.id → Center.id. HO/ROOT (centerId=null) → null (đơn vị không có Center). */
export async function centerIdForOrgUnit(
  orgUnitId: string | null | undefined,
): Promise<string | null> {
  if (!orgUnitId) return null;
  const ou = await db.orgUnit.findUnique({
    where: { id: orgUnitId },
    select: { centerId: true },
  });
  return ou?.centerId ?? null;
}

/**
 * Center.id của các CƠ SỞ VẬN HÀNH (type=CENTER) — tức có phòng học/lịch dạy. Loại HO
 * và Center "mồ côi" (không OrgUnit type=CENTER nào trỏ tới, vd row "Hội sở" cũ). Dùng
 * cho picker cơ sở ở màn phòng/lịch nghỉ. KHÔNG hardcode danh sách — CS3/CS4 thêm là
 * data (thêm OrgUnit type=CENTER) tự xuất hiện.
 */
export async function getTeachingCenterIds(): Promise<string[]> {
  const rows = await db.orgUnit.findMany({
    where: { type: "CENTER", deletedAt: null, centerId: { not: null } },
    select: { centerId: true },
  });
  return rows.map((r) => r.centerId).filter((id): id is string => id != null);
}
