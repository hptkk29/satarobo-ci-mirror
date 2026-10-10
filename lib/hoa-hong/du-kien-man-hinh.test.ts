// @vitest-environment node
/**
 * [NHH-SO-DK-*] — khối "Hoa hồng dự kiến của bạn" trên lead / đơn (06 §5.6, 04 §16): dựng view-model từ kết quả `duKienCuaToi`. THUẦN.
 *
 * Luật: chỉ phần CỦA CHÍNH MÌNH (không tổng, không vai khác); chưa tính được ⇒ "Chưa thể tính" + lý do, KHÔNG BAO GIỜ "0đ"; không có gì để nói ⇒ ẩn khối.
 */
import { describe, it, expect } from "vitest";

import type { DongSoHienThi, KetQuaDuKien } from "./doc-so";
import { dungDuKienManHinh } from "./du-kien-man-hinh";

const dongGhi = (p: Partial<DongSoHienThi> = {}): DongSoHienThi => ({
  id: "e1",
  kyGhi: "2026-10",
  kyHieuLuc: "2026-10",
  lateArrival: false,
  kind: "ORIGINAL",
  paymentId: "p1",
  orderId: "o1",
  studentId: "s1",
  leadId: "l1",
  roleCode: "SALE",
  nguoiHuong: { kind: "USER", id: "u1", ten: "Tôi" },
  amount: 80_000,
  grossAmount: 4_000_000,
  netBase: 4_000_000,
  vatRate: 0,
  rate: 0.02,
  nhomNguon: "PAID_ADS",
  tenNhomNguon: "Quảng cáo",
  tenVai: "Sale",
  vanBan: "SR.QD.208",
  versionNo: 1,
  loaiGiaoDich: "NEW",
  lyDo: "x",
  maLyDo: null,
  centerId: "c1",
  payoutStatus: "PENDING",
  refEntryId: null,
  taoLuc: new Date("2026-10-12T00:00:00Z"),
  ...p,
});

const kq = (p: Partial<KetQuaDuKien> = {}): KetQuaDuKien => ({ daGhiCuaToi: [], duKienCuaToi: [], giaDinh: [], chuaTinhDuoc: [], ...p });
const TEN_VAI = new Map([
  ["SALE", "Sale"],
  ["CENTER_MANAGER", "Quản lý cơ sở"],
]);

describe("[NHH-SO-DK] dungDuKienManHinh", () => {
  it("[NHH-SO-DK-01] không có gì để nói (không dòng đã ghi, không dự kiến, không lý do) ⇒ ẨN khối — không in '0đ'", () => {
    expect(dungDuKienManHinh({ kq: kq(), laNguoiLienQuan: true, tenVai: TEN_VAI })).toEqual({ loai: "AN" });
    expect(dungDuKienManHinh({ kq: kq(), laNguoiLienQuan: false, tenVai: TEN_VAI })).toEqual({ loai: "AN" });
  });

  it("[NHH-SO-DK-02] dòng ĐÃ GHI của mình: tổng + từng dòng kèm 'khoản … đã thu'", () => {
    const v = dungDuKienManHinh({ kq: kq({ daGhiCuaToi: [dongGhi(), dongGhi({ id: "e2", amount: -32_000, grossAmount: -1_600_000, kind: "REVERSAL", refEntryId: "e1" })] }), laNguoiLienQuan: false, tenVai: TEN_VAI });
    expect(v.loai).toBe("HIEN");
    if (v.loai !== "HIEN") return;
    expect(v.daGhi.tong).toBe(48_000);
    expect(v.daGhi.dong.map((d) => [d.id, d.soTien, d.khoanThu, d.vai, d.ky])).toEqual([
      ["e1", 80_000, 4_000_000, "Sale", "10/2026"],
      ["e2", -32_000, -1_600_000, "Sale", "10/2026"],
    ]);
  });

  it("[NHH-SO-DK-03] dự kiến: tổng theo vai bằng TÊN vai; vai lạ giữ mã (không ném)", () => {
    const v = dungDuKienManHinh({
      kq: kq({ duKienCuaToi: [{ orderItemId: "i1", roleCode: "SALE", soTien: 160_000, lyDo: "x" }, { orderItemId: "i1", roleCode: "VAI_LA", soTien: 10_000, lyDo: "x" }] }),
      laNguoiLienQuan: false,
      tenVai: TEN_VAI,
    });
    if (v.loai !== "HIEN") throw new Error("phải hiện");
    expect(v.duKien?.tong).toBe(170_000);
    expect(v.duKien?.dong).toEqual([
      { vai: "Sale", soTien: 160_000 },
      { vai: "VAI_LA", soTien: 10_000 },
    ]);
  });

  it("[NHH-SO-DK-03b] nhiều dòng học phí CÙNG vai ⇒ gộp thành MỘT dòng theo vai (tổng đúng), vai khác vẫn tách", () => {
    const v = dungDuKienManHinh({
      kq: kq({
        duKienCuaToi: [
          { orderItemId: "i1", roleCode: "SALE", soTien: 120_000, lyDo: "x" },
          { orderItemId: "i2", roleCode: "SALE", soTien: 800_000, lyDo: "x" },
          { orderItemId: "i2", roleCode: "CENTER_MANAGER", soTien: 40_000, lyDo: "x" },
        ],
      }),
      laNguoiLienQuan: false,
      tenVai: TEN_VAI,
    });
    if (v.loai !== "HIEN") throw new Error("phải hiện");
    expect(v.duKien?.dong).toEqual([
      { vai: "Sale", soTien: 920_000 },
      { vai: "Quản lý cơ sở", soTien: 40_000 },
    ]);
    expect(v.duKien?.tong).toBe(960_000);
  });

  it("[NHH-SO-DK-04] CHƯA THỂ TÍNH: có lý do thì hiện lý do (không '0đ'); dedupe lý do trùng", () => {
    const v = dungDuKienManHinh({
      kq: kq({ chuaTinhDuoc: [{ orderItemId: "i1", lyDo: "Dòng học phí chưa gắn học viên." }, { orderItemId: "i2", lyDo: "Dòng học phí chưa gắn học viên." }] }),
      laNguoiLienQuan: true,
      tenVai: TEN_VAI,
    });
    if (v.loai !== "HIEN") throw new Error("phải hiện");
    expect(v.chuaThe).toEqual(["Dòng học phí chưa gắn học viên."]);
    expect(v.duKien).toBeNull();
  });

  it("[NHH-SO-DK-05] người KHÔNG liên quan đến lead/đơn không bị nhồi lý do 'chưa thể tính' (nhiễu cho mọi vai nội bộ); đối chứng: có dòng của mình thì vẫn hiện", () => {
    const loi = kq({ chuaTinhDuoc: [{ orderItemId: "i1", lyDo: "Dòng học phí chưa gắn học viên." }] });
    expect(dungDuKienManHinh({ kq: loi, laNguoiLienQuan: false, tenVai: TEN_VAI })).toEqual({ loai: "AN" });
    const co = dungDuKienManHinh({ kq: { ...loi, daGhiCuaToi: [dongGhi()] }, laNguoiLienQuan: false, tenVai: TEN_VAI });
    expect(co.loai).toBe("HIEN");
    if (co.loai === "HIEN") expect(co.chuaThe).toEqual([]);
  });

  it("[NHH-SO-DK-06] lời giả định chỉ hiện khi CÓ dự kiến; dòng báo lỗi kỹ thuật ('Dòng <id>: …') không lọt ra màn", () => {
    const giaDinh = ["Tính theo chính sách và VAT áp dụng HÔM NAY, giả định thu đủ phần học phí còn lại.", "Dòng i1: chưa phân loại được NEW/RENEWAL — chưa có dự kiến."];
    const co = dungDuKienManHinh({ kq: kq({ giaDinh, duKienCuaToi: [{ orderItemId: "i1", roleCode: "SALE", soTien: 1, lyDo: "x" }] }), laNguoiLienQuan: false, tenVai: TEN_VAI });
    if (co.loai !== "HIEN") throw new Error("phải hiện");
    expect(co.giaDinh).toEqual([giaDinh[0]]);
    const khong = dungDuKienManHinh({ kq: kq({ giaDinh, daGhiCuaToi: [dongGhi()] }), laNguoiLienQuan: false, tenVai: TEN_VAI });
    if (khong.loai !== "HIEN") throw new Error("phải hiện");
    expect(khong.giaDinh).toEqual([]);
  });

  it("[NHH-SO-DK-07] dự kiến = 0 (đã thu đủ, engine không còn gì thêm) KHÔNG tạo dòng 'Dự kiến thêm 0đ'", () => {
    const v = dungDuKienManHinh({ kq: kq({ daGhiCuaToi: [dongGhi()], duKienCuaToi: [] }), laNguoiLienQuan: false, tenVai: TEN_VAI });
    if (v.loai !== "HIEN") throw new Error("phải hiện");
    expect(v.duKien).toBeNull();
  });

  it("[NHH-SO-DK-08] chỉ ghi dòng CỦA MÌNH: view-model không mang tên người khác / vai khác", () => {
    const v = dungDuKienManHinh({ kq: kq({ daGhiCuaToi: [dongGhi()] }), laNguoiLienQuan: false, tenVai: TEN_VAI });
    expect(JSON.stringify(v)).not.toContain("Tôi"); // tên người hưởng không cần lặp lại trên màn của chính họ
    expect(Object.keys((v as { daGhi: { dong: object[] } }).daGhi.dong[0]!).sort()).toEqual(["id", "khoanThu", "ky", "soTien", "vai"]);
  });
});
