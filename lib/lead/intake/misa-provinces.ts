// SINH TỰ ĐỘNG từ danh sách <option> (select `ShippingProvinceID`) của biểu mẫu
// tĩnh `public/sale/nhap-lieu.html` — file đó đã XOÁ 22/08/2026 cùng biểu mẫu;
// cần dựng lại bảng này thì lấy trong lịch sử git.
// Đây là bảng mã tỉnh PHÍA MISA, không phải mã hành chính VN.
// Chỉ dùng để đổi id thành tên người đọc được khi ghi vào `Lead.note`.
// Danh sách 63 tỉnh CŨ (trước sáp nhập 07/2025) vì form MISA vẫn đang dùng bản đó.

export const MISA_PROVINCE_BY_ID: Readonly<Record<string, string>> = {
  231: "Hà Nội",
  863: "Hải Phòng",
  1102: "Hải Dương",
  1380: "Hưng Yên",
  1552: "Hà Nam",
  1675: "Nam Định",
  1915: "Thái Bình",
  2210: "Ninh Bình",
  2366: "Hà Giang",
  2577: "Cao Bằng",
  2788: "Lào Cai",
  2962: "Bắc Kạn",
  3093: "Lạng Sơn",
  3331: "Tuyên Quang",
  3484: "Yên Bái",
  3674: "Thái Nguyên",
  3864: "Phú Thọ",
  4155: "Vĩnh Phúc",
  4302: "Bắc Giang",
  4544: "Bắc Ninh",
  4679: "Quảng Ninh",
  4880: "Điện Biên",
  5002: "Lai Châu",
  5108: "Sơn La",
  5326: "Hòa Bình",
  5557: "Thanh Hóa",
  6223: "Nghệ An",
  6723: "Hà Tĩnh",
  6998: "Quảng Bình",
  7165: "Quảng Trị",
  7318: "Huế",
  7480: "Đà Nẵng",
  7547: "Quảng Nam",
  7808: "Quảng Ngãi",
  8007: "Bình Định",
  8178: "Phú Yên",
  8301: "Khánh Hòa",
  8448: "Kon Tum",
  8555: "Gia Lai",
  8793: "Đắk Lắk",
  8999: "Đắk Nông",
  9081: "Hồ Chí Minh",
  9428: "Lâm Đồng",
  9589: "Ninh Thuận",
  9668: "Bình Phước",
  9791: "Tây Ninh",
  9896: "Bình Dương",
  9995: "Đồng Nai",
  10182: "Bình Thuận",
  10320: "Bà Rịa - Vũng Tàu",
  10412: "Long An",
  10617: "Đồng Tháp",
  10774: "An Giang",
  10943: "Tiền Giang",
  11123: "Vĩnh Long",
  11239: "Bến Tre",
  11413: "Kiên Giang",
  11578: "Cần Thơ",
  11673: "Hậu Giang",
  11754: "Trà Vinh",
  11868: "Sóc Trăng",
  11989: "Bạc Liêu",
  12061: "Cà Mau",
};

/** Đổi mã tỉnh MISA → tên. Mã lạ/rỗng ⇒ null (không đoán). */
export function misaProvinceName(id: unknown): string | null {
  const k = String(id ?? "").trim();
  return k ? (MISA_PROVINCE_BY_ID[k] ?? null) : null;
}
