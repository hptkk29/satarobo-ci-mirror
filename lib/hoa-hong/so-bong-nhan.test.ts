// @vitest-environment node
/** [SBG-17] — nhãn tiếng Việt của mã so bóng: mọi mã EXPECTED có nhãn riêng; mã chẩn đoán lạ rơi về CHÍNH mã (không chuỗi rỗng); tiền tố MAT_DONG_ dịch được. */
import { describe, expect, it } from "vitest";

import { MA_EXPECTED } from "./so-bong";
import { NHAN_MA_EXPECTED, nhanMaSoBong } from "./so-bong-nhan";

describe("[SBG-17] nhãn mã so bóng", () => {
  it("[SBG-17] mỗi mã EXPECTED có nhãn tiếng Việt khác chính mã; các nhãn không trùng nhau", () => {
    const nhan = MA_EXPECTED.map((m) => NHAN_MA_EXPECTED[m]);
    for (const [i, m] of MA_EXPECTED.entries()) {
      expect(nhan[i]!.length, m).toBeGreaterThan(10);
      expect(nhanMaSoBong(m), m).toBe(nhan[i]);
      expect(nhan[i], m).not.toBe(m);
    }
    expect(new Set(nhan).size).toBe(nhan.length);
  });

  it("[SBG-17] mã chẩn đoán: có nhãn thì dịch, tiền tố MAT_DONG_ nêu trạng thái, mã lạ rơi về chính nó", () => {
    expect(nhanMaSoBong("SO_TIEN_KHAC")).toBe("Cùng người, khác số tiền");
    expect(nhanMaSoBong("MAT_DONG_KHONG_RULE")).toContain("KHONG_RULE");
    expect(nhanMaSoBong("MA_LA_CHUA_CO_NHAN")).toBe("MA_LA_CHUA_CO_NHAN");
  });
});
