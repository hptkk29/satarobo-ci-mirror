// SIẾT QUYỀN CHỐT KỲ HOA HỒNG (chốt 27/08/2026). Test viết TRƯỚC hiện thực (luật cứng #5).
//
// LỖ ĐANG CÓ TRÊN PROD, đo bằng chính mã trong kho:
//   · `chotKyHoaHongAction` / `approveStatementAction` / `reopenStatementAction` đều
//     gác bằng `payments:manage` (app/(admin)/admin/crm/commission/actions.ts).
//   · `prisma/seed-roles.ts` cấp `payments:manage` scope GLOBAL cho CẢ `HO_ACCOUNTANT`
//     LẪN `CENTER_ACCOUNTANT`.
//   · `CommissionStatement.period` là `@unique` toàn hệ thống — bảng kê KHÔNG có
//     `centerId`, nên không có gì cắt phạm vi ở đường GHI.
// ⇒ Kế toán MỘT cơ sở bấm chốt/duyệt được kỳ hoa hồng của CẢ CÔNG TY. Cách ly cơ sở
//   hiện chỉ tồn tại ở đường ĐỌC (lọc `CommissionLine.recipientId → User.centerId`).
//
// CÁCH SIẾT: tách key RIÊNG `commission_periods:manage` cho ba việc chốt/duyệt/mở lại,
// cấp cho Super Admin + kế toán cấp HỘI SỞ. Tiền lệ đã có trong kho: `revenue_targets:
// manage` (B-01) và `ads_budget_targets:manage` (D-02) đều tách ra khỏi `payments:
// manage` đúng vì lý do này.
//
// VÌ SAO KHÔNG PHẢI HAI CÁCH KHÁC:
//   · Gỡ `payments:manage` của `CENTER_ACCOUNTANT` — sai, key đó còn gánh thu/chi
//     hằng ngày của cơ sở; gỡ là kế toán cơ sở mất việc chính.
//   · Đổi seed `payments:manage` sang scope CENTER — sai, mọi call-site đang gọi TRẦN
//     (không truyền target) nên `can()` v2 sẽ trả FALSE và kế toán mất sạch quyền tiền.
//     `lib/auth/rbac-scope.test.ts` cũng bắt đúng lỗi này.
//
// KHÔNG đụng quyền XEM: kế toán cơ sở vẫn vào màn hoa hồng, vẫn thấy dòng của người
// thuộc cơ sở mình, vẫn xuất Excel. Siết ở BA NÚT ghi, không ở cánh cửa.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PERMISSIONS, ALL_ACTIONS } from "@/lib/auth/permissions";
import { ALL_MODULE_DECLS, collectDescriptors } from "@/lib/permissions/registry";
import { ROLE_SEED } from "../../prisma/seed-roles";

const KEY = "commission_periods:manage";
const CU = "payments:manage";
const ROOT = process.cwd();
const DIR = "app/(admin)/admin/crm/commission";
const ACTION_FILE = path.join(ROOT, DIR, "actions.ts");
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

describe("chốt kỳ hoa hồng · khai đủ BỐN chỗ kho yêu cầu khi thêm quyền", () => {
  it("(1) ma trận v1 — Admin + Kế toán (ACCOUNTANT legacy ánh xạ sang HO_ACCOUNTANT)", () => {
    expect(ALL_ACTIONS).toContain(KEY);
    expect([...PERMISSIONS[KEY]].sort()).toEqual(["ACCOUNTANT", "SUPER_ADMIN"].sort());
  });

  it("(2) sổ đăng ký quyền — có descriptor, thuộc module finance", () => {
    const row = collectDescriptors(ALL_MODULE_DECLS).get(KEY);
    expect(row, `registry quyền thiếu ${KEY}`).toBeDefined();
    expect(row?.module).toBe("finance");
    expect(row?.action).toBe("manage");
  });

  it("(3) seed vai — CHỈ Super Admin + kế toán Hội sở", () => {
    for (const code of ["SUPER_ADMIN", "HO_ACCOUNTANT"]) {
      expect(hasPerm(code, KEY), `RoleDef ${code} thiếu ${KEY}`).toBe(true);
    }
  });

  it("(4) seed GLOBAL ở mọi vai giữ nó — ba action gọi TRẦN, scope CENTER sẽ FALSE", () => {
    // `can()` v2 trả false khi một quyền scope CENTER được hỏi mà không có target.
    // Ba Server Action chốt/duyệt/mở lại đều gọi trần, nên seed sai scope = kế toán
    // Hội sở mất luôn việc. `lib/auth/rbac-scope.test.ts` cũng canh chuyện này.
    const viPham = ROLE_SEED.flatMap((r) =>
      r.perms.filter((p) => p.action === KEY && p.scopeType !== "GLOBAL").map((p) => `${r.code}=${p.scopeType}`),
    );
    expect(viPham).toEqual([]);
  });
});

describe("chốt kỳ hoa hồng · ĐÚNG chỗ bị siết", () => {
  it("🔴 kế toán CƠ SỞ KHÔNG được chốt kỳ — đây là toàn bộ lý do có ticket này", () => {
    expect(hasPerm("CENTER_ACCOUNTANT", KEY)).toBe(false);
  });

  it("nhưng kế toán cơ sở GIỮ NGUYÊN quyền tiền hằng ngày — không siết nhầm", () => {
    expect(hasPerm("CENTER_ACCOUNTANT", CU)).toBe(true);
    expect(hasPerm("CENTER_ACCOUNTANT", "payments:record")).toBe(true);
    expect(hasPerm("CENTER_ACCOUNTANT", "payments:confirm")).toBe(true);
  });

  it("quản lý cơ sở / Sale không có, và cũng chưa từng có", () => {
    expect(PERMISSIONS[KEY]).not.toContain("CENTER_MANAGER");
    expect(PERMISSIONS[KEY]).not.toContain("SALES_CSM");
    expect(hasPerm("CENTER_MANAGER", KEY)).toBe(false);
  });

  it("kế toán Hội sở vẫn chốt được — siết không được biến thành cấm cả nhà", () => {
    expect(hasPerm("HO_ACCOUNTANT", KEY)).toBe(true);
    expect(PERMISSIONS[KEY]).toContain("ACCOUNTANT");
  });
});

describe("chốt kỳ hoa hồng · ba nút GHI đổi cổng, cửa VÀO giữ nguyên", () => {
  const src = stripComments(fs.readFileSync(ACTION_FILE, "utf8"));

  it("cả ba action chốt/duyệt/mở lại gác bằng key MỚI", () => {
    // Đếm 3 lần xuất hiện = 3 action, không sót cái nào.
    const soLan = src.split(`checkPermission("${KEY}")`).length - 1;
    expect(soLan).toBe(3);
  });

  it("KHÔNG còn action nào của file này gác bằng payments:manage", () => {
    expect(src).not.toContain(`checkPermission("${CU}")`);
  });

  it("màn hoa hồng vẫn mở cho payments:manage — kế toán cơ sở còn XEM được", () => {
    const page = stripComments(fs.readFileSync(PAGE_FILE, "utf8"));
    expect(page).toContain(`checkPermission("${CU}")`);
  });

  it("nút chốt/duyệt/mở lại chỉ hiện cho người có quyền, không để bấm rồi báo lỗi", () => {
    const page = stripComments(fs.readFileSync(PAGE_FILE, "utf8"));
    expect(page).toContain(`checkPermission("${KEY}")`);
    // Trước 27/08 hai component này render vô điều kiện: ai vào được màn cũng thấy
    // nút "Mở lại", bấm xong mới ăn toast "Chỉ SUPER_ADMIN…". Nút không bấm được thì
    // đừng vẽ ra.
    expect(page).toMatch(/ChotKyForm[\s\S]{0,120}canChotKy/);
    expect(page).toMatch(/StatementActions[\s\S]{0,200}canChotKy/);
  });

  it("KHÔNG tự chế điều kiện quyền tại chỗ (so role/centerId bằng tay)", () => {
    // Luật cứng #1 Nền Hệ thống. `actorFromSession` vẫn dùng `hasRole` để dựng cờ
    // `isSuperAdmin` cho tầng lib — đó là dựng ACTOR, không phải kiểm quyền.
    expect(src).not.toMatch(/session\.user\.role\s*===/);
    expect(src).not.toMatch(/centerId\s*===/);
  });
});
