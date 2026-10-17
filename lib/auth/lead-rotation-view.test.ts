/**
 * S-5 — sổ lượt chia lead: TỔ SALE phải mở được màn kiểm chứng của chính mình.
 *
 * Sổ lượt (`/leads/so-luot`) dựng ra để dập tin đồn thiên vị khi chia lead
 * (plan/15 §5: "màn hình cho **cả tổ sale** nhìn thấy ai nhận bao nhiêu lead").
 * Nhưng nó gác bằng `leads:view-all` — quyền mà v1 chỉ cấp cho SUPER_ADMIN /
 * CENTER_MANAGER / MARKETING, còn Sale giữ `leads:view-own`. Hệ quả: người duy
 * nhất KHÔNG xem được bằng chứng là người mà bằng chứng viết cho. Bằng chứng chỉ
 * thuyết phục được người đọc được nó.
 *
 * Cách vá: thêm key ĐỌC riêng `leads:rotation-view` và để nó ĐỨNG CẠNH
 * `leads:view-all` trong gate (phép HOẶC), KHÔNG thay thế. Vì sao không thay:
 * RBAC v2 đang enforce trên prod đọc quyền TỪ DB, mà DB chỉ đổi sau khi chạy
 * `seed-prod-roles.yml`. Thay hẳn = giữa lúc merge và lúc seed, Quản lý cơ sở và
 * Marketing mất luôn màn đang dùng — trắng màn, không kèm lỗi, không tái hiện
 * được ở local (local chạy v1 tĩnh).
 *
 * Ba điều test này giữ:
 *   1. Sale VÀO ĐƯỢC — ở CẢ hai tầng (v1 chạy local/dev, v2 enforce prod).
 *   2. Mở cửa cho Sale KHÔNG kéo theo `leads:view-all` (quyền đó gác ~8 màn khác).
 *   3. Màn vẫn CHỈ ĐỌC — sổ mà sửa được thì nó hết là bằng chứng.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Role } from "@prisma/client";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { PERMISSIONS, can as canV1, type Action } from "@/lib/auth/permissions";
import { crmModule } from "@/lib/permissions/registry/crm";
import { ROLE_SEED } from "../../prisma/seed-roles";

// 16/09/2026 — màn "Sổ lượt chia lead" (`/leads/so-luot`) đã nhập vào
// `/quan-ly-chia-lead` (chốt 30/08); đường cũ chỉ còn một dòng `redirect`. Quyền S-5
// theo sang màn mới, nên cổng đo ở đây cũng đổi theo.
const GATE = PAGE_GATES["/quan-ly-chia-lead"] as readonly string[];
const KEY = "leads:rotation-view";

/** v1: vào được ⟺ có ≥1 action trong gate (đúng ngữ nghĩa `checkAnyPermission`). */
const vaoDuocV1 = (role: Role) => GATE.some((a) => canV1(role, a as Action));

/** v2 gọi TRẦN: chỉ perm GLOBAL mới ăn (SUPER_ADMIN bypass, xử lý riêng). */
const vaoDuocV2 = (code: string) => {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  if (code === "SUPER_ADMIN") return true;
  return r.perms.some((p) => GATE.includes(p.action) && p.scopeType === "GLOBAL");
};

describe("[S-5] /leads/so-luot — tổ Sale mở được sổ lượt", () => {
  it("Sale VÀO ĐƯỢC — cả v1 lẫn v2 (đây là lỗi mà ticket này vá)", () => {
    expect(vaoDuocV1("SALES_CSM"), "v1: SALES_CSM phải mở được sổ lượt").toBe(true);
    expect(vaoDuocV2("CENTER_SALES_CSM"), "v2: CENTER_SALES_CSM phải mở được sổ lượt").toBe(
      true,
    );
  });

  it("Quản lý cơ sở / Marketing / quản trị VẪN vào được — không khoá nhầm cửa cũ", () => {
    for (const role of ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"] as Role[]) {
      expect(vaoDuocV1(role), `v1: ${role} phải giữ được đường vào`).toBe(true);
    }
    for (const code of ["SUPER_ADMIN", "CENTER_MANAGER", "HO_MARKETING"]) {
      expect(vaoDuocV2(code), `v2: ${code} phải giữ được đường vào`).toBe(true);
    }
  });

  it("gate GIỮ một key ĐÃ SEED bên cạnh key mới — không có khe trắng màn trước khi seed prod", () => {
    // Bỏ key cũ khỏi gate là đặt cược rằng seed-prod chạy CÙNG LÚC với deploy. Nó không
    // chạy cùng lúc: workflow `seed-prod-roles.yml` bấm tay sau khi merge vào main.
    //
    // 16/09/2026 — key "đã seed" ở màn này nay là `lead_pool:manage` (đang chạy trên
    // prod từ 29/08), không còn là `leads:view-all`: màn đổi từ `/leads/so-luot` sang
    // `/quan-ly-chia-lead`, và cho `leads:view-all` vào cổng một màn ĐIỀU HÀNH là nới
    // rộng hơn mức cần — ai xem được mọi lead sẽ mở được cả màn chia lead.
    expect(GATE).toContain("lead_pool:manage");
    expect(GATE).toContain(KEY);
  });

  it("vai ngoài tổ Sale/quản lý KHÔNG vào được (không nới kèm)", () => {
    for (const role of ["TEACHER", "HR", "ACCOUNTANT", "TRAINING", "PARENT"] as Role[]) {
      expect(vaoDuocV1(role), `v1: ${role} không được vào sổ lượt`).toBe(false);
    }
    for (const code of [
      "TEACHER",
      "CENTER_HR",
      "CENTER_ACCOUNTANT",
      "TRAINING",
      "PARENT",
      // Sale Hội sở CỐ Ý ngoài cửa: họ chỉ thấy phiếu mình nhập (`leads:view-all`
      // đã gỡ khỏi vai này có chủ đích), và phiếu tự nhập KHÔNG tiêu lượt nên họ
      // không đứng trong vòng luân phiên của bất kỳ cơ sở nào.
      "HO_SALE",
    ]) {
      expect(vaoDuocV2(code), `v2: ${code} không được vào sổ lượt`).toBe(false);
    }
  });

  it("mở sổ lượt KHÔNG kéo theo `leads:view-all` cho Sale", () => {
    // `leads:view-all` là chìa khoá của ~8 màn khác (phễu marketing, chốt hàng
    // loạt, nguồn giới thiệu…). Vá màn này bằng cách nới nó là mở nhầm cả chùm.
    expect(canV1("SALES_CSM", "leads:view-all")).toBe(false);
    const sale = ROLE_SEED.find((r) => r.code === "CENTER_SALES_CSM")!;
    expect(sale.perms.map((p) => p.action)).not.toContain("leads:view-all");
  });
});

describe("[S-5] `leads:rotation-view` — khai đủ BA CHỖ và chỉ để ĐỌC", () => {
  it("có trong ma trận v1 (lib/auth/permissions.ts)", () => {
    expect(PERMISSIONS).toHaveProperty(KEY);
  });

  it("có trong seed RBAC v2 (prisma/seed-roles.ts) và GLOBAL ở MỌI vai giữ nó", () => {
    const giu = ROLE_SEED.filter((r) => r.perms.some((p) => p.action === KEY));
    expect(giu.map((r) => r.code).sort()).toEqual(
      ["CENTER_MANAGER", "CENTER_SALES_CSM", "HO_MARKETING", "SUPER_ADMIN"].sort(),
    );
    // Gate cấp trang gọi `checkAnyPermission` KHÔNG target ⇒ scope CENTER/OWN trả
    // FALSE trên prod trong khi máy dev (v1 tĩnh) vẫn xanh. Cách ly cơ sở do
    // `rotationBoardScope` + scopedDb lo, không do scopeType.
    for (const r of giu) {
      for (const p of r.perms.filter((x) => x.action === KEY)) {
        expect(p.scopeType, `${r.code} · ${KEY} phải GLOBAL`).toBe("GLOBAL");
      }
    }
  });

  it("có descriptor trong registry (lib/permissions/registry/crm.ts)", () => {
    expect(crmModule.permissions.map((p) => p.key)).toContain(KEY);
  });

  it("màn sổ lượt KHÔNG có đường GHI — không Server Action nào trong thư mục", () => {
    // Sale chỉ được XEM. Sổ mà sửa được từ chính màn kiểm chứng thì nó thôi làm
    // bằng chứng. Quét thư mục nên bắt được cả file ai đó thêm sau này.
    const dir = path.join(process.cwd(), "app/(admin)/admin/leads/so-luot");
    const files = fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => path.join(d.parentPath ?? dir, d.name));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, `${f} khai "use server" — sổ lượt phải chỉ đọc`).not.toMatch(
        /["']use server["']/,
      );
    }
  });
});
