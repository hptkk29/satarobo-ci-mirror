// lib/affiliate/index.ts — BGĐ 31/07: nguồn giới thiệu (affiliate).
//
// Khách vào site qua link `satarobo.vn/...?ref=<code>` → form gửi kèm `ref` →
// lead được gắn `affiliateId`. Cũng gán tay được ở màn Lead.
//
// ⚠️ Hoa hồng: mức % + thời điểm chốt trả CHƯA có quy chế BGĐ. Ở đây chỉ ghi
// NGUỒN + `commissionPercent` tham chiếu để đối soát tay — KHÔNG tự sinh phiếu chi.

import { db } from "@/lib/db";

/** Nhãn nguồn hiển thị cho lead đến từ affiliate (dùng cho Lead.source). */
export const AFFILIATE_SOURCE_LABEL = "Giới thiệu (Affiliate)";

/**
 * Chuẩn hoá mã giới thiệu: chữ HOA + số, bỏ dấu và ký tự lạ.
 * Nhờ vậy `?ref=an-nguyen`, `?ref=AN NGUYEN` đều về `ANNGUYEN`. THUẦN.
 */
export function normalizeAffiliateCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 32);
  return code.length >= 3 ? code : null;
}

/**
 * Tra affiliate ĐANG HOẠT ĐỘNG theo mã. Mã sai/tắt → null (lead vẫn được tạo,
 * chỉ là không gắn nguồn giới thiệu) — KHÔNG bao giờ chặn luồng đăng ký.
 */
export async function resolveAffiliateByCode(
  raw: string | null | undefined,
): Promise<{ id: string; code: string; name: string } | null> {
  const code = normalizeAffiliateCode(raw);
  if (!code) return null;
  try {
    return await db.affiliate.findFirst({
      where: { code, isActive: true },
      select: { id: true, code: true, name: true },
    });
  } catch {
    return null;
  }
}
