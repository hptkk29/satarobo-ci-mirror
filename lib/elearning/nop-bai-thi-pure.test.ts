/** [NBT-*] Hộp xác nhận nộp bài thi — phần thuần. */
import { describe, expect, it } from "vitest";
import { cauChuaLam, laDaTraLoi } from "./nop-bai-thi-pure";

const cau = (...id: string[]) => id.map((examQuestionId) => ({ examQuestionId }));

describe("[NBT-01] laDaTraLoi — cùng định nghĩa với thanh tiến độ của trình làm bài", () => {
  it("có lựa chọn ⇒ đã làm; có chữ không trắng ⇒ đã làm; trắng/khoảng trắng/không có ⇒ chưa", () => {
    const c = { examQuestionId: "q" };
    expect(laDaTraLoi(c, { q: [1] }, {})).toBe(true);
    expect(laDaTraLoi(c, {}, { q: "  có chữ " })).toBe(true);
    expect(laDaTraLoi(c, { q: [] }, { q: "   " })).toBe(false);
    expect(laDaTraLoi(c, {}, {})).toBe(false);
  });
});

describe("[NBT-02] cauChuaLam", () => {
  it("trả SỐ THỨ TỰ 1-based theo thứ tự hiển thị", () => {
    expect(cauChuaLam(cau("a", "b", "c", "d"), { a: [0], c: [2] }, { d: " " })).toEqual([2, 4]);
  });
  it("làm hết ⇒ rỗng; chưa làm gì ⇒ mọi câu", () => {
    expect(cauChuaLam(cau("a", "b"), { a: [0], b: [1] }, {})).toEqual([]);
    expect(cauChuaLam(cau("a", "b"), {}, {})).toEqual([1, 2]);
    expect(cauChuaLam([], {}, {})).toEqual([]);
  });
});
