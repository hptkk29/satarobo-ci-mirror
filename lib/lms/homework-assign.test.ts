// R7-14 — lõi THUẦN cho auto-giao bài: tính hạn nộp theo assignMode.
// Idempotency cấp DB (createMany skipDuplicates qua unique key) phủ ở
// tests/e2e/r7/homework-auto-assign.spec.ts (cần Postgres local).
import { describe, it, expect } from "vitest";
import { computeHomeworkDueAt, type AssignMode } from "@/lib/lms/assignment";

const NOW = new Date("2026-06-16T08:00:00.000Z");

describe("[R7-14] computeHomeworkDueAt", () => {
  it("NOW → hôm nay + defaultDueDays", () => {
    const due = computeHomeworkDueAt({ assignMode: "NOW", now: NOW, defaultDueDays: 7 });
    expect(due?.toISOString()).toBe("2026-06-23T08:00:00.000Z");
  });

  it("NOW + defaultDueDays null → không hạn (null)", () => {
    expect(computeHomeworkDueAt({ assignMode: "NOW", now: NOW, defaultDueDays: null })).toBeNull();
  });

  it("CUSTOM_DUE → dùng hạn GV chọn, bỏ qua defaultDueDays", () => {
    const custom = new Date("2026-07-01T00:00:00.000Z");
    const due = computeHomeworkDueAt({
      assignMode: "CUSTOM_DUE",
      now: NOW,
      defaultDueDays: 7,
      customDueAt: custom,
    });
    expect(due?.toISOString()).toBe(custom.toISOString());
  });

  it("CUSTOM_DUE không truyền hạn → null", () => {
    expect(
      computeHomeworkDueAt({ assignMode: "CUSTOM_DUE", now: NOW, defaultDueDays: 7 }),
    ).toBeNull();
  });

  it("hạn NOW không phụ thuộc múi giờ — cộng đúng số ngày", () => {
    const modes: AssignMode[] = ["NOW"];
    for (const m of modes) {
      const due = computeHomeworkDueAt({ assignMode: m, now: NOW, defaultDueDays: 1 });
      expect(due?.getUTCDate()).toBe(17);
    }
  });
});
