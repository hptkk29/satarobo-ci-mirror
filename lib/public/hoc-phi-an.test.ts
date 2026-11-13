/**
 * Ẩn học phí khoá offline trên website [BLĐ chốt 06/11/2026] — LƯỚI GHIM DÂY NỐI.
 *
 * Hàm thuần (`giaTheDanhSach`, `jsonLdKhoa`) có ca hành vi ở `khoa-hoc-thuan.test.ts` ([AHP-01..03]).
 * Thứ test hành vi KHÔNG đo được là: loader có HỎI cờ không. Loader chạm DB, nên gỡ dòng
 * `if (await dangAnHocPhi())` thì mọi ca thuần vẫn xanh trong khi website in lại toàn bộ học phí.
 * Lưới dưới đọc chính mã nguồn (đã bóc chú thích) và đòi đúng các lời gọi đó.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS } from "@/lib/settings/registry";

function doc(p: string): string {
  const s = readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
const dem = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;

describe("[AHP-W] ẩn học phí — dây nối", () => {
  it("[AHP-W1] cờ public.anHocPhi: mặc định ẨN, chỉ cấu hình toàn hệ thống (không cài riêng theo cơ sở)", () => {
    const d = SETTINGS["public.anHocPhi"];
    expect(d.default).toBe(true);
    expect(d.centerOverridable).toBe(false);
    expect(d.qlcsSuaDuoc ?? false).toBe(false);
  });

  it("[AHP-W2] layGiaNiemYet hỏi cờ TRƯỚC mọi nguồn giá (gói / DB / hằng)", () => {
    const s = doc("components/public/khoa-hoc/khoa-hoc-loader.ts");
    expect(s).toMatch(
      /export const layGiaNiemYet = cache\(async \(slug: string\): Promise<number \| null> => \{\s*if \(await dangAnHocPhi\(\)\) return null;/,
    );
  });

  it("[AHP-W3] layGiaTrangChu hỏi cờ và trả bảng giá rỗng", () => {
    const s = doc("components/public/home/home-loader.ts");
    expect(dem(s, /if \(await dangAnHocPhi\(\)\) return dungGiaTrangChu\(\[\]\);/)).toBe(1);
  });

  it("[AHP-W4] trang danh sách truyền ĐÚNG cờ đọc từ dangAnHocPhi() vào giaTheDanhSach", () => {
    const s = doc("components/public/khoa-hoc/trang-danh-sach.tsx");
    expect(s).toMatch(/\[bangGia, anHocPhi,[^\]]*\] = await Promise\.all\(\[\s*layBangGia\(\),\s*dangAnHocPhi\(\),/);
    expect(dem(s, /giaTheDanhSach\(t, giaCuaThe, anHocPhi\)/)).toBe(1);
  });

  it("[AHP-W6] thẻ gửi xuống trình duyệt đã bóc price/unit gốc (không lộ trong mã nguồn trang)", () => {
    // Đo 06/11: trước bản vá, `{ ...t, giaSo }` mang nguyên "price":"880.000đ" vào dữ liệu RSC dù chữ
    // trên thẻ đã là "Liên hệ trung tâm". Kiểu `Omit` KHÔNG chặn được (TS không soát thuộc tính thừa khi trải).
    const s = doc("components/public/khoa-hoc/trang-danh-sach.tsx");
    expect(dem(s, /const \{ price: _price, unit: _unit, \.\.\.con \} = t;/)).toBe(1);
    expect(s).not.toMatch(/\{ \.\.\.t, giaSo/);
  });

  it("[AHP-W5] trang chi tiết luôn phát JSON-LD (không còn bỏ cả khối khi thiếu giá)", () => {
    const s = doc("components/public/khoa-hoc/trang-khoa.tsx");
    expect(dem(s, /<JsonLd data=\{jsonLdKhoa\(nd, gia, dan\)\} \/>/)).toBe(1);
    expect(s).not.toMatch(/\{gia && <JsonLd/);
  });
});
