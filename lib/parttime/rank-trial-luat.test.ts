// [RTL-*] — luật THUẦN: đề xuất / duyệt Rank, chứng nhận Trial, chính sách hỗ trợ Trial theo ngày (SR.QD.238 §3 §6 + chủ dự án 24/10/2026).
// Mốc tuyệt đối, `homNay` luôn truyền (luật 19).
import { describe, expect, it } from "vitest";
import {
  chinhSachTrialTai,
  chungNhanHieuLucTai,
  keHoachDatChinhSachTrial,
  kiemCapChungNhan,
  kiemDeXuatRank,
  kiemQuyetRank,
  ngayCuoiKhiThuHoi,
  type DongChinhSachTrial,
} from "./rank-trial-luat";

const HOM_NAY = "2026-11-02";
const KHOA = new Set(["2026-10"]);

describe("[RTL-R] đề xuất / duyệt Rank", () => {
  const dx = (p: Partial<Parameters<typeof kiemDeXuatRank>[0]> = {}) =>
    kiemDeXuatRank({ currentRank: 1, proposedRank: 2, effectiveFrom: "2026-11-15", basis: "26 tháng · 96% · đạt năng lực", homNay: HOM_NAY, kyDaKhoa: KHOA, coDeXuatDangCho: false, ...p });

  it("[RTL-R01] đề xuất hợp lệ ⇒ null", () => expect(dx()).toBeNull());
  it("[RTL-R02] Rank ngoài 1–4 / bằng Rank hiện tại ⇒ từ chối", () => {
    expect(dx({ proposedRank: 5 })).toMatch(/1.*4/);
    expect(dx({ proposedRank: 1 })).toMatch(/khác Rank hiện tại/);
  });
  it("[RTL-R03] hiệu lực trước hôm nay ⇒ từ chối (không đổi giá hồi tố)", () => {
    expect(dx({ effectiveFrom: "2026-11-01" })).toMatch(/hồi tố|hôm nay/);
  });
  it("[RTL-R04] hiệu lực rơi vào tháng kỳ công đã khoá ⇒ từ chối", () => {
    expect(dx({ effectiveFrom: "2026-10-20", homNay: "2026-10-01" })).toMatch(/khoá/);
  });
  it("[RTL-R05] đã có đề xuất đang chờ ⇒ từ chối; căn cứ quá ngắn ⇒ từ chối", () => {
    expect(dx({ coDeXuatDangCho: true })).toMatch(/đang chờ/);
    expect(dx({ basis: "ok" })).toMatch(/căn cứ/i);
  });

  const qd = (p: Partial<Parameters<typeof kiemQuyetRank>[0]> = {}) =>
    kiemQuyetRank({ status: "PROPOSED", effectiveFrom: "2026-11-15", homNay: HOM_NAY, kyDaKhoa: KHOA, nguoiQuyet: "bld", nguoiDeXuat: "qlcs", duyet: true, ...p });
  it("[RTL-R06] duyệt hợp lệ ⇒ null; đề xuất không còn chờ ⇒ từ chối", () => {
    expect(qd()).toBeNull();
    expect(qd({ status: "APPROVED" })).toMatch(/không còn chờ/);
  });
  it("[RTL-R07] người lập không tự duyệt đề xuất của mình (tách vai SR.QD.238 §3)", () => {
    expect(qd({ nguoiQuyet: "qlcs" })).toMatch(/tự duyệt/);
  });
  it("[RTL-R08] DUYỆT khi ngày hiệu lực đã trôi qua / rơi vào kỳ khoá ⇒ từ chối (phải đề xuất lại); TỪ CHỐI thì luôn được", () => {
    expect(qd({ effectiveFrom: "2026-11-01" })).toMatch(/đề xuất lại/);
    expect(qd({ effectiveFrom: "2026-11-01", duyet: false })).toBeNull();
  });
});

describe("[RTL-C] chứng nhận Trial", () => {
  const cn = [{ effectiveFrom: "2026-11-05", effectiveTo: "2026-11-30" }];
  it("[RTL-C01] hiệu lực trong khoảng, gồm hai đầu; ngoài khoảng thì không", () => {
    expect(["2026-11-04", "2026-11-05", "2026-11-30", "2026-12-01"].map((d) => chungNhanHieuLucTai(cn, d))).toEqual([false, true, true, false]);
  });
  it("[RTL-C02] EV-07 cấp SAU ngày Trial ⇒ ngày Trial không có chứng nhận (không hồi tố); thu hồi SAU ngày Trial ⇒ ngày Trial vẫn hợp lệ", () => {
    expect(chungNhanHieuLucTai([{ effectiveFrom: "2026-11-10", effectiveTo: null }], "2026-11-07")).toBe(false);
    expect(chungNhanHieuLucTai([{ effectiveFrom: "2026-11-01", effectiveTo: ngayCuoiKhiThuHoi("2026-11-09") }], "2026-11-07")).toBe(true);
  });
  it("[RTL-C03] thu hồi từ ngày D ⇒ ngày cuối D − 1; thu hồi NGAY ngày cấp ⇒ chưa hiệu lực ngày nào", () => {
    expect(ngayCuoiKhiThuHoi("2026-11-09")).toBe("2026-11-08");
    const r = [{ effectiveFrom: "2026-11-02", effectiveTo: ngayCuoiKhiThuHoi("2026-11-02") }];
    expect(chungNhanHieuLucTai(r, "2026-11-02")).toBe(false);
  });
  it("[RTL-C04] cấp: hiệu lực từ trước hôm nay ⇒ từ chối (không hồi tố); chồng lên chứng nhận đang hiệu lực ⇒ từ chối", () => {
    expect(kiemCapChungNhan({ effectiveFrom: "2026-11-01", homNay: HOM_NAY, dangCo: [] })).toMatch(/hồi tố|hôm nay/);
    expect(kiemCapChungNhan({ effectiveFrom: "2026-11-10", homNay: HOM_NAY, dangCo: [{ effectiveFrom: "2026-11-01", effectiveTo: null }] })).toMatch(/đang có/);
    expect(kiemCapChungNhan({ effectiveFrom: "2026-11-10", homNay: HOM_NAY, dangCo: [{ effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" }] })).toBeNull();
  });
});

describe("[RTL-P] chính sách hỗ trợ Trial theo ngày", () => {
  const dong = (p: Partial<DongChinhSachTrial>): DongChinhSachTrial => ({ id: "x", centerId: null, enabled: true, amountPerStudent: 30000, effectiveFrom: "2026-11-01", effectiveTo: null, ...p });
  it("[RTL-P01] không dòng nào phủ ngày ⇒ null (= chưa bật)", () => {
    expect(chinhSachTrialTai([], "cs2", "2026-11-07")).toBeNull();
    expect(chinhSachTrialTai([dong({ effectiveFrom: "2026-12-01" })], "cs2", "2026-11-07")).toBeNull();
  });
  it("[RTL-P02] dòng chung áp mọi cơ sở; dòng RIÊNG của cơ sở thắng dòng chung cùng ngày", () => {
    const ds = [dong({ id: "chung" }), dong({ id: "cs1", centerId: "cs1", enabled: false })];
    expect(chinhSachTrialTai(ds, "cs2", "2026-11-07")).toEqual({ bat: true, mucMoiHocVien: 30000, dongId: "chung" });
    expect(chinhSachTrialTai(ds, "cs1", "2026-11-07")).toEqual({ bat: false, mucMoiHocVien: 30000, dongId: "cs1" });
  });
  it("[RTL-P03] hai dòng cùng phạm vi cùng phủ một ngày ⇒ NÉM (cấu hình sai — không chọn bừa)", () => {
    expect(() => chinhSachTrialTai([dong({ id: "a" }), dong({ id: "b" })], "cs2", "2026-11-07")).toThrow(/hai dòng/i);
  });
  it("[RTL-P04] đổi chính sách: thêm dòng từ ngày F ⇒ đóng dòng đang mở cùng phạm vi ở F − 1; F trước hôm nay ⇒ từ chối (không hồi tố)", () => {
    const ds = [dong({ id: "dang", effectiveFrom: "2026-10-15" })];
    expect(keHoachDatChinhSachTrial({ ds, centerId: null, effectiveFrom: "2026-11-10", homNay: HOM_NAY })).toEqual({ ok: true, dong: [{ id: "dang", effectiveTo: "2026-11-09" }] });
    expect(keHoachDatChinhSachTrial({ ds, centerId: null, effectiveFrom: "2026-11-01", homNay: HOM_NAY })).toMatchObject({ ok: false });
  });
  it("[RTL-P05] đã có dòng cùng phạm vi BẮT ĐẦU từ F trở đi ⇒ từ chối (không ghi đè lịch tương lai âm thầm); phạm vi khác không đụng", () => {
    const ds = [dong({ id: "tuongLai", effectiveFrom: "2026-11-20" }), dong({ id: "cs2", centerId: "cs2", effectiveFrom: "2026-10-15" })];
    expect(keHoachDatChinhSachTrial({ ds, centerId: null, effectiveFrom: "2026-11-10", homNay: HOM_NAY })).toMatchObject({ ok: false });
    expect(keHoachDatChinhSachTrial({ ds: [ds[1]!], centerId: null, effectiveFrom: "2026-11-10", homNay: HOM_NAY })).toEqual({ ok: true, dong: [] });
  });
});
