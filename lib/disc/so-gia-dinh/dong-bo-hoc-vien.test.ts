/**
 * [SGH-*] Sổ gia đình DISC ↔ hồ sơ con: kế hoạch đồng bộ THUẦN (không DB). Dữ liệu BỊA; ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, expect, it } from "vitest";

import { keHoachHocVienSangSo, keHoachSoSangHocVien, khoiSangLop, lopSangKhoi, namCuaNgaySinh } from "./dong-bo-hoc-vien";

const NS_2017 = new Date(Date.UTC(2017, 5, 15));
const NS_2016 = new Date(Date.UTC(2016, 0, 1));

describe("[SGH-01] dịch lớp ↔ khối", () => {
  it("«1»…«12» ⇔ số; mầm non / trên 12 / rỗng ⇒ không có ô tương ứng", () => {
    expect(lopSangKhoi("3")).toBe(3);
    expect(lopSangKhoi("12")).toBe(12);
    for (const x of ["mam-non", "tren-12", "", null, undefined, "0", "13", "03a"]) expect(lopSangKhoi(x as string | null)).toBeNull();
    expect(khoiSangLop(7)).toBe("7");
    for (const x of [0, 13, 2.5, null, undefined]) expect(khoiSangLop(x as number | null)).toBeNull();
  });
  it("năm của ngày sinh theo múi giờ VN (mốc nửa đêm UTC không lùi năm)", () => {
    expect(namCuaNgaySinh(NS_2016)).toBe(2016); // 01/01/2016 00:00 UTC = 07:00 VN, vẫn 2016
    expect(namCuaNgaySinh(null)).toBeNull();
  });
});

describe("[SGH-02] Sổ → học viên: chỉ khi lớp ĐỔI thật và khác lớp của học viên", () => {
  it("lớp đổi 3→4, học viên đang lớp 3 ⇒ đẩy lớp 4", () => {
    expect(keHoachSoSangHocVien({ lopTruoc: "3", lopMoi: "4", khoiHocVien: 3 })).toEqual({ currentGrade: 4 });
  });
  it("lưu lại KHÔNG đổi lớp ⇒ không đẩy (không đè lớp nhân viên vừa sửa ở hồ sơ)", () => {
    expect(keHoachSoSangHocVien({ lopTruoc: "3", lopMoi: "3", khoiHocVien: 5 })).toBeNull();
  });
  it("lớp mới đã bằng lớp học viên ⇒ không đẩy", () => {
    expect(keHoachSoSangHocVien({ lopTruoc: "3", lopMoi: "4", khoiHocVien: 4 })).toBeNull();
  });
  it("lớp mới là mầm non / trên 12 / bỏ trống ⇒ không đẩy (học viên không có ô đó; xoá trắng không xoá hồ sơ)", () => {
    for (const lopMoi of ["mam-non", "tren-12", null]) expect(keHoachSoSangHocVien({ lopTruoc: "3", lopMoi, khoiHocVien: 3 })).toBeNull();
  });
  it("học viên chưa có lớp (null) ⇒ đẩy", () => {
    expect(keHoachSoSangHocVien({ lopTruoc: null, lopMoi: "2", khoiHocVien: null })).toEqual({ currentGrade: 2 });
  });
});

describe("[SGH-03] học viên → Sổ: chỉ ô ĐỔI thật; xoá trắng ở hồ sơ không xoá ở Sổ", () => {
  const goc = { currentGrade: 3, dateOfBirth: NS_2017 };
  it("đổi lớp ⇒ đẩy lớp; không đổi năm sinh ⇒ không đẩy năm sinh", () => {
    expect(keHoachHocVienSangSo({ truoc: goc, sau: { currentGrade: 4, dateOfBirth: NS_2017 } })).toEqual({ lop: "4" });
  });
  it("đổi ngày sinh sang NĂM khác ⇒ đẩy năm; đổi ngày trong cùng năm ⇒ không", () => {
    expect(keHoachHocVienSangSo({ truoc: goc, sau: { currentGrade: 3, dateOfBirth: NS_2016 } })).toEqual({ namSinh: 2016 });
    expect(keHoachHocVienSangSo({ truoc: goc, sau: { currentGrade: 3, dateOfBirth: new Date(Date.UTC(2017, 11, 31)) } })).toEqual({});
  });
  it("xoá trắng lớp / ngày sinh ở hồ sơ ⇒ KHÔNG xoá ở Sổ", () => {
    expect(keHoachHocVienSangSo({ truoc: goc, sau: { currentGrade: null, dateOfBirth: null } })).toEqual({});
  });
  it("lớp mới ngoài 1–12 ⇒ không đẩy lớp", () => {
    expect(keHoachHocVienSangSo({ truoc: goc, sau: { currentGrade: 13, dateOfBirth: NS_2017 } })).toEqual({});
  });
  it("đổi cả hai ⇒ đẩy cả hai", () => {
    expect(keHoachHocVienSangSo({ truoc: goc, sau: { currentGrade: 5, dateOfBirth: NS_2016 } })).toEqual({ lop: "5", namSinh: 2016 });
  });
});
