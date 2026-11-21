import { describe, expect, it } from "vitest";
import { chuanHoaTen, kiemTraHoSo, tenCoLienKet } from "./ho-so";

// Dữ liệu GIẢ. Năm cố định (luật 19).
const NAM = 2026;
const ph = { hoTen: "Nguyễn Thị Mai", vaiTro: "ME", namSinh: 1988 };
const hs = { hoTen: "Trần Bảo Minh", namSinh: 2016, bacHoc: "4" };

describe("[DISC-HS-30] S-09: vệ sinh tên", () => {
  const kq = (hoTen: string) => kiemTraHoSo({ phuHuynh: { ...ph, hoTen }, hocSinh: hs }, NAM);
  const tenPh = (hoTen: string) => {
    const r = kq(hoTen);
    return r.ok ? r.phuHuynh.hoTen : null;
  };
  it("NFC: dạng tổ hợp (chữ + dấu rời) và dạng dựng sẵn cho CÙNG một tên", () => {
    const tohop = "Nguyễn Thị Mai"; // Nguyễn Thị Mai dạng NFD
    expect(tenPh(tohop)).toBe("Nguyễn Thị Mai".normalize("NFC"));
    expect(tenPh(tohop)).toBe(tenPh("Nguyễn Thị Mai"));
  });
  it("bidi override (U+202E…), zero-width (U+200B/200D/FEFF), soft hyphen bị BỎ", () => {
    expect(tenPh("Mai\u202E gnauq")).toBe("Mai gnauq");
    expect(tenPh("Ng\u200Buy\u200D\u00ADễn\uFEFF Mai\u2066")).toBe("Nguyễn Mai");
    expect(chuanHoaTen("\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069\u200E\u200F\u061Cx")).toBe("x");
  });
  it("xuống dòng, tab, ký tự điều khiển, U+2028 → khoảng trắng đơn; không còn ký tự điều khiển", () => {
    expect(tenPh("Nguyễn\nThị\tMai\r\u2028 Hoa\u0000")).toBe("Nguyễn Thị Mai Hoa");
    expect(/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(tenPh("A\u0007B\u200Fcd") ?? "")).toBe(false);
  });
  it("URL / tên miền / email trong tên ⇒ TỪ CHỐI với lỗi đúng trường (không lưu)", () => {
    for (const x of ["Gọi 0909 qua http://x.vn", "https://evil.example", "www.khuyenmai.vn", "Mai khuyenmai.com", "Mai@gmail", "javascript:alert", "ftp://a b"]) {
      const r = kq(x);
      expect(r.ok, x).toBe(false);
      if (!r.ok) expect(r.loi.map((l) => l.truong)).toContain("phuHuynh.hoTen");
    }
    expect(tenCoLienKet("Lê Văn Nam")).toBe(false);
    expect(tenCoLienKet("Võ Thị Cẩm Tú")).toBe(false);
  });
  it("tên thật có dấu gạch nối / nháy / chấm viết tắt KHÔNG bị chặn oan", () => {
    for (const x of ["Nguyễn Thị Mai-Hoa", "O'Brien Lê", "Trần V. Nam", "Lê Thị A.", "Bùi Văn Co"]) expect(kq(x).ok, x).toBe(true);
  });
  it("giới hạn độ dài tính SAU chuẩn hoá: toàn ký tự vô hình ⇒ rỗng ⇒ lỗi 'nhập họ tên'; 81 ký tự thật ⇒ 'quá dài'", () => {
    const r1 = kq("\u200B\u200B\u200B\u200B");
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.loi.map((l) => l.thongBao).join()).toContain("họ và tên");
    expect(kq("a".repeat(80)).ok).toBe(true);
    const r2 = kq("a".repeat(81));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.loi.map((l) => l.thongBao).join()).toContain("quá dài");
    expect(kq("a" + "\u200B".repeat(200) + "b").ok).toBe(true); // vô hình không tính vào độ dài
  });
  it("tên của HỌC SINH cũng được lọc (cùng schema)", () => {
    const r = kiemTraHoSo({ phuHuynh: ph, hocSinh: { ...hs, hoTen: "Bảo\u202E\nMinh" } }, NAM);
    expect(r.ok && r.hocSinh.hoTen).toBe("Bảo Minh");
  });
});
