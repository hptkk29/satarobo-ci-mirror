// Ca [ENG-CS-*] — chính sách hoá đơn có phiên bản + hiệu lực, FAIL-CLOSED (engine S3, shadow).
//
// Luật cần khoá: (1) không quy tắc ⇒ lỗi tường minh, KHÔNG rơi về 8% như `thueChoLoaiDon`; (2) chồng hiệu lực ⇒ lỗi
// kèm id, không chọn "cái mới hơn"; (3) đích danh hơn thắng chung, nhưng hai chiều khác nhau cùng điểm là chồng;
// (4) bản chiếu cấu hình hiện hành trùng `thueChoLoaiDon`; (5) mô phỏng không phát hành.
//
// Mọi quy tắc trong test là DỮ LIỆU THỬ (mã `THU_NGHIEM_*`) — không phải mức thuế pháp lý nào (TD-10).
import { describe, expect, it } from "vitest";
import { CAU_HINH_HOA_DON_MAC_DINH, thueChoLoaiDon } from "../phap-nhan";
import { cauHinhHoaDonChoMoiTruong } from "../phap-nhan-theo-moi-truong";
import {
  canhBaoSapHetHan,
  chinhSachHienHanh,
  idQuyTac,
  kiemBoQuyTac,
  moPhong,
  resolve,
  type KhoaChinhSach,
  type QuyTac,
} from "./chinh-sach";
import { KIEU_GIA, kiemBatBien } from "./tien-thue";

const ts = (o: Partial<QuyTac["thongSo"]> = {}): QuyTac["thongSo"] => ({
  mucThue: { kieu: "SUAT", phanTram: 8 },
  kieuGia: KIEU_GIA.DA_GOM_THUE,
  donViTinh: "Khoá",
  donViTinhBuoi: "Buổi",
  cachThuSoBuoi: "MOT_KHOA_MO_TA_SO_BUOI",
  mauMoTaSoBuoi: "({n} buổi)",
  thoiDiemLap: "KHI_THU_TIEN",
  ...o,
});

const qt = (o: Partial<QuyTac> & { ma: string }): QuyTac => ({
  phienBan: 1,
  phapNhanMa: null,
  centerId: null,
  loaiKhoan: "TAT_CA",
  hieuLucTu: "2026-01-01",
  hieuLucDen: "2026-12-31",
  dangBat: true,
  nguon: "CAU_HINH",
  canCuPhapLy: null,
  thongSo: ts(),
  ...o,
});

const KHOA: KhoaChinhSach = { phapNhanMa: "SATA_ROBO", centerId: "cs1", loaiKhoan: "COURSE" };
/** Mã vấn đề (đã sắp) mà `kiemBoQuyTac` báo cho một bộ — dùng cho các ca biên ở cuối tệp. */
const ma2 = (bo: QuyTac[]) => kiemBoQuyTac(bo).map((v) => v.ma).sort();

describe("[ENG-CS-01] resolve: đúng một quy tắc ⇒ trả nó; ngày biên gồm cả hai đầu", () => {
  const bo = [qt({ ma: "THU_NGHIEM_A", hieuLucTu: "2026-03-01", hieuLucDen: "2026-06-30" })];
  it.each([["2026-03-01", true], ["2026-06-30", true], ["2026-02-28", false], ["2026-07-01", false]])("ngày %s ⇒ có quy tắc: %s", (ngay, co) => {
    const r = resolve(bo, KHOA, ngay);
    expect(r.ok).toBe(co);
    if (r.ok) expect(r.quyTac.ma).toBe("THU_NGHIEM_A"); // trả ĐÚNG quy tắc, không chỉ "ok"
  });
  it("hieuLucTu/hieuLucDen null = không có mốc đó", () => {
    const mo = [qt({ ma: "THU_NGHIEM_MO", hieuLucTu: null, hieuLucDen: null })];
    expect(resolve(mo, KHOA, "1999-01-01")).toMatchObject({ ok: true, quyTac: { ma: "THU_NGHIEM_MO" } });
    expect(resolve(mo, KHOA, "2099-12-31")).toMatchObject({ ok: true, quyTac: { ma: "THU_NGHIEM_MO" } });
  });
  it("quy tắc TẮT không bao giờ khớp", () => {
    const r = resolve([qt({ ma: "X", dangBat: false })], KHOA, "2026-05-05");
    expect(r).toMatchObject({ ok: false, ma: "KHONG_CO" });
  });
  it("ngày không hợp lệ (30/02, rỗng, sai dạng) ⇒ NGAY_KHONG_HOP_LE, không đoán", () => {
    for (const n of ["2026-02-30", "", "05/05/2026", "2026-5-5"]) expect(resolve(bo, KHOA, n)).toMatchObject({ ok: false, ma: "NGAY_KHONG_HOP_LE" });
  });
});

describe("[ENG-CS-02] FAIL-CLOSED: không có quy tắc ⇒ lỗi tường minh, KHÔNG mặc định ngầm", () => {
  it("bộ rỗng ⇒ KHONG_CO (trong khi thueChoLoaiDon rơi về 8%/đã gồm thuế)", () => {
    expect(resolve([], KHOA, "2026-05-05")).toMatchObject({ ok: false, ma: "KHONG_CO" });
    expect(thueChoLoaiDon("COURSE", { thue: [] })).toEqual({ thueSuat: 8, kieuGia: KIEU_GIA.DA_GOM_THUE }); // đối chứng: mặc định NGẦM ở mã cũ
  });
  it("quy tắc của pháp nhân/cơ sở/loại khác không bao giờ rơi sang khoá này", () => {
    const bo = [qt({ ma: "A", phapNhanMa: "NEW_VISION" }), qt({ ma: "B", centerId: "cs2" }), qt({ ma: "C", loaiKhoan: "PRODUCT" })];
    expect(resolve(bo, KHOA, "2026-05-05")).toMatchObject({ ok: false, ma: "KHONG_CO" });
  });
});

describe("[ENG-CS-03] độ cụ thể + chồng hiệu lực", () => {
  it("đích danh loại khoản thắng TAT_CA (cùng luật thueChoLoaiDon)", () => {
    const bo = [qt({ ma: "CHUNG" }), qt({ ma: "RIENG", loaiKhoan: "COURSE", thongSo: ts({ mucThue: { kieu: "KCT" } }) })];
    const r = resolve(bo, KHOA, "2026-05-05");
    expect(r.ok && r.quyTac.ma).toBe("RIENG");
    // loại khoản khác ⇒ rơi về quy tắc chung
    const r2 = resolve(bo, { ...KHOA, loaiKhoan: "PRODUCT" }, "2026-05-05");
    expect(r2.ok && r2.quyTac.ma).toBe("CHUNG");
  });
  it("pháp nhân + cơ sở + loại khoản (3 chiều) thắng 2 chiều thắng 1 chiều", () => {
    const bo = [qt({ ma: "M1" }), qt({ ma: "M2", phapNhanMa: "SATA_ROBO" }), qt({ ma: "M3", phapNhanMa: "SATA_ROBO", centerId: "cs1" }), qt({ ma: "M4", phapNhanMa: "SATA_ROBO", centerId: "cs1", loaiKhoan: "COURSE" })];
    const r = resolve(bo, KHOA, "2026-05-05");
    expect(r.ok && r.quyTac.ma).toBe("M4");
  });
  it("hai quy tắc CÙNG phạm vi cùng hiệu lực ⇒ CHONG_HIEU_LUC kèm id cả hai (không chọn cái phiên bản cao hơn)", () => {
    const bo = [qt({ ma: "P", phienBan: 1 }), qt({ ma: "P", phienBan: 2 })];
    const r = resolve(bo, KHOA, "2026-05-05");
    expect(r).toMatchObject({ ok: false, ma: "CHONG_HIEU_LUC", cacQuyTac: ["P@v1", "P@v2"] });
  });
  it("cùng điểm nhưng KHÁC chiều (A: đích danh pháp nhân · B: đích danh loại khoản) ⇒ CHỒNG, không có thứ tự ưu tiên giữa các chiều", () => {
    const bo = [qt({ ma: "A", phapNhanMa: "SATA_ROBO" }), qt({ ma: "B", loaiKhoan: "COURSE" })];
    expect(resolve(bo, KHOA, "2026-05-05")).toMatchObject({ ok: false, ma: "CHONG_HIEU_LUC", cacQuyTac: ["A@v1", "B@v1"] });
  });
  it("hai quy tắc cùng phạm vi nhưng KHÔNG trùng ngày ⇒ không chồng", () => {
    const bo = [qt({ ma: "P", phienBan: 1, hieuLucDen: "2026-06-30" }), qt({ ma: "P", phienBan: 2, hieuLucTu: "2026-07-01" })];
    expect(resolve(bo, KHOA, "2026-06-30")).toMatchObject({ ok: true, quyTac: { phienBan: 1 } });
    expect(resolve(bo, KHOA, "2026-07-01")).toMatchObject({ ok: true, quyTac: { phienBan: 2 } });
  });
  it("khoảng hở giữa hai phiên bản ⇒ trong khoảng đó là KHONG_CO (không nối mốc cho người dùng)", () => {
    const bo = [qt({ ma: "P", phienBan: 1, hieuLucDen: "2026-06-30" }), qt({ ma: "P", phienBan: 2, hieuLucTu: "2026-07-05" })];
    expect(resolve(bo, KHOA, "2026-07-02")).toMatchObject({ ok: false, ma: "KHONG_CO" });
  });
});

describe("[ENG-CS-04] kiemBoQuyTac: chồng ngày · khoảng hở · hiệu lực ngược · ngày sai · thông số sai · trùng phiên bản", () => {
  const ma = (bo: QuyTac[]) => kiemBoQuyTac(bo).map((v) => v.ma).sort();
  it("bộ sạch ⇒ rỗng (hai phiên bản nối liền nhau)", () => {
    expect(kiemBoQuyTac([qt({ ma: "P", phienBan: 1, hieuLucDen: "2026-06-30" }), qt({ ma: "P", phienBan: 2, hieuLucTu: "2026-07-01", hieuLucDen: "2026-12-31" })])).toEqual([]);
  });
  it("chồng ngày cùng phạm vi ⇒ CHONG_HIEU_LUC (LOI)", () => {
    const v = kiemBoQuyTac([qt({ ma: "P", phienBan: 1, hieuLucDen: "2026-07-15" }), qt({ ma: "P", phienBan: 2, hieuLucTu: "2026-07-01" })]);
    expect(v).toEqual([expect.objectContaining({ ma: "CHONG_HIEU_LUC", cap: "LOI", cacQuyTac: ["P@v1", "P@v2"] })]);
  });
  it("chồng ngày KHÁC chiều cùng điểm cũng bị bắt (A đích danh pháp nhân, B đích danh loại khoản)", () => {
    expect(ma([qt({ ma: "A", phapNhanMa: "SATA_ROBO" }), qt({ ma: "B", loaiKhoan: "COURSE" })])).toEqual(["CHONG_HIEU_LUC"]);
  });
  it("đích danh hơn chồng ngày với chung là HỢP LỆ (đích danh thắng)", () => {
    expect(kiemBoQuyTac([qt({ ma: "CHUNG" }), qt({ ma: "RIENG", loaiKhoan: "COURSE" })])).toEqual([]);
  });
  it("hai pháp nhân khác nhau cùng loại khoản không chồng", () => {
    expect(kiemBoQuyTac([qt({ ma: "A", phapNhanMa: "SATA_ROBO" }), qt({ ma: "B", phapNhanMa: "NEW_VISION" })])).toEqual([]);
  });
  it("khoảng hở ⇒ KHOANG_HO (CANH_BAO, không phải LOI)", () => {
    const v = kiemBoQuyTac([qt({ ma: "P", phienBan: 1, hieuLucDen: "2026-06-30" }), qt({ ma: "P", phienBan: 2, hieuLucTu: "2026-07-05" })]);
    expect(v).toEqual([expect.objectContaining({ ma: "KHOANG_HO", cap: "CANH_BAO" })]);
  });
  it("hiệu lực ngược · ngày không hợp lệ", () => {
    expect(ma([qt({ ma: "P", hieuLucTu: "2026-09-01", hieuLucDen: "2026-08-01" })])).toEqual(["HIEU_LUC_NGUOC"]);
    expect(ma([qt({ ma: "P", hieuLucTu: "2026-02-30" })])).toEqual(["NGAY_KHONG_HOP_LE"]);
  });
  it("thông số sai: thuế suất lẻ / > 100, đơn vị tính rỗng, phiên bản 0, mã rỗng", () => {
    expect(ma([qt({ ma: "P", thongSo: ts({ mucThue: { kieu: "SUAT", phanTram: 8.5 } }) })])).toEqual(["THONG_SO_SAI"]);
    expect(ma([qt({ ma: "P", thongSo: ts({ mucThue: { kieu: "SUAT", phanTram: 101 } }) })])).toEqual(["THONG_SO_SAI"]);
    expect(ma([qt({ ma: "P", thongSo: ts({ donViTinh: " " }) })])).toEqual(["THONG_SO_SAI"]);
    expect(ma([qt({ ma: "P", phienBan: 0 })])).toEqual(["THONG_SO_SAI"]);
    expect(ma([qt({ ma: " " })])).toEqual(["THONG_SO_SAI"]);
  });
  it("trùng (mã, phiên bản) ⇒ TRUNG_PHIEN_BAN", () => {
    expect(ma([qt({ ma: "P", phapNhanMa: "A" }), qt({ ma: "P", phapNhanMa: "B" })])).toEqual(["TRUNG_PHIEN_BAN"]);
  });
  it("quy tắc TẮT không tính vào chồng ngày", () => {
    expect(kiemBoQuyTac([qt({ ma: "P", phienBan: 1 }), qt({ ma: "P", phienBan: 2, dangBat: false })])).toEqual([]);
  });
});

describe("[ENG-CS-05] chinhSachHienHanh phản chiếu CHÍNH XÁC cấu hình đang sống", () => {
  const cauHinh = cauHinhHoaDonChoMoiTruong({}); // env rỗng = PRODUCTION: chính hằng, ba pháp nhân thật
  const LOAI_DON = ["COURSE", "PACKAGE", "EXAM", "PRODUCT", "COMBO", "TAT_CA"];

  it("tiền đề: cửa môi trường trả CHÍNH hằng cấu hình (không bản sao) — mirror đo trên đúng thứ prod dùng", () => {
    expect(cauHinh).toBe(CAU_HINH_HOA_DON_MAC_DINH);
  });
  it("mỗi dòng `thue` ⇒ đúng một quy tắc HIEN_HANH, không ngày hiệu lực, không phạm vi pháp nhân/cơ sở", () => {
    const bo = chinhSachHienHanh(cauHinh);
    expect(bo).toHaveLength(cauHinh.thue.length);
    for (const q of bo) {
      expect(q).toMatchObject({ nguon: "HIEN_HANH", hieuLucTu: null, hieuLucDen: null, phapNhanMa: null, centerId: null, dangBat: true, canCuPhapLy: null });
    }
    expect(kiemBoQuyTac(bo)).toEqual([]);
  });
  it.each(LOAI_DON)("loại đơn %s: resolve cho CÙNG (thuế suất, kiểu giá) với thueChoLoaiDon", (loai) => {
    const bo = chinhSachHienHanh(cauHinh);
    const cu = thueChoLoaiDon(loai, cauHinh);
    const r = resolve(bo, { phapNhanMa: "SATA_ROBO", centerId: "cs1", loaiKhoan: loai }, "2026-11-01");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.quyTac.thongSo.mucThue).toEqual({ kieu: "SUAT", phanTram: cu.thueSuat });
      expect(r.quyTac.thongSo.kieuGia).toBe(cu.kieuGia);
    }
  });
  it("cấu hình có dòng đích danh (EXAM 10% chưa gồm thuế) ⇒ mirror giữ ưu tiên đích danh > TAT_CA như thueChoLoaiDon", () => {
    const thue = [...cauHinh.thue, { loaiDon: "EXAM", thueSuat: 10, kieuGia: KIEU_GIA.CHUA_GOM_THUE }];
    const bo = chinhSachHienHanh({ thue });
    for (const loai of ["EXAM", "COURSE"]) {
      const r = resolve(bo, { phapNhanMa: "X", centerId: "y", loaiKhoan: loai }, "2026-11-01");
      const cu = thueChoLoaiDon(loai, { thue });
      expect(r.ok && r.quyTac.thongSo.mucThue).toEqual({ kieu: "SUAT", phanTram: cu.thueSuat });
      expect(r.ok && r.quyTac.thongSo.kieuGia).toBe(cu.kieuGia);
    }
  });
  it("KHÁC có chủ đích: cấu hình không có dòng `thue` ⇒ thueChoLoaiDon đoán 8%, mirror trả KHONG_CO", () => {
    const bo = chinhSachHienHanh({ thue: [] });
    expect(bo).toEqual([]);
    expect(resolve(bo, KHOA, "2026-11-01")).toMatchObject({ ok: false, ma: "KHONG_CO" });
    expect(thueChoLoaiDon("COURSE", { thue: [] }).thueSuat).toBe(8);
  });
  it("KHÁC có chủ đích: cấu hình khai trùng loại đơn ⇒ mirror báo CHỒNG (thueChoLoaiDon lặng lẽ lấy dòng đầu)", () => {
    const bo = chinhSachHienHanh({ thue: [{ loaiDon: "TAT_CA", thueSuat: 8, kieuGia: KIEU_GIA.DA_GOM_THUE }, { loaiDon: "TAT_CA", thueSuat: 10, kieuGia: KIEU_GIA.DA_GOM_THUE }] });
    expect(resolve(bo, KHOA, "2026-11-01")).toMatchObject({ ok: false, ma: "CHONG_HIEU_LUC" });
  });
  it("id quy tắc dạng `<mã>@v<phiên bản>`", () => {
    expect(idQuyTac({ ma: "HIEN_HANH:TAT_CA", phienBan: 1 })).toBe("HIEN_HANH:TAT_CA@v1");
  });
});

describe("[ENG-CS-06] moPhong: xem trước, nhiều mức thuế/hoá đơn, KHÔNG phát hành", () => {
  const bo: QuyTac[] = [
    qt({ ma: "THU_NGHIEM_HOC_PHI", loaiKhoan: "THU_TIEN", thongSo: ts({ mucThue: { kieu: "KCT" } }) }),
    qt({ ma: "THU_NGHIEM_HOC_CU", loaiKhoan: "THU_HOC_CU", thongSo: ts({ mucThue: { kieu: "SUAT", phanTram: 8 }, donViTinh: "Bộ" }) }),
  ];
  const vao = {
    chinhSach: bo,
    phapNhanMa: "SATA_ROBO",
    centerId: "cs1",
    ngay: "2026-11-01",
    tongChietKhau: 123_457,
    laDieuChinh: false,
    canhBaoHetHanTrongNgay: 90,
    dong: [
      { ma: "it-1", tenGoc: "Sata 4", loaiKhoan: "THU_TIEN", soTien: 8_976_000, soBuoi: 48 },
      { ma: "it-2", tenGoc: "Bộ kit Sata 4", loaiKhoan: "THU_HOC_CU", soTien: 1_851_851, soBuoi: null },
    ],
  } as const;

  it("hai loại khoản ⇒ hai mức thuế, tổng khớp, bất biến sạch, cờ xem-trước cố định", () => {
    const r = moPhong({ ...vao, dong: [...vao.dong] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xemTruoc).toBe(true);
    expect(r.daPhatHanh).toBe(false);
    expect(r.tinh.tong.theoNhomThue.map((n) => n.khoa)).toEqual(["KCT", "SUAT:8"]);
    expect(r.tinh.dong[0]).toMatchObject({ ten: "Sata 4 (48 buổi)", donViTinh: "Khoá", soLuong: 1 });
    expect(r.tinh.dong[1]).toMatchObject({ donViTinh: "Bộ" });
    expect(r.tinh.tong.tongChietKhau).toBe(123_457);
    expect(kiemBatBien(r.tinh, vao.dong.reduce((s, d) => s + d.soTien, 0) - 123_457)).toEqual([]);
    expect(r.quyTacDaDung.map((x) => x.quyTac)).toEqual(["THU_NGHIEM_HOC_PHI@v1", "THU_NGHIEM_HOC_CU@v1"]);
    expect(r.tinh.dong[0]!.chup.thamChieuChinhSach).toBe("THU_NGHIEM_HOC_PHI@v1");
  });
  it("một dòng không có quy tắc ⇒ cả bản xem trước thất bại, chỉ đúng dòng đó bị báo (không dựng nửa chừng)", () => {
    const r = moPhong({ ...vao, dong: [vao.dong[0], { ...vao.dong[1], loaiKhoan: "THU_LE_PHI_THI" }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.daPhatHanh).toBe(false);
    expect(r.loi).toEqual([expect.objectContaining({ ma: "KHONG_CO", dong: "it-2" })]);
  });
  it("chồng hiệu lực ở một dòng ⇒ lỗi CHONG_HIEU_LUC cho dòng đó", () => {
    const r = moPhong({ ...vao, chinhSach: [...bo, qt({ ma: "THU_NGHIEM_TRUNG", loaiKhoan: "THU_TIEN" })], dong: [vao.dong[0]] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi[0]).toMatchObject({ ma: "CHONG_HIEU_LUC", dong: "it-1" });
  });
  it("cảnh báo quy tắc sắp hết hạn trong N ngày — mỗi quy tắc một lần", () => {
    const r = moPhong({ ...vao, ngay: "2026-11-01", dong: [vao.dong[0], { ...vao.dong[0], ma: "it-3" }] });
    expect(r.ok && r.canhBao).toHaveLength(1);
    const xa = moPhong({ ...vao, canhBaoHetHanTrongNgay: 10, dong: [vao.dong[0]] });
    expect(xa.ok && xa.canhBao).toEqual([]);
  });
  it("số buổi sai ⇒ lỗi SO_BUOI_SAI gắn đúng dòng", () => {
    const r = moPhong({ ...vao, dong: [{ ...vao.dong[0], soBuoi: -1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi[0]).toMatchObject({ ma: "SO_BUOI_SAI", dong: "it-1" });
  });
});

describe("[ENG-CS-07] canhBaoSapHetHan", () => {
  const q = qt({ ma: "P", hieuLucDen: "2026-12-31" });
  it("trong hạn ⇒ có câu cảnh báo kèm số ngày còn lại", () => {
    expect(canhBaoSapHetHan(q, "2026-11-01", 60)).toMatch(/còn 60 ngày/);
    expect(canhBaoSapHetHan(q, "2026-12-31", 0)).toMatch(/còn 0 ngày/);
  });
  it("ngoài hạn · đã hết · không có mốc kết thúc ⇒ null", () => {
    expect(canhBaoSapHetHan(q, "2026-11-01", 59)).toBeNull();
    expect(canhBaoSapHetHan(q, "2027-01-01", 90)).toBeNull();
    expect(canhBaoSapHetHan(qt({ ma: "P", hieuLucDen: null }), "2026-11-01", 9999)).toBeNull();
  });
});

describe("[ENG-CS-08] chiều CƠ SỞ: quy tắc đích danh cơ sở thắng quy tắc chung (hợp đồng 'mở CS mới = thêm dữ liệu')", () => {
  it("[CHUNG, CS1 đích danh]: cơ sở cs1 ⇒ quy tắc cs1; cơ sở khác ⇒ rơi về CHUNG, không bao giờ CHONG_HIEU_LUC", () => {
    const bo = [qt({ ma: "CHUNG" }), qt({ ma: "RIENG_CS1", centerId: "cs1", thongSo: ts({ mucThue: { kieu: "KCT" } }) })];
    const r = resolve(bo, KHOA, "2026-05-05");
    expect(r.ok && r.quyTac.ma).toBe("RIENG_CS1");
    const r2 = resolve(bo, { ...KHOA, centerId: "cs2" }, "2026-05-05");
    expect(r2.ok && r2.quyTac.ma).toBe("CHUNG");
  });
  it("chiều cơ sở CÓ trọng số: cơ sở + loại khoản (2 chiều) thắng riêng pháp nhân (1 chiều)", () => {
    const bo = [qt({ ma: "PHAP_NHAN", phapNhanMa: "SATA_ROBO" }), qt({ ma: "CS_LOAI", centerId: "cs1", loaiKhoan: "COURSE" })];
    const r = resolve(bo, KHOA, "2026-05-05");
    expect(r.ok && r.quyTac.ma).toBe("CS_LOAI");
  });
  it("cơ sở và loại khoản là HAI chiều khác nhau cùng điểm ⇒ CHỒNG (không có thứ tự ưu tiên giữa các chiều)", () => {
    const bo = [qt({ ma: "A", centerId: "cs1" }), qt({ ma: "B", loaiKhoan: "COURSE" })];
    expect(resolve(bo, KHOA, "2026-05-05")).toMatchObject({ ok: false, ma: "CHONG_HIEU_LUC", cacQuyTac: ["A@v1", "B@v1"] });
  });
  it("mở CS3 = thêm MỘT dòng dữ liệu: cs3 nhận mức riêng, cs1 giữ mức chung (moPhong, không sửa mã)", () => {
    const bo: QuyTac[] = [
      qt({ ma: "THU_NGHIEM_CHUNG", loaiKhoan: "THU_TIEN", thongSo: ts({ mucThue: { kieu: "KCT" } }) }),
      qt({ ma: "THU_NGHIEM_CS3", centerId: "cs3", loaiKhoan: "THU_TIEN", thongSo: ts({ mucThue: { kieu: "SUAT", phanTram: 10 } }) }),
    ];
    const chay = (centerId: string) =>
      moPhong({ chinhSach: bo, phapNhanMa: "SATA_ROBO", centerId, ngay: "2026-11-01", tongChietKhau: 0, laDieuChinh: false, canhBaoHetHanTrongNgay: 0, dong: [{ ma: "it-1", tenGoc: "Sata 4", loaiKhoan: "THU_TIEN", soTien: 1_000_003, soBuoi: null }] });
    const cs3 = chay("cs3");
    const cs1 = chay("cs1");
    expect(cs3.ok && cs3.tinh.tong.theoNhomThue.map((n) => n.khoa)).toEqual(["SUAT:10"]);
    expect(cs1.ok && cs1.tinh.tong.theoNhomThue.map((n) => n.khoa)).toEqual(["KCT"]);
    expect(cs3.ok && cs3.quyTacDaDung[0]!.quyTac).toBe("THU_NGHIEM_CS3@v1");
  });
  it("kiemBoQuyTac: quy tắc đích danh cơ sở chồng ngày với quy tắc chung là HỢP LỆ; hai cơ sở khác nhau không chồng", () => {
    expect(kiemBoQuyTac([qt({ ma: "CHUNG" }), qt({ ma: "RIENG_CS1", centerId: "cs1" })])).toEqual([]);
    expect(kiemBoQuyTac([qt({ ma: "A", centerId: "cs1" }), qt({ ma: "B", centerId: "cs2" })])).toEqual([]);
  });
  it("kiemBoQuyTac: hai quy tắc CÙNG cơ sở cùng hiệu lực vẫn là CHỒNG (đối chứng: chiều cơ sở không làm bộ kiểm im lặng)", () => {
    expect(ma2([qt({ ma: "A", centerId: "cs1" }), qt({ ma: "B", centerId: "cs1" })])).toEqual(["CHONG_HIEU_LUC"]);
  });
});

describe("[ENG-CS-09] ngày BIÊN: hai quy tắc dùng chung đúng MỘT ngày là CHỒNG; sát nhau không chung ngày nào thì không", () => {
  const A = (den: string) => qt({ ma: "P", phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: den });
  const B = (tuNgay: string) => qt({ ma: "P", phienBan: 2, hieuLucTu: tuNgay, hieuLucDen: "2026-12-31" });
  it("A đến 30/06, B từ 30/06 ⇒ CHONG_HIEU_LUC (cả hai thứ tự đưa vào — bộ kiểm đối xứng)", () => {
    for (const bo of [[A("2026-06-30"), B("2026-06-30")], [B("2026-06-30"), A("2026-06-30")]]) {
      expect(kiemBoQuyTac(bo)).toEqual([expect.objectContaining({ ma: "CHONG_HIEU_LUC", cap: "LOI", cacQuyTac: ["P@v1", "P@v2"] })]);
    }
  });
  it("B bắt đầu NGAY SAU ngày cuối của A (01/07) ⇒ sạch", () => {
    expect(kiemBoQuyTac([A("2026-06-30"), B("2026-07-01")])).toEqual([]);
  });
  it("B kết thúc đúng ngày A bắt đầu (cùng một ngày biên ở đầu kia) ⇒ cũng CHỒNG", () => {
    const sau = qt({ ma: "P", phienBan: 2, hieuLucTu: "2026-03-01", hieuLucDen: "2026-12-31" });
    const truoc = qt({ ma: "P", phienBan: 1, hieuLucTu: "2025-01-01", hieuLucDen: "2026-03-01" });
    expect(ma2([truoc, sau])).toEqual(["CHONG_HIEU_LUC"]);
    expect(ma2([sau, truoc])).toEqual(["CHONG_HIEU_LUC"]);
  });
  it("resolve đúng ngày biên chung ⇒ CHONG_HIEU_LUC kèm id cả hai; ngày trước biên ⇒ chỉ phiên bản 1", () => {
    const bo = [A("2026-06-30"), B("2026-06-30")];
    expect(resolve(bo, KHOA, "2026-06-30")).toMatchObject({ ok: false, ma: "CHONG_HIEU_LUC", cacQuyTac: ["P@v1", "P@v2"] });
    expect(resolve(bo, KHOA, "2026-06-29")).toMatchObject({ ok: true, quyTac: { phienBan: 1 } });
  });
});

describe("[ENG-CS-10] kiemBoQuyTac: biên thuế suất 0 và 100 hợp lệ, −1 và 101 bị từ chối", () => {
  const voi = (phanTram: number) => ma2([qt({ ma: "P", thongSo: ts({ mucThue: { kieu: "SUAT", phanTram } }) })]);
  it.each([[0], [100]])("%i ⇒ sạch", (p) => expect(voi(p)).toEqual([]));
  it.each([[-1], [101]])("%i ⇒ THONG_SO_SAI", (p) => expect(voi(p)).toEqual(["THONG_SO_SAI"]));
});
