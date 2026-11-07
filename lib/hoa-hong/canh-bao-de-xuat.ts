// lib/hoa-hong/canh-bao-de-xuat.ts — CẢNH BÁO GIAN LẬN của một đề xuất đổi nguồn (TU_CLAIM), tính LẠI mỗi lần cần — lúc lập VÀ lúc duyệt.
//
// Vì sao tính lại lúc duyệt (res3 HIGH-1 + yêu cầu chủ dự án 10/10): đề xuất nằm chờ có thể nhiều ngày; trong thời gian ấy `Lead.convertedById/assignedToId/adminId` có thể đổi, nên
// "người sẽ hưởng" có thể trở thành chính người chăm lead. Tin cảnh báo lúc lập là tin một bức ảnh cũ. Cùng hàm thuần `giaoNhauDanhTinh` của `lib/nguon/gian-lan.ts` (MỘT phép giao danh tính).
//
// Hai tập, so ở CẢ HAI không gian id (`User.id` · `Employee.id`):
//   · chủ lead   = người đề xuất ∪ assignedToId ∪ convertedById ∪ adminId;
//   · người nhận = mọi (vai × người) trong gói có `chenh > 0` (người SẼ ĐƯỢC TRẢ THÊM; người bị đòi lại không phải bên hưởng lợi).
import type { Prisma, PrismaClient } from "@prisma/client";

import { danhTinhTu, giaoNhauDanhTinh } from "@/lib/nguon/gian-lan";

import type { GoiDong } from "./de-xuat-dieu-chinh";
import { tachKhoaNguoi } from "./khoa-so";

type Khach = PrismaClient | Prisma.TransactionClient;

export const MA_CANH_BAO_TU_CLAIM = "TU_CLAIM" as const;

export async function tinhCanhBaoGoiDoiNguon(client: Khach, i: { leadId: string; goi: readonly GoiDong[]; requestedById: string | null }): Promise<string[]> {
  const nguoiNhanUser = new Set<string>();
  for (const d of i.goi) {
    if (d.chenh <= 0) continue;
    const t = tachKhoaNguoi(d.key);
    if (t.kind === "USER") nguoiNhanUser.add(t.beneficiaryId);
  }
  if (nguoiNhanUser.size === 0) return [];

  const lead = await client.lead.findUnique({ where: { id: i.leadId }, select: { assignedToId: true, convertedById: true, adminId: true } });
  const chuUser = [i.requestedById, lead?.assignedToId, lead?.convertedById, lead?.adminId].filter((x): x is string => !!x);
  const taiKhoan = await client.user.findMany({ where: { id: { in: [...new Set([...chuUser, ...nguoiNhanUser])] } }, select: { id: true, employeeId: true } });
  const emp = new Map(taiKhoan.map((u) => [u.id, u.employeeId]));

  const chuLead = danhTinhTu({ userIds: chuUser, employeeIds: chuUser.map((u) => emp.get(u)) });
  const nguoiNhan = danhTinhTu({ userIds: [...nguoiNhanUser], employeeIds: [...nguoiNhanUser].map((u) => emp.get(u)) });
  return giaoNhauDanhTinh(chuLead, nguoiNhan) ? [MA_CANH_BAO_TU_CLAIM] : [];
}
