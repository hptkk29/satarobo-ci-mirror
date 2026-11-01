import { z } from "zod";

export const InventoryCategoryEnum = z.enum([
  "MAINBOARD",
  "SENSOR",
  "MOTOR",
  "BATTERY",
  "MECHANICAL",
  "WIRE",
  "TOOL",
  "CONSUMABLE",
  "ROBOSIM",
  "OTHER",
]);

const nullableStr = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  });

const tagsClean = z
  .array(z.string())
  .default([])
  .transform((arr) =>
    Array.from(
      new Set(
        arr
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    ),
  );

// VND là số nguyên (H5/COL2) → làm tròn về Int để khớp cột Int trong DB.
const nullableIntVnd = z
  .union([z.null(), z.literal(""), z.coerce.number()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    return Number.isFinite(v) ? Math.round(v as number) : null;
  });

const nullableUrl = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    if (!s) return null;
    try {
      new URL(s);
      return s;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL không hợp lệ",
      });
      return z.NEVER;
    }
  });

// ─── Phase F2 — movement schemas ─────────────────────────────────────────

export const StockMovementTypeEnum = z.enum([
  "RECEIPT",
  "ISSUE",
  "TRANSFER_OUT",
  "TRANSFER_IN",
]);

const positiveInt = z.coerce.number().int().min(1, "Số lượng phải >= 1");

const nullableIntVndNonNeg = z
  .union([z.null(), z.literal(""), z.coerce.number()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = v as number;
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  });

export const receiptSchema = z.object({
  itemId: z.string().trim().min(1, "Thiếu mặt hàng"),
  centerId: z.string().trim().min(1, "Thiếu cơ sở"),
  quantity: positiveInt,
  unitPrice: nullableIntVndNonNeg,
  referenceNote: nullableStr,
  notes: nullableStr,
});

export const issueSchema = z.object({
  itemId: z.string().trim().min(1, "Thiếu mặt hàng"),
  centerId: z.string().trim().min(1, "Thiếu cơ sở"),
  quantity: positiveInt,
  referenceType: nullableStr,
  referenceId: nullableStr,
  referenceNote: nullableStr,
  notes: nullableStr,
});

export const transferSchema = z
  .object({
    itemId: z.string().trim().min(1, "Thiếu mặt hàng"),
    fromCenterId: z.string().trim().min(1, "Thiếu cơ sở nguồn"),
    toCenterId: z.string().trim().min(1, "Thiếu cơ sở đích"),
    quantity: positiveInt,
    notes: nullableStr,
  })
  .refine((d) => d.fromCenterId !== d.toCenterId, {
    message: "Cơ sở đích trùng cơ sở nguồn",
    path: ["toCenterId"],
  });

export const adjustmentSchema = z.object({
  itemId: z.string().trim().min(1, "Thiếu mặt hàng"),
  centerId: z.string().trim().min(1, "Thiếu cơ sở"),
  newQuantity: z.coerce.number().int().min(0, "Số lượng mới phải >= 0"),
  reason: z
    .string()
    .trim()
    .min(5, "Lý do tối thiểu 5 ký tự")
    .max(500, "Lý do tối đa 500 ký tự"),
});

export type ReceiptInput = z.infer<typeof receiptSchema>;
export type IssueInput = z.infer<typeof issueSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const inventoryItemSchema = z.object({
  itemCode: z
    .string()
    .trim()
    .min(1, "Mã hàng bắt buộc")
    .max(80),
  name: z.string().trim().min(1, "Tên hàng bắt buộc").max(200),
  description: nullableStr,
  category: InventoryCategoryEnum.default("OTHER"),
  unit: z.string().trim().min(1).max(40).default("Cái"),
  pricePerUnit: nullableIntVnd,
  supplier: nullableStr,
  defaultMinThreshold: z.coerce.number().int().min(0).default(5),
  imageUrl: nullableUrl,
  tags: tagsClean,
  isActive: z.coerce.boolean().default(true),
  notes: nullableStr,
});

export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;

// ─── Phase F4 — audit (kiểm kê bulk) ─────────────────────────────────────

export const InventoryAuditStatusEnum = z.enum([
  "DRAFT",
  "COMPLETED",
  "CANCELLED",
]);

export const startAuditSchema = z.object({
  // PR-C: orgUnitId là nguồn chính (chỉ cơ sở vận hành — loại HO); centerId suy ra
  // trong action để dual-write (giữ tới khi scopedDb flip ở PR-D).
  orgUnitId: z.string().trim().min(1, "Chọn cơ sở"),
  // centerId KHÔNG nhận từ client — action suy ra từ orgUnitId (dual-write tới PR-D).
  auditCode: nullableStr,
  notes: nullableStr,
});

export const auditLineSchema = z.object({
  itemId: z.string().trim().min(1),
  previousQty: z.coerce.number().int().min(0),
  actualQty: z.coerce.number().int().min(0),
  reason: nullableStr,
});

export const saveAuditDraftSchema = z.object({
  auditId: z.string().trim().min(1),
  lines: z.array(auditLineSchema),
});

export type StartAuditInput = z.infer<typeof startAuditSchema>;
export type AuditLineInput = z.infer<typeof auditLineSchema>;
export type SaveAuditDraftInput = z.infer<typeof saveAuditDraftSchema>;
