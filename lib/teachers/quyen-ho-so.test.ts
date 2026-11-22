// [QHS-*] — cổng "mở được hồ sơ giáo viên" (một hàm cho trang hồ sơ + link ở màn Rank giáo viên). Giữ NGUYÊN luật cũ của trang hồ sơ.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const xemTatCa = vi.hoisted(() => new Map<string | null, boolean>());
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async (_k: string, t?: { centerId?: string | null }) => xemTatCa.get(t?.centerId ?? null) ?? false }));

import { hoSoMoDuoc, luatMoHoSo, moDuocHoSoGv } from "./quyen-ho-so";

const gv = (id: string, centerId: string | null) => ({ id, centerId });

describe("[QHS] mở hồ sơ giáo viên", () => {
  it("[QHS-01] chính mình luôn mở được, kể cả không có quyền nào", () => {
    expect(luatMoHoSo({ id: "u1", role: "TEACHER" }, gv("u1", "cs1"), false)).toBe(true);
  });
  it("[QHS-02] không có employees:view-all ⇒ không mở (Giám đốc, Đào tạo đi qua màn Rank giáo viên)", () => {
    expect(luatMoHoSo({ id: "gd", role: "GIAM_DOC" }, gv("u1", "cs1"), false)).toBe(false);
  });
  it("[QHS-03] Quản lý cơ sở chỉ mở GV của CHÍNH cơ sở mình, dù có view-all", () => {
    const ql = { id: "ql", role: "CENTER_MANAGER", centerId: "cs1" };
    expect(luatMoHoSo(ql, gv("u1", "cs1"), true)).toBe(true);
    expect(luatMoHoSo(ql, gv("u2", "cs2"), true)).toBe(false);
  });
  it("[QHS-04] vai khác có view-all ⇒ mở được", () => {
    expect(luatMoHoSo({ id: "hr", role: "HR" }, gv("u2", "cs2"), true)).toBe(true);
  });
  it("[QHS-05] theo lô = từng người (hỏi quyền theo cơ sở của GV)", async () => {
    xemTatCa.clear();
    xemTatCa.set("cs1", true);
    const me = { id: "hr", role: "HR" };
    expect([...(await hoSoMoDuoc(me, [gv("a", "cs1"), gv("b", "cs2"), gv("hr", "cs2")]))].sort()).toEqual(["a", "hr"]);
    expect(await moDuocHoSoGv(me, gv("b", "cs2"))).toBe(false);
    expect(await moDuocHoSoGv(me, gv("a", "cs1"))).toBe(true);
  });
});
