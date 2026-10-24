// Trạng thái suất Trial trên bảng site GV. Đây là chỗ dễ sai vì thứ tự ưu tiên: một
// suất có thể vừa "đã đánh giá" vừa "đã nhập học" vừa "bị dời lịch" cùng lúc, và bảng
// chỉ in được một nhãn.
import { describe, it, expect } from "vitest";
import {
  demChoDanhGia,
  isSettledTrialRow,
  trialRowStatus,
  type TrialRowStatus,
} from "./trial-row-status";

/** Mốc UTC 00:00 ngày 15/08/2026 (giờ VN) — trùng quy ước @db.Date của Trial. */
const TODAY = Date.UTC(2026, 7, 15);
const d = (day: number) => new Date(Date.UTC(2026, 7, day));

const base = {
  enrollmentStatus: "ACTIVE" as const,
  outcome: "PENDING" as string | null,
  evaluated: false,
  rescheduled: false,
  sessionDate: d(20),
  sessionStatus: "SCHEDULED" as const,
  todayMs: TODAY,
};

describe("trialRowStatus", () => {
  it("buổi còn ở tương lai → Sắp tới", () => {
    expect(trialRowStatus(base)).toBe("upcoming");
  });

  it("buổi hôm nay vẫn là Sắp tới (chưa dạy xong)", () => {
    expect(trialRowStatus({ ...base, sessionDate: d(15) })).toBe("upcoming");
  });

  it("bị dời sang buổi tương lai → Bị dời lịch", () => {
    expect(trialRowStatus({ ...base, rescheduled: true })).toBe("rescheduled");
  });

  it("buổi đã qua, chưa có phiếu → Chờ đánh giá", () => {
    expect(trialRowStatus({ ...base, sessionDate: d(10) })).toBe("awaiting-eval");
  });

  it("buổi đánh COMPLETED dù ngày là hôm nay → Chờ đánh giá", () => {
    expect(
      trialRowStatus({ ...base, sessionDate: d(15), sessionStatus: "COMPLETED" }),
    ).toBe("awaiting-eval");
  });

  it("buổi đã qua NHƯNG từng bị dời → vẫn là Chờ đánh giá, không nhắc lịch cũ nữa", () => {
    expect(
      trialRowStatus({ ...base, sessionDate: d(10), rescheduled: true }),
    ).toBe("awaiting-eval");
  });

  it("đã có phiếu → Đã đánh giá, thắng cả 'buổi đã qua'", () => {
    expect(
      trialRowStatus({ ...base, sessionDate: d(10), evaluated: true }),
    ).toBe("evaluated");
  });

  it("đã nhập học thắng TẤT CẢ — kể cả khi buổi còn ở tương lai và chưa có phiếu", () => {
    expect(
      trialRowStatus({ ...base, outcome: "ENROLLED", rescheduled: true }),
    ).toBe("enrolled");
    expect(
      trialRowStatus({
        ...base,
        outcome: "ENROLLED",
        enrollmentStatus: "WITHDRAWN",
        evaluated: true,
      }),
    ).toBe("enrolled");
  });

  it("lead mất → Bị rớt, thắng cả 'đã đánh giá'", () => {
    expect(trialRowStatus({ ...base, outcome: "LOST", evaluated: true })).toBe("lost");
  });

  it("bị gỡ khỏi lớp ≠ bị rớt", () => {
    expect(trialRowStatus({ ...base, enrollmentStatus: "WITHDRAWN" })).toBe("withdrawn");
  });

  it("outcome null (chưa có dòng lịch sử) không được coi là kết cục", () => {
    expect(trialRowStatus({ ...base, outcome: null })).toBe("upcoming");
  });

  it("chưa xếp buổi → chưa diễn ra, vẫn Sắp tới", () => {
    expect(
      trialRowStatus({ ...base, sessionDate: null, sessionStatus: null }),
    ).toBe("upcoming");
  });
});

describe("isSettledTrialRow — suất nào rơi xuống bảng 'Đã Trial'", () => {
  it("nhập học / rớt / rút = xong việc", () => {
    expect(isSettledTrialRow("enrolled")).toBe(true);
    expect(isSettledTrialRow("lost")).toBe(true);
    expect(isSettledTrialRow("withdrawn")).toBe(true);
  });

  it("còn lại vẫn thuộc luồng đang chạy", () => {
    expect(isSettledTrialRow("upcoming")).toBe(false);
    expect(isSettledTrialRow("rescheduled")).toBe(false);
    expect(isSettledTrialRow("awaiting-eval")).toBe(false);
    // Đã đánh giá nhưng chưa biết nhập học hay không → vẫn chờ kết cục.
    expect(isSettledTrialRow("evaluated")).toBe(false);
  });
});

describe("demChoDanhGia — số in trên ô 'Trial chờ đánh giá' của trang chủ GV", () => {
  const r = (status: TrialRowStatus) => ({ status });

  it("chỉ đếm suất ĐÃ DẠY mà chưa có phiếu", () => {
    expect(
      demChoDanhGia([
        r("awaiting-eval"),
        r("awaiting-eval"),
        r("upcoming"),
        r("evaluated"),
      ]),
    ).toBe(2);
  });

  it("không đếm suất đã xong việc hay chưa tới — ô này là VIỆC CẦN LÀM", () => {
    // Ba trạng thái "xong việc" và hai trạng thái "chưa tới lượt" đều phải bị loại:
    // đếm nhầm là ô báo nợ vĩnh viễn, giáo viên mở ra không thấy gì để làm.
    expect(
      demChoDanhGia([
        r("enrolled"),
        r("lost"),
        r("withdrawn"),
        r("upcoming"),
        r("rescheduled"),
        r("evaluated"),
      ]),
    ).toBe(0);
  });

  it("danh sách rỗng → 0", () => {
    expect(demChoDanhGia([])).toBe(0);
  });
});
