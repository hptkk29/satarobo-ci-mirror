/**
 * [SKC-*] Tính toán THUẦN của sổ sức khoẻ ở cổng phụ huynh.
 *   [SKC-01] BMI + phân loại châu Á ở đúng biên 18,5 / 23 / 25 / 30; trẻ em và mang thai KHÔNG phân loại
 *   [SKC-02] khuôn lời khuyên theo tuổi / thai kỳ / bệnh nền / BMI
 *   [SKC-03] năng lượng ước tính (Mifflin–St Jeor × hệ số) khớp công thức của thiết kế; null cho trẻ em / thai kỳ
 *   [SKC-04] kiểm số đo (ngày tương lai, chiều cao/cân nặng vô lý) — ngày hôm nay TRUYỀN vào, không đọc đồng hồ (luật 19)
 *   [SKC-05] giữ tối đa 3 bản, bản cũ nhất bị thay; sắp theo ngày
 *   [SKC-06] thước vùng + xu hướng + nhãn thứ
 */
import { describe, expect, it } from "vitest";
import {
  bmiCua,
  diemXuHuong,
  khuonCua,
  kiemBan,
  laTreEm,
  nangLuongUocTinh,
  nhanThu,
  phanLoaiBmi,
  themBan,
  TOI_DA_BAN,
  viTriKim,
  type Ban,
} from "./so-cong";
import { datHomNay } from "./dong-co-goc";

datHomNay("2026-11-08");
const NL = { ns: "1985-03-12", mt: false };
const ban = (id: string, ngay: string, cao = 170, nang = 65): Ban => ({ id, ngay, cao, nang, eo: null });

describe("[SKC-01] phân loại BMI", () => {
  it.each([
    [18.4, "Nhẹ cân (châu Á)"],
    [18.5, "Bình thường (châu Á)"],
    [22.9, "Bình thường (châu Á)"],
    [23, "Thừa cân (châu Á)"],
    [24.9, "Thừa cân (châu Á)"],
    [25, "Béo phì độ I (châu Á)"],
    [29.9, "Béo phì độ I (châu Á)"],
    [30, "Béo phì độ II (châu Á)"],
  ])("BMI %s ⇒ %s", (bmi, ten) => {
    expect(phanLoaiBmi(NL, bmi).ten).toBe(ten);
  });
  it("BMI 72 kg / 1,72 m = 24,3", () => {
    expect(bmiCua({ cao: 172, nang: 72 })).toBeCloseTo(24.34, 2);
  });
  it("trẻ em (<18 tuổi) và người mang thai KHÔNG bị phân loại, dù BMI 'đẹp' hay 'xấu'", () => {
    for (const bmi of [12, 17, 22, 28, 35]) {
      expect(phanLoaiBmi({ ns: "2016-06-01", mt: false }, bmi).loai).toBe("chua");
      expect(phanLoaiBmi({ ns: "1990-01-01", mt: true }, bmi).loai).toBe("chua");
    }
    expect(laTreEm("2008-11-09")).toBe(true); // còn 1 ngày nữa mới đủ 18
    expect(laTreEm("2008-11-08")).toBe(false);
  });
});

describe("[SKC-02] khuôn lời khuyên", () => {
  it("theo nhóm tuổi, thai kỳ, bệnh nền, BMI", () => {
    expect(khuonCua({ ns: "2023-01-01", mt: false, benhNen: false }, 16)).toBe("tre-nho");
    expect(khuonCua({ ns: "2016-06-01", mt: false, benhNen: false }, 17)).toBe("tre");
    expect(khuonCua({ ns: "1990-01-01", mt: true, benhNen: false }, 21)).toBe("dac-biet");
    expect(khuonCua({ ns: "1990-01-01", mt: false, benhNen: true }, 21)).toBe("dac-biet");
    expect(khuonCua({ ns: "1990-01-01", mt: false, benhNen: false }, 18)).toBe("nl-nhe-can");
    expect(khuonCua({ ns: "1990-01-01", mt: false, benhNen: false }, 21)).toBe("nl-binh-thuong");
    expect(khuonCua({ ns: "1990-01-01", mt: false, benhNen: false }, 23)).toBe("nl-can-chu-y");
  });
});

describe("[SKC-03] năng lượng ước tính", () => {
  it("nam 41 tuổi 172 cm 72 kg, vận động vừa: (10·72 + 6,25·172 − 5·41 + 5) × 1,55 ≈ 2.470", () => {
    expect(nangLuongUocTinh({ ns: "1985-03-12", gt: "nam", hoatDong: "vua", mt: false }, { cao: 172, nang: 72 })).toBe(2470);
  });
  it("nữ trừ 161 thay vì cộng 5; hệ số theo mức vận động", () => {
    const n = { ns: "1985-03-12", gt: "nu" as const, mt: false };
    const b = { cao: 160, nang: 55 };
    const it_ = nangLuongUocTinh({ ...n, hoatDong: "it" }, b)!;
    const nhieu = nangLuongUocTinh({ ...n, hoatDong: "nhieu" }, b)!;
    expect(it_).toBeLessThan(nangLuongUocTinh({ ...n, hoatDong: "vua" }, b)!);
    expect(nhieu).toBeGreaterThan(nangLuongUocTinh({ ...n, hoatDong: "vua" }, b)!);
    expect(it_).toBe(Math.round(((10 * 55 + 6.25 * 160 - 5 * 41 - 161) * 1.2) / 10) * 10);
  });
  it("trẻ em và thai kỳ ⇒ null (không ước tính)", () => {
    expect(nangLuongUocTinh({ ns: "2016-06-01", gt: "nam", hoatDong: "vua", mt: false }, { cao: 140, nang: 34 })).toBeNull();
    expect(nangLuongUocTinh({ ns: "1990-01-01", gt: "nu", hoatDong: "vua", mt: true }, { cao: 160, nang: 60 })).toBeNull();
  });
});

describe("[SKC-04] kiểm số đo", () => {
  const ok = { ngay: "2026-11-08", cao: 172, nang: 72, eo: null };
  it("hợp lệ ⇒ null; từng lỗi một", () => {
    expect(kiemBan(ok, "2026-11-08")).toBeNull();
    expect(kiemBan({ ...ok, ngay: "" }, "2026-11-08")).toBe("THIEU_NGAY");
    expect(kiemBan({ ...ok, ngay: "2026-11-09" }, "2026-11-08")).toBe("NGAY_TUONG_LAI");
    expect(kiemBan({ ...ok, cao: 1720 }, "2026-11-08")).toBe("CAO_SAI");
    expect(kiemBan({ ...ok, cao: 39 }, "2026-11-08")).toBe("CAO_SAI");
    expect(kiemBan({ ...ok, nang: 1 }, "2026-11-08")).toBe("NANG_SAI");
    expect(kiemBan({ ...ok, nang: Number.NaN }, "2026-11-08")).toBe("NANG_SAI");
    expect(kiemBan({ ...ok, eo: 5 }, "2026-11-08")).toBe("EO_SAI");
    expect(kiemBan({ ...ok, eo: 90 }, "2026-11-08")).toBeNull();
  });
});

describe("[SKC-05] giữ tối đa 3 bản", () => {
  it("bản thứ 4 đẩy bản CŨ NHẤT ra (theo ngày, không theo thứ tự nhập)", () => {
    let ds: Ban[] = [];
    for (const [id, ngay] of [["a", "2026-05-05"], ["b", "2026-08-10"], ["c", "2026-11-02"]] as const) ds = themBan(ds, ban(id, ngay)).ban;
    expect(ds.map((b) => b.id)).toEqual(["c", "b", "a"]);
    const kq = themBan(ds, ban("d", "2026-11-08"));
    expect(kq.ban).toHaveLength(TOI_DA_BAN);
    expect(kq.ban.map((b) => b.id)).toEqual(["d", "c", "b"]);
    expect(kq.bi_thay?.id).toBe("a");
    // nhập một bản CŨ hơn cả 3 bản ⇒ chính nó bị loại, danh sách không đổi
    const cu = themBan(ds, ban("e", "2026-01-01"));
    expect(cu.bi_thay?.id).toBe("e");
    expect(cu.ban.map((b) => b.id)).toEqual(["c", "b", "a"]);
  });
});

describe("[SKC-06] thước · xu hướng · thứ", () => {
  it("kim kẹp 2–98% theo BMI 15→32", () => {
    expect(viTriKim(10)).toBe(2);
    expect(viTriKim(40)).toBe(98);
    expect(viTriKim(23.5)).toBeCloseTo(50, 5);
  });
  it("xu hướng: 1 bản ⇒ đường phẳng; nhiều bản ⇒ mới nhất ở bên phải", () => {
    expect(diemXuHuong([ban("a", "2026-11-02")])).toBe("6,14 78,14");
    const p = diemXuHuong([ban("c", "2026-11-02", 170, 70), ban("b", "2026-08-10", 170, 65), ban("a", "2026-05-05", 170, 60)]).split(" ");
    expect(p).toHaveLength(3);
    expect(p[0]!.startsWith("6,")).toBe(true);
    expect(p[2]!.startsWith("78,")).toBe(true);
    const y = (i: number) => Number(p[i]!.split(",")[1]);
    expect(y(2)).toBeLessThan(y(0)); // cân tăng dần ⇒ điểm mới nhất CAO hơn (y nhỏ hơn)
  });
  it("nhãn thứ: 08/11/2026 là Chủ nhật; 05/11 là thứ Năm", () => {
    expect(nhanThu("2026-11-08")).toBe("CN");
    expect(nhanThu("2026-11-05")).toBe("T5");
    expect(nhanThu("2026-11-02")).toBe("T2");
  });
});
