// lib/uat/chuan-hoa-nhan-seed.ts — BẢNG ĐỔI NHÃN `Lead.source` cho lead CỦA BỘ SEED UAT cũ trên DB TEST. THUẦN (không DB, không import chạm DB).
//
// Vì sao có: bản cũ của hai bộ seed (`prisma/seed-uat/02-crm.ts`, `08-noi-lead.ts`) gieo 8 nhãn nằm NGOÀI bảng 28 nhãn đã chốt 06/10/2026 (`lib/nguon/anh-xa-nhan-cu.ts`) ⇒ `INVALID`.
// Hai mảng seed đã sửa ở `prisma/seed-uat/nhan-nguon.ts` (11/10/2026) nhưng DB TEST đã được gieo từ TRƯỚC — 232 lead mang nhãn cũ. `INVALID > 0` chặn `--apply` của
// vét lead cũ và chặn đặt mốc cutover (checklist 09 bước 16–17). Công cụ này sửa ĐÚNG phần dữ liệu thử đó, không sửa quy tắc.
//
// Bảng dưới đây CHÉP đúng chú thích "nhãn CŨ → nhãn mới" của `nhan-nguon.ts` (nguồn quyết định duy nhất cho phép đổi này); lưới `[CHS-*]` canh hai bản không lệch nhau.
//
// ⚠️ Riêng `NTPOS` KHÔNG nằm trong tài liệu nào: đo 12/10/2026 trên DB test, 15 lead nhãn này tạo 11/10 22:14 → 12/10 00:16, cách đều ~2 phút, trạng thái MỚI, có 1–3 hoạt động —
// dấu vết một đợt nghiệm thu POS trên test; KHÔNG có dòng mã nào trong repo sinh ra nhãn này (git grep -i ntpos = 0). Đổi sang «Nguồn KH tự đến Trung Tâm» (khách vãng lai tại quầy)
// chỉ là DỌN DỮ LIỆU THỬ cho tới khi chủ nghiệm thu POS nói khác — nó KHÔNG phải quyết định kinh doanh và KHÔNG được áp cho prod.

import { chuanHoaNhanNguon } from "@/lib/nguon/anh-xa-nhan-cu";

export type DongDoiNhan = { readonly cu: string; readonly moi: string; readonly lyDo: string };

/** Thứ tự cố định (báo cáo và lưới so theo thứ tự này). */
export const BANG_DOI_NHAN_SEED: readonly DongDoiNhan[] = [
  { cu: "Facebook Ads", moi: "Ads", lyDo: "seed UAT cũ" },
  { cu: "Messenger Page HO", moi: "Nguồn từ Marketing Hội Sở từ Quảng Cáo", lyDo: "seed UAT cũ — Page HO do Marketing Hội sở chạy quảng cáo" },
  { cu: "Vãng lai", moi: "Nguồn KH tự đến Trung Tâm", lyDo: "seed UAT cũ" },
  { cu: "Google", moi: "Ads", lyDo: "seed UAT cũ" },
  { cu: "Zalo OA", moi: "Organic", lyDo: "seed UAT cũ" },
  { cu: "Sự kiện trường học", moi: "Tự khai thác", lyDo: "seed UAT cũ — Sale tự đi khai thác ở trường" },
  { cu: "Tờ rơi", moi: "Organic", lyDo: "seed UAT cũ" },
  { cu: "Quà tặng", moi: "quatang", lyDo: "seed UAT cũ — nhãn #5 của bảng" },
  { cu: "NTPOS", moi: "Nguồn KH tự đến Trung Tâm", lyDo: "dấu vết nghiệm thu POS trên test (không có trong tài liệu) — dọn dữ liệu thử" },
];

/** Khoá so sánh nhãn: cùng chuẩn hoá với bảng ánh xạ (NFC, thường, gộp khoảng trắng). */
export const khoaNhan = (s: string): string | null => chuanHoaNhanNguon(s);

export type KeHoachDoiNhan = { cu: string; moi: string; lyDo: string; soLead: number };

/**
 * Dựng kế hoạch từ số đếm theo nhãn hiện có. CHỈ nhãn nằm trong bảng đổi mới được đụng; nhãn khác (kể cả nhãn hợp lệ, kể cả nhãn lạ khác) KHÔNG bao giờ lọt vào kế hoạch.
 * `demTheoNhan` khoá = nhãn NGUYÊN VĂN trong DB (khớp chính xác, không chuẩn hoá — `UPDATE … WHERE source = $1` cũng khớp chính xác).
 */
export function dungKeHoachDoiNhan(demTheoNhan: ReadonlyMap<string, number>): KeHoachDoiNhan[] {
  const out: KeHoachDoiNhan[] = [];
  for (const d of BANG_DOI_NHAN_SEED) {
    const n = demTheoNhan.get(d.cu) ?? 0;
    if (n > 0) out.push({ cu: d.cu, moi: d.moi, lyDo: d.lyDo, soLead: n });
  }
  return out;
}
