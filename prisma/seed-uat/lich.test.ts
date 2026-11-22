// Canh gác bộ rải buổi của seed UAT — QA site GV vòng 1 (BUG-033).
import { describe, expect, it } from "vitest";

import { raiTheoThu, thuVN } from "./lich";

// MOC = 2026-08-23T00:00:00Z — Chủ nhật.
describe("thuVN", () => {
  it("mốc seed là Chủ nhật (0)", () => {
    expect(thuVN(0)).toBe(0);
  });

  it("đếm tiến đúng trong tuần", () => {
    expect(thuVN(1)).toBe(1); // T2
    expect(thuVN(3)).toBe(3); // T4
    expect(thuVN(6)).toBe(6); // T7
    expect(thuVN(7)).toBe(0); // CN tuần sau
  });

  it("đếm lùi cũng đúng (lớp đã khai giảng từ trước mốc)", () => {
    expect(thuVN(-1)).toBe(6); // T7 trước đó
    expect(thuVN(-7)).toBe(0);
  });
});

describe("raiTheoThu", () => {
  it("lớp T7: MỌI buổi rơi vào thứ Bảy, cách nhau đúng 7 ngày", () => {
    const ds = raiTheoThu(-32, [6], 4);
    expect(ds).toHaveLength(4);
    for (const d of ds) expect(thuVN(d)).toBe(6);
    for (let i = 1; i < ds.length; i++) expect(ds[i]! - ds[i - 1]!).toBe(7);
  });

  it("lớp CN: mọi buổi rơi vào Chủ nhật", () => {
    const ds = raiTheoThu(-10, [0], 5);
    for (const d of ds) expect(thuVN(d)).toBe(0);
  });

  it("lớp hai buổi/tuần (T3-T5): xen kẽ đúng hai thứ", () => {
    const ds = raiTheoThu(0, [2, 4], 6);
    expect(ds).toHaveLength(6);
    for (const d of ds) expect([2, 4]).toContain(thuVN(d));
    // Xen kẽ: không có hai buổi liên tiếp cùng thứ.
    for (let i = 1; i < ds.length; i++) {
      expect(thuVN(ds[i]!)).not.toBe(thuVN(ds[i - 1]!));
    }
  });

  it("lớp T2-T6 sinh đủ CẢ HAI thứ — không phải chỉ T2", () => {
    // QA đo được lớp "T2 - T6" chỉ có buổi T2, không buổi nào T6.
    const thu = new Set(raiTheoThu(0, [1, 5], 8).map(thuVN));
    expect(thu).toEqual(new Set([1, 5]));
  });

  it("khai giảng KHÔNG rơi đúng thứ học ⇒ buổi đầu dời tới thứ học kế tiếp", () => {
    // batDau = 0 là Chủ nhật; lớp học thứ Tư (3) ⇒ buổi đầu phải là +3.
    expect(raiTheoThu(0, [3], 1)).toEqual([3]);
  });

  it("khai giảng ĐÚNG thứ học ⇒ buổi đầu chính là ngày đó", () => {
    expect(raiTheoThu(0, [0], 1)).toEqual([0]);
  });

  it("sinh đúng SỐ BUỔI yêu cầu, không thừa không thiếu", () => {
    expect(raiTheoThu(-100, [6], 11)).toHaveLength(11);
  });

  it("soBuoi = 0 ⇒ rỗng", () => {
    expect(raiTheoThu(0, [6], 0)).toEqual([]);
  });

  it("days rỗng ⇒ lùi về mỗi tuần một buổi, KHÔNG ném lỗi giữa lượt seed", () => {
    expect(raiTheoThu(5, [], 3)).toEqual([5, 12, 19]);
  });

  it("days trùng lặp / ngoài 0-6 vẫn xử được", () => {
    const ds = raiTheoThu(0, [6, 6, 9, -1], 3);
    expect(ds).toHaveLength(3);
    for (const d of ds) expect(thuVN(d)).toBe(6);
  });
});
