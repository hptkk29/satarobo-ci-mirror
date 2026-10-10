import { db } from "@/lib/db";
import { logLeadAudit } from "@/lib/audit/log";
import { assignmentWrite } from "@/lib/lead/assignment";
import { baoLoLeadMoi, thuHoiChuongLeadCu } from "@/lib/lead/assign-lead";
import { LEAD_CLOSED_STATUSES } from "@/lib/leads/status";
import type { Prisma } from "@prisma/client";

// =============================================================================
// Cụm C2 — Bàn giao lead hàng loạt khi sale nghỉ. KHÔNG sửa record user cũ;
// chỉ đổi assignedToId trên lead + ghi LeadAssignmentHistory + audit + chuyển task.
// =============================================================================

// Trạng thái "đã đóng" — khi lọc onlyActive thì loại các lead này.
// GĐ0 — lấy từ nguồn duy nhất thay vì chép tay lần thứ ba.
const TERMINAL_STATUSES = LEAD_CLOSED_STATUSES;

export interface HandoverFilters {
  statuses?: string[]; // lọc theo LeadStatus cụ thể
  campaign?: string | null; // lọc theo utmCampaign
  onlyActive?: boolean; // chỉ lead chưa đóng
}

/**
 * Cách ly cơ sở: tầm nhìn cơ sở của actor cho model Lead. "ALL" = không giới hạn
 * (SUPER_ADMIN/HO); mảng = chỉ những cơ sở này. Action phải tính qua
 * getModelVisibleCenterIds("Lead", actor) và TRUYỀN vào — service KHÔNG tự suy.
 */
export type VisibleCenterIds = "ALL" | string[];

/**
 * Đếm số lead sẽ bị ảnh hưởng (để preview trước khi chạy).
 *
 * ⚠️ `visibleCenterIds` BẮT BUỘC — cố ý không có mặc định. Xem chú thích ở `resolveWhere`.
 */
export async function previewHandover(
  fromUserId: string,
  filters: HandoverFilters,
  visibleCenterIds: VisibleCenterIds,
): Promise<number> {
  return db.lead.count({ where: resolveWhere(fromUserId, filters, visibleCenterIds) });
}

/**
 * ⚠️ `visibleCenterIds` BẮT BUỘC — cố ý KHÔNG có mặc định `"ALL"`.
 *
 * Đây là tham số quyết định PHẠM VI NHÌN. Mặc định `"ALL"` nghĩa là: call site mới quên
 * một đối số ⇒ người của cơ sở này bàn giao được lead của cơ sở kia, im lặng, không lỗi.
 * Mặc định của scope phải **fail-closed**, không bao giờ là `"ALL"`
 * (`docs/luat-doc-so-va-ket-luan.md`).
 *
 * Bỏ mặc định để `tsc` liệt kê từng call site. Nơi gọi phải tự lấy
 * `getModelVisibleCenterIds("Lead", actor)` và TRUYỀN vào — service KHÔNG tự suy, vì nó
 * không có `actor`.
 */
function resolveWhere(
  fromUserId: string,
  filters: HandoverFilters,
  visibleCenterIds: VisibleCenterIds,
): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { assignedToId: fromUserId, deletedAt: null };
  const and: Prisma.LeadWhereInput[] = [];
  if (filters.statuses && filters.statuses.length > 0) {
    and.push({ status: { in: filters.statuses as never } });
  }
  if (filters.campaign) {
    and.push({ utmCampaign: filters.campaign });
  }
  if (filters.onlyActive) {
    // ⚠️ Hai vế, không phải một. Sau GĐ5 tập đóng chỉ còn `DA_MAT` (cố ý — lead đã
    // đăng ký mà chưa xếp lớp vẫn là việc đang mở), nên lọc theo status MỘT MÌNH sẽ
    // lôi cả lead đã convert XONG từ đời nào vào danh sách bàn giao. `convertedAt` do
    // chính lượt convert ghi ⇒ có mốc = hồ sơ đã khép, không còn gì để bàn giao.
    // Lưu ý: vế này CHỈ áp cho onlyActive. Ai chủ động tick trạng thái `DA_DANG_KY` ở
    // `filters.statuses` thì vẫn phải thấy đủ lead đã đăng ký — đó là lựa chọn có ý thức.
    and.push({ status: { notIn: [...TERMINAL_STATUSES] as never } });
    and.push({ convertedAt: null });
  }
  // Cách ly cơ sở (chống bàn giao chéo CS): chỉ những lead trong tầm nhìn cơ sở
  // của actor. Mảng rỗng → không match lead nào (fail-safe). "ALL" → bỏ qua.
  if (visibleCenterIds !== "ALL") {
    and.push({ centerId: { in: visibleCenterIds } });
  }
  if (and.length) where.AND = and;
  return where;
}

export async function bulkReassignLeads(params: {
  fromUserId: string;
  toUserId: string;
  filters: HandoverFilters;
  actorId: string | null;
  actorName: string;
  reason?: string | null;
  /**
   * Cách ly cơ sở — chỉ bàn giao lead trong tầm nhìn cơ sở của actor.
   *
   * ⚠️ BẮT BUỘC, cố ý không có mặc định. Xem `resolveWhere`.
   */
  visibleCenterIds: VisibleCenterIds;
}): Promise<{ ok: boolean; error?: string; moved: number; tasksMoved: number }> {
  if (params.fromUserId === params.toUserId) {
    return { ok: false, error: "Sale nhận trùng sale bàn giao", moved: 0, tasksMoved: 0 };
  }
  const toUser = await db.user.findFirst({
    where: { id: params.toUserId, isActive: true, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!toUser) return { ok: false, error: "Sale nhận không hợp lệ", moved: 0, tasksMoved: 0 };

  const where = resolveWhere(
    params.fromUserId,
    params.filters,
    params.visibleCenterIds,
  );
  const leads = await db.lead.findMany({ where, select: { id: true } });
  if (leads.length === 0) return { ok: true, moved: 0, tasksMoved: 0 };

  let tasksMoved = 0;

  // Xử lý từng lead (history + audit cần per-record). KHÔNG đụng user cũ.
  for (const lead of leads) {
    await db.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          // Đợt A — bàn giao hàng loạt cũng là đổi chủ ⇒ phải làm mới mốc phân công.
          ...assignmentWrite(params.toUserId),
          handoverNote: params.reason ?? undefined,
        },
      });
      await tx.leadAssignmentHistory.create({
        data: {
          leadId: lead.id,
          fromUserId: params.fromUserId,
          toUserId: params.toUserId,
          assignedById: params.actorId,
          reason: params.reason ?? null,
        },
      });
      // Chuyển luôn task đang mở của sale cũ sang sale mới.
      const tRes = await tx.leadTask.updateMany({
        where: { leadId: lead.id, assignedToId: params.fromUserId, status: "OPEN" },
        data: { assignedToId: params.toUserId, assignedToName: toUser.name ?? null },
      });
      tasksMoved += tRes.count;

      await logLeadAudit({
        leadId: lead.id,
        action: "ASSIGN",
        actorId: params.actorId,
        actorName: params.actorName,
        oldValues: { assignedToId: params.fromUserId },
        newValues: { assignedToId: params.toUserId },
        changedFields: ["assignedToId"],
        reason: params.reason ?? "Bàn giao lead",
        tx,
      });
    });
  }

  // 15/09/2026 — THU HỒI chuông "Bạn có lead mới" của sale CŨ cho từng lead vừa chuyển.
  //
  // Thiếu bước này thì bàn giao 30 lead là để lại ở sale cũ 30 cái chuông trỏ tới 30 lead họ
  // không còn giữ — bấm vào ra trang "không tồn tại" vì `Lead` nằm trong `SCOPED_MODELS`.
  // Đây là đường rò NẶNG NHẤT trong bốn đường tìm được ngày 15/09, vì nó hàng loạt.
  //
  // Đặt NGOÀI vòng transaction ở trên: `notifyStaff`/`thuHoiThongBao` cố ý không nhận `tx`,
  // và thu hồi hỏng thì việc bàn giao vẫn phải thành công (`thuHoiChuongLeadCu` tự nuốt lỗi).
  //
  for (const lead of leads) {
    await thuHoiChuongLeadCu({
      chuCuId: params.fromUserId,
      chuMoiId: params.toUserId,
      leadId: lead.id,
    });
  }

  // 15/09/2026 (đợt hai) — BÁO CHO SALE NHẬN, bằng MỘT tin gộp.
  //
  // Trước đó đường này im hoàn toàn với người nhận: họ được giao 30 lead đang chạy dở mà
  // không ai đánh động, phải tự mở danh sách mới biết. Đợt vá đầu cố ý để nguyên vì bắn 30
  // chuông là "bão push" — người dùng tắt quyền thông báo ở CẤP TRÌNH DUYỆT và code không
  // xin lại được (`lib/push/allowlist.ts`). Nay đã có tin gộp nên nối vào được.
  //
  // Lead bàn giao KHÁC lead nhập mới: nó đang chạy dở, có lịch sử trao đổi, và khách đã nói
  // chuyện với người khác. Câu chữ nói rõ điều đó — xem `moTaLoLead`.
  const nguoiBanGiao = await db.user.findUnique({
    where: { id: params.fromUserId },
    select: { name: true },
  });
  await baoLoLeadMoi({
    daChia: leads.map((l) => ({ leadId: l.id, ownerId: params.toUserId })),
    nguon: { kieu: "ban_giao", tuNguoi: nguoiBanGiao?.name ?? "tư vấn viên trước" },
    mocLuot: Date.now(),
    // Quản lý tự bàn giao về cho chính mình thì không cần chuông báo lại việc mình vừa bấm.
    boQuaNguoi: params.actorId,
  });

  return { ok: true, moved: leads.length, tasksMoved };
}
