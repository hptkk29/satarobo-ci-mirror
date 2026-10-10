// [GT] — nhãn + phép dịch giới tính dùng chung cho hồ sơ học viên (25/09/2026). THUẦN.
import { describe, it, expect } from "vitest";
import { GIOI_TINH_OPTIONS, NHAN_GIOI_TINH, gioiTinhTuChuoi, nhanGioiTinh } from "./gioi-tinh";

describe("[GT] giới tính", () => {
  it("[GT-01] nhãn enum; null/giá trị lạ ⇒ null", () => {
    expect(nhanGioiTinh("MALE")).toBe("Nam");
    expect(nhanGioiTinh("FEMALE")).toBe("Nữ");
    expect(nhanGioiTinh("OTHER")).toBe("Khác");
    expect(nhanGioiTinh(null)).toBeNull();
    expect(nhanGioiTinh("")).toBeNull();
    expect(nhanGioiTinh("Nam")).toBeNull();
    // `in` trên object thường khớp cả khoá của prototype — không được ra nhãn giả.
    expect(nhanGioiTinh("toString")).toBeNull();
  });

  it("[GT-02] options khớp bảng nhãn (một nguồn)", () => {
    expect(GIOI_TINH_OPTIONS.map((o) => [o.value, o.label])).toEqual(Object.entries(NHAN_GIOI_TINH));
  });

  it("[GT-03] chuỗi tự do → enum: hoa/thường, có/không dấu, NFD, khoảng trắng", () => {
    expect(gioiTinhTuChuoi("Nam")).toBe("MALE");
    expect(gioiTinhTuChuoi(" nam ")).toBe("MALE");
    expect(gioiTinhTuChuoi("male")).toBe("MALE");
    expect(gioiTinhTuChuoi("Nữ")).toBe("FEMALE");
    expect(gioiTinhTuChuoi("Nữ".normalize("NFD"))).toBe("FEMALE");
    expect(gioiTinhTuChuoi("NU")).toBe("FEMALE");
    expect(gioiTinhTuChuoi("Khác")).toBe("OTHER");
    expect(gioiTinhTuChuoi("khac")).toBe("OTHER");
  });

  it("[GT-04] không nhận ra ⇒ null, KHÔNG đoán", () => {
    expect(gioiTinhTuChuoi("bé gái")).toBeNull();
    expect(gioiTinhTuChuoi("")).toBeNull();
    expect(gioiTinhTuChuoi(null)).toBeNull();
    expect(gioiTinhTuChuoi(undefined)).toBeNull();
    expect(gioiTinhTuChuoi("Nam nữ")).toBeNull();
  });
});
