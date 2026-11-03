// lib/crm/lead-qualify.ts — R1-04: chuyển hội thoại L1 → Lead L2 (SR.QD.217).
// Có SĐT + note → tạo Lead (qualifiedAt), dedup phone 90 ngày, set commissionSource.
import type { CommissionSource, Lead } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { canonicalPhone, isValidPhoneVN, phoneVariants } from "@/lib/phone";

export class LeadQualifyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LeadQualifyError";
    this.code = code;
  }
}

/**
 * Chuẩn hoá SĐT VN → canonical `84XXXXXXXXX`. THUẦN.
 * AUTH-SĐT P1 — trước đây chỉ `replace(/\D/g,"")` nên `090 123 4567` ra `0901234567`
 * còn `+84 90-123-4567` ra `84901234567`: **cùng một số, hai khoá khác nhau**.
 */
export function normalizePhone(raw: string | null | undefined): string {
  return canonicalPhone(raw) ?? (raw ?? "").replace(/\D/g, "");
}

/**
 * C4.2 — đạt L2 cần SĐT hợp lệ. THUẦN.
 *
 * ⚠️ **ĐỔI HÀNH VI (AUTH-SĐT P1):** trước đây chỉ đếm "≥8 chữ số", nên
 * `12345678` hay số cố định `02363…` cũng qua được, rồi được ghi thẳng vào
 * `Lead.phone`. Khi `Lead.phone` sắp thành nguồn của khoá đăng nhập thì đó là
 * đường đưa rác vào cột định danh — và tạo ra lead **không bao giờ convert nổi**
 * thành tài khoản. Nay yêu cầu đúng SĐT DI ĐỘNG VN.
 */
export function canQualify(phone: string | null | undefined): boolean {
  return isValidPhoneVN(phone);
}

/** C4.4 — suy commissionSource (THUẦN). */
export function determineCommissionSource(input: {
  isReferral?: boolean;
  isSaleSelf?: boolean;
}): CommissionSource {
  if (input.isReferral) return "REFERRAL";
  if (input.isSaleSelf) return "SALE_SELF";
  return "MARKETING_ADMIN"; // mặc định: lead từ ads/Page → Sale Admin xử lý
}

/**
 * Tạo Lead L2 từ hội thoại. Dedup theo phone trong 90 ngày (C4.3) → nối hội thoại
 * vào lead cũ thay vì tạo trùng. Trả {lead, deduped}.
 */
export async function qualifyConversationToLead(input: {
  conversationId: string;
  phone: string;
  parentName?: string | null;
  note?: string | null;
  commissionSource: CommissionSource;
  adminId?: string | null;
  now?: Date;
}): Promise<{ lead: Lead; deduped: boolean }> {
  if (!canQualify(input.phone)) {
    throw new LeadQualifyError("NO_PHONE", "Thiếu SĐT hợp lệ — chưa đạt L2.");
  }
  const now = input.now ?? new Date();
  const phone = normalizePhone(input.phone);

  const conv = await db.messengerConversation.findUnique({ where: { id: input.conversationId } });
  if (!conv) throw new LeadQualifyError("CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại.");

  // Dedup phone trong cửa sổ cấu hình (C4.3) — SystemSetting "crm.dedupWindowDays" (default 90).
  const dedupWindowDays = await getSetting("crm.dedupWindowDays");
  const cutoff = new Date(now.getTime() - dedupWindowDays * 86_400_000);
  // AUTH-SĐT P1 — tra theo CẢ dạng canonical mới lẫn dạng `0…` cũ còn trong DB,
  // nếu không thì ngày đổi đường ghi là ngày dedup 90 ngày ngừng bắt trùng.
  const existing = await db.lead.findFirst({
    where: { phone: { in: phoneVariants(phone) }, deletedAt: null, createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
  });

  let lead: Lead;
  let deduped = false;
  if (existing) {
    lead = existing;
    deduped = true;
  } else {
    lead = await db.lead.create({
      data: {
        parentName: input.parentName ?? conv.parentName ?? "Khách Messenger",
        phone,
        note: input.note ?? null,
        centerId: conv.centerId,
        qualifiedAt: now,
        // 15/09/2026 — BẮT BUỘC. Danh sách /leads sắp theo `lastInboundAt` với
        // `nulls: 'last'`, nên lead tạo mà bỏ trống cột này bị đẩy xuống CUỐI mọi
        // trang — người dùng báo "nhập xong không thấy lead đâu", nhưng tìm theo
        // SĐT/nguồn thì lại ra (tập kết quả nhỏ nên nó lọt trang 1).
        // Quy ước: lúc tạo, `lastInboundAt` = `createdAt`; `laNhapLai()` chỉ đúng
        // khi nó LỚN HƠN `createdAt`. Xem `lib/tables/lead-columns.ts`.
        lastInboundAt: new Date(),
        commissionSource: input.commissionSource,
        adminId: input.adminId ?? null,
      },
    });
  }

  await db.messengerConversation.update({
    where: { id: conv.id },
    data: { leadId: lead.id, phone, status: "QUALIFIED" },
  });

  return { lead, deduped };
}
