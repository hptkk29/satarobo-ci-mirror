// lib/hoa-hong/nguoi-huong-db.ts — NẠP dữ liệu cho resolver người hưởng (CHỈ ĐỌC). Hàm quyết định: `nguoi-huong.ts`.
//
// Đọc đúng những gì 04 §7 nêu: `Lead.convertedById/adminId` của lead của GIAO DỊCH · `CenterCommissionAssignee` của
// cơ sở của GIAO DỊCH · GV buổi trial bé đã học (`findAttendedTrialForLeadChild`) · người giới thiệu trên
// `LeadAttribution` · trạng thái nhân sự (`Employee.status`) · affiliate còn hoạt động.
//
// ⚠️ `LeadAttribution` KHÔNG có cột đơn vị (ngoại lệ có chủ đích luật Nền #3, 02 §2.5) và lưới `[QN-W11]` cấm đọc thẳng
// bảng đó ngoài `lib/nguon/**`. Nên hàm này KHÔNG chạm bảng nguồn: người gọi đọc nguồn qua hàm đọc của `lib/nguon/**`
// (đã đi qua Lead đã scope) rồi truyền `nguon` vào đây — ở đây chỉ đổi `Employee.id` → `User.id` + dò trạng thái nhân sự.
//
// `client` BẮT BUỘC (luật 7): gọi trong `$transaction` hoặc client thường. Client KHÔNG scope — engine tính hoa hồng là
// việc toàn hệ, không theo tầm nhìn cơ sở của người bấm (cùng lý do `lib/crm/commission-run.ts`).
import type { Prisma, PrismaClient } from "@prisma/client";

import type { PhanCongCoSo } from "@/lib/crm/commission-assignee";
import { findAttendedTrialForLeadChild } from "@/lib/crm/trial-teacher-commission";

import type { NguCanhNguoiHuong } from "./nguoi-huong";

type Khach = PrismaClient | Prisma.TransactionClient;

export async function docNguCanhNguoiHuong(
  client: Khach,
  input: {
    /** `Order.leadId`; `null` = đơn không có lead. */
    leadId: string | null;
    /** `Order.leadChildId` — cho GV Trial. */
    leadChildId: string | null;
    /** Cơ sở của GIAO DỊCH (cơ sở bút toán). */
    centerId: string | null;
    assigneeDate: Date;
    /** Người giới thiệu trên attribution (đọc qua `lib/nguon/**`); `null` = lead chưa có nguồn / đơn không lead. */
    nguon: {
      referrerKind: "PARENT" | "EMPLOYEE" | "AFFILIATE" | null;
      referrerParentUserId: string | null;
      /** ẢNH CHỤP Sale phụ trách PH lúc ghi nhận (`User.id`). */
      referrerSaleUserId: string | null;
      referrerEmployeeId: string | null;
      referrerAffiliateId: string | null;
      /** `Employee.id` người phụ trách NGUỒN (master). */
      nguonChuEmployeeId: string | null;
    } | null;
  },
): Promise<NguCanhNguoiHuong> {
  const lead = input.leadId
    ? await client.lead.findUnique({ where: { id: input.leadId }, select: { convertedById: true, adminId: true } })
    : null;

  const phanCong: PhanCongCoSo[] = input.centerId
    ? (await client.centerCommissionAssignee.findMany({ where: { centerId: input.centerId } })).map((r) => ({
        centerId: r.centerId,
        role: r.role,
        userId: r.userId,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
      }))
    : [];

  const trial = input.leadChildId ? await findAttendedTrialForLeadChild(client as never, input.leadChildId) : null;

  const attr = input.nguon;
  // MỘT câu cho cả hai nhân sự (người giới thiệu · người phụ trách nguồn) → `User.id`.
  const idNhanSu = [attr?.referrerEmployeeId, attr?.nguonChuEmployeeId].filter((x): x is string => !!x);
  const userCuaNhanSu = idNhanSu.length
    ? new Map((await client.user.findMany({ where: { employeeId: { in: [...new Set(idNhanSu)] } }, select: { id: true, employeeId: true } })).map((u) => [u.employeeId as string, u.id]))
    : new Map<string, string>();

  const attribution = attr
    ? {
        referrerKind: attr.referrerKind,
        referrerParentUserId: attr.referrerParentUserId,
        referrerSaleUserId: attr.referrerSaleUserId,
        referrerEmployeeUserId: attr.referrerEmployeeId ? (userCuaNhanSu.get(attr.referrerEmployeeId) ?? null) : null,
        referrerAffiliateId: attr.referrerAffiliateId,
        nguonChuEmployeeId: attr.nguonChuEmployeeId,
        nguonChuUserId: attr.nguonChuEmployeeId ? (userCuaNhanSu.get(attr.nguonChuEmployeeId) ?? null) : null,
      }
    : null;

  // Trạng thái nhân sự của MỌI người có thể là người hưởng.
  const ungVien = [
    lead?.convertedById,
    lead?.adminId,
    trial?.teacherUserId,
    attribution?.referrerParentUserId,
    attribution?.referrerEmployeeUserId,
    // D13 áp cho CẢ Sale ảnh chụp và chủ nguồn: thiếu hai id này trong tập dò thì người đã nghỉ vẫn được chi.
    attribution?.referrerSaleUserId,
    attribution?.nguonChuUserId,
    ...phanCong.map((p) => p.userId),
  ].filter((x): x is string => !!x);
  const users = ungVien.length
    ? await client.user.findMany({ where: { id: { in: [...new Set(ungVien)] } }, select: { id: true, employee: { select: { status: true } } } })
    : [];
  const trangThaiNhanSu = new Map<string, string | null>(users.map((u) => [u.id, u.employee?.status ?? null]));

  const affiliateConHoatDong = new Map<string, boolean>();
  if (attribution?.referrerAffiliateId) {
    const a = await client.affiliate.findUnique({ where: { id: attribution.referrerAffiliateId }, select: { isActive: true } });
    if (a) affiliateConHoatDong.set(attribution.referrerAffiliateId, a.isActive);
  }

  return {
    centerId: input.centerId,
    assigneeDate: input.assigneeDate,
    lead,
    phanCongCoSo: phanCong,
    gvTrialUserId: trial?.teacherUserId ?? null,
    attribution,
    trangThaiNhanSu,
    affiliateConHoatDong,
  };
}
