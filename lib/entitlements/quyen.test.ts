import { describe, expect, it } from "vitest";
import { ALL_ACTIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { can } from "@/lib/auth/can";
import type { Actor, PermEntry } from "@/lib/auth/actor";
import { ROLE_SEED } from "../../prisma/seed-roles";

const KEYS = ["view", "view-money", "manage", "approve-exception"].map((v) => `entitlements:${v}`);

// MA TRẬN GÕ TAY, KHÔNG SUY TỪ `ROLE_SEED` (suy từ seed thì test chỉ kiểm seed bằng chính nó). Đổi ai-được-gì thì sửa Ở ĐÂY và ở
// `docs/thu-hoc-phi-pham-vi/BAT-CO-THU-TEST.md` §Tài khoản cùng lúc. Nguồn: quyết định 6 của chủ dự án (13/10/2026).
const MA_TRAN_V2: Record<string, readonly string[]> = {
  "entitlements:view": ["SUPER_ADMIN", "GIAM_DOC", "HO_ACCOUNTANT", "CENTER_ACCOUNTANT", "CENTER_MANAGER", "CENTER_SALES_CSM"],
  // `view-money` CHƯA được quyết cho vai nào: không RoleDef nào giữ (Admin đi bằng bypass của can()) — kế toán thấy hàng đợi nhưng số tiền bị che.
  "entitlements:view-money": [],
  "entitlements:manage": ["SUPER_ADMIN", "GIAM_DOC", "CENTER_MANAGER"],
  "entitlements:approve-exception": ["SUPER_ADMIN", "GIAM_DOC"],
};
const MA_TRAN_V1: Record<string, readonly string[]> = {
  "entitlements:view": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT", "SALES_CSM"],
  "entitlements:view-money": ["SUPER_ADMIN"],
  "entitlements:manage": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "entitlements:approve-exception": ["SUPER_ADMIN"],
};

const vaiCoKhoa = (k: string): string[] => ROLE_SEED.filter((r) => r.perms.some((p) => p.action === k)).map((r) => r.code);

/** Actor dựng từ ĐÚNG dòng seed của vai, neo ở cơ sở `cs1` (cấp cơ sở) hoặc HO (`ALL`). */
function actorTuVai(code: string, neo: "cs1" | "HO"): Actor {
  const seed = ROLE_SEED.find((r) => r.code === code);
  if (!seed) throw new Error(`Thiếu vai ${code}`);
  const permissions: PermEntry[] = seed.perms.map((p) => ({
    action: p.action,
    scopeType: p.scopeType,
    orgUnitId: neo === "HO" ? "ou-ho" : "ou-cs1",
    roleCode: code,
    centerScope: neo === "HO" ? "ALL" : ["cs1"],
    orgUnitScope: neo === "HO" ? "ALL" : ["ou-cs1"],
  }));
  return {
    userId: `u-${code}`,
    isSuperAdmin: code === "SUPER_ADMIN",
    isHoLevel: neo === "HO",
    orgRoles: [{ orgUnitId: neo === "HO" ? "ou-ho" : "ou-cs1", roleCode: code }],
    permissions,
    visibleCenterIds: neo === "HO" ? ["cs1", "cs2"] : ["cs1"],
    visibleOrgUnitIds: neo === "HO" ? ["ou-ho", "ou-cs1", "ou-cs2"] : ["ou-cs1"],
    grantsAllow: new Set(),
    assignedClassIds: new Set(),
  };
}

const T1 = { centerId: "cs1", orgUnitId: "ou-cs1" };
const T2 = { centerId: "cs2", orgUnitId: "ou-cs2" };

describe("[ENP] quyền học (entitlements:*) — chia vai theo quyết định 6 (13/10/2026)", () => {
  it("[ENP-01] đủ 4 khoá ở v1 (ALL_ACTIONS) và bảng quyền", () => {
    for (const k of KEYS) {
      expect(ALL_ACTIONS as string[], k).toContain(k);
      expect(Object.prototype.hasOwnProperty.call(PERMISSIONS, k), k).toBe(true);
    }
  });

  it("[ENP-02] v1 = đúng ma trận gõ tay (view-money vẫn chỉ Admin; GIAM_DOC không có vai v1)", () => {
    for (const k of KEYS) expect([...((PERMISSIONS as Record<string, string[]>)[k] ?? [])].sort(), k).toEqual([...MA_TRAN_V1[k]!].filter((r) => r !== "GIAM_DOC").sort());
  });

  it("[ENP-03] v2: seed = đúng ma trận gõ tay — vai ngoài danh sách KHÔNG có khoá nào (fail-closed vẫn nguyên với mọi vai khác)", () => {
    for (const k of KEYS) expect(vaiCoKhoa(k).sort(), k).toEqual([...MA_TRAN_V2[k]!].sort());
  });

  it("[ENP-04] đối chứng dương: các khoá của bảo lưu (đã cấp cho nhiều vai) vẫn được seed — lưới ENP-03 không rỗng vì seed hỏng", () => {
    const coBaoLuu = ROLE_SEED.some((r) => r.perms.some((p) => (p.action as string).startsWith("bao-luu:")));
    expect(coBaoLuu).toBe(true);
  });

  it("[ENP-05] phạm vi: `view` luôn GLOBAL (cổng trang gọi trần); `manage` của QLCS là CENTER, của Giám đốc/Admin GLOBAL; không vai nào dùng OWN/CLASS", () => {
    for (const r of ROLE_SEED) {
      for (const p of r.perms) {
        if (!p.action.startsWith("entitlements:")) continue;
        if (p.action === "entitlements:view") expect(p.scopeType, `${r.code} view`).toBe("GLOBAL");
        if (p.action === "entitlements:manage") expect(p.scopeType, `${r.code} manage`).toBe(r.code === "CENTER_MANAGER" ? "CENTER" : "GLOBAL");
        expect(["GLOBAL", "CENTER"], `${r.code} ${p.action}`).toContain(p.scopeType);
      }
    }
  });

  it("[ENP-06] hành vi can() v2 theo vai: ai XEM, ai XỬ LÝ, ai DUYỆT VƯỢT TRẦN", () => {
    const co = (code: string, neo: "cs1" | "HO", k: string, t?: typeof T1) => can(actorTuVai(code, neo), k, t);
    // QLCS cơ sở 1: xem + xử lý cơ sở mình; KHÔNG duyệt vượt trần; KHÔNG xem tiền
    expect(co("CENTER_MANAGER", "cs1", "entitlements:view")).toBe(true);
    expect(co("CENTER_MANAGER", "cs1", "entitlements:manage", T1)).toBe(true);
    expect(co("CENTER_MANAGER", "cs1", "entitlements:approve-exception", T1)).toBe(false);
    expect(co("CENTER_MANAGER", "cs1", "entitlements:view-money", T1)).toBe(false);
    // …và KHÔNG xử lý được dòng của cơ sở khác, KHÔNG xử lý được khi không khai cơ sở (fail-closed)
    expect(co("CENTER_MANAGER", "cs1", "entitlements:manage", T2)).toBe(false);
    expect(co("CENTER_MANAGER", "cs1", "entitlements:manage")).toBe(false);
    // CSKH + Kế toán: CHỈ XEM
    for (const code of ["CENTER_SALES_CSM", "CENTER_ACCOUNTANT"] as const) {
      expect(co(code, "cs1", "entitlements:view"), code).toBe(true);
      expect(co(code, "cs1", "entitlements:manage", T1), code).toBe(false);
      expect(co(code, "cs1", "entitlements:approve-exception", T1), code).toBe(false);
      expect(co(code, "cs1", "entitlements:view-money", T1), code).toBe(false);
    }
    expect(co("HO_ACCOUNTANT", "HO", "entitlements:view")).toBe(true);
    expect(co("HO_ACCOUNTANT", "HO", "entitlements:manage", T1)).toBe(false);
    // Giám đốc: xem + xử lý + duyệt vượt trần
    expect(co("GIAM_DOC", "HO", "entitlements:view")).toBe(true);
    expect(co("GIAM_DOC", "HO", "entitlements:manage", T2)).toBe(true);
    expect(co("GIAM_DOC", "HO", "entitlements:approve-exception", T2)).toBe(true);
    expect(co("GIAM_DOC", "HO", "entitlements:view-money", T2)).toBe(false);
    // Vai KHÁC (đối chứng âm): Marketing, Giáo viên, Kế toán… không có gì
    for (const code of ["HO_MARKETING", "TEACHER", "TRAINING", "HO_SALE", "CENTER_HR"] as const) {
      expect(co(code, "cs1", "entitlements:view"), code).toBe(false);
      expect(co(code, "cs1", "entitlements:manage", T1), code).toBe(false);
    }
  });
});
