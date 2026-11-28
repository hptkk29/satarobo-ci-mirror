import { describe, expect, it } from "vitest";

import { chupBonNguoi } from "./fixture";
import {
  CAU_KHONG_TICK,
  DO_KHO_TOI_DA,
  NGHI_THUC_TUAN,
  QUY_NAM,
  capCoNoiDung,
  choPhepTick,
  dieuChinhTuanSau,
  khoViecCuaNguoi,
  khoaCap,
  ngayCoViec,
  nguoiNhanChinh,
  sinhKeHoach,
  tuanCuaNgay,
  type DauVaoKeHoach,
  type HoatDongDaKiem,
} from "./ke-hoach";
import { congNgay, soNgayGiua } from "./kieu";

const BAT_DAU = "2026-11-03"; // thứ Ba
const chup = chupBonNguoi();
const dv = (ky: DauVaoKeHoach["ky"], extra: Partial<DauVaoKeHoach> = {}): DauVaoKeHoach => ({
  chup,
  ky,
  batDau: BAT_DAU,
  doKho: 1,
  soViecTuan: 7,
  hoatDong: [],
  ...extra,
});

describe("kế hoạch 7 ngày (doc 18, 7.2)", () => {
  const viec = sinhKeHoach(dv("NGAY_7"));
  const ngayCuaNguoi = (id: string) => viec.filter((v) => v.nguoiLamId === id).map((v) => v.ngay);

  it("[SG-KH-01] mỗi người TỐI ĐA 1 việc/ngày, ≤ 10 phút, trong 7 ngày kể từ ngày bắt đầu", () => {
    for (const n of chup.nguoi) {
      const ng = ngayCuaNguoi(n.id);
      expect(new Set(ng).size).toBe(ng.length);
    }
    for (const v of viec) {
      if (v.nguoiLamId) expect(v.phut).toBeLessThanOrEqual(10);
      expect(soNgayGiua(BAT_DAU, v.ngay)).toBeGreaterThanOrEqual(0);
      expect(soNgayGiua(BAT_DAU, v.ngay)).toBeLessThan(7);
    }
  });

  it("[SG-KH-02] mỗi việc hướng tới đúng MỘT người nhận khác chính mình; việc ĐẦU của mỗi người nhắm người nhận chính; mọi ngày 1–5 đều có việc (không ngày trống)", () => {
    for (const v of viec.filter((x) => x.nguoiLamId)) {
      expect(v.nguoiNhanId).not.toBeNull();
      expect(v.nguoiNhanId).not.toBe(v.nguoiLamId);
    }
    for (const n of chup.nguoi.filter((x) => x.id !== "be")) {
      const ds = viec.filter((v) => v.nguoiLamId === n.id).sort((a, b) => (a.ngay < b.ngay ? -1 : 1));
      expect(ds[0]!.nguoiNhanId).toBe(nguoiNhanChinh(chup, n.id));
      expect(ds).toHaveLength(5);
    }
  });

  it("[SG-KH-03] không lặp một việc 3 ngày liền (cùng người, cùng chữ)", () => {
    for (const n of chup.nguoi) {
      const ds = viec.filter((v) => v.nguoiLamId === n.id).sort((a, b) => (a.ngay < b.ngay ? -1 : 1));
      for (let i = 2; i < ds.length; i++) {
        const lienNgay = soNgayGiua(ds[i - 2]!.ngay, ds[i - 1]!.ngay) === 1 && soNgayGiua(ds[i - 1]!.ngay, ds[i]!.ngay) === 1;
        const lap = ds[i]!.noiDung === ds[i - 1]!.noiDung && ds[i - 1]!.noiDung === ds[i - 2]!.noiDung;
        expect(lienNgay && lap).toBe(false);
      }
    }
  });

  it("[SG-KH-04] nội dung việc lấy NGUYÊN từ bảng VIEC_CUA_TOI của engine: khoá nguồn đúng dạng và chữ đã thay đại từ", () => {
    for (const v of viec.filter((x) => x.nguoiLamId)) {
      expect(v.nguon).toMatch(/^VIEC_CUA_TOI:[DISC]:(toi-cao-hon|toi-thap-hon):(nguoi-lon-voi-tre|tre-voi-nguoi-lon|ngang-vai)$/);
      expect(v.noiDung).not.toMatch(/\{[A-Za-z]+\}/);
      expect(v.noiDung.length).toBeGreaterThan(10);
    }
  });

  it("[SG-KH-05] ngày 6 = hoạt động chung, ngày 7 = họp nhà 20 phút; cả hai là việc của CẢ NHÀ", () => {
    const n6 = viec.find((v) => v.ngay === congNgay(BAT_DAU, 5) && v.nguoiLamId === null)!;
    const n7 = viec.find((v) => v.ngay === congNgay(BAT_DAU, 6) && v.nguoiLamId === null)!;
    expect(n6.nguon).toBe("HOAT_DONG_CHUNG");
    expect(n7.nguon).toBe("HOP_NHA");
    expect(n7.phut).toBe(20);
  });

  it("[SG-KH-06] ngày 6 chỉ dùng hoạt động ĐÃ KIỂM; có địa điểm thì nêu địa điểm, không có thì chỉ mô tả — không bịa", () => {
    const hd: HoatDongDaKiem = { id: "h1", loai: "an-uong", moTa: "Cả nhà đi ăn tối", phut: 90, chiPhi: null, diaDiem: { ten: "Quán A", diaChi: "1 Đường B" } };
    const co = sinhKeHoach(dv("NGAY_7", { hoatDong: [hd] })).find((v) => v.nguoiLamId === null && v.nguon.startsWith("HOAT_DONG"))!;
    expect(co.hoatDongId).toBe("h1");
    expect(co.noiDung).toContain("Quán A");
    const khongDiaDiem = sinhKeHoach(dv("NGAY_7", { hoatDong: [{ ...hd, diaDiem: null }] })).find((v) => v.hoatDongId === "h1")!;
    expect(khongDiaDiem.noiDung).toBe("Cả nhà đi ăn tối");
    expect(sinhKeHoach(dv("NGAY_7")).find((v) => v.nguon === "HOAT_DONG_CHUNG")?.hoatDongId).toBeNull();
  });

  it("[SG-KH-07] số việc/tuần 3 ⇒ chỉ ngày 1, 3, 5; 4 ⇒ 1, 2, 4, 5; ≥ 5 ⇒ cả 5 ngày", () => {
    expect(ngayCoViec(3)).toEqual([1, 3, 5]);
    expect(ngayCoViec(4)).toEqual([1, 2, 4, 5]);
    expect(ngayCoViec(7)).toEqual([1, 2, 3, 4, 5]);
    const it3 = sinhKeHoach(dv("NGAY_7", { soViecTuan: 3 })).filter((v) => v.nguoiLamId);
    for (const v of it3) expect([0, 2, 4]).toContain(soNgayGiua(BAT_DAU, v.ngay));
  });

  it("[SG-KH-08] độ khó tăng ⇒ kho việc của người làm không bao giờ nhỏ đi", () => {
    for (const n of chup.nguoi) {
      const k1 = khoViecCuaNguoi(chup, n.id, 1).length;
      const k2 = khoViecCuaNguoi(chup, n.id, 2).length;
      const k3 = khoViecCuaNguoi(chup, n.id, DO_KHO_TOI_DA).length;
      expect(k2).toBeGreaterThanOrEqual(k1);
      expect(k3).toBeGreaterThanOrEqual(k2);
    }
    const moi = sinhKeHoach(dv("NGAY_7", { doKho: 99 })); // kẹp về 3
    expect(moi.length).toBeGreaterThan(0);
  });

  it("[SG-KH-09] bé bậc nhỏ (mầm non – lớp 2) KHÔNG nhận việc tự làm; người lớn thì có", () => {
    expect(khoViecCuaNguoi(chup, "be", 3)).toEqual([]);
    expect(khoViecCuaNguoi(chup, "bo", 1).length).toBeGreaterThan(0);
    expect(sinhKeHoach(dv("NGAY_7")).some((v) => v.nguoiLamId === "be")).toBe(false);
  });

  it("[SG-KH-10] tất định: cùng đầu vào ⇒ cùng kế hoạch", () => {
    expect(sinhKeHoach(dv("NGAY_7"))).toEqual(sinhKeHoach(dv("NGAY_7")));
  });
});

describe("kế hoạch 1 tháng / 1 năm", () => {
  it("[SG-KH-11] 1 tháng: đủ 4 nghi thức tuần (Chủ nhật = ngày cuối mỗi tuần), thoả thuận của 2 cặp lệch nhất ở tuần 1 và tuần 3", () => {
    const v = sinhKeHoach(dv("THANG_1"));
    const nt = v.filter((x) => x.nguon.startsWith("NGHI_THUC:"));
    expect(nt).toHaveLength(4);
    expect(nt.map((x) => x.noiDung)).toEqual(NGHI_THUC_TUAN.map((x) => x.nghiThuc));
    expect(nt.every((x) => x.nguoiLamId === null)).toBe(true);
    const tt = v.filter((x) => x.nguon.startsWith("THOA_THUAN:"));
    expect(tt.length).toBeGreaterThanOrEqual(1);
    expect(tt.length).toBeLessThanOrEqual(2);
    expect(tt.map((x) => soNgayGiua(BAT_DAU, x.ngay))).toEqual(tt.length === 2 ? [0, 14] : [0]);
    for (const x of tt) expect(x.noiDung).not.toMatch(/\{[A-Za-z]+\}/);
    expect(capCoNoiDung(chup).length).toBeGreaterThan(0);
  });

  it("[SG-KH-12] 1 năm: 12 «ngày gia đình» lần lượt từng người; mốc làm lại bài; mỗi quý một chủ đề", () => {
    const v = sinhKeHoach(dv("NAM_1"));
    const ngayGd = v.filter((x) => x.nguon.startsWith("NGAY_GIA_DINH:"));
    expect(ngayGd).toHaveLength(12);
    const ai = ngayGd.map((x) => x.nguoiLamId);
    expect(new Set(ai).size).toBe(chup.nguoi.length); // đủ mọi người đều có lượt
    expect(ai.slice(0, 4)).toEqual(chup.nguoi.map((n) => n.id)); // lần lượt đúng thứ tự
    expect(v.some((x) => x.nguon === "LAM_LAI_BAI:6T")).toBe(true);
    expect(v.some((x) => x.nguon === "LAM_LAI_BAI:12T")).toBe(true);
    expect(QUY_NAM.map((q) => q.chuDe)).toEqual(["Giao tiếp", "Phân việc", "Xử lý mâu thuẫn", "Mục tiêu chung"]);
  });
});

describe("tick (doc 18, 7.3)", () => {
  it("[SG-KH-13] tick được từ ngày của việc đến tối đa 2 ngày sau; trước hoặc sau đó thì không", () => {
    expect(choPhepTick("2026-11-03", "2026-11-03", false)).toEqual({ duoc: true });
    expect(choPhepTick("2026-11-03", "2026-11-05", false)).toEqual({ duoc: true });
    expect(choPhepTick("2026-11-03", "2026-11-06", false)).toEqual({ duoc: false, lyDo: "QUA_HAN_TICK" });
    expect(choPhepTick("2026-11-03", "2026-11-02", false)).toEqual({ duoc: false, lyDo: "VIEC_CHUA_TOI_NGAY" });
    expect(choPhepTick("2026-11-03", "2026-11-03", true)).toEqual({ duoc: false, lyDo: "DA_TICK" });
    for (const c of Object.values(CAU_KHONG_TICK)) expect(c.length).toBeGreaterThan(5);
  });

  it("[SG-KH-14] tuần của ngày: ngoài kế hoạch ⇒ null", () => {
    expect(tuanCuaNgay(BAT_DAU, "2026-11-03", 28)).toBe(1);
    expect(tuanCuaNgay(BAT_DAU, "2026-11-09", 28)).toBe(1);
    expect(tuanCuaNgay(BAT_DAU, "2026-11-10", 28)).toBe(2);
    expect(tuanCuaNgay(BAT_DAU, "2026-12-01", 28)).toBeNull();
    expect(tuanCuaNgay(BAT_DAU, "2026-11-02", 28)).toBeNull();
  });
});

describe("tự điều chỉnh (doc 18, 7.3) — ba luật", () => {
  const nhan = (id: string) => (id === "bo" ? "con" : id === "con" ? "bo" : null);
  const tuan = (n: number, tyLe: number | null, diem: number | null, theoNguoi: Record<string, number> = {}) => ({
    tuan: n,
    tyLeHoanThanh: tyLe,
    diemTrungBinh: diem,
    diemTheoNguoi: theoNguoi,
  });

  it("[SG-KH-15] hoàn thành < 40% ⇒ còn 3 việc/tuần, độ khó 1", () => {
    const r = dieuChinhTuanSau({ soViecTuan: 7, doKho: 3 }, [tuan(1, 0.39, 5)], nhan);
    expect(r).toMatchObject({ soViecTuan: 3, doKho: 1 });
    expect(dieuChinhTuanSau({ soViecTuan: 7, doKho: 3 }, [tuan(1, 0.4, 3)], nhan)).toMatchObject({ soViecTuan: 7, doKho: 3 });
  });

  it("[SG-KH-16] ≥ 80% và điểm ≥ 4 trong 2 tuần liền ⇒ tăng độ khó (trần 3); chỉ một tuần thì chưa", () => {
    const hai = [tuan(1, 0.8, 4), tuan(2, 0.9, 4.5)];
    expect(dieuChinhTuanSau({ soViecTuan: 7, doKho: 1 }, hai, nhan).doKho).toBe(2);
    expect(dieuChinhTuanSau({ soViecTuan: 7, doKho: 3 }, hai, nhan).doKho).toBe(3);
    expect(dieuChinhTuanSau({ soViecTuan: 7, doKho: 1 }, [tuan(2, 0.9, 4.5)], nhan).doKho).toBe(1);
    expect(dieuChinhTuanSau({ soViecTuan: 7, doKho: 1 }, [tuan(1, 0.79, 4), tuan(2, 0.9, 4.5)], nhan).doKho).toBe(1);
    expect(dieuChinhTuanSau({ soViecTuan: 7, doKho: 1 }, [tuan(1, 0.8, 3.9), tuan(2, 0.9, 4.5)], nhan).doKho).toBe(1);
  });

  it("[SG-KH-17] hoàn thành thấp thắng luật tăng độ khó (không vừa giảm vừa tăng)", () => {
    const r = dieuChinhTuanSau({ soViecTuan: 7, doKho: 2 }, [tuan(1, 0.9, 5), tuan(2, 0.1, 5)], nhan);
    expect(r).toMatchObject({ soViecTuan: 3, doKho: 1 });
  });

  it("[SG-KH-18] một người chấm ≤ 2 hai tuần liền ⇒ cặp với người nhận chính được thêm 1-1; một tuần thấp thì chưa", () => {
    const thap = [tuan(1, 0.6, 2, { bo: 2, con: 4 }), tuan(2, 0.6, 2, { bo: 1, con: 4 })];
    expect(dieuChinhTuanSau({ soViecTuan: 7, doKho: 1 }, thap, nhan).capCanThem1_1).toEqual([khoaCap("bo", "con")]);
    const mot = [tuan(1, 0.6, 3, { bo: 4 }), tuan(2, 0.6, 2, { bo: 1 })];
    expect(dieuChinhTuanSau({ soViecTuan: 7, doKho: 1 }, mot, nhan).capCanThem1_1).toEqual([]);
    expect(dieuChinhTuanSau({ soViecTuan: 7, doKho: 1 }, [tuan(2, 0.6, 2, { bo: 1 })], nhan).capCanThem1_1).toEqual([]);
  });

  it("[SG-KH-19] chưa có tuần nào ⇒ giữ nguyên, không lý do", () => {
    expect(dieuChinhTuanSau({ soViecTuan: 7, doKho: 2 }, [], nhan)).toEqual({ soViecTuan: 7, doKho: 2, capCanThem1_1: [], lyDo: [] });
  });
});
