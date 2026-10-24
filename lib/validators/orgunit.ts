// lib/validators/orgunit.ts — Zod schema cho OrgUnit (ticket A0-01). Source of truth type.
import { z } from "zod";
import {
  ORG_RELATIONSHIP_TYPES,
  ORG_UNIT_STATUSES,
  ORG_UNIT_TYPES,
} from "@/lib/org/types";
import { ORG_CODE_RE, normalizeCode } from "@/lib/org/orgunit-rules";

const nullableStr = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v == null || v === "" ? null : v));

export const orgUnitCreateSchema = z
  .object({
    type: z.enum(ORG_UNIT_TYPES),
    code: z
      .string()
      .transform(normalizeCode)
      .refine((c) => ORG_CODE_RE.test(c), {
        message: "Mã đơn vị chỉ gồm 2–20 ký tự A–Z, 0–9 hoặc gạch dưới.",
      }),
    name: z.string().trim().min(1, "Tên đơn vị không được để trống.").max(200),
    parentId: nullableStr,
    address: nullableStr,
    centerId: nullableStr,
  })
  .refine((v) => !(v.centerId != null && v.type !== "CENTER"), {
    message: "Chỉ đơn vị loại CENTER mới được gắn centerId.",
    path: ["centerId"],
  })
  .refine((v) => !(v.type === "ROOT" && v.parentId != null), {
    message: "ROOT không được có đơn vị cha.",
    path: ["parentId"],
  })
  // P1 · US-05 — HO ĐỨNG GỐC (hình cây chốt 11/08 theo BA 08/08 §1.1), nên nó hợp lệ khi
  // parentId = null. Node ROOT cũ vẫn được chấp nhận để cây chưa dời không bị coi là sai.
  // Giữ khớp với validateRootRule() trong lib/org/orgunit-rules.ts — hai chỗ lệch nhau là
  // UI từ chối đúng dữ liệu mà service cho phép (và ngược lại).
  .refine((v) => !(v.type !== "ROOT" && v.type !== "HO" && v.parentId == null), {
    message: "Đơn vị không phải ROOT/HO bắt buộc có đơn vị cha.",
    path: ["parentId"],
  });

export type OrgUnitCreateInput = z.infer<typeof orgUnitCreateSchema>;

export const orgUnitUpdateSchema = orgUnitCreateSchema;

// ─── P1 · US-05 AC4 — schema riêng cho MÀN ADMIN "Cây tổ chức" (/admin/to-chuc) ───
//
// VÌ SAO KHÔNG SỬA ĐÈ 2 schema trên: chúng thuộc đường A0-01 và đang bị test
// [A0-01] `lib/org/orgunit-rules.test.ts` ghim từng luật một (kể cả luật "HO không
// được gắn centerId" mà rule V7 sau này đã nới). Sửa tại chỗ là đổi hành vi đường cũ
// — trái luật cứng #2 của Nền Hệ thống. Nên bổ sung schema mới cho form admin.
//
// KHÁC BIỆT có chủ đích so với schema A0-01:
//   1. Phơi 2 trục MỚI của P1: `relationshipType` (sở hữu) + `legalEntityId` (pháp nhân).
//   2. KHÔNG phơi `centerId` — đó là cầu ánh xạ Center cũ, do script backfill US-07
//      quản; để người dùng tự gắn là tự tay tạo lệch ánh xạ 1-1.
//   3. HO được đứng GỐC (parentId = null) — bám `validateRootRule` đã nới ở P1 theo
//      hình cây chốt 11/08/2026 (HO là gốc, ROOT chỉ còn là node quá độ).

/** Loại đơn vị cha là BẮT BUỘC, trừ ROOT và HO (2 loại được đứng gốc). */
const TYPES_ALLOWED_AT_ROOT: readonly string[] = ["ROOT", "HO"];

const orgUnitAdminBaseShape = {
  name: z.string().trim().min(1, "Tên đơn vị không được để trống.").max(200),
  parentId: nullableStr,
  address: nullableStr,
  relationshipType: z.enum(ORG_RELATIONSHIP_TYPES).default("OWNED"),
  legalEntityId: nullableStr,
};

export const orgUnitAdminCreateSchema = z
  .object({
    ...orgUnitAdminBaseShape,
    type: z.enum(ORG_UNIT_TYPES),
    code: z
      .string()
      .transform(normalizeCode)
      .refine((c) => ORG_CODE_RE.test(c), {
        message: "Mã đơn vị chỉ gồm 2–20 ký tự A–Z, 0–9 hoặc gạch dưới.",
      }),
  })
  .refine((v) => !(v.type === "ROOT" && v.parentId != null), {
    message: "ROOT không được có đơn vị cha.",
    path: ["parentId"],
  })
  .refine((v) => !(!TYPES_ALLOWED_AT_ROOT.includes(v.type) && v.parentId == null), {
    message: "Chỉ ROOT và Hội sở được đứng gốc — loại đơn vị này bắt buộc chọn đơn vị cha.",
    path: ["parentId"],
  });

export type OrgUnitAdminCreateInput = z.infer<typeof orgUnitAdminCreateSchema>;

/**
 * Sửa node: KHÔNG có `code`. Service `updateOrgUnit` vẫn đổi được mã (và tính lại path
 * cả nhánh trong 1 transaction), nhưng UI cố ý không phơi — mã đơn vị là khoá nghiệp vụ
 * đã nằm trong path/quyền, đổi nhầm là kéo theo cả cây con.
 */
export const orgUnitAdminUpdateSchema = z.object({
  ...orgUnitAdminBaseShape,
  status: z.enum(ORG_UNIT_STATUSES),
});

export type OrgUnitAdminUpdateInput = z.infer<typeof orgUnitAdminUpdateSchema>;
