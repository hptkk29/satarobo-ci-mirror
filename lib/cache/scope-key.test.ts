import { describe, it, expect } from "vitest";
import { actorScopeKey } from "./scope-key";

// REQ-04/05 — test CHỐNG LEAK: cache aggregate key theo scope phải phân biệt đúng
// cơ sở, nếu không CENTER_MANAGER CS1 đọc nhầm số tổng của SUPER_ADMIN.
describe("actorScopeKey — chống leak cross-center", () => {
  it("2 cơ sở khác nhau → key KHÁC nhau", () => {
    expect(actorScopeKey({ visibleCenterIds: ["cs1"], isSuperAdmin: false })).not.toBe(
      actorScopeKey({ visibleCenterIds: ["cs2"], isSuperAdmin: false }),
    );
  });

  it("SUPER_ADMIN vs scoped cùng danh sách center → key KHÁC (thấy-tất-cả ≠ thấy-đúng-list)", () => {
    expect(
      actorScopeKey({ visibleCenterIds: ["cs1", "cs2"], isSuperAdmin: true }),
    ).not.toBe(actorScopeKey({ visibleCenterIds: ["cs1", "cs2"], isSuperAdmin: false }));
  });

  it("subset ≠ superset → key KHÁC (CS1 không đọc cache CS1+CS2)", () => {
    expect(actorScopeKey({ visibleCenterIds: ["cs1"], isSuperAdmin: false })).not.toBe(
      actorScopeKey({ visibleCenterIds: ["cs1", "cs2"], isSuperAdmin: false }),
    );
  });

  it("thứ tự center không đổi key (sort ổn định) → cache hit đúng", () => {
    expect(
      actorScopeKey({ visibleCenterIds: ["cs2", "cs1"], isSuperAdmin: false }),
    ).toBe(actorScopeKey({ visibleCenterIds: ["cs1", "cs2"], isSuperAdmin: false }));
  });
});
