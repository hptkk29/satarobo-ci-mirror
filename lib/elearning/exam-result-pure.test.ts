/** [KQP-*] Màn kết quả thi — phần thuần. */
import { describe, expect, it } from "vitest";
import { dongKetLuanLuot, lyDoChuaCoDapAn } from "./exam-result-pure";

describe("[KQP-01] lyDoChuaCoDapAn", () => {
  it("AFTER_LAST_ATTEMPT: nói đã dùng/còn mấy lượt; NEVER: nói đề không công bố", () => {
    expect(lyDoChuaCoDapAn("AFTER_LAST_ATTEMPT", 1, 3)).toBe("Đáp án được công bố sau khi bạn dùng hết số lượt thi (đã dùng 1/3, còn 2 lượt).");
    expect(lyDoChuaCoDapAn("NEVER", 1, 3)).toBe("Đề này không công bố đáp án.");
  });
});

describe("[KQP-02] dongKetLuanLuot", () => {
  it("đạt / chưa đạt / chờ chấm tay / chưa có", () => {
    expect(dongKetLuanLuot({ choChamTay: false, passed: true, totalScore: 10 }, 12)).toBe("Đạt 10/12");
    expect(dongKetLuanLuot({ choChamTay: false, passed: false, totalScore: 4 }, 12)).toBe("Chưa đạt 4/12");
    expect(dongKetLuanLuot({ choChamTay: true, passed: null, totalScore: null }, 12)).toBe("Đang chờ người chấm phần tự luận");
    expect(dongKetLuanLuot({ choChamTay: true, passed: false, totalScore: 3 }, 12)).toBe("Đang chờ người chấm phần tự luận"); // không in điểm tạm
    expect(dongKetLuanLuot({ choChamTay: false, passed: null, totalScore: null }, 12)).toBe("Chưa có kết quả");
  });
});
