/**
 * lib/cham-cong/cum-quet.test.ts — chia cụm quét kỳ vọng.
 *
 * Số giờ trong ca test lấy THẲNG từ `docs/cham-cong/BANG-MA-CA-CHOT.md`, không bịa: ca
 * thật mới phơi ra được ranh giới thật (fixture tròn trịa không kiểm được gì).
 */
import { describe, expect, it } from "vitest";
import { cumQuetKyVong, coThieuCum, khaiDuocHaiCap, khongQuetGiuaCa, type Doan } from "./cum-quet";

/** "HH:mm" → phút. Giữ ca test đọc được như bảng chốt. */
const p = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};
const d = (a: string, b: string): Doan => ({ start: p(a), end: p(b) });

/** Ca thật, chép từ bảng chốt. */
const HC: Doan[] = [d("08:00", "11:30"), d("13:30", "17:30")]; // 1 cụm
const ST: Doan[] = [d("07:45", "11:30"), d("17:15", "21:00")]; // 2 cụm
const CT: Doan[] = [d("13:45", "16:30"), d("17:30", "21:00")]; // 1 cụm (nghỉ VẪN tính)
const S: Doan[] = [d("07:45", "11:30")]; // 1 đoạn

describe("cumQuetKyVong", () => {
  it("0 ⇒ KHÔNG cụm nào — không kiểm quét, không cờ", () => {
    expect(cumQuetKyVong(HC, 0)).toEqual([]);
    expect(cumQuetKyVong(ST, 0)).toEqual([]);
  });

  it("1 ⇒ MỘT cụm, vào = đầu đoạn đầu, ra = cuối đoạn cuối (kể cả ca gãy)", () => {
    // HC gãy giữa trưa, nhưng khai 1 cặp ⇒ quét sáng 8:00 và chiều 17:30 là đủ.
    expect(cumQuetKyVong(HC, 1)).toEqual([{ start: p("08:00"), end: p("17:30") }]);
    expect(cumQuetKyVong(CT, 1)).toEqual([{ start: p("13:45"), end: p("21:00") }]);
  });

  it("2 ⇒ HAI cụm, cắt ở khoảng hở LỚN NHẤT", () => {
    // ST: hở duy nhất 11:30→17:15 (5h45).
    expect(cumQuetKyVong(ST, 2)).toEqual([
      { start: p("07:45"), end: p("11:30") },
      { start: p("17:15"), end: p("21:00") },
    ]);
  });

  it("2 ⇒ chọn ĐÚNG khoảng hở lớn nhất khi có NHIỀU khoảng hở", () => {
    // Ba đoạn, hai khoảng hở: 30′ rồi 4h. Phải cắt ở cái 4h, không phải cái đầu tiên.
    const ba: Doan[] = [d("08:00", "10:00"), d("10:30", "12:00"), d("16:00", "20:00")];
    expect(cumQuetKyVong(ba, 2)).toEqual([
      { start: p("08:00"), end: p("12:00") },
      { start: p("16:00"), end: p("20:00") },
    ]);
  });

  it("thứ tự mảng đầu vào KHÔNG đổi kết quả", () => {
    const daoNguoc = [...ST].reverse();
    expect(cumQuetKyVong(daoNguoc, 2)).toEqual(cumQuetKyVong(ST, 2));
    expect(cumQuetKyVong(daoNguoc, 1)).toEqual(cumQuetKyVong(ST, 1));
  });

  it("hai khoảng hở BẰNG NHAU ⇒ cắt ở cái ĐẦU TIÊN, và luôn như vậy", () => {
    // Không phải vì cái đầu "đúng hơn" — mà vì phải chọn MỘT cách và giữ nguyên, kẻo
    // cùng một ca ra hai kết quả tuỳ thứ tự mảng.
    const deu: Doan[] = [d("08:00", "09:00"), d("10:00", "11:00"), d("12:00", "13:00")];
    expect(cumQuetKyVong(deu, 2)).toEqual([
      { start: p("08:00"), end: p("09:00") },
      { start: p("10:00"), end: p("13:00") },
    ]);
  });

  it("khai 2 nhưng ca chỉ có MỘT đoạn ⇒ trả MỘT cụm, KHÔNG bịa cụm thứ hai", () => {
    // Bịa là dựng một mốc quét không có trong ca, và người ta bị đòi một lượt cho khoảng
    // thời gian không tồn tại. Danh mục khai sai thì `catalog.test.ts` bắt, không phải đây.
    expect(cumQuetKyVong(S, 2)).toEqual([{ start: p("07:45"), end: p("11:30") }]);
  });

  it("không đoạn WORK nào ⇒ không cụm nào, ở MỌI giá trị", () => {
    for (const n of [0, 1, 2] as const) expect(cumQuetKyVong([], n)).toEqual([]);
  });

  it("đoạn rỗng/ngược (end ≤ start) bị loại, không làm lệch mốc", () => {
    const co: Doan[] = [d("08:00", "08:00"), d("09:00", "12:00")];
    expect(cumQuetKyVong(co, 1)).toEqual([{ start: p("09:00"), end: p("12:00") }]);
  });
});

describe("coThieuCum", () => {
  it("giữ NGUYÊN tên cờ cũ — dữ liệu prod đang mang chúng", () => {
    expect(coThieuCum(0)).toBe("THIEU_BUOI_SANG");
    expect(coThieuCum(1)).toBe("THIEU_BUOI_CHIEU");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// khongQuetGiuaCa — "làm thẳng qua nghỉ giữa ca, không quét ra/vào"
//
// Đây là lỗ mà `soCapQuetKyVong: 2` MỘT MÌNH không bịt được, và nó là lý do hàm này tồn
// tại. Cổng ở `engine.ts:363` là
//     const covered = pairedIntervals.some((p) => overlap(p, blk) > 0);
//     if (firstIn === undefined && !covered) → gắn cờ
// nên MỘT cặp dài `08:00 → 17:30` PHỦ CHỒNG cả hai cụm ⇒ `covered = true` ⇒ sạch cờ, dù
// người ấy chưa từng quét ở nghỉ trưa. Đo thật trước bản vá: HC 2 cụm + cặp đơn ấy ra
// `flags: []`.
//
// Vì sao KHÔNG siết `covered` mà thêm cờ riêng — hai lý do, cái thứ hai mới là cái nặng:
//  1. Gắn `THIEU_BUOI_SANG`/`CHIEU` cho người làm trọn ngày là NÓI SAI: họ có mặt cả hai
//     buổi, thứ họ thiếu là mốc quét GIỮA ca.
//  2. `noi-quy.ts:130 thieuNuaNgay()` đọc đúng hai cờ ấy để LOẠI ngày khỏi `caThucTe`.
//     Mượn chúng là kéo tỷ lệ đạt nội quy của người làm trọn ngày xuống như thể họ bỏ
//     nửa ngày — phạt sai người, và phạt im lặng.
describe("khongQuetGiuaCa", () => {
  const cumHC = cumQuetKyVong(HC, 2); // [08:00–11:30, 13:30–17:30]

  it("cặp ĐƠN trùm cả nghỉ trưa ⇒ ĐÚNG là thiếu lượt giữa ca", () => {
    expect(khongQuetGiuaCa([d("08:00", "17:30")], cumHC)).toBe(true);
  });

  it("quét đủ 4 lượt (ra 11:30, vào 13:30) ⇒ KHÔNG cờ", () => {
    expect(khongQuetGiuaCa([d("08:00", "11:30"), d("13:30", "17:30")], cumHC)).toBe(false);
  });

  it("về muộn hơn giờ nghỉ nhưng CÓ quét (ra 11:35, vào 11:36) ⇒ KHÔNG cờ", () => {
    // Ranh giới thật: họ đã quét trong khoảng nghỉ. Muộn 5′ là việc của DI_MUON/VE_SOM,
    // không phải của cờ này — cờ này chỉ hỏi "có quét giữa ca hay không".
    expect(khongQuetGiuaCa([d("08:00", "11:35"), d("11:36", "17:30")], cumHC)).toBe(false);
  });

  it("ở lại quá trưa rồi mới quét ra 14:00 ⇒ VẪN là thiếu lượt giữa ca", () => {
    // Cặp [08:00, 14:00] phủ TRỌN khoảng nghỉ 11:30–13:30 ⇒ suốt cả giờ nghỉ họ vẫn đang
    // "đã vào". Đó đúng là điều cờ này nói.
    expect(khongQuetGiuaCa([d("08:00", "14:00"), d("14:01", "17:30")], cumHC)).toBe(true);
  });

  it("chỉ quét buổi sáng rồi về ⇒ KHÔNG phải cờ NÀY (đã có THIEU_BUOI_CHIEU)", () => {
    // Quan trọng: hai cờ không được chồng lên nhau, kẻo một ngày vắng nửa buổi bị đếm hai lần.
    expect(khongQuetGiuaCa([d("08:00", "11:30")], cumHC)).toBe(false);
  });

  it("ca MỘT cụm (khai 1) ⇒ không bao giờ có cờ, dù quét thế nào", () => {
    // Đây là vế giữ cho mọi mã còn lại của danh mục KHÔNG đổi hành vi sau bản vá.
    expect(khongQuetGiuaCa([d("08:00", "17:30")], cumQuetKyVong(HC, 1))).toBe(false);
    expect(khongQuetGiuaCa([d("13:45", "21:00")], cumQuetKyVong(CT, 1))).toBe(false);
    expect(khongQuetGiuaCa([d("07:45", "11:30")], cumQuetKyVong(S, 1))).toBe(false);
  });

  it("ST (ca sáng + tối) cùng hình dạng ⇒ cùng luật", () => {
    const cumST = cumQuetKyVong(ST, 2);
    expect(khongQuetGiuaCa([d("07:45", "21:00")], cumST)).toBe(true);
    expect(khongQuetGiuaCa([d("07:45", "11:30"), d("17:15", "21:00")], cumST)).toBe(false);
  });

  it("không cặp nào ⇒ không cờ (ngày đó là KHONG_CO_LUOT, việc của cờ khác)", () => {
    expect(khongQuetGiuaCa([], cumHC)).toBe(false);
  });

  it("hai cụm DÍNH nhau (không có khoảng hở) ⇒ không đòi lượt giữa ca", () => {
    // Danh mục khai 2 cho một ca liền mạch là danh mục SAI — `cumQuetKyVong` đã trả về một
    // cụm cho ca một đoạn, nhưng hàm này cũng phải tự đứng được nếu người gọi dựng tay.
    const dinh = [{ start: p("08:00"), end: p("12:00") }, { start: p("12:00"), end: p("17:00") }];
    expect(khongQuetGiuaCa([d("08:00", "17:00")], dinh)).toBe(false);
  });
});

describe("khaiDuocHaiCap — cổng của màn Danh mục mã ca", () => {
  it("HC / ST có nghỉ giữa giờ KHÔNG tính công ⇒ khai 2 được", () => {
    expect(khaiDuocHaiCap(HC)).toBe(true);
    expect(khaiDuocHaiCap(ST)).toBe(true);
  });

  it("ca MỘT đoạn ⇒ KHÔNG khai 2 được (kẻo lặng lẽ chạy như 1)", () => {
    // Đây là lý do cổng tồn tại: `cumQuetKyVong(S, 2)` trả về MỘT cụm, nên khai 2 cho ca này
    // không đổi hành vi gì — người vận hành thấy "đã lưu" mà tưởng đã siết.
    expect(khaiDuocHaiCap(S)).toBe(false);
    expect(cumQuetKyVong(S, 2)).toHaveLength(1); // neo vào lý do, không chỉ vào kết luận
  });

  it("hai đoạn LIỀN NHAU (nghỉ CÓ tính công đã gộp) ⇒ KHÔNG khai 2 được", () => {
    expect(khaiDuocHaiCap([d("13:45", "17:30"), d("17:30", "21:00")])).toBe(false);
  });

  it("CT: nghỉ 16:30–17:30 VẪN tính công nên hai đoạn WORK rời nhau — cổng CHO qua", () => {
    // Ghi lại giới hạn có chủ đích: cổng chỉ soi HÌNH DẠNG đoạn WORK, không biết khoảng giữa
    // là PAID_BREAK. Người gọi phải truyền ĐÚNG đoạn WORK; `CT` khai 1 là quyết định của bảng
    // chốt, không phải việc của cổng này.
    expect(khaiDuocHaiCap(CT)).toBe(true);
  });

  it("không đoạn nào / đoạn ngược ⇒ false, không ném", () => {
    expect(khaiDuocHaiCap([])).toBe(false);
    expect(khaiDuocHaiCap([d("11:30", "08:00")])).toBe(false);
  });
});
