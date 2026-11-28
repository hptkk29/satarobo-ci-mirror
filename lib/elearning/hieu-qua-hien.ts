/**
 * P8/QtHieuQua — HIỂN THỊ "Đánh giá theo từng ca" (R7) dạng MA TRẬN: mỗi người một dòng, bốn cột L1–L4 (thiết kế 20/11). THUẦN.
 *
 * KHÔNG đổi luật nào: vẫn là TỪNG CA, không gộp thành con số nhóm (xem ghi chú đầu trang R7 — n = 15 nên L3/L4 không có ý nghĩa thống kê). Mỗi ô lấy phiếu MỚI NHẤT
 * của (người, mức); chưa có phiếu ⇒ ô trống (`null`), KHÔNG điền 0. Chỉ hiện `score` đã lưu — không bịa lời nhận xét: nội dung chữ (phản hồi L1, nhận xét L3)
 * nằm ở `payloadJson` nhưng CHƯA có luồng nào ghi nó (đo 20/11/2026: không dòng mã nào tạo `TrnEvaluationResult`), nên màn chưa đọc nó.
 */
export const MUC_DANH_GIA = ["L1", "L2", "L3", "L4"] as const;
export type MucDanhGia = (typeof MUC_DANH_GIA)[number];

export type PhieuDanhGia = { subjectUserId: string; level: string; score: unknown; recordedAt: Date };

export type OMaTran = { diem: string; luc: Date } | null;
export type DongMaTran = { userId: string; o: Record<MucDanhGia, OMaTran>; soPhieu: number };

/** `Decimal` của Prisma / số / chuỗi ⇒ chuỗi đọc được, bỏ đuôi thập phân thừa ("11.00" ⇒ "11"); không phải số ⇒ null. */
export function chuoiDiem(score: unknown): string | null {
  if (score === null || score === undefined) return null;
  const n = Number(String(score));
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

export function maTranTheoNguoi(ds: readonly PhieuDanhGia[]): DongMaTran[] {
  const theoNguoi = new Map<string, DongMaTran>();
  for (const p of ds) {
    const muc = (MUC_DANH_GIA as readonly string[]).includes(p.level) ? (p.level as MucDanhGia) : null;
    let dong = theoNguoi.get(p.subjectUserId);
    if (!dong) {
      dong = { userId: p.subjectUserId, o: { L1: null, L2: null, L3: null, L4: null }, soPhieu: 0 };
      theoNguoi.set(p.subjectUserId, dong);
    }
    dong.soPhieu += 1;
    if (!muc) continue;
    const diem = chuoiDiem(p.score);
    if (diem === null) continue; // phiếu không có điểm không chiếm ô (ô trống nói đúng "chưa có điểm")
    const cu = dong.o[muc];
    if (!cu || p.recordedAt > cu.luc) dong.o[muc] = { diem, luc: p.recordedAt };
  }
  return [...theoNguoi.values()];
}
