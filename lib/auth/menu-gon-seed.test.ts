// Ca [MG-SEED-*] — danh sách "menu gọn" khai trong seed vai (28/09/2026).
//
// Ba điều phải giữ:
//   1. Kế toán ẩn ĐÚNG hai nhóm chủ dự án chọn — không hơn (Sản phẩm & Kho, Chấm công GIỮ).
//   2. Mọi đường dẫn khai phải là một mục menu CÓ THẬT — gõ sai một ký tự thì mục vẫn hiện,
//      không lỗi nào báo (seed chỉ ghi chuỗi).
//   3. CHỈ ẩn menu, KHÔNG gỡ quyền: vai vẫn giữ quyền xem của mục bị ẩn. Ai "tiện tay" gỡ quyền
//      ở đây là đổi hành vi thật (công nợ, hoá đơn, phiếu thu đọc học viên/ghi danh/lớp).
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({}) }));
vi.mock("@/components/chat/use-chat-unread", () => ({ useChatUnread: () => 0 }));

import { ROLE_SEED } from "@/prisma/seed-roles";
import { MUC_MENU_CO_THE_AN } from "@/components/admin/sidebar";

const vai = (code: string) => {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`thiếu vai ${code} trong seed`);
  return r;
};

const AN_KE_TOAN = [
  "/bao-cao/churn",
  "/centers",
  "/classes",
  "/enrollments",
  "/khuyen-mai",
  "/lich",
  "/sinh-nhat",
  "/students",
  // "/students/sap-het-khoa" — mục menu đã gỡ 01/10/2026 (thành tab trong /enrollments, vốn đã ẩn).
  "/tra-cuu",
];

describe("[MG-SEED-01] kế toán ẩn đúng hai nhóm đã chọn", () => {
  it.each(["HO_ACCOUNTANT", "CENTER_ACCOUNTANT"])("%s", (code) => {
    expect([...(vai(code).anMenu ?? [])].sort()).toEqual(AN_KE_TOAN);
  });

  it("KHÔNG ẩn Sản phẩm & Kho, Chấm công (giữ theo quyết định #09 và chấm công L1)", () => {
    const an = new Set(vai("HO_ACCOUNTANT").anMenu ?? []);
    for (const h of ["/products", "/inventory/dashboard", "/inventory/audit", "/cham-cong", "/cham-cong/lich-ca"]) {
      expect(an.has(h), h).toBe(false);
    }
  });

  it("Quản trị tối cao không gọn menu", () => {
    expect(vai("SUPER_ADMIN").anMenu ?? []).toEqual([]);
  });
});

describe("[MG-SEED-02] mọi đường dẫn khai là mục menu có thật", () => {
  const coThat = new Set(MUC_MENU_CO_THE_AN.map((m) => m.href));
  it.each(ROLE_SEED.filter((r) => (r.anMenu ?? []).length > 0).map((r) => r.code))("%s", (code) => {
    const sai = (vai(code).anMenu ?? []).filter((h) => !coThat.has(h));
    expect(sai, `đường dẫn không có trong menu (gõ sai?)`).toEqual([]);
  });

  it("danh mục mục ẩn được KHÔNG chứa Dashboard (lối về nhà luôn hiện)", () => {
    expect(coThat.has("/dashboard")).toBe(false);
  });
});

describe("[MG-SEED-03] chỉ ẩn menu — vai vẫn GIỮ quyền của mục bị ẩn", () => {
  const giu: Record<string, string[]> = {
    HO_ACCOUNTANT: ["students:view-all", "enrollments:view-all", "classes:view-all", "promotions:view", "centers:view"],
    CENTER_ACCOUNTANT: ["students:view-all", "enrollments:view-all", "classes:view-all", "promotions:view"],
  };
  it.each(Object.keys(giu))("%s", (code) => {
    const co = new Set(vai(code).perms.map((p) => p.action));
    expect(giu[code]!.filter((a) => !co.has(a))).toEqual([]);
  });
});
