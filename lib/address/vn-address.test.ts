/**
 * G-01 — ô địa chỉ hành chính của lead. Ba hàm thuần, không đụng dữ liệu.
 *
 * Vì sao phải có test riêng cho mấy dòng map tưởng-như-hiển-nhiên: ô địa chỉ lưu
 * TÊN (chuỗi), còn picker chạy bằng MÃ. Mọi lần mở lại phiếu là một lần dịch
 * tên → mã. Dịch trượt thì `<Combobox>` không khớp option nào, tụt về rỗng, và
 * lần bấm Lưu kế tiếp XOÁ TRẮNG địa chỉ đúng — hỏng câm, không lỗi, không nhật
 * ký. Đây đúng là lỗi đã xảy ra ở ô "Cơ sở quan tâm" (V-4 · G-01b, vá 25/08).
 */
import { describe, it, expect } from "vitest";
import { getWardsByProvince, provinces as vnProvinces } from "vietnam-address-data";
import {
  toAddressOptions,
  toNameOptions,
  provinceIdByName,
  formatVnAddress,
  maTinhMoi,
  tenPhuongMoi,
} from "./vn-address";

const TINH = [
  { id: "01", name: "Hà Nội" },
  { id: "48", name: "Đà Nẵng" },
  { id: "79", name: "Hồ Chí Minh" },
];

describe("[G-01] toAddressOptions", () => {
  it("đổi danh mục tỉnh/phường sang option của Combobox (value = mã, label = tên)", () => {
    expect(toAddressOptions(TINH)).toEqual([
      { value: "01", label: "Hà Nội" },
      { value: "48", label: "Đà Nẵng" },
      { value: "79", label: "Hồ Chí Minh" },
    ]);
  });

  it("danh sách rỗng → mảng rỗng, không ném lỗi", () => {
    expect(toAddressOptions([])).toEqual([]);
  });
});

describe("[G-01] toNameOptions — ô phường/xã lưu TÊN, không lưu mã", () => {
  const PHUONG = [
    { id: "48001001", name: "Phường Hải Châu" },
    { id: "48001002", name: "Phường Thanh Khê" },
  ];

  it("value CHÍNH LÀ tên → thứ Combobox trả về ghi thẳng xuống `Lead.ward` được", () => {
    // Nếu value là mã, cột `ward` (vốn để chứa TÊN) sẽ nhận "48001001". Không lỗi,
    // không cảnh báo — chỉ là mọi báo cáo theo địa bàn in ra một dãy số.
    expect(toNameOptions(PHUONG)).toEqual([
      { value: "Phường Hải Châu", label: "Phường Hải Châu" },
      { value: "Phường Thanh Khê", label: "Phường Thanh Khê" },
    ]);
  });

  it("KHÁC toAddressOptions — hai hàm không thay nhau được", () => {
    expect(toAddressOptions(PHUONG)[0]?.value).toBe("48001001");
    expect(toNameOptions(PHUONG)[0]?.value).toBe("Phường Hải Châu");
  });
});

describe("[G-01] provinceIdByName — mở lại phiếu phải chọn đúng tỉnh cũ", () => {
  it("tên khớp y hệt → trả mã", () => {
    expect(provinceIdByName(TINH, "Đà Nẵng")).toBe("48");
  });

  it("thừa khoảng trắng hai đầu → vẫn khớp (người nhập/nhập Excel hay dính)", () => {
    expect(provinceIdByName(TINH, "  Đà Nẵng ")).toBe("48");
  });

  it("mất dấu / khác hoa-thường → vẫn khớp, KHÔNG bỏ trắng phiếu cũ", () => {
    // Dữ liệu cũ bóc từ `Lead.note` (nợ N-1) và dữ liệu nhập Excel rất hay mất
    // dấu. Trả null ở đây nghĩa là mở phiếu ra thấy ô tỉnh trống, rồi bấm Lưu
    // là mất luôn địa chỉ thật.
    expect(provinceIdByName(TINH, "da nang")).toBe("48");
    expect(provinceIdByName(TINH, "HO CHI MINH")).toBe("79");
  });

  it("tên lạ / null / rỗng → null (không đoán bừa một tỉnh gần đúng)", () => {
    expect(provinceIdByName(TINH, "Xứ Wales")).toBeNull();
    expect(provinceIdByName(TINH, null)).toBeNull();
    expect(provinceIdByName(TINH, "")).toBeNull();
    expect(provinceIdByName(TINH, "   ")).toBeNull();
  });
});

describe("[G-01] formatVnAddress — dòng địa chỉ ở trang chi tiết", () => {
  it("đủ ba mẩu → ghép theo thứ tự hẹp → rộng", () => {
    expect(
      formatVnAddress({ addressLine: "12 Lê Lợi", ward: "Phường Hải Châu", city: "Đà Nẵng" }),
    ).toBe("12 Lê Lợi, Phường Hải Châu, Đà Nẵng");
  });

  it("thiếu mẩu giữa → không đẻ dấu phẩy mồ côi", () => {
    expect(formatVnAddress({ addressLine: "12 Lê Lợi", ward: null, city: "Đà Nẵng" })).toBe(
      "12 Lê Lợi, Đà Nẵng",
    );
  });

  it("chỉ có tỉnh → vẫn hiện được (lead mới thu về thường chỉ có chừng đó)", () => {
    expect(formatVnAddress({ addressLine: null, ward: null, city: "Đà Nẵng" })).toBe("Đà Nẵng");
  });

  it("trống hết (kể cả chuỗi rỗng/khoảng trắng) → null để trang chi tiết ẩn hẳn ô", () => {
    expect(formatVnAddress({ addressLine: null, ward: null, city: null })).toBeNull();
    expect(formatVnAddress({ addressLine: "", ward: "  ", city: "" })).toBeNull();
  });
});

// ─── 26/09/2026 — tên CŨ → danh mục MỚI, đo trên DỮ LIỆU THẬT của gói ─────────────────────
// Không dựng danh mục giả ở đây: lưới phải canh đúng thứ chạy trên màn — 34 tỉnh của gói
// `vietnam-address-data`. Gói đổi tên một tỉnh ("Tp Đà Nẵng" → "Thành phố Đà Nẵng") thì
// lưới này đỏ, và đó đúng là lúc phải biết.
describe("[VNA-TM] maTinhMoi — 63 tỉnh CŨ đều dịch được sang đúng tỉnh MỚI", () => {
  // 63 tỉnh/thành trước 01/07/2025 → tỉnh nhận (Nghị quyết 202/2025/QH15).
  const CU_SANG_MOI: [string, string][] = [
    ["Hà Nội", "Hà Nội"], ["Huế", "Huế"], ["Thừa Thiên Huế", "Huế"], ["Lai Châu", "Lai Châu"],
    ["Điện Biên", "Điện Biên"], ["Sơn La", "Sơn La"], ["Lạng Sơn", "Lạng Sơn"],
    ["Quảng Ninh", "Quảng Ninh"], ["Thanh Hóa", "Thanh Hóa"], ["Nghệ An", "Nghệ An"],
    ["Hà Tĩnh", "Hà Tĩnh"], ["Cao Bằng", "Cao Bằng"],
    ["Tuyên Quang", "Tuyên Quang"], ["Hà Giang", "Tuyên Quang"],
    ["Lào Cai", "Lào Cai"], ["Yên Bái", "Lào Cai"],
    ["Thái Nguyên", "Thái Nguyên"], ["Bắc Kạn", "Thái Nguyên"],
    ["Phú Thọ", "Phú Thọ"], ["Vĩnh Phúc", "Phú Thọ"], ["Hòa Bình", "Phú Thọ"],
    ["Bắc Ninh", "Bắc Ninh"], ["Bắc Giang", "Bắc Ninh"],
    ["Hưng Yên", "Hưng Yên"], ["Thái Bình", "Hưng Yên"],
    ["Hải Phòng", "Tp Hải Phòng"], ["Hải Dương", "Tp Hải Phòng"],
    ["Ninh Bình", "Ninh Bình"], ["Hà Nam", "Ninh Bình"], ["Nam Định", "Ninh Bình"],
    ["Quảng Trị", "Quảng Trị"], ["Quảng Bình", "Quảng Trị"],
    ["Đà Nẵng", "Tp Đà Nẵng"], ["Quảng Nam", "Tp Đà Nẵng"],
    ["Quảng Ngãi", "Quảng Ngãi"], ["Kon Tum", "Quảng Ngãi"],
    ["Gia Lai", "Gia Lai"], ["Bình Định", "Gia Lai"],
    ["Khánh Hòa", "Khánh Hòa"], ["Ninh Thuận", "Khánh Hòa"],
    ["Lâm Đồng", "Lâm Đồng"], ["Đắk Nông", "Lâm Đồng"], ["Bình Thuận", "Lâm Đồng"],
    ["Đắk Lắk", "Đắk Lắk"], ["Phú Yên", "Đắk Lắk"],
    ["Hồ Chí Minh", "Tp Hồ Chí Minh"], ["Bình Dương", "Tp Hồ Chí Minh"],
    ["Bà Rịa - Vũng Tàu", "Tp Hồ Chí Minh"],
    ["Đồng Nai", "Đồng Nai"], ["Bình Phước", "Đồng Nai"],
    ["Tây Ninh", "Tây Ninh"], ["Long An", "Tây Ninh"],
    ["Cần Thơ", "Tp Cần Thơ"], ["Sóc Trăng", "Tp Cần Thơ"], ["Hậu Giang", "Tp Cần Thơ"],
    ["Vĩnh Long", "Vĩnh Long"], ["Bến Tre", "Vĩnh Long"], ["Trà Vinh", "Vĩnh Long"],
    ["Đồng Tháp", "Đồng Tháp"], ["Tiền Giang", "Đồng Tháp"],
    ["Cà Mau", "Cà Mau"], ["Bạc Liêu", "Cà Mau"],
    ["An Giang", "An Giang"], ["Kiên Giang", "An Giang"],
  ];

  it("gói có đúng 34 tỉnh/thành", () => {
    expect(vnProvinces).toHaveLength(34);
  });

  it("mỗi tỉnh cũ (kể cả kèm tiền tố 'Tỉnh'/'TP.') dịch ra ĐÚNG tỉnh nhận", () => {
    const tenCua = (id: string | null) => vnProvinces.find((p) => p.id === id)?.name ?? null;
    for (const [cu, moi] of CU_SANG_MOI) {
      expect(tenCua(maTinhMoi(vnProvinces, cu)), cu).toBe(moi);
      expect(tenCua(maTinhMoi(vnProvinces, `Tỉnh ${cu}`)), `Tỉnh ${cu}`).toBe(moi);
      expect(tenCua(maTinhMoi(vnProvinces, `TP. ${cu}`)), `TP. ${cu}`).toBe(moi);
    }
  });

  it("tên không phải tỉnh ⇒ null (không đoán)", () => {
    for (const v of ["Đà Lạt", "Hải Châu", "Xứ Wales", "", null]) {
      expect(maTinhMoi(vnProvinces, v), String(v)).toBeNull();
    }
  });
});

describe("[VNA-TP] tenPhuongMoi — phường/xã trong danh mục mới của đúng tỉnh", () => {
  it("khớp theo tên sau khi bỏ tiền tố, chỉ khi DUY NHẤT", () => {
    const dn = maTinhMoi(vnProvinces, "Đà Nẵng")!;
    const phuong = getWardsByProvince(dn);
    expect(phuong.length).toBeGreaterThan(0);
    const mot = phuong[0]!;
    expect(tenPhuongMoi(phuong, mot.name)).toBe(mot.name);
    const trongKhoa = mot.name.replace(/^(Phường|Xã|Đặc khu)\s+/, "");
    const cungKhoa = phuong.filter((w) => w.name.endsWith(trongKhoa));
    if (cungKhoa.length === 1) expect(tenPhuongMoi(phuong, trongKhoa)).toBe(mot.name);
    expect(tenPhuongMoi(phuong, "Phường Không Tồn Tại")).toBeNull();
    expect(tenPhuongMoi(phuong, null)).toBeNull();
  });
});
