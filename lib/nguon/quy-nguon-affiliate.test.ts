/**
 * [AFF-RQ-*] — luật `AFFILIATE_REFERRAL` của resolver quy nguồn (AFF-P1). THUẦN, ngày tuyệt đối (luật 19).
 * [AFF-GIAI-*] — `giaiAffiliateReferral`: đối chiếu dữ liệu sống lúc ghi.
 *
 * Luật cần canh:
 *  · thứ tự: SAU kế thừa SĐT (first-claim D3) và SAU người chọn tay, TRƯỚC mọi tín hiệu máy (quảng cáo, page…);
 *  · gác bằng cờ con `referral` (tắt ⇒ link không ghi người giới thiệu);
 *  · nguồn do CẤU HÌNH quyết nên nhóm đích có thể là BẤT KỲ `referrerRequirement` (khác `CHON_NGUON`, vốn đòi người khớp loại);
 *  · `loi`/nhóm không còn hoạt động ⇒ luật không khớp (rơi xuống luật sau), KHÔNG chặn lead (T4);
 *  · snapshot chỉ ghi vào `signals.affiliate` khi luật THẮNG.
 */
import { describe, expect, it } from "vitest";
import { DANH_MUC_GOC, VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import { giaiAffiliateReferral } from "./giai-affiliate";
import { CO_CUA_LUAT, THU_TU_LUAT_MAC_DINH, dungCauHinhQuyNguon, quyNguon } from "./quy-nguon";
import { ANH_CHUP_TRONG, type AffiliateReferralDaGiai, type CoQuyNguon, type KeThuaGoc, type TinHieuQuyNguon } from "./tin-hieu";

const BAY_GIO = new Date("2026-11-20T03:00:00.000Z");
const CO_BAT: CoQuyNguon = { autoAttribution: true, pageMapping: true, referral: true, manualReview: true };

function cauHinh(co: Partial<CoQuyNguon> = {}, nhomTat: readonly string[] = []) {
  const goc = DANH_MUC_GOC.map((g) => ({
    code: g.code,
    active: !nhomTat.includes(g.code),
    requiresNote: g.requiresNote,
    selectable: g.selectable,
    referrerRequirement: g.referrerRequirement,
    cuaSoRiengNgay: null,
    chuNhanVienId: null,
  }));
  // Nguồn tuỳ biến do admin tạo, KHÔNG cần người giới thiệu (NONE) — campaign vẫn có thể trỏ vào nó.
  const them = [{ code: "KOL_REFERRAL", active: !nhomTat.includes("KOL_REFERRAL"), requiresNote: false, selectable: true, referrerRequirement: "NONE" as const, cuaSoRiengNgay: null, chuNhanVienId: null }];
  return dungCauHinhQuyNguon({
    nhom: [...goc, ...them],
    co: { ...CO_BAT, ...co },
    vaiSangNguon: VAI_SANG_NGUON_MAC_DINH,
    nhomNhanSu: "EMPLOYEE_REFERRAL",
    cuaSoMacDinhNgay: 90,
  });
}

const AFF = (over: Partial<AffiliateReferralDaGiai> = {}): AffiliateReferralDaGiai => ({
  affiliateId: "aff-1",
  groupCode: "KOL_REFERRAL",
  snapshot: { affiliateCode: "KOL01", campaignCode: "ROBOT2026", tu: "RULE_LOAI", method: "LINK" },
  loi: null,
  ...over,
});

function tin(over: Partial<TinHieuQuyNguon> = {}): TinHieuQuyNguon {
  return {
    bayGio: BAY_GIO,
    duongVao: "web",
    conversionEntry: "web",
    nhanKhai: null,
    laNhapExcel: false,
    nguoiNhap: null,
    maNvKhongGiai: null,
    maNvSai: null,
    nhanSuGioiThieu: null,
    phuHuynhGioiThieu: null,
    saleCuaPhuHuynh: null,
    affiliate: null,
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

describe("[AFF-RQ-01] vị trí và cờ của luật trong bảng luật", () => {
  it("đứng NGAY SAU CHON_NGUON và TRƯỚC mọi luật còn lại (kể cả quảng cáo / page / nhân sự giới thiệu); KE_THUA_SDT vẫn đứng đầu", () => {
    const ma = THU_TU_LUAT_MAC_DINH.map((l) => l.ma);
    expect(ma[0]).toBe("KE_THUA_SDT");
    expect(ma[1]).toBe("CHON_NGUON");
    expect(ma[2]).toBe("AFFILIATE_REFERRAL");
    for (const sau of ["QUANG_CAO", "PAGE_MAPPING", "NV_GIOI_THIEU", "PH_GIOI_THIEU", "DUONG_VAO_MAC_DINH"] as const) {
      expect(ma.indexOf(sau), sau).toBeGreaterThan(2);
    }
    expect(THU_TU_LUAT_MAC_DINH[2]!.bat).toBe(true);
  });

  it("gác bằng cờ con `referral` (không gắn cờ khác)", () => {
    expect(CO_CUA_LUAT.AFFILIATE_REFERRAL).toBe("referral");
  });
});

describe("[AFF-RQ-02] luật thắng: nguồn do cấu hình, người hưởng là đối tác trên link", () => {
  it("referral hợp lệ ⇒ nhóm đích của campaign, method AFFILIATE, người = AFFILIATE, snapshot trong signals.affiliate", () => {
    const kq = quyNguon(tin({ affiliate: AFF() }), cauHinh());
    expect(kq.luat).toBe("AFFILIATE_REFERRAL");
    expect(kq.groupCode).toBe("KOL_REFERRAL");
    expect(kq.identificationMethod).toBe("AFFILIATE");
    expect(kq.nguoi).toEqual({ kind: "AFFILIATE", affiliateId: "aff-1" });
    expect(kq.signals.affiliate).toEqual({ affiliateCode: "KOL01", campaignCode: "ROBOT2026", tu: "RULE_LOAI", method: "LINK" });
    expect(kq.referrerMissing).toBe(false);
  });

  it("nhóm đích KHÔNG cần người giới thiệu (NONE) vẫn nhận được — khác CHON_NGUON; và nhóm đối tác (AFFILIATE_ORG) cũng nhận", () => {
    expect(quyNguon(tin({ affiliate: AFF({ groupCode: "KOL_REFERRAL" }) }), cauHinh()).groupCode).toBe("KOL_REFERRAL");
    expect(quyNguon(tin({ affiliate: AFF({ groupCode: "PARTNER" }) }), cauHinh()).groupCode).toBe("PARTNER");
  });

  it("thắng tín hiệu quảng cáo đi kèm: quảng cáo thành touchpoint THUA (không mất dấu), signals.quangCao vẫn ghi", () => {
    const qc = { adId: "ad-9", campaignId: null, adsetId: null, campaignName: null, formId: null, fbclid: "fb-1", gclid: null };
    const kq = quyNguon(tin({ affiliate: AFF(), quangCao: qc }), cauHinh());
    expect(kq.luat).toBe("AFFILIATE_REFERRAL");
    expect(kq.touchpointThua.some((t) => t.kind === "TAO_LEAD" && "quangCao" in t.signals)).toBe(true);
    expect(kq.signals.quangCao).toBeDefined();
  });

  it("đối chứng: cùng tín hiệu quảng cáo MÀ KHÔNG có affiliate ⇒ quảng cáo thắng (luật mới không làm đổi hành vi cũ)", () => {
    const qc = { adId: "ad-9", campaignId: null, adsetId: null, campaignName: null, formId: null, fbclid: "fb-1", gclid: null };
    const kq = quyNguon(tin({ affiliate: null, quangCao: qc }), cauHinh());
    expect(kq.luat).toBe("QUANG_CAO");
    expect(kq.signals.affiliate).toBeUndefined();
  });
});

describe("[AFF-RQ-03] thứ bậc: first-claim và lời khai của người vẫn thắng", () => {
  const keThua: KeThuaGoc = {
    leadId: "lead-cu",
    attributedAt: new Date("2026-10-01T00:00:00.000Z"),
    groupCode: "WALK_IN",
    originalGroupCode: "WALK_IN",
    nguoi: null,
    referrerMissing: false,
    otherSourceNote: null,
    anhChup: ANH_CHUP_TRONG,
  };

  it("khách đã có hồ sơ cũ (KE_THUA_SDT) ⇒ nguồn gốc GIỮ NGUYÊN, referral không giành được; signals.affiliate KHÔNG ghi", () => {
    const kq = quyNguon(tin({ affiliate: AFF(), keThua }), cauHinh());
    expect(kq.luat).toBe("KE_THUA_SDT");
    expect(kq.groupCode).toBe("WALK_IN");
    expect(kq.nguoi).toBeNull();
    expect(kq.signals.affiliate).toBeUndefined();
  });

  it("người nhập CHỌN tay nguồn (CHON_NGUON) ⇒ lời khai thắng link", () => {
    const chon = { groupCode: "WALK_IN", nguoi: null, giaiTrinh: null, loi: null, anhChup: ANH_CHUP_TRONG };
    const kq = quyNguon(tin({ affiliate: AFF(), nguonChon: chon }), cauHinh());
    expect(kq.luat).toBe("CHON_NGUON");
    expect(kq.signals.affiliate).toBeUndefined();
  });
});

describe("[AFF-RQ-04] không khớp ⇒ rơi xuống luật sau, không ném, không chặn lead (T4)", () => {
  it("cờ con `referral` TẮT ⇒ luật tắt; lead vẫn có nguồn theo đường vào (web ⇒ Quảng cáo), không ghi người giới thiệu", () => {
    const kq = quyNguon(tin({ affiliate: AFF() }), cauHinh({ referral: false }));
    expect(kq.luat).not.toBe("AFFILIATE_REFERRAL");
    expect(kq.nguoi).toBeNull();
    expect(kq.signals.affiliate).toBeUndefined();
  });

  it("`loi` ≠ null (đối tác ngừng / nguồn biến mất lúc ghi) ⇒ không khớp", () => {
    const kq = quyNguon(tin({ affiliate: AFF({ loi: "Đối tác giới thiệu không còn hoạt động lúc ghi nhận.", groupCode: "" }) }), cauHinh());
    expect(kq.luat).not.toBe("AFFILIATE_REFERRAL");
    expect(kq.nguoi).toBeNull();
  });

  it("nhóm đích đã NGỪNG (không còn ACTIVE) ⇒ không khớp — không ghi vào một nguồn đã đóng", () => {
    const kq = quyNguon(tin({ affiliate: AFF() }), cauHinh({}, ["KOL_REFERRAL"]));
    expect(kq.luat).not.toBe("AFFILIATE_REFERRAL");
    expect(kq.groupCode).not.toBe("KOL_REFERRAL");
  });

  it("nhóm đích KHÔNG có trong cấu hình (mã lạ) ⇒ không khớp, không ném", () => {
    expect(() => quyNguon(tin({ affiliate: AFF({ groupCode: "MA_LA_KHONG_TON_TAI" }) }), cauHinh())).not.toThrow();
    expect(quyNguon(tin({ affiliate: AFF({ groupCode: "MA_LA_KHONG_TON_TAI" }) }), cauHinh()).luat).not.toBe("AFFILIATE_REFERRAL");
  });

  it("affiliate vắng (undefined) hoặc null ⇒ giống nhau, không đổi hành vi cũ", () => {
    const a = quyNguon(tin({ affiliate: undefined }), cauHinh());
    const b = quyNguon(tin({ affiliate: null }), cauHinh());
    expect(a.luat).toBe(b.luat);
    expect(a.groupCode).toBe(b.groupCode);
  });
});

describe("[AFF-GIAI-01] giaiAffiliateReferral — đối chiếu dữ liệu sống", () => {
  const vao = { affiliateId: "aff-1", sourceGroupId: "g-1", snapshot: { a: 1 } };

  it("đối tác còn hoạt động ∧ nhóm tồn tại ⇒ giải ra mã nhóm, không lỗi", () => {
    expect(giaiAffiliateReferral(vao, { affiliateConHoatDong: true, nhom: { code: "KOL_REFERRAL" } })).toEqual({
      affiliateId: "aff-1",
      groupCode: "KOL_REFERRAL",
      snapshot: { a: 1 },
      loi: null,
    });
  });

  it("đối tác không còn hoạt động ⇒ loi (nói đúng lý do), không mã nhóm", () => {
    const kq = giaiAffiliateReferral(vao, { affiliateConHoatDong: false, nhom: { code: "KOL_REFERRAL" } });
    expect(kq.loi).toMatch(/không còn hoạt động/);
    expect(kq.groupCode).toBe("");
  });

  it("nhóm không tồn tại ⇒ loi", () => {
    expect(giaiAffiliateReferral(vao, { affiliateConHoatDong: true, nhom: undefined }).loi).toMatch(/không còn tồn tại/);
  });

  it("đối tác ngừng được báo TRƯỚC nhóm biến mất (lý do chính đi đầu)", () => {
    expect(giaiAffiliateReferral(vao, { affiliateConHoatDong: false, nhom: undefined }).loi).toMatch(/Đối tác/);
  });
});
