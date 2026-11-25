// lib/finance/hoa-don/chua-khop.ts — giao dịch ngân hàng CHƯA KHỚP (UNMATCHED) theo SĐT, cho vế
// "CHUA_KHOP_CUNG_SO" của nghi trùng (`gomLanThu`). THUẦN.
//
// Hai nơi cùng dùng MỘT luật bóc (PLAN GĐ 8 mục 13a): loader màn hoá đơn (`hang-cho.ts`, nạp mọi giao
// dịch chưa khớp trong tầm nhìn) và bước chốt (`chot-hoa-don.ts`, kiểm LẠI trong transaction chỉ với các
// giao dịch cùng số tiền với khoản khai tay). Viết luật ở hai chỗ là để hai chỗ lệch nhau: màn nói "không
// trùng" mà cổng từ chối, hay ngược lại.
//
// ⚠️ `content` chứa SĐT — chỉ dùng để bóc SĐT ở server, KHÔNG đưa xuống client.

import { extractVnPhoneCandidates } from "@/lib/payments/sdt-trong-memo";

export type GiaoDichChuaKhopTho = { provider: string; amount: number; content: string | null };

/**
 * SĐT (dạng chuẩn `84…`, cùng dạng `canonicalPhone`) → số tiền của giao dịch chưa khớp mang SĐT đó.
 * Loại giao dịch giả BACKFILL (PLAN §3.4) — không phải tiền thật về tài khoản.
 */
export function chuaKhopTheoSdt(rows: readonly GiaoDichChuaKhopTho[]): Map<string, { amount: number }[]> {
  const kq = new Map<string, { amount: number }[]>();
  for (const g of rows) {
    if (g.provider.toUpperCase() === "BACKFILL") continue;
    for (const sdt of extractVnPhoneCandidates(g.content)) {
      const ds = kq.get(sdt) ?? [];
      ds.push({ amount: g.amount });
      kq.set(sdt, ds);
    }
  }
  return kq;
}
