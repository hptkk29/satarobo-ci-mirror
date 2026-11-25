import "server-only";
import { db } from "@/lib/db";
import { logLeadAudit } from "@/lib/audit/log";
import { CHON_PH_LEAD, type PhLead } from "@/lib/students/dong-bo-lead";
import { dongBoTuLead } from "@/lib/students/dong-bo-lead-db";
import { maLoiAnToan } from "./crm";

const NGUOI_DONG_BO = { id: null, name: "Hệ thống (DISC — email đã xác minh)" } as const;

/**
 * Email do người gõ khai CHỈ vào lead khi (a) bài đã được CHỦ SỐ nhận (CLAIMED) và (b) chính địa chỉ đó đã xác minh
 * (`emailVerifiedAt`) — N4. Chỉ điền khi lead CHƯA có email (không ghi đè). Không ném. Gọi ở cả hai thứ tự: sau nhận bài
 * và sau xác minh email (cái nào đến sau thì mới đủ điều kiện).
 */
export async function gatEmailDaXacMinhChoLead(submissionId: string): Promise<"DA_GAT" | "KHONG_DOI"> {
  try {
    const bai = await db.discSubmission.findUnique({
      where: { id: submissionId },
      select: { claimStatus: true, emailVerifiedAt: true, emailTo: true, leadId: true, deletedAt: true },
    });
    if (!bai || bai.claimStatus !== "CLAIMED" || bai.deletedAt || !bai.emailVerifiedAt || !bai.emailTo || !bai.leadId) return "KHONG_DOI";
    const email = bai.emailTo.trim().slice(0, 254);
    const leadId = bai.leadId;
    // 14/11/2026 — email đã xác minh là ô CHUNG của phiếu lead ↔ hồ sơ học viên (`Lead.email` ↔ `Student.parentEmail`):
    // ghi lead + dội sang học viên đang nối trong CÙNG một giao dịch (`tx` KHÔNG scope — `db.$transaction`).
    // Vẫn chỉ điền khi lead CHƯA có email: điều kiện nằm TRONG phép ghi nên hai lượt đua không đè nhau.
    const daGat = await db.$transaction(async (tx) => {
      const truoc = await tx.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: CHON_PH_LEAD });
      if (!truoc) return false;
      const r = await tx.lead.updateMany({ where: { id: leadId, email: null }, data: { email } });
      if (r.count !== 1) return false;
      await logLeadAudit({
        leadId,
        action: "UPDATE",
        actorId: null,
        actorName: NGUOI_DONG_BO.name,
        oldValues: { email: null },
        newValues: { email },
        changedFields: ["email"],
        reason: "Email đã xác minh từ bài DISC đã nhận",
        tx,
      });
      await dongBoTuLead({ tx, leadId, truoc: truoc as PhLead, sau: { email }, actor: NGUOI_DONG_BO });
      return true;
    });
    return daGat ? "DA_GAT" : "KHONG_DOI";
  } catch (err) {
    const ma = maLoiAnToan(err);
    console.error("[disc:crm] gắn email:", ma);
    return "KHONG_DOI";
  }
}
