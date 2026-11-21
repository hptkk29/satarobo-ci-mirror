// lib/validators/huy-phieu-the.ts — đầu vào của Server Action `huyPhieuTheAction` (Việc 4 · 09/10/2026).
// Zod là nguồn kiểu (CLAUDE.md quy ước 2). Thiết kế: docs/pos-hai-nut-khai-may.md §5.
//
// Tệp RIÊNG (không nhét vào `phieu-pos.ts` cùng ba schema thu thẻ): hai việc song song cùng thêm schema thu thẻ POS thì
// tệp chung là chỗ xung đột — và đây là hợp đồng giữa máy chủ (S) và giao diện (U), nên tên + hình dạng phải đứng yên.
import { z } from "zod";
import {
  GHI_CHU_HUY_TOI_DA,
  GHI_CHU_KHAC_TOI_THIEU,
  MA_LY_DO_HUY_PHIEU_THE,
} from "@/lib/payments/pos/huy-phieu-the-cau";

const id = z.string().trim().min(1, "Thiếu mã").max(64, "Mã quá dài");

/**
 * "Huỷ phiếu thẻ".
 *   · `orderId` + `intentId` — khuôn `kiemTraPhieuPosSchema`: cổng quyền/phạm vi chạy trên ĐƠN, rồi phiếu thẻ phải thuộc
 *     CHÍNH đơn đó (cổng IDOR);
 *   · `lyDo` BẮT BUỘC (chọn nhanh); chọn "Khác" thì `ghiChu` bắt buộc;
 *   · `xacNhanKhachChuaQuet` BẮT BUỘC, KHÔNG mặc định — UI luôn gửi rõ `true`/`false`. Máy chủ quyết có cần xác nhận mạnh
 *     hay không bằng `choPhepHuyPhieuThe` (đọc lại dưới khoá), KHÔNG tin cờ này để bỏ qua cổng: nó chỉ là "người bấm đã tick".
 */
export const huyPhieuTheSchema = z
  .object({
    orderId: id,
    intentId: id,
    lyDo: z.enum(MA_LY_DO_HUY_PHIEU_THE, { error: "Chọn lý do huỷ phiếu thẻ" }),
    ghiChu: z.string().trim().max(GHI_CHU_HUY_TOI_DA, `Ghi chú tối đa ${GHI_CHU_HUY_TOI_DA} ký tự`).optional(),
    xacNhanKhachChuaQuet: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.lyDo === "KHAC" && (v.ghiChu ?? "").length < GHI_CHU_KHAC_TOI_THIEU) {
      ctx.addIssue({
        code: "custom",
        path: ["ghiChu"],
        message: `Chọn “Khác” thì ghi chú lý do (ít nhất ${GHI_CHU_KHAC_TOI_THIEU} ký tự)`,
      });
    }
  });

/** Kiểu ĐẦU VÀO của action (trước khi parse) — màn gõ đúng hình này, `tsc` bắt thiếu khoá. */
export type HuyPhieuTheInput = z.input<typeof huyPhieuTheSchema>;
export type HuyPhieuTheDaParse = z.output<typeof huyPhieuTheSchema>;
