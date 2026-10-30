// lib/ai-lead/dich-vu/lien-ket-inbox.ts — NÚT «Mở hội thoại Facebook»: chỉ có khi có mẫu link hợp lệ VÀ mã hội thoại hợp lệ (OD-03). HÀM THUẦN.
// Dựng link nằm ở `dungLinkHoiThoai` (hop-dong.ts: khoá host facebook.com/business.facebook.com, mã đã encode). Tệp này chỉ quyết định HIỆN GÌ.
import { dungLinkHoiThoai } from "../hop-dong";

export type KhoiLienKet = { loai: "LINK"; href: string } | { loai: "HUONG_DAN_TAY"; lyDo: "CHUA_CO_MAU" | "CHUA_CO_MA_HOI_THOAI" };

export function khoiLienKetHoiThoai(mau: string, inboxThreadId: string | null): KhoiLienKet {
  if (mau.trim() === "") return { loai: "HUONG_DAN_TAY", lyDo: "CHUA_CO_MAU" };
  if (!inboxThreadId) return { loai: "HUONG_DAN_TAY", lyDo: "CHUA_CO_MA_HOI_THOAI" };
  const href = dungLinkHoiThoai(mau, inboxThreadId);
  // Mẫu hỏng hoặc mã không đúng khuôn ⇒ coi như không có link (không bao giờ dựng link «gần đúng»).
  return href === null ? { loai: "HUONG_DAN_TAY", lyDo: "CHUA_CO_MAU" } : { loai: "LINK", href };
}
