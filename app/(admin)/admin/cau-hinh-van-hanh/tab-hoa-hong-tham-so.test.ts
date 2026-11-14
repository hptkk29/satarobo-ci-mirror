/**
 * [CHH-TS-*] — tab "Hoa hồng" của Cấu hình vận hành PHẢI còn bảng ô tham số (12/10/2026, UAT trên TEST).
 *
 * Sự cố: `page.tsx` dựng khối riêng của tab Hoa hồng (bảng chính sách + thẻ mốc chuyển) bằng `noiDungRieng`, mà `noiDungRieng` THAY cả bảng ô cấu hình
 * (`khung-cau-hinh.tsx`). Các tham số của module Hoa hồng nằm CÙNG tab (`hoaHong.engineBat`, `hoaHong.xuatLuongBat`, `hoaHong.kyCutover` chỉ-đọc) nên biến mất
 * khỏi màn hình — không lỗi, không cảnh báo: người vận hành không có đường nào bật engine bằng giao diện (các màn Chính sách/Sổ/Kỳ 404 khi engine tắt).
 * Cách đúng là `khoiThem` (bày THÊM dưới bảng ô). Page là Server Component nên đọc mã nguồn (luật 11: bỏ chú thích, neo hẹp, đếm số lần).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { keyCuaTab } from "@/lib/settings/nhan-van-hanh";

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const src = boChuThich(readFileSync(resolve(process.cwd(), "app/(admin)/admin/cau-hinh-van-hanh/page.tsx"), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe("[CHH-TS] tab Hoa hồng giữ bảng ô tham số", () => {
  it("[CHH-TS-1] khối Hoa hồng nằm TRONG `khoiThem`, đứng TRƯỚC `noiDungRieng` (không nằm trong nó)", () => {
    expect(dem(src, /khoiThem=\{\{/g)).toBe(1);
    expect(dem(src, /noiDungRieng=\{\{/g)).toBe(1);
    expect(dem(src, /"hoa-hong": \(/g)).toBe(1);
    const iThem = src.indexOf("khoiThem={{");
    const iRieng = src.indexOf("noiDungRieng={{");
    const iHoaHong = src.indexOf('"hoa-hong": (');
    expect(iThem).toBeGreaterThan(-1);
    expect(iHoaHong).toBeGreaterThan(iThem);
    expect(iHoaHong).toBeLessThan(iRieng);
  });

  it("[CHH-TS-2] đối chứng: tab Hoa hồng thật sự còn tham số cần hiện (để [CHH-TS-1] canh thứ có thật)", () => {
    const ban = keyCuaTab("hoa-hong").filter((k) => k !== "crm.commissionPolicies");
    expect(ban).toEqual(expect.arrayContaining(["hoaHong.engineBat", "hoaHong.xuatLuongBat"]));
  });
});
