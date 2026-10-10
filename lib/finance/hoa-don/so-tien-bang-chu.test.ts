// Ca [SBC-*] — "Số tiền viết bằng chữ". Ba ca đầu là BA TỜ HOÁ ĐƠN THẬT, chép nguyên văn
// chuỗi in trên giấy (E:\websatarobo data\hoadon).
import { describe, it, expect } from "vitest";
import { soTienBangChu } from "@/lib/finance/hoa-don/so-tien-bang-chu";

describe("[SBC-01] ba tờ hoá đơn thật — chuỗi phải TRÙNG chữ in trên giấy", () => {
  it("1C26TSR-86 · 2.000.000", () => {
    expect(soTienBangChu(2_000_000)).toBe("Hai triệu đồng.");
  });
  it("1C26TSR-127 · 4.320.000", () => {
    expect(soTienBangChu(4_320_000)).toBe(
      "Bốn triệu ba trăm hai mươi nghìn đồng.",
    );
  });
  it("1C26MNV-13 · 8.976.000", () => {
    expect(soTienBangChu(8_976_000)).toBe(
      "Tám triệu chín trăm bảy mươi sáu nghìn đồng.",
    );
  });
});

describe("[SBC-02] mươi / mốt / lăm — chỗ bản viết vội sai", () => {
  it("10 là 'mười', không phải 'một mươi'", () => {
    expect(soTienBangChu(10)).toBe("Mười đồng.");
  });
  it("15 là 'mười lăm'", () => {
    expect(soTienBangChu(15)).toBe("Mười lăm đồng.");
  });
  it("21 là 'hai mươi mốt', không phải 'hai mươi một'", () => {
    expect(soTienBangChu(21)).toBe("Hai mươi mốt đồng.");
  });
  it("25 là 'hai mươi lăm'", () => {
    expect(soTienBangChu(25)).toBe("Hai mươi lăm đồng.");
  });
});

describe("[SBC-03] 'lẻ' và nhóm 0 ở GIỮA — bẫy chỉ lộ ra ở số LẺ", () => {
  it("105 là 'một trăm lẻ năm'", () => {
    expect(soTienBangChu(105)).toBe("Một trăm lẻ năm đồng.");
  });

  it("1.000.005 phải đọc cả nhóm nghìn bằng 0", () => {
    // Bỏ nhóm 0 ở giữa thì ra "một triệu năm" — trong cách nói thường ngày đó là
    // 1.500.000. Đây là bẫy đắt nhất và nó KHÔNG lộ ra với học phí số tròn.
    expect(soTienBangChu(1_000_005)).toBe(
      "Một triệu không trăm lẻ năm đồng.",
    );
  });

  it("1.005.000 — nhóm nghìn có chữ, đọc 'không trăm lẻ năm nghìn'", () => {
    expect(soTienBangChu(1_005_000)).toBe(
      "Một triệu không trăm lẻ năm nghìn đồng.",
    );
  });

  it("nhóm 0 ở ĐUÔI thì bỏ, không đọc thừa", () => {
    expect(soTienBangChu(2_000_000)).toBe("Hai triệu đồng.");
    expect(soTienBangChu(5_000)).toBe("Năm nghìn đồng.");
  });
});

describe("[SBC-04] biên", () => {
  it("0 đồng", () => {
    expect(soTienBangChu(0)).toBe("Không đồng.");
  });
  it("số âm coi như 0 — hoá đơn không có số âm", () => {
    expect(soTienBangChu(-5)).toBe("Không đồng.");
  });
  it("hàng tỷ", () => {
    expect(soTienBangChu(1_234_567_890)).toBe(
      "Một tỷ hai trăm ba mươi bốn triệu năm trăm sáu mươi bảy nghìn tám trăm chín mươi đồng.",
    );
  });
});
