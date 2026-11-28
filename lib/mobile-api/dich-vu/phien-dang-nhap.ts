import { z } from "zod";

import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";

import { LoiApiMobile, thuHoi, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * V8.45 — QUẢN LÝ PHIÊN ĐĂNG NHẬP (SEC-05, MASVS-AUTH): xem các thiết bị đang đăng nhập, thu hồi MỘT phiên từ xa, đăng xuất MỌI thiết bị.
 * Trước đây chỉ có đăng xuất thiết bị hiện tại và đổi mật khẩu ⇒ mất điện thoại mà không đổi mật khẩu thì phiên bị mất vẫn sống tới 30 ngày không dùng.
 *
 *  · MỌI phép thu hồi đi qua `thuHoi` (`xac-thuc/dich-vu.ts`) — MỘT điểm thu hồi duy nhất (xoá bốn cột token + thu hồi token push của phiên). Lý do ghi `nguoi-dung-thu-hoi`.
 *  · Chỉ phiên của CHÍNH người gọi: id phiên của người khác / không có ⇒ 404 (không lộ id nào tồn tại). Phiên đã thu hồi ⇒ vẫn 200 (idempotent).
 *  · Chế độ học sinh: các route này KHÔNG nằm trong danh sách cho phép ⇒ trẻ cầm máy ba mẹ không thu hồi được phiên của ba mẹ.
 *  · Kiểm toán ghi SỐ phiên + id dòng phiên; KHÔNG ghi token, băm, mã tra.
 *  · DTO KHÔNG có `maTra`, băm hay IP — chỉ thứ người dùng nhận ra một thiết bị: nền tảng, tên máy, phiên bản app, lần dùng cuối.
 */
export const dangXuatTatCaSchema = z.object({ giuPhienHienTai: z.boolean().optional() });
export type DangXuatTatCaBody = z.infer<typeof dangXuatTatCaSchema>;

export type PhienDto = {
  id: string;
  nenTang: string;
  tenMay: string | null;
  phienBanApp: string | null;
  dangNhapLuc: string;
  lanDungCuoi: string | null;
  laThietBiNay: boolean;
};

const conSong = (now: Date) => ({ thuHoiLuc: null, hetHanKhongDung: { gt: now }, hetHanTuyetDoi: { gt: now } });

export async function danhSachPhien(nguoi: NguoiGoi, now: Date): Promise<{ phien: PhienDto[] }> {
  const ds = await db.mobileSession.findMany({
    where: { userId: nguoi.userId, ...conSong(now) },
    select: { id: true, nenTang: true, tenMay: true, phienBanApp: true, createdAt: true, lanDungCuoi: true },
    orderBy: [{ lanDungCuoi: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return {
    phien: ds.map((p) => ({
      id: p.id,
      nenTang: p.nenTang,
      tenMay: p.tenMay,
      phienBanApp: p.phienBanApp,
      dangNhapLuc: p.createdAt.toISOString(),
      lanDungCuoi: p.lanDungCuoi ? p.lanDungCuoi.toISOString() : null,
      laThietBiNay: p.id === nguoi.sessionId,
    })),
  };
}

export async function thuHoiMotPhien(nguoi: NguoiGoi, sessionId: string, ctx: { ip: string; now: Date }): Promise<{ daThuHoi: true; laThietBiNay: boolean }> {
  const p = await db.mobileSession.findFirst({ where: { id: sessionId, userId: nguoi.userId }, select: { id: true } });
  if (!p) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy phiên đăng nhập này.");
  await db.$transaction(async (tx) => {
    if (await thuHoi(tx, p.id, "nguoi-dung-thu-hoi", ctx.now)) {
      await writeAudit({ actor: { id: nguoi.userId, name: "Phụ huynh (app)" }, module: "mobile-auth", entityType: "MobileSession", entityId: p.id, action: "SESSION_REVOKED", newValues: { lyDo: "nguoi-dung-thu-hoi" }, ip: ctx.ip, tx });
    }
  });
  return { daThuHoi: true, laThietBiNay: p.id === nguoi.sessionId };
}

export async function dangXuatTatCa(nguoi: NguoiGoi, body: DangXuatTatCaBody, ctx: { ip: string; now: Date }): Promise<{ soPhienThuHoi: number; giuPhienHienTai: boolean }> {
  const giu = body.giuPhienHienTai === true;
  const dich = await db.mobileSession.findMany({
    where: { userId: nguoi.userId, thuHoiLuc: null, ...(giu ? { id: { not: nguoi.sessionId } } : {}) },
    select: { id: true },
  });
  let so = 0;
  await db.$transaction(async (tx) => {
    for (const p of dich) if (await thuHoi(tx, p.id, "nguoi-dung-thu-hoi", ctx.now)) so++;
    if (so > 0) {
      await writeAudit({ actor: { id: nguoi.userId, name: "Phụ huynh (app)" }, module: "mobile-auth", entityType: "User", entityId: nguoi.userId, action: "mobile.sessions_revoked", newValues: { lyDo: "dang-xuat-tat-ca", soPhien: so, giuPhienHienTai: giu }, ip: ctx.ip, tx });
    }
  });
  return { soPhienThuHoi: so, giuPhienHienTai: giu };
}
