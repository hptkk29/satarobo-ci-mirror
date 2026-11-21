/**
 * EL-12 — BITMAP ĐOẠN XEM. Một bit cho mỗi đoạn 5 giây của video.
 *
 * Vì sao là bitmap chứ không phải một dòng cho mỗi đoạn: số dòng sẽ là tích của
 * (số phút nội dung × 12) với (số người học) — cả hai đều nhân lên. Bitmap cắt
 * bậc tăng trưởng đó xuống MỘT dòng cho mỗi người trên mỗi bài.
 *
 * ⚠️ Hai luật không được phá, cả hai đều là chỗ gian lận sẽ nhắm tới:
 *
 * 1. **Chỉ BẬT bit, không bao giờ TẮT.** Nhịp xem là snapshot luỹ kế ghi đè; nếu
 *    client gửi một snapshot "sạch hơn" mà server nhận nguyên, thì tua đi tua lại
 *    một đoạn ngắn có thể xoá lịch sử xem thật.
 * 2. **Trần delta mỗi nhịp.** Không có trần thì một nhịp duy nhất khai "đã xem
 *    từ 0 tới hết" là xong cả bài trong một lần gọi.
 *
 * ⚠️ Bit thừa ở byte cuối KHÔNG được đếm. Một video 7 đoạn dùng 1 byte = 8 bit;
 * đếm cả bit thứ 8 là báo phủ 114%, và mọi phép so với ngưỡng hoàn thành đều sai
 * theo hướng dễ dãi.
 */

export const DOAN_GIAY = 5;
/**
 * Trần số giây được cộng thêm trong MỘT nhịp (§ mô hình đo xem).
 *
 * 25 = 15 giây chu kỳ nhịp × 1.5 (tốc độ phát tối đa) = 22.5 giây nội dung, làm tròn LÊN cho trình duyệt
 * đếm lệch. Bản cũ là 20 — thấp hơn mức xem hợp lệ ở 1.5x nên người xem trung thực bị cắt ≈ 2.5 giây mỗi nhịp
 * (owner duyệt nâng 20 → 25 ngày 28/10/2026).
 *
 * ⚠️ Đây là TRẦN MỖI NHỊP, KHÔNG phải lượng được cộng mặc định: lượng thật còn bị chặn bởi ngân sách thời
 * gian thật của phiên (`video-time-budget.ts`) và bởi chính khoảng trình phát khai.
 */
export const TRAN_DELTA_GIAY = 25;
/**
 * Dung sai ở CUỐI video: vị trí trình phát khi hết bài thường lệch dưới 1 giây so với
 * `durationSec` đã lưu (thời lượng lưu là số nguyên, vị trí là số thực).
 */
export const DUNG_SAI_CUOI_GIAY = 1;

export function soDoanCua(durationSec: number, doanGiay = DOAN_GIAY): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.ceil(durationSec / doanGiay);
}

export function soByteCan(soDoan: number): number {
  return Math.ceil(Math.max(0, soDoan) / 8);
}

export function bitmapRong(soDoan: number): Uint8Array {
  return new Uint8Array(soByteCan(soDoan));
}

export function batDoan(b: Uint8Array, i: number): void {
  const byte = i >> 3;
  if (i < 0 || byte >= b.length) return;
  b[byte] = (b[byte] ?? 0) | (1 << (i & 7));
}

export function doanDaBat(b: Uint8Array, i: number): boolean {
  const byte = i >> 3;
  if (i < 0 || byte >= b.length) return false;
  return ((b[byte] ?? 0) & (1 << (i & 7))) !== 0;
}

/**
 * Đếm số đoạn đã xem, CHỈ trong phạm vi `soDoan`.
 *
 * ⚠️ Bit thừa ở byte cuối bị bỏ qua — xem ghi chú đầu tệp.
 */
export function demDoan(b: Uint8Array, soDoan: number): number {
  let n = 0;
  for (let i = 0; i < soDoan; i += 1) if (doanDaBat(b, i)) n += 1;
  return n;
}

export function phanTramPhu(b: Uint8Array, soDoan: number): number {
  if (soDoan <= 0) return 0;
  return Math.min(100, Math.round((demDoan(b, soDoan) / soDoan) * 100));
}

export type KetQuaGop = {
  bitmap: Uint8Array;
  /** Số đoạn MỚI được bật trong nhịp này (đã áp trần). */
  doanMoi: number;
  /** Số giây MỚI được ghi nhận trong nhịp này — đoạn đuôi lẻ chỉ tính phần còn lại của bài. */
  giayMoi: number;
  coveredSec: number;
  coveragePercent: number;
  /** `true` = client khai vượt trần và đã bị cắt. Dùng cho cơ chế gắn cờ. */
  biCatTran: boolean;
};

/**
 * Gộp một khoảng vừa xem vào bitmap cũ.
 *
 * @param tuSec  Vị trí bắt đầu khoảng vừa xem (giây).
 * @param denSec Vị trí kết thúc (giây).
 *
 * ⚠️ Bitmap cũ KHÔNG bị sửa tại chỗ — trả bản mới. Sửa tại chỗ làm người gọi
 * không so được trước/sau, mà so trước/sau chính là cách phát hiện nhịp gian.
 */
export function gopNhipXem(input: {
  bitmapCu: Uint8Array | null;
  soDoan: number;
  tuSec: number;
  denSec: number;
  doanGiay?: number;
  tranDeltaGiay?: number;
  /**
   * Thời lượng thật của bài. Có nó thì (1) đoạn ĐUÔI LẺ (video 19 giây = 4 đoạn, đoạn cuối
   * chỉ dài 4 giây) được tính khi người xem chạm cuối video, (2) số giây không vượt thời lượng.
   * Không truyền = hành vi cũ, đoạn đuôi lẻ không bao giờ được bật.
   */
  contentSec?: number;
}): KetQuaGop {
  const doanGiay = input.doanGiay ?? DOAN_GIAY;
  const tran = input.tranDeltaGiay ?? TRAN_DELTA_GIAY;
  const soDoan = Math.max(0, input.soDoan);

  const moi = bitmapRong(soDoan);
  // Chép bitmap cũ sang — chỉ chép phần nằm trong phạm vi hiện tại. Video bị đổi
  // (thay tệp, cắt ngắn) thì phần thừa của bitmap cũ không được mang theo.
  if (input.bitmapCu) {
    for (let i = 0; i < Math.min(moi.length, input.bitmapCu.length); i += 1) {
      moi[i] = input.bitmapCu[i]!;
    }
  }
  const truoc = demDoan(moi, soDoan);
  const tongGiay = input.contentSec != null && input.contentSec > 0 ? input.contentSec : null;
  // Số giây của một bitmap: đoạn đuôi lẻ ngắn hơn `doanGiay`, nên khi CHÍNH nó được bật chỉ cộng phần
  // còn lại của bài — tổng không bao giờ vượt thời lượng.
  const giayCua = (bm: Uint8Array) => {
    const n = demDoan(bm, soDoan);
    if (tongGiay == null) return n * doanGiay;
    const thieuODuoi = soDoan * doanGiay - tongGiay;
    return n * doanGiay - (soDoan > 0 && doanDaBat(bm, soDoan - 1) ? Math.max(0, thieuODuoi) : 0);
  };
  const giayTruoc = giayCua(moi);

  // Khoảng vô lý (lùi, âm, NaN) ⇒ không cộng gì, nhưng vẫn trả bitmap hợp lệ.
  const tu = Number.isFinite(input.tuSec) ? Math.max(0, input.tuSec) : 0;
  const den = Number.isFinite(input.denSec) ? input.denSec : tu;
  // Hết ngân sách (trần ≤ 0) ⇒ KHÔNG cộng gì. Không có nhánh này thì `denThuc = tu` rơi vào ngoại lệ
  // "chạm cuối bài" bên dưới khi `tu` đang sát cuối video, và đoạn đuôi được bật mà không tốn ngân sách.
  if (den <= tu || soDoan === 0 || tran <= 0) {
    return {
      bitmap: moi,
      doanMoi: 0,
      giayMoi: 0,
      coveredSec: giayTruoc,
      coveragePercent: phanTramPhu(moi, soDoan),
      // Khoảng hợp lệ mà ngân sách đã cạn là một lần BỊ CẮT (cơ chế gắn cờ cần thấy nó); khoảng vô lý thì không.
      biCatTran: tran <= 0 && soDoan > 0 && den > tu,
    };
  }

  // ⚠️ Áp TRẦN trên chính khoảng thời gian, trước khi bật bit. Áp sau khi bật là
  // đã ghi rồi mới cắt — bitmap vẫn mang những đoạn không được phép.
  // ⚠️ KHÔNG kẹp `den` ở cuối bài trước khi tính `dai`: nhịp khai vượt nội dung (0→5000 trên video
  // 19 giây) phải vẫn bị tính là "vượt trần" để cơ chế gắn cờ thấy. Phần vượt không cộng thêm gì
  // nhờ giới hạn `soDoan` ở vòng bật bit và `giayCua` không vượt thời lượng.
  const dai = den - tu;
  const biCatTran = dai > tran;
  const denThuc = biCatTran ? tu + tran : den;

  const doanDau = Math.floor(tu / doanGiay);
  // Đoạn cuối tính theo `ceil`: xem tới giây 12 nghĩa là đã chạm đoạn thứ 3
  // (10–15), nhưng CHƯA xem hết nó — nên chỉ bật các đoạn ĐÃ QUA trọn vẹn.
  // Ngoại lệ DUY NHẤT: chạm cuối bài (trong dung sai) thì đoạn đuôi lẻ cũng tính, vì không còn
  // "phần sau của đoạn" nào để xem. Thiếu ngoại lệ này video 19 giây (4 đoạn) tối đa chỉ đạt 75%
  // < ngưỡng hoàn thành 95% ⇒ xem hết vẫn không hoàn thành được; video dưới ~100 giây có thời
  // lượng không chia hết cho 5 đều dính.
  const chamCuoi = tongGiay != null && denThuc >= tongGiay - DUNG_SAI_CUOI_GIAY;
  const doanCuoi = chamCuoi ? soDoan : Math.floor(denThuc / doanGiay);
  for (let i = doanDau; i < Math.min(doanCuoi, soDoan); i += 1) batDoan(moi, i);

  const sau = demDoan(moi, soDoan);
  return {
    bitmap: moi,
    doanMoi: sau - truoc,
    giayMoi: giayCua(moi) - giayTruoc,
    coveredSec: giayCua(moi),
    coveragePercent: phanTramPhu(moi, soDoan),
    biCatTran,
  };
}

/**
 * Bitmap mới có LÀM MẤT đoạn nào so với bitmap cũ không.
 *
 * Dùng như một hàng rào: kết quả gộp không bao giờ được làm mất bit. Nếu có ngày
 * nó mất, đó là lỗi ở tầng gộp chứ không phải hành vi của người học — và test này
 * bắt được trước khi dữ liệu thật bị hỏng.
 */
export function daMatDoan(cu: Uint8Array | null, moi: Uint8Array, soDoan: number): boolean {
  if (!cu) return false;
  for (let i = 0; i < soDoan; i += 1) {
    if (doanDaBat(cu, i) && !doanDaBat(moi, i)) return true;
  }
  return false;
}
