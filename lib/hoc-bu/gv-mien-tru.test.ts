import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nhanCaGv, themGvMienTru } from "./gv-mien-tru";

const GV = [
  { id: "u_kiet", name: "Hoàng Phan Tuấn Kiệt" },
  { id: "u_anh", name: "Nguyễn Thị Hoàng Anh" },
  { id: "u_toai", name: "Phan Thành Toại" },
];

describe("giáo viên luôn hiện khi xếp case bù", () => {
  it("[GMT-01] người được miễn nhưng không có ca phủ khung giờ vẫn chọn được, ma rỗng", () => {
    const kq = themGvMienTru([{ id: "u_anh", name: "Nguyễn Thị Hoàng Anh", ma: "CT" }], GV, ["u_kiet"]);
    expect(kq.map((g) => g.id)).toEqual(["u_kiet", "u_anh"]);
    expect(kq.find((g) => g.id === "u_kiet")?.ma).toBe("");
  });

  it("[GMT-02] người đã có ca phủ giữ nguyên mã ca, không bị thêm hai lần", () => {
    const kq = themGvMienTru([{ id: "u_kiet", name: "Hoàng Phan Tuấn Kiệt", ma: "HC" }], GV, ["u_kiet"]);
    expect(kq).toEqual([{ id: "u_kiet", name: "Hoàng Phan Tuấn Kiệt", ma: "HC" }]);
  });

  it("[GMT-03] danh sách miễn rỗng ⇒ không thêm ai (đúng hành vi cũ)", () => {
    const ds = [{ id: "u_anh", name: "Nguyễn Thị Hoàng Anh", ma: "CT" }];
    expect(themGvMienTru(ds, GV, [])).toEqual(ds);
  });

  it("[GMT-04] mã lạ trong cấu hình (không phải giáo viên hợp lệ) không thành chọn được", () => {
    expect(themGvMienTru([], GV, ["u_khong_ton_tai"])).toEqual([]);
  });

  it("[GMT-05] nhãn: có ca in mã ca, không ca in 'luôn hiện'", () => {
    expect(nhanCaGv({ ma: "CT" })).toBe("ca CT");
    expect(nhanCaGv({ ma: "" })).toBe("luôn hiện");
  });

  it("[GMT-W1] gvTrongCa gộp danh sách miễn từ cùng khoá cấu hình với lớp trial", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/hoc-bu/case-db.ts"), "utf8");
    const ham = src.slice(src.indexOf("export async function gvTrongCa("), src.indexOf("async function kiemDongXep("));
    expect(ham.match(/themGvMienTru\(/g)).toHaveLength(1);
    expect(ham).toContain('getSetting("trial.gvMienLocTheoCa")');
    // Cổng ở máy chủ (`kiemGvVaPhong`) đọc đúng hàm này nên ô chọn bày ai thì máy chủ nhận người đó.
    expect(src).toContain("const gv = await gvTrongCa(actor,");
  });
});
