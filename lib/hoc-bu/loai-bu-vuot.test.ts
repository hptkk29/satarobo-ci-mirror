import { describe, expect, it } from "vitest";
import { docLocLoai, kiemCungLoai, kiemHopVoiCase, loaiCuaCaseTuDong, loaiTuMaPhanLoai, loaiTuNguon } from "./loai-bu-vuot";

describe("loai-bu-vuot", () => {
  it("[LBV-01] chỉ ORDER_CONVERSION là học vượt; mọi nguồn khác (kể cả lạ / thiếu / di trú) là học bù", () => {
    expect(loaiTuNguon("ORDER_CONVERSION")).toBe("VUOT");
    for (const s of ["ABSENCE", "MANUAL", "SYSTEM_MIGRATION", "OTHER", "", null, undefined, "order_conversion"]) {
      expect(loaiTuNguon(s as string | null | undefined)).toBe("BU");
    }
  });

  it("[LBV-02] mã phân loại buổi: VUOT ⇒ vượt; BU / null / mã khác ⇒ bù", () => {
    expect(loaiTuMaPhanLoai("VUOT")).toBe("VUOT");
    expect(loaiTuMaPhanLoai("BU")).toBe("BU");
    expect(loaiTuMaPhanLoai(null)).toBe("BU");
    expect(loaiTuMaPhanLoai("CHINH_THUC")).toBe("BU");
  });

  it("[LBV-03] bộ lọc URL chỉ nhận bu / vuot", () => {
    expect(docLocLoai("vuot")).toBe("VUOT");
    expect(docLocLoai(" BU ")).toBe("BU");
    expect(docLocLoai("tat-ca")).toBeUndefined();
    expect(docLocLoai(undefined)).toBeUndefined();
  });

  it("[LBV-04] toàn vượt ⇒ VUOT; toàn bù ⇒ BU", () => {
    expect(kiemCungLoai([{ hocVien: "An", loai: "VUOT" }, { hocVien: "Bình", loai: "VUOT" }])).toEqual({ ok: true, loai: "VUOT" });
    expect(kiemCungLoai([{ hocVien: "An", loai: "BU" }])).toEqual({ ok: true, loai: "BU" });
  });

  it("[LBV-05] trộn vượt + bù ⇒ từ chối, nêu tên bé của từng loại", () => {
    const kq = kiemCungLoai([{ hocVien: "An", loai: "VUOT" }, { hocVien: "Bình", loai: "BU" }]);
    expect(kq.ok).toBe(false);
    if (!kq.ok) {
      expect(kq.lyDo).toContain("học vượt: An");
      expect(kq.lyDo).toContain("học bù: Bình");
    }
  });

  it("[LBV-06] cùng một bé có cả dòng vượt lẫn bù cũng KHÔNG xếp chung", () => {
    expect(kiemCungLoai([{ hocVien: "An", loai: "VUOT" }, { hocVien: "An", loai: "BU" }]).ok).toBe(false);
  });

  it("[LBV-07] thêm vào case: cùng loại ⇒ qua; khác loại ⇒ câu từ chối; case trống ⇒ qua", () => {
    expect(kiemHopVoiCase("VUOT", [{ hocVien: "An", loai: "VUOT" }])).toBeNull();
    expect(kiemHopVoiCase(null, [{ hocVien: "An", loai: "VUOT" }])).toBeNull();
    expect(kiemHopVoiCase("VUOT", [{ hocVien: "Bình", loai: "BU" }])).toMatch(/HỌC VƯỢT.*Bình/);
    expect(kiemHopVoiCase("BU", [{ hocVien: "An", loai: "VUOT" }])).toMatch(/HỌC BÙ.*An/);
  });

  it("[LBV-08] loại của case từ các dòng còn lại; không còn dòng ⇒ null", () => {
    expect(loaiCuaCaseTuDong([])).toBeNull();
    expect(loaiCuaCaseTuDong(["VUOT", "VUOT"])).toBe("VUOT");
    expect(loaiCuaCaseTuDong(["BU"])).toBe("BU");
    expect(loaiCuaCaseTuDong(["VUOT", "BU"])).toBe("BU");
  });
});
