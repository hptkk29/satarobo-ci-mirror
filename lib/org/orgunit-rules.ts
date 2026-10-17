// lib/org/orgunit-rules.ts — Validation rules THUẦN cho OrgUnit (ticket A0-01 §3 V1–V8).
// Không phụ thuộc Prisma/DB → unit-test trực tiếp. Service DB-backed gọi lại các rule này.

import { ORG_PARENT_RULES, OrgRuleError, type OrgUnitNode, type OrgUnitType } from "./types";

/** V2 — code: 2–20 ký tự A–Z, 0–9, gạch dưới (sau khi chuẩn hóa uppercase). */
export const ORG_CODE_RE = /^[A-Z0-9_]{2,20}$/;

/** Chuẩn hóa code: trim + uppercase. */
export function normalizeCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase();
}

/**
 * V2 — Validate + chuẩn hóa code. Trả code đã chuẩn hóa hoặc ném OrgRuleError.
 */
export function validateCode(raw: string): string {
  const code = normalizeCode(raw);
  if (code.length === 0) {
    throw new OrgRuleError("ORG_CODE_REQUIRED", "Mã đơn vị không được để trống.", "code");
  }
  if (!ORG_CODE_RE.test(code)) {
    throw new OrgRuleError(
      "ORG_CODE_INVALID",
      "Mã đơn vị chỉ gồm 2–20 ký tự A–Z, 0–9 hoặc gạch dưới.",
      "code",
    );
  }
  return code;
}

/**
 * V3 — ROOT là duy nhất và có parentId = null; non-ROOT bắt buộc có parentId… TRỪ HO.
 *
 * NỚI Ở P1 · US-05: hình cây chốt 11/08 đặt HO ở GỐC (BA 08/08 §1.1), tức HO hợp lệ khi
 * parentId = null. Node ROOT "SATAROBO" cũ vẫn được luật chấp nhận để cây trên DB đang
 * chạy không bị coi là sai trong lúc chưa dời (script reshape chạy tay).
 *
 * `existingRootId` = id ROOT hiện có trong hệ thống (nếu đã có), `selfId` để cho phép update chính ROOT đó.
 */
export function validateRootRule(input: {
  type: OrgUnitType;
  parentId: string | null;
  existingRootId?: string | null;
  selfId?: string | null;
}): void {
  const { type, parentId, existingRootId, selfId } = input;
  if (type === "ROOT") {
    if (parentId !== null) {
      throw new OrgRuleError("ORG_ROOT_HAS_PARENT", "ROOT không được có đơn vị cha.", "parentId");
    }
    if (existingRootId && existingRootId !== selfId) {
      throw new OrgRuleError("ORG_MULTIPLE_ROOT", "Hệ thống chỉ được có một ROOT.", "type");
    }
  } else if (!parentId && type !== "HO") {
    throw new OrgRuleError(
      "ORG_PARENT_REQUIRED",
      "Đơn vị không phải ROOT/HO bắt buộc có đơn vị cha.",
      "parentId",
    );
  }
}

/**
 * V7 — centerId chỉ set cho type CENTER.
 *
 * ⚠️ ĐÃ THỬ NỚI CHO HO Ở P1 RỒI GỠ (11/08/2026) — đừng nới lại mà không đọc hết đoạn này.
 *
 * Ý định ban đầu đúng: `Center("hoi-so")` không được OrgUnit nào trỏ tới, nên
 * `orgUnitIdForCenter('hoi-so')` trả null im lặng và dữ liệu Hội sở không bao giờ nhận
 * `orgUnitId`. Nhưng cách vá bằng cách cho HO mang `centerId` LÀM RÒ QUYỀN, đo được:
 *
 *   `app/(admin)/admin/nhan-su/actions.ts` suy đơn vị neo RBAC v2 bằng
 *   `userAccount.orgUnitId ?? orgUnitIdForCenter(employee.centerId)`. Với nhân sự Hội sở,
 *   trước đây vế phải là null ⇒ `reconcileUserOrgRoles` NÉM `OrgRoleSyncError` kèm hướng
 *   dẫn (chặn cứng, buộc admin chọn đơn vị tay). Sau khi nới, nó trả OrgUnit(HO) ⇒ vai
 *   được neo TẠI HO ⇒ `isHoLevel = true` (lib/auth/actor.ts) ⇒ người đó thấy MỌI cơ sở.
 *   Chính `lib/auth/legacy-role-map.ts:94` đã cảnh báo sẵn: "vai neo ở HO ⇒ isHoLevel ⇒
 *   scopedDb mở ALL cơ sở".
 *
 * Hai hệ quả nữa cùng gốc: `centerIdForOrgUnit(HO)` hết trả null, phá hợp đồng "HO → null"
 * mà các màn nghỉ lễ/phòng học đang dựa vào (nghỉ lễ "toàn hệ thống" biến thành nghỉ lễ
 * của một Center không ai thấy; phòng học tạo được ở Hội sở thành phòng ma).
 *
 * ⇒ Center mồ côi được XỬ Ở US-07 bằng một cầu ánh xạ TƯỜNG MINH, không bằng cách nạp
 * thêm nghĩa cho cột `centerId`. `findOrphanCenters()` trong org-service.ts là công cụ đo.
 */
export function validateCenterId(type: OrgUnitType, centerId: string | null | undefined): void {
  if (centerId != null && type !== "CENTER") {
    throw new OrgRuleError(
      "ORG_CENTERID_NOT_CENTER",
      "Chỉ đơn vị loại CENTER mới được gắn centerId.",
      "centerId",
    );
  }
}

/**
 * V9 (P1 · US-05 AC3) — loại đơn vị cha có hợp lệ với loại con không.
 * Luật được AC gọi tên: **CENTER không được làm cha của REGION**.
 * Bảng luật ở `ORG_PARENT_RULES` (lib/org/types.ts) — thêm loại mới là thêm 1 dòng dữ liệu,
 * không phải thêm một nhánh if.
 */
export function validateParentType(
  type: OrgUnitType,
  parentType: OrgUnitType | null | undefined,
): void {
  const allowed = ORG_PARENT_RULES[type] ?? [];
  if (parentType == null) {
    // Không cha = đứng gốc. Chỉ loại KHÔNG có cha hợp lệ nào mới được đứng gốc…
    // …hoặc HO, vốn là gốc thật của cây theo BA §1.1.
    if (type === "ROOT" || type === "HO") return;
    throw new OrgRuleError(
      "ORG_PARENT_REQUIRED",
      `Đơn vị loại ${type} bắt buộc có đơn vị cha.`,
      "parentId",
    );
  }
  if (!allowed.includes(parentType)) {
    throw new OrgRuleError(
      "ORG_PARENT_TYPE_INVALID",
      `Đơn vị loại ${parentType} không được làm cha của đơn vị loại ${type}.`,
      "parentId",
    );
  }
}

/**
 * V5 + V6 — Đặt parent cho `nodeId` thành `newParentId` có tạo vòng (cycle) không.
 * True nếu: tự làm cha chính nó (V6), hoặc newParentId là hậu duệ của nodeId (V5).
 */
export function wouldCreateCycle(
  nodes: OrgUnitNode[],
  nodeId: string,
  newParentId: string | null,
): boolean {
  if (newParentId == null) return false;
  if (newParentId === nodeId) return true; // V6 — self parent
  // Cycle nếu nodeId là tổ tiên của newParentId (đặt parent = hậu duệ của mình).
  return isAncestorOf(nodes, nodeId, newParentId);
}

/** a có là tổ tiên (strict, không tính chính nó) của b không — đi theo parent chain của b. */
export function isAncestorOf(nodes: OrgUnitNode[], a: string, b: string): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = byId.get(b)?.parentId ?? null;
  const guard = new Set<string>();
  while (cur != null) {
    if (cur === a) return true;
    if (guard.has(cur)) break; // chống vòng dữ liệu bẩn
    guard.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}
