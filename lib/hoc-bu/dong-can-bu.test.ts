import { describe, it, expect } from "vitest";
import { hocPhanCuaKhoa, soBuoiMuaCuaBe, viTriHocPhanBatDau, MA_CA_KHOA } from "./dong-can-bu";

// Hình dạng dữ liệu THẬT: bài Sata3–7 đánh `order` liên tục 1..48, `moduleCode` HP1..HP4
// (lib/lms/curriculum-sata.ts); Sata1/2/8 không chia học phần (`moduleCode` null).
const baiSata4 = Array.from({ length: 48 }, (_, i) => ({
  moduleCode: `HP${Math.floor(i / 12) + 1}`,
  order: i + 1,
}));

describe("hocPhanCuaKhoa", () => {
  it("[DCB-01] 48 bài ⇒ 4 học phần × 12, đúng thứ tự, mặc định 1 lượt", () => {
    const hp = hocPhanCuaKhoa([...baiSata4].reverse(), new Map());
    expect(hp.map((h) => [h.moduleCode, h.soBuoi, h.luotBu])).toEqual([
      ["HP1", 12, 1],
      ["HP2", 12, 1],
      ["HP3", 12, 1],
      ["HP4", 12, 1],
    ]);
  });

  it("[DCB-02] lượt đã khai thắng mặc định; học phần chưa khai vẫn 1", () => {
    const hp = hocPhanCuaKhoa(baiSata4, new Map([["HP2", 3], ["HP4", 0]]));
    expect(hp.map((h) => h.luotBu)).toEqual([1, 3, 1, 0]);
  });

  it("[DCB-03] khoá không chia học phần ⇒ cả khoá là MỘT học phần", () => {
    const bai = Array.from({ length: 16 }, (_, i) => ({ moduleCode: null, order: i + 1 }));
    expect(hocPhanCuaKhoa(bai, new Map())).toEqual([{ moduleCode: MA_CA_KHOA, soBuoi: 16, luotBu: 1 }]);
  });
});

describe("soBuoiMuaCuaBe", () => {
  it("[DCB-04] cộng dồn các dòng CÙNG khoá có khai số buổi; bỏ dòng khoá khác", () => {
    const dong = [
      { courseId: "sata4", soBuoi: 24 },
      { courseId: "sata4", soBuoi: 15 },
      { courseId: "sata5", soBuoi: 48 },
    ];
    expect(soBuoiMuaCuaBe(dong, "sata4", 48)).toBe(39);
  });

  it("[DCB-05] không dòng nào khai số buổi ⇒ mặc định (đủ khoá)", () => {
    expect(soBuoiMuaCuaBe([{ courseId: "sata4", soBuoi: null }], "sata4", 48)).toBe(48);
    expect(soBuoiMuaCuaBe([], "sata4", 48)).toBe(48);
  });

  it("[DCB-06] dòng thiếu courseId không được tính vào khoá nào", () => {
    expect(soBuoiMuaCuaBe([{ courseId: null, soBuoi: 12 }], "sata4", 48)).toBe(48);
  });
});

describe("viTriHocPhanBatDau", () => {
  const hp = hocPhanCuaKhoa(baiSata4, new Map());
  it("[DCB-07] đúng vị trí học phần của buổi đầu; không biết ⇒ 0", () => {
    expect(viTriHocPhanBatDau(hp, "HP3")).toBe(2);
    expect(viTriHocPhanBatDau(hp, undefined)).toBe(0);
    expect(viTriHocPhanBatDau(hp, "HP9")).toBe(0);
  });
});
