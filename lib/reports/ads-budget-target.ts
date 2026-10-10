// D-02 — chỉ tiêu NGÂN SÁCH QUẢNG CÁO theo tháng × cơ sở. Phần THUẦN: không
// `server-only`, không Prisma, để Vitest chạy được mà không cần Postgres (cùng khuôn
// `lib/reports/lead-target.ts` C-01 và `lib/reports/revenue-target-scope.ts` B-01).
//
// ĐƠN VỊ ĐO — chốt và KHÔNG được đọc khác đi:
// `targetAmount` là **TIỀN ĐỒNG (VNĐ) đã đặt ra để CHI cho quảng cáo**, không phải số
// đã tiêu. Số đã tiêu là snapshot Facebook của D-01 (chưa xây — D-01 đang chờ chốt loại
// mã kết nối Meta). D-03 ghép hai vế thành "% thực tế / chỉ tiêu"; nếu bảng này lỡ chứa
// số thực chi thì tỷ lệ đó luôn bằng 100% và không ai phát hiện ra.
//
// KHÁC BIỆT phải nhớ giữa hai loại "không có cơ sở" ở khu vực D:
//   · `centerId = NULL` **ở bảng này** = chỉ tiêu TOÀN HỆ THỐNG — một con số do người
//     đặt cho cả công ty.
//   · nhóm `CHƯA PHÂN BỔ` (D-06/D-08) = chi tiêu THẬT chưa quy được về cơ sở nào.
// Hai thứ này ngược chiều nhau: cái đầu là chủ đích, cái sau là nợ phải dọn.
//
// Trần chỉ tiêu: cột `targetAmount` là `Int` ⇒ Postgres int4, tối đa 2.147.483.647. Trần
// dưới đây thấp hơn hẳn mức đó và cao hơn hẳn quy mô chi thật, chỉ để chặn gõ dư số 0
// **ngay tại ô nhập**. Không có nó thì con số đi thẳng tới DB rồi chết bằng một câu
// "Lỗi cơ sở dữ liệu" chẳng nói cho người nhập biết họ sai chỗ nào.
import { z } from "zod";

/**
 * Trần chỉ tiêu ngân sách một kỳ × một cơ sở: 2 tỷ đồng/tháng.
 * Cao hơn quy mô chi quảng cáo thật vài bậc, và vẫn nằm dưới trần int4 của cột.
 */
export const ADS_BUDGET_TARGET_AMOUNT_MAX = 2_000_000_000;

/** "YYYY-MM" — cùng quy ước `RevenueTarget.period`, `LeadTarget.period` và `monthKeyVN`. */
export const ADS_BUDGET_TARGET_PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Ô nhập của màn đặt chỉ tiêu ngân sách.
 *
 * ⚠️ `targetAmount` cố ý nhận CHUỖI rồi tự ép, KHÔNG dùng `z.coerce.number()`:
 * `Number("")` = 0, nên bản coerce biến "bấm Lưu khi chưa gõ gì" thành "ghi đè chỉ tiêu
 * cũ về 0" — im lặng, không lỗi, và người dùng chỉ thấy khi D-03 báo % vọt lên vô cực.
 * (Bẫy này đang nằm sẵn ở `doanh-thu/_actions.ts` của B-01; D-02 không chép lại.)
 *
 * ⚠️ Chuỗi có dấu ngăn cách ("10.000.000", "10,000,000") bị CHẶN chứ không tự bóc: đoán
 * dấu nào là phần nghìn và dấu nào là phần lẻ là cách chắc chắn nhất để lưu sai con số
 * thật 1000 lần. Ô nhập là `type="number"` nên người dùng không gõ được dấu; ca này canh
 * đường gọi thẳng Server Action.
 */
export const adsBudgetTargetInputSchema = z.object({
  // "" / "ALL" / thiếu → null = chỉ tiêu TOÀN HỆ THỐNG (KHÔNG phải "chưa gán cơ sở").
  centerId: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      return !t || t === "ALL" ? null : t;
    }),
  period: z.string().trim().regex(ADS_BUDGET_TARGET_PERIOD_RE, "Kỳ phải dạng YYYY-MM"),
  targetAmount: z
    .string()
    .trim()
    .regex(/^\d{1,12}$/, "Ngân sách phải là số tiền nguyên (chỉ chữ số, không dấu ngăn cách)")
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .max(
          ADS_BUDGET_TARGET_AMOUNT_MAX,
          `Ngân sách tối đa ${ADS_BUDGET_TARGET_AMOUNT_MAX.toLocaleString("vi-VN")} đ/tháng`,
        ),
    ),
  note: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      return t && t.length > 0 ? t : null;
    }),
});

export type AdsBudgetTargetInput = z.infer<typeof adsBudgetTargetInputSchema>;

/** Phần Actor mà luật tầm nhìn cần — khai theo cấu trúc để module này không kéo `lib/db` vào. */
export type AdsBudgetTargetScopeActor = {
  isSuperAdmin: boolean;
  isHoLevel: boolean;
  visibleCenterIds: string[];
};

/** Mảnh `where` cho `adsBudgetTarget.findMany` trên màn đặt. */
export type AdsBudgetTargetListWhere = { centerId?: { in: string[] } };

/**
 * Những dòng chỉ tiêu actor được NHÌN trên màn đặt.
 *
 * `AdsBudgetTarget` nằm trong `SCOPE_EXEMPT` (`lib/db-scope.ts`) — cố ý, vì `injectScope`
 * chèn `centerId IN (...)` trần và dòng chỉ tiêu toàn hệ thống (`centerId = NULL`) sẽ
 * tàng hình. Đổi lại, `scopedDb` là PASS-THROUGH ở bảng này ⇒ **không ai lọc giúp**,
 * luật tầm nhìn phải ép TAY, và thứ ép tay thì phải có test canh.
 *
 * - Cấp hội sở / quản trị: thấy cả dòng toàn hệ thống lẫn dòng của từng cơ sở — họ là
 *   người đặt cả hai (`checkRevenueTargetScope`), giấu đi thì họ không sửa được thứ
 *   mình vừa tạo.
 * - Vai cấp cơ sở: CHỈ cơ sở mình quản. (Hôm nay chưa vai cấp cơ sở nào được cấp
 *   `ads_budget_targets:manage` — nhánh này là rào sẵn cho lần nới quyền sau, đúng chỗ
 *   mà một dòng seed thêm vào sẽ chạm tới.)
 * - Chưa được gán cơ sở nào → `{ in: [] }`, tức RỖNG. FAIL-CLOSED: không có nhánh nào
 *   rơi về "thấy hết".
 */
export function adsBudgetTargetListWhere(
  actor: AdsBudgetTargetScopeActor,
): AdsBudgetTargetListWhere {
  if (actor.isSuperAdmin || actor.isHoLevel) return {};
  return { centerId: { in: actor.visibleCenterIds } };
}
