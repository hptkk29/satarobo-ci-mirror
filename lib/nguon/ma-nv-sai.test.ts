/**
 * Ca [MNR-*] — MÃ NV GIỚI THIỆU SAI trong Excel (hướng F, 11/10/2026). THUẦN, không DB. Ngày TUYỆT ĐỐI (luật 19).
 *
 * Luật chủ dự án: mã NV giới thiệu gõ mà KHÔNG dùng được ⇒ lead VẪN được tạo; nguồn ở nhóm nhân sự mặc định, CHƯA CÓ người
 * (`referrerMissing`), mang dấu xem tay `INVALID_EMPLOYEE_REFERRER_CODE` + `signals.maNvSai`; KHÔNG gán ai, nên không sinh hoa hồng giới thiệu
 * cho tới khi người duyệt «Bổ sung người». Trước đó lead rơi UNKNOWN (đường `import-excel` không thuộc `DUONG_VAO_MAC_DINH`) và MẤT mã đã gõ.
 *
 *   [MNR-01]   `quyetDinhMaNvGioiThieu` trả đúng `phanLoai` + `ma` cho từng lý do mã không dùng được; DUNG/KHONG_CO không có
 *   [MNR-01b]  `maNvSaiTuKetQua` · `maNvSaiKhacMa` · `gopMaCungSdt` (giữ ô gốc) · `ma` chỉ có dạng mã, chuỗi gốc đi vào `raw` (cổng đọc ở `ma-nv-goc.test.ts`)
 *   [MNR-02]   `quyNguon` + maNvSai ⇒ nhóm nhân sự mặc định, referrerMissing, KHÔNG người, đúng xemTay, đúng signals
 *   [MNR-02b]  đối chứng dương: KHÔNG có maNvSai ⇒ nhãn rỗng vẫn UNKNOWN (luật mới không phình ra), mã ĐÚNG ⇒ gán người
 *   [MNR-03]   nhãn MÂU THUẪN (Ads + mã): nhóm GIỮ theo nhãn, KHÔNG referrerMissing, vẫn có xemTay + coXemTay + signals.maNvSai
 *   [MNR-03b]  cấu hình nhóm nhân sự trỏ SAI ⇒ luật không khớp nhưng mã KHÔNG mất (xemTay + signals vẫn có)
 *   [MNR-03c]  KE_THUA_SDT thắng ⇒ nguồn kế thừa nguyên văn, KHÔNG xemTay lên dòng kế thừa, chỉ ghi vết signals.maNvSai
 *   [MNR-04]   cờ con `referral` TẮT ⇒ luật tắt theo (thuộc tính, không so mã)
 */
import type { SourceReferrerRequirement } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { DANH_MUC_GOC, VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import {
  cacMaGocKhacNhau,
  dungBangTraMaNv,
  gopMaCungSdt,
  maNvSaiKhacMa,
  maNvSaiTuKetQua,
  quyetDinhMaNvGioiThieu,
  type NhomYeuCau,
} from "./ma-nv-gioi-thieu";
import { THU_TU_LUAT_MAC_DINH, dungCauHinhQuyNguon, quyNguon } from "./quy-nguon";
import type { CoQuyNguon, KeThuaGoc, MaNvSai, TinHieuQuyNguon } from "./tin-hieu";
import { ANH_CHUP_TRONG } from "./tin-hieu";

const d = (iso: string) => new Date(iso);
const BAY_GIO = d("2026-10-11T03:00:00.000Z");

// ── [MNR-01] phân loại lý do ──────────────────────────────────────────────────────────────────────────
const NHAN_VIEN = [
  { id: "E_HUE", employeeCode: "SR.NV.002", status: "ACTIVE" },
  { id: "E_NGHI", employeeCode: "SR.NV.010", status: "RESIGNED" },
  { id: "E_A", employeeCode: "NV.SR.020", status: "ACTIVE" },
  { id: "E_B", employeeCode: "SR.NV.020", status: "ACTIVE" }, // sau chuẩn hoá trùng E_A ⇒ mơ hồ
] as const;
const NHOM: NhomYeuCau = new Map<string, SourceReferrerRequirement>([
  ["EMPLOYEE_REFERRAL", "EMPLOYEE"],
  ["PAID_ADS", "NONE"],
  ["PARENT_REFERRAL", "PARENT"],
  ["UNKNOWN", "NONE"],
]);
const hoi = (maTho: string | null, nhanKhai: string | null) =>
  quyetDinhMaNvGioiThieu({
    maTho,
    nhanKhai,
    ngayGiaiMa: BAY_GIO,
    bayGio: BAY_GIO,
    bang: dungBangTraMaNv(NHAN_VIEN, []),
    nhomYeuCau: NHOM,
    nhomNhanSu: "EMPLOYEE_REFERRAL",
  });

describe("[MNR-01] mã không dùng được ⇒ BO_QUA mang phanLoai + ma (đối chứng dương: DUNG và KHONG_CO KHÔNG mang)", () => {
  it("mã không có trong hệ thống ⇒ KHONG_TON_TAI, ma đã chuẩn hoá", () => {
    const r = hoi("sr.nv.999", null);
    expect(r).toMatchObject({ kieu: "BO_QUA", phanLoai: "KHONG_TON_TAI", ma: "SR.NV.999" });
  });
  it("ô chứa TÊN người (không phải mã) ⇒ KHONG_TON_TAI — không bao giờ khớp theo tên", () => {
    const r = hoi("Nguyễn Thị Huệ", null);
    expect(r).toMatchObject({ kieu: "BO_QUA", phanLoai: "KHONG_TON_TAI" });
  });
  it("nhân sự đã nghỉ ⇒ DA_NGHI", () => {
    expect(hoi("SR.NV.010", null)).toMatchObject({ kieu: "BO_QUA", phanLoai: "DA_NGHI", ma: "SR.NV.010" });
  });
  it("hai nhân viên cùng một mã sau chuẩn hoá ⇒ MO_HO", () => {
    expect(hoi("SR.NV.020", null)).toMatchObject({ kieu: "BO_QUA", phanLoai: "MO_HO" });
  });
  it("nhãn Nguồn mâu thuẫn ('Ads' · 'Giới thiệu' · nhãn lạ) ⇒ NHAN_MAU_THUAN", () => {
    for (const nhan of ["Ads", "Giới thiệu", "Nguồn mới tinh"]) {
      expect(hoi("SR.NV.002", nhan), nhan).toMatchObject({ kieu: "BO_QUA", phanLoai: "NHAN_MAU_THUAN", ma: "SR.NV.002" });
    }
  });
  it("đối chứng dương: mã đúng ⇒ DUNG (không phanLoai); ô trống ⇒ KHONG_CO", () => {
    expect(hoi("SR.NV.002", null)).toEqual({ kieu: "DUNG", employeeId: "E_HUE" });
    expect(hoi("  ", "Ads")).toEqual({ kieu: "KHONG_CO" });
  });
});

describe("[MNR-01b] dựng MaNvSai từ kết quả giải mã", () => {
  it("BO_QUA ⇒ { ma, loai }; DUNG và KHONG_CO ⇒ null", () => {
    expect(maNvSaiTuKetQua(hoi("SR.NV.999", null))).toEqual({ ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: "SR.NV.999" });
    expect(maNvSaiTuKetQua(hoi("SR.NV.002", null))).toBeNull();
    expect(maNvSaiTuKetQua(hoi(null, null))).toBeNull();
  });
  it("ô chữ tự do dài (không có dạng mã) — ma = null, doDai giữ độ dài đã gõ, raw cắt 40; mã ngắn đúng dạng thì giữ nguyên", () => {
    const dai = "X".repeat(200);
    const kq = maNvSaiTuKetQua(hoi(dai, null));
    expect(kq).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 200, raw: "X".repeat(40) });
    const ngan = maNvSaiTuKetQua(hoi("ABC.1", null));
    expect(ngan!.ma).toBe("ABC.1");
  });
  it("các dòng cùng SĐT ghi mã KHÁC nhau: cacMaGocKhacNhau trả ô GỐC theo thứ tự mã chuẩn hoá; maNvSaiKhacMa nối bằng « | » KHÔNG phụ thuộc thứ tự dòng", () => {
    expect(gopMaCungSdt(["sr.nv.003", "SR.NV.001"])).toEqual({ ma: null, goc: null, khacNhau: true });
    const a = cacMaGocKhacNhau(["sr.nv.003", "SR.NV.001"]);
    const b = cacMaGocKhacNhau(["SR.NV.001", "sr.nv.003"]);
    expect(a).toEqual(["SR.NV.001", "sr.nv.003"]);
    expect(b).toEqual(a);
    expect(maNvSaiKhacMa(a)).toEqual({ ma: "SR.NV.001 | SR.NV.003", loai: "KHAC_MA", doDai: 18, raw: "SR.NV.001 | sr.nv.003" });
    expect(maNvSaiKhacMa(["B.1", "A.1"])).toEqual(maNvSaiKhacMa(["A.1", "B.1"]));
  });
  it("đối chứng dương: cùng mã ⇒ một phần tử (và gopMaCungSdt KHÔNG báo khacNhau); không mã ⇒ rỗng", () => {
    expect(cacMaGocKhacNhau(["sr.nv.001", "SR.NV.001", null])).toEqual(["SR.NV.001"]);
    expect(gopMaCungSdt(["sr.nv.001", "SR.NV.001", null]).khacNhau).toBe(false);
    expect(cacMaGocKhacNhau([null, "  "])).toEqual([]);
  });
});

// ── [MNR-02..04] resolver ─────────────────────────────────────────────────────────────────────────────
const CO_BAT: CoQuyNguon = { autoAttribution: true, pageMapping: true, referral: true, manualReview: true };

function cauHinh(o: { co?: Partial<CoQuyNguon>; nhomNhanSu?: string } = {}) {
  return dungCauHinhQuyNguon({
    nhom: DANH_MUC_GOC.map((g) => ({
      code: g.code,
      active: true,
      requiresNote: g.requiresNote,
      selectable: g.selectable,
      referrerRequirement: g.referrerRequirement,
      cuaSoRiengNgay: null,
      chuNhanVienId: null,
    })),
    co: { ...CO_BAT, ...o.co },
    vaiSangNguon: VAI_SANG_NGUON_MAC_DINH,
    nhomNhanSu: o.nhomNhanSu ?? "EMPLOYEE_REFERRAL",
    cuaSoMacDinhNgay: 90,
  });
}

function tin(over: Partial<TinHieuQuyNguon> = {}): TinHieuQuyNguon {
  return {
    bayGio: BAY_GIO,
    duongVao: "import-excel",
    conversionEntry: "Import Excel",
    nhanKhai: null,
    laNhapExcel: true,
    nguoiNhap: null,
    maNvKhongGiai: null,
    maNvSai: null,
    nhanSuGioiThieu: null,
    phuHuynhGioiThieu: null,
    saleCuaPhuHuynh: null,
    ref: null,
    refSau: [],
    quangCao: { adId: null, campaignId: null, adsetId: null, campaignName: null, formId: null, fbclid: null, gclid: null },
    utm: { source: null, medium: null, campaign: null, term: null, content: null },
    page: null,
    keThua: null,
    sdtTrungNhanVien: false,
    sdtNguoiGioiThieuTrungKhach: false,
    ...over,
  };
}

const SAI: MaNvSai = { ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: "sr.nv.999" };

describe("[MNR-02] mã sai + nhãn rỗng ⇒ nhóm nhân sự mặc định, THIẾU NGƯỜI, xem tay — không còn UNKNOWN", () => {
  const kq = quyNguon(tin({ maNvSai: SAI }), cauHinh());

  it("nhóm = nhóm nhân sự mặc định, luật NV_GIOI_THIEU_SAI, cách xác định SYSTEM_IMPORT", () => {
    expect(kq.groupCode).toBe("EMPLOYEE_REFERRAL");
    expect(kq.luat).toBe("NV_GIOI_THIEU_SAI");
    expect(kq.identificationMethod).toBe("SYSTEM_IMPORT");
  });
  it("KHÔNG gán người nào, referrerMissing = true (hold THIEU_NGUOI_GIOI_THIEU ở engine ⇒ không sinh 2%)", () => {
    expect(kq.nguoi).toBeNull();
    expect(kq.referrerMissing).toBe(true);
    expect(kq.anhChup.referrerRoleCode).toBeNull();
  });
  it("xemTay đúng một lý do INVALID_EMPLOYEE_REFERRER_CODE; signals mang coXemTay + maNvSai + bản chụp nguồn", () => {
    expect(kq.xemTay).toEqual(["INVALID_EMPLOYEE_REFERRER_CODE"]);
    expect(kq.signals.xemTay).toEqual(["INVALID_EMPLOYEE_REFERRER_CODE"]);
    expect(kq.signals.coXemTay).toBe(true);
    expect(kq.signals.maNvSai).toEqual({ ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: "sr.nv.999" });
    expect(kq.signals.nguon).toEqual({ cuaSoNgay: 90, chuNhanVienId: null });
  });
  it("mọi lý do (trừ NHAN_MAU_THUAN) đi cùng một đường: MO_HO · DA_NGHI · KHAC_MA · LOI_HE_THONG", () => {
    for (const loai of ["MO_HO", "DA_NGHI", "KHAC_MA", "LOI_HE_THONG", "KHONG_TON_TAI"] as const) {
      const r = quyNguon(tin({ maNvSai: { ma: "M", loai, doDai: 1, raw: "m" } }), cauHinh());
      expect(r.groupCode, loai).toBe("EMPLOYEE_REFERRAL");
      expect(r.referrerMissing, loai).toBe(true);
      expect(r.xemTay, loai).toContain("INVALID_EMPLOYEE_REFERRER_CODE");
    }
  });
  it("nhãn là nhãn nhân sự hợp lệ ('Quản Lý Trung Tâm') + mã sai ⇒ cùng nhóm nhân sự, vẫn thiếu người + xem tay", () => {
    const r = quyNguon(tin({ nhanKhai: "Quản Lý Trung Tâm", maNvSai: SAI }), cauHinh());
    expect(r.groupCode).toBe("EMPLOYEE_REFERRAL");
    expect(r.referrerMissing).toBe(true);
    expect(r.nguoi).toBeNull();
    expect(r.xemTay).toContain("INVALID_EMPLOYEE_REFERRER_CODE");
  });
});

describe("[MNR-02b] đối chứng dương — luật mới KHÔNG phình ra", () => {
  it("KHÔNG có maNvSai + nhãn rỗng + đường import-excel ⇒ vẫn UNKNOWN, không xem tay (đúng hành vi cũ)", () => {
    const r = quyNguon(tin(), cauHinh());
    expect(r.groupCode).toBe("UNKNOWN");
    expect(r.xemTay).toEqual([]);
    expect(r.signals.maNvSai).toBeUndefined();
  });
  it("mã ĐÚNG (nhanSuGioiThieu) ⇒ gán người, KHÔNG referrerMissing, KHÔNG xem tay, KHÔNG signals.maNvSai", () => {
    const r = quyNguon(tin({ nhanSuGioiThieu: { employeeId: "E1", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false } }), cauHinh());
    expect(r.luat).toBe("NV_GIOI_THIEU");
    expect(r.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E1" });
    expect(r.referrerMissing).toBe(false);
    expect(r.xemTay).toEqual([]);
    expect(r.signals.maNvSai).toBeUndefined();
  });
});

describe("[MNR-03] nhãn MÂU THUẪN (Ads + mã): nhóm GIỮ theo nhãn, không referrerMissing, vẫn xem tay", () => {
  const kq = quyNguon(tin({ nhanKhai: "Ads", maNvSai: { ma: "SR.NV.002", loai: "NHAN_MAU_THUAN", doDai: 9, raw: "SR.NV.002" } }), cauHinh());

  it("nhóm PAID_ADS (luật KHAI_TAY), KHÔNG người, KHÔNG referrerMissing", () => {
    expect(kq.groupCode).toBe("PAID_ADS");
    expect(kq.luat).toBe("KHAI_TAY");
    expect(kq.nguoi).toBeNull();
    expect(kq.referrerMissing).toBe(false);
  });
  it("nhưng có xemTay INVALID_EMPLOYEE_REFERRER_CODE + coXemTay + signals.maNvSai (mã không biến mất)", () => {
    expect(kq.xemTay).toEqual(["INVALID_EMPLOYEE_REFERRER_CODE"]);
    expect(kq.signals.coXemTay).toBe(true);
    expect(kq.signals.maNvSai).toEqual({ ma: "SR.NV.002", loai: "NHAN_MAU_THUAN", doDai: 9, raw: "SR.NV.002" });
  });
});

describe("[MNR-03b] cấu hình nhóm nhân sự mặc định trỏ SAI nhóm ⇒ luật không khớp, mã KHÔNG mất", () => {
  it("nhóm đích không phải kiểu nhân sự ⇒ rơi UNKNOWN, nhưng vẫn có xemTay + signals.maNvSai", () => {
    const r = quyNguon(tin({ maNvSai: SAI }), cauHinh({ nhomNhanSu: "PAID_ADS" }));
    expect(r.luat).not.toBe("NV_GIOI_THIEU_SAI");
    expect(r.groupCode).toBe("UNKNOWN");
    expect(r.referrerMissing).toBe(false);
    expect(r.xemTay).toContain("INVALID_EMPLOYEE_REFERRER_CODE");
    expect(r.signals.maNvSai).toEqual({ ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: "sr.nv.999" });
  });
});

describe("[MNR-03c] KE_THUA_SDT thắng ⇒ first-claim, không đánh dấu xem tay lên dòng kế thừa", () => {
  const keThua: KeThuaGoc = {
    leadId: "L_CU",
    attributedAt: d("2026-09-01T00:00:00.000Z"),
    groupCode: "PAID_ADS",
    originalGroupCode: "PAID_ADS",
    nguoi: null,
    referrerMissing: false,
    otherSourceNote: null,
    anhChup: ANH_CHUP_TRONG,
  };
  it("nhóm theo bản gốc, không xemTay, chỉ ghi vết signals.maNvSai", () => {
    const r = quyNguon(tin({ keThua, maNvSai: SAI }), cauHinh());
    expect(r.luat).toBe("KE_THUA_SDT");
    expect(r.groupCode).toBe("PAID_ADS");
    expect(r.xemTay).toEqual([]);
    expect(r.referrerMissing).toBe(false);
    expect(r.signals.maNvSai).toEqual({ ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: "sr.nv.999" });
  });
});

describe("[MNR-04] luật nằm trong bảng luật, gác bởi cờ con `referral`", () => {
  it("THU_TU_LUAT_MAC_DINH có NV_GIOI_THIEU_SAI ngay SAU NV_GIOI_THIEU và TRƯỚC KHAI_TAY", () => {
    const ds = THU_TU_LUAT_MAC_DINH.map((l) => l.ma);
    expect(ds.indexOf("NV_GIOI_THIEU_SAI")).toBe(ds.indexOf("NV_GIOI_THIEU") + 1);
    expect(ds.indexOf("NV_GIOI_THIEU_SAI")).toBeLessThan(ds.indexOf("KHAI_TAY"));
  });
  it("cờ `referral` TẮT ⇒ luật tắt: lead rơi UNKNOWN nhưng mã VẪN được ghi vết (xemTay + signals)", () => {
    const r = quyNguon(tin({ maNvSai: SAI }), cauHinh({ co: { referral: false } }));
    expect(r.luat).not.toBe("NV_GIOI_THIEU_SAI");
    expect(r.groupCode).toBe("UNKNOWN");
    expect(r.xemTay).toContain("INVALID_EMPLOYEE_REFERRER_CODE");
    expect(r.signals.maNvSai).toBeDefined();
  });
});

describe("[MNA-06] cùng lớp lỗi ở `signals.maNvKhongGiai` (mã của NGƯỜI NHẬP trên phiếu máy — ô chữ tự do): chỉ chuỗi có dạng mã được lưu", () => {
  const luu = (ma: string) => quyNguon(tin({ duongVao: "sale-form", nhanKhai: "sale-form", maNvKhongGiai: ma }), cauHinh()).signals;
  it("mã dạng NV (nhân viên đã nghỉ) ⇒ vẫn lưu để người duyệt thấy", () => {
    expect(luu("SR.NV.022").maNvKhongGiai).toBe("SR.NV.022");
    const kq = quyNguon(tin({ duongVao: "sale-form", nhanKhai: "sale-form", maNvKhongGiai: "SR.NV.022" }), cauHinh());
    expect(kq.otherSourceNote).toMatch(/SR\.NV\.022/); // đối chứng dương: mã dạng NV vẫn hiện trong giải trình
  });
  it("SĐT / tên dán nhầm vào ô ⇒ KHÔNG khoá nào của signals mang nó, nhưng lead vẫn bị đánh dấu xem tay", () => {
    for (const ma of ["0905123456", "0905.123.456", "NGUYỄN VĂN A", "NGUYEN VAN A"]) {
      const kq = quyNguon(tin({ duongVao: "sale-form", nhanKhai: "sale-form", maNvKhongGiai: ma }), cauHinh());
      expect(kq.signals.maNvKhongGiai, ma).toBeUndefined();
      expect(JSON.stringify(kq.signals), ma).not.toMatch(/905\D?123\D?456|NGUY/);
      // …và giải trình hiển thị cho mọi người xem tab Nguồn (`otherSourceNote`) cũng KHÔNG mang chữ đó
      expect(kq.otherSourceNote ?? "", ma).not.toMatch(/905\D?123\D?456|NGUY/);
      expect(kq.otherSourceNote ?? "", ma).toMatch(/không phải dạng mã/);
      expect(kq.xemTay, ma).toContain("MA_NV_KHONG_GIAI");
    }
  });
});
