import { describe, expect, it } from "vitest";
import { diemTrungBinh, kieuBaiThi, trangThaiBai, thiKeTiep, tomTatBai, type BaiThi, type BaiVe } from "@/lib/portal/bai-tap-thuan";

const NOW = new Date("2026-11-02T03:00:00Z");
const b = (o: Partial<BaiVe>): BaiVe => ({ id: "x", tieuDe: "Bài", nhanPhu: "", trangThai: "da-cham", hanISO: null, nopISO: null, diem: { diem: 9, toiDa: 10 }, loiThay: null, ...o });

describe("[BT-01] phân loại bài", () => {
  it("đã nộp / đã chấm / quá hạn / chưa nộp", () => {
    expect(trangThaiBai({ status: "GRADED", dueISO: null, now: NOW })).toBe("da-cham");
    expect(trangThaiBai({ status: "SUBMITTED", dueISO: null, now: NOW })).toBe("cho-cham");
    expect(trangThaiBai({ status: "LATE", dueISO: null, now: NOW })).toBe("cho-cham");
    expect(trangThaiBai({ status: "MISSED", dueISO: null, now: NOW })).toBe("qua-han");
    expect(trangThaiBai({ status: "NOT_SUBMITTED", dueISO: "2026-10-30T00:00:00Z", now: NOW })).toBe("qua-han");
    expect(trangThaiBai({ status: "ASSIGNED", dueISO: "2026-11-06T00:00:00Z", now: NOW })).toBe("chua-nop");
  });
});

describe("[BT-02] điểm trung bình", () => {
  it("chỉ tính bài đã chấm, quy về thang 10", () => {
    const r = diemTrungBinh([b({ diem: { diem: 9, toiDa: 10 } }), b({ diem: { diem: 4, toiDa: 5 } }), b({ trangThai: "cho-cham", diem: null })]);
    expect(r).toMatchObject({ chu: "8,5", soBai: 2 });
  });
  it("không bài nào đã chấm ⇒ null (không bịa 0)", () => {
    expect(diemTrungBinh([b({ trangThai: "chua-nop", diem: null })])).toBeNull();
    expect(diemTrungBinh([b({ diem: { diem: 3, toiDa: 0 } })])).toBeNull();
  });
  it("tóm tắt: đếm đã nộp gồm cả chờ chấm", () => {
    const t = tomTatBai([b({}), b({ trangThai: "cho-cham", diem: null }), b({ trangThai: "chua-nop", diem: null }), b({ trangThai: "qua-han", diem: null })]);
    expect(t).toMatchObject({ giao: 4, daNop: 2 });
    expect(t.canLam).toHaveLength(2);
  });
});

describe("[BT-03] bài thi", () => {
  const t = (o: Partial<BaiThi>): BaiThi => ({ id: "t", tieuDe: "Thi", moISO: null, dongISO: null, phut: 30, daThi: false, diem: null, ...o });
  it("kiểu: đã thi > sắp mở > hết hạn > đang mở", () => {
    expect(kieuBaiThi(t({ daThi: true }), NOW)).toBe("da-thi");
    expect(kieuBaiThi(t({ moISO: "2026-12-05T00:00:00Z" }), NOW)).toBe("sap-mo");
    expect(kieuBaiThi(t({ dongISO: "2026-10-01T00:00:00Z" }), NOW)).toBe("het-han");
    expect(kieuBaiThi(t({}), NOW)).toBe("dang-mo");
  });
  it("kế tiếp: đang mở thắng; không thì sắp mở gần nhất; không có ⇒ null", () => {
    const xa = t({ id: "xa", moISO: "2027-02-27T00:00:00Z" });
    const gan = t({ id: "gan", moISO: "2026-12-05T00:00:00Z" });
    expect(thiKeTiep([xa, gan], NOW)?.id).toBe("gan");
    expect(thiKeTiep([xa, gan, t({ id: "mo" })], NOW)?.id).toBe("mo");
    expect(thiKeTiep([t({ daThi: true })], NOW)).toBeNull();
  });
});
