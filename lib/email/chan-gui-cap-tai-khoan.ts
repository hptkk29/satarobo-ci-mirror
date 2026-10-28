// lib/email/chan-gui-cap-tai-khoan.ts — MÔI TRƯỜNG KHÔNG PHẢI PRODUCTION THẬT ⇒ KHÔNG gửi email CẤP TÀI KHOẢN / RESET MẬT KHẨU ra ngoài. THUẦN.
//
// Sinh ra từ UAT TEST 26/10/2026: tạo tài khoản kế toán thử trên test đi qua `createUserAction` / `resetUserPasswordAction` →
// `notifyStaffAccountGranted` → `sendEmail` — gửi TRỰC TIẾP (không qua EmailQueue) một thư có MẬT KHẨU PLAINTEXT tới địa chỉ người dùng khai. Chặn email
// hoá đơn (`chan-gui-hoa-don.ts`) KHÔNG phủ ngữ cảnh này. Trên test, nếu một ngày env có khoá nhà cung cấp, tạo tài khoản với email thật là mật khẩu ra
// ngoài; chạy an toàn lâu nay chỉ nhờ thiếu khoá — không phải một cổng.
//
// Luật (chủ dự án giao 26/10/2026): chặn Ở SERVER; không dựa vào đuôi địa chỉ (`@example.invalid`); không đổi gì ở PROD; mật khẩu không vào log/audit.
//
//   · MỘT nguồn quyết định môi trường: dùng lại `chanGuiEmailHoaDon(env)` (host `test.*` HOẶC không phải production thật). Không nhân đôi luật, không
//     thêm công tắc "cho gửi thật". PROD (`VERCEL_ENV=production`, host không bắt đầu bằng `test.`) ⇒ `chan:false` ⇒ hành vi cũ nguyên vẹn.
//   · Phạm vi CHỈ là ngữ cảnh `STAFF_ACCOUNT_GRANTED`. OTP, thông báo, nhắc lịch… không đổi. ZNS cấp tài khoản không đổi (không mang mật khẩu; test luôn SIMULATED).

import type { BienMoiTruong } from "@/lib/security/client-ip";
import { chanGuiEmailHoaDon, DAU_CHAN_EMAIL_TEST, type KetQuaChanEmail } from "./chan-gui-hoa-don";

/** Giá trị `EmailLog.contextType` của thư cấp tài khoản / reset mật khẩu nhân sự — `contextId` = tài khoản đăng nhập. */
export const NGU_CANH_EMAIL_CAP_TAI_KHOAN = "STAFF_ACCOUNT_GRANTED";

/** Có phải thư CẤP TÀI KHOẢN không — chỗ DUY NHẤT so khớp ngữ cảnh. */
export const laNguCanhEmailCapTaiKhoan = (contextType: string | null | undefined): boolean => contextType === NGU_CANH_EMAIL_CAP_TAI_KHOAN;

/** Môi trường hiện tại có bị CHẶN gửi email cấp tài khoản không. `env` nhận từ chỗ gọi để test không phải đổi `process.env`. */
export function chanGuiEmailCapTaiKhoan(env: BienMoiTruong = process.env): KetQuaChanEmail {
  const q = chanGuiEmailHoaDon(env);
  if (!q.chan) return q;
  return {
    chan: true,
    nguon: q.nguon,
    lyDo: `${DAU_CHAN_EMAIL_TEST} Môi trường không phải production thật: server không gửi email cấp tài khoản / mật khẩu (không phụ thuộc địa chỉ nhận). Thư KHÔNG được gửi.`,
  };
}
