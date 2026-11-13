// Màn "Công dạy giáo viên" — phần THUẦN. Ca GV-* là ma trận của task; ca chạm DB (buổi huỷ không vào,
// dạy thay về đúng người, ranh giới tháng, phạm vi cơ sở) ở `tests/cham-cong/cong-day-giao-vien.test.ts`.
import { describe, it, expect } from "vitest";
import { chiTietCongDay, congDayCuaNguoi, type BuoiDay, type HienThiBuoi, type LoaiCongDay } from "./cong-day";
import {
  canhBaoCua,
  chiTietGiaoVien,
  docBoLoc,
  gvHopLe,
  nhomCua,
  tongHopGiaoVien,
  type BoLoc,
} from "./cong-day-chi-tiet";

function loai(p: Partial<LoaiCongDay> = {}): LoaiCongDay {
  return {
    code: "LOP_CHINH",
    name: "Lớp chính",
    source: "CLASS",
    role: "MAIN",
    basis: "PER_SESSION",
    factor: 1,
    countsInPeriod: true,
    isActive: true,
    categoryCode: null,
    ...p,
  };
}

function ht(p: Partial<HienThiBuoi> = {}): HienThiBuoi {
  return {
    gioBatDau: "17:30",
    gioKetThuc: "19:30",
    gioThuc: false,
    lopId: "lop1",
    tenLop: "ROBOTICS 01",
    centerId: "cs1",
    phong: "201",
    trangThai: "COMPLETED",
    gvChinhId: "u1",
    gvThayId: null,
    nguoiDayThucId: null,
    ...p,
  };
}

function buoi(p: Partial<BuoiDay> = {}): BuoiDay {
  return {
    id: "s1",
    source: "CLASS",
    userId: "u1",
    role: "MAIN",
    ymd: "2026-10-13",
    minutes: 120,
    categoryCode: null,
    hienThi: ht(),
    ...p,
  };
}

// Danh mục có hệ số KHÁC NHAU từng loại — hệ số 1 khắp nơi thì nhầm loại vẫn ra đúng số (dữ liệu tròn
// trịa là dữ liệu không kiểm được gì).
const DM: LoaiCongDay[] = [
  loai(),
  loai({ code: "DAY_THAY", name: "Dạy thay", role: "SUBSTITUTE", factor: 0.8 }),
  loai({ code: "BU", name: "Học bù", source: "MAKEUP", factor: 0.5 }),
  loai({ code: "TN", name: "Trải nghiệm", source: "TRIAL", basis: "PER_HOUR", factor: 1.5 }),
  loai({ code: "TG", name: "Trợ giảng", role: "ASSISTANT", factor: 0.3, countsInPeriod: false }),
];
const KHONG_LOC: BoLoc = { loai: null, trangThai: null };
const CS1 = new Set(["cs1"]);

describe("ma trận GV — thuần", () => {
  it("[GV-01] hai buổi lớp chính ⇒ tổng hợp 2 buổi, nhóm Lớp chính 2", () => {
    const t = tongHopGiaoVien("u1", [buoi(), buoi({ id: "s2", ymd: "2026-10-14" })], DM);
    expect(t.tongBuoi).toBe(2);
    expect(t.theoNhom).toEqual({ LOP_CHINH: 2, DAY_THAY: 0, HOC_BU: 0, KHAC: 0 });
    expect(t.tongCong).toBe(2);
    expect(t.tongPhut).toBe(240);
  });

  it("[GV-03] case bù NO_SHOW (GV có mặt, mọi bé vắng) ⇒ có công theo dòng Học bù — trạng thái buổi KHÔNG quyết công", () => {
    const b = buoi({ id: "c1", source: "MAKEUP", hienThi: ht({ trangThai: "NO_SHOW", lopId: null }) });
    const d = chiTietCongDay([b], DM)[0];
    expect(d.tinhVaoKy).toBe(true);
    expect(d.cong).toBe(0.5);
    const ct = chiTietGiaoVien([b], DM, KHONG_LOC, CS1);
    expect(ct.ngays[0].dongs[0].trangThaiBuoi).toBe("NO_SHOW");
    expect(ct.ngays[0].dongs[0].tinhVaoKy).toBe(true);
  });

  it("[GV-05] case bù COMPLETED ⇒ công = hệ số dòng Học bù, nhóm Học bù", () => {
    const t = tongHopGiaoVien("u1", [buoi({ id: "c1", source: "MAKEUP" })], DM);
    expect(t.theoNhom.HOC_BU).toBe(1);
    expect(t.tongCong).toBe(0.5);
  });

  it("[GV-07] nhiều loại cùng tháng ⇒ chia nhóm theo nguồn + vai, tổng nhóm = tổng buổi", () => {
    const ds = [
      buoi(),
      buoi({ id: "s2", role: "SUBSTITUTE" }),
      buoi({ id: "c1", source: "MAKEUP" }),
      buoi({ id: "t1", source: "TRIAL", minutes: 90 }),
      buoi({ id: "s3", role: "ASSISTANT" }),
    ];
    const t = tongHopGiaoVien("u1", ds, DM);
    expect(t.theoNhom).toEqual({ LOP_CHINH: 1, DAY_THAY: 1, HOC_BU: 1, KHAC: 2 });
    expect(Object.values(t.theoNhom).reduce((a, b) => a + b, 0)).toBe(t.tongBuoi);
    // 1 + 0,8 + 0,5 + 1,5×1,5h; trợ giảng KHÔNG cộng vào kỳ.
    expect(t.tongCong).toBe(4.55);
  });

  it("[GV-12] tổng hợp = tổng chi tiết, kể cả khi làm tròn theo loại lệch với cộng thẳng từng dòng", () => {
    // 3 buổi trải nghiệm 20 phút × 1,5 = 0,5 mỗi buổi; thêm hệ số lẻ để cộng thẳng-rồi-tròn lệch.
    const dm = [...DM, loai({ code: "LE", name: "Lẻ", source: "TRIAL", role: "SUBSTITUTE", basis: "PER_HOUR", factor: 0.333 })];
    const ds = [
      buoi(),
      buoi({ id: "t1", source: "TRIAL", minutes: 20 }),
      buoi({ id: "t2", source: "TRIAL", minutes: 20 }),
      buoi({ id: "t3", source: "TRIAL", role: "SUBSTITUTE", minutes: 50 }),
      buoi({ id: "t4", source: "TRIAL", role: "SUBSTITUTE", minutes: 50, ymd: "2026-10-20" }),
    ];
    const tong = tongHopGiaoVien("u1", ds, dm);
    const ct = chiTietGiaoVien(ds, dm, KHONG_LOC, CS1);
    expect(ct.tong.cong).toBe(tong.tongCong);
    expect(ct.tong.buoi).toBe(tong.tongBuoi);
    expect(ct.tong.phut).toBe(tong.tongPhut);
    expect(tong.tongCong).toBe(congDayCuaNguoi(ds, dm).tongCong);
    // Footer từng ngày cộng lại = số dòng tháng.
    expect(ct.ngays.reduce((s, n) => s + n.tong.buoi, 0)).toBe(ct.tong.buoi);
  });
});

describe("chi tiết — gom ngày, sắp xếp, lọc", () => {
  it("gom theo ngày ↑, trong ngày theo giờ bắt đầu ↑", () => {
    const ds = [
      buoi({ id: "b", ymd: "2026-10-14", hienThi: ht({ gioBatDau: "14:00" }) }),
      buoi({ id: "a", ymd: "2026-10-14", hienThi: ht({ gioBatDau: "08:00" }) }),
      buoi({ id: "c", ymd: "2026-10-02" }),
    ];
    const ct = chiTietGiaoVien(ds, DM, KHONG_LOC, CS1);
    expect(ct.ngays.map((n) => n.ymd)).toEqual(["2026-10-02", "2026-10-14"]);
    expect(ct.ngays[1].dongs.map((d) => d.buoiId)).toEqual(["a", "b"]);
    expect(ct.ngays[1].tong).toEqual({ buoi: 2, phut: 240, cong: 2 });
  });

  it("lọc theo loại + theo trạng thái tính công; giá trị lạ trên URL rơi về 'tất cả'", () => {
    const ds = [buoi(), buoi({ id: "s2", role: "ASSISTANT" }), buoi({ id: "s3", role: "SUBSTITUTE" })];
    expect(chiTietGiaoVien(ds, DM, { loai: "DAY_THAY", trangThai: null }, CS1).soDong).toBe(1);
    expect(chiTietGiaoVien(ds, DM, { loai: null, trangThai: "KHONG_TINH" }, CS1).ngays[0].dongs[0].buoiId).toBe("s2");
    expect(docBoLoc({ loai: "XYZ", tt: "bay" }, DM.map((l) => l.code))).toEqual({ loai: null, trangThai: null });
    expect(docBoLoc({ loai: "BU", tt: "CAN_KIEM_TRA" }, DM.map((l) => l.code))).toEqual({ loai: "BU", trangThai: "CAN_KIEM_TRA" });
  });

  it("trạng thái tính công là field RIÊNG: buổi COMPLETED của loại chỉ theo dõi ⇒ KHÔNG tính, lý do nói rõ", () => {
    const d = chiTietGiaoVien([buoi({ role: "ASSISTANT" })], DM, KHONG_LOC, CS1).ngays[0].dongs[0];
    expect(d.trangThaiBuoi).toBe("COMPLETED");
    expect(d.tinhVaoKy).toBe(false);
    expect(d.lyDo).toBe("KHONG_CONG_VAO_KY");
  });
});

describe("cần kiểm tra — chỉ đánh dấu", () => {
  it("không khớp loại / thiếu giờ ⇒ cờ, công 0", () => {
    const [khong, thieu] = chiTietCongDay(
      [buoi({ source: "TRIAL", role: "ASSISTANT" }), buoi({ id: "t1", source: "TRIAL", minutes: null })],
      DM,
    );
    expect(canhBaoCua(khong)).toEqual(["KHONG_KHOP_LOAI"]);
    expect(canhBaoCua(thieu)).toEqual(["THIEU_GIO"]);
    expect(khong.cong + thieu.cong).toBe(0);
  });

  it("loại người vận hành TẮT ⇒ 'Loại đang tắt', KHÔNG cờ; không có dòng nào (vd học bù chưa seed) ⇒ cờ thiếu cấu hình", () => {
    const dm = [...DM.filter((l) => l.code !== "BU"), loai({ code: "TN_TAT", source: "TRIAL", role: "SUBSTITUTE", isActive: false })];
    const [tat, thieu] = chiTietCongDay([buoi({ source: "TRIAL", role: "SUBSTITUTE" }), buoi({ id: "c1", source: "MAKEUP" })], dm);
    expect(tat.lyDo).toBe("LOAI_DANG_TAT");
    expect(canhBaoCua(tat)).toEqual([]);
    expect(thieu.lyDo).toBe("KHONG_KHOP_LOAI");
    expect(canhBaoCua(thieu)).toEqual(["KHONG_KHOP_LOAI"]);
    expect(tat.cong + thieu.cong).toBe(0);
    // Luật quy đổi không đổi: cả hai đều rơi khỏi công.
    expect(congDayCuaNguoi([tat.buoi, thieu.buoi], dm).tongBuoi).toBe(0);
  });

  it("KPI 'chỉ theo dõi' đếm riêng buổi của loại tắt 'Cộng vào kỳ' — nằm trong Tổng buổi nhưng không trong công", () => {
    const t = tongHopGiaoVien("u1", [buoi(), buoi({ id: "s2", role: "ASSISTANT" })], DM);
    expect(t.tongBuoi).toBe(2);
    expect(t.buoiChiTheoDoi).toBe(1);
    expect(t.tongCong).toBe(1);
  });

  it("buổi ghi người dạy thay mà công về GV chính ⇒ cờ; dạy thay về đúng người thay ⇒ không cờ", () => {
    const [sai] = chiTietCongDay([buoi({ hienThi: ht({ gvThayId: "u2", nguoiDayThucId: "u1" }) })], DM);
    expect(canhBaoCua(sai)).toContain("THAY_NHUNG_CONG_VE_GV_CHINH");
    const [dung] = chiTietCongDay([buoi({ userId: "u2", role: "SUBSTITUTE", hienThi: ht({ gvThayId: "u2" }) })], DM);
    expect(canhBaoCua(dung)).toEqual([]);
  });

  it("cột nhóm chỉ đếm buổi CÓ CÔNG: buổi thiếu giờ / không khớp loại không vào nhóm nào, tổng nhóm = Tổng buổi", () => {
    const ds = [buoi(), buoi({ id: "t1", source: "TRIAL", minutes: null }), buoi({ id: "x", source: "TRIAL", role: "ASSISTANT" })];
    const t = tongHopGiaoVien("u1", ds, DM);
    expect(t.tongBuoi).toBe(1);
    expect(t.theoNhom).toEqual({ LOP_CHINH: 1, DAY_THAY: 0, HOC_BU: 0, KHAC: 0 });
  });

  it("đếm 'cần kiểm tra' ở tổng hợp = số dòng có cờ", () => {
    const ds = [buoi(), buoi({ id: "t1", source: "TRIAL", minutes: null }), buoi({ id: "x", source: "TRIAL", role: "ASSISTANT" })];
    expect(tongHopGiaoVien("u1", ds, DM).canKiemTra).toBe(2);
    expect(chiTietGiaoVien(ds, DM, { loai: null, trangThai: "CAN_KIEM_TRA" }, CS1).soDong).toBe(2);
  });

  it("nhomCua theo nguồn + vai, không theo mã danh mục", () => {
    expect(nhomCua({ source: "CLASS", role: "MAIN" })).toBe("LOP_CHINH");
    expect(nhomCua({ source: "TRIAL", role: "SUBSTITUTE" })).toBe("DAY_THAY");
    expect(nhomCua({ source: "MAKEUP", role: "MAIN" })).toBe("HOC_BU");
    expect(nhomCua({ source: "TRIAL", role: "MAIN" })).toBe("KHAC");
  });
});

describe("[GV-08] phạm vi — thuần", () => {
  it("buổi ở cơ sở ngoài phạm vi: VẪN có công, nhưng che lớp / phòng / người", () => {
    const ds = [buoi(), buoi({ id: "s2", hienThi: ht({ centerId: "cs2", tenLop: "LOP CS2", phong: "P9", gvThayId: "u9" }) })];
    const ct = chiTietGiaoVien(ds, DM, KHONG_LOC, CS1);
    const [o1, o2] = ct.ngays[0].dongs;
    expect(o1.biChe).toBe(false);
    expect(o1.tenLop).toBe("ROBOTICS 01");
    expect(o2.biChe).toBe(true);
    expect([o2.tenLop, o2.phong, o2.lopId, o2.gvThayId, o2.gvChinhId]).toEqual([null, null, null, null, null]);
    expect(o2.cong).toBe(1);
    expect(ct.tong.cong).toBe(2);
  });

  it("buổi không suy được cơ sở ⇒ che (không chứng minh được là được xem)", () => {
    const d = chiTietGiaoVien([buoi({ hienThi: ht({ centerId: null }) })], DM, KHONG_LOC, CS1).ngays[0].dongs[0];
    expect(d.biChe).toBe(true);
  });

  it("?gv= chỉ nhận người thuộc khối đang xem", () => {
    const nguoi = new Set(["u1", "u2"]);
    expect(gvHopLe("u1", nguoi)).toBe("u1");
    expect(gvHopLe("u-cs2", nguoi)).toBeNull();
    expect(gvHopLe("", nguoi)).toBeNull();
    expect(gvHopLe(undefined, nguoi)).toBeNull();
  });
});
