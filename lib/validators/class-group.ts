import { z } from "zod";

export const ClassGroupStatusEnum = z.enum([
  "ACTIVE",
  "GRADUATED",
  "DISBANDED",
]);

const nullableStr = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  });

export const classGroupCreateSchema = z.object({
  displayCode: z
    .string()
    .trim()
    .min(1, "Mã hiển thị bắt buộc (vd A1, B2)")
    .max(20),
  name: nullableStr,
  // PR-C: orgUnitId là nguồn chính (đơn vị); centerId suy ra từ org để dual-write.
  centerId: nullableStr,
  orgUnitId: nullableStr,
  status: ClassGroupStatusEnum.default("ACTIVE"),
  notes: nullableStr,
});

export type ClassGroupCreateInput = z.infer<typeof classGroupCreateSchema>;
