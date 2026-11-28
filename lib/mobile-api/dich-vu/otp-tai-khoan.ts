import bcrypt from "bcryptjs";
import { z } from "zod";
import { lyDoMatKhauYeu } from "@/lib/auth/mat-khau-yeu";
import { logUserAudit } from "@/lib/audit/log";
import { db } from "@/lib/db";
import { enqueueAccountActivated } from "@/lib/email/triggers";
import { publishEvent } from "@/lib/events/publish";
import { requestOtp, verifyAndConsumeOtp, type OtpPurposeKey } from "@/lib/otp/service";
import { canonicalPhone } from "@/lib/phone";
import { getSetting } from "@/lib/settings/service";
import { activationIdentifierSchema } from "@/lib/validators/auth";
import { LoiKhongDemDuoc, demMotKhoa } from "../xac-thuc/dem-lan-thu";
import { thuHoiMoiPhienDiDong } from "../xac-thuc/thu-hoi-hang-loat";
import { bamKhoaDem } from "../xac-thuc/token";
import { LoiApiMobile, laPhuHuynhThuan, type NguCanh } from "../xac-thuc/dich-vu";

/**
 * V8.45 — OTP KÍCH HOẠT / ĐẶT LẠI MẬT KHẨU cho app di động (W-CONTRACT CRITICAL-2).
 *
 * Bốn route mỏng nằm trên hai luồng web đã chạy (`app/(auth)/kich-hoat`, `app/(auth)/quen-mat-khau`) và CÙNG dịch vụ OTP (`lib/otp/service`):
 * cùng cooldown 60 s, hạn ngày, khoá sau N lần sai, kill-switch toàn hệ thống, kênh gửi (SĐT → Zalo ZNS, email → Resend).
 *
 * Khác web ở ba điểm có chủ đích:
 *  1. CHỈ phụ huynh thuần (`laPhuHuynhThuan`) — app này không phục vụ nhân viên; nhân viên được xử lý như «không tồn tại» (phản hồi chung).
 *  2. Mã lỗi ỔN ĐỊNH cho client (`OTP_INVALID` · `OTP_EXPIRED` · `OTP_TOO_MANY_ATTEMPTS` · `OTP_SERVICE_PAUSED`) thay vì câu tiếng Việt.
 *  3. Đặt lại mật khẩu THU HỒI mọi phiên di động trong CÙNG giao dịch (+ `tokenVersion + 1` như web ⇒ phiên web cũng chết).
 *
 * KHÔNG LỘ TÀI KHOẢN: «xin mã» luôn trả cùng một hình dạng `{choGuiLaiSau}` và cùng sàn thời gian (900 ms) dù tài khoản có/không/nhân viên/đã kích hoạt.
 * Chỉ lỗi TOÀN HỆ THỐNG (trần ngày / kill-switch) mới nói thật (`OTP_SERVICE_PAUSED`) vì nó không phụ thuộc người nhập. Tách mã khỏi mật khẩu mới là CẤM
 * (`verifyAndConsumeOtp` gộp kiểm + tiêu mã một thao tác nguyên tử — xem ghi chú ở `lib/otp/service.ts`): mã và mật khẩu đi CÙNG một yêu cầu.
 */

const PHUT = 60_000;
const GIO = 60 * PHUT;
/** Sàn thời gian phản hồi — chống oracle đo bằng đồng hồ (cùng hằng với web). */
const SAN_PHAN_HOI_MS = 900;

/** Giới hạn tần suất riêng của route di động (ngoài cooldown/hạn ngày của dịch vụ OTP). Đề xuất của A, chưa phải chính sách Owner. */
export const OTP_DI_DONG = {
  xinMa: { cuaSoMs: GIO, nguongDinhDanh: 5, nguongThietBi: 8 },
  xacNhan: { cuaSoMs: 15 * PHUT, nguongDinhDanh: 10, nguongIp: 40, nguongThietBi: 20 },
} as const;

export const xinMaSchema = z.object({
  dinhDanh: activationIdentifierSchema,
  /** Tuỳ chọn: mã thiết bị (UUID) — thêm một khoá đếm; vắng thì chỉ đếm theo IP + định danh. */
  maThietBi: z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "Mã thiết bị không hợp lệ").optional(),
});

export const xacNhanSchema = z.object({
  dinhDanh: activationIdentifierSchema,
  ma: z.string().trim().regex(/^\d{6}$/, "Mã gồm 6 chữ số"),
  matKhau: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(72, "Mật khẩu tối đa 72 ký tự"),
  maThietBi: xinMaSchema.shape.maThietBi,
});

export type PhanHoiXinMa = { choGuiLaiSau: number };
export type PhanHoiXacNhan = { daDatMatKhau: true };

function dieuKienTheoDinhDanh(dinhDanh: string): { phone: string } | { email: string } {
  const canonical = canonicalPhone(dinhDanh);
  return canonical ? { phone: canonical } : { email: dinhDanh };
}

async function chanTheoSan(batDau: number): Promise<void> {
  const con = SAN_PHAN_HOI_MS - (Date.now() - batDau);
  if (con > 0) await new Promise((r) => setTimeout(r, con));
}

/** Đếm một khoá; vượt trần ⇒ 429; không đếm được ⇒ 503 (KHÔNG cho qua). */
async function demHoacChan(khoa: string, nguong: number, cuaSoMs: number, now: Date): Promise<void> {
  try {
    const n = await demMotKhoa({ khoa: bamKhoaDem("otp-di-dong", khoa), now, cuaSoMs });
    if (n > nguong) throw new LoiApiMobile("RATE_LIMITED", 429, "Thử quá nhiều lần. Vui lòng chờ một lát rồi thử lại.", Math.ceil(cuaSoMs / 1000));
  } catch (e) {
    if (e instanceof LoiKhongDemDuoc) throw new LoiApiMobile("SERVER", 503, "Hệ thống đang bận. Vui lòng thử lại sau ít phút.", 30);
    throw e;
  }
}

async function xinMa(mucDich: Extract<OtpPurposeKey, "ACTIVATION" | "RESET">, input: z.infer<typeof xinMaSchema>, ctx: NguCanh): Promise<PhanHoiXinMa> {
  const batDau = Date.now();
  const [cooldownSec, ipToiDaMoiGio] = await Promise.all([getSetting("otp.resendCooldownSec"), getSetting("otp.ipMaxPerHour")]);
  const nhom = mucDich === "ACTIVATION" ? "kich-hoat" : "dat-lai";

  // Ba khoá đếm, ĐỀU không phụ thuộc tài khoản có tồn tại ⇒ không thành oracle.
  await demHoacChan(`${nhom}:xin:ip:${ctx.ip}`, ipToiDaMoiGio, GIO, ctx.now);
  await demHoacChan(`${nhom}:xin:id:${input.dinhDanh}`, OTP_DI_DONG.xinMa.nguongDinhDanh, OTP_DI_DONG.xinMa.cuaSoMs, ctx.now);
  if (input.maThietBi) await demHoacChan(`${nhom}:xin:tb:${input.maThietBi}`, OTP_DI_DONG.xinMa.nguongThietBi, OTP_DI_DONG.xinMa.cuaSoMs, ctx.now);

  const chung: PhanHoiXinMa = { choGuiLaiSau: cooldownSec };
  const user = await db.user.findUnique({
    where: dieuKienTheoDinhDanh(input.dinhDanh),
    select: { id: true, accountStatus: true, deletedAt: true, isActive: true, role: true, roles: true },
  });
  // Trạng thái hợp lệ cho từng mục đích. Không hợp lệ ⇒ nuốt về phản hồi chung (đã kích hoạt / chưa kích hoạt / nhân viên / bị khoá).
  const hopLe =
    !!user && !user.deletedAt && laPhuHuynhThuan(user) && (mucDich === "ACTIVATION" ? user.accountStatus === "PENDING_ACTIVATION" : user.isActive && user.accountStatus === "ACTIVE");
  if (!hopLe) {
    await chanTheoSan(batDau);
    return chung;
  }

  const kq = await requestOtp({ target: input.dinhDanh, purpose: mucDich, userId: user.id });
  if (!kq.ok && kq.systemHalt) {
    await chanTheoSan(batDau);
    throw new LoiApiMobile("OTP_SERVICE_PAUSED", 503, "Dịch vụ gửi mã tạm dừng. Vui lòng liên hệ trung tâm hoặc thử lại sau.", 300);
  }
  if (!kq.ok) {
    // Cooldown / vượt hạn mức ngày của riêng số này / gửi hỏng: chỉ xảy ra với tài khoản CÓ THẬT ⇒ nuốt về phản hồi chung.
    console.warn(`[otp-di-dong:${nhom}] không gửi được cho user ${user.id}`);
    await chanTheoSan(batDau);
    return chung;
  }
  await logUserAudit({
    userId: user.id,
    action: "UPDATE",
    actorId: null,
    actorName: "Hệ thống (OTP di động)",
    changedFields: [mucDich === "ACTIVATION" ? "otpActivation" : "otpReset"],
    reason: mucDich === "ACTIVATION" ? "Gửi OTP kích hoạt tài khoản (app)" : "Gửi OTP đặt lại mật khẩu (app)",
  }).catch(() => {});
  await chanTheoSan(batDau);
  return chung;
}

/**
 * Chuyển câu chữ của `verifyAndConsumeOtp` thành MÃ ổn định. Dịch vụ OTP chỉ trả `error` tiếng Việt (+ `attemptsLeft`), nên phân loại theo cụm từ cố định;
 * lưới `[OTP-DD-*]` (Postgres thật) chạy đúng dịch vụ ấy cho từng nhánh ⇒ đổi câu chữ bên đó thì lưới đỏ, không im lặng rơi về `OTP_INVALID`.
 */
export function phanLoaiLoiOtp(loi: { error: string; attemptsLeft?: number }): LoiApiMobile {
  const t = loi.error.toLowerCase();
  if (t.includes("hết hạn")) return new LoiApiMobile("OTP_EXPIRED", 400, "Mã đã hết hạn. Vui lòng xin mã mới.");
  if (t.includes("quá số lần") || t.includes("đã khoá")) return new LoiApiMobile("OTP_TOO_MANY_ATTEMPTS", 429, "Đã nhập sai quá số lần cho phép. Vui lòng xin mã mới.", 60);
  const e = new LoiApiMobile("OTP_INVALID", 400, "Mã chưa đúng hoặc đã được dùng. Vui lòng kiểm tra lại hoặc xin mã mới.");
  if (typeof loi.attemptsLeft === "number") e.chiTiet = { conLai: loi.attemptsLeft };
  return e;
}

async function xacNhan(mucDich: Extract<OtpPurposeKey, "ACTIVATION" | "RESET">, input: z.infer<typeof xacNhanSchema>, ctx: NguCanh): Promise<PhanHoiXacNhan> {
  const nhom = mucDich === "ACTIVATION" ? "kich-hoat" : "dat-lai";
  await demHoacChan(`${nhom}:xn:ip:${ctx.ip}`, OTP_DI_DONG.xacNhan.nguongIp, OTP_DI_DONG.xacNhan.cuaSoMs, ctx.now);
  await demHoacChan(`${nhom}:xn:id:${input.dinhDanh}`, OTP_DI_DONG.xacNhan.nguongDinhDanh, OTP_DI_DONG.xacNhan.cuaSoMs, ctx.now);
  if (input.maThietBi) await demHoacChan(`${nhom}:xn:tb:${input.maThietBi}`, OTP_DI_DONG.xacNhan.nguongThietBi, OTP_DI_DONG.xacNhan.cuaSoMs, ctx.now);

  // SEC-12: mật khẩu quá yếu bị từ chối TRƯỚC khi tiêu mã OTP (người dùng không mất mã vì gõ mật khẩu yếu). Hàm chỉ nhìn chính mật khẩu + định danh đang xác thực (SĐT / email của mình) —
  // không chạm DB nên không lộ gì về tài khoản; ở sau cổng giới hạn tần suất ngay trên.
  const dinhDanhLaSdt = canonicalPhone(input.dinhDanh) !== null;
  const yeu = lyDoMatKhauYeu(input.matKhau, dinhDanhLaSdt ? { sdt: input.dinhDanh } : { email: input.dinhDanh });
  if (yeu) throw new LoiApiMobile("VALIDATION", 400, yeu, undefined, "MAT_KHAU_YEU");

  // Kiểm + tiêu mã TRƯỚC mọi câu trả lời phụ thuộc tài khoản: muốn chạm tới các thông điệp bên dưới phải có mã đúng.
  const v = await verifyAndConsumeOtp({ target: input.dinhDanh, purpose: mucDich, code: input.ma });
  if (!v.ok) throw phanLoaiLoiOtp(v);

  const user = await db.user.findUnique({
    where: dieuKienTheoDinhDanh(input.dinhDanh),
    select: { id: true, name: true, email: true, accountStatus: true, deletedAt: true, isActive: true, role: true, roles: true, children: { select: { name: true }, take: 1 } },
  });
  if (!user || user.deletedAt || !laPhuHuynhThuan(user)) {
    throw new LoiApiMobile("VALIDATION", 409, "Không thực hiện được. Vui lòng liên hệ trung tâm.", undefined, "TAI_KHOAN_KHONG_HOP_LE");
  }
  const bangSDT = canonicalPhone(input.dinhDanh) !== null;
  const bam = await bcrypt.hash(input.matKhau, 10);

  if (mucDich === "ACTIVATION") {
    if (user.accountStatus !== "PENDING_ACTIVATION") {
      throw new LoiApiMobile("VALIDATION", 409, "Tài khoản đã kích hoạt — vui lòng đăng nhập.", undefined, "DA_KICH_HOAT");
    }
    await db.user.update({
      where: { id: user.id },
      data: {
        password: bam,
        accountStatus: "ACTIVE",
        isActive: true,
        // Đánh dấu ĐÚNG kênh vừa chứng minh quyền sở hữu (như web P5): kích hoạt bằng SĐT mà set `emailVerified` là nói dối dữ liệu.
        ...(bangSDT ? { phoneVerifiedAt: ctx.now } : { emailVerified: ctx.now }),
      },
    });
    if (user.email) await enqueueAccountActivated({ to: user.email, parentName: user.name, childName: user.children[0]?.name ?? null }).catch(() => {});
    await publishEvent("account.activated", { userId: user.id }, { dedupeKey: `account.activated:${user.id}` }).catch(() => {});
    await logUserAudit({
      userId: user.id,
      action: "ENABLE",
      actorId: user.id,
      actorName: "Phụ huynh (kích hoạt qua app)",
      changedFields: ["accountStatus", "password"],
      reason: `Kích hoạt tài khoản qua OTP ${bangSDT ? "Zalo (SĐT)" : "email"} trên app`,
    }).catch(() => {});
    return { daDatMatKhau: true };
  }

  // RESET — tài khoản phải đang hoạt động.
  if (!user.isActive || user.accountStatus !== "ACTIVE") {
    throw new LoiApiMobile("VALIDATION", 409, "Không đặt lại được mật khẩu. Vui lòng liên hệ trung tâm.", undefined, "TAI_KHOAN_KHONG_HOP_LE");
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      // `tokenVersion + 1` ép đăng xuất mọi phiên WEB; thu hồi phiên di động ở dưới. Không có hai dòng này thì «đổi mật khẩu» không đuổi được ai.
      data: { password: bam, tokenVersion: { increment: 1 }, mustChangePassword: false },
    });
    await thuHoiMoiPhienDiDong(tx, user.id, "tai-khoan", { id: user.id, name: user.name ?? "Phụ huynh" }, ctx.now, "dat-lai-mat-khau-otp");
  });
  await logUserAudit({
    userId: user.id,
    action: "PASSWORD_RESET",
    actorId: user.id,
    actorName: "Phụ huynh (quên mật khẩu qua app)",
    changedFields: ["password", "tokenVersion"], // KHÔNG ghi giá trị cũ/mới — không để băm rơi vào kiểm toán
    reason: `Đặt lại mật khẩu qua OTP ${bangSDT ? "Zalo (SĐT)" : "email"} trên app`,
  }).catch(() => {});
  return { daDatMatKhau: true };
}

export const xinMaKichHoat = (input: z.infer<typeof xinMaSchema>, ctx: NguCanh) => xinMa("ACTIVATION", input, ctx);
export const xinMaDatLai = (input: z.infer<typeof xinMaSchema>, ctx: NguCanh) => xinMa("RESET", input, ctx);
export const kichHoatTaiKhoan = (input: z.infer<typeof xacNhanSchema>, ctx: NguCanh) => xacNhan("ACTIVATION", input, ctx);
export const datLaiMatKhau = (input: z.infer<typeof xacNhanSchema>, ctx: NguCanh) => xacNhan("RESET", input, ctx);
