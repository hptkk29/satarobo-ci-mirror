import { describe, expect, it } from "vitest";
import {
  SESSION_TRANSITIONS,
  canTransition,
  canStartSession,
  canCompleteSession,
} from "./status";

describe("session state machine (FIX-H4)", () => {
  it("cho phép transition hợp lệ", () => {
    expect(canTransition("SCHEDULED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("SCHEDULED", "CANCELLED")).toBe(true);
    // W2-1: buổi offline được hoàn tất trực tiếp từ SCHEDULED (không cần IN_PROGRESS).
    expect(canTransition("SCHEDULED", "COMPLETED")).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransition("IN_PROGRESS", "CANCELLED")).toBe(true);
  });

  it("chặn transition phi lý", () => {
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("CANCELLED", "IN_PROGRESS")).toBe(false);
  });

  it("terminal không có lối ra", () => {
    expect(SESSION_TRANSITIONS.COMPLETED).toEqual([]);
    expect(SESSION_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("canStartSession: chỉ SCHEDULED", () => {
    expect(canStartSession("SCHEDULED")).toBe(true);
    expect(canStartSession("IN_PROGRESS")).toBe(false);
    expect(canStartSession("COMPLETED")).toBe(false);
    expect(canStartSession("CANCELLED")).toBe(false);
  });

  it("canCompleteSession: SCHEDULED (offline) hoặc IN_PROGRESS — buổi COMPLETED/CANCELLED bị chặn", () => {
    expect(canCompleteSession("IN_PROGRESS")).toBe(true);
    // W2-1: buổi offline hoàn tất trực tiếp từ SCHEDULED.
    expect(canCompleteSession("SCHEDULED")).toBe(true);
    expect(canCompleteSession("COMPLETED")).toBe(false);
    expect(canCompleteSession("CANCELLED")).toBe(false);
    // buổi đã COMPLETED không thể bắt đầu lại
    expect(canStartSession("COMPLETED")).toBe(false);
  });
});
