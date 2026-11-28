import type { Prisma, PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { docKhoaBiMat, type KhoaBiMat } from "@/lib/finance/hoa-don/ket-noi/khoa-bi-mat";
import { giaiMaBiMat, maHoaBiMat } from "@/lib/security/hop-bi-mat";

import {
  chuanHoaChoLuu,
  kiemNoiDungSucKhoe,
  luuSucKhoeSchema,
  MA_DICH_MA_HOA_SUC_KHOE,
  nguCanhSucKhoe,
  PHIEN_BAN_DONG_Y_SUC_KHOE,
  thongTinLuuTru as thongTinLuuTruLoi,
  tinhHetHanSucKhoe,
  type LuuSucKhoeBody,
  type ThongTinLuuTru,
} from "./luu-may-chu";

/**
 * V8.39 — LƯU SỨC KHOẺ CÓ CHỦ ĐÍCH (HL-01). Dịch vụ DB dùng chung (mobile là lớp mỏng). Quy ước an toàn:
 *   · bản rõ CHỈ tồn tại trong bộ nhớ: lưu = mã hoá AES-256-GCM (AAD = chủ tài khoản); THIẾU khoá ⇒ từ chối lưu (không bao giờ lưu thô);
 *   · KHÔNG log nội dung — audit chỉ ghi sự kiện + số lượng; lỗi giải mã không lộ gì (mã cố định);
 *   · hết hạn ⇒ coi như không có + xoá cứng (lười lúc đọc/ghi; `xoaSucKhoeHetHan` cho cron);
 *   · khoá lạc quan `truocCapNhatLuc`: lệch ⇒ `SUC_KHOE_DA_THAY_DOI`;
 *   · đọc/ghi/xoá CHỈ theo `parentUserId` từ PHIÊN — không có tham số nào chọn người khác.
 */
type Db = PrismaClient;
const thongTinLuuTru = (env: Record<string, string | undefined> = process.env): ThongTinLuuTru => thongTinLuuTruLoi(env);


export type MaLoiSucKhoe = "CHUA_BAT_MA_HOA" | "VALIDATION" | "DA_THAY_DOI" | "KHONG_GIAI_MA";
export type LoiSucKhoe = { ok: false; ma: MaLoiSucKhoe; thongBao: string; field?: string };

export type KetQuaLuu = { ok: true; capNhatLuc: string; hetHanLuc: string; soNguoi: number; soBan: number; dongY: { phienBan: string; luc: string }; luuTru: ThongTinLuuTru } | LoiSucKhoe;
export type KetQuaDoc =
  | { ok: true; coDuLieu: false; luuTru: ThongTinLuuTru }
  | { ok: true; coDuLieu: true; dongY: { phienBan: string; luc: string }; capNhatLuc: string; hetHanLuc: string; nguoi: ReturnType<typeof chuanHoaChoLuu>["nguoi"]; luuTru: ThongTinLuuTru }
  | LoiSucKhoe;

const dem = (b: LuuSucKhoeBody) => ({ soNguoi: b.nguoi.length, soBan: b.nguoi.reduce((s, n) => s + n.ban.length, 0) });
const NGU_CANH = (id: string) => nguCanhSucKhoe(id);

export async function luuSucKhoeMayChu(
  db: Db,
  input: { parentUserId: string; body: unknown; homNay: string; now: Date; khoa?: KhoaBiMat; env?: Record<string, string | undefined> },
): Promise<KetQuaLuu> {
  const khoa = input.khoa ?? docKhoaBiMat();
  if (!khoa.ok) return { ok: false, ma: "CHUA_BAT_MA_HOA", thongBao: "Máy chủ chưa bật mã hoá cho dữ liệu sức khoẻ — chưa thể lưu." };
  const p = luuSucKhoeSchema.safeParse(input.body);
  if (!p.success) return { ok: false, ma: "VALIDATION", field: p.error.issues[0]?.path.join("."), thongBao: p.error.issues[0]?.message || "Dữ liệu không hợp lệ" };
  // Phiên bản đồng ý PHẢI là bản hiện hành của máy chủ — client gửi phiên bản cũ/bịa ⇒ từ chối (app xin đồng ý lại theo `luuTru.phienBanDongY`).
  if (p.data.dongY.phienBan !== PHIEN_BAN_DONG_Y_SUC_KHOE) return { ok: false, ma: "VALIDATION", field: "dongY.phienBan", thongBao: "Phiên bản đồng ý đã thay đổi — cần xin đồng ý lại." };
  const kiem = kiemNoiDungSucKhoe(p.data, input.homNay);
  if (!kiem.ok) return { ok: false, ma: "VALIDATION", field: kiem.field, thongBao: kiem.thongBao };

  const luuTru = thongTinLuuTru(input.env);
  const hetHan = tinhHetHanSucKhoe(input.now, luuTru.thoiHanThang);
  const banRo = JSON.stringify(chuanHoaChoLuu(p.data));
  const maHoa = maHoaBiMat(banRo, { khoaGoc: khoa.hienHanh, mucDich: MA_DICH_MA_HOA_SUC_KHOE, nguCanh: NGU_CANH(input.parentUserId) });
  const { soNguoi, soBan } = dem(p.data);

  return db.$transaction(async (tx): Promise<KetQuaLuu> => {
    // Khoá theo chủ tài khoản: hai lượt PUT cùng lúc xếp hàng (khoá lạc quan phía dưới mới có nghĩa).
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.parentUserId} FOR UPDATE`;
    const cu = await tx.parentHealthRecord.findUnique({ where: { parentUserId: input.parentUserId }, select: { id: true, updatedAt: true, expiresAt: true } });
    const cuConHan = cu && cu.expiresAt.getTime() > input.now.getTime() ? cu : null;
    if (p.data.truocCapNhatLuc !== undefined) {
      const mong = p.data.truocCapNhatLuc === null ? null : new Date(p.data.truocCapNhatLuc).getTime();
      const thuc = cuConHan ? cuConHan.updatedAt.getTime() : null;
      if (mong !== thuc) return { ok: false, ma: "DA_THAY_DOI", thongBao: "Dữ liệu sức khoẻ đã thay đổi ở thiết bị khác" };
    }
    const luu = await tx.parentHealthRecord.upsert({
      where: { parentUserId: input.parentUserId },
      create: { parentUserId: input.parentUserId, payloadMaHoa: maHoa, consentVersion: p.data.dongY.phienBan, consentAt: input.now, expiresAt: hetHan },
      update: { payloadMaHoa: maHoa, consentVersion: p.data.dongY.phienBan, consentAt: input.now, expiresAt: hetHan },
      select: { id: true, updatedAt: true },
    });
    await writeAudit({ tx, actor: { id: input.parentUserId, name: "Phụ huynh" }, module: "suc-khoe", entityType: "ParentHealthRecord", entityId: luu.id, action: cuConHan ? "UPDATE" : "CREATE", newValues: { soNguoi, soBan, hetHan: hetHan.toISOString(), phienBanDongY: p.data.dongY.phienBan }, orgUnitId: null });
    return { ok: true, capNhatLuc: luu.updatedAt.toISOString(), hetHanLuc: hetHan.toISOString(), soNguoi, soBan, dongY: { phienBan: p.data.dongY.phienBan, luc: p.data.dongY.luc }, luuTru };
  });
}

export async function docSucKhoeMayChu(db: Db, input: { parentUserId: string; now: Date; khoa?: KhoaBiMat; env?: Record<string, string | undefined> }): Promise<KetQuaDoc> {
  const luuTru = thongTinLuuTru(input.env);
  const dong = await db.parentHealthRecord.findUnique({ where: { parentUserId: input.parentUserId } });
  if (!dong) return { ok: true, coDuLieu: false, luuTru };
  if (dong.expiresAt.getTime() <= input.now.getTime()) {
    // hết hạn ⇒ coi như không có + xoá cứng (đúng chính sách thời hạn lưu)
    await db.$transaction(async (tx) => {
      const x = await tx.parentHealthRecord.deleteMany({ where: { id: dong.id, expiresAt: { lte: input.now } } });
      if (x.count > 0) await writeAudit({ tx, actor: { id: input.parentUserId, name: "Hệ thống" }, module: "suc-khoe", entityType: "ParentHealthRecord", entityId: dong.id, action: "EXPIRE", newValues: { lyDo: "hết thời hạn lưu" }, orgUnitId: null });
    });
    return { ok: true, coDuLieu: false, luuTru };
  }
  const khoa = input.khoa ?? docKhoaBiMat();
  if (!khoa.ok) return { ok: false, ma: "CHUA_BAT_MA_HOA", thongBao: "Máy chủ chưa bật mã hoá cho dữ liệu sức khoẻ." };
  let nguoi: ReturnType<typeof chuanHoaChoLuu>["nguoi"];
  let dongY: { phienBan: string; luc: string };
  try {
    const ro = giaiMaBiMat(dong.payloadMaHoa, { cacKhoaGoc: khoa.cacKhoa, mucDich: MA_DICH_MA_HOA_SUC_KHOE, nguCanh: NGU_CANH(input.parentUserId) });
    const j = JSON.parse(ro) as { v?: number; dongY?: { phienBan: string; luc: string }; nguoi?: unknown };
    const kt = luuSucKhoeSchema.safeParse({ dongY: j.dongY, nguoi: j.nguoi });
    if (j.v !== 1 || !kt.success) throw new Error("hỏng");
    const ch = chuanHoaChoLuu(kt.data);
    nguoi = ch.nguoi;
    dongY = ch.dongY;
  } catch {
    return { ok: false, ma: "KHONG_GIAI_MA", thongBao: "Không đọc được dữ liệu đã lưu." }; // mã cố định — không lộ gì
  }
  return { ok: true, coDuLieu: true, dongY, capNhatLuc: dong.updatedAt.toISOString(), hetHanLuc: dong.expiresAt.toISOString(), nguoi, luuTru };
}

/** Xoá toàn bộ — idempotent: chưa có ⇒ `daXoa:false`. Xoá CỨNG (không «xoá mềm») theo NĐ 13/2023. */
export async function xoaSucKhoeMayChu(db: Db, input: { parentUserId: string }): Promise<{ ok: true; daXoa: boolean }> {
  return db.$transaction(async (tx) => {
    const dong = await tx.parentHealthRecord.findUnique({ where: { parentUserId: input.parentUserId }, select: { id: true } });
    if (!dong) return { ok: true as const, daXoa: false };
    const x = await tx.parentHealthRecord.deleteMany({ where: { id: dong.id } });
    if (x.count > 0) await writeAudit({ tx, actor: { id: input.parentUserId, name: "Phụ huynh" }, module: "suc-khoe", entityType: "ParentHealthRecord", entityId: dong.id, action: "DELETE", newValues: { lyDo: "phụ huynh yêu cầu xoá" }, orgUnitId: null });
    return { ok: true as const, daXoa: x.count > 0 };
  });
}

/** Dọn các bản đã hết hạn (cho cron sau này; chưa nối cron ở vòng này). Trả số bản đã xoá. */
export async function xoaSucKhoeHetHan(db: Db | Prisma.TransactionClient, input: { now: Date }): Promise<number> {
  const x = await db.parentHealthRecord.deleteMany({ where: { expiresAt: { lte: input.now } } });
  return x.count;
}
