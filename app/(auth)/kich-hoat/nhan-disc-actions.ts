"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDiscEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { getRequestMetadata } from "@/lib/audit/headers";
import { getSetting } from "@/lib/settings/service";
import { canonicalPhone } from "@/lib/phone";
import { nhanBaiDisc, yeuCauOtpNhan, type PhienDangNhap } from "@/lib/disc/nhan";
import { gopIpChoGioiHan } from "@/lib/disc/phone-key";
import { taoNhanDeps } from "@/lib/disc/nhan-prisma";

// Nhánh "nhận bài DISC" của /kich-hoat. KHÔNG đổi hành vi requestActivationOtp/activateAccount cho khách cũ
// (hai hàm đó nằm ở ./_actions.ts, không bị chạm tới).

type KetQuaYeuCau = { ok: boolean; error?: string; cooldownSec?: number };
type KetQuaNhan = { ok: boolean; error?: string; canDangNhap?: boolean; submissionId?: string };

// Cùng sàn thời gian với luồng kích hoạt cũ: nhánh "có bài" gọi provider (chậm), nhánh "không có" thì tức thì.
const MIN_RESPONSE_MS = 900;
async function padTiming(startedAt: number): Promise<void> {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

/** Phiên đăng nhập (nếu có) → SĐT của tài khoản đó, để dịch vụ so với SĐT đang nhận. */
async function docPhien(): Promise<PhienDangNhap | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const u = await db.user.findUnique({ where: { id: session.user.id }, select: { phone: true } });
  // N11: chuẩn hoá về 84… để so với sdtChuan (User đời cũ có thể còn dạng 0…); không chuẩn hoá được ⇒ giữ nguyên (sẽ không khớp, fail-closed).
  return { userId: session.user.id, phoneKey: u?.phone ? (canonicalPhone(u.phone) ?? u.phone) : null };
}

/** Bước 1 — xin OTP nhận bài. Phản hồi đồng nhất theo SĐT (xem `yeuCauOtpNhan`). */
export async function requestDiscClaimOtp(rawPhone: string): Promise<KetQuaYeuCau> {
  const startedAt = Date.now();
  if (!isDiscEnabled()) return { ok: false, error: "Tính năng chưa mở" };
  if (typeof rawPhone !== "string" || !canonicalPhone(rawPhone)) return { ok: false, error: "Số điện thoại không hợp lệ" };

  const [cooldownSec, ipMaxPerHour] = await Promise.all([getSetting("otp.resendCooldownSec"), getSetting("otp.ipMaxPerHour")]);
  const { ip } = await getRequestMetadata();
  // Trần theo IP (kẻ bơm yêu cầu nhiều số). Trần theo SỐ theo NGÀY nằm trong `yeuCauOtpNhan` (chỉ tính khi thật sự sắp gửi).
  const rl = await rateLimit({ key: `otp:disc-claim:ip:${gopIpChoGioiHan(ip ?? "unknown")}`, max: ipMaxPerHour, windowMs: 60 * 60_000 });
  if (!rl.success) {
    await padTiming(startedAt);
    return { ok: false, error: "Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau 1 giờ." };
  }

  const phien = await docPhien();
  const r = await yeuCauOtpNhan({ soDienThoai: rawPhone, cooldownMacDinhSec: cooldownSec, phien, deps: taoNhanDeps() });
  await padTiming(startedAt);
  return r.ok ? { ok: true, cooldownSec: r.cooldownSec } : { ok: false, error: r.thongBao };
}

/** Bước 2 — OTP + mã nhận + năm sinh của con (+ mật khẩu nếu chưa đăng nhập) ⇒ gắn bài. */
export async function claimDiscResult(input: {
  soDienThoai: string;
  otp: string;
  maNhan: string;
  namSinhCon: string;
  matKhau?: string;
  /** Ô tích riêng của chủ số (N7): đồng ý nhận thông tin tiếp thị. Không tích/không khai ⇒ false. */
  dongYTiepThi?: boolean;
}): Promise<KetQuaNhan> {
  const startedAt = Date.now();
  if (!isDiscEnabled()) return { ok: false, error: "Tính năng chưa mở" };
  if (!input || typeof input.soDienThoai !== "string" || typeof input.otp !== "string") return { ok: false, error: "Dữ liệu không hợp lệ" };

  const { ip } = await getRequestMetadata();
  // Trần thử theo IP (chống quét nhiều SĐT); trần theo SĐT/bài nằm ở OTP service + bộ đếm trong store.
  const rl = await rateLimit({ key: `disc-claim:ip:${gopIpChoGioiHan(ip ?? "unknown")}`, max: 20, windowMs: 60 * 60_000 });
  if (!rl.success) {
    await padTiming(startedAt);
    return { ok: false, error: "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 1 giờ." };
  }

  const phien = await docPhien();
  const r = await nhanBaiDisc({
    soDienThoai: input.soDienThoai,
    otp: input.otp,
    maNhan: input.maNhan,
    namSinhCon: input.namSinhCon,
    matKhau: input.matKhau ?? null,
    dongYTiepThi: input.dongYTiepThi === true,
    phien,
    deps: taoNhanDeps(),
  });
  await padTiming(startedAt);
  if (r.ok) return { ok: true, submissionId: r.submissionId };
  return { ok: false, error: r.thongBao, canDangNhap: r.loi === "CAN_DANG_NHAP" };
}
