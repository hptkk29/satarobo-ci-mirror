// A0-02 — ACTION_REGISTRY (AC5). Pure, không cần DB.
import { describe, it, expect } from "vitest";
import {
  ACTION_REGISTRY,
  isValidAction,
  firstInvalidAction,
} from "./action-registry";

describe("[A0-02] action-registry", () => {
  it("registry không rỗng + chứa action lõi", () => {
    expect(ACTION_REGISTRY.length).toBeGreaterThan(0);
    expect(ACTION_REGISTRY).toContain("roles:manage");
    expect(ACTION_REGISTRY).toContain("roles:assign");
    expect(ACTION_REGISTRY).toContain("leads:view-all");
  });

  it("[A0-02-T2-02] isValidAction: known=true, lạ=false", () => {
    expect(isValidAction("students:view-all")).toBe(true);
    expect(isValidAction("foo:bar")).toBe(false);
    expect(isValidAction("")).toBe(false);
  });

  it("firstInvalidAction trả action lạ đầu tiên / null", () => {
    expect(firstInvalidAction(["leads:view-all", "honors:view"])).toBeNull();
    expect(firstInvalidAction(["leads:view-all", "evil:hack"])).toBe("evil:hack");
  });
});
