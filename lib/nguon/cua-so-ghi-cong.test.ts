/**
 * Ca [NHH-SRC-11] — cửa sổ ghi công 90 ngày (04 §7.3; chốt 08/10: quá hạn GIỮ nguồn, KHÔNG đổi UNKNOWN).
 * THUẦN: `now` truyền vào (luật 19); ngày tính theo LỊCH VIỆT NAM, không theo UTC.
 */
import { describe, expect, it } from "vitest";
import { conTrongCuaSoGhiCong, cuaSoHieuLuc, hanCuaSoGhiCong } from "./cua-so-ghi-cong";

const d = (iso: string) => new Date(iso);
// attributedAt = 10:00 giờ VN ngày 01/07/2026.
const A = d("2026-07-01T03:00:00.000Z");

describe("[NHH-SRC-11] conTrongCuaSoGhiCong — biên ngày 90 / 91", () => {
  it("ngày thứ 90 (29/09) còn TRONG cửa sổ; ngày thứ 91 (30/09) NGOÀI", () => {
    expect(conTrongCuaSoGhiCong(A, d("2026-09-29T03:00:00.000Z"), 90)).toBe(true); // +90 ngày lịch
    expect(conTrongCuaSoGhiCong(A, d("2026-09-30T03:00:00.000Z"), 90)).toBe(false); // +91
  });

  it("cùng ngày và ngay sau khi gán nguồn ⇒ trong cửa sổ", () => {
    expect(conTrongCuaSoGhiCong(A, A, 90)).toBe(true);
    expect(conTrongCuaSoGhiCong(A, d("2026-07-02T03:00:00.000Z"), 90)).toBe(true);
  });

  it("biên theo GIỜ VN, không theo UTC: 23:30 VN ngày 90 còn trong, 00:10 VN ngày 91 đã ngoài", () => {
    // Ngày 90 kể từ 01/07 là 29/09. 23:30 VN 29/09 = 16:30Z 29/09; 00:10 VN 30/09 = 17:10Z 29/09.
    expect(conTrongCuaSoGhiCong(A, d("2026-09-29T16:30:00.000Z"), 90)).toBe(true);
    expect(conTrongCuaSoGhiCong(A, d("2026-09-29T17:10:00.000Z"), 90)).toBe(false);
  });

  it("attributedAt sát nửa đêm VN: 23:59 VN ngày 01/07 vẫn tính là ngày 01/07, không phải 02/07", () => {
    const muon = d("2026-07-01T16:59:00.000Z"); // 23:59 VN 01/07
    expect(conTrongCuaSoGhiCong(muon, d("2026-09-29T03:00:00.000Z"), 90)).toBe(true);
    expect(conTrongCuaSoGhiCong(muon, d("2026-09-30T03:00:00.000Z"), 90)).toBe(false);
  });

  it("mốc so TRƯỚC attributedAt (thu tiền trước khi gán nguồn) ⇒ vẫn trong cửa sổ (không âm ngày)", () => {
    expect(conTrongCuaSoGhiCong(A, d("2026-06-01T03:00:00.000Z"), 90)).toBe(true);
  });

  it("độ dài cửa sổ là THAM SỐ (nguon.cuaSoGhiCongNgay): 30 ngày ⇒ biên dời theo", () => {
    expect(conTrongCuaSoGhiCong(A, d("2026-07-31T03:00:00.000Z"), 30)).toBe(true);
    expect(conTrongCuaSoGhiCong(A, d("2026-08-01T03:00:00.000Z"), 30)).toBe(false);
  });

  it("ngay không hợp lệ (≤ 0, NaN, không nguyên) ⇒ ném — không lặng lẽ coi là 'luôn đủ điều kiện'", () => {
    for (const bad of [0, -1, Number.NaN, 1.5]) {
      expect(() => conTrongCuaSoGhiCong(A, A, bad)).toThrow();
    }
  });

  it("quá hạn KHÔNG phải UNKNOWN: hàm chỉ trả boolean, không có đường nào đổi nhóm nguồn", () => {
    expect(typeof conTrongCuaSoGhiCong(A, d("2027-01-01T00:00:00.000Z"), 90)).toBe("boolean");
  });
});

describe("[NHH-SRC-11b] hanCuaSoGhiCong — mốc cuối cửa sổ", () => {
  it("= hết ngày VN thứ N kể từ ngày gán (23:59:59.999 VN)", () => {
    // 01/07 + 90 ngày = 29/09; hết ngày 29/09 giờ VN = 2026-09-29T16:59:59.999Z.
    expect(hanCuaSoGhiCong(A, 90).toISOString()).toBe("2026-09-29T16:59:59.999Z");
  });
  it("nhất quán với conTrongCuaSoGhiCong: ngay tại mốc cuối ⇒ còn, 1ms sau ⇒ hết", () => {
    const han = hanCuaSoGhiCong(A, 90);
    expect(conTrongCuaSoGhiCong(A, han, 90)).toBe(true);
    expect(conTrongCuaSoGhiCong(A, new Date(han.getTime() + 1), 90)).toBe(false);
  });
});

describe("[DYN-WIN-01] cuaSoHieuLuc — cửa sổ RIÊNG của nguồn thắng; NULL ⇒ dùng setting chung", () => {
  it("nguồn 60 ngày / 90 ngày / NULL (setting 90): đúng số ngày hiệu lực", () => {
    expect(cuaSoHieuLuc(60, 90)).toBe(60);
    expect(cuaSoHieuLuc(90, 30)).toBe(90);
    expect(cuaSoHieuLuc(null, 90)).toBe(90);
    expect(cuaSoHieuLuc(null, 45)).toBe(45);
  });

  it("giá trị hiệu lực đi qua CÙNG phép kiểm với conTrongCuaSoGhiCong: ≤ 0 / không nguyên ⇒ ném (không rơi im lặng về 'luôn đủ điều kiện')", () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      expect(() => cuaSoHieuLuc(bad, 90)).toThrow();
    }
    expect(() => cuaSoHieuLuc(null, 0)).toThrow();
  });

  it("nguồn 60 vs 90 vs NULL trên CÙNG một khoản thu ngày thứ 75: chỉ nguồn 60 NGOÀI cửa sổ (đối chứng dương: 90 và NULL còn trong)", () => {
    const thu = d("2026-09-14T03:00:00.000Z"); // 01/07 + 75 ngày
    expect(conTrongCuaSoGhiCong(A, thu, cuaSoHieuLuc(60, 90))).toBe(false);
    expect(conTrongCuaSoGhiCong(A, thu, cuaSoHieuLuc(90, 90))).toBe(true);
    expect(conTrongCuaSoGhiCong(A, thu, cuaSoHieuLuc(null, 90))).toBe(true);
  });
});
