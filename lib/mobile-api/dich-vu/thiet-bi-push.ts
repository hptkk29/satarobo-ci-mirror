import { z } from "zod";

import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";

import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * V8.1 — SỔ TOKEN PUSH + TUỲ CHỌN THÔNG BÁO của app (phụ huynh). ⛔ CHƯA có nhà cung cấp FCM/APNs nào được nối ⇒ KHÔNG có dòng nào ở đây nghĩa là «đã gửi push»;
 * đây chỉ là sổ đăng ký để khi cấu hình được duyệt thì có chỗ gửi. Không gửi dữ liệu học viên tới bên ngoài.
 *
 *   · Token gắn với PHIÊN (`MobileSession`). Phiên bị thu hồi (đăng xuất · đổi mật khẩu · hết hạn · tài khoản khoá) ⇒ token bị thu hồi CÙNG (`thuHoi` gọi `thuHoiTokenCuaPhien`).
 *   · MỘT token chỉ thuộc MỘT phiên: đăng ký lại token đã có ⇒ chuyển sang phiên hiện tại (thiết bị đổi tài khoản); cùng phiên chỉ giữ token MỚI NHẤT.
 *     SEC-14 (V8.45): token đang SỐNG của NGƯỜI KHÁC chỉ được chuyển khi (a) phiên giữ nó đã chết (thu hồi / quá hạn) HOẶC (b) cùng THIẾT BỊ (`maThietBi` của hai phiên trùng — chính máy đó đổi tài khoản). Còn lại ⇒ KHÔNG chuyển, vẫn trả `DA_DANG_KY` (không cho dò «token này có người dùng») + kiểm toán không chứa token.
 *   · Tối đa 5 token SỐNG mỗi phụ huynh (cũ nhất bị thu hồi `vuot-han-muc`).
 *   · Phiên CHẾ ĐỘ HỌC SINH không đăng ký / xoá token (không có trong allow-list H-S3); khi có bộ gửi, bộ gửi PHẢI bỏ qua phiên có `hocSinhId` (thông báo của ba mẹ không hiện trên máy của con).
 *   · Token là bí mật vận hành: KHÔNG ghi log, KHÔNG ghi kiểm toán, KHÔNG trả lại trong phản hồi.
 */
export const DANH_MUC_PUSH = ["NHAN_XET", "HOC_BU", "HOC_BA", "KHAO_SAT", "THONG_BAO"] as const;
export type DanhMucPush = (typeof DANH_MUC_PUSH)[number];
const TOI_DA_TOKEN_SONG = 5;

export const dangKyTokenSchema = z
  .object({
    nenTang: z.enum(["ios", "android"]),
    nhaCungCap: z.enum(["FCM", "APNS"]),
    token: z
      .string()
      .trim()
      .min(20, "Token không hợp lệ.")
      .max(4096, "Token không hợp lệ.")
      .regex(/^[\x21-\x7e]+$/, "Token không hợp lệ."),
    phienBanApp: z.string().trim().max(32).optional(),
  })
  .strict()
  .refine((v) => !(v.nenTang === "android" && v.nhaCungCap === "APNS"), { message: "Android không dùng APNS.", path: ["nhaCungCap"] });
export type DangKyTokenBody = z.infer<typeof dangKyTokenSchema>;

export const huyTokenSchema = z.object({ token: z.string().trim().min(20).max(4096) }).strict();
export type HuyTokenBody = z.infer<typeof huyTokenSchema>;

export const tuyChonSchema = z
  .object({ tuyChon: z.array(z.object({ danhMuc: z.enum(DANH_MUC_PUSH), bat: z.boolean() }).strict()).min(1).max(DANH_MUC_PUSH.length) })
  .strict()
  .refine((v) => new Set(v.tuyChon.map((t) => t.danhMuc)).size === v.tuyChon.length, { message: "Danh mục bị lặp.", path: ["tuyChon"] });
export type TuyChonBody = z.infer<typeof tuyChonSchema>;

export async function dangKyPushToken(nguoi: NguoiGoi, body: DangKyTokenBody, now: Date = new Date()): Promise<{ trangThai: "DA_DANG_KY" }> {
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh."); // phòng thủ thêm; allow-list đã chặn từ trước
  const biChan = await db.$transaction(async (tx) => {
    // SEC-14: không cho CHIẾM token đang sống của người khác (xem đầu tệp). Quyết TRƯỚC mọi phép ghi — bị chặn thì không đổi gì (kể cả không xoay vòng token cũ của người gọi).
    const cu = await tx.mobilePushToken.findUnique({
      where: { token: body.token },
      select: { userId: true, thuHoiLuc: true, mobileSession: { select: { thuHoiLuc: true, hetHanKhongDung: true, hetHanTuyetDoi: true, maThietBi: true } } },
    });
    if (cu && cu.userId !== nguoi.userId && cu.thuHoiLuc === null) {
      const phienCuChet = cu.mobileSession.thuHoiLuc !== null || cu.mobileSession.hetHanKhongDung <= now || cu.mobileSession.hetHanTuyetDoi <= now;
      const toi = await tx.mobileSession.findUnique({ where: { id: nguoi.sessionId }, select: { maThietBi: true } });
      const cungMay = !!toi && cu.mobileSession.maThietBi === toi.maThietBi;
      if (!phienCuChet && !cungMay) return true;
    }
    // Cùng phiên chỉ giữ token MỚI NHẤT (xoay vòng token): thu hồi token cũ khác của phiên này.
    await tx.mobilePushToken.updateMany({ where: { mobileSessionId: nguoi.sessionId, thuHoiLuc: null, token: { not: body.token } }, data: { thuHoiLuc: now, lyDoThuHoi: "thay-token" } });
    await tx.mobilePushToken.upsert({
      where: { token: body.token },
      create: { userId: nguoi.userId, mobileSessionId: nguoi.sessionId, nenTang: body.nenTang, nhaCungCap: body.nhaCungCap, token: body.token, phienBanApp: body.phienBanApp ?? null, lanDangKyCuoi: now },
      // Token đã có (kể cả của người/phiên khác trên cùng máy): CHUYỂN về phiên hiện tại, bỏ cờ thu hồi.
      update: { userId: nguoi.userId, mobileSessionId: nguoi.sessionId, nenTang: body.nenTang, nhaCungCap: body.nhaCungCap, phienBanApp: body.phienBanApp ?? null, lanDangKyCuoi: now, thuHoiLuc: null, lyDoThuHoi: null },
    });
    const song = await tx.mobilePushToken.findMany({ where: { userId: nguoi.userId, thuHoiLuc: null }, orderBy: [{ lanDangKyCuoi: "desc" }, { id: "asc" }], select: { id: true } });
    const thua = song.slice(TOI_DA_TOKEN_SONG).map((t) => t.id);
    if (thua.length > 0) await tx.mobilePushToken.updateMany({ where: { id: { in: thua } }, data: { thuHoiLuc: now, lyDoThuHoi: "vuot-han-muc" } });
    return false;
  });
  // Bị chặn: ghi dấu (KHÔNG chứa token) rồi trả ĐÚNG câu trả lời như thành công — kẻ gọi không biết token có đang được dùng hay không.
  if (biChan) {
    await writeAudit({ actor: { id: nguoi.userId, name: "Phụ huynh (app)" }, module: "mobile-auth", entityType: "User", entityId: nguoi.userId, action: "mobile.push_token_takeover_blocked", newValues: { nenTang: body.nenTang }, ip: null }).catch(() => undefined);
  }
  return { trangThai: "DA_DANG_KY" };
}

/** Chỉ thu hồi token CỦA CHÍNH người gọi; token lạ / của người khác ⇒ vẫn trả bình thường (không dò được sự tồn tại). */
export async function huyPushToken(nguoi: NguoiGoi, body: HuyTokenBody, now: Date = new Date()): Promise<{ trangThai: "DA_HUY" }> {
  await db.mobilePushToken.updateMany({ where: { token: body.token, userId: nguoi.userId, thuHoiLuc: null }, data: { thuHoiLuc: now, lyDoThuHoi: "nguoi-dung-huy" } });
  return { trangThai: "DA_HUY" };
}

export type TuyChonDto = { tuyChon: Array<{ danhMuc: DanhMucPush; bat: boolean }> };
export async function layTuyChonThongBao(userId: string): Promise<TuyChonDto> {
  const rows = await db.mobileNotificationPref.findMany({ where: { userId }, select: { danhMuc: true, bat: true } });
  const m = new Map(rows.map((r) => [r.danhMuc, r.bat]));
  return { tuyChon: DANH_MUC_PUSH.map((d) => ({ danhMuc: d, bat: m.get(d) ?? true })) };
}
export async function datTuyChonThongBao(userId: string, body: TuyChonBody): Promise<TuyChonDto> {
  await db.$transaction(
    body.tuyChon.map((t) => db.mobileNotificationPref.upsert({ where: { userId_danhMuc: { userId, danhMuc: t.danhMuc } }, create: { userId, danhMuc: t.danhMuc, bat: t.bat }, update: { bat: t.bat } })),
  );
  return layTuyChonThongBao(userId);
}
