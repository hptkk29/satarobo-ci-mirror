// Ca [NDE-*] — nội dung email gửi hoá đơn điện tử (PLAN §7). Chữ người gõ phải được escape.
import { describe, expect, it } from "vitest";
import { noiDungEmailHoaDon, type ThongTinEmailHoaDon } from "./noi-dung-email";

const T: ThongTinEmailHoaDon = {
  tenNguoiMua: "Nguyễn Văn An",
  phapNhanTen: "Công ty CP Sata Robo",
  kyHieu: "1C26TSR",
  soHoaDon: "127",
  ngayPhatHanh: "2026-09-20",
  tongTien: 3_000_000,
  maDon: "ORD-260920-000001",
  coXml: false,
};

describe("[NDE-01] nội dung đủ số hoá đơn, số tiền, mã đơn", () => {
  it("tiêu đề + thân chữ + thân HTML cùng nói một chuyện", () => {
    const e = noiDungEmailHoaDon(T);
    expect(e.subject).toBe("Hoá đơn điện tử 1C26TSR - 127 — Công ty CP Sata Robo");
    for (const than of [e.bodyText, e.bodyHtml]) {
      expect(than).toContain("1C26TSR - 127");
      expect(than).toContain("20/09/2026");
      expect(than).toContain("3.000.000 đồng");
      expect(than).toContain("ORD-260920-000001");
      expect(than).toContain("Nguyễn Văn An");
    }
    expect(e.bodyText).toContain("(tệp PDF)");
    expect(noiDungEmailHoaDon({ ...T, coXml: true }).bodyText).toContain("tệp PDF và tệp XML");
  });

  it("không tên người mua ⇒ lời chào chung, không 'Kính gửi ,'", () => {
    expect(noiDungEmailHoaDon({ ...T, tenNguoiMua: null }).bodyText).toMatch(/^Kính gửi Quý phụ huynh,/);
  });
});

describe("[NDE-02] chữ NGƯỜI GÕ không được thành mã", () => {
  it("thẻ HTML trong tên người mua bị escape trong thân HTML", () => {
    const e = noiDungEmailHoaDon({ ...T, tenNguoiMua: '<img src=x onerror="alert(1)">' });
    expect(e.bodyHtml).not.toContain("<img");
    expect(e.bodyHtml).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("cú pháp biến `{{…}}` trong tên người mua bị vô hiệu (worker còn chạy renderTemplate)", () => {
    const e = noiDungEmailHoaDon({ ...T, tenNguoiMua: "An {{password}}" });
    expect(e.bodyText).not.toContain("{{password}}");
    expect(e.bodyHtml).not.toContain("{{password}}");
  });
});
