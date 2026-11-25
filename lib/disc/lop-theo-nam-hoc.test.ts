import { describe, expect, it } from "vitest";
import { bacHocTuNamSinh, namHocBatDauVN } from "./ho-so";

// Giờ VN = UTC+7. Ngày dưới đây ghi theo UTC giữa trưa nên cùng ngày ở VN.
const d = (iso: string) => new Date(`${iso}T05:00:00Z`);

describe("[LNH] lớp theo NĂM HỌC (bắt đầu tháng 9), không theo năm dương lịch", () => {
  it("[LNH-01] năm học bắt đầu tháng 9: 31/08 còn năm học trước, 01/09 sang năm học mới", () => {
    expect(namHocBatDauVN(d("2026-08-31"))).toBe(2025);
    expect(namHocBatDauVN(d("2026-09-01"))).toBe(2026);
    expect(namHocBatDauVN(d("2027-01-15"))).toBe(2026); // tháng 1/2027 vẫn năm học 2026–2027
    expect(namHocBatDauVN(d("2027-08-31"))).toBe(2026);
  });
  it("[LNH-02] sinh 2017: lớp 4 suốt năm học 2026–27 (kể cả 01/2027), lớp 5 từ 09/2027, lớp 6 từ 09/2028", () => {
    expect(bacHocTuNamSinh(2017, d("2026-11-01"))).toBe("4");
    expect(bacHocTuNamSinh(2017, d("2027-01-15"))).toBe("4");
    expect(bacHocTuNamSinh(2017, d("2027-08-31"))).toBe("4");
    expect(bacHocTuNamSinh(2017, d("2027-09-01"))).toBe("5");
    expect(bacHocTuNamSinh(2017, d("2028-09-01"))).toBe("6");
  });
  it("[LNH-03] đúng giờ VN ở biên: 31/08 23:30 giờ VN (16:30 UTC) vẫn là năm học cũ; 01/09 00:30 giờ VN (17:30 UTC 31/08) đã là năm học mới", () => {
    expect(namHocBatDauVN(new Date("2026-08-31T16:30:00Z"))).toBe(2025);
    expect(namHocBatDauVN(new Date("2026-08-31T17:30:00Z"))).toBe(2026);
  });
  it("[LNH-04] mầm non 3–5 tuổi; quá nhỏ/quá lớn ⇒ null để người dùng tự chọn", () => {
    expect(bacHocTuNamSinh(2021, d("2026-11-01"))).toBe("MN"); // lop = 0
    expect(bacHocTuNamSinh(2023, d("2026-11-01"))).toBe("MN"); // lop = -2
    expect(bacHocTuNamSinh(2024, d("2026-11-01"))).toBeNull();
    expect(bacHocTuNamSinh(2009, d("2026-11-01"))).toBe("12");
    expect(bacHocTuNamSinh(2005, d("2026-11-01"))).toBeNull();
    expect(bacHocTuNamSinh(Number.NaN, d("2026-11-01"))).toBeNull();
  });
});
