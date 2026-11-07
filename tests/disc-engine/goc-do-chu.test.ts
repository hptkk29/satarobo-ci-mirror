// PORT từ repo hodacphuchtc/DISC · tests/do-chu.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { describe, expect, it } from "vitest";

import {
  chuVuaKhung,
  ngatDong,
  ngatDongCoHan,
  thuCoChuVuaMotDong,
} from "@/lib/disc/engine-goc/modules/report/do-chu";

/**
 * Thước giả: mỗi ký tự rộng 10px.
 *
 * Dùng `[...chuoi]` chứ không dùng `.length` — `.length` đếm theo mã UTF-16, nên một
 * chữ tiếng Việt gõ kiểu tổ hợp (NFD) sẽ bị đếm thành 2. Thước giả phải đo giống mắt
 * người thì test mới nói lên điều gì.
 */
const thuoc = (chuoi: string) => [...chuoi.normalize("NFC")].length * 10;
const thuocTheoCo = (chuoi: string, co: number) => [...chuoi.normalize("NFC")].length * co;

describe("chuVuaKhung", () => {
  it("trả false khi chuỗi dài hơn khung", () => {
    expect(chuVuaKhung("Cẩn trọng", 200, thuoc)).toBe(true);
    expect(chuVuaKhung("Cẩn trọng", 50, thuoc)).toBe(false);
  });

  it("khung rộng 0 hoặc âm thì không gì vừa", () => {
    expect(chuVuaKhung("a", 0, thuoc)).toBe(false);
    expect(chuVuaKhung("a", -10, thuoc)).toBe(false);
  });

  it("chữ tiếng Việt gõ kiểu tổ hợp (NFD) đo ra ĐÚNG BẰNG kiểu dựng sẵn (NFC)", () => {
    const nfc = "Cẩn trọng".normalize("NFC");
    const nfd = "Cẩn trọng".normalize("NFD");
    expect(nfd).not.toBe(nfc); // hai chuỗi khác nhau về mã…
    expect(chuVuaKhung(nfd, 90, thuoc)).toBe(chuVuaKhung(nfc, 90, thuoc)); // …nhưng đo như nhau
  });
});

describe("ngatDong", () => {
  it("không cắt giữa một từ", () => {
    const dong = ngatDong("Rô Xung Phong bày cách chơi", 130, thuoc);
    for (const d of dong) expect(thuoc(d)).toBeLessThanOrEqual(130);
    expect(dong.join(" ")).toBe("Rô Xung Phong bày cách chơi");
  });

  it("chuỗi rỗng hoặc toàn khoảng trắng trả về mảng rỗng, không nổ", () => {
    expect(ngatDong("", 100, thuoc)).toEqual([]);
    expect(ngatDong("   \n  ", 100, thuoc)).toEqual([]);
  });

  it("gộp mọi khoảng trắng thừa thành một dấu cách", () => {
    expect(ngatDong("Chủ    động\n\nRô", 1000, thuoc)).toEqual(["Chủ động Rô"]);
  });

  it("từ đơn dài hơn cả khung thì để nguyên một dòng, KHÔNG cắt bừa", () => {
    const dai = "khongcodaucachnaotrongchuoinay";
    expect(ngatDong(dai, 50, thuoc)).toEqual([dai]);
    // Lớp gọi phải tự bắt ca này bằng chuVuaKhung:
    expect(chuVuaKhung(dai, 50, thuoc)).toBe(false);
  });

  it("NFD và NFC cho ra cùng một kết quả ngắt dòng", () => {
    const cau = "Con tôi soát lại bài trước khi nộp";
    expect(ngatDong(cau.normalize("NFD"), 150, thuoc)).toEqual(
      ngatDong(cau.normalize("NFC"), 150, thuoc),
    );
  });
});

describe("ngatDongCoHan", () => {
  it("thừa dòng thì cắt và báo biCat, dòng cuối vẫn vừa khung", () => {
    const cau = "Bé để ý và nhắc khi có gì đặt sai chỗ trong nhà mình";
    const kq = ngatDongCoHan(cau, 120, 2, thuoc);
    expect(kq.biCat).toBe(true);
    expect(kq.dong).toHaveLength(2);
    for (const d of kq.dong) expect(thuoc(d)).toBeLessThanOrEqual(120);
    expect(kq.dong[1].endsWith("…")).toBe(true);
  });

  it("đủ chỗ thì không cắt và không thêm dấu lược", () => {
    const kq = ngatDongCoHan("Chủ động", 200, 3, thuoc);
    expect(kq.biCat).toBe(false);
    expect(kq.dong).toEqual(["Chủ động"]);
  });
});

describe("thuCoChuVuaMotDong", () => {
  it("thu cỡ chữ cho tới khi vừa một dòng", () => {
    // "Rô Xung Phong" = 13 ký tự. Khung 260px ⇒ cỡ lớn nhất vừa là 20.
    const kq = thuCoChuVuaMotDong("Rô Xung Phong", 260, 40, 12, thuocTheoCo);
    expect(kq).toEqual({ co: 20, vua: true });
    expect(thuocTheoCo("Rô Xung Phong", kq.co)).toBeLessThanOrEqual(260);
  });

  it("chuỗi đã vừa sẵn thì giữ nguyên cỡ ban đầu, không thu vô cớ", () => {
    const kq = thuCoChuVuaMotDong("Rô Tỉ Mỉ", 1000, 32, 12, thuocTheoCo);
    expect(kq).toEqual({ co: 32, vua: true });
  });

  it("chạm cỡ tối thiểu mà vẫn không vừa thì báo vua=false, không thu vô hạn", () => {
    const kq = thuCoChuVuaMotDong("Một câu rất dài không thể nào vừa", 20, 40, 12, thuocTheoCo);
    expect(kq).toEqual({ co: 12, vua: false });
  });
});
