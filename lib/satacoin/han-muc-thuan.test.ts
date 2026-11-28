import { describe, expect, it } from "vitest";

import { khoangThangVn, kiemTraCapCoinGiaoVien, phanLoaiNguoiCap } from "./han-muc-thuan";

describe("HS2-D4 — luật hạn mức SataCoin của giáo viên (thuần)", () => {
  it("[HM-01] phân loại: vai cao nhất thắng; không có vai hợp lệ ⇒ KHAC (từ chối)", () => {
    expect(phanLoaiNguoiCap(["TEACHER"])).toBe("GIAO_VIEN");
    expect(phanLoaiNguoiCap(["TEACHER", "CENTER_MANAGER"])).toBe("QUAN_LY_CO_SO"); // kiêm nhiệm ⇒ không bị hạn mức giáo viên
    expect(phanLoaiNguoiCap(["TEACHER", "SUPER_ADMIN"])).toBe("ADMIN");
    expect(phanLoaiNguoiCap(["PARENT"])).toBe("KHAC");
    expect(phanLoaiNguoiCap([])).toBe("KHAC");
  });

  it("[HM-02] trong hạn mức ⇒ cho; dùng đúng bằng số còn lại ⇒ cho (biên); thêm 1 ⇒ từ chối", () => {
    const co = (daDung: number, amount: number) => kiemTraCapCoinGiaoVien({ capThang: 100, daDungTrongThang: daDung, amount, laHocVienPhuTrach: true });
    expect(co(0, 10)).toEqual({ ok: true, conLaiSauKhiGhi: 90 });
    expect(co(90, 10)).toEqual({ ok: true, conLaiSauKhiGhi: 0 });
    expect(co(90, 11)).toMatchObject({ ok: false, ma: "VUOT_HAN_MUC" });
    expect(co(100, 1)).toMatchObject({ ok: false, ma: "VUOT_HAN_MUC" });
    expect(co(120, 1)).toMatchObject({ ok: false, ma: "VUOT_HAN_MUC" }); // đã vượt do Admin hạ hạn mức giữa tháng ⇒ không âm ra "còn"
  });

  it("[HM-03] TRỪ coin cũng ăn hạn mức theo trị tuyệt đối", () => {
    expect(kiemTraCapCoinGiaoVien({ capThang: 20, daDungTrongThang: 15, amount: -6, laHocVienPhuTrach: true })).toMatchObject({ ok: false, ma: "VUOT_HAN_MUC" });
    expect(kiemTraCapCoinGiaoVien({ capThang: 20, daDungTrongThang: 15, amount: -5, laHocVienPhuTrach: true })).toMatchObject({ ok: true });
  });

  it("[HM-04] chưa đặt hạn mức ⇒ KHÔNG được (fail-closed); hạn mức 0 ⇒ cũng không", () => {
    expect(kiemTraCapCoinGiaoVien({ capThang: null, daDungTrongThang: 0, amount: 1, laHocVienPhuTrach: true })).toMatchObject({ ok: false, ma: "CHUA_CO_HAN_MUC" });
    expect(kiemTraCapCoinGiaoVien({ capThang: 0, daDungTrongThang: 0, amount: 1, laHocVienPhuTrach: true })).toMatchObject({ ok: false, ma: "VUOT_HAN_MUC" });
  });

  it("[HM-05] không phải học viên mình phụ trách ⇒ từ chối TRƯỚC khi nói gì về hạn mức", () => {
    const r = kiemTraCapCoinGiaoVien({ capThang: null, daDungTrongThang: 0, amount: 5, laHocVienPhuTrach: false });
    expect(r).toMatchObject({ ok: false, ma: "KHONG_PHAI_HOC_VIEN_PHU_TRACH" });
  });

  it("[HM-06] số coin 0 / lẻ / NaN ⇒ không hợp lệ", () => {
    for (const a of [0, 1.5, Number.NaN]) expect(kiemTraCapCoinGiaoVien({ capThang: 10, daDungTrongThang: 0, amount: a, laHocVienPhuTrach: true })).toMatchObject({ ok: false, ma: "SO_COIN_KHONG_HOP_LE" });
  });

  it("[HM-07] tháng tính theo giờ VIỆT NAM: 00:30 ngày 01 (VN) đã thuộc tháng mới dù còn là 31 ở UTC", () => {
    // 2026-10-31T17:30:00Z = 2026-11-01 00:30 giờ VN
    const k = khoangThangVn(new Date("2026-10-31T17:30:00Z"));
    expect(k.nhan).toBe("11/2026");
    expect(k.tu.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(k.den.toISOString()).toBe("2026-11-30T17:00:00.000Z");
    // 23:30 ngày 31/10 VN (= 16:30Z) vẫn là tháng 10.
    expect(khoangThangVn(new Date("2026-10-31T16:30:00Z")).nhan).toBe("10/2026");
    // Qua năm: 31/12 23:59 VN ⇒ 12/2026; 01/01 00:00 VN ⇒ 01/2027
    expect(khoangThangVn(new Date("2026-12-31T16:59:00Z")).nhan).toBe("12/2026");
    expect(khoangThangVn(new Date("2026-12-31T17:00:00Z")).nhan).toBe("01/2027");
  });
});
