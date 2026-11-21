// Ca [HSQ-*] — ghép em trên form QR với hồ sơ học viên (09/11/2026). Luật thuần, không DB.
import { describe, expect, it } from "vitest";
import { ghepEmVoiHoSo, khoaTen, khoaTenKhongDau } from "./ghep-em-voi-ho-so";

const hs = (...ten: string[]) => ten.map((name, i) => ({ name, id: `h${i}` }));

describe("[HSQ-01] chuẩn hoá tên", () => {
  it("NFC + thường hoá tiếng Việt + gộp khoảng trắng; không dấu bỏ dấu và đ→d", () => {
    expect(khoaTen("  Trần   Văn  BÉ ")).toBe("trần văn bé");
    expect(khoaTenKhongDau("Đặng Thị Ngọc")).toBe("dang thi ngoc");
    // NFD (dấu rời) và NFC (dấu liền) của cùng một tên ⇒ cùng khoá
    expect(khoaTen("Be\u0301")).toBe(khoaTen("B\u00e9"));
  });
});

describe("[HSQ-02] ghép em ↔ hồ sơ", () => {
  it("khớp ĐÚNG tên (không phân biệt hoa thường, khoảng trắng) ⇒ ghép", () => {
    const r = ghepEmVoiHoSo("  bé  hai ", hs("Bé Hai", "Bé Ba"));
    expect(r.hoSo?.id).toBe("h0");
  });
  it("không khớp đúng nhưng khớp KHÔNG DẤU và DUY NHẤT ⇒ ghép; không dấu mà có HAI hồ sơ ⇒ mơ hồ, KHÔNG ghép", () => {
    expect(ghepEmVoiHoSo("Be Hai", hs("Bé Hai", "Bé Ba")).hoSo?.id).toBe("h0");
    const mo = ghepEmVoiHoSo("Be Hai", hs("Bé Hai", "Bê Hai"));
    expect(mo.hoSo).toBeNull();
    expect("moHo" in mo && mo.moHo).toBe(true);
  });
  it("hai hồ sơ ĐÚNG tên ⇒ mơ hồ (không đoán); không hồ sơ nào ⇒ không khớp (không phải mơ hồ)", () => {
    const mo = ghepEmVoiHoSo("Bé Hai", hs("Bé Hai", "Bé Hai"));
    expect(mo.hoSo).toBeNull();
    expect("moHo" in mo && mo.moHo).toBe(true);
    const khong = ghepEmVoiHoSo("Bé Tư", hs("Bé Hai"));
    expect(khong.hoSo).toBeNull();
    expect("moHo" in khong && khong.moHo).toBe(false);
  });
  it("khớp đúng tên ƯU TIÊN hơn khớp không dấu (không bị một hồ sơ khác tên-không-dấu làm mơ hồ)", () => {
    expect(ghepEmVoiHoSo("Bé Hai", hs("Bé Hai", "Be Hai")).hoSo?.id).toBe("h0");
  });
});
