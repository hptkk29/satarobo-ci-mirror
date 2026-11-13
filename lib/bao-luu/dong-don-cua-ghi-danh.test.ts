// lib/bao-luu/dong-don-cua-ghi-danh.test.ts — chọn DÒNG ĐƠN của ghi danh cho ảnh chụp (C13, chốt 13). THUẦN.
//
// Số liệu mô phỏng ĐO PROD 11/10/2026 (docs/bao-luu/do-prod-11-10.md): ghi danh 9.000.000đ nhưng dòng đơn thực đóng 10.000.000đ − giảm 1.000.000đ = 9.000.000đ…
// và ca lệch thật: finalPrice khác net dòng đơn. Dữ liệu KHÔNG tròn trịa có chủ ý (luật đọc số).
import { describe, expect, it } from "vitest";
import { chonDongDonChoGhiDanh, type DongDonUngVien } from "./dong-don-cua-ghi-danh";
import { tinhAnhChup } from "./anh-chup";

const GD = { id: "gd1", courseId: "khoa-a", leadChildId: "be-1" };
const dong = (o: Partial<DongDonUngVien> = {}): DongDonUngVien => ({
  enrollmentId: null, totalPrice: 10_400_000, discountAmount: 1_040_000, metadata: { courseId: "khoa-a", leadChildId: "be-1" }, ...o,
});

describe("[DDG] chonDongDonChoGhiDanh", () => {
  it("[DDG-01] nối trực tiếp qua enrollmentId ⇒ học phí = totalPrice − discountAmount (không phải giá ghi danh), kèm nguồn", () => {
    const r = chonDongDonChoGhiDanh(GD, [dong({ enrollmentId: "gd1", metadata: { soBuoi: 24 } })]);
    expect(r).toEqual({ hocPhiRong: 9_360_000, soBuoi: 24, nguon: "dong-don.enrollmentId" });
  });

  it("[DDG-02] không nối trực tiếp ⇒ qua metadata: cùng courseId và cùng leadChildId", () => {
    expect(chonDongDonChoGhiDanh(GD, [dong()])).toMatchObject({ hocPhiRong: 9_360_000, nguon: "dong-don.metadata" });
  });

  it("[DDG-03] đơn nhiều con: dòng của bé KHÁC (leadChildId khác) không bị lấy nhầm", () => {
    const beKhac = dong({ metadata: { courseId: "khoa-a", leadChildId: "be-2" }, totalPrice: 5_000_000, discountAmount: 0 });
    expect(chonDongDonChoGhiDanh(GD, [beKhac])).toBeNull();
    expect(chonDongDonChoGhiDanh(GD, [beKhac, dong()])).toMatchObject({ hocPhiRong: 9_360_000 });
  });

  it("[DDG-04] khác khoá ⇒ không khớp", () => {
    expect(chonDongDonChoGhiDanh(GD, [dong({ metadata: { courseId: "khoa-b", leadChildId: "be-1" } })])).toBeNull();
  });

  it("[DDG-05] MƠ HỒ ⇒ null (không đoán): hai dòng cùng khớp qua metadata; hai dòng nối trực tiếp", () => {
    expect(chonDongDonChoGhiDanh(GD, [dong(), dong({ totalPrice: 8_000_000 })])).toBeNull();
    expect(chonDongDonChoGhiDanh(GD, [dong({ enrollmentId: "gd1" }), dong({ enrollmentId: "gd1", totalPrice: 8_000_000 })])).toBeNull();
  });

  it("[DDG-06] dòng đã nối ghi danh KHÁC thì không bị xét ở đường metadata; có dòng nối trực tiếp thì đường metadata KHÔNG được trộn vào", () => {
    expect(chonDongDonChoGhiDanh(GD, [dong({ enrollmentId: "gd-khac" })])).toBeNull();
    const truc = dong({ enrollmentId: "gd1", totalPrice: 7_000_000, discountAmount: 0 });
    expect(chonDongDonChoGhiDanh(GD, [truc, dong()])).toMatchObject({ hocPhiRong: 7_000_000, nguon: "dong-don.enrollmentId" });
  });

  it("[DDG-07] ghi danh không có leadChildId, hoặc dòng không có leadChildId ⇒ chỉ cần khớp khoá (đơn một con)", () => {
    expect(chonDongDonChoGhiDanh({ ...GD, leadChildId: null }, [dong()])).not.toBeNull();
    expect(chonDongDonChoGhiDanh(GD, [dong({ metadata: { courseId: "khoa-a" } })])).not.toBeNull();
  });

  it("[DDG-08] giảm giá lớn hơn giá ⇒ học phí 0, không âm", () => {
    expect(chonDongDonChoGhiDanh(GD, [dong({ totalPrice: 1_000_000, discountAmount: 1_500_000 })])?.hocPhiRong).toBe(0);
  });

  it("[DDG-09] CẶP (tiền, số buổi) từ CÙNG một dòng: dòng 24 buổi 9.360.000đ ⇒ đơn giá theo 24, không theo 48 của khoá", () => {
    const r = chonDongDonChoGhiDanh(GD, [dong({ metadata: { courseId: "khoa-a", leadChildId: "be-1", soBuoi: 24 } })])!;
    const a = tinhAnhChup({ hocPhiThuc: r.hocPhiRong, hocPhiSuyRa: false, soBuoiMua: r.soBuoi, tongBuoiKhoa: 48, soBuoiDaDung: 4 });
    expect(a).toMatchObject({ snapTuitionNet: 9_360_000, snapSoBuoiMua: 24, snapSoBuoiSuyRa: false, snapTuitionSuyRa: false, snapSessionsRemaining: 20, snapUnitPrice: 390_000 });
  });
});

describe("[DDG-T] tinhAnhChup — cờ snapTuitionSuyRa", () => {
  const co = { soBuoiMua: 48, tongBuoiKhoa: 48, soBuoiDaDung: 10 };
  it("[DDG-T1] học phí suy ra (không có dòng đơn) ⇒ cờ BẬT", () => {
    expect(tinhAnhChup({ hocPhiThuc: 9_000_000, hocPhiSuyRa: true, ...co }).snapTuitionSuyRa).toBe(true);
  });
  it("[DDG-T2] học phí lấy từ dòng đơn ⇒ cờ TẮT; không khai (undefined) cũng TẮT", () => {
    expect(tinhAnhChup({ hocPhiThuc: 9_000_000, hocPhiSuyRa: false, ...co }).snapTuitionSuyRa).toBe(false);
    expect(tinhAnhChup({ hocPhiThuc: 9_000_000, ...co }).snapTuitionSuyRa).toBe(false);
  });
  it("[DDG-T3] không có học phí nào ⇒ cờ TẮT (không có gì để suy) và tử số NULL, không 0", () => {
    const a = tinhAnhChup({ hocPhiThuc: null, hocPhiSuyRa: true, ...co });
    expect(a.snapTuitionSuyRa).toBe(false);
    expect(a.snapTuitionNet).toBeNull();
    expect(a.snapUnitPrice).toBeNull();
  });
});
