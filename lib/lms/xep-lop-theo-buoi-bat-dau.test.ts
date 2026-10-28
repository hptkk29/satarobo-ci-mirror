import { describe, expect, it } from "vitest";
import {
  canKhaiHocVuot,
  khoangBuoiBatDau,
  kiemBuoiBatDau,
  kiemSoBuoiBu,
  tuDuyetHocVuot,
  vaiChonDuoc,
  vaiThayLop,
  xetTheoBuoiBatDau,
} from "./xep-lop-theo-buoi-bat-dau";

const khoa48 = { tongSoBuoiKhoa: 48 };

describe("khoangBuoiBatDau", () => {
  it("[XBD-01] mua đủ khoá ⇒ chỉ buổi 1", () => {
    expect(khoangBuoiBatDau({ ...khoa48, soBuoiMua: 48 })).toMatchObject({ min: 1, max: 1, macDinh: 1, muaDuKhoa: true });
    expect(khoangBuoiBatDau({ ...khoa48, soBuoiMua: null })).toMatchObject({ max: 1, muaDuKhoa: true });
  });
  it("[XBD-02] mua 24/48 ⇒ S ∈ [1, 25], mặc định 25 (nếp 'học các buổi cuối')", () => {
    expect(khoangBuoiBatDau({ ...khoa48, soBuoiMua: 24 })).toEqual({ min: 1, max: 25, macDinh: 25, muaDuKhoa: false });
  });
  it("[XBD-03] khoá không khai số buổi hoặc mua > tổng ⇒ null", () => {
    expect(khoangBuoiBatDau({ tongSoBuoiKhoa: null, soBuoiMua: 12 })).toBeNull();
    expect(khoangBuoiBatDau({ ...khoa48, soBuoiMua: 60 })).toBeNull();
  });
});

describe("kiemBuoiBatDau", () => {
  it("[XBD-04] ngoài khoảng ⇒ từ chối; trong khoảng ⇒ null", () => {
    expect(kiemBuoiBatDau({ ...khoa48, soBuoiMua: 24 }, 26)).toMatch(/từ 1 đến 25/);
    expect(kiemBuoiBatDau({ ...khoa48, soBuoiMua: 24 }, 0)).toMatch(/số nguyên/);
    expect(kiemBuoiBatDau({ ...khoa48, soBuoiMua: 24 }, 13)).toBeNull();
    expect(kiemBuoiBatDau({ ...khoa48, soBuoiMua: 48 }, 2)).toMatch(/đủ khoá/);
  });
});

describe("xetTheoBuoiBatDau", () => {
  const x = (soBuoiMua: number | null, buoiBatDau: number | null, soBuoiDaQua: number, tran = 6) =>
    xetTheoBuoiBatDau({ ...khoa48, soBuoiMua, buoiBatDau, soBuoiDaQua, tran });

  it("[XBD-05] lớp chưa học buổi nào, mua đủ khoá ⇒ binh_thuong", () => {
    const r = x(48, 1, 0);
    expect(r.loai).toBe("binh_thuong");
    expect(r.soBuoiCanBu).toBe(0);
    expect(canKhaiHocVuot(r)).toBe(false);
  });
  it("[XBD-06] mua 24, bắt đầu buổi 25, lớp mới ở buổi 1 ⇒ cho_toi_luot, chờ 24 buổi (câu của ảnh UAT)", () => {
    const r = x(24, 25, 0);
    expect(r.loai).toBe("cho_toi_luot");
    expect(r.soBuoiCho).toBe(24);
  });
  it("[XBD-07] lớp đã học 6 buổi, bắt đầu buổi 1, trần 6 ⇒ hoc_vuot v = 6, sale thấy", () => {
    const r = x(48, 1, 6);
    expect(r).toMatchObject({ loai: "hoc_vuot", soBuoiCanBu: 6, saleChonDuoc: true });
    expect(canKhaiHocVuot(r)).toBe(true);
  });
  it("[XBD-08] lớp đã học 7 buổi, trần 6 ⇒ qua_tran: sale KHÔNG thấy, QLCS/Admin thấy và chọn được", () => {
    const r = x(48, 1, 7);
    expect(r).toMatchObject({ loai: "qua_tran", soBuoiCanBu: 7, saleChonDuoc: false });
    expect(vaiThayLop("SALE", r)).toBe(false);
    expect(vaiChonDuoc("SALE", r)).toBe(false);
    expect(vaiThayLop("QLCS", r)).toBe(true);
    expect(vaiChonDuoc("QLCS", r)).toBe(true);
    expect(vaiChonDuoc("ADMIN", r)).toBe(true);
  });
  it("[XBD-09] trần là tham số: QLCS nâng trần lên 8 ⇒ cùng lớp hoá hoc_vuot cho sale", () => {
    expect(x(48, 1, 7, 8).loai).toBe("hoc_vuot");
    expect(x(48, 1, 7, 8).saleChonDuoc).toBe(true);
  });
  it("[XBD-10] bắt đầu muộn hơn thì bù ít hơn: mua 24, S = 13, lớp đã học 14 ⇒ v = 2", () => {
    const r = x(24, 13, 14);
    expect(r).toMatchObject({ loai: "hoc_vuot", soBuoiCanBu: 2, buoiKeTiepCuaLop: 15 });
  });
  it("[XBD-11] S để trống ⇒ dùng mặc định (tổng − mua + 1)", () => {
    expect(x(24, null, 0).buoiBatDau).toBe(25);
  });
  it("[XBD-12] S ngoài khoảng hoặc khoá không khai số buổi ⇒ khong_xet, sale vẫn thấy (fail-open có chủ đích)", () => {
    expect(x(24, 30, 0).loai).toBe("khong_xet");
    expect(xetTheoBuoiBatDau({ tongSoBuoiKhoa: null, soBuoiMua: 12, buoiBatDau: 1, soBuoiDaQua: 3, tran: 6 }).loai).toBe("khong_xet");
  });
  it("[XBD-13] đúng ví dụ chủ dự án: 48 buổi, lớp đã học 6 buổi, sale book 3 buổi bù", () => {
    const r = x(48, 1, 6);
    expect(r.soBuoiCanBu).toBe(6);
    expect(kiemSoBuoiBu(r.soBuoiCanBu, 3)).toBeNull();
  });
});

describe("kiemSoBuoiBu · tuDuyetHocVuot", () => {
  it("[XBD-14] b phải nguyên, ≥ 1, ≤ v", () => {
    expect(kiemSoBuoiBu(6, 0)).toMatch(/số nguyên/);
    expect(kiemSoBuoiBu(6, 1.5)).toMatch(/số nguyên/);
    expect(kiemSoBuoiBu(6, 7)).toMatch(/tối đa 6/);
    expect(kiemSoBuoiBu(6, undefined)).toMatch(/số nguyên/);
    expect(kiemSoBuoiBu(6, 6)).toBeNull();
  });
  it("[XBD-15] chỉ QLCS và Quản trị tối cao tự duyệt", () => {
    expect(tuDuyetHocVuot("SALE")).toBe(false);
    expect(tuDuyetHocVuot("QLCS")).toBe(true);
    expect(tuDuyetHocVuot("ADMIN")).toBe(true);
  });
});
