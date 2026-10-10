import "server-only";
import { db } from "@/lib/db";
import { canonicalPhone } from "@/lib/phone";
import { requestOtp, verifyAndConsumeOtp } from "@/lib/otp/service";
import { logUserAudit } from "@/lib/audit/log";
import { describeOtpSendError } from "@/lib/otp/messages";

// =============================================================================
// AUTH-SĐT P6 — ĐỔI SỐ ĐIỆN THOẠI ĐĂNG NHẬP (có kiểm soát).
//
// Sau P5, `User.phone` là định danh đăng nhập (@unique) và là nơi nhận OTP. Vì
// vậy nó KHÔNG được nằm chung với các ô hồ sơ gõ tự do (trước P6, form hồ sơ
// portal ghi thẳng SĐT `max(20)` không chuẩn hoá xuống mọi Student của hộ).
// Luồng đúng gồm 2 bước:
//   1. Gửi OTP tới **SỐ MỚI** — mã tới được số đó chính là bằng chứng phụ huynh
//      đang cầm nó. Gửi tới số CŨ thì chỉ chứng minh cái đã biết, và ai chiếm
//      được phiên sẽ đổi được sang số bất kỳ.
//   2. Nhập mã → cập nhật `User.phone` + `phoneVerifiedAt` và ĐỒNG BỘ toàn bộ
//      `Student.parentPhone` trong CÙNG một transaction (một nguồn sự thật).
//
// Đặt ở `lib/` vì `app/(portal)/**` KHÔNG được import `@/lib/db` trần (ESLint),
// mà việc này phải tra/ghi bảng User của NGƯỜI KHÁC (kiểm trùng số) — ngoài phạm
// vi `portalDb` (nó lo cách ly dữ liệu học viên).
// =============================================================================

export type PhoneChangeResult = { ok: true; cooldownSec?: number } | { ok: false; error: string };

/** Chuẩn hoá + loại số cố định (ZNS không gửi vào số bàn, mà đây là số nhận OTP). */
function parseNewPhone(raw: string): string | null {
  return canonicalPhone(raw);
}

export async function requestParentPhoneChange(
  userId: string,
  rawPhone: string,
): Promise<PhoneChangeResult> {
  const newPhone = parseNewPhone(rawPhone);
  if (!newPhone) return { ok: false, error: "Số điện thoại di động không hợp lệ" };

  const me = await db.user.findUnique({ where: { id: userId }, select: { phone: true } });
  if (me?.phone === newPhone) return { ok: false, error: "Số mới trùng số hiện tại." };

  // Đụng `@unique` ở bước ghi thì đã tốn một tin ZNS rồi mới báo lỗi — chặn sớm.
  // Ở đây nói thật được: người dùng ĐÃ đăng nhập nên không phải oracle liệt kê.
  const taken = await db.user.findUnique({ where: { phone: newPhone }, select: { id: true } });
  if (taken) return { ok: false, error: "Số này đã dùng cho một tài khoản khác." };

  const res = await requestOtp({ target: newPhone, purpose: "CHANGE_CONTACT", userId });
  if (!res.ok) {
    // P6-D — không ném chuỗi kỹ thuật (`ZNS_NO_ZALO_ACCOUNT:ZNS_ERR_-118:…`) vào
    // mặt phụ huynh. Cooldown/hạn mức đã là câu tiếng Việt sẵn nên giữ nguyên;
    // chỉ dịch nhóm lỗi của kênh gửi.
    const raw = res.error ?? "";
    const advice = raw.includes("ZNS_") || raw.includes("ZALO_")
      ? describeOtpSendError(raw).message
      : raw || "Không gửi được mã. Thử lại sau.";
    return { ok: false, error: advice };
  }
  return { ok: true, cooldownSec: res.cooldownSec };
}

export async function confirmParentPhoneChange(
  userId: string,
  rawPhone: string,
  code: string,
): Promise<PhoneChangeResult> {
  const newPhone = parseNewPhone(rawPhone);
  if (!newPhone) return { ok: false, error: "Số điện thoại không hợp lệ" };
  if (!/^\d{6}$/.test(code.trim())) return { ok: false, error: "Mã gồm 6 chữ số" };

  const v = await verifyAndConsumeOtp({
    target: newPhone,
    purpose: "CHANGE_CONTACT",
    code: code.trim(),
  });
  if (!v.ok) return { ok: false, error: v.error ?? "Mã không đúng" };

  // Kiểm lại NGAY TRƯỚC khi ghi: giữa lúc gửi mã và lúc nhập mã, số kia có thể đã
  // bị chiếm (đường cấp tài khoản theo SĐT chạy song song).
  const taken = await db.user.findFirst({
    where: { phone: newPhone, id: { not: userId } },
    select: { id: true },
  });
  if (taken) return { ok: false, error: "Số này vừa được dùng cho tài khoản khác." };

  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { phone: newPhone, phoneVerifiedAt: new Date() },
      });
      // Đồng bộ trong CÙNG transaction — nửa vời ở đây đúng bằng cái lệch dữ liệu
      // mà P6 sinh ra để dập.
      await tx.student.updateMany({
        where: { parentUserId: userId, deletedAt: null },
        data: { parentPhone: newPhone },
      });
    });
  } catch {
    return { ok: false, error: "Không đổi được số điện thoại. Vui lòng thử lại." };
  }

  await logUserAudit({
    userId,
    action: "UPDATE",
    actorId: userId,
    actorName: "Phụ huynh (tự đổi SĐT)",
    changedFields: ["phone", "phoneVerifiedAt"],
    reason: "Đổi SĐT đăng nhập qua OTP CHANGE_CONTACT",
  }).catch(() => {});

  return { ok: true };
}
