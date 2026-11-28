// PORT từ repo hodacphuchtc/DISC · tests/thong-ke.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { describe, expect, it } from "vitest";

import {
  LoiThongKe,
  NGUONG_TUONG_QUAN_TOI_THIEU,
  alphaCronbach,
  phanTichTruc,
  phuongSai,
  tuongQuan,
  tuongQuanItemTongHieuChinh,
} from "@/lib/disc/engine-goc/modules/report/thong-ke";

describe("phương sai", () => {
  it("tính theo mẫu (chia n−1)", () => {
    // [1,2,3,4]: trung bình 2,5 · tổng bình phương lệch 5 · chia 3
    expect(phuongSai([1, 2, 3, 4])).toBeCloseTo(5 / 3, 10);
  });

  it("dãy không biến thiên ⇒ 0", () => {
    expect(phuongSai([3, 3, 3, 3])).toBe(0);
  });

  it("dưới 2 quan sát thì BÁO LỖI, không trả NaN", () => {
    expect(() => phuongSai([1])).toThrow(LoiThongKe);
  });
});

describe("tương quan Pearson", () => {
  it("hai dãy trùng nhau ⇒ 1", () => {
    expect(tuongQuan([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 10);
  });

  it("hai dãy ngược nhau ⇒ −1", () => {
    expect(tuongQuan([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it("một dãy phẳng ⇒ 0, không chia cho 0", () => {
    expect(tuongQuan([1, 2, 3, 4], [2, 2, 2, 2])).toBe(0);
  });

  it("hai dãy khác độ dài ⇒ báo lỗi", () => {
    expect(() => tuongQuan([1, 2], [1, 2, 3])).toThrow(/cùng độ dài/u);
  });
});

describe("Cronbach's alpha", () => {
  it("ba câu trùng khớp hoàn toàn ⇒ alpha đúng bằng 1", () => {
    const cot = [
      [1, 2, 3, 4],
      [1, 2, 3, 4],
      [1, 2, 3, 4],
    ];
    expect(alphaCronbach(cot)).toBeCloseTo(1, 10);
  });

  it("một câu bị ngược chiều kéo alpha xuống ÂM — dấu hiệu quên đảo chiều", () => {
    // Tính tay: Σσ²ᵢ = 5 · σ²tổng = 5/3 · α = (3/2)(1 − 5/(5/3)) = −3
    const cot = [
      [1, 2, 3, 4],
      [4, 3, 2, 1],
      [1, 2, 3, 4],
    ];
    expect(alphaCronbach(cot)).toBeCloseTo(-3, 10);
  });

  it("trục chỉ có MỘT câu ⇒ báo lỗi đọc được, KHÔNG chia cho 0", () => {
    expect(() => alphaCronbach([[1, 2, 3]])).toThrow(LoiThongKe);
    expect(() => alphaCronbach([[1, 2, 3]])).toThrow(/chỉ có 1/u);
  });

  it("các câu lệch số người trả lời ⇒ báo lỗi", () => {
    expect(() => alphaCronbach([[1, 2, 3], [1, 2]])).toThrow(/cùng số người/u);
  });

  it("mọi người trả lời giống hệt nhau ⇒ trả 0, không NaN", () => {
    expect(
      alphaCronbach([
        [3, 3, 3],
        [3, 3, 3],
      ]),
    ).toBe(0);
  });
});

describe("tương quan item–tổng đã hiệu chỉnh", () => {
  it("TRỪ CHÍNH NÓ ra khỏi tổng — nếu không thì câu nào cũng đẹp", () => {
    const cot = [
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
      [5, 4, 3, 2, 1],
    ];
    // Câu cuối ngược chiều ba câu kia ⇒ tương quan với tổng còn lại phải ÂM.
    expect(tuongQuanItemTongHieuChinh(cot, 3)).toBeCloseTo(-1, 10);
    // Ba câu cùng chiều ⇒ dương.
    expect(tuongQuanItemTongHieuChinh(cot, 0)).toBeGreaterThan(0);
  });

  it("tổng các câu CÒN LẠI phẳng ⇒ trả 0 chứ không nổ", () => {
    // [1,2,3,4] + [4,3,2,1] = [5,5,5,5] — không còn biến thiên để so.
    const cot = [
      [1, 2, 3, 4],
      [1, 2, 3, 4],
      [4, 3, 2, 1],
    ];
    expect(tuongQuanItemTongHieuChinh(cot, 0)).toBe(0);
  });

  it("chỉ có một câu thì không trừ được ⇒ báo lỗi", () => {
    expect(() => tuongQuanItemTongHieuChinh([[1, 2, 3]], 0)).toThrow(LoiThongKe);
  });
});

describe("phanTichTruc", () => {
  it("đánh dấu nên vứt đúng những câu dưới ngưỡng", () => {
    const kq = phanTichTruc(
      "D",
      ["D1", "D2", "D3"],
      [
        [1, 2, 3, 4, 5],
        [1, 2, 3, 4, 5],
        [5, 1, 4, 2, 3],
      ],
    );
    expect(kq.truc).toBe("D");
    expect(kq.cau).toHaveLength(3);
    expect(kq.cau[0].nenVut).toBe(false);
    expect(kq.cau[2].nenVut).toBe(true);
    for (const c of kq.cau) {
      expect(c.nenVut).toBe(c.r < NGUONG_TUONG_QUAN_TOI_THIEU);
    }
  });
});
