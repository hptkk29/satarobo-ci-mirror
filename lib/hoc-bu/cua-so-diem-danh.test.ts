// [CSD-*] — cửa sổ thời gian điểm danh buổi dạy bù (T02, HB-03). Thuần; đồng hồ TRUYỀN VÀO (luật 19).
import { describe, expect, it } from "vitest";
import { MO_SOM_PHUT, QUAN_LY_SO_NGAY, cuaSoDiemDanhBu } from "@/lib/hoc-bu/cua-so-diem-danh";
import { vnDateAt } from "@/lib/time/vn";

/** Case ngày 15/10/2026, dạy 18:00–19:30 giờ VN. `date` là cột @db.Date = nửa đêm UTC. */
const NGAY = new Date("2026-10-15T00:00:00.000Z");
const GIO = "18:00";
const luc = (d: number, h: number, mi: number, s = 0, ms = 0) =>
  new Date(vnDateAt(2026, 9, d, h, mi).getTime() + s * 1000 + ms);
const chay = (now: Date, vai: "GIAO_VIEN" | "QUAN_LY", ghiDe = false, startTime = GIO, ngay = NGAY) =>
  cuaSoDiemDanhBu({ now, ngay, startTime, vai, ghiDe });

describe("[CSD] điểm danh bù — mở sớm 15 phút", () => {
  it("[CSD-01] hằng số khớp quyết định 07/10 (15 phút, 3 ngày)", () => {
    expect(MO_SOM_PHUT).toBe(15);
    expect(QUAN_LY_SO_NGAY).toBe(3);
  });

  it("[CSD-02] biên MỞ: 17:44:59.999 chưa mở, 17:45:00 mở — cả giáo viên lẫn quản lý", () => {
    for (const vai of ["GIAO_VIEN", "QUAN_LY"] as const) {
      const chua = chay(luc(15, 17, 44, 59, 999), vai);
      expect(chua.ok, vai).toBe(false);
      if (!chua.ok) {
        expect(chua.ma).toBe("CHUA_MO");
        expect(chua.thongBao).toContain("17:45");
      }
      expect(chay(luc(15, 17, 45), vai).ok, vai).toBe(true);
    }
  });

  it("[CSD-03] điểm danh SỚM bị chặn cả khi GHI ĐÈ — ghi đè chỉ chữa muộn, không mở sớm", () => {
    const r = chay(luc(15, 9, 0), "QUAN_LY", true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe("CHUA_MO");
  });

  it("[CSD-04] hôm TRƯỚC ngày dạy ⇒ chưa mở (ngày case tính theo ngày VN, không theo UTC)", () => {
    expect(chay(luc(14, 20, 0), "GIAO_VIEN").ok).toBe(false);
  });

  it("[CSD-05] case bắt đầu 00:10: mở lúc 23:55 HÔM TRƯỚC (qua nửa đêm), và thông báo nói rõ 'hôm trước'", () => {
    const sau = chay(luc(14, 23, 55), "GIAO_VIEN", false, "00:10");
    expect(sau.ok).toBe(true);
    const truoc = chay(luc(14, 23, 54, 59, 999), "GIAO_VIEN", false, "00:10");
    expect(truoc.ok).toBe(false);
    if (!truoc.ok) expect(truoc.thongBao).toContain("23:55 hôm trước");
  });

  it("[CSD-06] minute của giờ bắt đầu được tính (18:30 ⇒ mở 18:15, không phải 18:00)", () => {
    expect(chay(luc(15, 18, 14), "GIAO_VIEN", false, "18:30").ok).toBe(false);
    expect(chay(luc(15, 18, 15), "GIAO_VIEN", false, "18:30").ok).toBe(true);
  });
});

describe("[CSD] giáo viên — hết 23:59 ngày dạy", () => {
  it("[CSD-07] 23:59:59.999 ngày dạy còn được; 00:00 hôm sau là quá hạn", () => {
    expect(chay(luc(15, 23, 59, 59, 999), "GIAO_VIEN").ok).toBe(true);
    const r = chay(luc(16, 0, 0), "GIAO_VIEN");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe("QUA_HAN_GV");
  });

  it("[CSD-08] giáo viên KHÔNG được ghi đè — quá hạn là hết, dù cờ ghiDe bật", () => {
    const r = chay(luc(16, 8, 0), "GIAO_VIEN", true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe("QUA_HAN_GV");
  });

  it("[CSD-09] ngày dạy tính theo NGÀY VN: 17:00Z ngày 15 UTC đã là 00:00 ngày 16 VN ⇒ quá hạn với giáo viên", () => {
    expect(chay(new Date("2026-10-15T17:00:00.000Z"), "GIAO_VIEN").ok).toBe(false);
    expect(chay(new Date("2026-10-15T16:59:59.999Z"), "GIAO_VIEN").ok).toBe(true);
  });
});

describe("[CSD] quản lý — 3 ngày, quá thì phải ghi đè", () => {
  it("[CSD-10] quản lý còn điểm danh được đến hết ngày D+3; 00:00 ngày D+4 là quá hạn", () => {
    expect(chay(luc(16, 8, 0), "QUAN_LY").ok).toBe(true);
    expect(chay(luc(18, 23, 59, 59, 999), "QUAN_LY").ok).toBe(true);
    const r = chay(luc(19, 0, 0), "QUAN_LY");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.ma).toBe("QUA_HAN_QUAN_LY");
      expect(r.thongBao).toContain("ghi đè");
    }
  });

  it("[CSD-11] quá hạn + GHI ĐÈ ⇒ cho qua và báo `dungGhiDe` để người gọi ghi audit; trong hạn thì KHÔNG đánh dấu ghi đè", () => {
    const qua = chay(luc(25, 10, 0), "QUAN_LY", true);
    expect(qua).toEqual({ ok: true, dungGhiDe: true });
    const trongHan = chay(luc(16, 10, 0), "QUAN_LY", true);
    expect(trongHan).toEqual({ ok: true, dungGhiDe: false });
  });

  it("[CSD-12] ngày D+3 vắt qua CUỐI THÁNG: case 30/10 ⇒ quản lý còn đến hết 02/11 (Date.UTC tự cuộn tháng)", () => {
    const ngay = new Date("2026-10-30T00:00:00.000Z");
    const luc2 = (m: number, d: number, h: number) => vnDateAt(2026, m, d, h, 0);
    expect(chay(luc2(10, 2, 23), "QUAN_LY", false, GIO, ngay).ok).toBe(true);
    expect(chay(luc2(10, 3, 0), "QUAN_LY", false, GIO, ngay).ok).toBe(false);
  });
});
