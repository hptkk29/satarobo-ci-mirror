// B-01 — "Đặt mục tiêu doanh thu theo tháng, theo từng cơ sở" là việc của QUẢN LÝ CƠ SỞ.
//
// Hiện trạng đo được trước B-01: model `RevenueTarget` + action + form đều có thật,
// nhưng cả trang lẫn action gác bằng `payments:manage` — quyền THAO TÁC TIỀN (mở/huỷ/
// hoàn, cấu hình phương thức thanh toán, hoa hồng) mà QLCS cố ý KHÔNG có (gỡ ở #09,
// chủ dự án chỉ trả lại `orders:manage`/`installments:approve` ngày 03/08). ⇒ đúng
// người mà spec viết cho lại là người không mở được màn hình.
//
// Cách vá bị RÀNG BUỘC hai chiều:
//   · KHÔNG nới `payments:manage` cho QLCS — nới là mở luôn hoàn tiền + hoa hồng
//     toàn hệ, tức đảo một quyết định đã ký để lấy một ô nhập số.
//   · KHÔNG mượn `payments:view` (QLCS đã có) — nó là quyền ĐỌC đối soát; mượn nó để
//     GHI mục tiêu thì mọi vai chỉ-đọc tương lai tự nhiên ghi được.
// ⇒ key RIÊNG `revenue_targets:manage`, đúng tiền lệ `lead_targets:manage` (quyết định
//   24/08/2026, câu OQ-C5).
//
// Viết TRƯỚC hiện thực (luật cứng #5).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { ALL_MODULE_DECLS, collectDescriptors } from "@/lib/permissions/registry";
import { ROLE_SEED } from "../../prisma/seed-roles";

const KEY = "revenue_targets:manage";
const ROOT = process.cwd();
const ACTION_FILE = path.join(ROOT, "app/(admin)/admin/bao-cao/doanh-thu/_actions.ts");
const PAGE_FILE = path.join(ROOT, "app/(admin)/admin/bao-cao/doanh-thu/page.tsx");

/** Bỏ comment: chú thích nhắc tên quyền cũ không được tính là call-site thật. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const permsOf = (code: string) => {
  const role = ROLE_SEED.find((r) => r.code === code);
  if (!role) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  return role.perms;
};
const hasPerm = (code: string, action: string) =>
  permsOf(code).some((p) => p.action === action);

describe("B-01 · quyền đặt mục tiêu doanh thu — khai đủ hai tầng", () => {
  it("v1 (đang chạy local/dev/CI): QLCS + Kế toán + Admin giữ quyền", () => {
    expect(PERMISSIONS).toHaveProperty(KEY);
    expect([...PERMISSIONS[KEY]].sort()).toEqual(
      ["ACCOUNTANT", "CENTER_MANAGER", "SUPER_ADMIN"].sort(),
    );
  });

  it("v2 (đang enforce prod): seed cho QLCS + kế toán Hội sở + kế toán cơ sở", () => {
    for (const code of ["CENTER_MANAGER", "HO_ACCOUNTANT", "CENTER_ACCOUNTANT"]) {
      expect(hasPerm(code, KEY), `RoleDef ${code} thiếu ${KEY}`).toBe(true);
    }
  });

  it("seed GLOBAL ở MỌI RoleDef giữ nó — call-site gọi TRẦN, scope CENTER sẽ FALSE trên prod", () => {
    const viPham = ROLE_SEED.flatMap((r) =>
      r.perms
        .filter((p) => p.action === KEY && p.scopeType !== "GLOBAL")
        .map((p) => `${r.code} = ${p.scopeType}`),
    );
    expect(viPham).toEqual([]);
  });

  it("có descriptor trong registry quyền (module finance)", () => {
    const row = collectDescriptors(ALL_MODULE_DECLS).get(KEY);
    expect(row, `registry thiếu ${KEY}`).toBeDefined();
    expect(row?.module).toBe("finance");
    expect(row?.action).toBe("manage");
  });
});

describe("B-01 · KHÔNG nới quyền tiền để đổi lấy ô nhập mục tiêu", () => {
  it("QLCS vẫn KHÔNG có payments:manage ở v1", () => {
    expect(PERMISSIONS["payments:manage"]).not.toContain("CENTER_MANAGER");
  });

  it("QLCS vẫn KHÔNG có payments:manage ở v2", () => {
    expect(hasPerm("CENTER_MANAGER", "payments:manage")).toBe(false);
  });

  it("ai đang đặt được mục tiêu (payments:manage) thì KHÔNG mất năng lực đó", () => {
    for (const r of ROLE_SEED) {
      if (r.perms.some((p) => p.action === "payments:manage")) {
        expect(hasPerm(r.code, KEY), `${r.code} mất quyền đặt mục tiêu sau B-01`).toBe(true);
      }
    }
  });
});

describe("B-01 · cổng trang + cổng action nói cùng một câu", () => {
  it("PAGE_GATES khai /bao-cao/doanh-thu và có chứa quyền mới", () => {
    const gate = PAGE_GATES["/bao-cao/doanh-thu"] as readonly string[] | undefined;
    expect(gate, "PAGE_GATES thiếu /bao-cao/doanh-thu").toBeDefined();
    expect(gate).toContain(KEY);
  });

  it("page.tsx gác bằng bảng PAGE_GATES, không khai action rời", () => {
    const src = stripComments(fs.readFileSync(PAGE_FILE, "utf8"));
    expect(src).toContain('PAGE_GATES["/bao-cao/doanh-thu"]');
  });

  it("action gác bằng revenue_targets:manage, KHÔNG còn payments:manage", () => {
    const src = stripComments(fs.readFileSync(ACTION_FILE, "utf8"));
    expect(src).toContain(`checkPermission("${KEY}")`);
    expect(src).not.toContain("payments:manage");
  });

  it("action gọi hàm thuần kiểm phạm vi (không tự chế điều kiện tại chỗ)", () => {
    const src = stripComments(fs.readFileSync(ACTION_FILE, "utf8"));
    expect(src).toContain("checkRevenueTargetScope");
  });
});

describe("B-01 · lưu xong phải thấy số mới ngay", () => {
  /**
   * Trang đọc qua `safeCache(..., { tags: [CACHE_TAGS.report], revalidate: 120 })`, mà
   * khoá cache gồm `actorScopeKey` + bộ lọc. `revalidatePath` KHÔNG đụng tới entry của
   * `unstable_cache` ⇒ lưu mục tiêu xong, bảng vẫn hiện số cũ tới 2 phút và người dùng
   * bấm Lưu lần nữa. Phải huỷ theo TAG.
   */
  it("action huỷ cache báo cáo theo tag sau khi ghi", () => {
    const src = stripComments(fs.readFileSync(ACTION_FILE, "utf8"));
    expect(src).toContain("safeUpdateTag(CACHE_TAGS.report)");
  });
});
