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
    // Khung thương hiệu có thẻ <img> của logo — nên không còn cấm mọi "<img", chỉ cấm THẺ DO NGƯỜI GÕ.
    expect(e.bodyHtml).not.toContain("<img src=x");
    expect(e.bodyHtml).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(e.bodyHtml.match(/<img /g)).toHaveLength(1); // đúng MỘT ảnh: logo
  });

  it("cú pháp biến `{{…}}` trong tên người mua bị vô hiệu (worker còn chạy renderTemplate)", () => {
    const e = noiDungEmailHoaDon({ ...T, tenNguoiMua: "An {{password}}" });
    expect(e.bodyText).not.toContain("{{password}}");
    expect(e.bodyHtml).not.toContain("{{password}}");
  });
});

describe("[NDE-03] khung thương hiệu Sata Robo (09/11/2026)", () => {
  const e = noiDungEmailHoaDon(T);
  it("thân HTML là một tài liệu hoàn chỉnh có logo tuyệt đối + alt, dải màu cam thương hiệu, và chân thư liên hệ", () => {
    expect(e.bodyHtml.startsWith("<!doctype html>")).toBe(true);
    expect(e.bodyHtml).toContain('src="https://satarobo.vn/brand/logo-satarobo.png"');
    expect(e.bodyHtml).toContain('alt="Sata Robo"');
    // Logo đã có chữ SATA ROBO ⇒ đầu thư KHÔNG in thêm tên bằng chữ cạnh logo (trùng — chủ dự án 09/11/2026).
    expect(e.bodyHtml).not.toMatch(/>Sata Robo<\/div>/);
    expect(e.bodyHtml).toContain("#F97316");
    expect(e.bodyHtml).toContain("Cần hỗ trợ? Liên hệ Sata Robo");
    expect(e.bodyHtml).toContain("0837.312.860");
    expect(e.bodyHtml).toContain("satarobo.vn");
    expect(e.bodyHtml).toContain("gửi tự động");
  });
  it("email-safe: không dùng thẻ <style> / <script> / CSS flex-grid (client thư bỏ hoặc cắt); khoá chế độ sáng", () => {
    expect(e.bodyHtml).not.toMatch(/<style|<script|display:\s*(flex|grid)/i);
    expect(e.bodyHtml).toContain('name="color-scheme" content="light"');
  });
  it("preheader (dòng xem trước ở hộp thư) nói số hoá đơn + số tiền", () => {
    expect(e.bodyHtml).toMatch(/display:none[^>]*>Hoá đơn điện tử 1C26TSR - 127 — 3\.000\.000 đồng/);
  });
  it("bản chữ thuần cũng có chân thư; chân thư KHÔNG in địa chỉ / mã số doanh nghiệp (người bán là pháp nhân của tờ hoá đơn)", () => {
    expect(e.bodyText).toContain("Điện thoại / Zalo: 0837.312.860");
    expect(e.bodyText).toContain("gửi tự động");
    expect(e.bodyText + e.bodyHtml).not.toMatch(/0402301783|Lê Thanh Nghị|Nguyễn Hữu Thọ/);
  });
  it("số tiền còn nguyên dạng N.NNN.NNN đồng trong ô nổi bật; thân HTML không còn {{ }} lạ (worker còn chạy renderTemplate)", () => {
    expect(e.bodyHtml).toContain("3.000.000 đồng");
    expect(e.bodyHtml).not.toMatch(/\{\{|\}\}/);
  });
});
