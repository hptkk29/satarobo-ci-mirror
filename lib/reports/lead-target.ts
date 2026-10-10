// C-01 — chỉ tiêu LEAD theo tháng × cơ sở. Phần THUẦN: không `server-only`, không Prisma,
// để Vitest chạy được mà không cần Postgres (cùng khuôn `lib/reports/revenue-target-scope.ts`).
//
// ĐƠN VỊ ĐẾM — chốt và KHÔNG được đọc khác đi:
// `targetCount` là SỐ HỌC SINH (`LeadChild`), **không** phải số phụ huynh (`Lead`).
// Nguồn: quyết định 24/08/2026 (B4) nối doanh số về từng con qua `Order.leadChildId`
// (một đơn — một con) ⇒ đơn vị sinh doanh thu là ĐỨA TRẺ, nên chỉ tiêu và tỷ lệ đạt
// phải đếm cùng một thứ. Một phụ huynh hai con = 2 đơn vị chỉ tiêu, 1 phụ huynh.
// (Ngược lại, E-02 "tỷ lệ PH đã tương tác" đếm theo PHỤ HUYNH — hai con vẫn là 1.)
//
// Trần chỉ tiêu: ô này đếm NGƯỜI, không đếm tiền. Không có trần thì một lần gõ nhầm số
// tiền vào đây sẽ đi thẳng vào mẫu số của C2/D2/D3 và kéo mọi tỷ lệ về ~0% mà không một
// dòng báo lỗi nào — đúng loại hỏng câm mà C-01 phải tự chặn ở cửa vào.
import { z } from "zod";

/** Trần chỉ tiêu một kỳ × một cơ sở. Cao hơn quy mô thật vài bậc, chỉ để chặn gõ nhầm. */
export const LEAD_TARGET_COUNT_MAX = 100_000;

/** "YYYY-MM" — cùng quy ước `RevenueTarget.period` và `monthKeyVN` (lib/reports/lead.ts). */
export const LEAD_TARGET_PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Ô nhập của màn đặt chỉ tiêu.
 *
 * ⚠️ `targetCount` cố ý nhận CHUỖI rồi tự ép, KHÔNG dùng `z.coerce.number()`:
 * `Number("")` = 0, nên bản coerce biến "bấm Lưu khi chưa gõ gì" thành "ghi đè chỉ tiêu
 * cũ về 0" — im lặng, không lỗi, và người dùng chỉ phát hiện khi tỷ lệ đạt nhảy vọt lên
 * vô cực ở tab C. Cùng lý do chặn "12.5" và "1,5": chỉ tiêu là ĐẦU NGƯỜI, không có phần lẻ.
 */
export const leadTargetInputSchema = z.object({
  // "" / "ALL" / thiếu → null = chỉ tiêu TOÀN HỆ THỐNG (KHÔNG phải "chưa gán cơ sở").
  centerId: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      return !t || t === "ALL" ? null : t;
    }),
  period: z.string().trim().regex(LEAD_TARGET_PERIOD_RE, "Kỳ phải dạng YYYY-MM"),
  targetCount: z
    .string()
    .trim()
    .regex(/^\d{1,9}$/, "Chỉ tiêu phải là số học sinh nguyên, không âm")
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .max(LEAD_TARGET_COUNT_MAX, `Chỉ tiêu tối đa ${LEAD_TARGET_COUNT_MAX} học sinh`),
    ),
  note: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      return t && t.length > 0 ? t : null;
    }),
});

export type LeadTargetInput = z.infer<typeof leadTargetInputSchema>;

/** Phần Actor mà luật tầm nhìn cần — khai theo cấu trúc để module này không kéo `lib/db` vào. */
export type LeadTargetScopeActor = {
  isSuperAdmin: boolean;
  isHoLevel: boolean;
  visibleCenterIds: string[];
};

/** Mảnh `where` cho `leadTarget.findMany` trên màn đặt. */
export type LeadTargetListWhere = { centerId?: { in: string[] } };

/**
 * Những dòng chỉ tiêu actor được NHÌN trên màn đặt.
 *
 * `LeadTarget` nằm trong `SCOPE_EXEMPT` (`lib/db-scope.ts`) — cố ý, vì `injectScope`
 * chèn `centerId IN (...)` trần và dòng mục tiêu toàn hệ thống (`centerId = NULL`) sẽ
 * tàng hình. Đổi lại, `scopedDb` là PASS-THROUGH ở bảng này ⇒ **không ai lọc giúp**,
 * luật tầm nhìn phải ép TAY, và thứ ép tay thì phải có test canh.
 *
 * - Cấp hội sở / quản trị: thấy cả dòng toàn hệ thống lẫn dòng của từng cơ sở — họ là
 *   người đặt cả hai (`checkRevenueTargetScope`), giấu đi thì họ không sửa được thứ
 *   mình vừa tạo.
 * - Quản lý cơ sở: CHỈ cơ sở mình quản. Không kèm dòng toàn hệ thống, vì họ không đặt
 *   được nó và nó không phải chỉ tiêu của họ.
 * - Chưa được gán cơ sở nào → `{ in: [] }`, tức RỖNG. FAIL-CLOSED: không có nhánh nào
 *   rơi về "thấy hết".
 */
export function leadTargetListWhere(actor: LeadTargetScopeActor): LeadTargetListWhere {
  if (actor.isSuperAdmin || actor.isHoLevel) return {};
  return { centerId: { in: actor.visibleCenterIds } };
}
