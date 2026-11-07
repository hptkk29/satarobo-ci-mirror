import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";

// lib/finance/hoa-don/ky-usb/may-ky.ts — GHÉP MÁY KÝ USB (hub/13 §5, phương án B). ⚠️ ĐÂY LÀ CREDENTIAL MỚI — phải được duyệt bảo mật trước khi bật cờ `hoaDon.kyUsb`.
//
//   1. Kế toán bấm «Ghép máy ký» trên màn ⇒ máy chủ cấp MÃ GHÉP dùng MỘT LẦN, sống 10 phút (hiện đúng một lần, chỉ lưu SHA-256).
//   2. Ứng dụng ký (Windows) gửi mã ⇒ nhận TOKEN MÁY (32 byte ngẫu nhiên, chỉ lưu SHA-256, trả đúng MỘT lần), sống 30 ngày, gắn với MỘT người dùng.
//   3. Mỗi lời gọi của ứng dụng mang token; máy chủ tra băm, rồi `resolveActor(userId)` LẠI — mất quyền kế toán ⇒ máy mất tác dụng ngay.
//   4. Thu hồi = xoá hai băm. Token không bao giờ vào log / nhật ký / thông điệp lỗi.

export const HAN_MA_GHEP_MS = 10 * 60 * 1000;
export const HAN_TOKEN_MAY_MS = 30 * 24 * 60 * 60 * 1000;
export const TOI_DA_MAY_MOI_NGUOI = 5;
export const TIEN_TO_TOKEN = "kmk_";
const NHIP_GHI_LAN_DUNG_MS = 60_000;

/** 32 ký tự không nhập nhằng (bỏ I, O, 0, 1): người đọc từ màn gõ vào máy khác không nhầm. 10 ký tự ⇒ 50 bit. */
const BANG_MA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DO_DAI_MA = 10;

export const bamBiMat = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export function sinhMaGhep(): string {
  let ma = "";
  for (let i = 0; i < DO_DAI_MA; i += 1) ma += BANG_MA[randomInt(BANG_MA.length)];
  return `${ma.slice(0, 5)}-${ma.slice(5)}`;
}

/** Chuẩn hoá mã người gõ (khoảng trắng, gạch, chữ thường). Sai khuôn ⇒ null. */
export function chuanHoaMaGhep(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (s.length !== DO_DAI_MA || [...s].some((c) => !BANG_MA.includes(c))) return null;
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export const sinhTokenMay = (): string => `${TIEN_TO_TOKEN}${randomBytes(32).toString("base64url")}`;
export const laKhuonTokenMay = (t: unknown): t is string => typeof t === "string" && /^kmk_[A-Za-z0-9_-]{43}$/.test(t);

export type TrangThaiMay = "CHO_GHEP" | "DANG_DUNG" | "HET_HAN" | "DA_THU_HOI";

export type DongMayKy = { id: string; tenMay: string; trangThai: TrangThaiMay; lanDungCuoi: string | null; hetHan: string | null };

function trangThai(m: { maGhepHash: string | null; maGhepHetHan: Date | null; tokenHash: string | null; tokenHetHan: Date | null; thuHoiLuc: Date | null }, now: Date): TrangThaiMay {
  if (m.thuHoiLuc) return "DA_THU_HOI";
  if (m.tokenHash) return m.tokenHetHan && m.tokenHetHan.getTime() > now.getTime() ? "DANG_DUNG" : "HET_HAN";
  if (m.maGhepHash) return m.maGhepHetHan && m.maGhepHetHan.getTime() > now.getTime() ? "CHO_GHEP" : "HET_HAN";
  return "HET_HAN";
}

export async function danhSachMayCuaToi(userId: string, now: Date): Promise<DongMayKy[]> {
  const ds = await db.hoaDonMayKy.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, tenMay: true, maGhepHash: true, maGhepHetHan: true, tokenHash: true, tokenHetHan: true, thuHoiLuc: true, lanDungCuoi: true },
  });
  return ds.map((m) => {
    const tt = trangThai(m, now);
    return { id: m.id, tenMay: m.tenMay, trangThai: tt, lanDungCuoi: m.lanDungCuoi?.toISOString() ?? null, hetHan: (m.tokenHash ? m.tokenHetHan : m.maGhepHetHan)?.toISOString() ?? null };
  });
}

export type KetQuaTaoMa = { ok: true; mayId: string; ma: string; hetHan: Date } | { ok: false; error: string };

/** Cấp mã ghép cho MỘT người dùng. Mã chỉ có trong kết quả này (hiện đúng một lần). */
export async function taoMaGhep(i: { userId: string; userName: string; tenMay: string; now: Date }): Promise<KetQuaTaoMa> {
  const ten = i.tenMay.trim();
  if (ten.length < 1 || ten.length > 60) return { ok: false, error: "Tên máy phải từ 1 đến 60 ký tự." };
  const hienCo = await db.hoaDonMayKy.findMany({
    where: { userId: i.userId, thuHoiLuc: null },
    select: { maGhepHash: true, maGhepHetHan: true, tokenHash: true, tokenHetHan: true, thuHoiLuc: true },
  });
  const dangSong = hienCo.filter((m) => {
    const t = trangThai(m, i.now);
    return t === "CHO_GHEP" || t === "DANG_DUNG";
  }).length;
  if (dangSong >= TOI_DA_MAY_MOI_NGUOI) return { ok: false, error: `Mỗi người ghép tối đa ${TOI_DA_MAY_MOI_NGUOI} máy — thu hồi bớt máy cũ trước.` };
  const ma = sinhMaGhep();
  const hetHan = new Date(i.now.getTime() + HAN_MA_GHEP_MS);
  const may = await db.$transaction(async (tx) => {
    const m = await tx.hoaDonMayKy.create({ data: { userId: i.userId, tenMay: ten, maGhepHash: bamBiMat(ma), maGhepHetHan: hetHan }, select: { id: true } });
    await writeAudit({ tx, actor: { id: i.userId, name: i.userName }, module: "hoa-don", entityType: "HoaDonMayKy", entityId: m.id, action: "CAP_MA_GHEP_MAY_KY", newValues: { tenMay: ten, hetHan: hetHan.toISOString() } });
    return m;
  });
  return { ok: true, mayId: may.id, ma, hetHan };
}

export type KetQuaDoiMa = { ok: true; token: string; hetHan: Date } | { ok: false };

/** Đổi mã ghép lấy token. Một lần: mã bị xoá ngay khi đổi (giành có điều kiện ⇒ hai lời gọi đồng thời chỉ một bên thắng). Mọi thất bại trả CÙNG một kết quả (không lộ mã sai hay hết hạn). */
export async function doiMaGhepLayToken(i: { ma: unknown; now: Date }): Promise<KetQuaDoiMa> {
  const ma = chuanHoaMaGhep(i.ma);
  if (!ma) return { ok: false };
  const bam = bamBiMat(ma);
  const token = sinhTokenMay();
  const hetHan = new Date(i.now.getTime() + HAN_TOKEN_MAY_MS);
  const r = await db.hoaDonMayKy.updateMany({
    where: { maGhepHash: bam, maGhepHetHan: { gt: i.now }, thuHoiLuc: null, tokenHash: null },
    data: { maGhepHash: null, maGhepHetHan: null, tokenHash: bamBiMat(token), tokenHetHan: hetHan },
  });
  if (r.count !== 1) return { ok: false };
  const may = await db.hoaDonMayKy.findUnique({ where: { tokenHash: bamBiMat(token) }, select: { id: true, userId: true } });
  if (may) await writeAudit({ actor: { id: may.userId, name: "Ứng dụng ký" }, module: "hoa-don", entityType: "HoaDonMayKy", entityId: may.id, action: "GHEP_MAY_KY", newValues: { hetHan: hetHan.toISOString() } });
  return { ok: true, token, hetHan };
}

export type MayDaXacThuc = { mayId: string; userId: string };

/** Tra token ⇒ máy + người dùng. Hết hạn / thu hồi / lạ ⇒ null. Ghi `lanDungCuoi` tối đa mỗi phút một lần. */
export async function xacThucTokenMay(token: unknown, now: Date): Promise<MayDaXacThuc | null> {
  if (!laKhuonTokenMay(token)) return null;
  const m = await db.hoaDonMayKy.findUnique({ where: { tokenHash: bamBiMat(token) }, select: { id: true, userId: true, tokenHetHan: true, thuHoiLuc: true, lanDungCuoi: true } });
  if (!m || m.thuHoiLuc || !m.tokenHetHan || m.tokenHetHan.getTime() <= now.getTime()) return null;
  if (!m.lanDungCuoi || now.getTime() - m.lanDungCuoi.getTime() > NHIP_GHI_LAN_DUNG_MS) {
    await db.hoaDonMayKy.updateMany({ where: { id: m.id, thuHoiLuc: null }, data: { lanDungCuoi: now } });
  }
  return { mayId: m.id, userId: m.userId };
}

/** Chủ máy tự thu hồi máy của mình. `false` = không có máy đó (hoặc không phải của mình, hoặc đã thu hồi). */
export async function thuHoiMay(i: { userId: string; userName: string; mayId: string; now: Date }): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.hoaDonMayKy.updateMany({
      where: { id: i.mayId, userId: i.userId, thuHoiLuc: null },
      data: { thuHoiLuc: i.now, maGhepHash: null, maGhepHetHan: null, tokenHash: null, tokenHetHan: null },
    });
    if (r.count !== 1) return false;
    await writeAudit({ tx, actor: { id: i.userId, name: i.userName }, module: "hoa-don", entityType: "HoaDonMayKy", entityId: i.mayId, action: "THU_HOI_MAY_KY" });
    return true;
  });
}
