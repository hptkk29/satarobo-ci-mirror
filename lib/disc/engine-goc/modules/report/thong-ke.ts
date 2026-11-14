// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/thong-ke.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * THỐNG KÊ SÀNG CÂU HỎI — phục vụ `scripts/phan-tich-item.mjs`.
 *
 * 🔴 Vì sao cần: bộ 104 câu hiện do BA soạn, chưa ai làm thử, chưa có một con số tin cậy
 * nào. Hệ thống vẫn sẽ trả về biểu đồ bốn cột lẻ đến một chữ số thập phân cho mọi đầu vào
 * lọt qua HL-1. Năm hàng rào hợp lệ chặn NGƯỜI TRẢ LỜI ẨU — chúng không làm bộ câu hỏi
 * ĐO ĐÚNG hơn. Chỉ có dữ liệu thật mới nói được câu nào đang đo sai.
 *
 * Hàm thuần, thuộc TẦNG LÕI: không React, không DOM, không đọc file.
 */

export class LoiThongKe extends Error {
  constructor(thongDiep: string) {
    super(thongDiep);
    this.name = "LoiThongKe";
  }
}

/** Phương sai mẫu (chia cho n−1). Cần ít nhất 2 quan sát. */
export function phuongSai(xs: readonly number[]): number {
  if (xs.length < 2) throw new LoiThongKe("Cần ít nhất 2 người trả lời mới tính được phương sai.");
  const tb = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((t, x) => t + (x - tb) ** 2, 0) / (xs.length - 1);
}

/** Hệ số tương quan Pearson. Một trong hai dãy không biến thiên ⇒ trả 0 (không kết luận được). */
export function tuongQuan(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length) throw new LoiThongKe("Hai dãy phải cùng độ dài.");
  if (xs.length < 2) throw new LoiThongKe("Cần ít nhất 2 quan sát.");
  const tbX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const tbY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let tich = 0;
  let bpX = 0;
  let bpY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - tbX;
    const dy = ys[i] - tbY;
    tich += dx * dy;
    bpX += dx * dx;
    bpY += dy * dy;
  }
  if (bpX === 0 || bpY === 0) return 0;
  return tich / Math.sqrt(bpX * bpY);
}

/**
 * Cronbach's alpha — độ nhất quán nội tại của một nhóm câu cùng đo một thứ.
 *
 * `cot[i]` là dãy điểm của câu thứ i qua tất cả người trả lời (ĐÃ đảo chiều xong).
 *
 * Alpha ÂM không phải lỗi tính: nó nghĩa là các câu đang mâu thuẫn nhau — thường do quên
 * đảo chiều một câu, hoặc do câu đó thật sự đo thứ khác.
 */
export function alphaCronbach(cot: readonly (readonly number[])[]): number {
  const k = cot.length;
  if (k < 2) {
    throw new LoiThongKe(
      `Cần ít nhất 2 câu mới tính được alpha, trục này chỉ có ${k}. ` +
        `Một câu thì không có "nhất quán nội tại" để đo.`,
    );
  }
  const soNguoi = cot[0].length;
  for (const c of cot) {
    if (c.length !== soNguoi) throw new LoiThongKe("Các câu phải có cùng số người trả lời.");
  }
  const tong = Array.from({ length: soNguoi }, (_, n) => cot.reduce((t, c) => t + c[n], 0));
  const tongPhuongSaiCau = cot.reduce((t, c) => t + phuongSai(c), 0);
  const phuongSaiTong = phuongSai(tong);
  if (phuongSaiTong === 0) return 0;
  return (k / (k - 1)) * (1 - tongPhuongSaiCau / phuongSaiTong);
}

/**
 * Tương quan item–tổng ĐÃ HIỆU CHỈNH: tương quan giữa một câu và TỔNG CÁC CÂU CÒN LẠI
 * của cùng trục.
 *
 * Phải trừ chính nó ra, nếu không câu nào cũng tương quan cao với tổng có chứa nó —
 * và bảng nào cũng đẹp.
 */
export function tuongQuanItemTongHieuChinh(
  cot: readonly (readonly number[])[],
  chiSo: number,
): number {
  if (cot.length < 2) throw new LoiThongKe("Cần ít nhất 2 câu để trừ chính nó ra.");
  const soNguoi = cot[0].length;
  const conLai = Array.from({ length: soNguoi }, (_, n) =>
    cot.reduce((t, c, i) => (i === chiSo ? t : t + c[n]), 0),
  );
  return tuongQuan(cot[chiSo], conLai);
}

export type KetQuaTruc = {
  readonly truc: string;
  readonly alpha: number;
  readonly cau: readonly { readonly ma: string; readonly r: number; readonly nenVut: boolean }[];
};

/** Ngưỡng dưới của tương quan item–tổng. Dưới mức này thì câu đang đo thứ khác. */
export const NGUONG_TUONG_QUAN_TOI_THIEU = 0.2;

export function phanTichTruc(
  truc: string,
  ma: readonly string[],
  cot: readonly (readonly number[])[],
): KetQuaTruc {
  return {
    truc,
    alpha: alphaCronbach(cot),
    cau: ma.map((m, i) => {
      const r = tuongQuanItemTongHieuChinh(cot, i);
      return { ma: m, r, nenVut: r < NGUONG_TUONG_QUAN_TOI_THIEU };
    }),
  };
}
