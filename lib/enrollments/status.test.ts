import { describe, expect, it } from "vitest";
import { ENROLLMENT_TRANSITIONS, canTransition } from "./status";

describe("enrollment state machine (FIX-H4)", () => {
  it("cho phép các transition hợp lệ", () => {
    expect(canTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("PENDING", "CANCELLED")).toBe(true);
    expect(canTransition("CONFIRMED", "STUDYING")).toBe(true);
    expect(canTransition("CONFIRMED", "ACTIVE")).toBe(true);
    expect(canTransition("CONFIRMED", "WITHDREW")).toBe(true);
    expect(canTransition("STUDYING", "COMPLETED")).toBe(true);
    expect(canTransition("STUDYING", "PAUSED")).toBe(true);
    expect(canTransition("STUDYING", "TRANSFERRED")).toBe(true);
    expect(canTransition("ACTIVE", "COMPLETED")).toBe(true);
    expect(canTransition("PAUSED", "STUDYING")).toBe(true);
  });

  it("chặn nhảy trạng thái phi lý", () => {
    expect(canTransition("CANCELLED", "ACTIVE")).toBe(false);
    expect(canTransition("COMPLETED", "PENDING")).toBe(false);
    expect(canTransition("PENDING", "COMPLETED")).toBe(false);
    expect(canTransition("PENDING", "STUDYING")).toBe(false);
    expect(canTransition("WITHDREW", "STUDYING")).toBe(false);
    expect(canTransition("TRANSFERRED", "CONFIRMED")).toBe(false);
  });

  it("các trạng thái terminal không có lối ra", () => {
    expect(ENROLLMENT_TRANSITIONS.COMPLETED).toEqual([]);
    expect(ENROLLMENT_TRANSITIONS.WITHDREW).toEqual([]);
    expect(ENROLLMENT_TRANSITIONS.TRANSFERRED).toEqual([]);
    expect(ENROLLMENT_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("no-op (from === to) KHÔNG coi là transition hợp lệ", () => {
    expect(canTransition("CONFIRMED", "CONFIRMED")).toBe(false);
    expect(canTransition("STUDYING", "STUDYING")).toBe(false);
  });
});
