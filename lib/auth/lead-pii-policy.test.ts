// Đợt E (kế hoạch Site Sale, 22/08/2026) — test viết TRƯỚC hiện thực (luật cứng #5).
//
// Chủ dự án chốt Q9 (21/08): **Quản lý cơ sở KHÔNG thấy số điện thoại lead**;
// Marketing **vẫn thấy** (chốt riêng 21/07, không đảo).
//
// ⚠️ Đây lại là ĐẢO một quyết định đã ký của chính chủ dự án (#11 T2, Kiệt ký
// 10/07/2026) và đang chạy prod. Vì quyền là thứ khó thấy khi hỏng — không có
// màn hình nào báo "bạn vừa mất quyền" — nên khoá bằng test ở CẢ HAI tầng RBAC:
// matrix v1 (đang chạy local/dev/CI) và seed RoleDef v2 (đang chạy PROD). Sửa một
// tầng mà quên tầng kia = local với prod hành xử khác nhau, và không ai biết.
//
// `leads:view-pii` chỉ cai SĐT/email/tên/ghi chú của LEAD. Liên hệ phụ huynh của
// học viên ĐÃ GHI DANH đi đường khác (`canViewParentContact`, PARENT_CONTACT_ROLES)
// và KHÔNG thuộc phạm vi Q9 — xem ghi chú cuối file.
import { describe, it, expect } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../prisma/seed-roles";

const v2 = (code: string) =>
  new Set((ROLE_SEED.find((r) => r.code === code)?.perms ?? []).map((p) => p.action));

describe("[Đợt E] Q9 — Quản lý cơ sở không thấy SĐT lead", () => {
  it("v1 matrix: CENTER_MANAGER CÓ leads:view-pii (đảo 30/08, xem ghi chú permissions.ts)", () => {
    expect(PERMISSIONS["leads:view-pii"]).toContain("CENTER_MANAGER");
  });

  it("v2 seed: CENTER_MANAGER CÓ leads:view-pii — hai bộ quyền phải nói cùng một câu", () => {
    expect(v2("CENTER_MANAGER").has("leads:view-pii")).toBe(true);
  });

  it("QL cơ sở VẪN thấy danh sách lead — chỉ che PII, không chặn công việc", () => {
    expect(PERMISSIONS["leads:view-all"]).toContain("CENTER_MANAGER");
    expect(v2("CENTER_MANAGER").has("leads:view-all")).toBe(true);
  });

  it("Sale VẪN thấy SĐT — người trực tiếp gọi khách (không đảo)", () => {
    expect(PERMISSIONS["leads:view-pii"]).toContain("SALES_CSM");
    expect(v2("CENTER_SALES_CSM").has("leads:view-pii")).toBe(true);
  });

  it("Marketing VẪN thấy SĐT — chủ dự án trả lời 'không' khi được hỏi có che không", () => {
    expect(PERMISSIONS["leads:view-pii"]).toContain("MARKETING");
    expect(v2("HO_MARKETING").has("leads:view-pii")).toBe(true);
  });

  it("hai tầng RBAC không lệch nhau về ai thấy SĐT lead", () => {
    // Nếu ai đó sửa một tầng rồi quên tầng kia thì ca này đỏ trước khi lên prod.
    const V1_SANG_V2: Record<string, string> = {
      SUPER_ADMIN: "SUPER_ADMIN",
      CENTER_MANAGER: "CENTER_MANAGER",
      SALES_CSM: "CENTER_SALES_CSM",
      MARKETING: "HO_MARKETING",
    };
    for (const [v1Role, v2Code] of Object.entries(V1_SANG_V2)) {
      const coV1 = PERMISSIONS["leads:view-pii"].includes(v1Role as never);
      // SUPER_ADMIN bypass toàn cục ở can() → seed không liệt kê từng action.
      const coV2 = v2Code === "SUPER_ADMIN" ? true : v2(v2Code).has("leads:view-pii");
      expect(coV2, `${v1Role}: v1=${coV1} nhưng v2=${coV2}`).toBe(coV1);
    }
  });
});
