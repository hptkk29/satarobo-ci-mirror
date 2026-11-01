// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chonHocVienTrungTheoSdt, studentMatchesLoose } from "./dedupe";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("[DUP-01] studentMatchesLoose — ngày sinh chỉ là mâu thuẫn khi CẢ HAI bên có và khác", () => {
  it("cùng tên chuẩn hoá, một bên chưa có ngày sinh ⇒ khớp (ca sự cố 06/09)", () => {
    expect(studentMatchesLoose({ name: " Châu  Ngọc Vỹ", dob: null }, { name: "châu ngọc vỹ", dob: D("2020-05-01") })).toBe(true);
    expect(studentMatchesLoose({ name: "Châu Ngọc Vỹ", dob: D("2020-05-01") }, { name: "Châu Ngọc Vỹ", dob: null })).toBe(true);
  });
  it("cả hai có ngày sinh và KHÁC nhau ⇒ không khớp (hai bé trùng tên)", () => {
    expect(studentMatchesLoose({ name: "A", dob: D("2020-05-01") }, { name: "A", dob: D("2019-05-01") })).toBe(false);
  });
  it("khác tên ⇒ không khớp dù ngày sinh trống", () => {
    expect(studentMatchesLoose({ name: "A", dob: null }, { name: "B", dob: null })).toBe(false);
  });
});

describe("[DUP-02] chonHocVienTrungTheoSdt — chỉ chọn khi ĐÚNG MỘT khớp", () => {
  const ung = (id: string, name: string, dob: string | null = null) => ({ id, name, dateOfBirth: dob ? D(dob) : null });
  it("đúng một khớp ⇒ trả id", () => {
    expect(chonHocVienTrungTheoSdt([ung("a", "Bé A"), ung("b", "Bé B")], { name: "bé a", dob: null })).toBe("a");
  });
  it("⚠️ hai khớp ⇒ KHÔNG đoán (trả null, caller tạo mới)", () => {
    expect(chonHocVienTrungTheoSdt([ung("a", "Bé A"), ung("c", "BÉ A")], { name: "Bé A", dob: null })).toBeNull();
  });
  it("không khớp / danh sách rỗng ⇒ null", () => {
    expect(chonHocVienTrungTheoSdt([ung("b", "Bé B")], { name: "Bé A", dob: null })).toBeNull();
    expect(chonHocVienTrungTheoSdt([], { name: "Bé A", dob: null })).toBeNull();
  });
  it("hai khớp nhưng ngày sinh tách được ⇒ chọn đúng người", () => {
    expect(
      chonHocVienTrungTheoSdt([ung("a", "Bé A", "2019-01-01"), ung("c", "Bé A", "2020-01-01")], { name: "Bé A", dob: D("2020-01-01") }),
    ).toBe("c");
  });
});
