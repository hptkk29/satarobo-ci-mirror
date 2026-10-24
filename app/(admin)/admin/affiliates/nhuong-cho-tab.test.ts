/**
 * [AFF-CU-*] — màn cũ `/affiliates` nhường chỗ cho tab Affiliate của module KHI tab mở được, và KHÔNG lấy mất lối vào của ai khác.
 *
 * Page là Server Component (kéo next-auth + Prisma) nên ghim bằng văn bản mã nguồn ĐÃ BỎ CHÚ THÍCH (luật 11: neo hẹp, đếm số lần khớp, không cờ `/s`).
 * Hành vi "ai thấy mục menu nào" đã có ca thật ở `sidebar-nguon-hoa-hong.test.tsx` ([AFF-NAV-CU]); ca này canh PHÍA TRANG của cùng quyết định.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) =>
  s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
const src = boChuThich(readFileSync(resolve(process.cwd(), "app/(admin)/admin/affiliates/page.tsx"), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe("[AFF-CU-01] /affiliates chuyển về tab Affiliate đúng điều kiện, đúng thứ tự", () => {
  it("redirect sang tab chỉ khi `tabMoDuoc(\"affiliate\")` — dùng đúng hàm của module, không tự AND cờ/quyền", () => {
    expect(dem(src, /\.tabMoDuoc\(\s*"affiliate"\s*\)\)\s*redirect\(\s*"\/nguon-hoa-hong\/affiliate"\s*\)/g)).toBe(1);
    expect(dem(src, /\bloadNguonHoaHongScope\(/g)).toBe(1);
  });

  it("đứng TRƯỚC cổng quyền cũ (leads:view-all) — người chỉ có affiliates:view không bị đá về /dashboard", () => {
    const iChuyen = src.search(/\.tabMoDuoc\(\s*"affiliate"\s*\)/);
    const iCongCu = src.search(/checkPermission\(\s*"leads:view-all"\s*\)/);
    expect(iChuyen).toBeGreaterThan(-1);
    expect(iCongCu).toBeGreaterThan(iChuyen);
  });

  it("cổng quyền cũ còn nguyên (không bị gỡ cùng lúc): người không mở được tab vẫn đi đường cũ", () => {
    expect(dem(src, /checkPermission\(\s*"leads:view-all"\s*\)/g)).toBe(1);
    expect(dem(src, /checkPermission\(\s*"leads:assign"\s*\)/g)).toBe(1);
    expect(dem(src, /\bfalse\s*&&|\|\|\s*true\b/g)).toBe(0);
  });
});

describe("[AFF-CU-02] màn cũ KHÔNG ghi được khi tab Affiliate đã bật, và luôn giữ isActive ≡ status", () => {
  const act = boChuThich(readFileSync(resolve(process.cwd(), "app/(admin)/admin/affiliates/_actions.ts"), "utf8"));

  it("cả HAI hàm ghi (tạo, sửa) gọi chanKhiTabAffiliateBat ngay sau gate quyền — chặn ở HÀM GHI, không chỉ ở trang", () => {
    expect(dem(act, /const chan = await chanKhiTabAffiliateBat\(\);\s*if \(chan\) return chan;/g)).toBe(2);
    expect(dem(act, /co\.affiliate \? \{ ok: false/g)).toBe(1);
    expect(dem(act, /\bdocCoModule\(\)/g)).toBe(1);
  });

  it("tạo ghi `status` đồng bộ `isActive`; sửa chỉ lật khi ACTIVE/SUSPENDED và chặn lật ở trạng thái khác", () => {
    expect(dem(act, /status:\s*parsed\.data\.isActive \? "ACTIVE" : "SUSPENDED"/g)).toBe(1);
    expect(dem(act, /!TRANG_THAI_LAT_DUOC\.has\(current\.status\) && parsed\.data\.isActive !== current\.isActive/g)).toBe(1);
    expect(dem(act, /\.\.\.\(TRANG_THAI_LAT_DUOC\.has\(current\.status\)/g)).toBe(1);
  });

  it("[AFF-CU-02b] KHÔNG còn đường ghi `Lead.affiliateId` ở màn cũ (`setLeadAffiliateAction` đã gỡ 20/10/2026: 0 nơi gọi, ghi cột nguồn legacy bằng `leads:assign` GLOBAL — không kiểm cơ sở GHI, không thẻ, không chặn khi module Nguồn bật); tra mã ?ref= vẫn đòi CẢ isActive LẪN status ACTIVE", () => {
    expect(dem(act, /setLeadAffiliateAction/g)).toBe(0);
    expect(dem(act, /\.lead\.update\(/g)).toBe(0);
    const idx = boChuThich(readFileSync(resolve(process.cwd(), "lib/affiliate/index.ts"), "utf8"));
    expect(dem(idx, /where: \{ code, isActive: true, status: "ACTIVE" \}/g)).toBe(1);
  });
});
