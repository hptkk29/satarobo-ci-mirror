// lib/students/sync-name.ts — ĐỔI TÊN MỘT ĐỨA TRẺ LÀ ĐỔI Ở MỌI BẢN SAO (08/08/2026).
//
// BUG GỐC: tên một học viên nằm ở NHIỀU chỗ — `Student.name` (hồ sơ vận hành),
// `LeadChild.fullName` (hồ sơ CRM, mọi màn lead/học thử đọc từ đây), `Lead.childName`
// (field phẳng cũ, màn lead cũ còn hiện), `ParentFeedback.studentName` (cột phẳng không
// FK). Sửa tên ở màn học viên chỉ ghi `Student.name` ⇒ trang lead, chi tiết lead, học
// thử… vẫn hiện tên cũ, admin phải đi sửa tay từng chỗ.
//
// NGUYÊN TẮC (chủ dự án chốt 08/08): sửa tên ở BẤT KỲ đâu thì mọi bản ghi cùng chỉ về
// đứa trẻ đó phải đổi theo — không bắt người dùng đi gõ lại từng màn.
//
// Cách nhận ra "cùng một đứa trẻ" (2 tầng):
//   1. VẾT CHUYỂN ĐỔI (chắc chắn): `Enrollment.leadChildId` ghi lúc convert lead → HV.
//      Có vết là cùng người, đổi tên KHÔNG cần so tên cũ.
//   2. SUY TỪ GIA ĐÌNH (cho lead cũ chưa có vết, hoặc convert trước R7-06): lead cùng
//      SĐT phụ huynh (cả 2 dạng `0…`/`84…` qua `phoneVariants`) VÀ tên trùng đúng tên
//      CŨ. So tên không phân biệt hoa thường; chỉ đổi khi khớp — không đoán mò.
//
// Gọi BÊN TRONG transaction của action (caller đã kiểm quyền + scope trên bản ghi họ
// đang sửa). Mỗi lead bị đổi có một dòng AuditLog nói rõ vì sao — đổi dữ liệu CRM âm
// thầm mà không dấu vết là tự chuốc lấy phiên "ai đổi tên con tôi?".

import "server-only";
import type { Prisma } from "@prisma/client";
import { logLeadAudit, logStudentAudit } from "@/lib/audit/log";
import { phoneVariants } from "@/lib/phone";

type Tx = Prisma.TransactionClient;

export interface SyncActor {
  id: string | null;
  name: string;
}

/**
 * Học viên đổi tên → dội sang CRM: `LeadChild.fullName` + `Lead.childName` (mirror cũ)
 * + `ParentFeedback.studentName`. Trả danh sách lead bị chạm để caller revalidate.
 *
 * Idempotent: gọi lại với cùng tên là no-op (chỉ đổi bản ghi đang lệch).
 */
export async function syncStudentNameToCrm(input: {
  tx: Tx;
  studentId: string;
  oldName: string;
  newName: string;
  /** SĐT phụ huynh trên hồ sơ HV — chìa khoá cho tầng suy-từ-gia-đình. */
  parentPhone?: string | null;
  /**
   * 26/09/2026 — liên kết lead nguồn trên chính hồ sơ (`Student.leadChildId`). BẮT BUỘC truyền
   * (kể cả `null`): thiếu nó thì HV nối lead bằng nút "Gắn lead" / script nối HV cũ — không có
   * vết ghi danh — đổi tên mà đứa con trong phiếu vẫn giữ tên cũ.
   */
  leadChildId: string | null;
  actor: SyncActor;
}): Promise<{ leadIds: string[] }> {
  const { tx, studentId } = input;
  const oldName = input.oldName.trim();
  const newName = input.newName.trim();
  if (!newName || oldName === newName) return { leadIds: [] };

  // Tầng 1 — vết chuyển đổi. KHÔNG lọc deletedAt/status của enrollment: vết là vết,
  // học viên đã rút khỏi lớp thì hồ sơ lead vẫn là của đứa trẻ đó.
  const trace = await tx.enrollment.findMany({
    where: { studentId, leadChildId: { not: null } },
    select: { leadChildId: true },
  });
  const linkedIds = [
    ...trace.map((t) => t.leadChildId),
    // Tầng 1b — liên kết trực tiếp trên hồ sơ (26/09): cùng độ chắc với vết chuyển đổi.
    input.leadChildId,
  ].filter((x): x is string => Boolean(x));

  // Tầng 2 — cùng SĐT phụ huynh + đúng tên cũ (lead sống; lead đã xoá mềm để yên).
  const phones = phoneVariants(input.parentPhone);
  const matched =
    phones.length > 0
      ? await tx.leadChild.findMany({
          where: {
            fullName: { equals: oldName, mode: "insensitive" },
            lead: { deletedAt: null, phone: { in: phones } },
          },
          select: { id: true },
        })
      : [];

  const childIds = [...new Set([...linkedIds, ...matched.map((m) => m.id)])];
  const children =
    childIds.length > 0
      ? await tx.leadChild.findMany({
          where: { id: { in: childIds } },
          select: { id: true, leadId: true, fullName: true },
        })
      : [];

  const toRename = children.filter((c) => c.fullName !== newName);
  if (toRename.length > 0) {
    await tx.leadChild.updateMany({
      where: { id: { in: toRename.map((c) => c.id) } },
      data: { fullName: newName },
    });
  }

  // Mirror phẳng `Lead.childName` (schema ghi "đọc-only, 2-phase, KHÔNG drop") — màn
  // lead cũ vẫn hiện nó nên phải kéo theo, nhưng CHỈ khi đang mang đúng tên cũ: lead
  // nhiều con thì childName có thể là tên đứa khác.
  const linkedLeadIds = [...new Set(children.map((c) => c.leadId))];
  const flatScope: Prisma.LeadWhereInput[] = [];
  if (linkedLeadIds.length > 0) flatScope.push({ id: { in: linkedLeadIds } });
  if (phones.length > 0) flatScope.push({ deletedAt: null, phone: { in: phones } });

  let flatLeadIds: string[] = [];
  if (flatScope.length > 0) {
    const flat = await tx.lead.findMany({
      where: { OR: flatScope, childName: { equals: oldName, mode: "insensitive" } },
      select: { id: true },
    });
    flatLeadIds = flat.map((l) => l.id);
    if (flatLeadIds.length > 0) {
      await tx.lead.updateMany({
        where: { id: { in: flatLeadIds } },
        data: { childName: newName },
      });
    }
  }

  // Cột phẳng không FK ở đánh giá phụ huynh — có studentId nên đổi thẳng.
  await tx.parentFeedback.updateMany({
    where: { studentId },
    data: { studentName: newName },
  });

  const leadIds = [...new Set([...toRename.map((c) => c.leadId), ...flatLeadIds])];
  for (const leadId of leadIds) {
    await logLeadAudit({
      leadId,
      action: "UPDATE",
      actorId: input.actor.id,
      actorName: input.actor.name,
      oldValues: { childName: oldName },
      newValues: { childName: newName },
      changedFields: ["children", "childName"],
      reason: "Đồng bộ tên theo hồ sơ học viên (đổi tên ở màn Học viên)",
      tx,
    });
  }

  return { leadIds };
}

/**
 * Chiều ngược — sửa tên con Ở MÀN LEAD: dội sang `Student.name` của các học viên đã
 * convert từ con này, rồi tái dùng `syncStudentNameToCrm` để kéo nốt các bản sao còn
 * lại (lead khác cùng SĐT, mirror phẳng, feedback) — MỘT đường code cho cả hai chiều.
 */
export async function syncLeadChildNameToStudents(input: {
  tx: Tx;
  leadChildId: string;
  oldName: string;
  newName: string;
  actor: SyncActor;
}): Promise<{ studentIds: string[]; leadIds: string[] }> {
  const newName = input.newName.trim();
  if (!newName || input.oldName.trim() === newName) {
    return { studentIds: [], leadIds: [] };
  }

  const [trace, noiTrucTiep] = await Promise.all([
    input.tx.enrollment.findMany({
      where: { leadChildId: input.leadChildId },
      select: { studentId: true },
    }),
    // 26/09/2026 — HV nối đứa con này qua `Student.leadChildId` (nút "Gắn lead", script nối
    // HV cũ, convert v2) — nhiều em KHÔNG có vết ghi danh mang `leadChildId`.
    input.tx.student.findMany({
      where: { leadChildId: input.leadChildId },
      select: { id: true },
    }),
  ]);
  const ids = [...new Set([...trace.map((t) => t.studentId), ...noiTrucTiep.map((s) => s.id)])];
  const students =
    ids.length > 0
      ? await input.tx.student.findMany({
          where: { id: { in: ids }, deletedAt: null },
          select: { id: true, name: true, parentPhone: true, leadChildId: true },
        })
      : [];

  const renamed: string[] = [];
  const leadIds = new Set<string>();
  for (const s of students) {
    if (s.name === newName) continue;
    await input.tx.student.update({
      where: { id: s.id },
      data: { name: newName },
    });
    await logStudentAudit({
      studentId: s.id,
      action: "UPDATE",
      actorId: input.actor.id,
      actorName: input.actor.name,
      oldValues: { name: s.name },
      newValues: { name: newName },
      changedFields: ["name"],
      reason: "Đồng bộ tên theo hồ sơ lead (sửa tên con ở màn Lead)",
      tx: input.tx,
    });
    const res = await syncStudentNameToCrm({
      tx: input.tx,
      studentId: s.id,
      oldName: s.name,
      newName,
      parentPhone: s.parentPhone,
      leadChildId: s.leadChildId,
      actor: input.actor,
    });
    res.leadIds.forEach((l) => leadIds.add(l));
    renamed.push(s.id);
  }

  return { studentIds: renamed, leadIds: [...leadIds] };
}
