/**
 * Sidebar đọc quyền theo cờ (10/07) — ba thứ phải đúng:
 *
 *  1. PARITY: cờ OFF ⇒ tập action của menu PHẢI trùng khít `can(user, a)` cũ. Đây là
 *     lưới an toàn của chính cuộc refactor: prod đang chạy cờ OFF, không được đổi một ly.
 *  2. Cờ ON ⇒ menu theo v2, tức là theo đúng thứ mà cổng trang sẽ dùng sau flip.
 *  3. RoleSwitcher thu hẹp được menu ở CẢ hai nhánh — kể cả khi mã vai v1 và v2 khác nhau
 *     (chỉ 5/9 mã trùng: HR/SALES_CSM/MARKETING/ACCOUNTANT không có RoleDef cùng tên).
 */
import { describe, it, expect } from "vitest";
import { PERMISSIONS, can, type Action } from "@/lib/auth/permissions";
import { grantedMenuActions } from "@/lib/auth/menu-permissions";
import {
  activeRoleOptions,
  menuActorForRole,
  menuUserForRole,
  resolveActiveRoleFrom,
} from "@/lib/auth/active-role";
import type { Actor } from "@/lib/auth/actor";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { ROLE_SEED } from "../../prisma/seed-roles";
import { readFileSync } from "node:fs";
import { join as joinPath } from "node:path";

const ALL = Object.keys(PERMISSIONS) as Action[];

type Scope = "GLOBAL" | "CENTER" | "CLASS" | "OWN" | "ASSIGNED";

function actorOf(
  perms: { action: string; roleCode: string; scopeType?: Scope }[],
  orgRoles: string[],
  isSuperAdmin = false,
): Actor {
  return {
    userId: "u1",
    isSuperAdmin,
    isHoLevel: false,
    orgRoles: orgRoles.map((roleCode) => ({ orgUnitId: "org-cs2", roleCode })),
    permissions: perms.map((p) => ({
      action: p.action,
      scopeType: p.scopeType ?? "GLOBAL",
      orgUnitId: "org-cs2",
      roleCode: p.roleCode,
      centerScope: ["cs2"],
    })),
    visibleCenterIds: ["cs2"],
    visibleOrgUnitIds: ["org-cs2"],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe("grantedMenuActions — parity với can() khi cờ OFF", () => {
  for (const roles of [["CENTER_MANAGER"], ["TEACHER"], ["MARKETING"], ["SALES_CSM", "TEACHER"], ["ACCOUNTANT"]]) {
    it(`vai [${roles}]: menu mới ≡ menu cũ (can v1)`, () => {
      const user = { role: roles[0], roles };
      const cu = ALL.filter((a) => can(user, a)).sort();
      const moi = grantedMenuActions({ sessionUser: user, actor: null, flagOn: false }).sort();
      expect(moi).toEqual(cu);
    });
  }

  it("actor v2 KHÔNG ảnh hưởng menu khi cờ OFF (v1 vẫn quyết định)", () => {
    const user = { role: "TEACHER", roles: ["TEACHER"] };
    const actorGiau = actorOf([{ action: "payments:manage", roleCode: "TEACHER" }], ["TEACHER"]);
    const g = grantedMenuActions({ sessionUser: user, actor: actorGiau, flagOn: false });
    expect(g).not.toContain("payments:manage");
  });
});

describe("grantedMenuActions — cờ ON thì menu theo v2", () => {
  it("action v2 có ⇒ hiện; action chỉ có ở v1 ⇒ ẩn (đúng thứ cổng trang sẽ làm)", () => {
    // 03/08: CM mất payments:manage ở CẢ v1 lẫn v2 nên không còn minh hoạ được
    // "chỉ có ở v1". Dùng ACCOUNTANT — v1 có payments:manage, actor v2 thì không.
    const user = { role: "ACCOUNTANT", roles: ["ACCOUNTANT"] };
    const actor = actorOf([{ action: "students:view-all", roleCode: "HO_ACCOUNTANT" }], ["HO_ACCOUNTANT"]);

    expect(can(user, "payments:manage" as Action)).toBe(true); // v1 vẫn cho
    const g = grantedMenuActions({ sessionUser: user, actor, flagOn: true });
    expect(g).toContain("students:view-all");
    expect(g).not.toContain("payments:manage"); // ⇐ hết dead-link sau flip
  });
});

describe("menuActorForRole — RoleSwitcher thu hẹp menu ở nhánh v2", () => {
  const actor = actorOf(
    [
      { action: "payments:manage", roleCode: "CENTER_MANAGER" },
      { action: "attendance:mark", roleCode: "TEACHER" },
    ],
    ["CENTER_MANAGER", "TEACHER"],
  );

  it("chọn TEACHER ⇒ chỉ còn quyền của TEACHER", () => {
    const m = menuActorForRole(actor, "TEACHER")!;
    expect(m.permissions.map((p) => p.action)).toEqual(["attendance:mark"]);
    expect(m.orgRoles).toHaveLength(1);
  });

  it("hạ isSuperAdmin theo vai — nếu không, Kiệt chọn 'Giáo viên' vẫn thấy menu quản trị", () => {
    const kiet = actorOf([{ action: "attendance:mark", roleCode: "TEACHER" }], ["SUPER_ADMIN", "TEACHER"], true);
    expect(menuActorForRole(kiet, "TEACHER")!.isSuperAdmin).toBe(false);
    expect(menuActorForRole(kiet, "SUPER_ADMIN")!.isSuperAdmin).toBe(true);
    // SUPER_ADMIN bypass ⇒ chọn vai SUPER_ADMIN thì menu đầy đủ.
    const g = grantedMenuActions({
      sessionUser: menuUserForRole({ role: "SUPER_ADMIN", roles: ["SUPER_ADMIN", "TEACHER"] }, "SUPER_ADMIN"),
      actor: menuActorForRole(kiet, "SUPER_ADMIN"),
      flagOn: true,
    });
    expect(g.length).toBe(ALL.length);
  });

  it("mã vai không thuộc orgRoles (vd vai legacy khi cờ OFF) ⇒ KHÔNG thu hẹp, fail-open", () => {
    expect(menuActorForRole(actor, "MARKETING")).toBe(actor);
    expect(menuActorForRole(actor, null)).toBe(actor);
    expect(menuActorForRole(null, "TEACHER")).toBeNull();
  });

  it("grant riêng (gắn con người, không gắn vai) được giữ nguyên", () => {
    const a = actorOf([{ action: "x:y", roleCode: "TEACHER" }], ["TEACHER"]);
    a.grantsAllow = new Set(["leads:export"]);
    expect(menuActorForRole(a, "TEACHER")!.grantsAllow.has("leads:export")).toBe(true);
  });
});

describe("activeRoleOptions / resolveActiveRoleFrom — chọn đúng bộ mã theo cờ", () => {
  const user = { role: "SALES_CSM", roles: ["SALES_CSM"] };
  const actor = actorOf([], ["CENTER_SALES_CSM", "CENTER_CLASS_MANAGER"]);

  it("cờ OFF ⇒ vai legacy; cờ ON ⇒ RoleDef code", () => {
    expect(activeRoleOptions(user, actor, false)).toEqual(["SALES_CSM"]);
    expect(activeRoleOptions(user, actor, true)).toEqual(["CENTER_CLASS_MANAGER", "CENTER_SALES_CSM"]);
  });

  it("cookie mang vai KHÔNG sở hữu ⇒ null (không tin client)", () => {
    expect(resolveActiveRoleFrom(["CENTER_SALES_CSM"], "SUPER_ADMIN")).toBeNull();
    expect(resolveActiveRoleFrom(["CENTER_SALES_CSM"], "CENTER_SALES_CSM")).toBe("CENTER_SALES_CSM");
    expect(resolveActiveRoleFrom(["CENTER_SALES_CSM"], undefined)).toBeNull();
  });

  it("ca Mỹ: cờ ON mà switcher vẫn chạy mã legacy ⇒ mất menu Giáo vụ (lý do đổi sang mã v2)", () => {
    // Nếu activeRole = "SALES_CSM" (legacy) thì menuActorForRole không khớp orgRole nào
    // ⇒ fail-open, giữ NGUYÊN cả 2 vai — không thu hẹp được, tức switcher vô dụng.
    expect(menuActorForRole(actor, "SALES_CSM")).toBe(actor);
    // Với mã v2 thì thu hẹp đúng.
    expect(menuActorForRole(actor, "CENTER_CLASS_MANAGER")!.orgRoles).toEqual([
      { orgUnitId: "org-cs2", roleCode: "CENTER_CLASS_MANAGER" },
    ]);
  });
});

describe("Menu hỏi 'CÓ GIỮ action không', KHÔNG hỏi 'dùng được ngay không'", () => {
  // Bug tự tạo ở PR #47: grantedMenuActions gọi evaluatePermission TRẦN (không target).
  // can.ts trả false cho scope CENTER/CLASS/OWN khi thiếu target ⇒ sau flip, mọi mục menu
  // gác bằng action scope-cơ-sở sẽ BIẾN MẤT, dù trang vẫn cho vào (trang có truyền target).
  // Đúng lớp lỗi "ẩn oan" mà page-gates.ts sinh ra để diệt.
  //
  // Ca thật: Giáo vụ giữ attendance:view[CENTER]; QL cơ sở + Nhân sự cơ sở giữ
  // hr_attendance:view[CENTER] → mất menu "Điểm danh" / "Chấm công" ngay lúc flip.

  it("[REGRESSION] attendance:view scope CENTER ⇒ menu Điểm danh VẪN hiện", () => {
    const giaoVu = actorOf(
      [{ action: "attendance:view", roleCode: "CENTER_CLASS_MANAGER", scopeType: "CENTER" }],
      ["CENTER_CLASS_MANAGER"],
    );
    const g = grantedMenuActions({ sessionUser: { role: "SALES_CSM", roles: ["SALES_CSM"] }, actor: giaoVu, flagOn: true });
    expect(g).toContain("attendance:view");
  });

  it("[REGRESSION] hr_attendance:view scope CENTER ⇒ QL cơ sở VẪN thấy menu Chấm công", () => {
    const ql = actorOf(
      [{ action: "hr_attendance:view", roleCode: "CENTER_MANAGER", scopeType: "CENTER" }],
      ["CENTER_MANAGER"],
    );
    const g = grantedMenuActions({ sessionUser: { role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"] }, actor: ql, flagOn: true });
    expect(g).toContain("hr_attendance:view");
  });

  it("scope CLASS/ASSIGNED cũng vậy (GV, trợ giảng)", () => {
    const gv = actorOf([{ action: "attendance:mark", roleCode: "TEACHER", scopeType: "CLASS" }], ["TEACHER"]);
    expect(grantedMenuActions({ sessionUser: { role: "TEACHER", roles: ["TEACHER"] }, actor: gv, flagOn: true })).toContain("attendance:mark");
  });

  it("KHÔNG giữ action ⇒ vẫn ẩn (menu không được nới rộng thành 'thấy hết')", () => {
    const ql = actorOf([{ action: "students:view-all", roleCode: "CENTER_MANAGER" }], ["CENTER_MANAGER"]);
    const g = grantedMenuActions({ sessionUser: { role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"] }, actor: ql, flagOn: true });
    expect(g).not.toContain("payments:manage");
    expect(g).not.toContain("attendance:view");
  });

  it("grant riêng ALLOW cũng mở mục menu tương ứng", () => {
    const a = actorOf([], ["TEACHER"]);
    a.grantsAllow = new Set(["leads:export"]);
    expect(grantedMenuActions({ sessionUser: { role: "TEACHER", roles: ["TEACHER"] }, actor: a, flagOn: true })).toContain("leads:export");
  });

  it("[US-03 · VIẾT TRƯỚC — ĐỎ tới khi menu DENY-aware] grant GROUP DENY toàn-action ⇒ action biến khỏi menu", () => {
    // Nợ ghi ở permissions.md AS-BUILT US-02: "helper aggregate (menu-permissions…) chưa
    // biết grant DENY — cập nhật khi grant có dữ liệu thật (US-03)". Đây là test đòi nợ:
    // actor GIỮ attendance:view qua RolePermission, nhưng nhóm của actor bị DENY toàn-action
    // (fieldMask rỗng, dataScope ALL) ⇒ cổng trang sẽ chặn (engine lib/permissions/can) ⇒
    // menu vẫn vẽ lối vào là tái sinh đúng lớp dead-link mà page-gates.ts diệt.
    const giaoVu = actorOf(
      [
        { action: "attendance:view", roleCode: "CENTER_CLASS_MANAGER", scopeType: "CENTER" },
        { action: "students:view-all", roleCode: "CENTER_CLASS_MANAGER", scopeType: "CENTER" },
      ],
      ["CENTER_CLASS_MANAGER"],
    );
    const actor: Actor = {
      ...giaoVu,
      groupIds: ["group-cam-diem-danh"],
      permissionGrants: [
        {
          subjectType: "GROUP",
          subjectId: "group-cam-diem-danh",
          permissionKey: "attendance:view",
          effect: "DENY",
          dataScope: "ALL",
          fieldMask: [],
        },
      ],
    };
    const g = grantedMenuActions({
      sessionUser: { role: "SALES_CSM", roles: ["SALES_CSM"] },
      actor,
      flagOn: true,
    });
    expect(g).not.toContain("attendance:view");
    // DENY chỉ nhắm 1 action — action khác actor đang giữ KHÔNG bị vạ lây.
    expect(g).toContain("students:view-all");
  });

  it("[US-03 · ĐỐI XỨNG] grant GROUP ALLOW dataScope ALL ⇒ action XUẤT HIỆN trong menu (cả 2 nhánh cờ)", () => {
    // Chiều ngược của ca DENY trên: grant ALLOW target-trần mở CỔNG trang
    // (decidePermissionWithGrant cắm TRƯỚC đường cũ, bất kể cờ) ⇒ menu chỉ TRỪ mà
    // không CỘNG là "ẩn oan" — trang mở được nhưng không có lối vào (review 09/08).
    // Actor KHÔNG giữ students:view-all qua RolePermission, v1 TEACHER cũng không có.
    const base = actorOf([], ["TEACHER"]);
    const actor: Actor = {
      ...base,
      groupIds: ["group-mo-xem-hv"],
      permissionGrants: [
        {
          subjectType: "GROUP",
          subjectId: "group-mo-xem-hv",
          permissionKey: "students:view-all",
          effect: "ALLOW",
          dataScope: "ALL",
          fieldMask: [],
        },
      ],
    };
    const user = { role: "TEACHER", roles: ["TEACHER"] };
    expect(can(user, "students:view-all" as Action)).toBe(false); // tiền đề: v1 không cho
    for (const flagOn of [true, false]) {
      const g = grantedMenuActions({ sessionUser: user, actor, flagOn });
      expect(g, `flagOn=${flagOn}`).toContain("students:view-all");
      // ALLOW chỉ nhắm 1 action — không nới menu thành "thấy hết".
      expect(g, `flagOn=${flagOn}`).not.toContain("payments:manage");
    }
  });

  it("action gác trang TRẦN (PAGE_GATES) buộc GLOBAL ⇒ menu ≡ cổng cho nhóm đó", () => {
    // rbac-scope.test.ts đã ép mọi action trong PAGE_GATES phải GLOBAL trên mọi role.
    // Nhờ vậy "có giữ action" và "dùng được ngay" trùng nhau đúng ở những route đó.
    for (const actions of Object.values(PAGE_GATES)) {
      for (const action of actions) {
        for (const role of ROLE_SEED) {
          const p = role.perms.find((x) => x.action === action);
          if (p) expect(p.scopeType, `${role.code}:${action}`).toBe("GLOBAL");
        }
      }
    }
  });
});

/**
 * NHÓM "HỆ THỐNG & CẤU HÌNH" CHỈ SUPER_ADMIN THẤY (chốt chủ dự án 11/08/2026).
 *
 * Vì sao phải khoá bằng test chứ không bằng một dòng comment: cái sai vừa vá KHÔNG phải
 * lỗi logic, mà là chọn nhầm action làm cổng — "Cây tổ chức" gác bằng `centers:view`,
 * action mà 7 RoleDef giữ vì nó là chìa khoá cho bộ lọc cơ sở ở khắp nơi. Chỉ cần một
 * mục mới mượn nhầm một action rộng như thế là cả nhóm hiện ra cho vai khác — mà nhóm
 * rỗng thì tự ẩn, nên không ai nhận ra cho tới khi mở tài khoản vai đó ra xem.
 *
 * Quét TĨNH sidebar.tsx nên mục thêm sau này cũng bị soi.
 */
describe("Sidebar — nhóm Hệ thống & Cấu hình chỉ SUPER_ADMIN", () => {
  const SIDEBAR_SRC = readFileSync(
    joinPath(process.cwd(), "components/admin/sidebar.tsx"),
    "utf8",
  );

  /** Các action làm cổng cho mọi mục trong nhóm (giải cả dạng `...PAGE_GATES["/x"]`). */
  function actionsCuaNhomHeThong(): { label: string; actions: string[] }[] {
    const i = SIDEBAR_SRC.indexOf('label: "Hệ thống & Cấu hình"');
    expect(i, "không tìm thấy nhóm Hệ thống & Cấu hình trong sidebar").toBeGreaterThan(-1);
    const doan = SIDEBAR_SRC.slice(i, SIDEBAR_SRC.indexOf("\n  },", i));
    const out: { label: string; actions: string[] }[] = [];
    for (const m of doan.matchAll(/label:\s*"([^"]+)",\s*href:[^}]*?perm:\s*\[([^\]]*)\]/g)) {
      const raw = m[2];
      const actions: string[] = [];
      for (const g of raw.matchAll(/PAGE_GATES\[\s*"([^"]+)"\s*\]/g)) {
        actions.push(...(PAGE_GATES[g[1] as keyof typeof PAGE_GATES] ?? []));
      }
      for (const q of raw.matchAll(/"([a-z0-9-]+:[a-z-]+)"/g)) actions.push(q[1]);
      out.push({ label: m[1], actions });
    }
    expect(out.length, "không đọc được mục nào — regex sidebar đã lệch").toBeGreaterThan(3);
    return out;
  }

  it("mọi mục đều gác bằng action mà KHÔNG RoleDef nào (v2) giữ", () => {
    const viPham: string[] = [];
    for (const { label, actions } of actionsCuaNhomHeThong()) {
      for (const a of actions) {
        const giu = ROLE_SEED.filter(
          (r) => r.code !== "SUPER_ADMIN" && r.perms.some((p) => p.action === a),
        ).map((r) => r.code);
        if (giu.length > 0) viPham.push(`${label} · ${a} → ${giu.join(", ")}`);
      }
    }
    expect(
      viPham,
      `Mục trong nhóm hệ thống gác bằng action vai khác cũng giữ (vai đó sẽ THẤY nhóm này):\n  - ${viPham.join("\n  - ")}\n`,
    ).toEqual([]);
  });

  it("và cũng chỉ SUPER_ADMIN có ở ma trận v1 (local/dev chạy v1 — đừng để lệch prod)", () => {
    const viPham: string[] = [];
    for (const { label, actions } of actionsCuaNhomHeThong()) {
      for (const a of actions) {
        const giu = (PERMISSIONS[a as Action] as readonly string[] | undefined) ?? [];
        const khac = giu.filter((r) => r !== "SUPER_ADMIN");
        if (khac.length > 0) viPham.push(`${label} · ${a} → ${khac.join(", ")}`);
      }
    }
    expect(viPham, `v1 còn vai khác giữ:\n  - ${viPham.join("\n  - ")}\n`).toEqual([]);
  });
});
