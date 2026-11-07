/**
 * NƠI CHỊU CÔNG — bug prod 13/09/2026: công của người Hội sở nhảy vào cơ sở họ vừa quét.
 *
 * Luật 16 — mỗi vế CHẶN đi kèm vế CHO QUA:
 *   · "người HO quét ở CS1 ⇒ ngày công thuộc HO"  ⇔  "người CS1 quét ở CS1 ⇒ VẪN thuộc CS1"
 *   · "quét ở đây KHÔNG đủ để vào sổ công ở đây"  ⇔  "có ca xếp ở đây thì VẪN vào sổ, kể cả
 *      khi chưa quét lượt nào"
 */
import { describe, expect, it } from "vitest";

import { nguoiThuocSoCong, noiChiuCongCuaNgay } from "./noi-chiu-cong";

const HO = "hoi-so";
const CS1 = "id-cs1";
const CS2 = "id-cs2";

describe("noiChiuCongCuaNgay — ca xếp quyết định, KHÔNG phải nơi quét", () => {
  // ── vế CHẶN: ca thật trên prod ─────────────────────────────────────────────
  it("người HO có ca HC (nơi HO), quét ở CS1 ⇒ ngày công thuộc HO", () => {
    expect(noiChiuCongCuaNgay({ centerIdCaDuocXep: HO, centerIdNha: HO })).toBe(HO);
  });

  it("người HO KHÔNG có ca hôm đó, quét ở CS1 ⇒ VẪN thuộc HO (nơi trực thuộc)", () => {
    // Đây là ca mà bản cũ sai: `?? logs[0].centerId` chen vào giữa và thắng, ngày công
    // rơi sang CS1. Nay không còn vế nào mang nơi quét vào hàm này.
    expect(noiChiuCongCuaNgay({ centerIdCaDuocXep: null, centerIdNha: HO })).toBe(HO);
  });

  it("người CS2 không có ca, quét ở CS1 ⇒ thuộc CS2 — nơi TRỰC THUỘC, không phải nơi quét", () => {
    expect(noiChiuCongCuaNgay({ centerIdCaDuocXep: null, centerIdNha: CS2 })).toBe(CS2);
  });

  // ── vế CHO QUA (luật 16) ───────────────────────────────────────────────────
  it("người CS1 có ca ở CS1, quét ở CS1 ⇒ VẪN thuộc CS1", () => {
    expect(noiChiuCongCuaNgay({ centerIdCaDuocXep: CS1, centerIdNha: CS1 })).toBe(CS1);
  });

  it("ca xếp THẮNG nơi trực thuộc — người CS1 được xếp ca ở CS2 thì ngày công thuộc CS2", () => {
    // Cố ý: "cơ sở LÀM / chịu công hôm đó (khác User.centerId là bình thường)" —
    // nguyên văn chú thích cột `ShiftAssignment.centerId`. Đừng vá thành "luôn theo nhà".
    expect(noiChiuCongCuaNgay({ centerIdCaDuocXep: CS2, centerIdNha: CS1 })).toBe(CS2);
  });

  it("hàm KHÔNG nhận nơi quét — chữ ký chỉ có hai trường", () => {
    // Cổng chống hồi quy ở tầng KIỂU: thêm `centerIdNoiQuet` vào là `tsc` đỏ ngay,
    // không đợi ai đọc lại chú thích.
    const khoa = Object.keys({ centerIdCaDuocXep: null, centerIdNha: HO }).sort();
    expect(khoa).toEqual(["centerIdCaDuocXep", "centerIdNha"]);
  });
});

describe("nguoiThuocSoCong — quét ở đây KHÔNG đủ để vào sổ công ở đây", () => {
  // ── vế CHẶN ────────────────────────────────────────────────────────────────
  it("người HO quét ở CS1 nhưng không có ngày công / ca nào ở CS1 ⇒ 0 dòng ở CS1", () => {
    expect(nguoiThuocSoCong({ coNgayCong: [], coCaXep: [] })).toEqual([]);
  });

  // ── vế CHO QUA ─────────────────────────────────────────────────────────────
  it("có ngày công ở cơ sở này ⇒ VẪN vào sổ", () => {
    expect(nguoiThuocSoCong({ coNgayCong: ["u1"], coCaXep: [] })).toEqual(["u1"]);
  });

  it("có ca xếp mà CHƯA quét lượt nào ⇒ VẪN vào sổ (đó là người cần nhắc)", () => {
    expect(nguoiThuocSoCong({ coNgayCong: [], coCaXep: ["u2"] })).toEqual(["u2"]);
  });

  it("vừa có ngày công vừa có ca ⇒ kể MỘT lần", () => {
    expect(nguoiThuocSoCong({ coNgayCong: ["u1", "u2"], coCaXep: ["u2", "u3"] })).toEqual([
      "u1",
      "u2",
      "u3",
    ]);
  });

  it("giữ THỨ TỰ: ngày công trước, ca xếp sau", () => {
    expect(nguoiThuocSoCong({ coNgayCong: ["b"], coCaXep: ["a"] })).toEqual(["b", "a"]);
  });

  it("hàm KHÔNG nhận nguồn từ lượt quét — chữ ký chỉ có hai trường", () => {
    const khoa = Object.keys({ coNgayCong: [], coCaXep: [] }).sort();
    expect(khoa).toEqual(["coCaXep", "coNgayCong"]);
  });
});
