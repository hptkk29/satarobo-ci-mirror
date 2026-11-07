// @vitest-environment node
/** [DSC-*] Thanh bên khu Chính sách: đủ 13 trang, tên đúng nguyên văn BCT, tách tiêu đề gradient. */
import { describe, expect, it } from "vitest";
import { allLegalSlugs, LEGAL_PAGES } from "@/lib/legal-pages";
import { danhSachChinhSach, tachTieuDeGradient, THU_TU_CHINH_SACH } from "./danh-sach-chinh-sach";

describe("[DSC] danh sách chính sách", () => {
  it("[DSC-01] đúng 13 trang, đúng tập slug pháp lý công khai (không thừa, không thiếu)", () => {
    const ds = danhSachChinhSach();
    expect(ds).toHaveLength(13);
    expect(new Set(THU_TU_CHINH_SACH).size).toBe(13);
    expect([...ds.map((m) => m.slug)].sort()).toEqual([...allLegalSlugs()].sort());
  });

  it("[DSC-02] 10 chính sách BCT mang ĐÚNG tên trong lib/legal-pages (không dùng tên rút gọn của artifact)", () => {
    const ds = danhSachChinhSach();
    for (const p of LEGAL_PAGES) expect(ds.find((m) => m.slug === p.slug)?.label).toBe(p.label);
    expect(ds.find((m) => m.slug === "chinh-sach-cham-dut-dich-vu")?.label).toBe("Chính sách chấm dứt dịch vụ và hoàn tiền");
  });

  it("[DSC-03] href có dấu / đầu", () => {
    for (const m of danhSachChinhSach()) expect(m.href).toBe(`/${m.slug}`);
  });

  it("[DSC-04] tách tiêu đề: hai chữ cuối tô màu; tiêu đề 2 chữ thì 1 chữ; 1 chữ thì cả chữ", () => {
    expect(tachTieuDeGradient("Điều khoản Sử dụng")).toEqual({ dau: "Điều khoản", cuoi: "Sử dụng" });
    expect(tachTieuDeGradient("Chính sách giá")).toEqual({ dau: "Chính", cuoi: "sách giá" });
    expect(tachTieuDeGradient("Quyền riêng")).toEqual({ dau: "Quyền", cuoi: "riêng" });
    expect(tachTieuDeGradient("Cookie")).toEqual({ dau: "", cuoi: "Cookie" });
  });
});

describe("[DSC-05] mô tả ngắn khớp phụ đề của từng trang", () => {
  it("mỗi slug có mô tả, và `subtitle` trong page.tsx của slug đó CHÍNH LÀ mô tả ấy", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { MO_TA_CHINH_SACH } = await import("./danh-sach-chinh-sach");
    const slugCoTrang = THU_TU_CHINH_SACH.filter((s) => s !== "chinh-sach");
    expect(Object.keys(MO_TA_CHINH_SACH).sort()).toEqual([...slugCoTrang].sort());
    for (const slug of slugCoTrang) {
      const ma = readFileSync(resolve(process.cwd(), `app/(public)/${slug}/page.tsx`), "utf8").replace(/\s+/g, " ");
      expect(ma, slug).toContain(MO_TA_CHINH_SACH[slug]!.replace(/\s+/g, " "));
    }
  });
});
