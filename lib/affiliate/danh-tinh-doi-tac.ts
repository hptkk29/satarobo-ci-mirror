// lib/affiliate/danh-tinh-doi-tac.ts — DANH TÍNH ĐỂ CHẶN TỰ GIỚI THIỆU của một đối tác: MỘT hàm cho cả ba đường (khách tự điền form, khai tay, duyệt lượt xem tay).
//
// Vì sao một hàm: đường tự động (`nhan-referral`) so SĐT/email của MỌI tài khoản còn gắn với đối tác (L3a: bảng nối `AffiliatePartyUser`),
// còn hai đường thủ công từng chỉ so NGƯỜI ĐẠI DIỆN (`Affiliate.userId`) ⇒ đối tác có tài khoản phụ trùng SĐT khách thì khai tay / duyệt tay lọt, màn không cảnh báo
// (reviewer Affiliate, mức HIGH). Tách ra đây để thêm nguồn danh tính mới chỉ phải sửa MỘT chỗ.
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { userIdsGanVoiDoiTac } from "./tai-khoan-truy-cap";
import type { DanhTinhSoSanh } from "./tu-gioi-thieu";

type Khach = PrismaClient | Prisma.TransactionClient;

export type DoiTacChoDanhTinh = {
  id: string;
  userId: string | null;
  employeeId: string | null;
  phone: string | null;
  email: string | null;
  employee?: { phone: string | null; email: string | null } | null;
};

/** Danh tính của đối tác = chính nó + người đại diện + nhân viên + MỌI tài khoản còn gắn (ACTIVE ∪ SUSPENDED ∪ legacy). */
export async function danhTinhDoiTacDeChan(party: DoiTacChoDanhTinh, client: Khach = db): Promise<DanhTinhSoSanh> {
  const idTaiKhoan = await userIdsGanVoiDoiTac(party.id, client);
  const taiKhoan = idTaiKhoan.length > 0 ? await client.user.findMany({ where: { id: { in: idTaiKhoan } }, select: { phone: true, email: true } }) : [];
  return {
    userId: party.userId,
    employeeId: party.employeeId,
    phones: [party.phone, ...taiKhoan.map((t) => t.phone), party.employee?.phone],
    emails: [party.email, ...taiKhoan.map((t) => t.email), party.employee?.email],
  };
}
