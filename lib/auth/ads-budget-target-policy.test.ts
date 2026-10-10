// D-02 — "Đặt chỉ tiêu ngân sách quảng cáo theo tháng, theo từng cơ sở" là việc của
// MARKETING. Test viết TRƯỚC hiện thực (luật cứng #5).
//
// Quyền dùng key MỚI `ads_budget_targets:manage`, đúng tiền lệ `revenue_targets:manage`
// (B-01) và `lead_targets:manage` (C-01 · chốt 24/08/2026 OQ-C5): ba bảng chỉ tiêu, ba
// key riêng, một khuôn. Hai thứ KHÔNG được mượn, và ca test dưới đây pin lại:
//
//   · `leads:view-all` — key đang gác `/admin/marketing/funnel`. Mượn nó là mở màn ĐẶT
//     chỉ tiêu cho cả Quản lý cơ sở lẫn Sale trưởng, tức trao quyền định mẫu số cho
//     người bị đo bằng chính mẫu số đó.
//   · `canEditAds` (`lib/crm/ads-insights.ts`) — so `roleCode` bằng tay, vi phạm luật
//     Nền Hệ thống #1 ("mọi kiểm tra quyền đi qua `can()`"). D-02 không được lan thêm
//     một call-site nữa cho nó.
//
// AI ĐƯỢC CẤP — và vì sao KHÔNG có `CENTER_MANAGER` (khác C-01):
//   PRD `CDB-dashboard.md` §D.4 chia đôi rành mạch — Marketing **đặt** chỉ tiêu ngân
//   sách; QLCS **xem** chi phí + CPL + CPA của riêng cơ sở mình. Tiền quảng cáo tiêu từ
//   tài khoản ads của Hội sở, QLCS không cầm cái ví đó; cho họ tự khai chỉ tiêu là để
//   D-03 ("% thực tế / chỉ tiêu") tự chấm điểm mình. Đây là hướng FAIL-CLOSED: nới thêm
//   một vai sau này là một dòng seed, còn thu lại một vai đã cấp thì phải đi hỏi từng
//   người xem ai đã đặt số gì.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { ALL_MODULE_DECLS, collectDescriptors } from "@/lib/permissions/registry";
import { ROLE_SEED } from "../../prisma/seed-roles";

const KEY = "ads_budget_targets:manage";
const ROUTE = "/bao-cao/ngan-sach-quang-cao";
const ROOT = process.cwd();
const DIR = "app/(admin)/admin/bao-cao/ngan-sach-quang-cao";
const ACTION_FILE = path.join(ROOT, DIR, "_actions.ts");
const PAGE_FILE = path.join(ROOT, DIR, "page.tsx");

/** Bỏ comment: chú thích nhắc tên quyền khác không được tính là call-site thật. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const permsOf = (code: string) => {
  const role = ROLE_SEED.find((r) => r.code === code);
  if (!role) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  return role.perms;
};
const hasPerm = (code: string, action: string) => permsOf(code).some((p) => p.action === action);

describe("D-02 · quyền đặt chỉ tiêu ngân sách quảng cáo — khai đủ hai tầng", () => {
  it("v1 (đang chạy local/dev/CI): Marketing + Admin", () => {
    expect(PERMISSIONS).toHaveProperty(KEY);
    expect([...PERMISSIONS[KEY]].sort()).toEqual(["MARKETING", "SUPER_ADMIN"].sort());
  });

  it("v2 (đang enforce prod): seed cho SUPER_ADMIN + HO_MARKETING", () => {
    for (const code of ["SUPER_ADMIN", "HO_MARKETING"]) {
      expect(hasPerm(code, KEY), `RoleDef ${code} thiếu ${KEY}`).toBe(true);
    }
  });

  it("seed GLOBAL ở MỌI RoleDef giữ nó — gate trang gọi TRẦN, scope CENTER sẽ FALSE trên prod", () => {
    const viPham = ROLE_SEED.flatMap((r) =>
      r.perms
        .filter((p) => p.action === KEY && p.scopeType !== "GLOBAL")
        .map((p) => `${r.code} = ${p.scopeType}`),
    );
    expect(viPham).toEqual([]);
  });

  it("có descriptor trong registry quyền (module crm — nơi mã ads đang sống)", () => {
    const row = collectDescriptors(ALL_MODULE_DECLS).get(KEY);
    expect(row, `registry thiếu ${KEY}`).toBeDefined();
    expect(row?.module).toBe("crm");
    expect(row?.action).toBe("manage");
  });

  it("🔴 QLCS KHÔNG có quyền này — họ XEM chi phí, không ĐẶT chỉ tiêu (PRD §D.4)", () => {
    expect(PERMISSIONS[KEY]).not.toContain("CENTER_MANAGER");
    expect(hasPerm("CENTER_MANAGER", KEY)).toBe(false);
    // Sale cũng không: mẫu số CPA của họ không phải thứ họ tự khai.
    expect(PERMISSIONS[KEY]).not.toContain("SALES_CSM");
    expect(hasPerm("CENTER_SALES_CSM", KEY)).toBe(false);
  });
});

describe("D-02 · KHÔNG mượn quyền cũ, KHÔNG lan thêm call-site canEditAds", () => {
  it("cổng trang + cổng action KHÔNG nhắc tới leads:view-all", () => {
    const gate = PAGE_GATES[ROUTE] as readonly string[] | undefined;
    expect(gate).not.toContain("leads:view-all");
    expect(stripComments(fs.readFileSync(ACTION_FILE, "utf8"))).not.toContain("leads:view-all");
  });

  it("action KHÔNG gọi canEditAds (so roleCode tay — vi phạm luật Nền Hệ thống #1)", () => {
    expect(stripComments(fs.readFileSync(ACTION_FILE, "utf8"))).not.toContain("canEditAds");
    expect(stripComments(fs.readFileSync(PAGE_FILE, "utf8"))).not.toContain("canEditAds");
  });
});

describe("D-02 · cổng trang + cổng action nói cùng một câu", () => {
  it("PAGE_GATES khai route màn đặt chỉ tiêu, gác đúng key mới", () => {
    const gate = PAGE_GATES[ROUTE] as readonly string[] | undefined;
    expect(gate, `PAGE_GATES thiếu ${ROUTE}`).toBeDefined();
    expect(gate).toContain(KEY);
  });

  it("page.tsx gác bằng bảng PAGE_GATES, không khai action rời", () => {
    const src = stripComments(fs.readFileSync(PAGE_FILE, "utf8"));
    expect(src).toContain(`PAGE_GATES["${ROUTE}"]`);
  });

  it("action kiểm quyền NGAY ĐẦU, bằng đúng key mới", () => {
    const src = stripComments(fs.readFileSync(ACTION_FILE, "utf8"));
    expect(src).toContain(`checkPermission("${KEY}")`);
  });

  it("action gọi hàm thuần kiểm phạm vi cơ sở (không tự chế điều kiện quyền tại chỗ)", () => {
    // `AdsBudgetTarget` ∈ SCOPE_EXEMPT ⇒ scopedDb là pass-through. Quyền chỉ trả lời
    // "được đặt chỉ tiêu", KHÔNG trả lời "cho CƠ SỞ NÀO" — luật đó nằm ở hàm thuần
    // dùng chung với B-01/C-01, có test riêng.
    const src = stripComments(fs.readFileSync(ACTION_FILE, "utf8"));
    expect(src).toContain("checkRevenueTargetScope");
  });

  it("action huỷ cache báo cáo theo TAG sau khi ghi (revalidatePath không đụng unstable_cache)", () => {
    const src = stripComments(fs.readFileSync(ACTION_FILE, "utf8"));
    expect(src).toContain("safeUpdateTag(CACHE_TAGS.report)");
  });
});
