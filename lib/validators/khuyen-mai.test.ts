// @vitest-environment node
// Khuôn đầu vào của module Chính sách khuyến mãi — các luật chặn ở CỬA, trước khi chạm DB.
import { describe, it, expect } from "vitest";
import { chinhSachSchema, thuHoiSchema, voucherSchema } from "./khuyen-mai";

const coBan = {
  maVanBan: "SR.QD.233",
  ten: "Back To School",
  noiDungUuDai: "Giảm 10% học phí khoá Sata 3.",
  tuNgay: "2026-09-01",
  denNgay: "2026-12-31",
};

describe("[KM-VL] chính sách", () => {
  it("[KM-VL-01] mã văn bản chuẩn hoá CHỮ HOA — 'sr.qd.233' và 'SR.QD.233' là MỘT văn bản", () => {
    expect(chinhSachSchema.parse({ ...coBan, maVanBan: " sr.qd.233 " }).maVanBan).toBe("SR.QD.233");
  });
  it("[KM-VL-02] ngày kết thúc trước ngày bắt đầu ⇒ từ chối ở trường denNgay", () => {
    const r = chinhSachSchema.safeParse({ ...coBan, tuNgay: "2026-12-31", denNgay: "2026-09-01" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["denNgay"]);
  });
  it("[KM-VL-03] ngày không có thật (30/02) ⇒ từ chối", () => {
    expect(chinhSachSchema.safeParse({ ...coBan, tuNgay: "2026-02-30" }).success).toBe(false);
  });
  it("[KM-VL-04] ưu đãi quá ngắn ⇒ từ chối (Sale cần một câu đọc được)", () => {
    expect(chinhSachSchema.safeParse({ ...coBan, noiDungUuDai: "giảm" }).success).toBe(false);
  });
  it("[KM-VL-05] điều kiện rỗng ⇒ null; phạm vi mặc định rỗng (= toàn hệ thống / mọi khoá)", () => {
    const v = chinhSachSchema.parse({ ...coBan, dieuKien: "  " });
    expect(v.dieuKien).toBeNull();
    expect(v.coSo).toEqual([]);
    expect(v.khoaHoc).toEqual([]);
    expect(v.tep).toBeNull();
  });
  it("[KM-VL-06] thu hồi đòi lý do ≥ 10 ký tự", () => {
    expect(thuHoiSchema.safeParse({ id: "x", lyDo: "ngắn" }).success).toBe(false);
    expect(thuHoiSchema.safeParse({ id: "x", lyDo: "Hết ngân sách chương trình" }).success).toBe(true);
  });
});

describe("[KM-VV] mã voucher", () => {
  const v = { chinhSachId: "cs1", ma: "bts2026", kieu: "PERCENT" as const, phanTram: 10 };
  it("[KM-VV-01] mã chuẩn hoá chữ hoa; ký tự lạ bị từ chối", () => {
    expect(voucherSchema.parse(v).ma).toBe("BTS2026");
    expect(voucherSchema.safeParse({ ...v, ma: "BTS 2026" }).success).toBe(false);
    expect(voucherSchema.safeParse({ ...v, ma: "AB" }).success).toBe(false);
  });
  it("[KM-VV-02] giảm % mà thiếu phần trăm ⇒ từ chối ở đúng trường", () => {
    const r = voucherSchema.safeParse({ ...v, phanTram: null });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["phanTram"]);
  });
  it("[KM-VV-03] giảm tiền mà thiếu số tiền ⇒ từ chối; % ngoài 1–100 ⇒ từ chối", () => {
    expect(voucherSchema.safeParse({ ...v, kieu: "FIXED", phanTram: null }).success).toBe(false);
    expect(voucherSchema.safeParse({ ...v, phanTram: 101 }).success).toBe(false);
    expect(voucherSchema.safeParse({ ...v, kieu: "FIXED", phanTram: null, soTien: 300_000 }).success).toBe(true);
  });
});
