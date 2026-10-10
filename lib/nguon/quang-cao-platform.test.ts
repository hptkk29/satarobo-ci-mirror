/**
 * Ca [PLT-*] — `platform` trong tín hiệu quảng cáo chảy từ `QuangCaoTin` vào `signals.quangCao` của dòng quy nguồn, mà KHÔNG làm đổi
 * luật quy nguồn (platform một mình không phải tín hiệu quảng cáo). THUẦN.
 */
import { describe, expect, it } from "vitest";
import { DANH_MUC_GOC, VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import { dungTouchpointDenSau } from "./noi-day";
import { dungCauHinhQuyNguon, quyNguon } from "./quy-nguon";
import type { TinHieuQuyNguon } from "./tin-hieu";

const BAY_GIO = new Date("2026-10-09T03:00:00.000Z");
const CH = dungCauHinhQuyNguon({
  nhom: DANH_MUC_GOC.map((g) => ({ code: g.code, active: true, requiresNote: g.requiresNote, selectable: g.selectable, referrerRequirement: g.referrerRequirement, cuaSoRiengNgay: null, chuNhanVienId: null })),
  co: { autoAttribution: true, pageMapping: true, referral: true, manualReview: true },
  vaiSangNguon: VAI_SANG_NGUON_MAC_DINH,
  nhomNhanSu: "EMPLOYEE_REFERRAL",
  cuaSoMacDinhNgay: 90,
});

const TRONG = { adId: null, campaignId: null, adsetId: null, campaignName: null, formId: null, fbclid: null, gclid: null };
function tin(quangCao: TinHieuQuyNguon["quangCao"], duongVao = "facebook"): TinHieuQuyNguon {
  return {
    bayGio: BAY_GIO,
    duongVao,
    conversionEntry: duongVao,
    nhanKhai: null,
    laNhapExcel: false,
    nguoiNhap: null,
    maNvKhongGiai: null,
    nhanSuGioiThieu: null,
    phuHuynhGioiThieu: null,
    saleCuaPhuHuynh: null,
    ref: null,
    refSau: [],
    quangCao,
    utm: { source: null, medium: null, campaign: null, term: null, content: null },
    page: null,
    keThua: null,
    sdtTrungNhanVien: false,
    sdtNguoiGioiThieuTrungKhach: false,
  };
}

describe("[PLT-01] platform chảy vào signals.quangCao khi đi cùng một tín hiệu quảng cáo", () => {
  it("có ad_id + platform ⇒ QUANG_CAO thắng và signals.quangCao.platform = 'ig'", () => {
    const r = quyNguon(tin({ ...TRONG, adId: "AD1", platform: "ig" }), CH);
    expect(r.luat).toBe("QUANG_CAO");
    expect(r.signals.quangCao).toEqual({ adId: "AD1", platform: "ig" });
  });

  it("không có platform ⇒ signals.quangCao KHÔNG có khoá platform (tương thích ngược với dữ liệu đã ghi)", () => {
    const r = quyNguon(tin({ ...TRONG, adId: "AD1" }), CH);
    expect(r.signals.quangCao).toEqual({ adId: "AD1" });
  });

  it("platform null / chuỗi rỗng bị bỏ như mọi khoá khác", () => {
    expect(quyNguon(tin({ ...TRONG, adId: "AD1", platform: null }), CH).signals.quangCao).toEqual({ adId: "AD1" });
    expect(quyNguon(tin({ ...TRONG, adId: "AD1", platform: "  " }), CH).signals.quangCao).toEqual({ adId: "AD1" });
  });
});

describe("[PLT-02] platform MỘT mình KHÔNG khiến luật QUANG_CAO khớp (không đổi luật quy nguồn)", () => {
  it("web + platform không kèm ad/campaign/form/click-id ⇒ vẫn đi DUONG_VAO_MAC_DINH, không phải QUANG_CAO", () => {
    const r = quyNguon(tin({ ...TRONG, platform: "fb" }, "web"), CH);
    expect(r.luat).toBe("DUONG_VAO_MAC_DINH");
    expect(r.touchpointThua).toEqual([]); // không có "tín hiệu quảng cáo thua" nào được ghi
  });
});

describe("[PLT-03] tín hiệu quảng cáo THUA vẫn mang platform sang touchpoint (không mất nửa dữ liệu khi tranh chấp)", () => {
  it("lead đã có nguồn, phiếu đến sau mang ad_id + platform ⇒ touchpoint signals.quangCao có platform", () => {
    const tps = dungTouchpointDenSau({
      kind: "NHAP_LAI",
      conversionEntry: "facebook",
      nhanKhai: null,
      ref: null,
      quangCao: { ...TRONG, adId: "AD9", platform: "fb" },
      utm: { source: null, medium: null, campaign: null, term: null, content: null },
      pageId: null,
      nguoiGioiThieu: null,
    });
    expect((tps[0]!.signals as { quangCao: { platform: string } }).quangCao.platform).toBe("fb");
  });
});
