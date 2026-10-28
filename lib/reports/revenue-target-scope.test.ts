// B-01 — QLCS chỉ đặt được mục tiêu doanh thu cho CƠ SỞ MÌNH QUẢN.
//
// Viết TRƯỚC hiện thực (luật cứng #5). Vì sao tách hàm thuần ra khỏi Server Action:
// đây là kiểm tra chống leo phạm vi, mà `_actions.ts` kéo theo `auth()` + Prisma nên
// không chạy được trong Vitest — để nguyên trong action thì luật này KHÔNG có test nào
// canh, đúng loại hở im lặng mà B-01 sinh ra để bịt.
//
// Ca gốc (quyết định 24/08 — câu A-01): một QLCS giữ N cơ sở, KHÔNG bắt buộc cùng vùng.
import { describe, it, expect } from "vitest";
import {
  checkRevenueTargetScope,
  ERR_CENTER_OUT_OF_SCOPE,
  ERR_GLOBAL_TARGET_HO_ONLY,
} from "@/lib/reports/revenue-target-scope";

const qlcs = (centerIds: string[]) => ({
  isSuperAdmin: false,
  isHoLevel: false,
  visibleCenterIds: centerIds,
});
const hoiSo = { isSuperAdmin: false, isHoLevel: true, visibleCenterIds: ["cs1", "cs2"] };
const superAdmin = { isSuperAdmin: true, isHoLevel: true, visibleCenterIds: [] };

describe("B-01 · phạm vi đặt mục tiêu doanh thu", () => {
  it("QLCS đặt cho cơ sở mình quản → CHO", () => {
    expect(checkRevenueTargetScope(qlcs(["cs1"]), "cs1")).toEqual({ ok: true });
  });

  it("QLCS đặt cho cơ sở KHÁC → CHẶN (leo phạm vi qua ô <select> sửa tay)", () => {
    expect(checkRevenueTargetScope(qlcs(["cs1"]), "cs2")).toEqual({
      ok: false,
      error: ERR_CENTER_OUT_OF_SCOPE,
    });
  });

  it("QLCS đặt mục tiêu TOÀN HỆ THỐNG (centerId null) → CHẶN", () => {
    expect(checkRevenueTargetScope(qlcs(["cs1"]), null)).toEqual({
      ok: false,
      error: ERR_GLOBAL_TARGET_HO_ONLY,
    });
  });

  it("QLCS giữ 2 cơ sở KHÁC VÙNG: cả hai đều CHO, cơ sở thứ ba vẫn CHẶN", () => {
    const actor = qlcs(["cs1", "cs3"]);
    expect(checkRevenueTargetScope(actor, "cs1").ok).toBe(true);
    expect(checkRevenueTargetScope(actor, "cs3").ok).toBe(true);
    expect(checkRevenueTargetScope(actor, "cs2").ok).toBe(false);
  });

  it("QLCS chưa được gán cơ sở nào → CHẶN mọi thứ (fail-closed, không rơi về 'cho hết')", () => {
    expect(checkRevenueTargetScope(qlcs([]), "cs1").ok).toBe(false);
    expect(checkRevenueTargetScope(qlcs([]), null).ok).toBe(false);
  });

  it("Cấp hội sở: đặt được cả mục tiêu toàn hệ thống lẫn của từng cơ sở", () => {
    expect(checkRevenueTargetScope(hoiSo, null)).toEqual({ ok: true });
    expect(checkRevenueTargetScope(hoiSo, "cs2")).toEqual({ ok: true });
  });

  it("SUPER_ADMIN: không bị chặn dù visibleCenterIds rỗng", () => {
    expect(checkRevenueTargetScope(superAdmin, null)).toEqual({ ok: true });
    expect(checkRevenueTargetScope(superAdmin, "cs9")).toEqual({ ok: true });
  });
});
