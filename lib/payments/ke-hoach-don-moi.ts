/**
 * KẾ HOẠCH THANH TOÁN LẬP NGAY Ở TRANG TẠO ĐƠN — luật thuần.
 *
 * Chủ dự án 15/09/2026: *"đưa phần kế hoạch thanh toán ra trang tạo đơn hàng luôn đi, đặt
 * ở dưới session khoá học và lấy số tiền cần thanh toán ở phần khoá học sau khi hoàn thành
 * các tuỳ chọn của đơn hàng khoá học luôn"*, và: *"khi sale chưa chọn khoá học thì khối kế
 * hoạch HIỆN NHƯNG KHOÁ, số tiền cho kế hoạch lấy từ tổng đơn sau giảm giá là đúng r"*.
 *
 * Hai luật ở đây nhỏ nhưng cả hai đều là loại KHÔNG tự lộ khi sai:
 *
 *  1. `dotsChoDonMoi` — kế hoạch mở đầu của một đơn CHƯA CÓ ĐỒNG NÀO. `daThu` phải là
 *     FALSE ở mọi đợt. Đây đúng là con bug 14/09/2026 (`dotsBanDauTuTien`): mặc định
 *     "đã thu cả đơn" biến một lượt bấm Lưu không đổi gì thành một dòng Ledger-A khống
 *     7.000.000đ. Trên trang TẠO đơn thì còn chắc hơn nữa — đơn vừa mới sinh ra, không có
 *     trục nào có thể đã ghi nhận tiền của nó. Nên số 0 ở đây không phải "mặc định an
 *     toàn", nó là số ĐÚNG DUY NHẤT, và hàm cố ý không nhận tham số nào để khai khác đi.
 *
 *  2. `khoaKeHoachDonMoi` — LÝ DO khoá khối. Trả `null` là mở. Nó vừa là điều kiện khoá
 *     vừa là câu chữ hiện ra, ở CÙNG MỘT chỗ: viết hai biểu thức riêng thì có hai cách
 *     lệch, và cả hai đều im lặng — khối khoá mà không nói vì sao, hoặc khối mở mà vẫn
 *     dán một dòng chữ bảo là đang khoá (luật 12, affordance phải nói thật).
 */

import { chiaDotHocPhi, hanChoDot, TRAN_SO_DOT } from "./ke-hoach-dot";

/**
 * Số ngày nhắc trước hạn, mặc định của FORM.
 *
 * ⚠️ KHÁC `finance.debtReminderDaysBefore` (SystemSetting) — cột `OrderInstallment.reminderDays`
 * để `null` thì cron mới rơi về tham số vận hành đó (`effectiveReminderDays`). Con số này
 * chỉ là giá trị bày sẵn trong ô nhập; trước bản này nó là hằng `14` viết rời ở 4 chỗ
 * trong `order-payment-section.tsx`.
 */
export const NGAY_NHAC_MAC_DINH = 14;

export type DotDonMoi = {
  amount: number;
  /** LUÔN false — xem luật 1 ở đầu tệp. */
  daThu: false;
  dueDate: Date;
  reminderDays: number;
};

/**
 * Kế hoạch mở đầu cho một đơn VỪA ĐƯỢC LẬP: chia `tongDon` thành `soDot` đợt, chưa thu
 * đồng nào, mỗi đợt có hạn (đợt 1 ngay `moc`, các đợt sau cách 30 ngày).
 *
 * ⚠️ `moc` BẮT BUỘC truyền vào — hàm không đọc `new Date()` (luật 19: test có ngày tuyệt
 * đối mà hàm rơi về đồng hồ thật là bom hẹn giờ).
 *
 * ⚠️ MỌI đợt đều có hạn, kể cả kế hoạch 1 đợt. `kiemKeHoachDot` từ chối đợt chưa thu mà
 * thiếu hạn, nên bỏ trống là dựng sẵn một cái nút Lưu bị khoá ngay lúc form vừa mở — và
 * lý do thì nằm ở một dòng chữ người bán chưa cuộn tới.
 */
export function dotsChoDonMoi(tongDon: number, moc: Date, soDot = 1): DotDonMoi[] {
  const n = Math.min(TRAN_SO_DOT, Math.max(1, Math.floor(Number.isFinite(soDot) ? soDot : 1)));
  const tien = chiaDotHocPhi(tongDon, n);
  const han = hanChoDot(moc, n);
  return tien.map((amount, i) => ({
    amount,
    daThu: false,
    dueDate: han[i]!,
    reminderDays: NGAY_NHAC_MAC_DINH,
  }));
}

/**
 * Vì sao khối kế hoạch đang KHOÁ — `null` nghĩa là mở.
 *
 * Chưa chọn khoá học ⇒ tổng đơn là 0 ⇒ chia đợt cho 0đ là bày ra một cái form mà mọi ô
 * đều bằng 0 và nút Lưu thì không bao giờ bấm được (đơn 0đ không qua `soatGiaDon`). Khoá
 * kèm lý do nói rõ việc cần làm trước.
 */
export function khoaKeHoachDonMoi(tongDon: number): string | null {
  if (!Number.isFinite(tongDon) || Math.round(tongDon) <= 0) {
    return "Chọn khoá học (hoặc sản phẩm) ở trên trước — số tiền của kế hoạch lấy từ Tổng đơn sau giảm giá.";
  }
  return null;
}
