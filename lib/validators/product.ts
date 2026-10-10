import { z } from "zod";
import {
  ProductCategory,
  ProductStatus,
  ProductMovementType,
} from "@prisma/client";

export const PRODUCT_CATEGORY_LABEL: Record<ProductCategory, string> = {
  KIT_ROBOT: "Kit Robot",
  SENSOR: "Cảm biến",
  MISSION_BLOCK: "Khối nhiệm vụ",
  ACCESSORY: "Phụ kiện",
  BOOK: "Sách/Tài liệu",
  CONSUMABLE: "Vật tư tiêu hao",
  OTHER: "Khác",
};

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  DRAFT: "Nháp",
  ACTIVE: "Đang bán",
  PAUSED: "Tạm ngưng",
  DISCONTINUED: "Ngừng KD",
};

export const PRODUCT_STATUS_COLOR: Record<ProductStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  ACTIVE: "bg-green-100 text-green-700",
  PAUSED: "bg-yellow-100 text-yellow-700",
  DISCONTINUED: "bg-red-100 text-red-700",
};

export const PRODUCT_MOVEMENT_TYPE_LABEL: Record<ProductMovementType, string> =
  {
    PURCHASE: "Nhập hàng",
    SALE: "Bán",
    ADJUSTMENT: "Điều chỉnh",
    DAMAGE: "Hỏng",
    RETURN: "Trả lại",
    TRANSFER_IN: "Chuyển đến",
    TRANSFER_OUT: "Chuyển đi",
  };

// SKU: 3-50 chars, uppercase letters/numbers/hyphens only.
const SKU_PATTERN = /^[A-Z0-9-]{3,50}$/;

export const productSchema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      SKU_PATTERN,
      "SKU phải 3-50 ký tự, chỉ chữ in hoa / số / dấu gạch",
    ),
  name: z.string().trim().min(2, "Tên ≥ 2 ký tự").max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  category: z.nativeEnum(ProductCategory),
  status: z.nativeEnum(ProductStatus).default("DRAFT"),

  salePrice: z.number().int().min(0, "Giá ≥ 0").max(1_000_000_000),
  costPrice: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  rentalPricePerMonth: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .optional()
    .nullable(),

  stockOnHand: z.number().int().min(0).default(0),
  minThreshold: z.number().int().min(0).default(0),

  imageUrls: z.array(z.string().url("URL ảnh không hợp lệ")).max(10).default([]),
  zmroboKitId: z.string().min(1).optional().nullable(),
  attributes: z.record(z.string(), z.any()).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type ProductInput = z.infer<typeof productSchema>;

export const productMovementSchema = z.object({
  productId: z.string().min(1),
  type: z.nativeEnum(ProductMovementType),
  quantity: z.number().int().refine((n) => n !== 0, "Số lượng ≠ 0"),
  reason: z.string().trim().max(1000).optional().nullable(),
  orderId: z.string().min(1).optional().nullable(),
});
