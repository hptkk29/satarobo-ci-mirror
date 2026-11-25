/**
 * Ca [NSB-*] — F4 (19/10/2026): người giới thiệu HỢP LỆ nhưng nhóm «nhân sự giới thiệu» mặc định đang TẮT / hết hiệu lực / trỏ sai kiểu. THUẦN, không DB. Ngày TUYỆT ĐỐI (luật 19).
 *
 * Trước đó: `NV_GIOI_THIEU` không khớp ⇒ lead rơi UNKNOWN và người giới thiệu đã giải xong KHÔNG còn ở đâu trong attribution (chỉ nằm ở touchpoint thua — không màn nào đọc).
 * Nay: UNKNOWN (fail-closed, không ghi vào nguồn đã tắt) + dấu xem tay riêng `EMPLOYEE_REFERRAL_SOURCE_INACTIVE` + người ở `signals.nguoiGioiThieuChoDuyet`.
 * KHÔNG ghi `nguoi` (⇒ không có `referrerEmployeeId`/`referrerKind`) vì hoa hồng đọc đúng hai cột đó.
 *
 *   [NSB-01]  nhóm nhân sự TẮT + người hợp lệ ⇒ UNKNOWN + dấu F4 + signals.nguoiGioiThieuChoDuyet, nguoi = null, KHÔNG referrerMissing
 *   [NSB-02]  đối chứng dương: nhóm ĐANG CHẠY ⇒ NV_GIOI_THIEU ghi người, KHÔNG dấu F4, KHÔNG signals.nguoiGioiThieuChoDuyet
 *   [NSB-03]  nhóm đích trỏ SAI kiểu (không cần người) ⇒ cùng kết quả như TẮT
 *   [NSB-04]  luật đứng TRƯỚC NV_GIOI_THIEU thắng (quảng cáo) ⇒ KHÔNG phải «mất người» ⇒ không dấu F4; KE_THUA_SDT cũng không
 *   [NSB-05]  cờ con `referral` TẮT (NV_GIOI_THIEU không bật) ⇒ không dấu F4 (cổng cố ý của cờ, không phải nhóm tắt)
 *   [NSB-06]  luật SAU NV_GIOI_THIEU thắng (nhãn «Ads») mà người vẫn bị bỏ ⇒ dấu F4 (không im lặng mất người)
 *   [NSB-07]  không có người giới thiệu hợp lệ (mã sai / không mã) ⇒ không dấu F4
 *   [NSB-09]  `nguoiChoDuyetCuaDong` đọc signals ⇒ mã NV người chờ duyệt; CHỈ khi dấu F4 còn sống; hình lạ ⇒ null (người duyệt THẤY người, không chỉ thấy dấu)
 *   [NSB-08]  dấu F4 nằm trong danh sách hàng chờ + có nhãn tiếng Việt (một nguồn: `LY_DO_XEM_TAY_HANG_CHO` · `NHAN_XEM_TAY`)
 */
import { describe, expect, it } from "vitest";
import { DANH_MUC_GOC, VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import { nguoiChoDuyetCuaDong } from "./ly-do-hang-cho";
import { LY_DO_XEM_TAY_HANG_CHO, NHAN_XEM_TAY } from "./nhan-hien-thi";
import { dungCauHinhQuyNguon, quyNguon } from "./quy-nguon";
import type { CoQuyNguon, KeThuaGoc, MaNvSai, TinHieuQuyNguon } from "./tin-hieu";
import { ANH_CHUP_TRONG } from "./tin-hieu";

const BAY_GIO = new Date("2026-10-11T03:00:00.000Z");
const CO_BAT: CoQuyNguon = { autoAttribution: true, pageMapping: true, referral: true, manualReview: true };
const F4 = "EMPLOYEE_REFERRAL_SOURCE_INACTIVE";

function cauHinh(o: { co?: Partial<CoQuyNguon>; tat?: readonly string[]; nhomNhanSu?: string } = {}) {
  return dungCauHinhQuyNguon({
    nhom: DANH_MUC_GOC.map((g) => ({
      code: g.code,
      active: !(o.tat ?? []).includes(g.code),
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

const NGUOI = { employeeId: "E_HUE", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false, employeeCode: "SR.NV.002", orgUnitId: "OU_CS1" } as const;

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
    nhanSuGioiThieu: NGUOI,
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

describe("[NSB-01] nhóm nhân sự mặc định TẮT + người giới thiệu hợp lệ ⇒ không mất người im lặng", () => {
  const kq = quyNguon(tin(), cauHinh({ tat: ["EMPLOYEE_REFERRAL"] }));
  it("fail-closed UNKNOWN, dấu xem tay riêng, coXemTay", () => {
    expect(kq.groupCode).toBe("UNKNOWN");
    expect(kq.xemTay).toContain(F4);
    expect(kq.signals.xemTay).toContain(F4);
    expect(kq.signals.coXemTay).toBe(true);
  });
  it("người ở signals.nguoiGioiThieuChoDuyet; KHÔNG ở `nguoi` (hoa hồng đọc cột người giới thiệu) và KHÔNG referrerMissing", () => {
    expect(kq.signals.nguoiGioiThieuChoDuyet).toEqual({ employeeId: "E_HUE", employeeCode: "SR.NV.002" });
    expect(kq.nguoi).toBeNull();
    expect(kq.referrerMissing).toBe(false);
    expect(kq.anhChup.referrerRoleCode).toBeNull();
  });
});

describe("[NSB-02] đối chứng dương: nhóm đang chạy ⇒ ghi người như cũ", () => {
  const kq = quyNguon(tin(), cauHinh());
  it("NV_GIOI_THIEU thắng, có người, không dấu F4, không signals.nguoiGioiThieuChoDuyet", () => {
    expect(kq.luat).toBe("NV_GIOI_THIEU");
    expect(kq.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E_HUE" });
    expect(kq.xemTay).not.toContain(F4);
    expect(kq.signals.nguoiGioiThieuChoDuyet).toBeUndefined();
  });
});

describe("[NSB-03] nhóm đích trỏ SAI kiểu ⇒ cùng kết quả như nhóm tắt", () => {
  it("nhomNhanSu = PAID_ADS (không cần người) ⇒ dấu F4 + người giữ ở signals", () => {
    const kq = quyNguon(tin(), cauHinh({ nhomNhanSu: "PAID_ADS" }));
    expect(kq.groupCode).toBe("UNKNOWN");
    expect(kq.xemTay).toContain(F4);
    expect(kq.signals.nguoiGioiThieuChoDuyet).toEqual({ employeeId: "E_HUE", employeeCode: "SR.NV.002" });
    expect(kq.nguoi).toBeNull();
  });
});

describe("[NSB-04] luật đứng TRƯỚC NV_GIOI_THIEU thắng ⇒ không phải «mất người»", () => {
  it("tín hiệu quảng cáo thắng ⇒ không dấu F4", () => {
    const kq = quyNguon(
      tin({ quangCao: { adId: "AD1", campaignId: null, adsetId: null, campaignName: null, formId: null, fbclid: null, gclid: null } }),
      cauHinh({ tat: ["EMPLOYEE_REFERRAL"] }),
    );
    expect(kq.luat).toBe("QUANG_CAO");
    expect(kq.xemTay).not.toContain(F4);
    expect(kq.signals.nguoiGioiThieuChoDuyet).toBeUndefined();
  });
  it("KE_THUA_SDT (first-claim) ⇒ không dấu F4", () => {
    const keThua: KeThuaGoc = {
      leadId: "L_CU",
      attributedAt: new Date("2026-09-01T00:00:00.000Z"),
      groupCode: "PAID_ADS",
      originalGroupCode: "PAID_ADS",
      nguoi: null,
      referrerMissing: false,
      otherSourceNote: null,
      anhChup: ANH_CHUP_TRONG,
    };
    const kq = quyNguon(tin({ keThua }), cauHinh({ tat: ["EMPLOYEE_REFERRAL"] }));
    expect(kq.luat).toBe("KE_THUA_SDT");
    expect(kq.xemTay).not.toContain(F4);
  });
});

describe("[NSB-05] cờ con `referral` TẮT ⇒ NV_GIOI_THIEU không bật ⇒ không dấu F4", () => {
  it("cổng cố ý của cờ, không phải do nhóm nhân sự tắt", () => {
    const kq = quyNguon(tin(), cauHinh({ co: { referral: false }, tat: ["EMPLOYEE_REFERRAL"] }));
    expect(kq.xemTay).not.toContain(F4);
    expect(kq.signals.nguoiGioiThieuChoDuyet).toBeUndefined();
  });
});

describe("[NSB-06] luật SAU NV_GIOI_THIEU thắng mà người vẫn bị bỏ ⇒ vẫn nói ra", () => {
  it("nhãn «Ads» (KHAI_TAY → PAID_ADS) + người giới thiệu hợp lệ + nhóm nhân sự tắt ⇒ dấu F4", () => {
    const kq = quyNguon(tin({ nhanKhai: "Ads" }), cauHinh({ tat: ["EMPLOYEE_REFERRAL"] }));
    expect(kq.luat).toBe("KHAI_TAY");
    expect(kq.groupCode).toBe("PAID_ADS");
    expect(kq.xemTay).toContain(F4);
    expect(kq.nguoi).toBeNull();
  });
});

describe("[NSB-07] không có người giới thiệu HỢP LỆ ⇒ không dấu F4", () => {
  it("không nhân sự giới thiệu, nhóm nhân sự tắt ⇒ UNKNOWN như cũ, xemTay rỗng", () => {
    const kq = quyNguon(tin({ nhanSuGioiThieu: null }), cauHinh({ tat: ["EMPLOYEE_REFERRAL"] }));
    expect(kq.groupCode).toBe("UNKNOWN");
    expect(kq.xemTay).toEqual([]);
  });
  it("mã SAI (không có người hợp lệ) ⇒ chỉ dấu mã sai, không F4", () => {
    const sai: MaNvSai = { ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: "sr.nv.999" };
    const kq = quyNguon(tin({ nhanSuGioiThieu: null, maNvSai: sai }), cauHinh({ tat: ["EMPLOYEE_REFERRAL"] }));
    expect(kq.xemTay).toContain("INVALID_EMPLOYEE_REFERRER_CODE");
    expect(kq.xemTay).not.toContain(F4);
  });
});

describe("[NSB-08] dấu F4 đi vào hàng chờ và có nhãn người đọc được", () => {
  it("nằm trong LY_DO_XEM_TAY_HANG_CHO (một chỗ) và NHAN_XEM_TAY có câu riêng", () => {
    expect(LY_DO_XEM_TAY_HANG_CHO).toContain(F4);
    expect(NHAN_XEM_TAY[F4]).toMatch(/nhân sự giới thiệu/i);
    expect(NHAN_XEM_TAY[F4]).not.toBe(F4);
  });
});

describe("[NSB-09] người chờ duyệt hiện cho người duyệt (reader của hàng chờ)", () => {
  const kq = quyNguon(tin(), cauHinh({ tat: ["EMPLOYEE_REFERRAL"] }));
  it("signals do engine sinh ra ⇒ đọc được mã NV (đi từ ĐẦU RA THẬT của engine, không gõ tay)", () => {
    expect(nguoiChoDuyetCuaDong(kq.signals)).toEqual({ employeeCode: "SR.NV.002" });
  });
  it("dấu F4 đã gỡ (người duyệt xử lý xong) ⇒ null dù vết còn trong DB; hình lạ ⇒ null", () => {
    expect(nguoiChoDuyetCuaDong({ ...kq.signals, xemTay: [] })).toBeNull();
    expect(nguoiChoDuyetCuaDong({ xemTay: [F4], nguoiGioiThieuChoDuyet: "E1" })).toBeNull();
    expect(nguoiChoDuyetCuaDong(null)).toBeNull();
    expect(nguoiChoDuyetCuaDong({ xemTay: [F4] })).toBeNull();
  });
  it("mã NV rỗng/không phải chuỗi ⇒ employeeCode null (vẫn có người chờ)", () => {
    expect(nguoiChoDuyetCuaDong({ xemTay: [F4], nguoiGioiThieuChoDuyet: { employeeId: "E1", employeeCode: "  " } })).toEqual({ employeeCode: null });
  });
});
