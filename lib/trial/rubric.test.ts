// 27/08 — thang điểm phiếu trải nghiệm đổi 8.0 → 10.0.
//
// Đây là bộ khoá con số, không phải khoá cách hiển thị: `RUBRIC_MAX` in trên phiếu PDF
// và trên form của giáo viên, còn `rankOf` quyết định chữ "Tốt/Khá/…" mà phụ huynh đọc.
// Tổng 6 tiêu chí LỆCH khỏi `RUBRIC_MAX` là phiếu in ra "9.0 / 10.0" cho một bài làm
// hoàn hảo — không ai báo lỗi, chỉ thấy trung tâm chấm chặt.
import { describe, it, expect } from "vitest";
import {
  RUBRIC,
  RUBRIC_CRITERIA,
  RUBRIC_MAX,
  computeTotal,
  rankOf,
  maxPoints,
} from "./rubric";

describe("[27/08] thang điểm 10.0", () => {
  it("tổng điểm tối đa của 6 tiêu chí ĐÚNG BẰNG RUBRIC_MAX", () => {
    const tong = RUBRIC_CRITERIA.reduce((s, c) => s + maxPoints(c.id), 0);
    expect(RUBRIC_MAX).toBe(10);
    expect(tong).toBe(RUBRIC_MAX);
  });

  it("mỗi tiêu chí vẫn đúng 3 mức, mức giữa = nửa mức đầu, mức cuối = 0", () => {
    // Cấu trúc 3 mức là thứ form giáo viên và phiếu PDF cùng dựa vào; đổi điểm mà làm
    // vỡ cấu trúc thì hai chỗ đó hỏng theo, không phải chỉ con số lệch.
    for (const c of RUBRIC_CRITERIA) {
      expect(c.levels, c.id).toHaveLength(3);
      expect(c.levels[1]!.points, c.id).toBe(c.levels[0]!.points / 2);
      expect(c.levels[2]!.points, c.id).toBe(0);
    }
  });

  it("mọi điểm đều là bội của 0.5 — không đẻ số lẻ khó đọc trên phiếu", () => {
    for (const c of RUBRIC_CRITERIA)
      for (const l of c.levels) expect((l.points * 2) % 1, `${c.id}=${l.points}`).toBe(0);
  });

  it("chấm tối đa mọi tiêu chí → đúng 10.0", () => {
    const scores = Object.fromEntries(RUBRIC_CRITERIA.map((c) => [c.id, maxPoints(c.id)]));
    expect(computeTotal(scores)).toBe(10);
  });

  it("ngưỡng xếp loại bám thang 10: 8 Tốt · 6 Khá · 4 Trung bình · dưới nữa Cần cố gắng", () => {
    expect(rankOf(10).label).toBe("Tốt");
    expect(rankOf(8).label).toBe("Tốt");
    expect(rankOf(7.5).label).toBe("Khá");
    expect(rankOf(6).label).toBe("Khá");
    expect(rankOf(5.5).label).toBe("Trung bình");
    expect(rankOf(4).label).toBe("Trung bình");
    expect(rankOf(3.5).label).toBe("Cần cố gắng");
    expect(rankOf(0).label).toBe("Cần cố gắng");
  });

  it("ba nhóm giữ nguyên, hai nhóm 'mềm' vẫn nặng hơn nhóm thao tác máy", () => {
    // Trọng số là quyết định nghiệp vụ: thái độ và tư duy đáng giá hơn kỹ năng gõ phím.
    // Đổi thang mà đảo trọng số là đổi nghĩa của phiếu, không phải đổi đơn vị.
    const tongNhom = RUBRIC.map((s) =>
      s.criteria.reduce((a, c) => a + maxPoints(c.id), 0),
    );
    expect(tongNhom).toEqual([4, 2, 4]);
  });
});
