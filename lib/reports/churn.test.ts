// LMS-16 — Báo cáo churn / drop-off (THUẦN, không cần DB). Pure fixtures + assert.
import { describe, it, expect } from "vitest";
import {
  buildChurnReport,
  churnByMonth,
  churnByCenter,
  churnSummary,
  enumerateMonths,
  nextMonthKey,
  isWithdrew,
  type ChurnEnrollmentRecord,
} from "@/lib/reports/churn";

const d = (s: string) => new Date(s);

// Fixture: 6 enrollment phủ đang học / rời / hoàn thành ở 2 cơ sở, nhiều tháng.
// Giờ VN = UTC+7 (mốc 03:00Z = 10:00 VN cùng ngày).
const records: ChurnEnrollmentRecord[] = [
  // c1: bắt đầu 04, rời 06 → mẫu số tháng 05 & 06, churn tháng 06
  { status: "WITHDREW", centerId: "c1", startedAt: d("2026-04-05T03:00:00Z"), endedAt: d("2026-06-10T03:00:00Z") },
  // c1: bắt đầu 04, vẫn học
  { status: "STUDYING", centerId: "c1", startedAt: d("2026-04-06T03:00:00Z"), endedAt: null },
  // c1: bắt đầu 05, hoàn thành 06 (không tính churn)
  { status: "COMPLETED", centerId: "c1", startedAt: d("2026-05-02T03:00:00Z"), endedAt: d("2026-06-20T03:00:00Z") },
  // c2: bắt đầu 04, rời 05
  { status: "WITHDREW", centerId: "c2", startedAt: d("2026-04-10T03:00:00Z"), endedAt: d("2026-05-15T03:00:00Z") },
  // c2: bắt đầu 05, vẫn học
  { status: "STUDYING", centerId: "c2", startedAt: d("2026-05-03T03:00:00Z"), endedAt: null },
  // c2: bắt đầu 06, vẫn học (centerId null cho 1 record để test "Không rõ")
  { status: "STUDYING", centerId: null, startedAt: d("2026-06-01T03:00:00Z"), endedAt: null },
];

describe("[LMS-16] nextMonthKey / enumerateMonths", () => {
  it("tháng kế tiếp, vắt qua năm", () => {
    expect(nextMonthKey("2026-05")).toBe("2026-06");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
  });
  it("liệt kê dải tháng liên tục", () => {
    expect(enumerateMonths("2026-04", "2026-06")).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(enumerateMonths("2026-06", "2026-04")).toEqual([]); // from > to
    expect(enumerateMonths("2026-05", "2026-05")).toEqual(["2026-05"]);
  });
});

describe("[LMS-16] isWithdrew", () => {
  it("chỉ true với status WITHDREW", () => {
    expect(isWithdrew(records[0])).toBe(true);
    expect(isWithdrew(records[1])).toBe(false);
  });
});

describe("[LMS-16] churnSummary", () => {
  it("tổng / đang học / rời / hoàn thành / tỉ lệ", () => {
    const s = churnSummary(records);
    expect(s.total).toBe(6);
    expect(s.active).toBe(3); // 3 record endedAt null
    expect(s.withdrew).toBe(2); // 2 WITHDREW
    expect(s.completed).toBe(1); // 1 COMPLETED
    expect(s.churnRate).toBeCloseTo(2 / 6);
  });
  it("mảng rỗng → toàn 0", () => {
    expect(churnSummary([])).toEqual({ total: 0, active: 0, withdrew: 0, completed: 0, churnRate: 0 });
  });
});

describe("[LMS-16] churnByMonth", () => {
  it("mẫu số = đang học đầu kỳ; tử số = rời trong kỳ", () => {
    const m = churnByMonth(records);
    const byKey = Object.fromEntries(m.map((p) => [p.period, p]));
    // Dải tháng: 04 → 06.
    expect(m.map((p) => p.period)).toEqual(["2026-04", "2026-05", "2026-06"]);

    // Tháng 04: chưa ai bắt đầu trước 04 → đang học đầu kỳ = 0.
    expect(byKey["2026-04"].activeAtStart).toBe(0);
    expect(byKey["2026-04"].withdrew).toBe(0);

    // Tháng 05 đầu kỳ: các enrollment bắt đầu < 05 và chưa kết thúc trước 05.
    // = 3 record bắt đầu tháng 04 (cả 2 c1 + 1 c2), tất cả chưa kết thúc trước 05.
    expect(byKey["2026-05"].activeAtStart).toBe(3);
    // Rời trong tháng 05: c2 WITHDREW endedAt 05 → 1.
    expect(byKey["2026-05"].withdrew).toBe(1);
    expect(byKey["2026-05"].churnRate).toBeCloseTo(1 / 3);

    // Tháng 06 đầu kỳ: bắt đầu < 06 và chưa kết thúc trước 06.
    // c1 WITHDREW (start 04, end 06 → còn ở đầu 06), c1 STUDYING (start 04),
    // c1 COMPLETED (start 05, end 06 → còn ở đầu 06), c2 STUDYING (start 05).
    // c2 WITHDREW đã kết thúc 05 → loại. → 4.
    expect(byKey["2026-06"].activeAtStart).toBe(4);
    // Rời tháng 06: c1 WITHDREW endedAt 06 → 1 (COMPLETED không tính).
    expect(byKey["2026-06"].withdrew).toBe(1);
    expect(byKey["2026-06"].churnRate).toBeCloseTo(1 / 4);
  });
  it("mảng rỗng → []", () => {
    expect(churnByMonth([])).toEqual([]);
  });
});

describe("[LMS-16] churnByCenter", () => {
  it("nhóm theo cơ sở + map tên; null → Không rõ", () => {
    const g = churnByCenter(records, { c1: "CS1", c2: "CS2" });
    const c1 = g.find((x) => x.key === "c1")!;
    const c2 = g.find((x) => x.key === "c2")!;
    expect(c1.total).toBe(3);
    expect(c1.withdrew).toBe(1);
    expect(c1.label).toBe("CS1");
    expect(c1.churnRate).toBeCloseTo(1 / 3);
    expect(c2.total).toBe(2);
    expect(c2.withdrew).toBe(1);
    const unknown = g.find((x) => x.label === "Không rõ");
    expect(unknown?.total).toBe(1);
    expect(unknown?.withdrew).toBe(0);
  });
});

describe("[LMS-16] buildChurnReport tổng hợp", () => {
  it("gộp summary + byMonth + byCenter; rỗng → không lỗi", () => {
    const r = buildChurnReport(records, { c1: "CS1", c2: "CS2" });
    expect(r.summary.total).toBe(6);
    expect(r.byMonth).toHaveLength(3);
    expect(r.byCenter).toHaveLength(3); // c1, c2, Không rõ
    const empty = buildChurnReport([]);
    expect(empty.summary.total).toBe(0);
    expect(empty.byMonth).toEqual([]);
    expect(empty.byCenter).toEqual([]);
  });
});
