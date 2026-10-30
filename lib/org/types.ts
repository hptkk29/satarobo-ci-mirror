// lib/org/types.ts — Domain types cho OrgUnit (Doc 15 §2.1, ticket A0-01; mở rộng P1 · US-05).
// Lớp domain THUẦN (không phụ thuộc Prisma) để unit-test được mà không cần DB.

export const ORG_UNIT_TYPES = [
  "ROOT",
  "HO",
  "REGION",
  "DEPARTMENT",
  "CENTER",
  "CAMPUS",
  "PARTNER",
  "FRANCHISE",
] as const;

export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number];

/**
 * P1 · US-05 — trục SỞ HỮU, ĐỘC LẬP với OrgUnitType (BA §2.2, điểm 5 của §0.2).
 * Đừng suy sở hữu từ `type`: `OrgUnitType.FRANCHISE` là giá trị CHẾT (0 bản ghi, 0 nơi so
 * sánh) chỉ còn tồn tại vì migration additive không xoá được giá trị enum của Postgres.
 */
export const ORG_RELATIONSHIP_TYPES = ["OWNED", "FRANCHISEE", "AFFILIATE"] as const;
export type OrgRelationshipType = (typeof ORG_RELATIONSHIP_TYPES)[number];

/** P1 · US-05 — vòng đời đơn vị (BA §2.2). Xem lib/org/status.ts về quan hệ với isActive. */
export const ORG_UNIT_STATUSES = ["ACTIVE", "SUSPENDED", "CLOSED"] as const;
export type OrgUnitStatus = (typeof ORG_UNIT_STATUSES)[number];

/**
 * Loại đơn vị nào được làm CHA của loại nào (US-05 AC3).
 * Đọc: `ORG_PARENT_RULES[con] = [các loại cha hợp lệ]`.
 *
 * Hình cây chốt 11/08/2026 theo BA 08/08 §1.1: HO (gốc) → REGION → CENTER.
 * ROOT còn trong bảng vì node SATAROBO cũ vẫn tồn tại trên DB đang chạy — nó được phép
 * làm cha của HO để cây cũ KHÔNG bị coi là dữ liệu sai trong lúc chưa dời (script
 * reshape chạy tay). Sau khi dời xong, HO đứng gốc (parentId = null).
 *
 * Luật quan trọng nhất, và là thứ AC3 gọi tên: CENTER **không** được làm cha REGION.
 * Diễn đạt bằng bảng thay vì bằng if lồng để thêm loại mới là thêm 1 dòng dữ liệu.
 */
export const ORG_PARENT_RULES: Record<OrgUnitType, readonly OrgUnitType[]> = {
  ROOT: [], // ROOT không có cha
  HO: ["ROOT"], // gốc thật, hoặc dưới ROOT kỹ thuật trong lúc quá độ
  REGION: ["HO", "ROOT"],
  CENTER: ["REGION", "HO", "ROOT"], // HO/ROOT: cây phẳng cũ chưa dời vẫn hợp lệ
  DEPARTMENT: ["HO", "REGION", "CENTER", "DEPARTMENT"],
  CAMPUS: ["CENTER"],
  PARTNER: ["HO", "REGION", "ROOT"],
  FRANCHISE: ["HO", "REGION", "ROOT"],
};

/** Node tối giản dùng cho các thuật toán cây (pure). DB model map về kiểu này. */
export type OrgUnitNode = {
  id: string;
  code: string;
  type: OrgUnitType;
  parentId: string | null;
  /** Chỉ set cho CENTER (và HO — xem validateCenterId) — trỏ Center cũ (Phase A). */
  centerId?: string | null;
  /** P1 · US-05 — materialized path "/ho/danang/cs1/". Nullable: dòng cũ chưa backfill. */
  path?: string | null;
  depth?: number | null;
  relationshipType?: OrgRelationshipType;
  status?: OrgUnitStatus;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  legalEntityId?: string | null;
  isActive?: boolean;
  deletedAt?: Date | null;
};

/** Lỗi nghiệp vụ OrgUnit — code (EN) + message (VI) theo Doc 15 §13.5. */
export class OrgRuleError extends Error {
  readonly code: string;
  readonly field?: string;
  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = "OrgRuleError";
    this.code = code;
    this.field = field;
  }
}
