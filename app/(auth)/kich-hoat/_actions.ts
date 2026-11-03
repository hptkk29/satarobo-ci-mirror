"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { requestOtp, verifyAndConsumeOtp } from "@/lib/otp/service";
import { logUserAudit } from "@/lib/audit/log";
import { enqueueAccountActivated } from "@/lib/email/triggers";
import { publishEvent } from "@/lib/events/publish";
import { rateLimit } from "@/lib/rate-limit";
import { getRequestMetadata } from "@/lib/audit/headers";
import { getSetting } from "@/lib/settings/service";
import { activationIdentifierSchema } from "@/lib/validators/auth";
import { canonicalPhone } from "@/lib/phone";

// Cụm A1 — kích hoạt tài khoản phụ huynh qua OTP.
// AUTH-SĐT P5: định danh là **SĐT hoặc email** (trước P5 chỉ email). Kênh gửi
// tự chọn theo loại target ở `getOtpProviderFor` — SĐT đi Zalo ZNS, email đi
// Resend. Public (chưa đăng nhập).

type Result = { ok: boolean; error?: string; cooldownSec?: number };

/**
 * Rẽ nhánh tra cứu theo LOẠI định danh — cùng khuôn với `authorize` (P3):
 * KHÔNG dùng `OR: [{phone}, {email}]` vì nhánh nil sẽ dịch thành `phone IS NULL`
 * và khớp một user ngẫu nhiên bất kỳ trong đám tài khoản chưa có SĐT.
 */
function identityWhere(identifier: string): { phone: string } | { email: string } {
  const canonical = canonicalPhone(identifier);
  return canonical ? { phone: canonical } : { email: identifier };
}

/**
 * AUTH-SĐT P0 §3.4 — sàn thời gian phản hồi.
 *
 * Bịt oracle bằng cách trả cùng một thông điệp là chưa đủ: nhánh "có tài khoản"
 * còn phải ghi DB + gọi provider (vài trăm ms), nhánh "không tồn tại" trả về gần
 * như tức thì. Chênh lệch đó tự nó là một oracle đo được. Kéo mọi nhánh về cùng
 * một sàn thì phép đo hết ý nghĩa.
 */
const MIN_RESPONSE_MS = 900;

async function padTiming(startedAt: number): Promise<void> {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

/**
 * Bước 1 — gửi OTP kích hoạt tới email tài khoản PENDING_ACTIVATION.
 *
 * ⚠️ AUTH-SĐT P0 §3.2 + §3.4 (chốt 29/07). Đây là Server Action CÔNG KHAI
 * (chưa đăng nhập) nên phải tự gánh 2 việc mà tầng dưới không làm thay được:
 * - **Rate-limit theo IP.** Trước đây chặn duy nhất là cooldown DB theo
 *   (target, purpose) — không cản được 1 IP quét cả danh sách. Khi target là
 *   SĐT (đoán được, liệt kê được) mỗi lần gửi là 300đ tiền thật.
 * - **Phản hồi đồng nhất.** Mọi kết quả phụ thuộc target đều trả CÙNG một
 *   thông điệp: tồn tại / không tồn tại / đã ACTIVE / đang cooldown / gửi hỏng.
 *   Chỉ lỗi KHÔNG phụ thuộc target (sai định dạng, quá tần suất, hệ thống ngắt)
 *   mới được nói thật. Form bù lại bằng dòng hướng dẫn tĩnh
 *   ("nếu đã kích hoạt, dùng Quên mật khẩu") — chốt 29/07.
 */
export async function requestActivationOtp(rawIdentifier: string): Promise<Result> {
  const startedAt = Date.now();

  const parsed = activationIdentifierSchema.safeParse(rawIdentifier);
  // Sai định dạng: không phụ thuộc target → nói thật được.
  if (!parsed.success) return { ok: false, error: "Số điện thoại hoặc email không hợp lệ" };
  const identifier = parsed.data;

  const [cooldownSec, ipMaxPerHour] = await Promise.all([
    getSetting("otp.resendCooldownSec"),
    getSetting("otp.ipMaxPerHour"),
  ]);

  const { ip } = await getRequestMetadata();
  const rl = await rateLimit({
    key: `otp:activation:ip:${ip ?? "unknown"}`,
    max: ipMaxPerHour,
    windowMs: 60 * 60_000,
  });
  if (!rl.success) {
    await padTiming(startedAt);
    return { ok: false, error: "Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau 1 giờ." };
  }

  // Phản hồi đồng nhất cho MỌI nhánh phụ thuộc target — kể cả cooldown, vì
  // "đang cooldown" chỉ xảy ra với target có thật nên tự nó là một oracle.
  const generic: Result = { ok: true, cooldownSec };

  const user = await db.user.findUnique({
    where: identityWhere(identifier),
    select: { id: true, accountStatus: true, deletedAt: true },
  });

  if (!user || user.deletedAt || user.accountStatus !== "PENDING_ACTIVATION") {
    await padTiming(startedAt);
    return generic;
  }

  const res = await requestOtp({ target: identifier, purpose: "ACTIVATION", userId: user.id });

  // Ngắt toàn hệ thống (trần ngày / kill-switch) KHÔNG phụ thuộc target → báo thật
  // để phụ huynh biết đường gọi trung tâm thay vì ngồi đợi mã không bao giờ tới.
  // ⚠️ Phải nhận diện bằng cờ `systemHalt`, KHÔNG suy từ hình dạng kết quả: nhánh
  // "vượt hạn mức ngày của riêng số này" cũng trả `{ok:false, error}` trần y hệt
  // nhưng CHỈ xảy ra với target có thật — nói thật nhánh đó là dựng lại oracle.
  if (!res.ok && res.systemHalt) {
    await padTiming(startedAt);
    return { ok: false, error: res.error };
  }

  if (!res.ok) {
    // Cooldown / vượt hạn mức ngày / gửi hỏng → về generic. Ghi log để nhân viên
    // còn tra được (§P4 sẽ dựng /admin/otp-logs cho việc này).
    console.warn(`[otp:activation] không gửi được cho user ${user.id}: ${res.error}`);
    await padTiming(startedAt);
    return generic;
  }

  await logUserAudit({
    userId: user.id,
    action: "UPDATE",
    actorId: null,
    actorName: "Hệ thống (OTP)",
    changedFields: ["otpActivation"],
    reason: "Gửi OTP kích hoạt tài khoản",
  }).catch(() => {});

  await padTiming(startedAt);
  return generic;
}

const activateSchema = z.object({
  identifier: activationIdentifierSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Mã gồm 6 chữ số"),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
});

/** Bước 2 — verify OTP + đặt mật khẩu → ACTIVE. */
export async function activateAccount(input: unknown): Promise<Result> {
  const parsed = activateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const { identifier, code, password } = parsed.data;
  const viaPhone = canonicalPhone(identifier) !== null;

  // Verify + tiêu mã trong CÙNG một thao tác nguyên tử (P0 §3.1 phương án A).
  // Đặt TRƯỚC mọi câu trả lời về tài khoản: muốn chạm tới các thông điệp bên dưới
  // thì phải có mã đúng trong tay, nên chúng không còn là oracle liệt kê.
  const v = await verifyAndConsumeOtp({ target: identifier, purpose: "ACTIVATION", code });
  if (!v.ok) return { ok: false, error: v.error };

  const user = await db.user.findUnique({
    where: identityWhere(identifier),
    select: {
      id: true,
      accountStatus: true,
      name: true,
      email: true,
      children: { select: { name: true }, take: 1 },
    },
  });
  if (!user) return { ok: false, error: "Không tìm thấy tài khoản" };
  // Phụ huynh đã ACTIVE → KHÔNG đặt lại mật khẩu.
  if (user.accountStatus !== "PENDING_ACTIVATION") {
    return { ok: false, error: "Tài khoản đã kích hoạt — vui lòng đăng nhập." };
  }

  const hashed = await bcrypt.hash(password, 10);
  await db.user.update({
    where: { id: user.id },
    data: {
      password: hashed,
      accountStatus: "ACTIVE",
      isActive: true,
      // P5 — đánh dấu ĐÚNG kênh vừa chứng minh quyền sở hữu. Trước P5 luôn set
      // `emailVerified` vì chỉ có một đường; nay kích hoạt bằng SĐT mà vẫn set
      // emailVerified là **nói dối dữ liệu**: `findVerifiedFallbackEmail` (P4)
      // dựa vào cờ đó để chọn email dự phòng, sẽ gửi mã tới hòm thư chưa ai
      // chứng minh là của mình.
      ...(viaPhone ? { phoneVerifiedAt: new Date() } : { emailVerified: new Date() }),
    },
  });

  // A2 — email chào mừng kích hoạt (qua queue). Sau P5 phụ huynh có thể KHÔNG
  // có email — bỏ qua, không phải lỗi.
  if (user.email) {
    await enqueueAccountActivated({
      to: user.email,
      parentName: user.name,
      childName: user.children[0]?.name ?? null,
    }).catch(() => {});
  }

  // R7-17 — DomainEvent: tài khoản phụ huynh đã usable (portal access). Handler
  // (lib/_handlers/account-notif.ts) tạo Notification chào mừng vào feed học viên.
  // Idempotent theo dedupeKey = account.activated:<userId> (PENDING→ACTIVE chỉ 1 lần).
  await publishEvent(
    "account.activated",
    { userId: user.id },
    { dedupeKey: `account.activated:${user.id}` },
  ).catch(() => {});

  await logUserAudit({
    userId: user.id,
    action: "ENABLE",
    actorId: user.id,
    actorName: "Phụ huynh (kích hoạt)",
    changedFields: ["accountStatus", "password"],
    reason: `Kích hoạt tài khoản phụ huynh qua OTP ${viaPhone ? "Zalo (SĐT)" : "email"}`,
  }).catch(() => {});

  return { ok: true };
}
