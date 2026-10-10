// @vitest-environment node
/**
 * [NHH-PER-01] / [NHH-COM-14b] — vòng đời KỲ (tháng × cơ sở) và KỲ GHI SỔ của một dòng (04 §12). THUẦN.
 */
import { describe, it, expect } from "vitest";

import { TRANG_THAI_KY, congThang, kiemChuyenTrangThaiKy, kyGhiSo, laKyNhanDong, type KyTomTat, type TrangThaiKy } from "./ky-hoa-hong";

const T0 = new Date("2026-11-05T03:00:00.000Z");
const SAU = new Date("2026-11-06T03:00:00.000Z");
const TRUOC = new Date("2026-11-04T03:00:00.000Z");

/** Cổng sạch: đã Tính, không còn hàng chờ chặn, không đầu vào mới hơn lần Tính. */
const SACH = { soHangChoChan: 0, lastCalculatedAt: SAU, dauVaoMoiNhat: T0 };

describe("[NHH-PER-01] vòng đời kỳ — đủ 36 cặp (tu × den)", () => {
  const HOP_LE = new Set([
    "OPEN>CALCULATED",
    "CALCULATED>CALCULATED", // Tính lại
    "CALCULATED>REVIEWING",
    "REVIEWING>CALCULATED", // trả lại
    "REVIEWING>LOCKED",
    "LOCKED>EXPORTED",
    "EXPORTED>PAID",
  ]);

  it("đúng 7 cặp được phép; 29 cặp còn lại bị từ chối (không nhảy cóc, không lùi sau LOCKED)", () => {
    let duoc = 0;
    let tuChoi = 0;
    for (const tu of TRANG_THAI_KY) {
      for (const den of TRANG_THAI_KY) {
        const loi = kiemChuyenTrangThaiKy({ tu, den, ...SACH });
        const ky = HOP_LE.has(`${tu}>${den}`);
        if (ky) {
          expect(loi, `${tu} → ${den} phải được phép`).toBeNull();
          duoc += 1;
        } else {
          expect(loi, `${tu} → ${den} phải bị từ chối`).toEqual(expect.any(String));
          tuChoi += 1;
        }
      }
    }
    expect({ duoc, tuChoi }).toEqual({ duoc: 7, tuChoi: 29 });
  });

  it("cấy: LOCKED → REVIEWING (mở lại) và OPEN → LOCKED (nhảy cóc) bị chặn; không có REOPEN sau LOCKED", () => {
    expect(kiemChuyenTrangThaiKy({ tu: "LOCKED", den: "REVIEWING", ...SACH })).toMatch(/LOCKED/);
    expect(kiemChuyenTrangThaiKy({ tu: "OPEN", den: "LOCKED", ...SACH })).not.toBeNull();
    expect(kiemChuyenTrangThaiKy({ tu: "PAID", den: "EXPORTED", ...SACH })).not.toBeNull();
  });
});

describe("[NHH-PER-08] cổng KHOÁ và cổng CHUYỂN RÀ SOÁT (04 §12.1)", () => {
  it("[NHH-PER-08a] còn hàng chờ chặn ⇒ không khoá được", () => {
    expect(kiemChuyenTrangThaiKy({ tu: "REVIEWING", den: "LOCKED", ...SACH, soHangChoChan: 1 })).toMatch(/hàng chờ/);
    // đối chứng dương: 0 hàng chờ ⇒ khoá được
    expect(kiemChuyenTrangThaiKy({ tu: "REVIEWING", den: "LOCKED", ...SACH, soHangChoChan: 0 })).toBeNull();
  });

  it("[NHH-PER-08b] có đầu vào đổi SAU lần Tính (dấu thời gian mới hơn) ⇒ không khoá, không chuyển rà soát", () => {
    const tre = { ...SACH, lastCalculatedAt: TRUOC, dauVaoMoiNhat: T0 };
    expect(kiemChuyenTrangThaiKy({ tu: "REVIEWING", den: "LOCKED", ...tre })).toMatch(/Tính lại/);
    expect(kiemChuyenTrangThaiKy({ tu: "CALCULATED", den: "REVIEWING", ...tre })).toMatch(/Tính lại/);
    // đối chứng dương: Tính SAU thay đổi cuối ⇒ qua
    expect(kiemChuyenTrangThaiKy({ tu: "CALCULATED", den: "REVIEWING", ...SACH })).toBeNull();
    // biên: đầu vào đổi ĐÚNG lúc Tính ⇒ coi là chưa mới hơn (>, không phải ≥)
    expect(kiemChuyenTrangThaiKy({ tu: "REVIEWING", den: "LOCKED", ...SACH, lastCalculatedAt: T0, dauVaoMoiNhat: T0 })).toBeNull();
  });

  it("chưa từng Tính (lastCalculatedAt null) ⇒ không chuyển rà soát / khoá", () => {
    expect(kiemChuyenTrangThaiKy({ tu: "CALCULATED", den: "REVIEWING", ...SACH, lastCalculatedAt: null })).toMatch(/chưa/i);
    expect(kiemChuyenTrangThaiKy({ tu: "REVIEWING", den: "LOCKED", ...SACH, lastCalculatedAt: null })).toMatch(/chưa/i);
  });

  it("không có đầu vào nào (dauVaoMoiNhat null) ⇒ không cản", () => {
    expect(kiemChuyenTrangThaiKy({ tu: "REVIEWING", den: "LOCKED", ...SACH, dauVaoMoiNhat: null })).toBeNull();
  });
});

describe("congThang", () => {
  it("cộng tháng, sang năm", () => {
    expect(congThang("2026-10", 1)).toBe("2026-11");
    expect(congThang("2026-12", 1)).toBe("2027-01");
    expect(congThang("2026-01", 13)).toBe("2027-02");
  });
  it("tháng sai dạng ⇒ ném (không đoán)", () => {
    expect(() => congThang("2026-13", 1)).toThrow();
    expect(() => congThang("2026-1", 1)).toThrow();
  });
});

describe("[NHH-COM-14b] kyGhiSo — kỳ của một dòng (L9, 04 §12.2)", () => {
  const OU = "ou-cs1";
  const ky = (thang: string, trangThai: TrangThaiKy, orgUnitId = OU): KyTomTat => ({ thang, orgUnitId, trangThai });
  const base = { orgUnitId: OU, kyCutover: "2026-10" };

  it("kỳ tự nhiên chưa có ⇒ dùng chính nó (kỳ được tạo khi ghi)", () => {
    expect(kyGhiSo({ ...base, kyTuNhien: "2026-11", ky: [] })).toBe("2026-11");
  });

  it("kỳ tự nhiên OPEN hoặc CALCULATED ⇒ giữ", () => {
    expect(kyGhiSo({ ...base, kyTuNhien: "2026-11", ky: [ky("2026-11", "OPEN")] })).toBe("2026-11");
    expect(kyGhiSo({ ...base, kyTuNhien: "2026-11", ky: [ky("2026-11", "CALCULATED")] })).toBe("2026-11");
  });

  it("kỳ tự nhiên REVIEWING/LOCKED/EXPORTED/PAID ⇒ tháng kế tiếp còn mở (đến muộn — không mở lại kỳ đóng)", () => {
    for (const st of ["REVIEWING", "LOCKED", "EXPORTED", "PAID"] as const) {
      expect(kyGhiSo({ ...base, kyTuNhien: "2026-11", ky: [ky("2026-11", st)] }), st).toBe("2026-12");
    }
  });

  it("nhiều kỳ liền nhau đều đã đóng ⇒ nhảy tới kỳ mở đầu tiên; kỳ kế tiếp chưa tồn tại coi là mở", () => {
    const k = [ky("2026-11", "LOCKED"), ky("2026-12", "REVIEWING"), ky("2027-01", "PAID")];
    expect(kyGhiSo({ ...base, kyTuNhien: "2026-11", ky: k })).toBe("2027-02");
    expect(kyGhiSo({ ...base, kyTuNhien: "2026-11", ky: [ky("2026-11", "LOCKED"), ky("2026-12", "OPEN")] })).toBe("2026-12");
  });

  it("kỳ của ĐƠN VỊ KHÁC không ảnh hưởng (kỳ là tháng × cơ sở)", () => {
    expect(kyGhiSo({ ...base, kyTuNhien: "2026-11", ky: [ky("2026-11", "LOCKED", "ou-cs2")] })).toBe("2026-11");
  });

  it("kỳ tự nhiên TRƯỚC mốc cutover ⇒ không bao giờ ra kỳ < mốc (engine mới không tạo/ghi kỳ cũ)", () => {
    expect(kyGhiSo({ ...base, kyTuNhien: "2026-09", ky: [] })).toBe("2026-10");
    expect(kyGhiSo({ ...base, kyTuNhien: "2026-05", ky: [ky("2026-10", "REVIEWING")] })).toBe("2026-11");
  });

  it("laKyNhanDong: chỉ OPEN và CALCULATED nhận dòng mới", () => {
    expect(TRANG_THAI_KY.filter((s) => laKyNhanDong(s))).toEqual(["OPEN", "CALCULATED"]);
  });
});
