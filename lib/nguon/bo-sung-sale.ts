/**
 * lib/nguon/bo-sung-sale.ts — NÚT «BỔ SUNG SALE PHỤ TRÁCH PHỤ HUYNH» ở khối Nguồn của lead. THUẦN (không DB, không đồng hồ thật — `now` bắt buộc).
 *
 * Hold `THIEU_SALE_PHU_HUYNH` (cờ xem tay `THIEU_SALE_PH`) chỉ có MỘT đường thoát: `boSungSalePhuHuynh` (`doi-nguon-lead.ts`). Màn hình phải nói thật về đường đó
 * (luật 12 — nút là lời hứa): nút chỉ vẽ khi máy chủ SẼ nhận. Ba vế, đứng theo thứ tự sau, MỖI vế lấy từ đúng hàm mà cổng máy chủ gọi — không viết lại điều kiện:
 *
 *   1. LEAD THẬT SỰ THIẾU — PH giới thiệu (`referrerKind = PARENT`) ∧ chưa có Sale (`referrerSaleUserId` NULL) ∧ có phụ huynh hoặc bé để đối chiếu.
 *      (Cổng của service: «chỉ điền chỗ trống», first-claim — Sale đã ghi nhận không bao giờ bị thay bằng đường này.)
 *   2. ĐỦ QUYỀN — `quyenDoiNguon` (doi-nguon.ts): chưa thu cần `leads:overwrite`; ĐÃ có thu cần `sources:override-after-payment` (hold sinh từ một khoản thu nên
 *      trên thực tế gần như luôn là vế này); nguồn đang khoá cần thêm `sources:manage`. Đây là cùng kết quả mà nút «Đổi nguồn» dùng.
 *   3. NGUỒN CỦA LEAD CÒN CHỌN ĐƯỢC — `nguonChonDuoc` (hieu-luc-nguon.ts), cùng hàm với cổng 3 của `quyetDinhDoiNguon`. Service đổi nguồn gọi lại ĐÚNG nguồn hiện tại của lead,
 *      nên nguồn đã ngừng/lưu trữ/ngoài hiệu lực ⇒ bị từ chối «Nguồn mới không còn dùng được». Nói rõ để người dùng biết phải mở lại nguồn trước, thay vì vẽ một nút chắc chắn ăn từ chối.
 *
 * Thứ tự: KHÔNG CẦN → THIẾU QUYỀN → NGUỒN NGỪNG → ĐƯỢC. Người không làm được gì thì chỉ cần biết khoá còn thiếu (không nói chuyện mở lại nguồn cho người không có quyền làm việc đó).
 *
 * Những điều hàm này KHÔNG biết (chỉ máy chủ biết, nên có thể vẫn bị từ chối khi bấm): TU_CLAIM (Sale được chọn là chủ lead), Sale đã nghỉ, khoá lạc quan.
 */
import type { QuyenDoiNguon } from "./doi-nguon";
import { nguonChonDuoc } from "./hieu-luc-nguon";

export type LyDoNguonNgung = "TRANG_THAI" | "LUU_TRU" | "TAT_CHON" | "NGOAI_HIEU_LUC";

export type NutBoSungSale =
  | { kieu: "KHONG_CAN" }
  | { kieu: "DUOC" }
  | { kieu: "THIEU_QUYEN"; thieu: readonly string[]; loi: string }
  | { kieu: "NGUON_NGUNG"; maNguon: string; tenNguon: string; lyDo: LyDoNguonNgung; coTheMoLai: boolean };

export type DauVaoNutBoSungSale = {
  referrerKind: "EMPLOYEE" | "PARENT" | "AFFILIATE" | null;
  /** Dòng quy nguồn có `referrerParentUserId` hoặc `referrerStudentId` — service đòi một trong hai để đối chiếu phụ huynh. */
  coPhuHuynhHoacBe: boolean;
  referrerSaleUserId: string | null;
  nguon: { code: string; name: string; status: string; selectable: boolean; effectiveFrom: Date | null; effectiveTo: Date | null };
  /** KẾT QUẢ của `quyenDoiNguon` — truyền nguyên, không dựng lại. */
  quyen: QuyenDoiNguon;
  /** Có `sources:manage` tại lead này không — chỉ để biết ai MỞ LẠI được nguồn ngừng (đổi trạng thái nguồn gác `sources:manage`). */
  coQuyenQuanLyNguon: boolean;
  now: Date;
};

export function quyetDinhNutBoSungSale(i: DauVaoNutBoSungSale): NutBoSungSale {
  if (i.referrerKind !== "PARENT" || !i.coPhuHuynhHoacBe || i.referrerSaleUserId !== null) return { kieu: "KHONG_CAN" };
  if (!i.quyen.ok) return { kieu: "THIEU_QUYEN", thieu: i.quyen.thieu, loi: i.quyen.loi };
  if (!nguonChonDuoc(i.nguon, i.now)) {
    const lyDo: LyDoNguonNgung =
      i.nguon.status === "ARCHIVED" ? "LUU_TRU" : i.nguon.status !== "ACTIVE" ? "TRANG_THAI" : !i.nguon.selectable ? "TAT_CHON" : "NGOAI_HIEU_LUC";
    return { kieu: "NGUON_NGUNG", maNguon: i.nguon.code, tenNguon: i.nguon.name, lyDo, coTheMoLai: i.coQuyenQuanLyNguon };
  }
  return { kieu: "DUOC" };
}
