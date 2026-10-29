import "server-only";
import { sendEmail } from "@/lib/email/send";
import { canonicalPhone } from "@/lib/phone";
import { isZnsDegraded } from "@/lib/flags";
import { zaloOtpProvider } from "@/lib/zalo/otp-provider";

// =============================================================================
// Cụm A1 → AUTH-SĐT P4 — OTP provider abstraction.
// Provider chọn theo LOẠI TARGET (QĐ-5), KHÔNG theo env: SĐT → Zalo ZNS,
// email → Resend. SMS đã BỎ HẲN theo QĐ-H 30/07 (không có nhà cung cấp nào
// được ký) — email là kênh dự phòng vĩnh viễn (QĐ-3).
// =============================================================================

import type { OtpProvider, OtpSendInput } from "./provider-types";

// Types ở ./provider-types — tách để cắt vòng import với lib/zalo/otp-provider
// (dependency-cruiser no-circular tính cả import type). Re-export để call-site
// cũ import từ đây vẫn chạy.
export type { OtpChannelKey, OtpProvider, OtpSendInput, OtpSendResult } from "./provider-types";

const PURPOSE_LABEL: Record<OtpSendInput["purpose"], string> = {
  ACTIVATION: "kích hoạt tài khoản",
  RESET: "đặt lại mật khẩu",
  CHANGE_CONTACT: "đổi thông tin liên hệ",
};

/** Provider EMAIL — gửi mã OTP qua Resend (tái dùng lib/email/send.ts). */
export const emailOtpProvider: OtpProvider = {
  channel: "EMAIL",
  name: "resend",
  async send({ target, code, purpose, minutesValid }) {
    const label = PURPOSE_LABEL[purpose];
    const subject = `Mã ${label} Sata Robo: ${code}`;
    const bodyText = `Mã ${label} của bạn là: ${code}\nMã có hiệu lực trong ${minutesValid} phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.`;
    const bodyHtml = `<div style="font-family:system-ui,sans-serif">
      <p>Mã <b>${label}</b> Sata Robo của bạn là:</p>
      <p style="font-size:28px;font-weight:800;letter-spacing:4px;color:#F97316">${code}</p>
      <p style="color:#666">Mã có hiệu lực trong <b>${minutesValid} phút</b>. Vui lòng không chia sẻ mã này.</p>
    </div>`;

    const res = await sendEmail({
      to: target,
      subject,
      bodyText,
      bodyHtml,
      contextType: "OTP",
      triggerType: "SYSTEM",
    });
    return res.ok
      ? { ok: true, provider: "resend" }
      : { ok: false, provider: "resend", error: res.error };
  },
};

/**
 * AUTH-SĐT P4 (QĐ-5) — chọn provider theo LOẠI target:
 * - SĐT (canonical hoá được) → Zalo ZNS. Trả `null` khi cờ break-glass
 *   `AUTH_ZNS_DEGRADED` bật — service sẽ đi thẳng đường email dự phòng.
 * - Email → Resend.
 * Env `OTP_PRIMARY_PROVIDER` đã GỠ — trước đây bị code nuốt im lặng
 * (`"zalo"` trong .env.example không có tác dụng), nay chọn theo target nên
 * không còn chỗ cho env này.
 */
export function getOtpProviderFor(target: string): OtpProvider | null {
  if (canonicalPhone(target) !== null) {
    if (isZnsDegraded()) {
      console.warn("[otp] AUTH_ZNS_DEGRADED đang bật — bỏ qua ZNS, dùng email dự phòng.");
      return null;
    }
    return zaloOtpProvider;
  }
  return emailOtpProvider;
}
