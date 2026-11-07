import "server-only";
import { db } from "@/lib/db";
import { maLoiAnToan } from "./crm";

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
    const r = await db.lead.updateMany({ where: { id: bai.leadId, email: null }, data: { email: bai.emailTo.trim().slice(0, 254) } });
    return r.count === 1 ? "DA_GAT" : "KHONG_DOI";
  } catch (err) {
    const ma = maLoiAnToan(err);
    console.error("[disc:crm] gắn email:", ma);
    return "KHONG_DOI";
  }
}
