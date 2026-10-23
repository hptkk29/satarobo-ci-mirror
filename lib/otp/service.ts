import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { emailOtpProvider, getOtpProviderFor } from "./provider";
import { getSetting } from "@/lib/settings/service";
import { getSigningSecret } from "@/lib/security/signing-key";
import { canonicalPhone } from "@/lib/phone";

// =============================================================================
// Cụm A1 — OTP service (request + verify).
// Quy tắc: hết hạn 5 phút · tối đa 5 lần thử · cooldown gửi lại 60s · giới hạn
// theo ngày/email. CHỈ dùng cho kích hoạt / quên mật khẩu / đổi liên hệ — KHÔNG
// dùng cho mọi lần login. Code lưu DẠNG HASH (HMAC-SHA256).
// =============================================================================

export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SEC = 60;
export const OTP_DAILY_LIMIT = 8; // tối đa số OTP / target / ngày

/**
 * AUTH-SĐT P0 §3.5 — CHỈ bản ghi ĐÃ GỬI ĐƯỢC mới bị tính vào cooldown/hạn mức.
 *
 * `OtpRequest` được tạo TRƯỚC khi gọi provider, nên trước đây một lần gửi hỏng
 * (Resend lỗi, ZNS `-118`/`-139`, hết quota) vẫn trừ 1 trong 8 lượt/ngày và khoá
 * resend 60s — chặn người dùng đúng lúc họ cần resend nhất. Lọc qua quan hệ
 * `deliveries` giữ được ngữ nghĩa mà KHÔNG phải đổi schema.
 */
const DELIVERED = { deliveries: { some: { status: "SENT" } } } as const;

export type OtpPurposeKey = "ACTIVATION" | "RESET" | "CHANGE_CONTACT";

function secret(): string {
  return getSigningSecret(); // SEC-H05: bỏ fallback hằng số công khai (brute-force OTP hash).
}

function hashCode(code: string): string {
  return createHmac("sha256", secret()).update(code).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// AUTH-SĐT P2 — cửa test: production khởi động mà thấy biến này thì NỔ NGAY,
// không chờ tới lần xin mã đầu tiên (fail-loud, chặn cấu hình nhầm từ lúc deploy).
if (process.env.NODE_ENV === "production" && process.env.OTP_TEST_FIXED_CODE) {
  throw new Error(
    "OTP_TEST_FIXED_CODE đang được set trên production — cửa test này làm mọi mã OTP thành hằng số công khai. Gỡ biến env rồi deploy lại.",
  );
}

/**
 * AUTH-SĐT P2 — cửa test cho e2e. `codeHash` là HMAC một chiều nên test không
 * đọc ngược được mã từ DB; đặt `OTP_TEST_FIXED_CODE` (đúng 6 chữ số) thì mã sinh
 * ra luôn bằng giá trị đó. CHỈ can thiệp vào nguồn ngẫu nhiên — hash, cooldown,
 * hạn mức, attempts, CAS vẫn đi đường thật nên e2e test đúng luồng sản xuất.
 */
function genCode(): string {
  const fixed = process.env.OTP_TEST_FIXED_CODE;
  if (fixed && process.env.NODE_ENV !== "production") {
    if (!/^[0-9]{6}$/.test(fixed)) {
      throw new Error("OTP_TEST_FIXED_CODE phải là đúng 6 chữ số.");
    }
    return fixed;
  }
  // 6 chữ số, không bắt đầu bằng 0 để luôn đủ 6 ký tự.
  return String(randomInt(100000, 1000000));
}

/**
 * AUTH-SĐT P1 — chuẩn hoá `OtpRequest.target` NGAY TẠI TẦNG NÀY, không chỉ ở
 * validator đầu vào.
 *
 * `target` vừa là khoá tra cứu lúc verify, vừa là khoá của cooldown và hạn mức
 * ngày. Trước đây chỉ `.trim().toLowerCase()` — với SĐT đó là **no-op**, kéo theo
 * hai hỏng hóc câm:
 * - **Verify không bao giờ khớp:** lưu `84905…` lúc cấp tài khoản nhưng
 *   `/kich-hoat` gửi lên `0905…` ⇒ `findFirst({where:{target}})` không thấy gì,
 *   phụ huynh nhận được mã nhưng nhập vào báo "chưa có mã".
 * - **Thủng lá chắn chi phí §3.2:** hai cách gõ = hai bộ đếm = gấp đôi hạn mức
 *   8 tin/ngày, và cooldown 60s vượt được chỉ bằng cách đổi cách gõ số.
 *
 * Email vẫn đi nhánh lowercase như cũ.
 */
export function normalizeOtpTarget(raw: string): string {
  return canonicalPhone(raw) ?? raw.trim().toLowerCase();
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export type RequestOtpResult =
  | { ok: true; otpId: string; expiresAt: Date; cooldownSec: number }
  | {
      ok: false;
      error: string;
      cooldownSec?: number;
      /** OTP ĐÃ tạo (verify được) nhưng kênh gửi lỗi — caller quyết định cách báo (QA 21/07 #3). */
      deliveryFailed?: boolean;
      /**
       * Từ chối vì lý do TOÀN HỆ THỐNG (trần ngày / kill-switch), KHÔNG phụ thuộc
       * target. Đường công khai được phép báo thật lỗi này mà không tạo oracle
       * liệt kê — mọi lý do còn lại (không tồn tại / cooldown / vượt hạn mức của
       * riêng số này / gửi hỏng) đều chỉ xảy ra với target CÓ THẬT nên phải nuốt
       * về thông điệp chung. Xem §3.4.
       */
      systemHalt?: boolean;
    };

/**
 * Tạo + gửi OTP. Áp cooldown 60s + giới hạn ngày. Trả về otpId + hạn.
 */
export async function requestOtp(input: {
  target: string;
  purpose: OtpPurposeKey;
  userId?: string | null;
}): Promise<RequestOtpResult> {
  const target = normalizeOtpTarget(input.target);
  if (!target) return { ok: false, error: "Thiếu email/SĐT" };

  // Tham số động (SystemSetting "otp.*"); default = hằng số cũ nếu chưa cấu hình.
  const [ttlMinutes, cooldownSec, dailyLimit, maxAttempts, globalCap, killSwitch] =
    await Promise.all([
      getSetting("otp.ttlMinutes"),
      getSetting("otp.resendCooldownSec"),
      getSetting("otp.dailyLimit"),
      getSetting("otp.maxAttempts"),
      getSetting("otp.globalDailyCap"),
      getSetting("otp.globalKillSwitch"),
    ]);

  // AUTH-SĐT P0 §3.2 — trần CHI PHÍ toàn hệ thống. Đặt ở đây (không ở Server
  // Action) để mọi đường xin mã đều đi qua, kể cả admin gửi lại hàng loạt.
  const sentToday = await db.otpDeliveryLog.count({
    where: { status: "SENT", createdAt: { gte: startOfToday() } },
  });
  if (sentToday >= killSwitch) {
    console.error(
      `[otp] KILL-SWITCH: đã gửi ${sentToday} tin hôm nay (ngưỡng ${killSwitch}) — NGỪNG gửi tới hết ngày.`,
    );
    return {
      ok: false,
      error: "Hệ thống tạm ngừng gửi mã. Vui lòng liên hệ trung tâm.",
      systemHalt: true,
    };
  }
  if (sentToday >= globalCap) {
    console.warn(`[otp] Chạm trần ngày: ${sentToday}/${globalCap} tin.`);
    return {
      ok: false,
      error: "Hệ thống tạm ngừng gửi mã. Vui lòng liên hệ trung tâm.",
      systemHalt: true,
    };
  }

  // Cooldown: lần gửi THÀNH CÔNG gần nhất < cooldownSec.
  const last = await db.otpRequest.findFirst({
    where: { target, purpose: input.purpose, ...DELIVERED },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last) {
    const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
    if (elapsed < cooldownSec) {
      return {
        ok: false,
        error: `Vui lòng chờ ${Math.ceil(cooldownSec - elapsed)}s trước khi gửi lại.`,
        cooldownSec: Math.ceil(cooldownSec - elapsed),
      };
    }
  }

  // Giới hạn theo ngày — chỉ đếm lần gửi THÀNH CÔNG (§3.5).
  const todayCount = await db.otpRequest.count({
    where: {
      target,
      purpose: input.purpose,
      createdAt: { gte: startOfToday() },
      ...DELIVERED,
    },
  });
  if (todayCount >= dailyLimit) {
    return { ok: false, error: "Đã vượt số lần gửi mã trong ngày. Vui lòng thử lại sau." };
  }

  // AUTH-SĐT P4 (QĐ-5) — provider theo LOẠI target: SĐT → Zalo ZNS, email → Resend.
  // provider = null ⇔ cờ break-glass AUTH_ZNS_DEGRADED đang bật (bỏ qua ZNS).
  const provider = getOtpProviderFor(target);
  // Target SĐT (kể cả degraded) mới có đường email dự phòng; tra LƯỜI — chỉ
  // khi thật sự cần, khỏi tốn query trên happy path.
  const isPhoneTarget = provider?.channel !== "EMAIL";

  let fallbackEmail: string | null = null;
  if (!provider) {
    fallbackEmail = await findVerifiedFallbackEmail(target, input.userId ?? null);
    if (!fallbackEmail) {
      // Degraded mà user không có email dự phòng → không còn kênh nào; đừng tạo
      // OtpRequest rác (mã không ai nhận được nhưng vẫn verify được nếu lộ).
      return { ok: false, error: "Không gửi được mã. Thử lại sau.", deliveryFailed: true };
    }
  }

  const code = genCode();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  const otp = await db.otpRequest.create({
    data: {
      target,
      channel: provider?.channel ?? "EMAIL",
      purpose: input.purpose,
      codeHash: hashCode(code),
      expiresAt,
      maxAttempts,
      userId: input.userId ?? null,
    },
    select: { id: true },
  });

  // Lần gửi 1 — kênh chính theo target.
  let sent: { ok: boolean; error?: string } | null = null;
  if (provider) {
    sent = await provider.send({
      target,
      code,
      purpose: input.purpose,
      minutesValid: ttlMinutes,
    });
    await db.otpDeliveryLog.create({
      data: {
        otpRequestId: otp.id,
        channel: provider.channel,
        target,
        provider: provider.name,
        status: sent.ok ? "SENT" : "FAILED",
        error: sent.error ?? null,
      },
    });
  }

  // Lần gửi 2 — email dự phòng khi ZNS hỏng/degraded (mô hình 2 delivery /
  // 1 request đã có sẵn trong schema). target của delivery = địa chỉ email
  // THẬT đã gửi tới; OtpRequest.target vẫn là SĐT nên verify không đổi.
  // Đòi email ĐÃ VERIFY — không giả vờ gửi được cho địa chỉ chưa ai xác nhận.
  if (!sent?.ok && isPhoneTarget && fallbackEmail === null) {
    fallbackEmail = await findVerifiedFallbackEmail(target, input.userId ?? null);
  }
  if (!sent?.ok && fallbackEmail) {
    const viaEmail = await emailOtpProvider.send({
      target: fallbackEmail,
      code,
      purpose: input.purpose,
      minutesValid: ttlMinutes,
    });
    await db.otpDeliveryLog.create({
      data: {
        otpRequestId: otp.id,
        channel: "EMAIL",
        target: fallbackEmail,
        provider: emailOtpProvider.name,
        status: viaEmail.ok ? "SENT" : "FAILED",
        error: viaEmail.error ?? null,
      },
    });
    if (viaEmail.ok) return { ok: true, otpId: otp.id, expiresAt, cooldownSec };
  }

  if (!sent?.ok) {
    return {
      ok: false,
      error: sent?.error ?? "Không gửi được mã. Thử lại sau.",
      deliveryFailed: true,
    };
  }

  return { ok: true, otpId: otp.id, expiresAt, cooldownSec };
}

/**
 * AUTH-SĐT P4 — email dự phòng cho target SĐT: tra user theo `userId` (nếu
 * caller biết) hoặc theo `User.phone` (canonical). Đòi `emailVerified` — email
 * chưa verify không được nhận mã (kế hoạch §P4, "không giả vờ thành công").
 */
async function findVerifiedFallbackEmail(
  target: string,
  userId: string | null,
): Promise<string | null> {
  const user = userId
    ? await db.user.findUnique({
        where: { id: userId },
        select: { email: true, emailVerified: true },
      })
    : await db.user.findFirst({
        where: { phone: target },
        select: { email: true, emailVerified: true },
      });
  return user?.email && user.emailVerified ? user.email : null;
}

export type VerifyOtpResult =
  | { ok: true; otpId: string; userId: string | null }
  | { ok: false; error: string; attemptsLeft?: number };

/**
 * Verify OTP mới nhất chưa dùng cho target+purpose — VÀ TIÊU LUÔN trong cùng một
 * thao tác nguyên tử. Tăng attempts khi sai; khoá sau `maxAttempts` lần.
 *
 * ⚠️ AUTH-SĐT P0 §3.1 (phương án A, chốt 29/07) — vá lỗ hổng chiếm tài khoản.
 * Bản cũ tách verify (set `verifiedAt`) khỏi consume (set `consumedAt`) và mở đầu
 * bằng `if (otp.verifiedAt) return { ok: true }` — đặt TRƯỚC cả kiểm hạn dùng lẫn
 * so mã. Một OTP đã verify mà chưa consume (người dùng bỏ dở giữa chừng) vì thế
 * trở thành vé vào cửa vĩnh viễn: mọi lần verify sau đó trả `ok` với BẤT KỲ mã
 * nào, bỏ qua cả `expiresAt`. Luồng `/kich-hoat` thoát nạn do tình cờ — nó chặn
 * lại bằng `accountStatus !== "PENDING_ACTIVATION"`, không phải nhờ thiết kế.
 *
 * Nay không còn trạng thái trung gian để khai thác: đường thành công DUY NHẤT là
 * so khớp mã rồi CAS `consumedAt: null → now()`. `updateMany` + guard
 * `consumedAt: null` là compare-and-swap ở tầng DB nên 2 request đồng thời chỉ
 * một cái thắng, không cần bọc transaction.
 *
 * ⚠️ Hệ quả UX đã biết (chấp nhận khi chốt A): nghiệp vụ bước 2 phải nằm CÙNG
 * MỘT màn với ô nhập mã. `/quen-mat-khau` (P6) vì thế nhập mã + mật khẩu mới
 * trong 1 form — không tách 2 bước được. Nếu sau này cần tách, chuyển sang
 * phương án B (token 1 lần có hạn riêng), đừng khôi phục `verifiedAt` 2 pha.
 */
export async function verifyAndConsumeOtp(input: {
  target: string;
  purpose: OtpPurposeKey;
  code: string;
}): Promise<VerifyOtpResult> {
  const target = normalizeOtpTarget(input.target);
  const code = input.code.trim();

  const otp = await db.otpRequest.findFirst({
    where: { target, purpose: input.purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return { ok: false, error: "Chưa có mã hoặc mã đã dùng. Vui lòng gửi lại." };

  if (otp.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "Mã đã hết hạn. Vui lòng gửi lại." };
  }
  if (otp.attempts >= otp.maxAttempts) {
    return { ok: false, error: "Đã nhập sai quá số lần cho phép. Vui lòng gửi mã mới." };
  }

  const match = safeEqualHex(otp.codeHash, hashCode(code));
  if (!match) {
    const updated = await db.otpRequest.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true, maxAttempts: true },
    });
    const left = Math.max(0, updated.maxAttempts - updated.attempts);
    return {
      ok: false,
      error: left > 0 ? `Mã không đúng. Còn ${left} lần thử.` : "Đã khoá — vui lòng gửi mã mới.",
      attemptsLeft: left,
    };
  }

  // CAS: chỉ request đầu tiên tiêu được mã. `count === 0` ⇒ có request khác đã
  // tiêu xong giữa lúc ta đọc và ghi.
  const now = new Date();
  const claimed = await db.otpRequest.updateMany({
    where: { id: otp.id, consumedAt: null },
    data: { verifiedAt: now, consumedAt: now },
  });
  if (claimed.count !== 1) {
    return { ok: false, error: "Mã đã được dùng. Vui lòng gửi lại." };
  }

  return { ok: true, otpId: otp.id, userId: otp.userId };
}

/**
 * AUTH-SĐT P6 — CẤP MÃ TẠI QUẦY (break-glass khi ZNS chết).
 *
 * Khác `requestOtp` ở đúng hai điểm, và cả hai đều có chủ đích:
 *   · KHÔNG gửi đi đâu cả — nhân viên đọc mã cho phụ huynh nghe. Vì vậy ghi
 *     `channel: OFFLINE` để `/admin/otp-logs` và SLO không đếm nhầm là tin đã gửi.
 *   · TRẢ VỀ mã ở dạng chữ. Đây là ngoại lệ duy nhất của nguyên tắc "mã chỉ tồn
 *     tại ở dạng hash" — nên nó KHÔNG được để lộ ra đường công khai. Nơi gọi bắt
 *     buộc là Server Action đã `assertCan` + ghi audit kèm LÝ DO (xem
 *     students/_actions.ts). Hàm này cố tình không tự kiểm quyền: kiểm ở đây thì
 *     người đọc dễ tưởng đã an toàn rồi và bỏ qua audit.
 *
 * Vẫn đi qua cooldown + hạn mức ngày như đường thường: cấp tay không phải là cớ
 * để phát mã không giới hạn. KHÔNG chạm trần chi phí toàn hệ thống (không tốn tin).
 */
export async function issueOfflineOtp(input: {
  target: string;
  purpose: OtpPurposeKey;
  userId?: string | null;
}): Promise<{ ok: true; code: string; expiresAt: Date } | { ok: false; error: string }> {
  const target = normalizeOtpTarget(input.target);
  if (!target) return { ok: false, error: "Thiếu email/SĐT" };

  const [ttlMinutes, cooldownSec, dailyLimit, maxAttempts] = await Promise.all([
    getSetting("otp.ttlMinutes"),
    getSetting("otp.resendCooldownSec"),
    getSetting("otp.dailyLimit"),
    getSetting("otp.maxAttempts"),
  ]);

  const last = await db.otpRequest.findFirst({
    where: { target, purpose: input.purpose },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last) {
    const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
    if (elapsed < cooldownSec) {
      return { ok: false, error: `Vui lòng chờ ${Math.ceil(cooldownSec - elapsed)}s trước khi cấp mã mới.` };
    }
  }

  const todayCount = await db.otpRequest.count({
    where: { target, purpose: input.purpose, createdAt: { gte: startOfToday() } },
  });
  if (todayCount >= dailyLimit) {
    return { ok: false, error: "Số này đã vượt số lần cấp mã trong ngày." };
  }

  const code = genCode();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  const otp = await db.otpRequest.create({
    data: {
      target,
      channel: "OFFLINE",
      purpose: input.purpose,
      codeHash: hashCode(code),
      expiresAt,
      maxAttempts,
      userId: input.userId ?? null,
    },
    select: { id: true },
  });

  // Ghi delivery log để màn OTP tra cứu thấy đủ vòng đời; status SENT ở đây nghĩa
  // là "đã trao tận tay", không phải "đã gửi qua kênh nào".
  await db.otpDeliveryLog
    .create({
      data: {
        otpRequestId: otp.id,
        channel: "OFFLINE",
        target,
        provider: "counter-staff",
        status: "SENT",
      },
    })
    .catch(() => {});

  return { ok: true, code, expiresAt };
}
