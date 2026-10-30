// Ca [CPM-*] — HOÁN VỊ số thứ tự → vị trí kho mã. Thuần, không chạm DB.
//
// Phần chạm DB (`capPhatSoThuTu` · `capPhatMaPhieu`) nằm ở
// `tests/finance/phieu-gop.test.ts` — sequence phải là sequence THẬT mới nói được điều cần
// nói ("không bao giờ cấp lại cùng một số, kể cả khi rollback").
//
// ⚠️ BỐN CA DƯỚI ĐÂY CANH MỘT THỨ DUY NHẤT: **hoán vị phải là SONG ÁNH**. Mất tính song ánh
// nghĩa là hai số thứ tự khác nhau ra cùng một mã, và khi đó thứ duy nhất chặn là `@unique`
// trên `PaymentBill.matchKey` — tức một lỗi SQL nổ giữa lượt phát hành QR của phụ huynh.
import { describe, it, expect } from "vitest";
import { DUNG_LUONG, sinhMa, maHopLe } from "./ma-phieu";
import { HOAN_VI_K, HOAN_VI_C, hoanViSoThuTu } from "./cap-phat-ma";

/** Ước chung lớn nhất — để khẳng định `gcd(K, N) = 1` bằng phép tính, không bằng lời. */
function ucln(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

describe("[CPM] hoán vị số thứ tự → kho mã", () => {
  it("[CPM-01] `gcd(K, DUNG_LUONG) = 1` — điều kiện CẦN VÀ ĐỦ để song ánh", () => {
    // `N = 21 · 27³ = 413.343 = 3¹⁰ · 7`. `x ↦ (K·x + C) mod N` là song ánh ⟺ gcd(K, N) = 1.
    // Ca này tính lại thay vì tin chú thích: đổi `K` thành một số chia hết cho 3 hoặc 7 là
    // mất song ánh NGAY, mà mã sinh ra vẫn "trông hợp lệ".
    expect(DUNG_LUONG).toBe(413_343);
    expect(DUNG_LUONG).toBe(3 ** 10 * 7);
    expect(ucln(HOAN_VI_K, DUNG_LUONG), "K phải nguyên tố cùng nhau với kho").toBe(1);
  });

  it("[CPM-02] SONG ÁNH thật — quét TRỌN kho, không lấy mẫu", () => {
    // 413.343 phần tử là đủ nhỏ để vét cạn, nên không có lý do gì lấy mẫu. Lấy mẫu ở đây là
    // bỏ lỡ đúng ca hiếm mà hàm này sinh ra để chặn.
    //
    // ⚠️ KHÔNG gọi `expect()` TRONG vòng lặp. Bản đầu gọi 3 lần mỗi vòng ⇒ 1,24 TRIỆU lượt
    // `expect` ⇒ ca chạy **10,7 giây** và ĐỎ vì trần 5 giây của vitest — đỏ vì hạ tầng, không
    // vì hàm sai. Gom vi phạm rồi khẳng định MỘT lần: 45ms, và câu lỗi cũng đọc được hơn (in
    // đúng cặp số đụng nhau thay vì dừng ở lần `expect` đầu tiên).
    const thay = new Uint8Array(DUNG_LUONG);
    let loi: string | null = null;
    for (let n = 0; n < DUNG_LUONG && loi === null; n++) {
      const v = hoanViSoThuTu(n);
      if (v < 0 || v >= DUNG_LUONG) loi = `hoán vị của ${n} ra ngoài kho: ${v}`;
      else if (thay[v] === 1) loi = `vị trí ${v} bị số thứ tự ${n} trỏ tới LẦN HAI`;
      else thay[v] = 1;
    }
    expect(loi, "hoán vị KHÔNG còn là song ánh").toBeNull();
    // Phủ kín ⇒ không sót vị trí nào ⇒ kho dùng được trọn vẹn.
    expect(thay.indexOf(0), "có vị trí trong kho không số thứ tự nào trỏ tới").toBe(-1);
  });

  it("[CPM-03] phép nhân KHÔNG mất chính xác — số lớn nhất vẫn dưới trần an toàn", () => {
    // `K · (N−1) + C` là giá trị lớn nhất mà phép hoán vị chạm tới. Vượt
    // `Number.MAX_SAFE_INTEGER` thì `%` cho kết quả SAI mà không ném gì — lớp lỗi tệ nhất.
    const lonNhat = HOAN_VI_K * (DUNG_LUONG - 1) + HOAN_VI_C;
    expect(lonNhat).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(lonNhat)).toBe(true);
  });

  it("[CPM-04] hai số thứ tự LIỀN NHAU cho mã khác hẳn — đây là điểm của hoán vị", () => {
    // ⚠️ Không có hoán vị thì 0,1,2 ra `AAAA?`, `AAAC?`, `AAAD?`: lệch một ký tự là rơi trúng
    // mã của phiếu vừa phát cho nhà bên cạnh, và webhook tự chia tiền nhà A vào phiếu nhà B.
    //
    // Khẳng định: với 200 cặp liền nhau đầu tiên, hai mã phải khác nhau ở **≥ 2 ký tự**. Mốc
    // 2 là mốc có nghĩa — checksum bắt được mọi lỗi sai MỘT ký tự, nên hai mã cách nhau ≥2
    // thì một cú gõ nhầm không thể biến mã này thành mã kia.
    for (let n = 0; n < 200; n++) {
      const a = sinhMa(hoanViSoThuTu(n));
      const b = sinhMa(hoanViSoThuTu(n + 1));
      let khac = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) khac++;
      expect(khac, `mã của ${n} (${a}) và ${n + 1} (${b}) quá giống nhau`).toBeGreaterThanOrEqual(2);
    }
  });

  it("[CPM-05] mọi mã sinh ra đều qua `maHopLe` — checksum và mỏ neo chữ cái", () => {
    // Hoán vị không được phá điều kiện nhận dạng của parser. Quét thưa (mỗi 997 số, một số
    // nguyên tố nên không đồng pha với bất kỳ chu kỳ nào của cơ số 27).
    for (let n = 0; n < DUNG_LUONG; n += 997) {
      const ma = sinhMa(hoanViSoThuTu(n));
      expect(maHopLe(ma), `mã của số thứ tự ${n} không hợp lệ: ${ma}`).toBe(true);
    }
  });

  it("[CPM-06] số thứ tự ngoài kho ⇒ NÉM, không trả một mã sai", () => {
    expect(() => hoanViSoThuTu(-1)).toThrow(RangeError);
    expect(() => hoanViSoThuTu(DUNG_LUONG)).toThrow(RangeError);
    expect(() => hoanViSoThuTu(Number.NaN)).toThrow(RangeError);
  });
});
