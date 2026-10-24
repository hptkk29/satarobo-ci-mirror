import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { locAnhTheoNguoiXem } from "./pham-vi-xem";

describe("locAnhTheoNguoiXem — ai thấy ảnh lớp nào", () => {
  it("[MXV-01] người duyệt (media:approve) thấy mọi ảnh trong phạm vi lớp — không thêm điều kiện", () => {
    expect(locAnhTheoNguoiXem({ xemTatCa: true, userId: "u1" })).toEqual({});
  });

  it("[MXV-02] người khác chỉ thấy ảnh chính mình tải lên", () => {
    expect(locAnhTheoNguoiXem({ xemTatCa: false, userId: "u1" })).toEqual({ uploadedById: "u1" });
  });
});

// Lưới ghim dây nối: test hành vi ở trên không biết trang có GỌI hàm hay không. Mỗi câu đọc ảnh
// ở hai màn phải trải bộ lọc vào `where`; bỏ một chỗ là đúng chỗ đó rò ảnh người khác.
function doc(rel: string): string {
  return fs
    .readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("dây nối bộ lọc ảnh", () => {
  it("[MXV-W1] /media: cả hai câu đọc ảnh (album + kho) trải bộ lọc, cờ lấy từ media:approve", () => {
    const src = doc("app/(admin)/admin/media/page.tsx");
    expect(src).toMatch(/const canApprove = await checkPermission\("media:approve"\)/);
    expect(src).toMatch(/locAnhTheoNguoiXem\(\{ xemTatCa: canApprove, userId: session\.user\.id \}\)/);
    expect(src.match(/\.\.\.locAnh,/g)?.length).toBe(2);
    expect(src.match(/classSessionMedia\.findMany\(/g)?.length).toBe(2);
  });

  it("[MXV-W2] site GV: album, thống kê và ảnh bìa đều trải bộ lọc", () => {
    const src = doc("app/(teacher)/teacher/anh-lop/page.tsx");
    expect(src).toMatch(/checkPermission\("media:approve"\)/);
    const doc_ = src.match(/classSessionMedia\.(findMany|groupBy)\(/g)?.length ?? 0;
    expect(doc_).toBe(3);
    expect(src.match(/\.\.\.locAnh,/g)?.length).toBe(doc_);
  });
});
