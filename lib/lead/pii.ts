// lib/lead/pii.ts — #11 T2 (OI-4, Kiệt ký 10/07): mask PII lead theo quyền leads:view-pii.
//
// Q7 — PII lead gồm: SĐT, email, tên PH, tên HS (LeadChild), nội dung tư vấn
// (note/handoverNote/LeadActivity). Actor KHÔNG có `leads:view-pii` (v1 matrix:
// SUPER_ADMIN/CENTER_MANAGER/SALES_CSM/MARKETING — MARKETING mở 21/07 cho
// outreach, commit 69876d0; v2 seed tương ứng HO_MARKETING) → thấy bản mask.
//
// Check quyền: dùng `await canViewLeadPii()` (lib/auth/check-permission — qua
// checkPermission, chấm CẢ v1 lẫn v2 theo cờ RBAC_V2_ENABLED). KHÔNG import
// check-permission vào file này: pii.ts là module THUẦN có unit test riêng
// (pii.test.ts) — dính chuỗi next-auth là vỡ môi trường vitest. Mask ở SERVER
// trước khi truyền xuống client (chặn leak qua RSC payload, không chỉ che ở UI).
import { maskPhone, maskEmail } from "@/lib/utils";

export { maskPhone, maskEmail };

/** "Nguyễn Thị Lan" → "Nguyễn T. L." — giữ họ để Marketing vẫn phân biệt được lead. */
export function maskPersonName(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0]?.slice(0, 1) + "•••";
  return parts[0] + " " + parts.slice(1).map((p) => p.slice(0, 1) + ".").join(" ");
}

/** Nội dung tư vấn/ghi chú — ẩn hẳn (không mask từng phần, nội dung tự do dễ lộ). */
export const MASKED_TEXT = "••• (cần quyền xem PII lead — leads:view-pii)";

export function maskFreeText(v: string | null | undefined): string | null {
  if (v == null || v === "") return v ?? null;
  return MASKED_TEXT;
}

// ─────────────────────────────────────────────────────────────────────────────
// Đợt E (22/08/2026) — cắt liên hệ TRONG một đoạn văn tự do
// ─────────────────────────────────────────────────────────────────────────────
// Hai biểu thức này là NGUỒN DUY NHẤT của câu hỏi "cái gì trông giống liên hệ".
// `lib/chat/queries.ts` (BR-30) uỷ quyền về đây — trước 22/08 nó giữ bản sao
// riêng, và hai bản sao là hai luật sẽ trôi lệch.
//
// Bắt: 0/84/+84 + đầu số di động VN (3|5|7|8|9) + 8 số. Cố ý KHÔNG bắt số cố
// định và dãy số bất kỳ — bắt rộng thì "học phí 2500000" cũng bị đục, và một
// màn hình đục lỗ khắp nơi sẽ bị người dùng bỏ qua chứ không được tin.
const PHONE_LIKE_RE = /(?<![0-9])(?:\+?84|0)(?:3|5|7|8|9)[0-9]{8}(?![0-9])/g;
const EMAIL_LIKE_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Che SĐT/email nằm LẪN trong nội dung tự do, GIỮ phần còn lại đọc được.
 *
 * Khác {@link maskFreeText} (ẩn hẳn cả đoạn): dùng cho chỗ mà nội dung vẫn phải
 * đọc được để làm việc — inbox Messenger, nhật ký hội thoại. Che cột `phone` mà
 * để nguyên câu "sdt em 0905123456" thì việc che chỉ là hình thức.
 *
 * ⚠️ Đây là rào chống TIỆN TAY, không phải chống cố ý: ai đọc được toàn bộ hội
 * thoại thì gần như luôn moi được cách liên lạc (khách gõ số tách ra từng cụm,
 * gửi ảnh, hẹn gặp…). Đừng bán nó như một bảo đảm.
 */
export function redactContactsInText(v: string | null | undefined): string | null {
  if (v == null || v === "") return v ?? null;
  return v.replace(EMAIL_LIKE_RE, "•••").replace(PHONE_LIKE_RE, "•••");
}

/**
 * Bộ field PII chung của Lead — mask 1 lượt, giữ nguyên field khác.
 *
 * ⚠️ Danh sách khoá ở đây phải khớp `sensitiveFields` của `leads:view-pii`
 * (`lib/permissions/registry/crm.ts`) — thêm một chỗ mà quên chỗ kia là màn
 * "quyền này che những gì" nói sai với thứ hệ thống thực sự làm.
 *
 * ⚠️ Địa chỉ (`city`/`ward`/`addressLine`) CỐ Ý không nằm trong bộ này: đó là dữ
 * liệu địa bàn để lọc/nhóm/xuất, không phải danh tính. Trước G-01 nó bị nhét vào
 * `note` nên bị che lây theo `note` — chính là nợ N-1 mà G-01 gỡ.
 */
export function maskLeadPiiFields<
  T extends {
    parentName?: string | null;
    phone?: string | null;
    email?: string | null;
    childName?: string | null;
    note?: string | null;
    parentDob?: Date | string | null;
    lostNote?: string | null;
  },
>(lead: T, canViewPii: boolean): T {
  if (canViewPii) return lead;
  return {
    ...lead,
    ...(lead.parentName != null ? { parentName: maskPersonName(lead.parentName) } : {}),
    ...(lead.phone != null ? { phone: maskPhone(lead.phone) } : {}),
    ...(lead.email != null ? { email: lead.email ? maskEmail(lead.email) : lead.email } : {}),
    ...(lead.childName != null ? { childName: lead.childName ? maskPersonName(lead.childName) : lead.childName } : {}),
    ...(lead.note !== undefined ? { note: maskFreeText(lead.note) } : {}),
    // C-05 — LÝ DO RỚT (`Lead.lostNote`, quyết định B5 + 12(b) 24/08/2026). Ô ghi chú
    // TỰ DO nên cùng luật với `note`: ẩn HẲN, không mask từng phần. Bảng "Lead rớt" là
    // chỗ đầu tiên in cột này ra hàng loạt — che ở JSX thì dữ liệu thật vẫn xuống trình
    // duyệt qua RSC payload, nên phải cắt ở đây.
    ...(lead.lostNote !== undefined ? { lostNote: maskFreeText(lead.lostNote) } : {}),
    // G-01 — ngày sinh PH: GIẤU HẲN, không mờ hoá. Một ngày sinh mờ hoá
    // (01/01/1985) trông y hệt ngày sinh thật nên người đọc không biết mình đang
    // nhìn dữ liệu bịa. Chỉ chèn khoá khi phiếu THỰC SỰ có mang nó — select hẹp
    // không khai cột này thì đừng tự khẳng định "phụ huynh không có ngày sinh".
    ...(lead.parentDob !== undefined ? { parentDob: null } : {}),
  };
}
