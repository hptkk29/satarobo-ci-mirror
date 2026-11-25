"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { requestOtp, verifyAndConsumeOtp } from "@/lib/otp/service";
import { logUserAudit } from "@/lib/audit/log";
import { rateLimit } from "@/lib/rate-limit";
import { getRequestMetadata } from "@/lib/audit/headers";
import { getSetting } from "@/lib/settings/service";
import { activationIdentifierSchema } from "@/lib/validators/auth";
import { canonicalPhone } from "@/lib/phone";

// =============================================================================
// AUTH-SĐT P6 — quên mật khẩu qua OTP (`OtpPurpose.RESET`).
//
// Enum RESET đã khai từ lâu nhưng KHÔNG có call-site nào — trước P5 điều đó chỉ
// gây bất tiện, sau P5 nó thành lỗ hổng thật: phụ huynh cấp tài khoản bằng SĐT,
// KHÔNG có email, quên mật khẩu ⇒ mất hẳn đường vào hệ thống.
//
// Định danh dùng chung khuôn với /login (P3) và /kich-hoat (P5): SĐT hoặc email,
// kênh gửi tự chọn theo loại target (SĐT → Zalo ZNS, email → Resend).
// =============================================================================

type Result = { ok: boolean; error?: string; cooldownSec?: number };

/** Xem ghi chú cùng tên ở kich-hoat/_actions.ts — KHÔNG dùng OR để né `{phone:null}`. */
function identityWhere(identifier: string): { phone: string } | { email: string } {
  const canonical = canonicalPhone(identifier);
  return canonical ? { phone: canonical } : { email: identifier };
}

/** AUTH-SĐT P0 §3.4 — sàn thời gian phản hồi, chống oracle đo bằng đồng hồ. */
const MIN_RESPONSE_MS = 900;

async function padTiming(startedAt: number): Promise<void> {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

/**
 * Bước 1 — gửi OTP đặt lại mật khẩu.
 *
 * Cùng kỷ luật với `/kich-hoat` (Server Action CÔNG KHAI): rate-limit theo IP và
 * **phản hồi đồng nhất** cho mọi nhánh phụ thuộc target. Ở đây điều đó còn quan
 * trọng hơn: màn quên mật khẩu là nơi tự nhiên nhất để dò xem một SĐT có phải
 * khách hàng của trung tâm hay không.
 */
export async function requestPasswordResetOtp(rawIdentifier: string): Promise<Result> {
  const startedAt = Date.now();

  const parsed = activationIdentifierSchema.safeParse(rawIdentifier);
  if (!parsed.success) return { ok: false, error: "Số điện thoại hoặc email không hợp lệ" };
  const identifier = parsed.data;

  const [cooldownSec, ipMaxPerHour] = await Promise.all([
    getSetting("otp.resendCooldownSec"),
    getSetting("otp.ipMaxPerHour"),
  ]);

  const { ip } = await getRequestMetadata();
  const rl = await rateLimit({
    key: `otp:reset:ip:${ip ?? "unknown"}`,
    max: ipMaxPerHour,
    windowMs: 60 * 60_000,
  });
  if (!rl.success) {
    await padTiming(startedAt);
    return { ok: false, error: "Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau 1 giờ." };
  }

  const generic: Result = { ok: true, cooldownSec };

  const user = await db.user.findUnique({
    where: identityWhere(identifier),
    select: { id: true, accountStatus: true, deletedAt: true, isActive: true },
  });

  // Tài khoản chưa kích hoạt CỐ Ý cũng rơi vào generic: nó chưa có mật khẩu để
  // "đặt lại", và nói thật ("tài khoản chưa kích hoạt") là dựng lại đúng cái
  // oracle liệt kê mà P0 đã bịt. Màn hình bù bằng dòng hướng dẫn tĩnh.
  if (!user || user.deletedAt || !user.isActive || user.accountStatus !== "ACTIVE") {
    await padTiming(startedAt);
    return generic;
  }

  const res = await requestOtp({ target: identifier, purpose: "RESET", userId: user.id });

  // Chỉ ngắt TOÀN HỆ THỐNG (trần ngày / kill-switch) mới được nói thật — nó không
  // phụ thuộc target nên không lộ gì, mà im lặng thì phụ huynh ngồi đợi mã không
  // bao giờ tới.
  if (!res.ok && res.systemHalt) {
    await padTiming(startedAt);
    return { ok: false, error: res.error };
  }
  if (!res.ok) {
    console.warn(`[otp:reset] không gửi được cho user ${user.id}: ${res.error}`);
    await padTiming(startedAt);
    return generic;
  }

  await logUserAudit({
    userId: user.id,
    action: "UPDATE",
    actorId: null,
    actorName: "Hệ thống (OTP)",
    changedFields: ["otpReset"],
    reason: "Gửi OTP đặt lại mật khẩu",
  }).catch(() => {});

  await padTiming(startedAt);
  return generic;
}

const resetSchema = z.object({
  identifier: activationIdentifierSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Mã gồm 6 chữ số"),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
});

/**
 * Bước 2 — verify OTP + đặt mật khẩu mới.
 *
 * ⚠️ Mã và mật khẩu mới BẮT BUỘC nằm trên CÙNG một màn (nợ UX của QĐ P0-a):
 * `verifyAndConsumeOtp` gộp verify+consume thành một thao tác nguyên tử nên
 * KHÔNG còn trạng thái "đã verify, chưa consume" để chia hai bước. Muốn tách
 * bước thì phải đổi sang phương án (B) — đừng khôi phục `verifiedAt` hai pha.
 */
export async function resetPassword(input: unknown): Promise<Result> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { identifier, code, password } = parsed.data;

  // Verify TRƯỚC mọi câu trả lời phụ thuộc tài khoản — muốn chạm tới các thông
  // điệp bên dưới thì phải có mã đúng trong tay.
  const v = await verifyAndConsumeOtp({ target: identifier, purpose: "RESET", code });
  if (!v.ok) return { ok: false, error: v.error };

  const user = await db.user.findUnique({
    where: identityWhere(identifier),
    select: { id: true, accountStatus: true, isActive: true, deletedAt: true },
  });
  if (!user || user.deletedAt || !user.isActive || user.accountStatus !== "ACTIVE") {
    return { ok: false, error: "Không đặt lại được mật khẩu. Vui lòng liên hệ trung tâm." };
  }

  const hashed = await bcrypt.hash(password, 10);
  await db.user.update({
    where: { id: user.id },
    data: {
      password: hashed,
      // Ép đăng xuất MỌI thiết bị. Không có dòng này thì kẻ đang giữ phiên cũ
      // vẫn ở nguyên trong tài khoản tới 30 ngày (JWT mặc định, lib/auth.ts:60
      // không đặt maxAge) — tức "đổi mật khẩu" không đuổi được ai, đúng lúc
      // người dùng đổi vì nghi bị chiếm tài khoản.
      tokenVersion: { increment: 1 },
      // Người dùng tự đặt mật khẩu này ⇒ không bắt đổi lại lần đăng nhập kế.
      mustChangePassword: false,
    },
  });

  await logUserAudit({
    userId: user.id,
    action: "PASSWORD_RESET",
    actorId: user.id,
    actorName: "Người dùng (quên mật khẩu)",
    // KHÔNG log oldValues/newValues — không để hash rơi vào audit.
    changedFields: ["password", "tokenVersion"],
    reason: `Đặt lại mật khẩu qua OTP ${canonicalPhone(identifier) ? "Zalo (SĐT)" : "email"}`,
  }).catch(() => {});

  return { ok: true };
}
