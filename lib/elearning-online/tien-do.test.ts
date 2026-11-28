// @vitest-environment node
/** [ONL-TD-*] Tiến độ khoá + mở bài theo cài đặt (hàm thuần). */
import { describe, expect, it } from "vitest";
import { baiCoMoDuoc, tinhTienDoKhoa, type BaiTrongBan, type TienDoBai } from "./tien-do";
import { caiDatKhoiDauChoBanNhap, type CaiDatHocTap } from "./cai-dat-hoc-tap";

let t = 0;
const b = (stableId: string, chuong: number, o: Partial<BaiTrongBan> = {}): BaiTrongBan => ({
  stableId,
  chapterStableId: `c${chuong}`,
  kind: "VIDEO",
  required: true,
  hidden: false,
  thuTu: ++t,
  thuTuChuong: chuong,
  ...o,
});
const dung = (): BaiTrongBan[] => {
  t = 0;
  return [b("1.1", 1), b("1.2", 1), b("1.k", 1, { kind: "QUIZ" }), b("2.1", 2), b("2.2", 2, { required: false }), b("2.3", 2), b("thi", 3, { kind: "FINAL_EXAM" })];
};
const cd = (o: Partial<CaiDatHocTap> = {}): CaiDatHocTap => ({ ...caiDatKhoiDauChoBanNhap(), ...o });
const td = (...xong: string[]): TienDoBai => Object.fromEntries(xong.map((s) => [s, "COMPLETED" as const]));

describe("[ONL-TD-01] tiến độ khoá", () => {
  it("chỉ đếm bài BẮT BUỘC, HIỂN THỊ, không phải thi cuối; % làm tròn XUỐNG", () => {
    const r = tinhTienDoKhoa(dung(), td("1.1", "1.2"), cd());
    expect(r).toMatchObject({ tongBaiBatBuoc: 5, daXongBatBuoc: 2, phanTram: 40, duBaiBatBuoc: false, hoanThanh: false });
    expect(tinhTienDoKhoa(dung(), td("1.1", "1.2", "1.k", "2.1"), cd()).phanTram).toBe(80);
  });

  it("🔴 % làm tròn XUỐNG: 2/3 bài ⇒ 66% (không phải 67%); 6/7 ⇒ 85%; không bao giờ báo 100% khi còn thiếu 1 bài", () => {
    t = 0;
    const ba = [b("a", 1), b("b", 1), b("c", 1)];
    expect(tinhTienDoKhoa(ba, td("a", "b"), cd()).phanTram).toBe(66);
    t = 0;
    const bay = ["a", "b", "c", "d", "e", "f", "g"].map((x) => b(x, 1));
    expect(tinhTienDoKhoa(bay, td("a", "b", "c", "d", "e", "f"), cd()).phanTram).toBe(85);
  });

  it("🔴 bài ẨN không tính vào tổng (bản mới ẩn bài); bài tuỳ chọn xong cũng không tính vào tử số", () => {
    const bai = dung().map((x) => (x.stableId === "1.2" ? { ...x, hidden: true } : x));
    const r = tinhTienDoKhoa(bai, td("1.1", "2.2"), cd());
    expect(r).toMatchObject({ tongBaiBatBuoc: 4, daXongBatBuoc: 1, phanTram: 25 });
  });

  it("🔴 hoàn thành: đủ 100% bài bắt buộc NHƯNG bật thi cuối mà chưa đạt ⇒ CHƯA; đạt thi ⇒ có; tắt thi cuối ⇒ không cần", () => {
    const tatCa = td("1.1", "1.2", "1.k", "2.1", "2.3");
    const bat = cd({ thiCuoiKhoa: { bat: true, diemDat: 70, soLanThi: 2, phut: 30 } });
    expect(tinhTienDoKhoa(dung(), tatCa, bat)).toMatchObject({ duBaiBatBuoc: true, coThiCuoi: true, thiCuoiDat: false, hoanThanh: false });
    expect(tinhTienDoKhoa(dung(), { ...tatCa, thi: "COMPLETED" }, bat).hoanThanh).toBe(true);
    expect(tinhTienDoKhoa(dung(), tatCa, cd()).hoanThanh).toBe(true);
  });

  it("ngưỡng hoàn thành < 100%: 80% bài bắt buộc là đủ; 79% chưa", () => {
    const c = cd({ khoaHoanThanhPhanTramBaiBatBuoc: 80 });
    expect(tinhTienDoKhoa(dung(), td("1.1", "1.2", "1.k", "2.1"), c).duBaiBatBuoc).toBe(true);
    expect(tinhTienDoKhoa(dung(), td("1.1", "1.2", "1.k"), c).duBaiBatBuoc).toBe(false);
  });

  it("🔴 khoá RỖNG (không bài bắt buộc) KHÔNG tự hoàn thành", () => {
    const r = tinhTienDoKhoa([], {}, cd());
    expect(r).toMatchObject({ tongBaiBatBuoc: 0, phanTram: 0, duBaiBatBuoc: false, hoanThanh: false });
  });
});

describe("[ONL-TD-02] mở bài", () => {
  it("MO_HET: mở hết (trừ thi cuối còn khoá điều kiện)", () => {
    const c = cd({ moBaiTiepTheo: "MO_HET" });
    expect(baiCoMoDuoc(dung(), {}, c, "2.3")).toEqual({ mo: true });
    expect(baiCoMoDuoc(dung(), {}, c, "thi")).toEqual({ mo: false, lyDo: "CHUA_DU_DIEU_KIEN_THI_CUOI" });
  });

  it("🔴 KHI_BAI_TRUOC_XONG: bài đầu mở; bài sau CHỈ mở khi mọi bài bắt buộc đứng trước đã xong; bài tuỳ chọn không chặn", () => {
    const c = cd({ moBaiTiepTheo: "KHI_BAI_TRUOC_XONG" });
    expect(baiCoMoDuoc(dung(), {}, c, "1.1")).toEqual({ mo: true });
    expect(baiCoMoDuoc(dung(), {}, c, "1.2")).toEqual({ mo: false, lyDo: "BAI_TRUOC_CHUA_XONG" });
    expect(baiCoMoDuoc(dung(), td("1.1"), c, "1.2")).toEqual({ mo: true });
    // 2.3 đứng sau 2.2 (tuỳ chọn): xong 1.1,1.2,1.k,2.1 là đủ để mở 2.3 dù chưa làm 2.2
    expect(baiCoMoDuoc(dung(), td("1.1", "1.2", "1.k", "2.1"), c, "2.3")).toEqual({ mo: true });
    expect(baiCoMoDuoc(dung(), td("1.1", "1.2", "1.k"), c, "2.3")).toEqual({ mo: false, lyDo: "BAI_TRUOC_CHUA_XONG" });
  });

  it("🔴 THEO_CHUONG: chương 1 mở hết; chương 2 mở khi XONG mọi bài bắt buộc chương 1 (gồm kiểm tra chương); trong chương không bắt thứ tự", () => {
    const c = cd({ moBaiTiepTheo: "THEO_CHUONG" });
    expect(baiCoMoDuoc(dung(), {}, c, "1.2")).toEqual({ mo: true });
    expect(baiCoMoDuoc(dung(), td("1.1", "1.2"), c, "2.1")).toEqual({ mo: false, lyDo: "CHUONG_TRUOC_CHUA_XONG" });
    expect(baiCoMoDuoc(dung(), td("1.1", "1.2", "1.k"), c, "2.3")).toEqual({ mo: true });
  });

  it("🔴 thi cuối khoá: mở khi đủ % bài bắt buộc, bất kể chế độ mở bài; chưa đủ ⇒ khoá", () => {
    expect(baiCoMoDuoc(dung(), td("1.1", "1.2", "1.k", "2.1", "2.3"), cd({ moBaiTiepTheo: "MO_HET" }), "thi")).toEqual({ mo: true });
    expect(baiCoMoDuoc(dung(), td("1.1"), cd({ moBaiTiepTheo: "KHI_BAI_TRUOC_XONG" }), "thi")).toEqual({ mo: false, lyDo: "CHUA_DU_DIEU_KIEN_THI_CUOI" });
  });

  it("bài không tồn tại ⇒ lý do riêng", () => {
    expect(baiCoMoDuoc(dung(), {}, cd(), "khong-co")).toEqual({ mo: false, lyDo: "BAI_KHONG_TON_TAI" });
  });
});
