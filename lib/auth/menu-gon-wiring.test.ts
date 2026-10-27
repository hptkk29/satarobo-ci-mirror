// Ca [MG-W1] — lưới ghim DÂY NỐI "menu gọn theo vai" ở layout admin (28/09/2026).
// `anMenu` là prop BẮT BUỘC nên `tsc` đã ép layout phải truyền — nhưng truyền `anMenu={[]}` vẫn
// biên dịch được, và khi đó menu kế toán lặng lẽ đủ như cũ, không ca hành vi nào đỏ (layout là
// Server Component đọc DB). Lưới này ghim: tính theo VAI ĐANG DÙNG (actor đã thu hẹp của bộ chọn
// vai), nạp dữ liệu vai thật, và truyền đúng biến đó xuống.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ⚠️ Bỏ chú thích DÒNG trước, chú thích KHỐI sau: layout có dòng chú thích nhắc "/admin/*" — bóc
// khối trước thì `/*` đó mở một "khối" nuốt luôn mã thật tới `*/` của JSX, và lưới đỏ oan (đã vấp).
const ma = readFileSync(resolve(process.cwd(), "app/(admin)/admin/layout.tsx"), "utf8")
  .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("[MG-W1] layout nối menu gọn theo vai", () => {
  it("vai lấy từ actor ĐÃ THU HẸP theo vai đang chọn (cùng actor của menu quyền)", () => {
    expect(ma.match(/vaiDangDungChoMenu\(menuActor,/g)?.length).toBe(1);
    expect(ma.match(/actor: menuActor,/g)?.length).toBe(1);
  });

  it("nạp dữ liệu vai thật rồi mới giao danh sách", () => {
    expect(ma.match(/napAnMenuCuaVai\(vaiMenu\)/g)?.length).toBe(1);
    expect(ma.match(/menuAnTheoVai\(\{ vai: vaiMenu, anMenuCuaVai \}\)/g)?.length).toBe(1);
  });

  it("truyền ĐÚNG biến đã tính xuống khung — không phải hằng rỗng", () => {
    expect(ma.match(/anMenu=\{anMenu\}/g)?.length).toBe(1);
    expect(ma).not.toMatch(/anMenu=\{\[\]\}/);
  });
});
