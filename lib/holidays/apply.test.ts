/**
 * Lỗi PROD 04/09/2026: thêm ngày nghỉ mà buổi học trùng ngày KHÔNG được dời đi.
 *
 * Gốc: `applyHolidayShift` có dòng
 *     if (!usePhases && (!days || days.length === 0)) continue;  // "không rõ lịch"
 * và nó `continue` IM LẶNG — không log, không lỗi, hàm trả `shifted: 0`.
 *
 * Đo trên dữ liệu thật: 9/9 buổi rơi đúng ngày nghỉ lọt qua MỌI bộ lọc rồi chết ở
 * đúng dòng đó; và **100/100 lớp** không có `scheduleDays` LẪN `schedulePhases`.
 * Nghĩa là nhánh "không rõ lịch" không phải ca hiếm — nó là ca DUY NHẤT, nên tính
 * năng dời buổi chưa từng chạy một lần nào.
 */
import { describe, it, expect } from "vitest";
import { suyThuHopLe } from "./apply";

describe("suyThuHopLe — thứ nào lớp có học", () => {
  it("có scheduleDays thì tin nó", () => {
    expect(suyThuHopLe([2, 4], [3], 3)).toEqual([2, 4]);
  });

  it("KHÔNG có scheduleDays → suy từ thứ của chính các buổi lớp đang có", () => {
    // Đây là vế cứu cả tính năng. Lớp học T3/T5 thì buổi của nó rơi vào T3/T5 —
    // lịch nằm sẵn trong dữ liệu, không cần cột nào khác.
    expect(suyThuHopLe([], [2, 4, 2, 4, 2], 2).sort()).toEqual([2, 4]);
    expect(suyThuHopLe(null, [3], 3)).toEqual([3]);
    expect(suyThuHopLe(undefined, [0, 6], 0).sort()).toEqual([0, 6]);
  });

  it("lớp chỉ có ĐÚNG buổi đang dời → cùng thứ (tuần sau)", () => {
    // Không còn gì để suy. "Tuần sau, cùng thứ" là phỏng đoán ít sai nhất, và
    // vẫn hơn hẳn bỏ mặc buổi nằm trên ngày nghỉ như bản cũ.
    expect(suyThuHopLe([], [], 5)).toEqual([5]);
    expect(suyThuHopLe(null, [], 0)).toEqual([0]);
  });

  it("KHÔNG BAO GIỜ trả mảng rỗng — mảng rỗng là quay lại đúng lỗi cũ", () => {
    // Bản cũ coi "không rõ lịch" là lý do bỏ qua buổi. Hàm này phải luôn đưa ra
    // được một câu trả lời, kẻo vòng tìm ngày dời không có thứ nào để khớp.
    for (const ca of [
      suyThuHopLe([], [], 3),
      suyThuHopLe(null, [], 3),
      suyThuHopLe(undefined, [], 3),
      suyThuHopLe([], [1], 3),
    ]) {
      expect(ca.length).toBeGreaterThan(0);
    }
  });

  it("khử trùng thứ — 20 buổi cùng thứ 4 chỉ ra một giá trị", () => {
    expect(suyThuHopLe([], Array(20).fill(4), 4)).toEqual([4]);
  });
});
