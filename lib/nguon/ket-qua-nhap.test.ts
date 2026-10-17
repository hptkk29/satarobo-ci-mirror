/**
 * Ca [MNR-06*] — `phanLoaiDongNhap`: kết quả nguồn của một lượt nhập Excel (hướng F, 11/10/2026). THUẦN.
 *
 *   [MNR-06]   ma trận bốn trạng thái: ERROR > SKIPPED > SUCCESS_WITH_REVIEW > SUCCESS (đối chứng dương cho từng nhánh)
 *   [MNR-06b]  `lyDoHangChoCuaKetQua` đọc kết quả quy nguồn THẬT: Ads sạch ⇒ SUCCESS; mã sai ⇒ REVIEW; nhãn mâu thuẫn ⇒ REVIEW; nhãn rỗng ⇒ UNKNOWN ⇒ REVIEW
 *   [MNR-06c]  `tongKetNhap` luôn có đủ bốn khoá
 */
import { describe, expect, it } from "vitest";
import { DANH_MUC_GOC, VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import { lyDoHangChoCuaKetQua, phanLoaiDongNhap, tongKetNhap } from "./ket-qua-nhap";
import { dungCauHinhQuyNguon, quyNguon } from "./quy-nguon";
import type { MaNvSai, TinHieuQuyNguon } from "./tin-hieu";

describe("[MNR-06] phanLoaiDongNhap — thứ tự ưu tiên ERROR > SKIPPED > REVIEW > SUCCESS", () => {
  it("lỗi ⇒ ERROR, bất kể gì khác (kể cả đã có lead và đang chờ duyệt)", () => {
    expect(phanLoaiDongNhap({ loi: true, daCoLead: false, lyDoHangCho: [] })).toBe("ERROR");
    expect(phanLoaiDongNhap({ loi: true, daCoLead: true, lyDoHangCho: ["XEM_TAY"] })).toBe("ERROR");
  });
  it("không lỗi + SĐT đã có lead ⇒ SKIPPED (first-claim giữ nguồn gốc), bất kể lý do hàng chờ", () => {
    expect(phanLoaiDongNhap({ loi: false, daCoLead: true, lyDoHangCho: null })).toBe("SKIPPED");
    expect(phanLoaiDongNhap({ loi: false, daCoLead: true, lyDoHangCho: ["XEM_TAY"] })).toBe("SKIPPED");
  });
  it("lead mới + CÓ lý do hàng chờ ⇒ SUCCESS_WITH_REVIEW (KHÔNG phải ERROR)", () => {
    expect(phanLoaiDongNhap({ loi: false, daCoLead: false, lyDoHangCho: ["XEM_TAY"] })).toBe("SUCCESS_WITH_REVIEW");
    expect(phanLoaiDongNhap({ loi: false, daCoLead: false, lyDoHangCho: ["UNKNOWN", "THIEU_NGUOI"] })).toBe("SUCCESS_WITH_REVIEW");
  });
  it("lead mới + KHÔNG lý do hàng chờ ⇒ SUCCESS; không ghi quy nguồn (null: cờ TẮT/lỗi hệ thống) ⇒ SUCCESS, không có gì để chờ", () => {
    expect(phanLoaiDongNhap({ loi: false, daCoLead: false, lyDoHangCho: [] })).toBe("SUCCESS");
    expect(phanLoaiDongNhap({ loi: false, daCoLead: false, lyDoHangCho: null })).toBe("SUCCESS");
  });
});

// ── kết quả quy nguồn thật ──
const BAY_GIO = new Date("2026-10-11T03:00:00.000Z");
const cauHinh = () =>
  dungCauHinhQuyNguon({
    nhom: DANH_MUC_GOC.map((g) => ({
      code: g.code,
      active: true,
      requiresNote: g.requiresNote,
      selectable: g.selectable,
      referrerRequirement: g.referrerRequirement,
      cuaSoRiengNgay: null,
      chuNhanVienId: null,
    })),
    co: { autoAttribution: true, pageMapping: true, referral: true, manualReview: true },
    vaiSangNguon: VAI_SANG_NGUON_MAC_DINH,
    nhomNhanSu: "EMPLOYEE_REFERRAL",
    cuaSoMacDinhNgay: 90,
  });
const tin = (over: Partial<TinHieuQuyNguon>): TinHieuQuyNguon => ({
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
});
const lyDo = (over: Partial<TinHieuQuyNguon>) => lyDoHangChoCuaKetQua(quyNguon(tin(over), cauHinh()));
const SAI: MaNvSai = { ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: "SR.NV.999" };

describe("[MNR-06b] lyDoHangChoCuaKetQua — đọc kết quả quy nguồn THẬT, cùng nghĩa hàng chờ", () => {
  it("nhãn 'Ads' sạch ⇒ [] ⇒ SUCCESS (đối chứng dương: Excel sạch KHÔNG bị gắn «chờ duyệt»)", () => {
    expect(lyDo({ nhanKhai: "Ads" })).toEqual([]);
  });
  it("nhãn rỗng + không mã ⇒ UNKNOWN ⇒ chờ duyệt (đúng hành vi cũ: UNKNOWN vốn ở hàng chờ)", () => {
    expect(lyDo({})).toEqual(["UNKNOWN"]);
  });
  it("nhãn rỗng + mã SAI ⇒ THIEU_NGUOI + XEM_TAY (không còn UNKNOWN)", () => {
    expect(lyDo({ maNvSai: SAI })).toEqual(["THIEU_NGUOI", "XEM_TAY"]);
  });
  it("nhãn mâu thuẫn (Ads + mã) ⇒ chỉ XEM_TAY (nhóm giữ, không thiếu người)", () => {
    expect(lyDo({ nhanKhai: "Ads", maNvSai: { ma: "SR.NV.002", loai: "NHAN_MAU_THUAN", doDai: 9, raw: "SR.NV.002" } })).toEqual(["XEM_TAY"]);
  });
  it("mã ĐÚNG ⇒ [] (đối chứng dương của chính luật mới)", () => {
    expect(lyDo({ nhanSuGioiThieu: { employeeId: "E1", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false } })).toEqual([]);
  });
  it("dùng thẳng vào phanLoaiDongNhap: mã sai ⇒ SUCCESS_WITH_REVIEW, Ads sạch ⇒ SUCCESS", () => {
    const loai = (over: Partial<TinHieuQuyNguon>) => phanLoaiDongNhap({ loi: false, daCoLead: false, lyDoHangCho: lyDo(over) });
    expect(loai({ maNvSai: SAI })).toBe("SUCCESS_WITH_REVIEW");
    expect(loai({ nhanKhai: "Ads" })).toBe("SUCCESS");
  });
});

describe("[MNR-06c] tongKetNhap", () => {
  it("đủ bốn khoá kể cả khi rỗng; đếm đúng", () => {
    expect(tongKetNhap([])).toEqual({ SUCCESS: 0, SUCCESS_WITH_REVIEW: 0, ERROR: 0, SKIPPED: 0 });
    expect(tongKetNhap(["SUCCESS", "SUCCESS_WITH_REVIEW", "SUCCESS_WITH_REVIEW", "SKIPPED", "ERROR", "SUCCESS"])).toEqual({
      SUCCESS: 2,
      SUCCESS_WITH_REVIEW: 2,
      ERROR: 1,
      SKIPPED: 1,
    });
  });
});
