// Ca [POS2-SEED-01] — KẾ HOẠCH khai máy POS (`keHoachKhaiMay`, THUẦN). Thiết kế: docs/pos-gd2-thiet-ke.md
// §6.2 (U16): script chỉ TẠO máy chưa có và ĐIỀN ô đang trống — không bao giờ đè giá trị đang có, không
// chuyển cơ sở, không bật lại máy đang TẮT. Hành vi ghi thật (apply / idempotent / ghi kép) đo ở
// `tests/finance/pos-gd2.test.ts` ([POS2-SEED-02..05]).
import { describe, it, expect } from "vitest";
import { canNguoiXem, keHoachKhaiMay, moTaViec, type MayKhai } from "./khai-may-pos";

const MAY: MayKhai = {
  coSo: "CS1",
  maThietBi: "SP_TEST_0001",
  maQuay: "QTT45XWQT",
  maCuaHang: "CH9TSGU9",
  maNhaCungCap: "NCCPH6KE",
  maTcbQuay: null,
};
const CO_SO = [
  { id: "c1", code: "CS1", isActive: true },
  { id: "c2", code: "CS2", isActive: true },
  { id: "c9", code: "CS9", isActive: false },
];
const hien = (o: Partial<{ id: string; centerId: string; active: boolean; maQuay: string | null; maCuaHang: string | null; maNhaCungCap: string | null; maTcbQuay: string | null }> = {}) => ({
  id: "t1",
  maThietBi: MAY.maThietBi,
  centerId: "c1",
  active: true,
  maQuay: null,
  maCuaHang: null,
  maNhaCungCap: null,
  maTcbQuay: null,
  ...o,
});

describe("[POS2-SEED-01] keHoachKhaiMay — từng dòng bảng §6.2", () => {
  it("chưa có máy ⇒ TAO ở cơ sở tra theo Center.code", () => {
    expect(keHoachKhaiMay({ ds: [MAY], coSo: CO_SO, hienCo: [] })).toEqual([{ loai: "TAO", may: MAY, centerId: "c1" }]);
  });

  it("Center.code không có / đã ngừng ⇒ THIEU_CO_SO, không ghi", () => {
    expect(keHoachKhaiMay({ ds: [{ ...MAY, coSo: "CS7" }], coSo: CO_SO, hienCo: [] })).toEqual([
      { loai: "THIEU_CO_SO", maThietBi: MAY.maThietBi, coSo: "CS7" },
    ]);
    expect(keHoachKhaiMay({ ds: [{ ...MAY, coSo: "CS9" }], coSo: CO_SO, hienCo: [] })[0]!.loai).toBe("THIEU_CO_SO");
  });

  it("có máy ở cơ sở KHÁC ⇒ XUNG_DOT_CO_SO — không chuyển (script không đổi cơ sở của máy)", () => {
    expect(keHoachKhaiMay({ ds: [MAY], coSo: CO_SO, hienCo: [hien({ centerId: "c2" })] })).toEqual([
      { loai: "XUNG_DOT_CO_SO", maThietBi: MAY.maThietBi, coSoHienTai: "CS2", coSoScript: "CS1" },
    ]);
  });

  it("cùng cơ sở, ô trống mà script có ⇒ DIEN đúng các ô đó; ô script để trống thì không đụng", () => {
    expect(keHoachKhaiMay({ ds: [MAY], coSo: CO_SO, hienCo: [hien()] })).toEqual([
      {
        loai: "DIEN",
        id: "t1",
        maThietBi: MAY.maThietBi,
        dien: { maQuay: "QTT45XWQT", maCuaHang: "CH9TSGU9", maNhaCungCap: "NCCPH6KE" },
        lech: [],
        dangTat: false,
      },
    ]);
  });

  it("ô đang có giá trị KHÁC script ⇒ GIỮ, ghi vào `lech`; ô khớp ⇒ không gì", () => {
    const v = keHoachKhaiMay({
      ds: [MAY],
      coSo: CO_SO,
      hienCo: [hien({ maQuay: "QTT45XWQT", maCuaHang: "CHKHAC01", maNhaCungCap: "NCCPH6KE" })],
    });
    expect(v).toEqual([
      {
        loai: "GIU_NGUYEN",
        maThietBi: MAY.maThietBi,
        lech: [{ truong: "maCuaHang", hienTai: "CHKHAC01", script: "CH9TSGU9" }],
        dangTat: false,
      },
    ]);
    expect(canNguoiXem(v), "lệch ⇒ người vận hành phải nhìn (mã thoát 2)").toBe(true);
  });

  it("máy đang TẮT ⇒ vẫn điền, `dangTat: true`, KHÔNG tự bật", () => {
    const v = keHoachKhaiMay({ ds: [MAY], coSo: CO_SO, hienCo: [hien({ active: false })] });
    expect(v[0]).toMatchObject({ loai: "DIEN", dangTat: true });
    expect(JSON.stringify(v)).not.toMatch(/"active"/);
  });

  it("không còn gì để điền ⇒ GIU_NGUYEN; cả danh sách sạch ⇒ không cần người xem (mã thoát 0)", () => {
    const v = keHoachKhaiMay({
      ds: [MAY],
      coSo: CO_SO,
      hienCo: [hien({ maQuay: "QTT45XWQT", maCuaHang: "CH9TSGU9", maNhaCungCap: "NCCPH6KE" })],
    });
    expect(v).toEqual([{ loai: "GIU_NGUYEN", maThietBi: MAY.maThietBi, lech: [], dangTat: false }]);
    expect(canNguoiXem(v)).toBe(false);
    expect(canNguoiXem([{ loai: "TAO", may: MAY, centerId: "c1" }])).toBe(false);
    expect(canNguoiXem([{ loai: "XUNG_DOT_CO_SO", maThietBi: "x", coSoHienTai: "CS2", coSoScript: "CS1" }])).toBe(true);
    expect(canNguoiXem([{ loai: "THIEU_CO_SO", maThietBi: "x", coSo: "CS7" }])).toBe(true);
  });
});

describe("[HN2-MP-X01] moTaViec không còn chỉ người chạy script vào tab 'Máy POS' đã gỡ (Việc 2 — luật 12)", () => {
  // Mã TRƯỚC bản vá: "…đổi cơ sở ở tab Máy POS (có audit)" và "…bật ở tab Máy POS nếu cần". Tab đó đã dời về mục
  // "Máy POS quẹt thẻ" của màn Cơ sở, và màn đó CỐ ĐỊNH cơ sở của máy — nên câu "đổi cơ sở ở …" nay không còn đường nào để chỉ.
  it("XUNG_DOT_CO_SO: nói thật — không chuyển, và đổi cơ sở của máy không còn là việc của giao diện", () => {
    const mo = moTaViec({ loai: "XUNG_DOT_CO_SO", maThietBi: "SP_TEST_0001", coSoHienTai: "CS2", coSoScript: "CS1" });
    expect(mo).toContain("KHÔNG chuyển");
    expect(mo).not.toMatch(/tab Máy POS/);
    expect(mo).toMatch(/bên kỹ thuật/);
  });

  it("máy đang TẮT: chỉ đúng nơi bật lại (mục Máy POS quẹt thẻ ở màn Cơ sở)", () => {
    const mo = moTaViec({ loai: "GIU_NGUYEN", maThietBi: "SP_TEST_0001", lech: [], dangTat: true });
    expect(mo).not.toMatch(/tab Máy POS/);
    expect(mo).toMatch(/màn Cơ sở/);
  });

  it("đối chứng dương: dòng TẠO vẫn in như cũ (câu chữ khác không bị đụng)", () => {
    expect(moTaViec({ loai: "TAO", may: MAY, centerId: "c1" })).toBe("TẠO      SP_TEST_0001 → cơ sở CS1");
  });
});
