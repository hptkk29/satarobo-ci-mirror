// A0-07 — registry + decideOutcome (THUẦN). Pure, không DB.
import { describe, it, expect, beforeEach } from "vitest";
import { on, getHandlers, clearHandlers, decideOutcome } from "@/lib/events/registry";
import { registerR7NotificationHandlers } from "@/lib/_handlers/r7-notifications";

describe("[A0-07] registry", () => {
  beforeEach(() => clearHandlers());

  it("[R7-17] đăng ký consumer cho 3 event R7 (payment/class/lead trial)", () => {
    registerR7NotificationHandlers();
    expect(getHandlers("payment.confirmed")).toHaveLength(1);
    expect(getHandlers("class.session_changed")).toHaveLength(1);
    expect(getHandlers("lead.trialAttended")).toHaveLength(1);
  });

  it("[vé 03/09] mốc 'đã học thử xong' nghe CẢ tên đang được phát thật", () => {
    // `syncTrialProgress` phát `lead.awaitingDecision`, không phải `lead.trialAttended`.
    // Trước 03/09 handler chỉ nghe tên sau ⇒ Sale chưa từng nhận tin này.
    // Cuộc đối chiếu ĐẦY ĐỦ hai đầu nằm ở `lib/events/khop-phat-nghe.test.ts`.
    registerR7NotificationHandlers();
    expect(getHandlers("lead.awaitingDecision")).toHaveLength(1);
  });

  it("[A0-07-T5-01] nhiều handler/1 type (thêm = 1 dòng on)", async () => {
    on("demo.ping", async () => {});
    on("demo.ping", async () => {});
    expect(getHandlers("demo.ping")).toHaveLength(2);
    expect(getHandlers("unknown")).toHaveLength(0);
  });

  it("clearHandlers xoá hết", () => {
    on("x", async () => {});
    clearHandlers();
    expect(getHandlers("x")).toHaveLength(0);
  });
});

describe("[A0-07] decideOutcome (retry/FAILED)", () => {
  it("không lỗi → DONE", () => {
    expect(decideOutcome({ anyFailed: false, attempts: 1, maxAttempts: 5 })).toBe("DONE");
  });
  it("[A0-07-T8-01] lỗi + còn lượt → PENDING", () => {
    expect(decideOutcome({ anyFailed: true, attempts: 1, maxAttempts: 5 })).toBe("PENDING");
  });
  it("[A0-07-T8-02] lỗi + hết lượt → FAILED", () => {
    expect(decideOutcome({ anyFailed: true, attempts: 5, maxAttempts: 5 })).toBe("FAILED");
  });
});
