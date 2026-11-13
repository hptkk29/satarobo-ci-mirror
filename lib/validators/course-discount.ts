// R7-03 — Zod schema cho CourseDiscount.
import { z } from "zod";
import { CourseDiscountType } from "@prisma/client";

// Helper: empty string / undefined → null
const nullableStr = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v === "" || v === undefined || v === null ? null : v));

const nullableDate = z
  .union([z.null(), z.literal(""), z.coerce.date()])
  .optional()
  .transform((v) => (v === "" || v === undefined || v === null ? null : (v as Date)));

export const courseDiscountSchema = z
  .object({
    type: z.nativeEnum(CourseDiscountType),
    // R7-03-C5: reject negative value.
    value: z.coerce.number().int().min(0, "Giá trị không được âm"),
    note: nullableStr,
    conditions: nullableStr,
    active: z.boolean().default(true),
    validFrom: nullableDate,
    validTo: nullableDate,
  })
  // Per-type upper bound: PERCENT/SCHOLARSHIP ≤ 100; AMOUNT/PROGRAM no upper bound.
  .refine(
    (d) =>
      !(d.type === "PERCENT" || d.type === "SCHOLARSHIP") || d.value <= 100,
    { message: "Phần trăm không được vượt quá 100", path: ["value"] },
  )
  // validFrom ≤ validTo nếu cả hai được set.
  .refine(
    (d) => !(d.validFrom && d.validTo) || d.validFrom <= d.validTo,
    { message: "validFrom phải ≤ validTo", path: ["validTo"] },
  );

export type CourseDiscountInput = z.infer<typeof courseDiscountSchema>;
