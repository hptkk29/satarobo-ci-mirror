import { describe, expect, it } from "vitest";

import { GOC_GIO, bai, dauVaoNha } from "./fixture";
import { chuVietTat, dinhDangDiem, dungLichSu, dungManCaNhan, dungManGiaDinh, dungManTheCap, dungManThanhVien, loiChoCapNong } from "./man-hinh";
import { chuoiNgayLienTiep, dungManKeHoach, type DauVaoKeHoachMan } from "./man-hinh-ke-hoach";
import { sinhKeHoach } from "./ke-hoach";
import { laTreEm } from "./vai";

/** Không chuỗi nào trong VM được chứa «undefined», «NaN», «[object», hay placeholder {…} chưa thay. */
function sach(x: unknown, duong = "vm"): void {
  if (typeof x === "string") {
    expect(x, duong).not.toMatch(/undefined|NaN|\[object|\{[A-Za-z]+\}/);
  } else if (typeof x === "number") {
    expect(Number.isFinite(x), duong).toBe(true);
  } else if (Array.isArray(x)) {
    x.forEach((v, i) => sach(v, `${duong}[${i}]`));
  } else if (x && typeof x === "object" && !(x instanceof Date) && !(x instanceof Map)) {
    for (const [k, v] of Object.entries(x)) sach(v, `${duong}.${k}`);
  }
}

describe("tab Gia đình — báo cáo mở dần (spec 4.6)", () => {
  it("[SG-MH-01] 1 người tự làm: chỉ tầng 1 mở, tầng 2–4 khoá; không bản đồ; khoá T3 nêu lý do", () => {
    const vm = dungManGiaDinh(dauVaoNha("mot-tu-lam"));
    expect(vm.tang.map((t) => t.trangThai)).toEqual(["mo", "khoa", "khoa", "khoa"]);
    expect(vm.baoCao).toBeNull();
    expect(vm.khoaT3.khoa).toBe(true);
    expect(vm.khoaT3.ly.length).toBeGreaterThan(10);
    expect(vm.tinCay).toBe(25);
    expect(vm.tinCayTot).toBe(false);
    expect(vm.thanhVien.map((t) => t.trangThai)).toEqual(["xong", "chua", "chua", "chua"]);
    sach(vm);
  });

  it("[SG-MH-02] 2 người tự làm: tầng 1 + 2 mở, kế hoạch mở một phần (chỉ 7 ngày), chưa có bản đồ; 2 thẻ chiều", () => {
    const vm = dungManGiaDinh(dauVaoNha("hai-tu-lam"));
    expect(vm.tang.map((t) => t.trangThai)).toEqual(["mo", "mo", "khoa", "mot-phan"]);
    expect(vm.tang[1]!.ghi).toContain("2 thẻ chiều");
    expect(vm.tang[3]!.ghi).toMatch(/^7 ngày/);
    expect(vm.baoCao).toBeNull();
    expect(vm.tinCay).toBe(50);
    sach(vm);
  });

  it("[SG-MH-03] 3 hồ sơ (1 ước lượng): đủ tầng 3 nhưng gắn «Bản nháp» (tin cậy 50% < 60%); 6 thẻ chiều; người ước lượng được đánh dấu; kế hoạch 1 năm khoá", () => {
    const vm = dungManGiaDinh(dauVaoNha("ba-ho-so-mot-uoc"));
    expect(vm.tang[2]).toMatchObject({ trangThai: "nhap", nhanTrangThai: "Bản nháp" });
    expect(vm.tang[1]!.ghi).toContain("6 thẻ chiều");
    expect(vm.tang[3]!.ghi).toContain("1 năm khoá");
    expect(vm.baoCao?.nhap).toBe(true);
    expect(vm.baoCao?.capDs).toHaveLength(3);
    const be = vm.baoCao!.banDo.nut.find((n) => n.id === "be")!;
    expect(be.uocLuong).toBe(true);
    expect(vm.baoCao!.banDo.day.some((d) => d.uocLuong)).toBe(true);
    expect(vm.thanhVien.find((t) => t.id === "be")).toMatchObject({ trangThai: "uoc", nhanTrangThai: "Ước lượng" });
    sach(vm);
  });

  it("[SG-MH-04] đủ cả nhà: không nháp, tin cậy 100%, bản đồ đủ 4 người + 6 đường nối, 4 nhóm trong dot-plot, kiểu gia đình có điểm mạnh/rủi ro", () => {
    const vm = dungManGiaDinh(dauVaoNha("du-ca-nha"));
    expect(vm.tinCay).toBe(100);
    expect(vm.tinCayTot).toBe(true);
    expect(vm.tang.map((t) => t.trangThai)).toEqual(["mo", "mo", "mo", "mo"]);
    const b = vm.baoCao!;
    expect(b.nhap).toBe(false);
    expect(b.banDo.nut).toHaveLength(4);
    expect(b.banDo.day).toHaveLength(6);
    expect(b.dotPlot.map((r) => r.k)).toEqual(["D", "I", "S", "C"]);
    expect(b.kieu.manh.length).toBeGreaterThan(5);
    expect(b.kpi).toHaveLength(4);
    expect(b.capDs).toHaveLength(6);
    expect(b.vai).toHaveLength(4);
    expect(vm.snapTen).toMatch(/^BẢN TÍNH SỐ 3 · 02\/11\/2026 /);
    sach(vm);
  });

  it("[SG-MH-05] cặp nóng: «A → B: …» lấy nguyên «việc của tôi» của engine; bé bậc nhỏ KHÔNG có dòng do bé nói", () => {
    const dv = dauVaoNha("du-ca-nha");
    const loi = loiChoCapNong(dv.chup!, "me", "be");
    expect(loi.length).toBe(1);
    expect(loi[0]).toMatch(/^Người lớn 2 → Bé nhỏ: /);
    expect(loiChoCapNong(dv.chup!, "bo", "con").length).toBe(2); // bé lớp 5 ≥ bậc tiểu học ⇒ có cả hai chiều
  });

  it("[SG-MH-06] chữ viết tắt và định dạng điểm", () => {
    expect(chuVietTat("Mẹ")).toBe("MẸ");
    expect(chuVietTat("Bin")).toBe("BIN");
    expect(chuVietTat("Nguyễn Văn An")).toBe("VA");
    expect(chuVietTat("  ")).toBe("?");
    expect(dinhDangDiem({ D: 87.5, I: 40, S: 19.84, C: 45.1 })).toBe("D87,5 · I40 · S19,8 · C45,1");
  });
});

describe("tab Cá nhân", () => {
  it("[SG-MH-07] người lớn (bộ PH): có bản tự đọc, KHÔNG có bản cho con / cho bố mẹ; lịch sử đánh dấu lần đang dùng", () => {
    const dv = dauVaoNha("du-ca-nha");
    const vm = dungManCaNhan(dv, "bo")!;
    expect(vm.dg.banTuMinh).toBeDefined();
    expect(vm.dg.banCon).toBeUndefined();
    expect(vm.dg.banBoMe).toBeUndefined();
    expect(vm.dg.phoBonNhom).toHaveLength(4);
    expect(vm.lichSu).toHaveLength(1);
    expect(vm.lichSu[0]).toMatchObject({ dangDung: true, chenh: "Lần đầu", ghiDangDung: "Đang dùng cho thẻ cặp" });
    expect(vm.soSanh).toHaveLength(4);
    sach({ ...vm, dg: undefined });
  });

  it("[SG-MH-08] bé tiểu học tự làm (TH): có CẢ bản cho con và bản cho bố mẹ; bé mầm non (MN): chỉ bản cho bố mẹ", () => {
    const dv = dauVaoNha("du-ca-nha");
    const con = dungManCaNhan(dv, "con")!;
    expect(con.dg.banCon).toBeDefined();
    expect(con.dg.banBoMe).toBeDefined();
    expect(con.nhanVat.length).toBeGreaterThan(3);
    const be = dungManCaNhan(dv, "be")!;
    expect(be.dg.banCon).toBeUndefined();
    expect(be.dg.banBoMe).toBeDefined();
    for (const x of [con, be]) {
      const chu = JSON.stringify(x.dg);
      expect(chu).not.toMatch(/\{[A-Za-z]+\}/);
    }
  });

  it("[SG-MH-09] người chưa có bài ⇒ null (không dựng báo cáo rỗng); id lạ ⇒ null", () => {
    const dv = dauVaoNha("mot-tu-lam");
    expect(dungManCaNhan(dv, "bo")).toBeNull();
    expect(dungManCaNhan(dv, "khong-co")).toBeNull();
  });

  it("[SG-MH-10] lịch sử: so được với lần trước khi CÙNG phiên bản; khác phiên bản ⇒ nói «chỉ tham khảo»; lần mới nhất ghi «Lần n» lớn nhất", () => {
    const a = bai("a", "x", "TU_LAM", { D: 80, I: 40, S: 25, C: 45 }, "2026-06-01", "PH", "1.1");
    const b = bai("b", "x", "TU_LAM", { D: 90, I: 40, S: 20, C: 45 }, "2026-10-01", "PH", "1.1");
    const c = bai("c", "x", "TU_LAM", { D: 70, I: 40, S: 20, C: 45 }, "2026-10-20", "PH", "nh:nh1");
    const ls = dungLichSu([a, b, c]);
    expect(ls.map((l) => l.lan)).toEqual(["Lần 3", "Lần 2", "Lần 1"]);
    expect(ls[0]!.chenh).toMatch(/chỉ tham khảo/);
    expect(ls[1]!.chenh).toBe("D +10 · I 0 · S −5 · C 0");
    expect(ls[2]!.chenh).toBe("Lần đầu");
    expect(ls.filter((l) => l.dangDung)).toHaveLength(1);
    expect(ls[0]!.dangDung).toBe(true);
  });
});

describe("tab Thẻ cặp", () => {
  it("[SG-MH-11] chưa đủ 2 người tự làm ⇒ khoá kèm lý do", () => {
    const vm = dungManTheCap(dauVaoNha("mot-tu-lam"));
    expect(vm.khoa).toMatch(/2 người tự làm/);
    expect(vm.hang).toEqual([]);
    expect(dungManTheCap(dauVaoNha("hai-tu-lam")).khoa).toBeNull();
  });

  it("[SG-MH-12] ma trận n × n: đường chéo trống, n(n−1) ô, mỗi ô có mức; mặc định mở cặp nóng nhất; chiều ngược lại đảo A/B", () => {
    const dv = dauVaoNha("du-ca-nha");
    const vm = dungManTheCap(dv);
    expect(vm.soThe).toBe(12);
    expect(vm.hang).toHaveLength(4);
    expect(vm.hang.flatMap((h) => h.o).filter((o) => o === null)).toHaveLength(4);
    expect(vm.hang.flatMap((h) => h.o).filter((o) => o !== null)).toHaveLength(12);
    expect(vm.the).not.toBeNull();
    expect(vm.chon).not.toBeNull();
    const nguoc = vm.daoChieuHref!;
    expect(nguoc).toContain(`a=${vm.chon!.bId}`);
    expect(nguoc).toContain(`b=${vm.chon!.aId}`);
    const cuThe = dungManTheCap(dv, "bo", "be");
    expect(cuThe.the).toMatchObject({ toiId: "bo", kiaId: "be" });
    // T đối xứng: thẻ A→B và B→A cùng mức
    expect(dungManTheCap(dv, "be", "bo").muc?.T).toBe(cuThe.muc?.T);
    // chọn cùng một người hai lần ⇒ không dựng thẻ tự gửi
    expect(dungManTheCap(dv, "bo", "bo").chon?.aId).not.toBe(dungManTheCap(dv, "bo", "bo").chon?.bId);
    sach({ ...vm, the: undefined });
  });
});

describe("tab Thành viên & quyền", () => {
  it("[SG-MH-13] danh sách thành viên: bộ tự làm / góc nhìn theo luật 2.4; quan hệ suy từ vai (n(n−1)/2 cặp)", () => {
    const vm = dungManThanhVien(dauVaoNha("du-ca-nha"), "Nhà thử", [{ id: "hs", ten: "Học viên thử" }], true, laTreEm, 8);
    expect(vm.thanhVien.map((t) => [t.id, t.boTuLam, t.boGocNhin])).toEqual([
      ["me", "PH", null],
      ["bo", "PH", null],
      ["con", "TH", "QS"],
      ["be", null, "MN"],
    ]);
    expect(vm.thanhVien.find((t) => t.id === "be")!.lyDoTuLam).toBe("TRE_NHO_KHONG_TU_LAM");
    expect(vm.thanhVien.find((t) => t.id === "me")!.laChuSo).toBe(true);
    expect(vm.quanHe).toHaveLength(6);
    expect(vm.quanHe.find((q) => q.cap === "Người lớn 2 – Người lớn 1")).toMatchObject({ loai: "Vợ chồng" });
    expect(vm.hocVienChuaNoi).toHaveLength(1);
    expect(vm.coPin).toBe(true);
    sach(vm);
  });
});

describe("tab Kế hoạch", () => {
  const dauVao = (o: Partial<DauVaoKeHoachMan> = {}): DauVaoKeHoachMan => {
    const dv = dauVaoNha("du-ca-nha");
    return {
      tab: "NGAY_7",
      ngayChon: null,
      tuanChon: null,
      kyCheckin: null,
      soTuLam: 4,
      soCoHoSo: 4,
      tongThanhVien: 4,
      chup: dv.chup,
      soBanMoiNhat: 3,
      keHoach: {},
      phanTichIdMoiNhat: "pt3",
      hoatDong: [],
      thanhVien: dv.thanhVien.map((t) => ({ id: t.id, ten: t.ten })),
      homNay: "2026-11-03",
      ...o,
    };
  };

  it("[SG-MH-14] chưa có kế hoạch ⇒ đề nghị tạo (ngày mặc định hôm nay), chưa có hero; tab kế hoạch chưa mở có lý do khoá", () => {
    const vm = dungManKeHoach(dauVao());
    expect(vm.canTaoMoi).toEqual({ ky: "NGAY_7", macDinh: "2026-11-03" });
    expect(vm.hero).toBeNull();
    expect(vm.tabs.map((t) => t.tab)).toEqual(["NGAY_7", "THANG_1", "NAM_1", "CHECKIN"]);
    const khoa = dungManKeHoach(dauVao({ tab: "THANG_1", soTuLam: 1, soCoHoSo: 2 }));
    expect(khoa.lyKhoa).toMatch(/3 hồ sơ/);
    expect(khoa.canTaoMoi).toBeNull();
    const nam = dungManKeHoach(dauVao({ tab: "NAM_1", soTuLam: 2, soCoHoSo: 4 }));
    expect(nam.lyKhoa).toMatch(/độ tin cậy từ 60%/);
  });

  it("[SG-MH-15] có kế hoạch 7 ngày: 7 ô ngày, ngày hôm nay được chọn sẵn, tỉ lệ tuần đếm từ việc đã tick, tick bị khoá khi chưa tới ngày", () => {
    const dv = dauVaoNha("du-ca-nha");
    const sinh = sinhKeHoach({ chup: dv.chup!, ky: "NGAY_7", batDau: "2026-11-03", doKho: 1, soViecTuan: 7, hoatDong: [] });
    const viec = sinh.map((v, i) => ({ id: `v${i}`, nguoiLamId: v.nguoiLamId, nguoiNhanId: v.nguoiNhanId, ngay: v.ngay, nguon: v.nguon, noiDung: v.noiDung, phut: v.phut, hoatDongId: v.hoatDongId, xongLuc: i === 0 ? GOC_GIO : null, camOnLuc: null }));
    const kh = { id: "kh1", ky: "NGAY_7" as const, batDau: "2026-11-03", doKho: 1, soViecTuan: 7, phanTichId: "pt3", viec, checkin: [] };
    const vm = dungManKeHoach(dauVao({ keHoach: { NGAY_7: kh } }));
    expect(vm.ngays).toHaveLength(7);
    expect(vm.ngayChon?.n).toBe(1);
    expect(vm.hero).toMatchObject({ daLam: 1, tong: viec.length, tuan: 1 });
    expect(vm.hero!.tile).toBe(Math.round((1 / viec.length) * 100));
    expect(vm.canTaoMoi).toBeNull();
    const ngay3 = dungManKeHoach(dauVao({ keHoach: { NGAY_7: kh }, ngayChon: 3 }));
    for (const v of ngay3.viecNgay) expect(v.cho.tick).toBe(false); // chưa tới ngày 3
    expect(ngay3.viecNgay.every((v) => v.cho.lyDoKhong === "Việc này chưa tới ngày.")).toBe(true);
    // Có bản phân tích mới hơn bản mà kế hoạch dựa vào ⇒ gợi ý cập nhật (không tự đổi)
    const cu = dungManKeHoach(dauVao({ keHoach: { NGAY_7: kh }, phanTichIdMoiNhat: "pt4", soBanMoiNhat: 4 }));
    expect(cu.capNhat).toBe("Có kết quả mới (bản tính số 4).");
    expect(vm.capNhat).toBeNull();
    sach({ ...vm, tabs: undefined });
  });

  it("[SG-MH-16] chuỗi ngày liên tiếp: đếm lùi từ hôm nay (hoặc hôm qua nếu hôm nay chưa làm); ngày hổng thì dừng", () => {
    const v = (ngay: string, xong: boolean) => ({ ngay, xongLuc: xong ? GOC_GIO : null });
    expect(chuoiNgayLienTiep([v("2026-11-03", true), v("2026-11-02", true), v("2026-11-01", true)], "2026-11-03")).toBe(3);
    expect(chuoiNgayLienTiep([v("2026-11-02", true), v("2026-11-01", true)], "2026-11-03")).toBe(2);
    expect(chuoiNgayLienTiep([v("2026-11-03", true), v("2026-10-31", true)], "2026-11-03")).toBe(1);
    expect(chuoiNgayLienTiep([v("2026-11-03", false)], "2026-11-03")).toBe(0);
    expect(chuoiNgayLienTiep([], "2026-11-03")).toBe(0);
  });

  it("[SG-MH-17] check-in: nạp điểm đã lưu; tuần không vượt tuần hiện tại; cặp được chọn được đánh dấu", () => {
    const dv = dauVaoNha("du-ca-nha");
    const kh = {
      id: "kh1",
      ky: "THANG_1" as const,
      batDau: "2026-11-03",
      doKho: 1,
      soViecTuan: 7,
      phanTichId: "pt3",
      viec: [],
      checkin: [{ thanhVienId: "me", tuan: 1, diem: 4, capDeChiu: "bo|me" }],
    };
    const vm = dungManKeHoach(dauVao({ tab: "CHECKIN", keHoach: { THANG_1: kh }, tuanChon: 9, homNay: "2026-11-12" }));
    expect(vm.checkin?.tuan).toBe(2); // hôm nay thuộc tuần 2 ⇒ kẹp
    const t1 = dungManKeHoach(dauVao({ tab: "CHECKIN", keHoach: { THANG_1: kh }, tuanChon: 1, homNay: "2026-11-12" }));
    expect(t1.checkin?.nguoi.find((n) => n.id === "me")?.diem).toBe(4);
    expect(t1.checkin?.nguoi.find((n) => n.id === "bo")?.diem).toBeNull();
    expect(t1.checkin?.caps.filter((c) => c.chon)).toHaveLength(1);
    expect(dv.thanhVien).toHaveLength(4);
  });
});
