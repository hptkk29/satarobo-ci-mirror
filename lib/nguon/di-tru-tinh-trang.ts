/**
 * lib/nguon/di-tru-tinh-trang.ts — TÌNH TRẠNG backfill quy nguồn: «còn bao nhiêu lead cũ chưa có quy nguồn». THUẦN ĐỌC (không ghi).
 *
 * HỢP ĐỒNG VỚI HƯỚNG D (cổng bật `nguon.enabled`): D gọi `docTinhTrangBackfill(tx)` làm precheck. Bốn số, ý nghĩa CỐ ĐỊNH:
 *  · `conThieuQuyNguon` — lead CÒN SỐNG chưa có `LeadAttribution` (gồm cả INVALID). 0 ⇒ backfill xong.
 *  · `invalid`          — trong số trên, lead có nhãn ngoài 28 dòng đã chốt ⇒ lệnh ghi TỪ CHỐI chạy; phải 0 trước khi bật `nguon.enabled`.
 *  · `manualReview`     — trong số trên, lead sẽ được GHI ở trạng thái xem tay (cùng định nghĩa `--expect-review` của lệnh ghi: `phanLoaiGhi` = MANUAL_REVIEW).
 *  · `daDiTru`          — `LeadAttribution` mang `matchedRule = 'DI_TRU'` (đã backfill).
 * Sau khi backfill xong và không còn lead mới thiếu quy nguồn: `conThieuQuyNguon === 0 && invalid === 0`.
 *
 * ⚠️ BẢNG QUY NGUỒN VẮNG (migration chưa chạy): hàm này KHÔNG ném lỗi Prisma. Nó hỏi `coBangQuyNguon(tx)` TRƯỚC, đọc lead với `coBangQuyNguon: false` (mọi lead sống là «còn thiếu»,
 * `daDiTru = 0`) và trả `coBangQuyNguon: false` + `sanSang: false`. Lý do phải là trường RIÊNG chứ không chỉ dựa vào bốn số: bảng vắng + 0 lead ra bốn số đều 0, và `sanSang`
 * suy từ bốn số sẽ là TRUE — cổng mở đúng lúc chưa có chỗ để ghi nguồn. Hướng D (cutover) đọc `coBangQuyNguon` để nói đúng lý do «migration chưa chạy».
 *
 * Chạy được trong transaction READ ONLY; nặng tương đương một lượt báo cáo di trú (đọc nhân viên + lịch sử đổi mã) — dùng làm precheck, KHÔNG gọi trong vòng lặp.
 */
import type { Prisma } from "@prisma/client";
import { coBangQuyNguon } from "./co-bang-quy-nguon";
import { phanLoaiGhi } from "./di-tru-ke-hoach";
import { docDuLieuDiTru } from "./di-tru-db";

type Tx = Prisma.TransactionClient;

export type TinhTrangBackfill = {
  conThieuQuyNguon: number;
  invalid: number;
  manualReview: number;
  daDiTru: number;
  /** Bảng `LeadAttribution` đã có trong DB này chưa (migration quy nguồn đã chạy chưa). `false` ⇒ bốn số trên chỉ là «mọi lead sống đều còn thiếu», không phải tình trạng backfill. */
  coBangQuyNguon: boolean;
  /** Dẫn xuất (D đọc nó làm cổng): `coBangQuyNguon && conThieuQuyNguon === 0 && invalid === 0`. KHÔNG phải trường ghi — đừng thêm nguồn thứ hai. */
  sanSang: boolean;
};

export async function docTinhTrangBackfill(tx: Tx): Promise<TinhTrangBackfill> {
  const coBang = await coBangQuyNguon(tx);
  const kq = await docDuLieuDiTru(tx, { coBangQuyNguon: coBang, phamVi: "TAT_CA", den: null });
  let invalid = 0;
  let manualReview = 0;
  for (const h of kq.hang) {
    const loai = phanLoaiGhi(h.kq);
    if (loai === "INVALID") invalid += 1;
    else if (loai === "MANUAL_REVIEW") manualReview += 1;
  }
  const daDiTru = coBang ? await tx.leadAttribution.count({ where: { matchedRule: "DI_TRU" } }) : 0;
  const conThieuQuyNguon = kq.hang.length;
  return { conThieuQuyNguon, invalid, manualReview, daDiTru, coBangQuyNguon: coBang, sanSang: coBang && conThieuQuyNguon === 0 && invalid === 0 };
}
