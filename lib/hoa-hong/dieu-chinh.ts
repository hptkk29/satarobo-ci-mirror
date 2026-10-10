// lib/hoa-hong/dieu-chinh.ts — phép tính THUẦN của ĐIỀU CHỈNH sổ (PR5b): chênh lệch khi khoản thu bị rút / khoản hoàn bị bác, và luật giải hàng chờ.
//
// Nguồn: docs/source-commission/04 §10.4 (chênh lệch trên Σ ròng — L14), §10.5 (giải `PAYMENT_WITHDRAWN` / `INPUT_DRIFT`), §11.
//
// Nguyên tắc: MỌI điều chỉnh là DÒNG MỚI mang CHÊNH LỆCH so với Σ ròng hiện tại của (ô × vai × người) — không bao giờ sửa dòng cũ (L2) và không bao giờ
// dựa vào "dòng ORIGINAL" (sau một lần hoàn thì ORIGINAL không còn nói lên số đang nợ — L14).
import type { CommissionHoldCode } from "@prisma/client";

import { MA_DOI_DUOC_SANG_KY_SAU } from "./hang-cho-so-nhom";
import { HoaHongError } from "./kieu";
import type { KhoaNguoi } from "./khoa-so";
import type { ChenhNguoi } from "./o-tinh";

/**
 * Giải hàng chờ `PAYMENT_WITHDRAWN` bằng "ĐẢO": thu hồi TOÀN BỘ số ròng của ô (khoản thu rời thực thu ⇒ không còn căn cứ để chi).
 * `chenh = −ròng` từng người; người ròng = 0 không có dòng.
 */
export function chenhDaoSach(rong: ReadonlyMap<KhoaNguoi, number>): ChenhNguoi[] {
  return [...rong.entries()]
    .filter(([, r]) => r !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, r]) => ({ key, chenh: -r, kyVong: 0, rong: r }));
}

/**
 * Giải `PAYMENT_WITHDRAWN` của một khoản HOÀN bị kế toán bác (khoản hoàn không còn hiệu lực): trả lại đúng số đã thu hồi.
 * `chenh = −Σ REVERSAL` của người đó (REVERSAL âm ⇒ chênh dương). Người có Σ = 0 không có dòng.
 */
export function chenhKhoiPhucHoan(dongDao: readonly { key: KhoaNguoi; amount: number }[]): ChenhNguoi[] {
  const tong = new Map<KhoaNguoi, number>();
  for (const d of dongDao) tong.set(d.key, (tong.get(d.key) ?? 0) + d.amount);
  return [...tong.entries()]
    .filter(([, t]) => t !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, t]) => ({ key, chenh: -t, kyVong: 0, rong: 0 }));
}

export type QuyetDinhGiai = "AP_DUNG" | "GIU_NGUYEN";
/** Hai mã hàng chờ mà người duyệt giải bằng "áp dụng" hoặc "giữ nguyên" (04 §10.5). Mã khác tự giải ở lượt quét sau hoặc sửa dữ liệu rồi Tính lại. */
export const MA_GIAI_DUOC: ReadonlySet<CommissionHoldCode> = new Set<CommissionHoldCode>(["INPUT_DRIFT", "PAYMENT_WITHDRAWN"]);

/**
 * Cổng của `giaiHangCho` (THUẦN). Trả `null` = cho qua; chuỗi = lý do từ chối (tiếng Việt, hiện thẳng cho người dùng).
 * Lý do ≥ 10 ký tự bắt buộc cho CẢ HAI quyết định (05 §4): "đảo" cũng là một quyết định tiền cần giải trình.
 */
export function kiemGiaiHangCho(i: { code: CommissionHoldCode; trangThai: string; quyetDinh: QuyetDinhGiai }): string | null {
  if (i.trangThai !== "OPEN") return "Hàng chờ đã được xử lý.";
  if (!MA_GIAI_DUOC.has(i.code)) {
    // Chỉ hứa "dời sang kỳ sau" cho đúng tập mã mà nút dời có thật (cùng nguồn với nút: `MA_DOI_DUOC_SANG_KY_SAU`).
    return `Hàng chờ loại ${i.code} không giải bằng áp dụng/giữ nguyên — sửa dữ liệu hoặc chính sách rồi Tính lại${MA_DOI_DUOC_SANG_KY_SAU.includes(i.code) ? ", hoặc dời sang kỳ sau ở tab Sổ" : ""}.`;
  }
  if (i.quyetDinh !== "AP_DUNG" && i.quyetDinh !== "GIU_NGUYEN") return "Quyết định không hợp lệ.";
  return null;
}

export function batGiaiHangCho(i: Parameters<typeof kiemGiaiHangCho>[0]): void {
  const loi = kiemGiaiHangCho(i);
  if (loi) throw new HoaHongError("HANG_CHO_KHONG_GIAI_DUOC", loi);
}
