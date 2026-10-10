/**
 * Ca [DC-*] — ô địa chỉ 2 cấp của hồ sơ học viên CHỈ dùng danh mục MỚI [ĐẢO 26/09/2026].
 *
 * Chủ dự án 26/09: "phải lấy danh sách địa chỉ tỉnh/tp, phường/xã mới, không lấy thông tin cũ
 * nữa". Bản 25/09 giữ tên đang lưu thành option tạm "(dữ liệu cũ)"; nay tên cũ được DỊCH sang
 * danh mục mới khi dịch được tất định, không thì ô TRỐNG.
 */
import { describe, expect, it } from "vitest";
import { diaChiCanChonLai, phuongBanDau, tenTinhTuGiaTri, tinhBanDau } from "./dia-chi";

// Nhãn giống hệt gói `vietnam-address-data` (tiền tố "Tp" viết thường chữ p).
const TINH = [
  { value: "48", label: "Tp Đà Nẵng" },
  { value: "01", label: "Hà Nội" },
  { value: "79", label: "Tp Hồ Chí Minh" },
  { value: "46", label: "Huế" },
];

describe("tinhBanDau — tên tỉnh đang lưu → mã trong danh mục MỚI", () => {
  it("[DC-01] khớp y hệt ⇒ đúng mã", () => {
    expect(tinhBanDau(TINH, "Tp Đà Nẵng")).toBe("48");
    expect(tinhBanDau(TINH, "Hà Nội")).toBe("01");
  });

  it("[DC-02] tên kiểu cũ ('TP', 'Thành phố', không tiền tố, không dấu) ⇒ vẫn đúng mã", () => {
    for (const ten of ["Đà Nẵng", "TP Đà Nẵng", "TP. Đà Nẵng", "Thành phố Đà Nẵng", "da nang"]) {
      expect(tinhBanDau(TINH, ten), ten).toBe("48");
    }
    expect(tinhBanDau(TINH, "TP.HCM")).toBe("79");
    expect(tinhBanDau(TINH, "Hồ Chí Minh")).toBe("79");
  });

  it("[DC-03] tỉnh đã SÁP NHẬP ⇒ tỉnh nhận sáp nhập", () => {
    expect(tinhBanDau(TINH, "Quảng Nam")).toBe("48");
    expect(tinhBanDau(TINH, "Tỉnh Bình Dương")).toBe("79");
    expect(tinhBanDau(TINH, "Thừa Thiên Huế")).toBe("46");
  });

  it("[DC-04] không nhận ra ⇒ null (không đoán), trống ⇒ null", () => {
    for (const v of [null, undefined, "", "   ", "Đà Lạt", "Hải Châu"]) {
      expect(tinhBanDau(TINH, v), String(v)).toBeNull();
    }
    expect(tenTinhTuGiaTri(TINH, null)).toBe("");
    // Lưu xuống đúng TÊN danh mục, không phải chuỗi cũ.
    expect(tenTinhTuGiaTri(TINH, tinhBanDau(TINH, "Đà Nẵng"))).toBe("Tp Đà Nẵng");
  });
});

describe("phuongBanDau — phường đang lưu → tên trong danh mục MỚI của tỉnh", () => {
  const PHUONG = [
    { value: "Phường Hải Châu", label: "Phường Hải Châu" },
    { value: "Phường Thanh Khê", label: "Phường Thanh Khê" },
    { value: "Xã Hòa Vang", label: "Xã Hòa Vang" },
  ];

  it("[DC-05] y hệt / viết tắt tiền tố ⇒ đúng tên danh mục", () => {
    expect(phuongBanDau(PHUONG, "Phường Hải Châu")).toBe("Phường Hải Châu");
    expect(phuongBanDau(PHUONG, "P. Hải Châu")).toBe("Phường Hải Châu");
    expect(phuongBanDau(PHUONG, "hai chau")).toBe("Phường Hải Châu");
    expect(phuongBanDau(PHUONG, "X. Hòa Vang")).toBe("Xã Hòa Vang");
  });

  it("[DC-06] phường KHÔNG còn trong danh mục mới (đã sáp nhập) ⇒ '' — không in tên cũ", () => {
    expect(phuongBanDau(PHUONG, "Phường Phước Ninh")).toBe("");
    expect(phuongBanDau([], "Phường Hải Châu")).toBe("");
    expect(phuongBanDau(PHUONG, null)).toBe("");
  });

  it("[DC-07] hai mục cùng khoá sau khi bỏ tiền tố ⇒ KHÔNG đoán", () => {
    const TRUNG = [
      { value: "Phường Hòa Khánh", label: "Phường Hòa Khánh" },
      { value: "Xã Hòa Khánh", label: "Xã Hòa Khánh" },
    ];
    expect(phuongBanDau(TRUNG, "Hòa Khánh")).toBe("");
    // Đối chứng dương: gõ đủ tiền tố thì vẫn khớp y hệt.
    expect(phuongBanDau(TRUNG, "Xã Hòa Khánh")).toBe("Xã Hòa Khánh");
  });
});

describe("diaChiCanChonLai — dòng nhắc chọn lại", () => {
  it("[DC-08] nhắc đúng phần không dịch được; không nhắc khi trống hoặc dịch được", () => {
    expect(
      diaChiCanChonLai({ cityDangLuu: "Đà Lạt", wardDangLuu: "P1", maTinh: null, phuong: "" }),
    ).toEqual({ tinh: true, phuong: true });
    expect(
      diaChiCanChonLai({
        cityDangLuu: "Đà Nẵng",
        wardDangLuu: "Phường Phước Ninh",
        maTinh: "48",
        phuong: "",
      }),
    ).toEqual({ tinh: false, phuong: true });
    expect(
      diaChiCanChonLai({ cityDangLuu: "", wardDangLuu: null, maTinh: null, phuong: "" }),
    ).toEqual({ tinh: false, phuong: false });
  });
});
