// Lưới phân ca: cột Công/Nghỉ + dây nối "màn và tệp Excel đọc MỘT nguồn" (07/10/2026).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tongCongNghi } from "./luoi-phan-ca";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("[LPC] lưới phân ca — đếm Công/Nghỉ", () => {
  it("[LPC-01] mọi mã làm việc = 1 công; X và P = nghỉ; ô trống không đếm", () => {
    expect(
      tongCongNghi({
        1: { code: "HC" },
        2: { code: "S" },
        3: { code: "X" },
        4: { code: "P" },
        5: { code: "12" },
        6: null,
        7: { code: null },
      }),
    ).toEqual({ cong: 3, nghi: 2 });
  });

  it("[LPC-02] KHÔNG suy nghỉ từ tên mã khác (LD, LDGV vẫn là ô có mã ⇒ công)", () => {
    expect(tongCongNghi({ 1: { code: "LD" }, 2: { code: "LDGV" } })).toEqual({ cong: 2, nghi: 0 });
  });
});

describe("[LPC-W] dây nối: màn và tệp Excel đọc CÙNG nguồn", () => {
  const page = doc("app/(admin)/admin/cham-cong/phan-ca/page.tsx");
  const route = doc("app/api/admin/cham-cong/phan-ca/export/route.ts");
  const grid = doc("app/(admin)/admin/cham-cong/phan-ca/_components/month-grid.tsx");

  it("[LPC-W1] trang và route đều gọi loadLuoiPhanCa(", () => {
    expect(page.match(/loadLuoiPhanCa\(/g)?.length).toBe(1);
    expect(route.match(/loadLuoiPhanCa\(/g)?.length).toBe(1);
    // Trang KHÔNG còn tự truy vấn ô ca (bản trước 07/10 truy vấn tại chỗ).
    expect(page).not.toMatch(/shiftAssignment\.findMany\(/);
  });

  it("[LPC-W2] cột Công/Nghỉ của màn và tệp cùng gọi tongCongNghi(", () => {
    expect(grid).toMatch(/tongCongNghi\(row\.cells\)/);
    expect(route.match(/tongCongNghi\(r\.cells\)/g)?.length).toBe(2);
  });

  it("[LPC-W3] route gác cả cổng xem màn (assign|view theo TỪNG khối) lẫn cổng vai xuất", () => {
    // Kiểm theo TỪNG khối xin xuất (biến vòng lặp `c`), không phải một khối cố định.
    expect(route).toMatch(/for \(const c of xin\)/);
    expect(route).toMatch(/checkPermission\("hr_attendance:assign", \{ centerId: c \}\)/);
    expect(route).toMatch(/checkPermission\("hr_attendance:view", \{ centerId: c \}\)/);
    expect(route).toMatch(/chanXuatVai\("phan-ca-thang", session\)/);
  });
});