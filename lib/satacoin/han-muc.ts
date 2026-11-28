import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { khoangThangVn, kiemTraCapCoinGiaoVien, phanLoaiNguoiCap, type KetQuaHanMuc } from "./han-muc-thuan";

/**
 * HS2-D4 — lớp DB của hạn mức giáo viên. Luật nằm ở `han-muc-thuan.ts`; ở đây chỉ ĐỌC dữ liệu cho luật và GHI hạn mức (Admin).
 *
 * ⚠️ Kiểm-rồi-ghi phải nằm TRONG cùng transaction với phép ghi sổ cái, sau `khoaHanMucGiaoVien`: hai học viên khác nhau của CÙNG một giáo viên không chung khoá hàng học viên,
 * nên chỉ khoá theo GIÁO VIÊN mới chặn được hai lượt đồng thời cùng thấy «còn 10 coin». Tầng ghi sổ cái (`service.ts`) gọi `kiemTraNguoiCapCoin(tx, …)` ngay sau khoá.
 */
type Tx = Prisma.TransactionClient | typeof db;

/** Khoá tư vấn theo giáo viên (giải phóng khi transaction kết thúc). Chỉ dùng được trong `$transaction`. */
export async function khoaHanMucGiaoVien(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`satacoin-quota:${userId}`}))`;
}

export async function layHanMuc(tx: Tx, userId: string): Promise<number | null> {
  const q = await tx.teacherCoinQuota.findUnique({ where: { userId }, select: { capPerMonth: true } });
  return q?.capPerMonth ?? null;
}

/** Σ|amount| các giao dịch giáo viên đã ghi trong THÁNG (giờ VN) của `now`. Đọc từ sổ cái — không có bộ đếm thứ hai. */
export async function daDungTrongThang(tx: Tx, userId: string, now: Date): Promise<number> {
  const { tu, den } = khoangThangVn(now);
  const where = { createdById: userId, createdAt: { gte: tu, lt: den } };
  const [cong, tru] = await Promise.all([
    tx.sataCoinTransaction.aggregate({ where: { ...where, amount: { gt: 0 } }, _sum: { amount: true } }),
    tx.sataCoinTransaction.aggregate({ where: { ...where, amount: { lt: 0 } }, _sum: { amount: true } }),
  ]);
  return (cong._sum.amount ?? 0) - (tru._sum.amount ?? 0);
}

/** «Học viên phụ trách» = đang học ở một lớp mà người này là GIÁO VIÊN CHÍNH (trợ giảng không tính). */
export async function laHocVienPhuTrach(tx: Tx, userId: string, studentId: string): Promise<boolean> {
  const n = await tx.enrollment.count({
    where: { studentId, deletedAt: null, status: { in: ["CONFIRMED", "STUDYING", "ACTIVE"] }, class: { teacherId: userId, deletedAt: null } },
  });
  return n > 0;
}

/**
 * Cổng cho MỌI đường cộng/trừ thủ công. Admin / Quản lý cơ sở: không bị hạn mức (việc kiểm quyền + cách ly cơ sở của họ nằm ở tầng action).
 * Giáo viên: đúng học viên phụ trách + trong hạn mức tháng. Vai khác: từ chối.
 */
export async function kiemTraNguoiCapCoin(tx: Tx, p: { userId: string; roles: readonly string[]; studentId: string; amount: number; now?: Date }): Promise<KetQuaHanMuc | { ok: true; conLaiSauKhiGhi: null }> {
  const vai = phanLoaiNguoiCap(p.roles);
  if (vai === "ADMIN" || vai === "QUAN_LY_CO_SO") return { ok: true, conLaiSauKhiGhi: null };
  if (vai === "KHAC") return { ok: false, ma: "KHONG_PHAI_HOC_VIEN_PHU_TRACH", loi: "Không có quyền cộng/trừ SataCoin" };
  const now = p.now ?? new Date();
  const [cap, daDung, phuTrach] = await Promise.all([layHanMuc(tx, p.userId), daDungTrongThang(tx, p.userId, now), laHocVienPhuTrach(tx, p.userId, p.studentId)]);
  return kiemTraCapCoinGiaoVien({ capThang: cap, daDungTrongThang: daDung, amount: p.amount, laHocVienPhuTrach: phuTrach });
}

/** Admin đặt/đổi hạn mức tháng của MỘT giáo viên. `adminId` do tầng action gắn từ phiên và đã kiểm quyền. */
export async function datHanMucGiaoVien(p: { adminId: string; teacherUserId: string; capPerMonth: number; note?: string | null }): Promise<{ ok: true } | { ok: false; loi: string }> {
  if (!Number.isInteger(p.capPerMonth) || p.capPerMonth < 0 || p.capPerMonth > 1_000_000) return { ok: false, loi: "Hạn mức phải là số nguyên từ 0 đến 1.000.000" };
  const gv = await db.user.findFirst({ where: { id: p.teacherUserId, OR: [{ role: "TEACHER" }, { roles: { has: "TEACHER" } }] }, select: { id: true } });
  if (!gv) return { ok: false, loi: "Không tìm thấy giáo viên" };
  await db.teacherCoinQuota.upsert({
    where: { userId: p.teacherUserId },
    create: { userId: p.teacherUserId, capPerMonth: p.capPerMonth, setById: p.adminId, note: p.note ?? null },
    update: { capPerMonth: p.capPerMonth, setById: p.adminId, note: p.note ?? null },
  });
  return { ok: true };
}

/** Bảng hạn mức cho màn Admin: mỗi giáo viên một dòng {hạn mức, đã dùng tháng này}. Nằm ở lib để màn không phải import `db` trần (luật R6-F1). */
export async function bangHanMucGiaoVien(userIds: readonly string[], now: Date = new Date()): Promise<Map<string, { cap: number | null; daDung: number }>> {
  const kq = new Map<string, { cap: number | null; daDung: number }>();
  for (const id of userIds) kq.set(id, { cap: await layHanMuc(db, id), daDung: await daDungTrongThang(db, id, now) });
  return kq;
}
