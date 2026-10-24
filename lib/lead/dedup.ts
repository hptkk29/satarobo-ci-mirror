import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { recordLeadActivity } from "@/lib/lead/activity-write";
import { SYSTEM_ACTIVITY_META } from "@/lib/lead/activity-clock";
import { LEAD_CLOSED_STATUSES } from "@/lib/leads/status";
import { phoneVariants } from "@/lib/phone";

// =============================================================================
// LEAD DEDUP — chống trùng SĐT (Phase T1.3, luật đổi 26/09/2026)
//
// 🔴 SỰ CỐ PROD 26/09/2026 — "cùng SĐT mà thành hai lead":
//   0985779965 — lead nhập từ sheet (`scripts/import-legacy-leads.ts`) LÙI `createdAt`
//   về ngày nhận lead ghi trên sheet (21/05). Cửa sổ 90 ngày tính theo `createdAt` ⇒
//   lead cũ "quá hạn" dù VẪN ĐANG MỞ, cùng Sale giữ ⇒ phiếu mới đẻ lead thứ hai.
//
// Luật nay (chủ dự án chốt 26/09):
//   · Lead CÒN MỞ (mọi trạng thái trừ DA_MAT) cùng SĐT ⇒ LUÔN là trùng, KHÔNG xét tuổi.
//     Tuổi hồ sơ không nói gì về chuyện gia đình đó đã có người chăm hay chưa.
//   · Lead ĐÃ MẤT chỉ tính là trùng trong cửa sổ `crm.dedupWindowDays` (mặc định 90) —
//     đó là chỗ duy nhất cửa sổ còn ý nghĩa: quay lại sau lâu là nhu cầu mới.
//   · Có cả hai thì lead ĐANG MỞ thắng: gộp vào hồ sơ còn người chăm, đừng vào hồ sơ đã mất.
// =============================================================================

/** Tìm lead trùng SĐT theo luật trên (chưa xoá). */
export async function findRecentDuplicate(
  phone: string,
): Promise<{ id: string } | null> {
  // AUTH-SĐT P1 — so khớp cả canonical `84…` (đường ghi mới) lẫn `0…` (dữ liệu
  // cũ chưa backfill). So khớp đúng-bằng ở đây là chỗ dedup gãy âm thầm nhất.
  const variants = phoneVariants(phone);
  if (!variants.length) return null;

  const dangMo = await db.lead.findFirst({
    where: { phone: { in: variants }, deletedAt: null, status: { notIn: LEAD_CLOSED_STATUSES } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (dangMo) return dangMo;

  const windowDays = await getSetting("crm.dedupWindowDays");
  const since = new Date(Date.now() - windowDays * 86400 * 1000);
  return db.lead.findFirst({
    where: { phone: { in: variants }, deletedAt: null, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

/**
 * Việc hệ thống ĐÃ LÀM với phiếu trùng — bắt buộc khai (luật 7: để `tsc` liệt kê chỗ gọi).
 *
 * 🔴 26/09/2026 — câu cũ "đã chặn tạo lead trùng" được ghi cho CẢ nhánh tạo lead mới:
 * người đọc lịch sử lead cũ tin là không có hồ sơ nào khác, trong khi hồ sơ thứ hai (và
 * đơn thứ hai) đã ra đời. Dòng lịch sử phải nói đúng việc đã làm.
 */
export type KetQuaTrung = { kieu: "gop" } | { kieu: "tao-moi"; leadMoiId: string };

/**
 * Ghi log submit trùng vào LeadDuplicate + 1 LeadActivity NOTE trên lead gốc.
 */
export async function logDuplicateAttempt(
  primaryLeadId: string,
  phone: string,
  source: string | null,
  ketQua: KetQuaTrung,
): Promise<void> {
  const tuNguon = source ? ` từ nguồn "${source}"` : "";
  const viecDaLam =
    ketQua.kieu === "gop"
      ? "đã gộp vào lead này, không tạo lead mới."
      : `hồ sơ này đã mất nên hệ thống đã TẠO LEAD MỚI: /leads/${ketQua.leadMoiId}`;
  await db.$transaction(async (tx) => {
    await tx.leadDuplicate.create({
      data: { primaryLeadId, duplicatePhone: phone, source },
    });
    // N-4 — khách gửi lại phiếu LÀ một hoạt động trên lead gốc: đồng hồ
    // "chưa tiếp cận lại" phải nhảy, không thì lead vừa có tín hiệu nóng lại
    // nằm im trong danh sách treo.
    await recordLeadActivity({
      tx,
      leadId: primaryLeadId,
      actorName: "Hệ thống (web)",
      type: "NOTE",
      content: `[Trùng SĐT] Có submit mới cùng SĐT ${phone}${tuNguon} — ${viecDaLam}`,
      // S-3 — khách gửi lại phiếu là TÍN HIỆU từ khách, không phải Sale đã gọi
      // khách. Đồng hồ "chưa tiếp cận lại" vẫn nhảy (cú bump ở trên), nhưng mốc
      // "đã liên hệ lần đầu" thì KHÔNG — chưa ai nhấc máy cả.
      metadata: SYSTEM_ACTIVITY_META,
    });
  });
}
