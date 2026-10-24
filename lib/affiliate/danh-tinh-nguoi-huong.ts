// lib/affiliate/danh-tinh-nguoi-huong.ts — DANH TÍNH NGƯỜI HƯỞNG của một đối tác (để chặn TỰ NHẬN / TU_CLAIM ở đổi nguồn và duyệt referral). Tách khỏi `danh-tinh-doi-tac.ts` (danh tính để chặn TỰ GIỚI THIỆU
// của KHÁCH — SĐT/email): hai câu hỏi khác nhau, hai tệp, và lưới `[XLW-07]` canh `danh-tinh-doi-tac.ts` là MỘT hàm dựng danh tính cho ba đường tự giới thiệu.
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { danhTinhTu, type DanhTinh } from "@/lib/nguon/gian-lan";
import { userIdsGanVoiDoiTac } from "./tai-khoan-truy-cap";

type Khach = PrismaClient | Prisma.TransactionClient;

/**
 * DANH TÍNH NGƯỜI HƯỞNG của một đối tác, để chặn TỰ NHẬN (TU_CLAIM) khi chủ của lead (người chăm · người chốt đơn · Sale Admin · người bấm) chính là đối tác:
 * `Affiliate.userId` + `Affiliate.employeeId` + MỌI tài khoản còn gắn (`userIdsGanVoiDoiTac`) + các tài khoản của nhân viên đó + hồ sơ nhân viên của từng tài khoản.
 * Quy về CẢ HAI không gian id (`User.id` · `Employee.id`) vì chủ lead và đối tác nằm ở hai không gian khác nhau. Đối tác không tồn tại ⇒ danh tính rỗng.
 */
export async function danhTinhNguoiHuongCuaDoiTac(partyId: string, client: Khach = db): Promise<DanhTinh> {
  const party = await client.affiliate.findUnique({ where: { id: partyId }, select: { userId: true, employeeId: true } });
  if (!party) return danhTinhTu({});
  const idTaiKhoan = await userIdsGanVoiDoiTac(partyId, client);
  const hoac: Prisma.UserWhereInput[] = [];
  const ids = [...new Set([...(party.userId ? [party.userId] : []), ...idTaiKhoan])];
  if (ids.length > 0) hoac.push({ id: { in: ids } });
  if (party.employeeId) hoac.push({ employeeId: party.employeeId });
  const taiKhoan = hoac.length > 0 ? await client.user.findMany({ where: { OR: hoac }, select: { id: true, employeeId: true } }) : [];
  return danhTinhTu({
    userIds: [...ids, ...taiKhoan.map((t) => t.id)],
    employeeIds: [party.employeeId, ...taiKhoan.map((t) => t.employeeId)],
  });
}
