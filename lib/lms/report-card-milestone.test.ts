// #17 Gap 1 (câu 55) — mốc kỳ học bạ buổi 5 & buổi 12. Test THUẦN, không DB.
import { describe, it, expect } from "vitest";
import type { PeriodComment } from "@/lib/lms/report-card-core";
import {
  REPORT_CARD_MILESTONES,
  ensureMilestonePeriods,
  isMilestonePeriod,
  milestoneLabel,
  milestonePeriodKey,
  missingMilestoneComments,
  reachedMilestones,
} from "@/lib/lms/report-card-milestone";

const p = (period: string, comment: string): PeriodComment => ({ period, comment });

describe("mốc kỳ học bạ", () => {
  it("đúng 2 mốc theo câu 55", () => {
    expect(REPORT_CARD_MILESTONES).toEqual([5, 12]);
    expect(milestonePeriodKey(5)).toBe("SESSION_5");
    expect(milestonePeriodKey(12)).toBe("SESSION_12");
    expect(milestoneLabel(5)).toBe("Kỳ 1 — buổi 5");
    expect(milestoneLabel(12)).toBe("Kỳ 2 — buổi 12");
  });

  it("phân biệt khoá kỳ chuẩn với period tự do cũ", () => {
    expect(isMilestonePeriod("SESSION_5")).toBe(true);
    expect(isMilestonePeriod(" SESSION_12 ")).toBe(true);
    expect(isMilestonePeriod("Giữa khoá")).toBe(false);
    expect(isMilestonePeriod("SESSION_7")).toBe(false);
  });

  it("reachedMilestones theo số buổi đã COMPLETED", () => {
    expect(reachedMilestones(0)).toEqual([]);
    expect(reachedMilestones(4)).toEqual([]);
    expect(reachedMilestones(5)).toEqual([5]); // đúng mốc → đã đạt
    expect(reachedMilestones(11)).toEqual([5]);
    expect(reachedMilestones(12)).toEqual([5, 12]);
    expect(reachedMilestones(30)).toEqual([5, 12]);
  });
});

describe("missingMilestoneComments — nguồn 'việc chưa xong' của GV", () => {
  it("chưa tới mốc thì không nhắc", () => {
    expect(missingMilestoneComments(4, [])).toEqual([]);
  });

  it("đạt buổi 5 mà chưa viết → nhắc kỳ 1", () => {
    expect(missingMilestoneComments(5, [])).toEqual([5]);
  });

  it("viết kỳ 1 rồi thì thôi nhắc kỳ 1", () => {
    expect(missingMilestoneComments(5, [p("SESSION_5", "Em tiến bộ")])).toEqual([]);
  });

  it("comment rỗng/trắng KHÔNG tính là đã viết", () => {
    expect(missingMilestoneComments(5, [p("SESSION_5", "   ")])).toEqual([5]);
  });

  it("đạt buổi 12, mới viết kỳ 1 → còn nhắc kỳ 2", () => {
    expect(missingMilestoneComments(12, [p("SESSION_5", "ok")])).toEqual([12]);
  });

  it("đạt buổi 12 chưa viết gì → nhắc cả 2 kỳ", () => {
    expect(missingMilestoneComments(12, [])).toEqual([5, 12]);
  });

  it("period tự do cũ KHÔNG được tính thay cho kỳ chuẩn", () => {
    expect(missingMilestoneComments(5, [p("Giữa khoá", "nhận xét cũ")])).toEqual([5]);
  });
});

describe("ensureMilestonePeriods — dựng sẵn ô nhập cho form", () => {
  it("chưa đạt mốc nào → chỉ còn period tự do cũ", () => {
    expect(ensureMilestonePeriods(3, [p("Giữa khoá", "cũ")])).toEqual([p("Giữa khoá", "cũ")]);
  });

  it("đạt buổi 5 → luôn có ô SESSION_5 dù chưa viết", () => {
    expect(ensureMilestonePeriods(5, [])).toEqual([p("SESSION_5", "")]);
  });

  it("giữ nội dung đã viết + thêm ô kỳ còn thiếu, period cũ đẩy xuống cuối", () => {
    expect(ensureMilestonePeriods(12, [p("Giữa khoá", "cũ"), p("SESSION_5", "đã viết")])).toEqual([
      p("SESSION_5", "đã viết"),
      p("SESSION_12", ""),
      p("Giữa khoá", "cũ"),
    ]);
  });

  it("không nhân bản khi gọi nhiều lần (idempotent)", () => {
    const once = ensureMilestonePeriods(12, []);
    expect(ensureMilestonePeriods(12, once)).toEqual(once);
  });
});
