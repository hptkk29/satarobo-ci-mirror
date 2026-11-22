// T-WIN (site GV 25/08) — cửa nộp bài: quá hạn tự đóng + cửa gia hạn "nộp trễ".
// Thuần (không DB) → chạy lane test:unit mặc định.
//
// Mốc giờ viết dạng ISO có "Z" (tuyệt đối), KHÔNG dùng `new Date(y,m,d,h,m)`: bộ test
// chạy cả trên máy dev (+07) lẫn CI (UTC), dựng giờ theo TZ máy là test xanh/đỏ theo
// nơi chạy chứ không theo code.
import { describe, it, expect } from "vitest";
import {
  assignmentWindow,
  assignmentWindowLabel,
  formatVnShort,
  realDueAt,
  toVnDateTimeInput,
} from "./assignment-window";

const DUE = new Date("2026-08-20T16:59:00Z"); // 23:59 giờ VN
const GRACE = new Date("2026-08-23T16:59:00Z"); // 23:59 giờ VN, 3 ngày sau
const BEFORE = new Date("2026-08-19T00:00:00Z");
const AFTER_DUE = new Date("2026-08-21T00:00:00Z");
const AFTER_GRACE = new Date("2026-08-24T00:00:00Z");

describe("assignmentWindow — trạng thái nền", () => {
  it("[T-WIN-1] DRAFT/ARCHIVED không bao giờ nhận bài", () => {
    const draft = assignmentWindow({ status: "DRAFT", dueAt: null, lateUntil: null }, BEFORE);
    expect(draft.state).toBe("draft");
    expect(draft.acceptsSubmission).toBe(false);

    // Còn hạn + còn cửa gia hạn cũng không mở: HV chưa từng thấy bài này.
    const archived = assignmentWindow(
      { status: "ARCHIVED", dueAt: DUE, lateUntil: GRACE },
      AFTER_DUE,
    );
    expect(archived.state).toBe("archived");
    expect(archived.acceptsSubmission).toBe(false);
  });

  it("[T-WIN-2] CLOSED lưu trong DB (người đóng tay) THẮNG cửa gia hạn còn hạn", () => {
    const w = assignmentWindow({ status: "CLOSED", dueAt: DUE, lateUntil: GRACE }, AFTER_DUE);
    expect(w.state).toBe("closed");
    expect(w.acceptsSubmission).toBe(false);
    // Vẫn nói được "hết hạn lúc nào" để câu báo cho PH có mốc giờ.
    expect(w.until).toEqual(GRACE);
  });

  it("[T-WIN-3] PUBLISHED không hạn nộp → mở mãi (giữ nguyên hành vi cũ)", () => {
    const w = assignmentWindow({ status: "PUBLISHED", dueAt: null, lateUntil: null }, AFTER_GRACE);
    expect(w.state).toBe("open");
    expect(w.acceptsSubmission).toBe(true);
    expect(w.countsAsLate).toBe(false);
    expect(w.until).toBeNull();
  });

  it("[T-WIN-4] hạn nộp dạng epoch 1970 = coi như KHÔNG có hạn (bài seed)", () => {
    const w = assignmentWindow(
      { status: "PUBLISHED", dueAt: new Date(0), lateUntil: null },
      AFTER_GRACE,
    );
    expect(w.state).toBe("open");
    expect(w.until).toBeNull();
  });
});

describe("assignmentWindow — quá hạn tự đóng", () => {
  it("[T-WIN-5] trong hạn → mở, không tính trễ", () => {
    const w = assignmentWindow({ status: "PUBLISHED", dueAt: DUE, lateUntil: null }, BEFORE);
    expect(w.state).toBe("open");
    expect(w.countsAsLate).toBe(false);
    expect(w.until).toEqual(DUE);
  });

  it("[T-WIN-6] ĐÚNG phút hạn vẫn còn mở (biên `>` chứ không phải `>=`)", () => {
    const w = assignmentWindow({ status: "PUBLISHED", dueAt: DUE, lateUntil: null }, new Date(DUE));
    expect(w.state).toBe("open");
    expect(w.acceptsSubmission).toBe(true);
  });

  it("[T-WIN-7] quá hạn 1ms + chưa gia hạn → TỰ ĐÓNG dù cột status vẫn PUBLISHED", () => {
    const w = assignmentWindow(
      { status: "PUBLISHED", dueAt: DUE, lateUntil: null },
      new Date(DUE.getTime() + 1),
    );
    expect(w.state).toBe("closed");
    expect(w.acceptsSubmission).toBe(false);
    expect(w.until).toEqual(DUE);
  });
});

describe("assignmentWindow — cửa nộp bù", () => {
  it("[T-WIN-8] quá hạn + còn cửa gia hạn → nhận bài NHƯNG tính trễ", () => {
    const w = assignmentWindow({ status: "PUBLISHED", dueAt: DUE, lateUntil: GRACE }, AFTER_DUE);
    expect(w.state).toBe("late-open");
    expect(w.acceptsSubmission).toBe(true);
    expect(w.countsAsLate).toBe(true);
    expect(w.until).toEqual(GRACE);
  });

  it("[T-WIN-9] ĐÚNG phút hết cửa gia hạn vẫn nhận (cùng quy ước biên với hạn nộp)", () => {
    const w = assignmentWindow(
      { status: "PUBLISHED", dueAt: DUE, lateUntil: GRACE },
      new Date(GRACE),
    );
    expect(w.state).toBe("late-open");
    expect(w.acceptsSubmission).toBe(true);
  });

  it("[T-WIN-10] quá cửa gia hạn 1ms → đóng lại, mốc báo là hạn nộp bù", () => {
    const w = assignmentWindow(
      { status: "PUBLISHED", dueAt: DUE, lateUntil: GRACE },
      new Date(GRACE.getTime() + 1),
    );
    expect(w.state).toBe("closed");
    expect(w.acceptsSubmission).toBe(false);
    expect(w.until).toEqual(GRACE);
  });

  it("[T-WIN-11] gia hạn khi CHƯA quá hạn → vẫn 'open', chưa tính trễ", () => {
    // GV mở trước hạn (dự phòng) không được biến bài đang trong hạn thành nộp trễ.
    const w = assignmentWindow({ status: "PUBLISHED", dueAt: DUE, lateUntil: GRACE }, BEFORE);
    expect(w.state).toBe("open");
    expect(w.countsAsLate).toBe(false);
    expect(w.until).toEqual(DUE);
  });

  it("[T-WIN-12] cửa gia hạn đã hết trước cả 'now' → không hồi sinh bài", () => {
    const w = assignmentWindow(
      { status: "PUBLISHED", dueAt: DUE, lateUntil: GRACE },
      AFTER_GRACE,
    );
    expect(w.state).toBe("closed");
  });
});

describe("assignmentWindow — bài KHÔNG có hạn nộp gốc + cửa nộp bù", () => {
  // Đường đi thật của nhóm này: bài không đặt hạn → admin đóng tay (CLOSED) → GV bấm
  // "Mở nộp bù" (grantLateWindowAction lật CLOSED→PUBLISHED trong CÙNG lệnh ghi
  // `lateUntil`). Bug cũ: nhánh "không hạn" trả thẳng open và bỏ qua `lateUntil` ⇒ bài
  // mở vĩnh viễn, và vì state là "open" nên `canExtend` tắt luôn — mất cả nút thu hồi.
  it("[T-WIN-15] cửa gia hạn LÀ mốc đóng khi không có hạn gốc", () => {
    const trong = assignmentWindow(
      { status: "PUBLISHED", dueAt: null, lateUntil: GRACE },
      AFTER_DUE,
    );
    expect(trong.state).toBe("late-open");
    expect(trong.acceptsSubmission).toBe(true);
    expect(trong.until).toEqual(GRACE);

    const sau = assignmentWindow(
      { status: "PUBLISHED", dueAt: null, lateUntil: GRACE },
      AFTER_GRACE,
    );
    expect(sau.state).toBe("closed");
    expect(sau.acceptsSubmission).toBe(false);
    expect(sau.until).toEqual(GRACE);
  });

  it("[T-WIN-16] không có hạn gốc → nộp trong cửa KHÔNG bị tính trễ, nhãn cũng không gọi 'nộp trễ'", () => {
    const w = assignmentWindow({ status: "PUBLISHED", dueAt: null, lateUntil: GRACE }, AFTER_DUE);
    expect(w.countsAsLate).toBe(false); // cổng PH ghi SUBMITTED, không phải LATE
    expect(assignmentWindowLabel(w)).toBe("Nhận bài đến 23/08 23:59");
  });

  it("[T-WIN-17] ĐÚNG phút hết cửa vẫn nhận (cùng quy ước biên `<=` với bài có hạn)", () => {
    const w = assignmentWindow(
      { status: "PUBLISHED", dueAt: null, lateUntil: GRACE },
      new Date(GRACE),
    );
    expect(w.state).toBe("late-open");
    expect(w.acceptsSubmission).toBe(true);
  });

  it("[T-WIN-18] hạn epoch 1970 đi CHUNG một đường với 'không có hạn'", () => {
    const w = assignmentWindow(
      { status: "PUBLISHED", dueAt: new Date(0), lateUntil: GRACE },
      AFTER_GRACE,
    );
    expect(w.state).toBe("closed");
    expect(w.until).toEqual(GRACE);
  });

  it("[T-WIN-19] mọi trạng thái của bài không-hạn-đã-gia-hạn đều còn nút gia hạn/thu hồi", () => {
    // `buildAssignmentWindowView` bật `canExtend` cho đúng closed + late-open. Rơi ra
    // "open" là GV mất đường thu hồi và bài không còn ai đóng được.
    for (const luc of [AFTER_DUE, AFTER_GRACE]) {
      const w = assignmentWindow({ status: "PUBLISHED", dueAt: null, lateUntil: GRACE }, luc);
      expect(["closed", "late-open"]).toContain(w.state);
    }
  });

  it("[T-WIN-20] chưa gia hạn thì vẫn mở mãi — không siết oan bài đang chạy", () => {
    const w = assignmentWindow({ status: "PUBLISHED", dueAt: null, lateUntil: null }, AFTER_GRACE);
    expect(w.state).toBe("open");
    expect(w.until).toBeNull();
  });
});

describe("realDueAt — bộ lọc 'hạn thật' dùng chung cho màn GV + cổng PH", () => {
  it("[T-WIN-21] null / trước năm 2000 = không có hạn; hạn thật giữ nguyên", () => {
    expect(realDueAt(null)).toBeNull();
    expect(realDueAt(new Date(0))).toBeNull();
    expect(realDueAt(new Date("1999-12-31T23:59:59Z"))).toBeNull();
    expect(realDueAt(DUE)).toEqual(DUE);
  });
});

describe("nhãn + chuỗi giờ VN", () => {
  it("[T-WIN-13] nhãn kèm mốc giờ VN cho trạng thái nộp bù", () => {
    const w = assignmentWindow({ status: "PUBLISHED", dueAt: DUE, lateUntil: GRACE }, AFTER_DUE);
    // 2026-08-23T16:59Z = 23:59 ngày 23/08 giờ VN.
    expect(assignmentWindowLabel(w)).toBe("Nộp trễ đến 23/08 23:59");
    expect(assignmentWindowLabel(assignmentWindow({ status: "PUBLISHED", dueAt: DUE, lateUntil: null }, BEFORE))).toBe("Đang mở");
  });

  it("[T-WIN-14] đổi giờ hiển thị theo ĐỒNG HỒ VN, không theo TZ máy chạy", () => {
    // 17:30Z = 00:30 hôm SAU ở VN — đúng chỗ bug 'chạy máy tôi thì được' hay rơi vào.
    const d = new Date("2026-08-20T17:30:00Z");
    expect(formatVnShort(d)).toBe("21/08 00:30");
    expect(toVnDateTimeInput(d)).toBe("2026-08-21T00:30");
  });
});
