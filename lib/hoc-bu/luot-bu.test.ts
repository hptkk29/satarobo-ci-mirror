import { describe, it, expect } from "vitest";
import { soHocPhanDangKy, tongLuotBu, conLuotBu, type HocPhanKhoa } from "./luot-bu";

// Sata 3–7: 4 học phần × 12 buổi (lib/lms/curriculum-sata.ts), mặc định 1 lượt/học phần.
const SATA4: HocPhanKhoa[] = [
  { moduleCode: "HP1", soBuoi: 12, luotBu: 1 },
  { moduleCode: "HP2", soBuoi: 12, luotBu: 1 },
  { moduleCode: "HP3", soBuoi: 12, luotBu: 1 },
  { moduleCode: "HP4", soBuoi: 12, luotBu: 1 },
];

describe("soHocPhanDangKy — chốt 27/10: chỉ tính học phần đủ mốc nguyên", () => {
  it("[LB-01] đủ học phần thì đếm đủ", () => {
    expect(soHocPhanDangKy(SATA4, 0, 48)).toBe(4);
    expect(soHocPhanDangKy(SATA4, 0, 36)).toBe(3);
    expect(soHocPhanDangKy(SATA4, 0, 12)).toBe(1);
  });

  it("[LB-02] 39 buổi vẫn là 3 (lẻ 3 không đủ một học phần)", () => {
    expect(soHocPhanDangKy(SATA4, 0, 39)).toBe(3);
  });

  it("[LB-03] đúng mốc nguyên mới được: 34 buổi chỉ 2 lượt (ví dụ chủ dự án), 43 buổi vẫn 3, 7 buổi 0", () => {
    expect(soHocPhanDangKy(SATA4, 0, 34)).toBe(2);
    expect(soHocPhanDangKy(SATA4, 0, 42)).toBe(3);
    expect(soHocPhanDangKy(SATA4, 0, 43)).toBe(3);
    expect(soHocPhanDangKy(SATA4, 0, 47)).toBe(3);
    expect(soHocPhanDangKy(SATA4, 0, 7)).toBe(0);
    expect(soHocPhanDangKy(SATA4, 0, 11)).toBe(0);
    expect(soHocPhanDangKy(SATA4, 0, 12)).toBe(1);
  });

  it("[LB-04] đếm TỪ học phần bé bắt đầu, không vượt quá số học phần còn lại", () => {
    // Vào ở HP3: còn HP3 + HP4 = 24 buổi. Mua 48 cũng chỉ còn 2 học phần để học.
    expect(soHocPhanDangKy(SATA4, 2, 24)).toBe(2);
    expect(soHocPhanDangKy(SATA4, 2, 48)).toBe(2);
    expect(soHocPhanDangKy(SATA4, 2, 19)).toBe(1); // 19 buổi chỉ đủ MỘT học phần nguyên (12) + lẻ 7 không tính
  });

  it("[LB-05] học phần khác cỡ: mốc nguyên theo CỠ của từng học phần", () => {
    const le: HocPhanKhoa[] = [
      { moduleCode: "HP1", soBuoi: 16, luotBu: 1 },
      { moduleCode: "HP2", soBuoi: 8, luotBu: 1 },
    ];
    expect(soHocPhanDangKy(le, 0, 20)).toBe(1); // lẻ 4 < HP2 (8) ⇒ không tính
    expect(soHocPhanDangKy(le, 0, 21)).toBe(1); // lẻ 5 < HP2 (8) ⇒ vẫn không tính (mốc nguyên)
    expect(soHocPhanDangKy(le, 0, 24)).toBe(2);
  });

  it("[LB-06] dữ liệu rác: số buổi âm / NaN / khoá rỗng ⇒ 0, không ném", () => {
    expect(soHocPhanDangKy(SATA4, 0, -5)).toBe(0);
    expect(soHocPhanDangKy(SATA4, 0, Number.NaN)).toBe(0);
    expect(soHocPhanDangKy([], 0, 48)).toBe(0);
    expect(soHocPhanDangKy(SATA4, 9, 48)).toBe(0);
  });
});

describe("tongLuotBu — quỹ chung = Σ lượt của các học phần đã đăng ký", () => {
  it("[LB-07] mặc định 1 lượt/học phần ⇒ tổng = số học phần", () => {
    expect(tongLuotBu({ hocPhan: SATA4, viTriBatDau: 0, soBuoiMua: 39, choPhepHocBu: true })).toBe(3);
  });

  it("[LB-08] cộng ĐÚNG lượt đã cấu hình của những học phần được tính", () => {
    const cauHinh = SATA4.map((h, i) => ({ ...h, luotBu: i + 1 })); // 1,2,3,4
    expect(tongLuotBu({ hocPhan: cauHinh, viTriBatDau: 0, soBuoiMua: 24, choPhepHocBu: true })).toBe(3);
    expect(tongLuotBu({ hocPhan: cauHinh, viTriBatDau: 2, soBuoiMua: 24, choPhepHocBu: true })).toBe(7);
  });

  it("[LB-09] khoá tắt học bù (Sata 8) ⇒ 0 dù mua bao nhiêu", () => {
    expect(tongLuotBu({ hocPhan: SATA4, viTriBatDau: 0, soBuoiMua: 48, choPhepHocBu: false })).toBe(0);
  });
});

describe("conLuotBu", () => {
  it("[LB-10] còn = tổng − đã dùng, không âm", () => {
    expect(conLuotBu(3, 1)).toBe(2);
    expect(conLuotBu(3, 3)).toBe(0);
    expect(conLuotBu(1, 4)).toBe(0);
  });
});
