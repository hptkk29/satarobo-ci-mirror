// lib/payments/thu-tu-rot.ts — THỨ TỰ RÓT TIỀN KHI MỘT ĐƠN CÓ NHIỀU CON. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// CHỦ DỰ ÁN CHỐT 16/09/2026 — "công nợ theo CON, QR theo ĐƠN"
//
// *"PaymentRequest thêm orderItemId; luồng mới BẮT BUỘC có (không có đợt NULL/đợt chung).
// […] Webhook khớp phiếu → chia đích danh theo thứ tự dòng; thiếu lấp dần, thừa vào ví gia
// đình. Không chia theo tỷ lệ, không gọi allocateByWeight / chia-khoan-theo-don trên luồng
// mới."*
//
// ─────────────────────────────────────────────────────────────────────────────
// PHÁT HIỆN QUAN TRỌNG: BỘ CHIA ĐÃ CÓ SẴN, ĐỪNG VIẾT LẠI
//
// `lib/payments/allocation.ts` `planAllocation` ĐÃ làm đúng thứ chủ dự án mô tả, từ
// 03/08/2026: rót từ phiếu đích, dư thì tràn sang phiếu CHƯA ĐÓNG ĐỦ kế tiếp theo
// `sortOrder` tăng dần, hết phiếu mà còn dư thì trả `credit` (→ `CreditBalance` = ví gia
// đình). Đó CHÍNH LÀ "thiếu lấp dần, thừa vào ví gia đình". Nó thuần và đã có test.
//
// Vậy phần còn thiếu KHÔNG phải một bộ chia mới — mà là: `sortOrder` phải mang đúng thứ tự
// **DÒNG trước, ĐỢT sau**. Có thế thì tiền mới lấp hết các đợt của con thứ nhất rồi mới
// sang con thứ hai, thay vì lấp đợt 1 của cả hai con rồi mới tới đợt 2.
//
// ⚠️ ĐÂY LÀ TOÀN BỘ PHẦN MỚI CỦA BƯỚC B Ở TẦNG CHIA TIỀN. Nếu bạn định thêm một hàm chia
// nữa thì dừng lại và đọc `allocation.ts` trước.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG PHẢI `installmentNo` LÀ ĐỦ
//
// Cột `sortOrder` hôm nay mặc định = `installmentNo` (xem chú thích trong
// `prisma/schema.prisma`). Với đơn MỘT con thì đúng. Với đơn HAI con thì hai phiếu "đợt 1"
// của hai em có cùng `sortOrder`, và thứ tự rót rơi về `id.localeCompare(id)` — tức phụ
// thuộc cuid, tức NGẪU NHIÊN. Tiền của nhà sẽ lấp một nửa đợt 1 của bé A rồi nhảy sang bé
// B, và không ai đoán được.

/**
 * Khoảng cách giữa hai DÒNG trên thang `sortOrder`.
 *
 * Phải LỚN HƠN số đợt tối đa của một dòng, nếu không đợt cuối của dòng trước sẽ tràn vào
 * chỗ của dòng sau và thứ tự rót đảo lộn. `TRAN_SO_DOT = 12` (`lib/payments/ke-hoach-dot.ts`)
 * cộng phiếu cọc và phiếu "thu toàn đơn" vẫn còn cách 100 rất xa — nhưng khoảng cách rộng
 * là chỗ RẺ NHẤT để phòng xa, nên để 100 chứ không để 20.
 *
 * ⚠️ ĐỪNG hạ số này để "cho đẹp". Hạ xuống dưới số đợt tối đa là một lỗi TIỀN im lặng: nó
 * không ném, không sai kiểu, chỉ làm tiền của nhà rơi vào con khác.
 */
export const BUOC_DONG = 100;

/** Số dòng tối đa của một đơn — `lib/validators/order.ts` giới hạn `items` ở 20. */
export const TRAN_SO_DONG = 20;

export type ThuTuRotInput = {
  /**
   * Vị trí của DÒNG trên đơn, tính từ 0, theo đúng thứ tự người bán nhập.
   *
   * ⚠️ Là THỨ TỰ NHẬP, không phải thứ tự cuid hay thứ tự bảng chữ cái. Người bán nhập con
   * lớn trước con nhỏ thì tiền cũng lấp theo đúng thứ tự đó — và đó là thứ họ giải thích
   * được cho phụ huynh, khác hẳn một thứ tự do máy chọn.
   */
  thuTuDong: number;
  /** `PaymentRequest.installmentNo` — 0 = phiếu thu toàn đơn, 1,2,… = số đợt. */
  installmentNo: number;
};

/**
 * `sortOrder` cho một phiếu thu của luồng MỚI (có `orderItemId`).
 *
 * Thang: `thuTuDong * 100 + installmentNo`. Đơn điệu tăng theo (dòng, đợt) — đúng thứ tự
 * `planAllocation` rót.
 *
 * ⚠️ Giá trị ÂM hoặc quá trần bị KẸP, không ném: hàm này chạy trong đường ghi tiền, và một
 * ngoại lệ ở đây làm hỏng cả transaction tạo đơn. Kẹp rồi ghi ra một thứ tự vẫn đơn điệu
 * thì tệ nhất là thứ tự lạ; ném thì không tạo được đơn.
 */
export function thuTuRot(input: ThuTuRotInput): number {
  const dong = Math.min(
    TRAN_SO_DONG - 1,
    Math.max(0, Math.trunc(input.thuTuDong || 0)),
  );
  const dot = Math.min(
    BUOC_DONG - 1,
    Math.max(0, Math.trunc(input.installmentNo || 0)),
  );
  return dong * BUOC_DONG + dot;
}

/**
 * Đọc ngược: `sortOrder` này thuộc dòng nào, đợt nào.
 *
 * Có cặp đọc-ngược để test khẳng định được tính ĐƠN ÁNH, và để màn đối soát giải thích
 * được một con số trong DB mà không phải tra chéo.
 */
export function docThuTuRot(sortOrder: number): {
  thuTuDong: number;
  installmentNo: number;
} {
  const v = Math.max(0, Math.trunc(sortOrder || 0));
  return {
    thuTuDong: Math.floor(v / BUOC_DONG),
    installmentNo: v % BUOC_DONG,
  };
}

/**
 * Σ số tiền các đợt của MỘT dòng phải bằng thành tiền của dòng đó.
 *
 * Đây là bất biến gốc của cả thiết kế "công nợ theo CON": nếu Σ đợt của bé A không bằng
 * tiền dòng của bé A thì mọi con số "còn thiếu theo con" đều sai, và cái sai đó KHÔNG ném
 * lỗi ở đâu — nó chỉ làm phụ huynh bị đòi nhầm số.
 *
 * Trả phần LỆCH (dương = khai thừa, âm = khai thiếu), 0 khi khớp. Trả số thay vì boolean
 * để người gọi in được con số ra màn hình thay vì chỉ nói "không hợp lệ".
 */
export function lechTongDotCuaDong(
  thanhTienDong: number,
  soTienCacDot: readonly number[],
): number {
  const tong = soTienCacDot.reduce(
    (s, n) => s + (Number.isFinite(n) ? Math.round(n) : 0),
    0,
  );
  const dong = Number.isFinite(thanhTienDong) ? Math.round(thanhTienDong) : 0;
  return tong - dong;
}
