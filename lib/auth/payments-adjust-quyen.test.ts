// lib/auth/payments-adjust-quyen.test.ts — quyền của nút "Điều chỉnh khoản thu".
//
// ─────────────────────────────────────────────────────────────────────────────
// Điểm khác thường của action này, viết ra để không ai "sửa cho khớp" rồi phá
//
// `payments:adjust` cố ý KHÔNG đối xứng giữa hai tầng RBAC:
//
//   · ma trận v1 (`PERMISSIONS`)      → CHỈ `SUPER_ADMIN`
//   · RBAC v2 (`prisma/seed-roles.ts`) → HO_ACCOUNTANT + CENTER_ACCOUNTANT
//
// Prod bật `RBAC_V2_ENABLED` nên kế toán dùng được thật; máy dev/CI chạy v1 nên ở đó chỉ
// SUPER_ADMIN thấy nút. Chủ dự án chốt giữ nguyên hình dạng này (07/09/2026).
//
// Danh sách v1 không được RỖNG: repo có bất biến "mọi action phải cấp cho SUPER_ADMIN"
// (`permissions.test.ts`), vì `can()` v2 trả true vô điều kiện cho SUPER_ADMIN — v1 thiếu
// nó là mỗi lượt admin chạm call-site đẻ một dòng `RbacShadowDiff`.
//
// Lịch sử: từ 07/09 tới khi bộ test Bước 6 xanh, đường này còn có một CẦU DAO ở tầng tính
// năng chặn cả SUPER_ADMIN (ma trận không khoá được admin). Cầu dao đã gỡ ở Bước 7 —
// xem docs/dieu-chinh-khoan-thu.md.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";

import type { Role } from "@prisma/client";

import { ALL_ACTIONS, PERMISSIONS, can } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../prisma/seed-roles";

const MOI_VAI: Role[] = [
  "SUPER_ADMIN",
  "CENTER_MANAGER",
  "HR",
  "SALES_CSM",
  "TEACHER",
  "TRAINING",
  "MARKETING",
  "ACCOUNTANT",
  "PARENT",
];

/** Vai v2 ĐƯỢC phép điều chỉnh khoản thu — người ngồi đối soát sao kê. */
const VAI_V2_DUOC_PHEP = ["HO_ACCOUNTANT", "CENTER_ACCOUNTANT"];

describe("payments:adjust — ma trận v1", () => {
  it("là một action có thật (không phải chuỗi gõ nhầm ở call-site)", () => {
    // Gõ sai key thì `can()` trả false và cổng nhìn như đang chạy — xanh giả.
    expect(ALL_ACTIONS).toContain("payments:adjust");
  });

  it("v1 CHỈ có SUPER_ADMIN — cố ý, vai nghiệp vụ nhận ở v2", () => {
    expect(PERMISSIONS["payments:adjust"]).toEqual(["SUPER_ADMIN"]);
    for (const vai of MOI_VAI.filter((v) => v !== "SUPER_ADMIN")) {
      expect(can(vai, "payments:adjust"), `${vai} không có quyền này ở v1`).toBe(false);
    }
  });

  it("KHÔNG đụng tới payments:confirm / record — luồng thu tiền nguyên vẹn", () => {
    expect(can("ACCOUNTANT", "payments:confirm")).toBe(true);
    expect(can("ACCOUNTANT", "payments:record")).toBe(true);
  });
});

describe("payments:adjust — RBAC v2 (nguồn thật trên prod)", () => {
  const theoVai = new Map(ROLE_SEED.map((r) => [r.code, new Set(r.perms.map((p) => p.action))]));

  it("cấp cho kế toán Hội sở VÀ kế toán cơ sở", () => {
    for (const code of VAI_V2_DUOC_PHEP) {
      expect(theoVai.get(code)?.has("payments:adjust"), `${code} phải có payments:adjust`).toBe(
        true,
      );
    }
  });

  it("KHÔNG rò sang vai khác — điều chỉnh tiền đã đối soát không phải việc của Sale/GV/QLCS", () => {
    const roRi = ROLE_SEED.filter(
      (r) =>
        r.code !== "SUPER_ADMIN" &&
        !VAI_V2_DUOC_PHEP.includes(r.code) &&
        r.perms.some((p) => p.action === "payments:adjust"),
    ).map((r) => r.code);
    expect(roRi).toEqual([]);
  });

  it("ai điều chỉnh được thì cũng xác nhận được (không có vai chỉ-sửa-không-thu)", () => {
    // Vai sửa được số đã vào sổ mà không tham gia khâu xác nhận là một lỗ tách nhiệm vụ
    // ngược: người sửa không phải người chịu trách nhiệm con số.
    for (const code of VAI_V2_DUOC_PHEP) {
      expect(theoVai.get(code)?.has("payments:confirm"), `${code} phải có payments:confirm`).toBe(
        true,
      );
    }
  });
});
