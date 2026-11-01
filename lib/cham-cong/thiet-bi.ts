// lib/cham-cong/thiet-bi.ts — THIẾT BỊ CHẤM CÔNG (P2.3, 11/10/2026). Đường đọc/ghi DB.
//
// Định danh = khoá ngẫu nhiên 32 byte máy chủ cấp, sống trong cookie httpOnly của trình duyệt; DB chỉ giữ
// BĂM SHA-256 (`keyHash`). Không dùng fingerprint: fingerprint đổi khi trình duyệt cập nhật và trùng giữa hai
// máy cùng đời — vừa chặn oan vừa thả lọt. Cookie bị xoá ⇒ máy hiện như máy MỚI (chờ duyệt), không bao giờ
// thành máy của người khác.
//
// Luật cho/chặn ở `thiet-bi-thuan.ts`. Ở đây: đăng ký dưới khoá theo người (hai máy đầu tiên chấm cùng lúc
// không thể cùng thành "tin cậy"), audit mọi thao tác quản lý.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { getSetting } from "@/lib/settings/service";
import {
  biDatLai,
  CHE_DO_THIET_BI,
  chuyenThietBi,
  daDatLai,
  TIEN_TO_DA_DAT_LAI,
  nhanThietBi,
  thongBaoDatLai,
  quyetDinhThietBi,
  trangThaiKhiDangKy,
  type CheDoThietBi,
  type HanhDongThietBi,
  type QuyetDinhThietBi,
  type TrangThaiThietBi,
} from "./thiet-bi-thuan";

/** Tên cookie giữ khoá thiết bị. */
export const COOKIE_THIET_BI = "sr_tbcc";

export const taoKhoaThietBi = () => randomBytes(32).toString("base64url");
export const bamKhoa = (khoa: string) => createHash("sha256").update(`thiet-bi:${khoa}`).digest("hex");
/** Khoá hợp lệ về HÌNH DẠNG (43 ký tự base64url) — chuỗi lạ trong cookie không được đi vào DB. */
export const laKhoaHopLe = (khoa: string | null | undefined): khoa is string => !!khoa && /^[A-Za-z0-9_-]{43}$/.test(khoa);

export type CauHinhThietBi = { cheDo: CheDoThietBi; toiDa: number; tuTinCayDauTien: boolean; choPhepKhanCap: boolean };

export async function docCauHinhThietBi(): Promise<CauHinhThietBi> {
  const [cheDo, toiDa, tuTinCayDauTien, choPhepKhanCap] = await Promise.all([
    getSetting("shift.thietBiCheDo"),
    getSetting("shift.thietBiToiDa"),
    getSetting("shift.thietBiTuTinCayDauTien"),
    getSetting("shift.thietBiChoPhepKhanCap"),
  ]);
  // Giá trị lạ (sửa tay trong DB) ⇒ OFF: không chặn ai còn hơn chặn cả công ty vì một chữ gõ sai.
  const cd = (CHE_DO_THIET_BI as readonly string[]).includes(cheDo) ? (cheDo as CheDoThietBi) : "OFF";
  return { cheDo: cd, toiDa, tuTinCayDauTien, choPhepKhanCap };
}

/** Khoá tư vấn theo người — đăng ký / đổi trạng thái / đặt lại thiết bị của MỘT người đi tuần tự. */
export async function khoaNguoi(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`thiet-bi:${userId}`}))`;
}

/**
 * Lúc chấm công: tìm (hoặc đăng ký) thiết bị của người này theo khoá cookie, cập nhật `lastUsedAt`, và
 * quyết định cho/chặn theo chế độ. Chế độ OFF thì nơi gọi KHÔNG được gọi hàm này (không đụng DB).
 */
export async function kiemThietBiKhiCham(input: {
  userId: string;
  khoa: string;
  userAgent: string | null;
  cauHinh: CauHinhThietBi;
  now: Date;
}): Promise<{ staffDeviceId: string; trangThai: TrangThaiThietBi; moi: boolean; quyetDinh: QuyetDinhThietBi }> {
  const keyHash = bamKhoa(input.khoa);
  return db.$transaction(async (tx) => {
    await khoaNguoi(tx, input.userId);
    const co = await tx.staffDevice.findUnique({ where: { userId_keyHash: { userId: input.userId, keyHash } }, select: { id: true, status: true } });
    let id: string;
    let trangThai: TrangThaiThietBi;
    let moi = false;
    if (co) {
      id = co.id;
      trangThai = co.status;
      await tx.staffDevice.update({ where: { id }, data: { lastUsedAt: input.now, userAgent: input.userAgent } });
    } else {
      const soDangTinCay = await tx.staffDevice.count({ where: { userId: input.userId, status: "TRUSTED" } });
      trangThai = trangThaiKhiDangKy({ soDangTinCay, tuTinCayDauTien: input.cauHinh.tuTinCayDauTien });
      const nhan = nhanThietBi(input.userAgent);
      const tao = await tx.staffDevice.create({
        data: {
          userId: input.userId,
          keyHash,
          deviceName: nhan.deviceName,
          platform: nhan.platform,
          userAgent: input.userAgent,
          status: trangThai,
          registeredAt: input.now,
          lastUsedAt: input.now,
          ...(trangThai === "TRUSTED" ? { trustedAt: input.now } : {}),
        },
        select: { id: true },
      });
      id = tao.id;
      moi = true;
    }
    return {
      staffDeviceId: id,
      trangThai,
      moi,
      quyetDinh: quyetDinhThietBi({ cheDo: input.cauHinh.cheDo, trangThai, choPhepKhanCap: input.cauHinh.choPhepKhanCap }),
    };
  });
}

type Actor = { id: string; name: string };

/** Quản lý duyệt / thu hồi / báo mất một thiết bị. Quyền (`hr_attendance:device-reset` tại khối của người đó) do ACTION kiểm. */
export async function doiTrangThaiThietBi(input: {
  id: string;
  hanhDong: HanhDongThietBi;
  lyDo: string;
  toiDa: number;
  actor: Actor;
  now: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const lyDo = input.lyDo.trim();
  if (input.hanhDong !== "TIN_CAY" && lyDo.length < 5) return { ok: false, error: "Ghi lý do (tối thiểu 5 ký tự)" };
  const tb = await db.staffDevice.findUnique({ where: { id: input.id }, select: { id: true, userId: true, status: true, keyHash: true } });
  if (!tb) return { ok: false, error: "Không tìm thấy thiết bị" };
  if (daDatLai(tb.keyHash)) return { ok: false, error: "Máy này đã được đặt lại — không còn gắn với trình duyệt nào" };
  return db.$transaction(async (tx) => {
    await khoaNguoi(tx, tb.userId);
    const hienTai = await tx.staffDevice.findUniqueOrThrow({ where: { id: tb.id }, select: { status: true } });
    const soDangTinCay = await tx.staffDevice.count({ where: { userId: tb.userId, status: "TRUSTED" } });
    const kq = chuyenThietBi({ hienTai: hienTai.status, hanhDong: input.hanhDong, soDangTinCay, toiDa: input.toiDa });
    if (!kq.ok) return kq; // trước phép ghi đầu tiên
    await tx.staffDevice.update({
      where: { id: tb.id },
      data:
        kq.den === "TRUSTED"
          ? { status: "TRUSTED", trustedAt: input.now, trustedById: input.actor.id }
          : { status: kq.den, revokedAt: input.now, revokedById: input.actor.id, revokeReason: lyDo },
    });
    await writeAudit({
      actor: input.actor,
      module: "hr_attendance",
      entityType: "StaffDevice",
      entityId: tb.id,
      action: `DEVICE_${input.hanhDong}`,
      oldValues: { status: hienTai.status, userId: tb.userId },
      newValues: { status: kq.den },
      reason: lyDo || undefined,
      tx,
    });
    return { ok: true as const };
  });
}

/**
 * ĐẶT LẠI một người: THÁO khoá khỏi mọi máy không báo mất (`biDatLai`) ⇒ trình duyệt nào của họ chấm lần tới cũng
 * đăng ký như máy MỚI (máy đầu tự tin cậy nếu bật). Máy còn hiệu lực chuyển REVOKED; máy đã thu hồi giữ nguyên lý do cũ,
 * chỉ bị tháo khoá. Máy BÁO MẤT giữ khoá ⇒ vẫn bị chặn. Lý do bắt buộc, có audit.
 */
export async function datLaiThietBi(input: {
  userId: string;
  lyDo: string;
  actor: Actor;
  now: Date;
}): Promise<{ ok: true; soMay: number; soBaoMat: number; note: string } | { ok: false; error: string }> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, error: "Ghi lý do đặt lại (tối thiểu 5 ký tự)" };
  return db.$transaction(async (tx) => {
    await khoaNguoi(tx, input.userId);
    const tatCa = await tx.staffDevice.findMany({ where: { userId: input.userId }, select: { id: true, status: true, keyHash: true } });
    const may = tatCa.filter(biDatLai);
    const soBaoMat = tatCa.filter((m) => m.status === "LOST").length;
    // D-04: chỉ còn máy BÁO MẤT (hoặc không còn gì) ⇒ từ chối TRƯỚC phép ghi đầu tiên — không audit một lần đặt lại không xảy ra.
    const bao = thongBaoDatLai({ soMay: may.length, soBaoMat });
    if (!bao.ok) return bao;
    for (const m of may) {
      await tx.staffDevice.update({
        where: { id: m.id },
        data:
          m.status === "REVOKED"
            ? { keyHash: `${TIEN_TO_DA_DAT_LAI}${m.id}` }
            : { keyHash: `${TIEN_TO_DA_DAT_LAI}${m.id}`, status: "REVOKED", revokedAt: input.now, revokedById: input.actor.id, revokeReason: `Đặt lại: ${lyDo}` },
      });
    }
    await writeAudit({
      actor: input.actor,
      module: "hr_attendance",
      entityType: "StaffDevice",
      entityId: input.userId,
      action: "DEVICE_RESET",
      newValues: { soMayThaoKhoa: may.length, soMayBaoMatGiuNguyen: soBaoMat },
      reason: lyDo,
      tx,
    });
    return { ok: true as const, soMay: may.length, soBaoMat, note: bao.note };
  });
}

export function danhSachThietBi(userIds: readonly string[]) {
  if (userIds.length === 0) return Promise.resolve([]);
  return db.staffDevice.findMany({
    where: { userId: { in: [...userIds] } },
    orderBy: [{ status: "asc" }, { lastUsedAt: "desc" }],
    select: { id: true, userId: true, deviceName: true, platform: true, status: true, registeredAt: true, lastUsedAt: true, revokeReason: true, keyHash: true },
  });
}

/** Ghi thiết bị lên VÉ vừa tiêu — cột `AttendanceTicket.deviceId` có từ L4 mà trước P2.3 chưa ai ghi. */
export async function ganThietBiVaoVe(ticketId: string, staffDeviceId: string): Promise<void> {
  await db.attendanceTicket.updateMany({ where: { id: ticketId }, data: { deviceId: staffDeviceId } });
}

/** Thiết bị thuộc ai — action kiểm quyền theo khối của NGƯỜI SỞ HỮU trước khi đổi trạng thái. */
export function chuCuaThietBi(id: string) {
  return db.staffDevice.findUnique({ where: { id }, select: { userId: true } });
}
