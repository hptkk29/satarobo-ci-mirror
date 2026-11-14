/**
 * [NDV] Tên hiển thị của «đường vào» + chữ ở ô Nguồn của danh sách lead (chủ dự án 29/10/2026).
 *
 *   [NDV-01] `sale-form-app` ⇒ `nhap-khach-hang`; đường vào khác giữ nguyên; rỗng/null ⇒ null
 *   [NDV-02] chỉ khoá ĐÚNG mới đổi (không khớp một phần) và không đụng prototype (`constructor`)
 *   [NDV-03] ô Nguồn của danh sách: ưu tiên TÊN NGUỒN; chưa quy nguồn ⇒ đường vào đã đổi tên; không có gì ⇒ null
 *   [NDV-04] lưới ghim dây nối: danh sách đọc `attribution.group.name`; trang chi tiết gộp «nhập bởi» vào dòng Nguồn
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chuNguonCuaLead, nhanDuongVao } from "./nhan-duong-vao";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("[NDV] tên hiển thị của đường vào", () => {
  it("[NDV-01] sale-form-app ⇒ nhap-khach-hang; khác giữ nguyên; rỗng ⇒ null", () => {
    expect(nhanDuongVao("sale-form-app")).toBe("nhap-khach-hang");
    expect(nhanDuongVao("  sale-form-app ")).toBe("nhap-khach-hang");
    expect(nhanDuongVao("messenger-ai")).toBe("messenger-ai");
    expect(nhanDuongVao("")).toBeNull();
    expect(nhanDuongVao("   ")).toBeNull();
    expect(nhanDuongVao(null)).toBeNull();
    expect(nhanDuongVao(undefined)).toBeNull();
  });

  it("[NDV-02] chỉ khoá đúng mới đổi; không bị prototype đánh lừa", () => {
    expect(nhanDuongVao("sale-form-app-2")).toBe("sale-form-app-2");
    expect(nhanDuongVao("constructor")).toBe("constructor");
    expect(nhanDuongVao("toString")).toBe("toString");
  });
});

describe("[NDV-03] chữ ở ô Nguồn của danh sách lead", () => {
  it("ưu tiên tên nguồn (quy nguồn), kể cả khi đường vào là sale-form-app", () => {
    expect(chuNguonCuaLead({ nguonTen: "KH tự đến", source: "sale-form-app" })).toBe("KH tự đến");
  });
  it("chưa quy nguồn ⇒ đường vào đã đổi tên", () => {
    expect(chuNguonCuaLead({ nguonTen: null, source: "sale-form-app" })).toBe("nhap-khach-hang");
    expect(chuNguonCuaLead({ nguonTen: "  ", source: "sale-form-app" })).toBe("nhap-khach-hang");
    expect(chuNguonCuaLead({ source: "facebook" })).toBe("facebook");
  });
  it("không có gì ⇒ null", () => {
    expect(chuNguonCuaLead({ nguonTen: null, source: null })).toBeNull();
    expect(chuNguonCuaLead({ source: "" })).toBeNull();
  });
});

describe("[NDV-04] lưới ghim dây nối", () => {
  it("danh sách lead đọc tên nguồn từ attribution.group và truyền xuống hàng", () => {
    const s = doc("app/(admin)/admin/leads/page.tsx");
    expect(s).toMatch(/attribution:\s*\{\s*select:\s*\{\s*group:\s*\{\s*select:\s*\{\s*name:\s*true/);
    expect(s).toMatch(/nguonTen:\s*lead\.attribution\?\.group\.name\s*\?\?\s*null/);
  });
  it("bảng lead dùng chuNguonCuaLead cho cả hai ô in nguồn (không còn in thẳng lead.source)", () => {
    const s = doc("app/(admin)/admin/leads/_components/leads-table.tsx");
    expect(s).toContain("import { chuNguonCuaLead } from '@/lib/nguon/nhan-duong-vao'");
    expect((s.match(/chuNguonCuaLead\(lead\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(s).not.toMatch(/shortSource\(lead\.source\)/);
  });
  it("trang chi tiết: dòng Nguồn mang tên nguồn kèm «nhập bởi», và không còn nhãn «Đường vào» khi đã có nguồn", () => {
    const s = doc("app/(admin)/admin/leads/[id]/page.tsx");
    expect(s).toContain("nhập bởi");
    expect(s).toMatch(/tenNguonKemNguoiNhap/);
    expect(s).toMatch(/nhanDuongVao\(lead\.source\)/);
    // lead chưa quy nguồn: vẫn nhãn «Nguồn», không quay lại nhãn «Đường vào» ở thẻ Thông tin khách hàng
    expect(s).toContain("Chưa quy nguồn (${duongVaoChu})");
    expect(s).toContain('<Info label="Nguồn" value={tenNguonKemNguoiNhap} />');
    expect(s).not.toMatch(/<Info label=\{[^}]*Đường vào/);
    expect(s).not.toContain('label="Nhân viên nhập"');
  });
  it("mọi nơi in «Đường vào (cũ)» đi qua nhanDuongVao và có import", () => {
    for (const f of [
      "components/admin/nguon-hoa-hong/thong-tin-nguon.tsx",
      "components/admin/nguon-hoa-hong/khoi-nguon-lead.tsx",
      "components/admin/nguon-hoa-hong/gan-nguon-sheet.tsx",
      "components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-tracking-thong-ke.tsx",
    ]) {
      const s = doc(f);
      expect(s, f).toContain('import { nhanDuongVao } from "@/lib/nguon/nhan-duong-vao";');
      expect(s, f).toMatch(/nhanDuongVao\(/);
    }
  });
});
