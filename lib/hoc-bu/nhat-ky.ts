// lib/hoc-bu/nhat-ky.ts — NHẬT KÝ (AuditLog) CỦA HỌC BÙ (T14, 08/10/2026). MỘT cửa ghi, ghi TRONG giao dịch của phép ghi nó mô tả.
//
// Trước T14 nhật ký rải ba nơi, ba kiểu: một số hàm dịch vụ tự ghi (`hoc-bu.sua-case`…), một số do server action ghi SAU khi dịch vụ đã commit
// (module "lms", action "UPDATE") — lỗi giữa chừng để lại phép ghi KHÔNG dấu vết — và nhiều phép ghi quan trọng (gỡ bé khỏi case, điểm danh lần đầu,
// case đổi trạng thái, gỡ miễn phí) không có dòng nhật ký nào. Nay: mọi phép ghi nghiệp vụ học bù đều có MỘT dòng `hoc-bu.<hành động>`, cùng giao dịch.
//
// Danh sách hành động (đóng): `HANH_DONG` ở `nhat-ky-thuan.ts`. Thêm phép ghi mới = thêm một dòng ở đó + một lời gọi `ghiNhatKy` + một ca ở lưới `[NKW-*]`.
import "server-only";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import type { HanhDong } from "@/lib/hoc-bu/nhat-ky-thuan";

type Tx = Prisma.TransactionClient;

export type VatNhatKy = "MakeupCase" | "MakeupCaseParticipant" | "MakeupCaseStudent" | "MakeupNeed";

/**
 * Ghi một dòng nhật ký học bù TRONG giao dịch `tx`. Tên người làm: truyền `ten` nếu có sẵn; không thì tra theo `actorId` trong chính giao dịch
 * (không có người = "Hệ thống"). Lỗi ghi nhật ký làm hỏng giao dịch — cố ý: phép ghi không có dấu vết thì không nên tồn tại.
 */
export async function ghiNhatKy(
  tx: Tx,
  p: {
    actorId: string | null;
    ten?: string | null;
    entityType: VatNhatKy;
    entityId: string;
    action: HanhDong;
    orgUnitId?: string | null;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    reason?: string;
  },
): Promise<void> {
  const ten =
    p.ten ?? (p.actorId ? ((await tx.user.findUnique({ where: { id: p.actorId }, select: { name: true } }))?.name ?? p.actorId) : "Hệ thống");
  await writeAudit({
    actor: { id: p.actorId, name: ten },
    module: "hoc-bu",
    entityType: p.entityType,
    entityId: p.entityId,
    action: p.action,
    oldValues: p.oldValues,
    newValues: p.newValues,
    reason: p.reason,
    orgUnitId: p.orgUnitId ?? undefined,
    tx,
  });
}
