// @vitest-environment jsdom
// components/chat/bump-scheduler.test.ts — nhịp gom cụm tín hiệu `conversation.bumped`.
//
// Đây là chỗ giữ cho một nhóm lớp đang sôi động KHÔNG biến thành một cơn mưa
// `GET /api/chat/unread` + `router.refresh()`. Hàm thuần nên test bằng fake timer, không
// cần render gì.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBumpScheduler } from "./bump-scheduler";

const DEBOUNCE = 800;
const MIN_INTERVAL = 3_000;

function setup(foreground = true) {
  const run = vi.fn();
  let visible = foreground;
  const scheduler = createBumpScheduler({
    debounceMs: DEBOUNCE,
    minIntervalMs: MIN_INTERVAL,
    run,
    isForeground: () => visible,
  });
  return {
    run,
    scheduler,
    setVisible: (v: boolean) => {
      visible = v;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBumpScheduler", () => {
  it("gom cụm: 5 tín hiệu trong 300ms ⇒ chạy ĐÚNG 1 lần", () => {
    const { scheduler, run } = setup();
    for (let i = 0; i < 5; i++) {
      scheduler.ping();
      vi.advanceTimersByTime(60);
    }
    expect(run).not.toHaveBeenCalled(); // còn trong cửa sổ gom cụm

    vi.advanceTimersByTime(DEBOUNCE);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("trần tần suất: bắn liên tục 10 giây vẫn ≤ 4 lần chạy", () => {
    const { scheduler, run } = setup();
    for (let i = 0; i < 100; i++) {
      scheduler.ping();
      vi.advanceTimersByTime(100);
    }
    expect(run.mock.calls.length).toBeLessThanOrEqual(4);
    expect(run.mock.calls.length).toBeGreaterThan(0);
    scheduler.dispose();
  });

  it("tab ẩn ⇒ KHÔNG chạy; quay lại tab ⇒ chạy đúng 1 lần cho cả cụm đang nợ", () => {
    const { scheduler, run, setVisible } = setup(false);

    for (let i = 0; i < 8; i++) scheduler.ping();
    vi.advanceTimersByTime(60_000); // timer bị bóp khi tab ẩn — có chạy cũng không được
    expect(run).not.toHaveBeenCalled();

    setVisible(true);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(MIN_INTERVAL + DEBOUNCE);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("sự kiện focus cũng đánh thức cụm đang nợ", () => {
    const { scheduler, run, setVisible } = setup(false);
    scheduler.ping();
    setVisible(true);
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(MIN_INTERVAL);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("không có tín hiệu nào ⇒ không bao giờ chạy (kể cả khi quay lại tab)", () => {
    const { scheduler, run, setVisible } = setup(false);
    setVisible(true);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(60_000);
    expect(run).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it("dispose ⇒ gỡ timer + listener, không còn chạy nữa", () => {
    const { scheduler, run } = setup();
    scheduler.ping();
    scheduler.dispose();
    vi.advanceTimersByTime(60_000);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(60_000);
    expect(run).not.toHaveBeenCalled();
  });
});
