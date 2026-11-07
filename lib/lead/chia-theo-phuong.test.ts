/**
 * [CTP-*] chia lead theo PHƯỜNG/XÃ — phần THUẦN (`chia-theo-phuong.ts`).
 *   [CTP-N1] chuẩn hoá tên địa danh: bỏ dấu, tiền tố hành chính, hoa/thường, dấu câu
 *   [CTP-N2] khoá cặp (thành phố, phường): thiếu một vế ⇒ null (không đoán); cùng tên phường ở hai thành phố ⇒ hai khoá
 *   [CTP-P1] chọn cơ sở: phường đã đặt + cơ sở hợp lệ ⇒ cơ sở đó
 *   [CTP-P2] không quyết được ⇒ null: phường chưa đặt · cơ sở không còn hợp lệ · thiếu thông tin · bảng rỗng
 *   [CTP-P3] cấu hình hỏng/lạ ⇒ bảng rỗng, không ném
 *   [CTP-P4] đặt/gỡ một phường trả bảng MỚI, không sửa bảng cũ
 */
import { describe, expect, it } from "vitest";
import { BANG_RONG, chonCoSoTheoPhuong, datPhuong, docBangPhuong, khoaDiaDanh, khoaPhuong } from "./chia-theo-phuong";

describe("[CTP-N1] chuẩn hoá tên địa danh", () => {
  it.each([
    ["Phường Hải Châu", "hai chau"],
    ["hải châu", "hai chau"],
    ["  PHƯỜNG   Hải  Châu ", "hai chau"],
    ["Xã Hòa Khương", "hoa khuong"],
    ["Tp Đà Nẵng", "da nang"],
    ["Thành phố Đà Nẵng", "da nang"],
    ["TP. Đà Nẵng", "da nang"],
    ["Đà Nẵng", "da nang"],
    ["Phường 1", "1"],
    ["Thị trấn Nam Phước", "nam phuoc"],
  ])("%j ⇒ %j", (vao, ra) => {
    expect(khoaDiaDanh(vao)).toBe(ra);
  });
  it("rỗng / null ⇒ rỗng", () => {
    expect(khoaDiaDanh(null)).toBe("");
    expect(khoaDiaDanh("   ")).toBe("");
  });
});

describe("[CTP-N2] khoá cặp (thành phố, phường)", () => {
  it("hai cách viết cùng một phường ⇒ cùng khoá", () => {
    expect(khoaPhuong("Tp Đà Nẵng", "Phường Hải Châu")).toBe(khoaPhuong("Đà Nẵng", "hai chau"));
    expect(khoaPhuong("Tp Đà Nẵng", "Phường Hải Châu")).toBe("da nang|hai chau");
  });
  it("thiếu một vế ⇒ null", () => {
    expect(khoaPhuong("Đà Nẵng", null)).toBeNull();
    expect(khoaPhuong("", "Hải Châu")).toBeNull();
    expect(khoaPhuong(undefined, undefined)).toBeNull();
  });
  it("cùng tên phường ở hai thành phố ⇒ hai khoá khác nhau", () => {
    expect(khoaPhuong("Đà Nẵng", "Hải Châu")).not.toBe(khoaPhuong("Hải Phòng", "Hải Châu"));
  });
});

const BANG = { phienBan: 1 as const, map: { "da nang|hai chau": "cs2", "da nang|hoa khuong": "cs1" } };
const HOP_LE = new Set(["cs1", "cs2"]);

describe("[CTP-P1] chọn cơ sở theo phường", () => {
  it("phường đã đặt + cơ sở hợp lệ ⇒ cơ sở đó", () => {
    expect(chonCoSoTheoPhuong({ thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu" }, BANG, HOP_LE)).toBe("cs2");
    expect(chonCoSoTheoPhuong({ thanhPho: "Đà Nẵng", phuong: "Xã Hòa Khương" }, BANG, HOP_LE)).toBe("cs1");
  });
});

describe("[CTP-P2] không quyết được ⇒ null", () => {
  it("phường chưa đặt", () => {
    expect(chonCoSoTheoPhuong({ thanhPho: "Đà Nẵng", phuong: "Phường Thanh Khê" }, BANG, HOP_LE)).toBeNull();
  });
  it("cơ sở của phường không còn hợp lệ (đã đóng / không nhận lead)", () => {
    expect(chonCoSoTheoPhuong({ thanhPho: "Đà Nẵng", phuong: "Hải Châu" }, BANG, new Set(["cs1"]))).toBeNull();
  });
  it("thiếu thành phố hoặc phường", () => {
    expect(chonCoSoTheoPhuong({ thanhPho: "Đà Nẵng", phuong: null }, BANG, HOP_LE)).toBeNull();
    expect(chonCoSoTheoPhuong({ thanhPho: null, phuong: "Hải Châu" }, BANG, HOP_LE)).toBeNull();
  });
  it("bảng rỗng; phường ở thành phố khác", () => {
    expect(chonCoSoTheoPhuong({ thanhPho: "Đà Nẵng", phuong: "Hải Châu" }, BANG_RONG, HOP_LE)).toBeNull();
    expect(chonCoSoTheoPhuong({ thanhPho: "Hà Nội", phuong: "Hải Châu" }, BANG, HOP_LE)).toBeNull();
  });
});

describe("[CTP-P3] cấu hình hỏng không bao giờ ném", () => {
  it.each([[null], [undefined], ["x"], [{}], [{ phienBan: 2, map: {} }], [{ phienBan: 1, map: { a: 5 } }], [{ phienBan: 1, map: "lạ" }], [[]]])("%j ⇒ bảng rỗng", (raw) => {
    expect(docBangPhuong(raw)).toEqual(BANG_RONG);
  });
  it("cấu hình đúng được giữ nguyên", () => {
    expect(docBangPhuong(BANG)).toEqual(BANG);
  });
});

describe("[CTP-P4] đặt / gỡ một phường", () => {
  it("đặt: bảng mới có phường, bảng cũ không đổi", () => {
    const moi = datPhuong(BANG_RONG, "Tp Đà Nẵng", "Phường Thanh Khê", "cs2");
    expect(moi.map).toEqual({ "da nang|thanh khe": "cs2" });
    expect(BANG_RONG.map).toEqual({});
  });
  it("gỡ (coSoId null) ⇒ bỏ khoá; đặt lại cùng phường ⇒ ghi đè", () => {
    expect(datPhuong(BANG, "Đà Nẵng", "Hải Châu", null).map).toEqual({ "da nang|hoa khuong": "cs1" });
    expect(datPhuong(BANG, "Đà Nẵng", "Hải Châu", "cs1").map["da nang|hai chau"]).toBe("cs1");
  });
  it("thiếu phường ⇒ trả nguyên bảng", () => {
    expect(datPhuong(BANG, "Đà Nẵng", "", "cs1")).toBe(BANG);
  });
});
