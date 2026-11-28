// C-01 — "Đặt chỉ tiêu lead theo tháng, theo từng cơ sở" là việc của QUẢN LÝ CƠ SỞ.
//
// Quyền dùng key MỚI `lead_targets:manage` — chốt kỹ thuật 24/08/2026 (OQ-C5), và
// quyết định đó bác bỏ đích danh phương án "dùng lại `leads:assign-config`" với hai lý do
// đã kiểm trong mã:
//   1. "Dùng lại thì khỏi seed prod" là SAI: `leads:assign-config` chưa seed cho RoleDef
//      nào ở v2 và v1 chỉ SUPER_ADMIN ⇒ đằng nào cũng phải chạy `seed-prod-roles.yml`.
//   2. Dùng lại thì CẤP NHẦM: key đó đang gác `/admin/leads/cau-hinh-chia` — cấp cho QLCS
//      để đặt chỉ tiêu là mở luôn màn cấu hình chia lead tự động, một năng lực khác hẳn.
//
// Viết TRƯỚC hiện thực (luật cứng #5).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { ALL_MODULE_DECLS, collectDescriptors } from "@/lib/permissions/registry";
import { ROLE_SEED } from "../../prisma/seed-roles";

const KEY = "lead_targets:manage";
const ROUTE = "/bao-cao/muc-tieu-lead";
const ROOT = process.cwd();
const ACTION_FILE = path.join(ROOT, "app/(admin)/admin/bao-cao/muc-tieu-lead/_actions.ts");
const PAGE_FILE = path.join(ROOT, "app/(admin)/admin/bao-cao/muc-tieu-lead/page.tsx");

/** Bỏ comment: chú thích nhắc tên quyền khác không được tính là call-site thật. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const permsOf = (code: string) => {
  const role = ROLE_SEED.find((r) => r.code === code);
  if (!role) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  return role.perms;
};
const hasPerm = (code: string, action: string) => permsOf(code).some((p) => p.action === action);

describe("C-01 · quyền đặt chỉ tiêu lead — khai đủ hai tầng", () => {
  it("v1 (đang chạy local/dev/CI): QLCS + Admin", () => {
    expect(PERMISSIONS).toHaveProperty(KEY);
    expect([...PERMISSIONS[KEY]].sort()).toEqual(["CENTER_MANAGER", "SUPER_ADMIN"].sort());
  });

  it("v2 (đang enforce prod): seed cho SUPER_ADMIN + CENTER_MANAGER", () => {
    for (const code of ["SUPER_ADMIN", "CENTER_MANAGER"]) {
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

  it("có descriptor trong registry quyền (module crm)", () => {
    const row = collectDescriptors(ALL_MODULE_DECLS).get(KEY);
    expect(row, `registry thiếu ${KEY}`).toBeDefined();
    expect(row?.module).toBe("crm");
    expect(row?.action).toBe("manage");
  });
});

describe("C-01 · KHÔNG dùng lại leads:assign-config (quyết định OQ-C5)", () => {
  it("QLCS vẫn KHÔNG có leads:assign-config ở v1 — màn cấu hình chia lead không bị mở kèm", () => {
    expect(PERMISSIONS["leads:assign-config"]).not.toContain("CENTER_MANAGER");
  });

  it("QLCS vẫn KHÔNG có leads:assign-config ở v2", () => {
    expect(hasPerm("CENTER_MANAGER", "leads:assign-config")).toBe(false);
  });

  it("cổng trang + cổng action KHÔNG nhắc tới leads:assign-config", () => {
    const gate = PAGE_GATES[ROUTE] as readonly string[] | undefined;
    expect(gate).not.toContain("leads:assign-config");
    expect(stripComments(fs.readFileSync(ACTION_FILE, "utf8"))).not.toContain(
      "leads:assign-config",
    );
  });
});

describe("C-01 · cổng trang + cổng action nói cùng một câu", () => {
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
    // `LeadTarget` ∈ SCOPE_EXEMPT ⇒ scopedDb là pass-through. Quyền chỉ trả lời "được
    // đặt chỉ tiêu", KHÔNG trả lời "cho CƠ SỞ NÀO" — luật đó nằm ở hàm thuần có test.
    const src = stripComments(fs.readFileSync(ACTION_FILE, "utf8"));
    expect(src).toContain("checkRevenueTargetScope");
  });

  it("action huỷ cache báo cáo theo TAG sau khi ghi (revalidatePath không đụng unstable_cache)", () => {
    const src = stripComments(fs.readFileSync(ACTION_FILE, "utf8"));
    expect(src).toContain("safeUpdateTag(CACHE_TAGS.report)");
  });
});
