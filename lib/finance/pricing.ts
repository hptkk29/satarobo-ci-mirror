// R7-03 — PRICING LOGIC LAYER. SINGLE source of price computation.
// THUẦN (pure) — không I/O. R7-05 reuse hàm này.
import type { CourseDiscountType } from "@prisma/client";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Tính giá ghi danh từ listPrice + discount (nếu có).
 * - no discount → discountAmount 0, finalPrice = listPrice, discountType null.
 * - AMOUNT / PROGRAM → discountAmount = min(value, listPrice) (value = VND off).
 * - PERCENT / SCHOLARSHIP → discountAmount = round(listPrice * clamp(value,0,100) / 100).
 * - finalPrice = max(0, listPrice - discountAmount); discountAmount ≤ listPrice.
 */
export function computeEnrollmentPrice(input: {
  listPrice: number;
  discount: { type: CourseDiscountType; value: number } | null;
}): {
  listPrice: number;
  discountType: string | null;
  discountAmount: number;
  finalPrice: number;
} {
  const listPrice = Math.max(0, input.listPrice);
  const { discount } = input;

  if (!discount) {
    return { listPrice, discountType: null, discountAmount: 0, finalPrice: listPrice };
  }

  let discountAmount: number;
  switch (discount.type) {
    case "PERCENT":
    case "SCHOLARSHIP": {
      const pct = clamp(discount.value, 0, 100);
      discountAmount = Math.round((listPrice * pct) / 100);
      break;
    }
    case "AMOUNT":
    case "PROGRAM":
    default: {
      // value = VND off (PROGRAM treated same as AMOUNT)
      discountAmount = Math.max(0, discount.value);
      break;
    }
  }

  // discountAmount ≤ listPrice
  discountAmount = Math.min(discountAmount, listPrice);
  const finalPrice = Math.max(0, listPrice - discountAmount);

  return { listPrice, discountType: discount.type, discountAmount, finalPrice };
}
