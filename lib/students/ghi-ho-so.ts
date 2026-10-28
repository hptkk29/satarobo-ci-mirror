// lib/students/ghi-ho-so.ts — LƯỢT GHI hồ sơ học viên + mọi bản sao đổi theo (26/09/2026).
//
// Vì sao lượt ghi rời khỏi `updateStudent` (app/(admin)/admin/students/_actions.ts): action
// đó chạy trong `scopedDb(actor).$transaction`, nơi mọi lượt ĐỌC Lead/Student bị lọc theo cơ
// sở của người sửa. Đồng bộ hai chiều (`dong-bo-lead-db.ts`) phải thấy phiếu lead + anh chị
// em của CÙNG gia đình dù họ nằm ở cơ sở nào — đọc qua scope là bỏ sót IM LẶNG.
//
// Giao kèo với bên gọi (bắt buộc, file này KHÔNG tự kiểm):
//   · đã `auth()` + `students:edit` + HV thuộc tầm nhìn cơ sở (và cơ sở đích nếu đổi);
//   · `truoc` đọc bằng `SNAPSHOT_HO_SO` NGAY trước lượt gọi;
//   · `data` đã qua validator + các cổng PII/CCCD/mã học viên của action.

import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { detectChangedFields, logStudentAudit } from "@/lib/audit/log";
import { syncStudentNameToCrm } from "./sync-name";
import { dongBoTuHocVien, type NguoiDongBo } from "./dong-bo-lead-db";
import { CHON_CON_HOC_VIEN, CHON_PH_HOC_VIEN } from "./dong-bo-lead";

/**
 * Ảnh chụp hồ sơ dùng cho nhật ký + đồng bộ. Gồm mọi ô định danh (ghi vào nhật ký như trước)
 * CỘNG đủ các ô chung với lead — thiếu ô nào thì ô đó không bao giờ được dội sang lead.
 */
export const SNAPSHOT_HO_SO = {
  name: true,
  studentCode: true,
  leadId: true,
  leadChildId: true,
  centerId: true,
  status: true,
  // Đủ bộ ô chung với lead (dong-bo-lead.ts) — gồm cả các ô định danh cũ (ngày sinh, giới
  // tính, tên/SĐT phụ huynh) và 3 ô người lớn 25/09. `detectChangedFields` so Date theo mốc
  // thời gian nên lưu lại cùng ngày không đẻ dòng "đã đổi" giả.
  ...CHON_PH_HOC_VIEN,
  ...CHON_CON_HOC_VIEN,
} as const;

export type AnhHoSo = Prisma.StudentGetPayload<{ select: typeof SNAPSHOT_HO_SO }>;

export async function ghiHoSoHocVien(input: {
  studentId: string;
  data: Prisma.StudentUpdateInput;
  truoc: AnhHoSo;
  actor: NguoiDongBo;
}): Promise<{ leadIds: string[]; studentIds: string[] }> {
  const { studentId, truoc, actor } = input;
  return db.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    const sau = await tx.student.update({
      where: { id: studentId },
      data: input.data,
      select: SNAPSHOT_HO_SO,
    });

    await logStudentAudit({
      studentId,
      action: "UPDATE",
      actorId: actor.id,
      actorName: actor.name,
      oldValues: truoc,
      newValues: sau,
      changedFields: detectChangedFields(truoc, sau),
      tx,
    });

    const leadIds = new Set<string>();
    const studentIds = new Set<string>();

    // 08/08 — ĐỔI TÊN HV DỘI SANG CRM (LeadChild.fullName · Lead.childName · ParentFeedback).
    if (truoc.name !== sau.name) {
      const res = await syncStudentNameToCrm({
        tx,
        studentId,
        oldName: truoc.name,
        newName: sau.name,
        parentPhone: sau.parentPhone ?? truoc.parentPhone,
        leadChildId: sau.leadChildId,
        actor,
      });
      res.leadIds.forEach((id) => leadIds.add(id));
    }

    // 26/09 — các ô chung còn lại: phiếu lead nguồn, đứa con trong phiếu, anh chị em.
    const r = await dongBoTuHocVien({
      tx,
      studentId,
      leadId: sau.leadId,
      leadChildId: sau.leadChildId,
      truoc,
      sau,
      actor,
    });
    r.leadIds.forEach((id) => leadIds.add(id));
    r.studentIds.forEach((id) => studentIds.add(id));

    return { leadIds: [...leadIds], studentIds: [...studentIds] };
  });
}
