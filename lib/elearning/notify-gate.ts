import { db } from "@/lib/db";
import { notifyStaff, type NotifyStaffParams } from "@/lib/notifications/notify";

/**
 * Cổng người nhận cho MỌI thông báo của khu E-learning.
 *
 * Vì sao có: cờ `ELEARNING_REMINDER_ENABLED` và các handler sự kiện gửi chuông (và Web Push cho thiết bị đã đăng ký) tới người học,
 * quản lý trực tiếp và TOÀN BỘ tài khoản vai TRAINING. Trên TEST, DB có tài khoản người thật cạnh tài khoản UAT — bật nhắc mà không
 * giới hạn người nhận là gửi thông báo UAT tới người thật.
 *
 * Cơ chế: đặt `ELEARNING_NOTIFY_ONLY_EMAIL_DOMAIN=<miền>` (không có @, vd `uat.satarobo.invalid`) ⇒ chỉ tài khoản có email
 * `…@<miền>` nhận được; người khác bị LOẠI TRƯỚC khi ghi bất cứ thứ gì (không chuông, không outbox push). Không đặt ⇒ đi thẳng
 * `notifyStaff`, không chạm DB — hành vi PROD không đổi.
 *
 * Fail-CLOSED với giá trị hỏng: biến có đặt nhưng không phải tên miền hợp lệ ⇒ KHÔNG gửi cho ai (thà mất thông báo UAT còn hơn lọt
 * ra người thật vì gõ nhầm). Lưới `notify-gate.test.ts` đòi mọi tệp lib/elearning gửi chuông đi qua đây.
 */
export const BIEN_CHI_TOI_MIEN = "ELEARNING_NOTIFY_ONLY_EMAIL_DOMAIN";

const MIEN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** `undefined` = không giới hạn; chuỗi = chỉ miền này; `null` = biến hỏng ⇒ không gửi cho ai. */
export function mienChiNhan(env: Readonly<Record<string, string | undefined>> = process.env): string | null | undefined {
  const raw = env[BIEN_CHI_TOI_MIEN];
  if (raw === undefined || raw.trim() === "") return undefined;
  const m = raw.trim().toLowerCase();
  return MIEN_RE.test(m) ? m : null;
}

export async function notifyElearning(params: NotifyStaffParams): Promise<number> {
  const mien = mienChiNhan();
  if (mien === undefined) return notifyStaff(params);
  if (mien === null) return 0;
  const ids = [...new Set(params.userIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const nguoi = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
  const duoc = nguoi.filter((u) => u.email?.toLowerCase().endsWith(`@${mien}`)).map((u) => u.id);
  if (duoc.length === 0) return 0;
  return notifyStaff({ ...params, userIds: duoc });
}
