// lib/entitlements/nguon-bu.test.ts — BỘ HẰNG SỐ NGUỒN HỌC VƯỢT / VÀO TRỄ (chốt MỘT bộ, mâu thuẫn M4 của DANH-GIA-CHEO).
//
// Hằng số nằm cạnh `NGUON_BU_PHUC_HOC` trong `lib/hoc-bu/xep-case.ts` (không cần import ngược vào lib/entitlements,
// nên `chua-noi.test.ts` không phải đổi khi `laDongMienPhi` đọc chúng). Test ở đây vì nó là điều kiện của nền quyền học.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NGUON_BU_HOC_VUOT, NGUON_BU_PHUC_HOC, NGUON_BU_VAO_TRE, laDongMienPhi } from "@/lib/hoc-bu/xep-case";

describe("[NBU] nguồn dòng bù theo phạm vi học", () => {
  it("[NBU-01] ba nhãn nguồn khác nhau, đúng chữ đã chốt (HOC_VUOT · VAO_TRE cạnh PHUC_HOC)", () => {
    expect([NGUON_BU_HOC_VUOT, NGUON_BU_VAO_TRE, NGUON_BU_PHUC_HOC]).toEqual(["HOC_VUOT", "VAO_TRE", "PHUC_HOC"]);
    expect(new Set([NGUON_BU_HOC_VUOT, NGUON_BU_VAO_TRE, NGUON_BU_PHUC_HOC]).size).toBe(3);
  });

  it("[NBU-02] điều kiện 'không cần migration': MakeupNeed.nguon là String? trong schema (không phải enum)", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const i = schema.indexOf("model MakeupNeed {");
    expect(i).toBeGreaterThan(0);
    const khoi = schema.slice(i, schema.indexOf("\n}", i));
    expect(khoi).toMatch(/\n\s+nguon\s+String\?/);
  });

  it("[NBU-03] đối chứng: PHUC_HOC hôm nay MIỄN PHÍ, vắng thường thì không", () => {
    expect(laDongMienPhi({ freeApprovedAt: null, nguon: NGUON_BU_PHUC_HOC })).toBe(true);
    expect(laDongMienPhi({ freeApprovedAt: null, nguon: null })).toBe(false);
  });

  // GHIM BUG đã đo (G-25), chưa tới lượt vá: `laDongMienPhi` CHƯA nhận hai nguồn mới ⇒ một dòng học vượt vẫn tiêu lượt
  // và đòi phí. Người nối đường tạo dòng mang nhãn này phải mở rộng `laDongMienPhi` (+ toàn-ven TV-22) cùng PR; khi đó ca
  // này XANH và Vitest báo lỗi `it.fails` ⇒ buộc gỡ ghim. Đừng đổi thành it.skip: skip là quên, it.fails là hẹn.
  it.fails("[NBU-04] laDongMienPhi nhận HOC_VUOT và VAO_TRE là miễn phí", () => {
    expect(laDongMienPhi({ freeApprovedAt: null, nguon: NGUON_BU_HOC_VUOT })).toBe(true);
    expect(laDongMienPhi({ freeApprovedAt: null, nguon: NGUON_BU_VAO_TRE })).toBe(true);
  });
});
