/**
 * Ca [NHH-SRC-18u] — `chonKhiGopLead`: first-claim khi gộp hai lead (07 §2.6.4). THUẦN, ngày tuyệt đối.
 * Ca [NHH-SRC-RQ-*] — `quyNguon`: resolver CHẠY TRÊN BẢNG LUẬT (03 §2.3–§2.5), THUẦN, `bayGio` truyền vào (luật 19).
 *
 * Mỗi luật là một phần tử của `BO_LUAT`; thứ tự + công tắc nằm ở `CauHinhQuyNguon.thuTu`, KHÔNG có if/else
 * về nguồn rải ở nơi gọi (T2). Hàm TOÀN PHẦN: mọi đầu vào đều ra một đích (T4).
 */
import { describe, expect, it } from "vitest";
import { DANH_MUC_GOC, VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import {
  BO_LUAT,
  CO_CUA_LUAT,
  THU_TU_LUAT_MAC_DINH,
  chonGocKeThua,
  chonKhiGopLead,
  dungCauHinhQuyNguon,
  quyNguon,
} from "./quy-nguon";
import { ANH_CHUP_TRONG, type CoQuyNguon, type KeThuaGoc, type TinHieuQuyNguon } from "./tin-hieu";

const d = (iso: string) => new Date(iso);
const BAY_GIO = d("2026-10-08T03:00:00.000Z"); // 10:00 giờ VN 08/10/2026 — SAU mốc 01/10 và 06/10

describe("[NHH-SRC-18u] chonKhiGopLead — attributedAt NHỎ hơn thắng", () => {
  it("phụ sớm hơn ⇒ phụ thắng", () => {
    expect(
      chonKhiGopLead({ attributedAt: d("2026-09-10T00:00:00.000Z") }, { attributedAt: d("2026-09-01T00:00:00.000Z") }),
    ).toEqual({ thang: "phu" });
  });

  it("chính sớm hơn ⇒ chính giữ", () => {
    expect(
      chonKhiGopLead({ attributedAt: d("2026-09-01T00:00:00.000Z") }, { attributedAt: d("2026-09-10T00:00:00.000Z") }),
    ).toEqual({ thang: "chinh" });
  });

  it("BẰNG nhau ⇒ 'chinh' (tất định), kể cả lệch dưới một mili giây không tồn tại ở Date", () => {
    expect(
      chonKhiGopLead({ attributedAt: d("2026-09-01T00:00:00.000Z") }, { attributedAt: d("2026-09-01T00:00:00.000Z") }),
    ).toEqual({ thang: "chinh" });
  });
});

// ── Dựng đầu vào ──────────────────────────────────────────────────────────────────────────────
const CO_BAT: CoQuyNguon = { autoAttribution: true, pageMapping: true, referral: true, manualReview: true };

/** `rieng`: ghi đè thuộc tính chụp (cửa sổ riêng · chủ nguồn) theo mã nhóm — để ca bản chụp `signals.nguon` đo được. */
function cauHinh(
  co: Partial<CoQuyNguon> = {},
  nhomTat: readonly string[] = [],
  nhomNhanSu = "EMPLOYEE_REFERRAL",
  them: readonly { code: string; referrerRequirement: "NONE" | "PARENT" | "EMPLOYEE" | "AFFILIATE_ORG" | "EVENT" }[] = [],
  rieng: Readonly<Record<string, { cuaSoRiengNgay?: number | null; chuNhanVienId?: string | null }>> = {},
) {
  return dungCauHinhQuyNguon({
    nhom: [
      ...DANH_MUC_GOC.map((g) => ({
        code: g.code,
        active: !nhomTat.includes(g.code),
        requiresNote: g.requiresNote,
        selectable: g.selectable,
        referrerRequirement: g.referrerRequirement,
        cuaSoRiengNgay: rieng[g.code]?.cuaSoRiengNgay ?? null,
        chuNhanVienId: rieng[g.code]?.chuNhanVienId ?? null,
      })),
      ...them.map((g) => ({
        code: g.code,
        active: !nhomTat.includes(g.code),
        requiresNote: false,
        selectable: true,
        referrerRequirement: g.referrerRequirement,
        cuaSoRiengNgay: rieng[g.code]?.cuaSoRiengNgay ?? null,
        chuNhanVienId: rieng[g.code]?.chuNhanVienId ?? null,
      })),
    ],
    co: { ...CO_BAT, ...co },
    vaiSangNguon: VAI_SANG_NGUON_MAC_DINH,
    nhomNhanSu,
    cuaSoMacDinhNgay: 90,
  });
}

const QUANG_CAO_TRONG = {
  adId: null,
  campaignId: null,
  adsetId: null,
  campaignName: null,
  formId: null,
  fbclid: null,
  gclid: null,
} as const;

function tin(over: Partial<TinHieuQuyNguon> = {}): TinHieuQuyNguon {
  return {
    bayGio: BAY_GIO,
    duongVao: "facebook",
    conversionEntry: "facebook",
    nhanKhai: null,
    laNhapExcel: false,
    nguoiNhap: null,
    maNvKhongGiai: null,
    nhanSuGioiThieu: null,
    phuHuynhGioiThieu: null,
    saleCuaPhuHuynh: null,
    ref: null,
    refSau: [],
    quangCao: QUANG_CAO_TRONG,
    utm: { source: null, medium: null, campaign: null, term: null, content: null },
    page: null,
    keThua: null,
    sdtTrungNhanVien: false,
    sdtNguoiGioiThieuTrungKhach: false,
    ...over,
  };
}

describe("[NHH-SRC-RQ-01] bảng luật — thứ tự mặc định đúng 11 bậc PRD + công tắc", () => {
  it("thứ tự mặc định: KE_THUA đầu, DUONG_VAO_MAC_DINH sát UNKNOWN; ba MA_* + QR tắt tới PR7/PR11", () => {
    expect(THU_TU_LUAT_MAC_DINH.map((l) => l.ma)).toEqual([
      "KE_THUA_SDT",
      "CHON_NGUON",
      "MA_GT_CA_NHAN",
      "QR_SU_KIEN",
      "MA_DOI_TAC",
      "MA_CTV",
      "AFF_CHUA_PHAN_LOAI",
      "QUANG_CAO",
      "PAGE_MAPPING",
      "NV_GIOI_THIEU",
      "PH_GIOI_THIEU",
      "KHAI_TAY",
      "DUONG_VAO_MAC_DINH",
    ]);
    const bat = Object.fromEntries(THU_TU_LUAT_MAC_DINH.map((l) => [l.ma, l.bat]));
    expect(bat.MA_GT_CA_NHAN).toBe(false);
    expect(bat.MA_DOI_TAC).toBe(false);
    expect(bat.MA_CTV).toBe(false);
    expect(bat.QR_SU_KIEN).toBe(false);
    expect(bat.AFF_CHUA_PHAN_LOAI).toBe(true); // luật tạm H12
  });

  it("mọi mã trong thứ tự đều có hàm trong BO_LUAT (không luật mồ côi)", () => {
    for (const l of THU_TU_LUAT_MAC_DINH) expect(typeof BO_LUAT[l.ma], l.ma).toBe("function");
  });

  it("cờ con tắt ⇒ luật gắn cờ đó tắt; cờ master do tầng cờ xử lý (không nằm ở đây)", () => {
    expect(CO_CUA_LUAT.QUANG_CAO).toBe("autoAttribution");
    expect(CO_CUA_LUAT.DUONG_VAO_MAC_DINH).toBe("autoAttribution");
    expect(CO_CUA_LUAT.PAGE_MAPPING).toBe("pageMapping");
    expect(CO_CUA_LUAT.NV_GIOI_THIEU).toBe("referral");
    expect(CO_CUA_LUAT.PH_GIOI_THIEU).toBe("referral");
    expect(CO_CUA_LUAT.AFF_CHUA_PHAN_LOAI).toBe("referral");
    // Kế thừa SĐT + khai tay KHÔNG gắn cờ con: mất chúng là mất dữ liệu nguồn gốc / mất chữ người gõ.
    expect(CO_CUA_LUAT.KE_THUA_SDT).toBeNull();
    expect(CO_CUA_LUAT.KHAI_TAY).toBeNull();
    // Lựa chọn tường minh của người cũng không gắn cờ con (PR7): tắt `referral` không được biến lời chọn thành UNKNOWN.
    expect(CO_CUA_LUAT.CHON_NGUON).toBeNull();
  });
});

describe("[NHH-UI-RQ-01] luật CHON_NGUON — người nhập chọn tường minh thắng tín hiệu máy, thua kế thừa SĐT", () => {
  const chon = (p: Partial<NonNullable<TinHieuQuyNguon["nguonChon"]>> = {}): TinHieuQuyNguon["nguonChon"] => ({
    groupCode: "WALK_IN",
    nguoi: null,
    giaiTrinh: null,
    loi: null,
    anhChup: ANH_CHUP_TRONG,
    ...p,
  });

  it("chọn nhóm không cần người ⇒ ghi đúng nhóm, MANUAL, luật CHON_NGUON, không xem tay", () => {
    const r = quyNguon(tin({ duongVao: "sale-form-app", nguonChon: chon() }), cauHinh());
    expect(r).toMatchObject({ groupCode: "WALK_IN", luat: "CHON_NGUON", identificationMethod: "MANUAL", referrerMissing: false, xemTay: [] });
    expect(r.nguoi).toBeNull();
  });

  it("chọn nhân sự ⇒ người + nhóm do tầng đọc đã suy; giải trình đi cùng (nguồn 'Khác')", () => {
    const nv = quyNguon(tin({ nguonChon: chon({ groupCode: "EMPLOYEE_REFERRAL", nguoi: { kind: "EMPLOYEE", employeeId: "e1" } }) }), cauHinh());
    expect(nv).toMatchObject({ groupCode: "EMPLOYEE_REFERRAL", luat: "CHON_NGUON" });
    expect(nv.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "e1" });
    const khac = quyNguon(tin({ nguonChon: chon({ groupCode: "OTHER", giaiTrinh: "khách đến từ hội thảo STEM" }) }), cauHinh());
    expect(khac).toMatchObject({ groupCode: "OTHER", otherSourceNote: "khách đến từ hội thảo STEM" });
  });

  it("THẮNG tín hiệu máy: có cả fbclid (quảng cáo) lẫn lựa chọn ⇒ lựa chọn thắng, quảng cáo thành touchpoint thua (không bị vứt)", () => {
    const r = quyNguon(
      tin({ quangCao: { ...QUANG_CAO_TRONG, fbclid: "abc" }, nguonChon: chon({ groupCode: "CENTER_ORGANIC" }) }),
      cauHinh(),
    );
    expect(r.groupCode).toBe("CENTER_ORGANIC");
    expect(r.luat).toBe("CHON_NGUON");
    expect(r.touchpointThua.length).toBeGreaterThan(0);
  });

  it("THUA kế thừa SĐT (D3 first-claim): khách quay lại có bản gốc ⇒ nguồn gốc giữ nguyên, lựa chọn mới không đè", () => {
    const r = quyNguon(
      tin({
        nguonChon: chon({ groupCode: "WALK_IN" }),
        keThua: {
          leadId: "goc",
          attributedAt: d("2026-08-01T00:00:00.000Z"),
          groupCode: "PAID_ADS",
          originalGroupCode: "PAID_ADS",
          nguoi: null,
          referrerMissing: false,
          otherSourceNote: null,
          anhChup: ANH_CHUP_TRONG,
        },
      }),
      cauHinh(),
    );
    expect(r).toMatchObject({ groupCode: "PAID_ADS", luat: "KE_THUA_SDT" });
  });

  it("lựa chọn KHÔNG HỢP LỆ (`loi`) ⇒ luật không khớp, rơi xuống luật sau (tầng nhập tự chặn bằng `loi`); nhóm đích đã ngừng ⇒ cũng không khớp", () => {
    const hong = quyNguon(tin({ duongVao: "web", nguonChon: chon({ loi: "Nguồn này cần chọn nhân sự giới thiệu." }) }), cauHinh());
    expect(hong.luat).toBe("DUONG_VAO_MAC_DINH");
    const ngung = quyNguon(tin({ duongVao: "web", nguonChon: chon({ groupCode: "WALK_IN" }) }), cauHinh({}, ["WALK_IN"]));
    expect(ngung.luat).not.toBe("CHON_NGUON");
  });

  it("KHÔNG gắn cờ con: tắt `referral` + `autoAttribution` thì lựa chọn của người VẪN được ghi", () => {
    const r = quyNguon(
      tin({ nguonChon: chon({ groupCode: "EMPLOYEE_REFERRAL", nguoi: { kind: "EMPLOYEE", employeeId: "e1" } }) }),
      cauHinh({ referral: false, autoAttribution: false }),
    );
    expect(r).toMatchObject({ groupCode: "EMPLOYEE_REFERRAL", luat: "CHON_NGUON" });
  });

  it("vắng `nguonChon` (đường máy/Excel) ⇒ hành vi cũ y nguyên", () => {
    expect(quyNguon(tin({ duongVao: "web" }), cauHinh()).luat).toBe("DUONG_VAO_MAC_DINH");
    expect(quyNguon(tin({ duongVao: "web", nguonChon: null }), cauHinh()).luat).toBe("DUONG_VAO_MAC_DINH");
  });
});

describe("[NHH-SRC-RQ-02] đường vào mặc định (D11) + UNKNOWN luôn cuối (D7)", () => {
  it("webhook facebook không tín hiệu nào khác ⇒ nhóm Quảng cáo, SYSTEM_DEFAULT", () => {
    const r = quyNguon(tin(), cauHinh());
    expect(r.groupCode).toBe("PAID_ADS");
    expect(r.originalGroupCode).toBe("PAID_ADS");
    expect(r.luat).toBe("DUONG_VAO_MAC_DINH");
    expect(r.identificationMethod).toBe("SYSTEM_DEFAULT");
    expect(r.xemTay).toEqual([]);
    expect(r.attributedAt).toBeNull(); // giờ DB (T7)
  });

  it("đường vào lạ không có trong bảng ⇒ UNKNOWN (không đoán), KHÔNG vào xem tay vì không có lý do cụ thể", () => {
    const r = quyNguon(tin({ duongVao: "kenh-la", conversionEntry: "kenh-la" }), cauHinh());
    expect(r.groupCode).toBe("UNKNOWN");
    expect(r.luat).toBe("UNKNOWN");
    expect(r.identificationMethod).toBe("UNKNOWN");
    expect(r.xemTay).toEqual([]);
  });

  it("cờ autoAttribution TẮT ⇒ đường vào mặc định KHÔNG chạy ⇒ UNKNOWN (tín hiệu vẫn ghi vào signals)", () => {
    const r = quyNguon(tin(), cauHinh({ autoAttribution: false }));
    expect(r.groupCode).toBe("UNKNOWN");
    expect(r.signals.duongVao).toBe("facebook");
  });

  it("nhóm đích INACTIVE ⇒ luật không khớp (Inactive chỉ chặn claim MỚI) ⇒ rơi xuống UNKNOWN", () => {
    const r = quyNguon(tin(), cauHinh({}, ["PAID_ADS"]));
    expect(r.groupCode).toBe("UNKNOWN");
  });
});

describe("[NHH-SRC-RQ-03] quảng cáo > đường vào; metadata chụp vào signals (D18)", () => {
  it("ad_id/campaign/form có mặt ⇒ QUANG_CAO thắng, AD_FORM_CAMPAIGN, signals mang đủ định danh", () => {
    const r = quyNguon(
      tin({
        duongVao: "facebook",
        quangCao: { ...QUANG_CAO_TRONG, adId: "AD1", campaignId: "C1", adsetId: "S1", formId: "F1", campaignName: "CS1_DN_2026" },
      }),
      cauHinh(),
    );
    expect(r.luat).toBe("QUANG_CAO");
    expect(r.groupCode).toBe("PAID_ADS");
    expect(r.identificationMethod).toBe("AD_FORM_CAMPAIGN");
    expect(r.signals.quangCao).toEqual({
      adId: "AD1",
      campaignId: "C1",
      adsetId: "S1",
      formId: "F1",
      campaignName: "CS1_DN_2026",
    });
    // Không dừng ở "facebook" chung: lý do nói rõ nhờ metadata nào.
    expect(r.reasonText).toMatch(/quảng cáo|chiến dịch|biểu mẫu/i);
  });

  it("MỘT trong sáu tín hiệu là đủ (chỉ fbclid) — nhưng UTM đứng MỘT MÌNH thì KHÔNG phải tín hiệu quảng cáo", () => {
    expect(quyNguon(tin({ duongVao: "web", quangCao: { ...QUANG_CAO_TRONG, fbclid: "abc" } }), cauHinh()).luat).toBe(
      "QUANG_CAO",
    );
    const chiUtm = quyNguon(
      tin({
        duongVao: "web",
        utm: { source: "fb", medium: "cpc", campaign: "x", term: null, content: null },
      }),
      cauHinh({}),
    );
    // Không có đường vào "web" trong bảng mặc định của ca này? — có: web ⇒ nhóm 2 theo D11, nhưng qua DUONG_VAO.
    expect(chiUtm.luat).not.toBe("QUANG_CAO");
    expect(chiUtm.signals.utm).toEqual({ source: "fb", medium: "cpc", campaign: "x" });
  });

  it("đối chứng: cờ autoAttribution tắt ⇒ metadata quảng cáo vẫn nằm trong signals nhưng luật không chạy", () => {
    const r = quyNguon(
      tin({ quangCao: { ...QUANG_CAO_TRONG, adId: "AD1" } }),
      cauHinh({ autoAttribution: false }),
    );
    expect(r.luat).toBe("UNKNOWN");
    expect((r.signals.quangCao as { adId: string }).adId).toBe("AD1");
  });
});

describe("[NHH-SRC-RQ-04] trùng SĐT — kế thừa nguồn gốc (D3)", () => {
  const goc = {
    leadId: "L_CU",
    attributedAt: d("2026-06-01T02:00:00.000Z"),
    groupCode: "EMPLOYEE_REFERRAL",
    originalGroupCode: "PARENT_REFERRAL",
    nguoi: { kind: "EMPLOYEE", employeeId: "E1" } as const,
    referrerMissing: false,
    otherSourceNote: null,
    anhChup: ANH_CHUP_TRONG,
  };

  it("lead DA_MAT cùng SĐT ⇒ bộ ba nguồn gốc + người giới thiệu kế thừa; KE_THUA_SDT / EXISTING_LEAD", () => {
    const r = quyNguon(tin({ keThua: goc }), cauHinh());
    expect(r.luat).toBe("KE_THUA_SDT");
    expect(r.identificationMethod).toBe("EXISTING_LEAD");
    expect(r.groupCode).toBe("EMPLOYEE_REFERRAL");
    expect(r.originalGroupCode).toBe("PARENT_REFERRAL");
    expect(r.inheritedFromLeadId).toBe("L_CU");
    expect(r.attributedAt).toEqual(d("2026-06-01T02:00:00.000Z")); // mốc của bản GỐC, không phải giờ tạo lead mới
    expect(r.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E1" });
  });

  it("ref đến CÙNG lượt nhập KHÔNG chiếm nguồn: thành touchpoint REF_SAU; quảng cáo thành touchpoint TAO_LEAD", () => {
    const r = quyNguon(
      tin({
        keThua: goc,
        ref: { code: "ABC123", hopLe: true, affiliateId: "AFF1" },
        quangCao: { ...QUANG_CAO_TRONG, campaignId: "C9" },
      }),
      cauHinh(),
    );
    expect(r.luat).toBe("KE_THUA_SDT");
    expect(r.groupCode).toBe("EMPLOYEE_REFERRAL");
    const kinds = r.touchpointThua.map((t) => t.kind).sort();
    expect(kinds).toEqual(["REF_SAU", "TAO_LEAD"]);
    const ref = r.touchpointThua.find((t) => t.kind === "REF_SAU")!;
    expect(ref.signals.ref).toBe("ABC123");
  });

  it("kế thừa KHÔNG gắn cờ con: cờ autoAttribution tắt vẫn kế thừa (mất nó là mất nguồn gốc)", () => {
    expect(quyNguon(tin({ keThua: goc }), cauHinh({ autoAttribution: false })).luat).toBe("KE_THUA_SDT");
  });

  it("chonGocKeThua: attributedAt nhỏ nhất; hoà ⇒ bản KHÔNG kế thừa (gốc thật) rồi leadId nhỏ", () => {
    const a = { leadId: "L2", attributedAt: d("2026-05-01T00:00:00.000Z"), inheritedFromLeadId: "L1" };
    const b = { leadId: "L1", attributedAt: d("2026-05-01T00:00:00.000Z"), inheritedFromLeadId: null };
    const c = { leadId: "L3", attributedAt: d("2026-07-01T00:00:00.000Z"), inheritedFromLeadId: null };
    expect(chonGocKeThua([a, b, c])?.leadId).toBe("L1");
    expect(chonGocKeThua([c, a])?.leadId).toBe("L2");
    expect(chonGocKeThua([])).toBeNull();
  });
});

describe("[NHH-SRC-RQ-05] mã giới thiệu (affiliate) trước PR11 ⇒ MANUAL_REVIEW, không đoán loại (H12)", () => {
  it("ref hợp lệ ⇒ UNKNOWN + xemTay AFF_CHUA_PHAN_LOAI; ref chụp vào signals; quảng cáo thua thành touchpoint", () => {
    const r = quyNguon(
      tin({
        ref: { code: "ABC123", hopLe: true, affiliateId: "AFF1" },
        quangCao: { ...QUANG_CAO_TRONG, campaignId: "C9" },
      }),
      cauHinh(),
    );
    expect(r.luat).toBe("AFF_CHUA_PHAN_LOAI");
    expect(r.groupCode).toBe("UNKNOWN");
    expect(r.xemTay).toEqual(["AFF_CHUA_PHAN_LOAI"]);
    expect(r.signals.coXemTay).toBe(true);
    expect(r.signals.ref).toEqual({ code: "ABC123", hopLe: true, affiliateId: "AFF1" });
    expect(r.touchpointThua.map((t) => t.kind)).toEqual(["TAO_LEAD"]);
  });

  it("ref SAI/tắt ⇒ fail-closed về đường vào mặc định (nhóm 2), KHÔNG vào xem tay; ref vẫn nằm trong signals", () => {
    const r = quyNguon(tin({ ref: { code: "SAI", hopLe: false, affiliateId: null } }), cauHinh());
    expect(r.luat).toBe("DUONG_VAO_MAC_DINH");
    expect(r.groupCode).toBe("PAID_ADS");
    expect(r.xemTay).toEqual([]);
    expect(r.signals.ref).toEqual({ code: "SAI", hopLe: false });
  });

  it("đối chứng: cờ referral TẮT ⇒ luật tạm không chạy ⇒ lead đi tiếp xuống luật dưới", () => {
    const r = quyNguon(tin({ ref: { code: "ABC123", hopLe: true, affiliateId: "AFF1" } }), cauHinh({ referral: false }));
    expect(r.luat).toBe("DUONG_VAO_MAC_DINH");
  });
});

describe("[NHH-SRC-RQ-06] page mapping runtime (D18): tự xác định ⇒ khoá; chưa map ⇒ xem tay", () => {
  const page = (dich: { groupCode: string; campaignCode: string | null } | null) => ({
    pageId: "PG1",
    trongDanhMuc: true,
    dich,
  });

  it("page đã map ⇒ nhóm theo bảng, PAGE_MAPPING, nguồn bị KHOÁ", () => {
    const r = quyNguon(tin({ page: page({ groupCode: "CENTER_ORGANIC", campaignCode: "ORG-1" }) }), cauHinh());
    expect(r.luat).toBe("PAGE_MAPPING");
    expect(r.groupCode).toBe("CENTER_ORGANIC");
    expect(r.identificationMethod).toBe("PAGE_MAPPING");
    expect(r.khoaNguon).toBe(true);
    expect(r.signals.khoaNguon).toBe(true);
    expect(r.signals.pageId).toBe("PG1");
  });

  it("campaign/ad/form THẮNG page mặc định; page thành touchpoint chứ không biến mất", () => {
    const r = quyNguon(
      tin({
        page: page({ groupCode: "CENTER_ORGANIC", campaignCode: null }),
        quangCao: { ...QUANG_CAO_TRONG, adId: "AD7" },
      }),
      cauHinh(),
    );
    expect(r.luat).toBe("QUANG_CAO");
    expect(r.groupCode).toBe("PAID_ADS");
    expect(r.khoaNguon).toBe(false);
    expect(r.touchpointThua.some((t) => (t.signals as { pageId?: string }).pageId === "PG1")).toBe(true);
  });

  it("page có trong danh mục nhưng CHƯA có dòng trong bảng nguồn ⇒ rơi luật dưới + xemTay PAGE_CHUA_MAP_NGUON", () => {
    const r = quyNguon(tin({ page: page(null) }), cauHinh());
    expect(r.luat).toBe("DUONG_VAO_MAC_DINH");
    expect(r.xemTay).toContain("PAGE_CHUA_MAP_NGUON");
    expect(r.khoaNguon).toBe(false);
  });

  it("bảng trỏ tới nhóm INACTIVE ⇒ coi như chưa map (không khoá vào nhóm chết)", () => {
    const r = quyNguon(tin({ page: page({ groupCode: "CENTER_ORGANIC", campaignCode: null }) }), cauHinh({}, ["CENTER_ORGANIC"]));
    expect(r.luat).not.toBe("PAGE_MAPPING");
    expect(r.xemTay).toContain("PAGE_CHUA_MAP_NGUON");
  });

  it("đối chứng: cờ pageMapping TẮT ⇒ không khoá, không xem tay (page chỉ nằm trong signals)", () => {
    const r = quyNguon(tin({ page: page({ groupCode: "CENTER_ORGANIC", campaignCode: null }) }), cauHinh({ pageMapping: false }));
    expect(r.luat).toBe("DUONG_VAO_MAC_DINH");
    expect(r.khoaNguon).toBe(false);
    expect(r.xemTay).not.toContain("PAGE_CHUA_MAP_NGUON");
    expect(r.signals.pageId).toBe("PG1");
  });
});

describe("[NHH-SRC-RQ-07] người giới thiệu: nhân sự → nhóm theo VAI NGỮ NGHĨA (H18), phụ huynh → nhóm 1", () => {
  it("nhân sự do người nhập CHỌN, vai Sale ⇒ nhóm Sale; EMPLOYEE_REFERRAL; người được lưu", () => {
    const r = quyNguon(
      tin({
        duongVao: "nhap-tay",
        nhanSuGioiThieu: { employeeId: "E7", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false },
      }),
      cauHinh(),
    );
    expect(r.luat).toBe("NV_GIOI_THIEU");
    expect(r.groupCode).toBe("EMPLOYEE_REFERRAL");
    expect(r.identificationMethod).toBe("EMPLOYEE_REFERRAL");
    expect(r.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E7" });
    expect(r.referrerMissing).toBe(false);
  });

  it("vai Giáo viên / Quản lý / khác ⇒ CÙNG MỘT nhóm nhân sự giới thiệu (vai chỉ khác ở snapshot `referrerRoleCode`)", () => {
    const nhom = (roleCodes: string[]) =>
      quyNguon(
        tin({ duongVao: "nhap-tay", nhanSuGioiThieu: { employeeId: "E", roleCodes, vaiTuHienTai: false } }),
        cauHinh(),
      ).groupCode;
    expect(nhom(["TEACHER"])).toBe("EMPLOYEE_REFERRAL");
    expect(nhom(["CENTER_MANAGER"])).toBe("EMPLOYEE_REFERRAL");
    expect(nhom(["HO_ACCOUNTANT"])).toBe("EMPLOYEE_REFERRAL");
  });

  it("phụ huynh giới thiệu ⇒ nhóm 1, PARENT_REFERRAL, người PARENT", () => {
    const r = quyNguon(
      tin({ duongVao: "nhap-tay", phuHuynhGioiThieu: { parentUserId: "U1", studentId: "S1" } }),
      cauHinh(),
    );
    expect(r.luat).toBe("PH_GIOI_THIEU");
    expect(r.groupCode).toBe("PARENT_REFERRAL");
    expect(r.nguoi).toEqual({ kind: "PARENT", parentUserId: "U1", studentId: "S1" });
  });

  it("đối chứng: cờ referral TẮT ⇒ hai luật này không chạy", () => {
    const r = quyNguon(
      tin({
        duongVao: "nhap-tay",
        nhanSuGioiThieu: { employeeId: "E7", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false },
      }),
      cauHinh({ referral: false }),
    );
    expect(r.luat).toBe("UNKNOWN");
  });
});

describe("[NHH-SRC-RQ-08] khai tay qua anhXaNhanCu — không viết nhánh thứ hai (D10, D12, D21)", () => {
  const nguoiSale = { employeeId: "E1", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false };

  it("nhãn cố định trong 28 nhãn ('Ads') ⇒ nhóm 2, MANUAL", () => {
    const r = quyNguon(tin({ duongVao: "sale-form-app", nhanKhai: "Ads" }), cauHinh());
    expect(r.luat).toBe("KHAI_TAY");
    expect(r.groupCode).toBe("PAID_ADS");
    expect(r.identificationMethod).toBe("MANUAL");
  });

  it("đường Excel ⇒ SYSTEM_IMPORT", () => {
    const r = quyNguon(tin({ duongVao: "import-excel", nhanKhai: "Ads", laNhapExcel: true }), cauHinh());
    expect(r.identificationMethod).toBe("SYSTEM_IMPORT");
  });

  it("'sale-form-app' sau 01/10 ⇒ NGƯỜI NHẬP quyết nhóm VÀ được lưu làm người giới thiệu kèm vai + dấu vết (D12 GIỮ NGUYÊN, chủ dự án chốt 09/10/2026); không có người ⇒ nhóm 11 + giải trình + xem tay", () => {
    const co = quyNguon(tin({ duongVao: "sale-form-app", nhanKhai: "sale-form-app", nguoiNhap: { ...nguoiSale, employeeCode: "SR.NV.01", orgUnitId: "ou-1" } }), cauHinh());
    expect(co.groupCode).toBe("EMPLOYEE_REFERRAL");
    expect(co.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E1" });
    expect(co.referrerMissing).toBe(false);
    expect(co.anhChup.referrerRoleCode).toBe("SALE");
    expect(co.signals.nguoiGioiThieu).toEqual({ employeeCode: "SR.NV.01", roleCodes: ["CENTER_SALES_CSM"], orgUnitId: "ou-1" });
    expect(co.canhBao).toEqual([]);
    expect(co.xemTay).toEqual([]);

    const khong = quyNguon(
      tin({ duongVao: "sale-form", nhanKhai: "sale-form", maNvKhongGiai: "SR.NV.022" }),
      cauHinh(),
    );
    expect(khong.groupCode).toBe("OTHER");
    expect(khong.otherSourceNote).toMatch(/SR\.NV\.022/);
    expect(khong.xemTay).toContain("MA_NV_KHONG_GIAI");
    expect(khong.signals.coXemTay).toBe(true);
  });

  it("nhóm cần NGƯỜI mà không có người ('Quản Lý Trung Tâm') ⇒ referrerMissing + xem tay THIEU_NGUOI", () => {
    const r = quyNguon(tin({ duongVao: "nhap-tay", nhanKhai: "Quản Lý Trung Tâm" }), cauHinh());
    expect(r.groupCode).toBe("EMPLOYEE_REFERRAL");
    expect(r.referrerMissing).toBe(true);
    expect(r.nguoi).toBeNull();
    expect(r.xemTay).toEqual(["THIEU_NGUOI"]);
  });

  it("H21: nhãn #10/#14/#22 ('Nhập tay') trên phiếu SAU mốc 06/10 ⇒ MANUAL_REVIEW, KHÔNG UNKNOWN, KHÔNG theo đích cũ", () => {
    for (const nhan of ["Nhập tay", "Khác", "Nguồn khác"]) {
      const r = quyNguon(tin({ duongVao: "nhap-tay", nhanKhai: nhan }), cauHinh());
      expect(r.xemTay, nhan).toEqual(["NHAN_CHOT_THEO_PHIEU"]);
      expect(r.groupCode, nhan).toBe("OTHER"); // đề xuất, không phải quyết định
      expect(r.groupCode, nhan).not.toBe("UNKNOWN");
      expect(r.luat, nhan).toBe("KHAI_TAY");
      expect(r.signals.coXemTay, nhan).toBe(true);
      expect(r.signals.nhanGoc, nhan).toBe(nhan);
    }
  });

  it("H21 đối chứng: CÙNG nhãn nhưng phiếu TRƯỚC mốc 06/10 16:21 VN ⇒ đích đã chốt, không xem tay", () => {
    const r = quyNguon(
      tin({ duongVao: "nhap-tay", nhanKhai: "Nhập tay", bayGio: d("2026-10-06T09:20:59.000Z") }),
      cauHinh(),
    );
    expect(r.groupCode).toBe("EMPLOYEE_REFERRAL");
    expect(r.xemTay).toEqual(["THIEU_NGUOI"]);
  });

  it("nhãn LẠ (ngoài 28) ⇒ UNKNOWN + signals.nhanGoc + xem tay NHAN_NGUON_LA — KHÔNG chặn (đường máy), 05 §2.2b", () => {
    const r = quyNguon(tin({ duongVao: "import-excel", nhanKhai: "Nguồn mới tinh" }), cauHinh());
    expect(r.groupCode).toBe("UNKNOWN");
    expect(r.xemTay).toEqual(["NHAN_NGUON_LA"]);
    expect(r.signals.nhanGoc).toBe("Nguồn mới tinh");
    expect(r.signals.coXemTay).toBe(true);
  });

  it("nhãn lạ nhưng đường vào có mặc định (quatang) ⇒ vẫn đích mặc định, NHƯNG vẫn vào xem tay", () => {
    const r = quyNguon(tin({ duongVao: "quatang", nhanKhai: "Nhãn lạ" }), cauHinh());
    expect(r.luat).toBe("DUONG_VAO_MAC_DINH");
    expect(r.xemTay).toEqual(["NHAN_NGUON_LA"]);
  });

  it("KHAI_TAY KHÔNG gắn cờ con: tắt hết cờ con vẫn tôn trọng chữ người gõ", () => {
    const r = quyNguon(
      tin({ duongVao: "sale-form-app", nhanKhai: "Ads" }),
      cauHinh({ autoAttribution: false, pageMapping: false, referral: false, manualReview: false }),
    );
    expect(r.luat).toBe("KHAI_TAY");
  });
});

describe("[NHH-SRC-RQ-09] gian lận ở đường tạo: SĐT trùng nhân viên ⇒ CẢNH BÁO + xem tay, KHÔNG chặn", () => {
  it("sdtTrungNhanVien ⇒ canhBao + xemTay SDT_NHAN_VIEN; nguồn vẫn ra bình thường", () => {
    const r = quyNguon(tin({ sdtTrungNhanVien: true }), cauHinh());
    expect(r.groupCode).toBe("PAID_ADS");
    expect(r.canhBao).toEqual(["SDT_NHAN_VIEN"]);
    expect(r.xemTay).toEqual(["SDT_NHAN_VIEN"]);
  });

  it("người giới thiệu trùng SĐT khách ⇒ NGUOI_GT_LA_KHACH (cảnh báo, không chặn)", () => {
    const r = quyNguon(tin({ sdtNguoiGioiThieuTrungKhach: true }), cauHinh());
    expect(r.canhBao).toEqual(["NGUOI_GT_LA_KHACH"]);
    expect(r.xemTay).toContain("NGUOI_GT_LA_KHACH");
  });

  it("đối chứng dương: không trùng ⇒ canhBao rỗng", () => {
    expect(quyNguon(tin(), cauHinh()).canhBao).toEqual([]);
  });
});

describe("[NHH-SRC-RQ-10] hàm TOÀN PHẦN + tín hiệu thua không bị vứt", () => {
  it("đầu vào rỗng hoàn toàn vẫn ra một đích (không ném)", () => {
    const r = quyNguon(tin({ duongVao: "" }), cauHinh({ autoAttribution: false, referral: false, pageMapping: false }));
    expect(r.groupCode).toBe("UNKNOWN");
  });

  it("refSau[] ⇒ mỗi phần tử một touchpoint REF_SAU, không đổi nguồn", () => {
    const r = quyNguon(tin({ refSau: ["A1B2C3", "D4E5F6"] }), cauHinh());
    expect(r.luat).toBe("DUONG_VAO_MAC_DINH");
    expect(r.touchpointThua.map((t) => t.kind)).toEqual(["REF_SAU", "REF_SAU"]);
  });

  it("signals KHÔNG chứa PII: không SĐT/tên/email ở bất kỳ khoá nào", () => {
    const r = quyNguon(
      tin({
        nhanKhai: "Ads",
        duongVao: "sale-form-app",
        nguoiNhap: { employeeId: "E1", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false },
        quangCao: { ...QUANG_CAO_TRONG, campaignName: "CS1_DN" },
        sdtTrungNhanVien: true,
      }),
      cauHinh(),
    );
    const json = JSON.stringify([r.signals, r.touchpointThua]);
    expect(json).not.toMatch(/\b(0|84)\d{9}\b/);
    expect(json).not.toMatch(/@/);
  });
});

// ── Lưới siết sau lượt cấy lỗi (luật 14) ────────────────────────────────────────────────────────────────
// Mỗi ca dưới đây tồn tại vì một phép cấy từng cho 0 ca đỏ trên mã cũ (xem commit): ghi rõ phép cấy để người sau biết lưới chặn gì.

describe("[NHH-SRC-RQ-11] chonGocKeThua — hoà thời điểm VÀ hoà 'có kế thừa không' ⇒ leadId NHỎ thắng, bất kể thứ tự đầu vào", () => {
  // Cấy `x.leadId < tot.leadId` → `>`: ca cũ chỉ có cặp (gốc thật vs kế thừa) nên nhánh so leadId không bao giờ được thử.
  const t = d("2026-05-01T00:00:00.000Z");
  const dong = (leadId: string, inheritedFromLeadId: string | null) => ({ leadId, attributedAt: t, inheritedFromLeadId });
  it("hai bản GỐC THẬT cùng giờ: L1 thắng dù L9 đứng trước hay sau", () => {
    expect(chonGocKeThua([dong("L9", null), dong("L1", null)])?.leadId).toBe("L1");
    expect(chonGocKeThua([dong("L1", null), dong("L9", null)])?.leadId).toBe("L1");
  });
  it("hai bản KẾ THỪA cùng giờ: L2 thắng dù đứng trước hay sau", () => {
    expect(chonGocKeThua([dong("L7", "LX"), dong("L2", "LX")])?.leadId).toBe("L2");
    expect(chonGocKeThua([dong("L2", "LX"), dong("L7", "LX")])?.leadId).toBe("L2");
  });
});

describe("[NHH-SRC-RQ-12] luật tín hiệu quảng cáo: MỖI trong sáu tín hiệu đều đủ; adsetId một mình thì KHÔNG", () => {
  // Cấy bỏ `q.gclid` khỏi `coQuangCao`: ca cũ chỉ thử fbclid, nên gclid (Google Ads) rơi âm thầm xuống đường vào mặc định.
  it.each([
    ["adId", { adId: "AD1" }],
    ["campaignId", { campaignId: "C1" }],
    ["campaignName", { campaignName: "CS1_DN" }],
    ["formId", { formId: "F1" }],
    ["fbclid", { fbclid: "fb-1" }],
    ["gclid", { gclid: "g-1" }],
  ] as const)("%s đứng MỘT mình ⇒ QUANG_CAO thắng đường vào", (_ten, phan) => {
    const r = quyNguon(tin({ duongVao: "nhap-tay", quangCao: { ...QUANG_CAO_TRONG, ...phan } }), cauHinh());
    expect(r.luat).toBe("QUANG_CAO");
    expect(r.groupCode).toBe("PAID_ADS");
  });

  it("adsetId đứng MỘT mình (đi kèm, không tự đủ) ⇒ KHÔNG phải quảng cáo", () => {
    const r = quyNguon(tin({ duongVao: "nhap-tay", quangCao: { ...QUANG_CAO_TRONG, adsetId: "AS1" } }), cauHinh());
    expect(r.luat).not.toBe("QUANG_CAO");
  });
});

describe("[DYN-QN] nguồn động: nhóm nhân sự = CẤU HÌNH, vai = ảnh chụp, Sale PH = ảnh chụp", () => {
  const NV = { employeeId: "E7", roleCodes: ["TEACHER"], vaiTuHienTai: false, employeeCode: "SR.NV.07", orgUnitId: "ou-cs1" };
  const TRUONG = [{ code: "TRUONG_HOC", referrerRequirement: "EMPLOYEE" as const }];

  it("[DYN-QN-01] NV_GIOI_THIEU ghi vào nhóm CẤU HÌNH (không phải nhóm theo vai): nhomNhanSu = nhóm admin tạo ⇒ groupCode đó; đối chứng dương: mặc định ⇒ EMPLOYEE_REFERRAL", () => {
    const moi = quyNguon(tin({ duongVao: "nhap-tay", nhanSuGioiThieu: NV }), cauHinh({}, [], "TRUONG_HOC", TRUONG));
    expect(moi).toMatchObject({ luat: "NV_GIOI_THIEU", groupCode: "TRUONG_HOC" });
    expect(quyNguon(tin({ duongVao: "nhap-tay", nhanSuGioiThieu: NV }), cauHinh()).groupCode).toBe("EMPLOYEE_REFERRAL");
  });

  it("[DYN-QN-02] cấu hình trỏ vào nhóm KHÔNG kiểu nhân sự (hoặc nhóm không có) ⇒ luật không khớp, KHÔNG ghi người giới thiệu nhân sự vào nhóm không cần người", () => {
    for (const nhomNhanSu of ["PAID_ADS", "KHONG_CO_NHOM"]) {
      const r = quyNguon(tin({ duongVao: "nhap-tay", nhanSuGioiThieu: NV }), cauHinh({}, [], nhomNhanSu));
      expect(r.luat, nhomNhanSu).not.toBe("NV_GIOI_THIEU");
      expect(r.nguoi, nhomNhanSu).toBeNull();
    }
  });

  it("[DYN-QN-03] ẢNH CHỤP nhân sự: referrerRoleCode = vai ngữ nghĩa; signals.nguoiGioiThieu = {mã NV, vai thô, đơn vị}; vai khác ⇒ cùng nhóm, khác ảnh chụp", () => {
    const gv = quyNguon(tin({ duongVao: "nhap-tay", nhanSuGioiThieu: NV }), cauHinh());
    expect(gv.anhChup.referrerRoleCode).toBe("TEACHER");
    expect(gv.anhChup.referrerSaleUserId).toBeNull();
    expect(gv.signals.nguoiGioiThieu).toEqual({ employeeCode: "SR.NV.07", roleCodes: ["TEACHER"], orgUnitId: "ou-cs1" });
    const sale = quyNguon(tin({ duongVao: "nhap-tay", nhanSuGioiThieu: { ...NV, roleCodes: ["CENTER_SALES_CSM"] } }), cauHinh());
    expect(sale.anhChup.referrerRoleCode).toBe("SALE");
    expect(sale.groupCode).toBe(gv.groupCode);
    // người giới thiệu không phải nhân sự ⇒ không có dấu vết nhân sự
    expect(quyNguon(tin({ duongVao: "facebook" }), cauHinh()).signals.nguoiGioiThieu).toBeUndefined();
  });

  it("[DYN-QN-04] PH giới thiệu: Sale phụ trách PH vào ảnh chụp; KHÔNG tìm được ⇒ referrerSaleUserId null + xemTay THIEU_SALE_PH (ở xemTay, KHÔNG ở canhBao)", () => {
    const co = quyNguon(tin({ duongVao: "nhap-tay", phuHuynhGioiThieu: { parentUserId: "U1", studentId: "S1" }, saleCuaPhuHuynh: "sale-X" }), cauHinh());
    expect(co.anhChup).toMatchObject({ referrerSaleUserId: "sale-X", referrerRoleCode: null });
    expect(co.xemTay).not.toContain("THIEU_SALE_PH");
    const khong = quyNguon(tin({ duongVao: "nhap-tay", phuHuynhGioiThieu: { parentUserId: "U1", studentId: "S1" }, saleCuaPhuHuynh: null }), cauHinh());
    expect(khong.anhChup.referrerSaleUserId).toBeNull();
    expect(khong.xemTay).toContain("THIEU_SALE_PH");
    expect(khong.canhBao).not.toContain("THIEU_SALE_PH");
    expect(khong.signals.coXemTay).toBe(true);
  });

  it("[DYN-QN-05] CHỌN RÕ PH ở ô chọn nguồn: ảnh chụp đi theo lựa chọn; thiếu Sale ⇒ THIEU_SALE_PH; nhóm admin tạo kiểu nhân sự được GIỮ + ảnh chụp vai", () => {
    const chonPh = quyNguon(
      tin({ nguonChon: { groupCode: "PARENT_REFERRAL", nguoi: { kind: "PARENT", parentUserId: "U1", studentId: null }, giaiTrinh: null, loi: null, anhChup: { ...ANH_CHUP_TRONG, referrerSaleUserId: null } } }),
      cauHinh(),
    );
    expect(chonPh.xemTay).toContain("THIEU_SALE_PH");
    const chonNv = quyNguon(
      tin({
        nguonChon: {
          groupCode: "TRUONG_HOC",
          nguoi: { kind: "EMPLOYEE", employeeId: "E7" },
          giaiTrinh: null,
          loi: null,
          anhChup: { referrerRoleCode: "MANAGER", referrerSaleUserId: null, nguoiGioiThieu: { employeeCode: "SR.NV.01", roleCodes: ["CENTER_MANAGER"], orgUnitId: null }, nguon: null },
        },
      }),
      cauHinh({}, [], "EMPLOYEE_REFERRAL", TRUONG),
    );
    expect(chonNv.groupCode).toBe("TRUONG_HOC");
    expect(chonNv.anhChup.referrerRoleCode).toBe("MANAGER");
    expect(chonNv.signals.nguoiGioiThieu).toEqual({ employeeCode: "SR.NV.01", roleCodes: ["CENTER_MANAGER"], orgUnitId: null });
  });

  it("[DYN-QN-06] FIRST-CLAIM: kế thừa SĐT mang ẢNH CHỤP của bản gốc NGUYÊN VĂN — tín hiệu PH đến sau (Sale khác) không ghi đè", () => {
    const goc: KeThuaGoc = {
      leadId: "L_CU",
      attributedAt: d("2026-06-01T02:00:00.000Z"),
      groupCode: "PARENT_REFERRAL",
      originalGroupCode: "PARENT_REFERRAL",
      nguoi: { kind: "PARENT", parentUserId: "U1", studentId: null },
      referrerMissing: false,
      otherSourceNote: null,
      anhChup: { referrerRoleCode: null, referrerSaleUserId: "sale-LUC-DO", nguoiGioiThieu: null, nguon: null },
    };
    const r = quyNguon(tin({ keThua: goc, phuHuynhGioiThieu: { parentUserId: "U1", studentId: null }, saleCuaPhuHuynh: "sale-HOM-NAY" }), cauHinh());
    expect(r.luat).toBe("KE_THUA_SDT");
    expect(r.anhChup.referrerSaleUserId).toBe("sale-LUC-DO");
    expect(r.xemTay).not.toContain("THIEU_SALE_PH");
  });

  it("[DYN-QN-07] KHAI_TAY (nhãn sale-form): nhóm theo CẤU HÌNH nhân sự, không theo vai; người nhập là người giới thiệu ⇒ vai vào ảnh chụp", () => {
    const r = quyNguon(
      tin({ duongVao: "sale-form-app", nhanKhai: "sale-form-app", nguoiNhap: { employeeId: "E9", roleCodes: ["CENTER_MANAGER"], vaiTuHienTai: false, employeeCode: "SR.NV.09", orgUnitId: null } }),
      cauHinh({}, [], "TRUONG_HOC", TRUONG),
    );
    expect(r).toMatchObject({ luat: "KHAI_TAY", groupCode: "TRUONG_HOC", nguoi: { kind: "EMPLOYEE", employeeId: "E9" }, referrerMissing: false });
    expect(r.anhChup.referrerRoleCode).toBe("MANAGER");
    expect(r.canhBao).toEqual([]);
  });
});

describe("[DYN-QN-07b] KHAI_TAY dùng CÙNG phép kiểm nhóm nhân sự với NV_GIOI_THIEU", () => {
  const NGUOI_NHAP = { employeeId: "E9", roleCodes: ["CENTER_MANAGER"], vaiTuHienTai: false, employeeCode: "SR.NV.09", orgUnitId: null };
  const sale = (ch: ReturnType<typeof cauHinh>) => quyNguon(tin({ duongVao: "sale-form-app", nhanKhai: "sale-form-app", nguoiNhap: NGUOI_NHAP }), ch);

  it("setting nhóm nhân sự trỏ sang nhóm KHÔNG kiểu nhân sự (PAID_ADS) ⇒ nhãn theo người nhập KHÔNG ghi người giới thiệu nhân sự vào nhóm Ads; đối chứng dương: cấu hình đúng ⇒ ghi", () => {
    const sai = sale(cauHinh({}, [], "PAID_ADS"));
    expect(sai.nguoi).toBeNull();
    expect(sai.groupCode).not.toBe("PAID_ADS");
    expect(sai.luat).not.toBe("KHAI_TAY");
    const dung = sale(cauHinh());
    expect(dung).toMatchObject({ luat: "KHAI_TAY", groupCode: "EMPLOYEE_REFERRAL" });
    // Nhóm đúng ⇒ luật khớp và người nhập được GHI (D12; xem [DYN-TC-*]).
    expect(dung.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E9" });
    expect(dung.canhBao).toEqual([]);
  });

  it("nhóm nhân sự cấu hình đã NGỪNG ⇒ cũng không khớp (đối xứng với picker)", () => {
    const r = sale(cauHinh({}, ["EMPLOYEE_REFERRAL"]));
    expect(r.nguoi).toBeNull();
  });
});

describe("[NHH-SRC-RQ-13] nhóm đích INACTIVE chỉ chặn claim MỚI ở luật người giới thiệu — nhân sự LẪN phụ huynh", () => {
  // Cấy bỏ cổng `nhomDung` ở NV_GIOI_THIEU: ca cũ chỉ thử nhóm tắt ở QUANG_CAO / DUONG_VAO / PAGE_MAPPING.
  it("nhóm Sale INACTIVE ⇒ luật NV_GIOI_THIEU không khớp; lựa chọn của người nhập thành touchpoint TAO_LEAD, không biến mất", () => {
    const r = quyNguon(
      tin({
        duongVao: "nhap-tay",
        nhanSuGioiThieu: { employeeId: "E7", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false },
      }),
      cauHinh({}, ["EMPLOYEE_REFERRAL"]),
    );
    expect(r.luat).toBe("UNKNOWN");
    expect(r.groupCode).toBe("UNKNOWN");
    expect(r.nguoi).toBeNull();
    const tp = r.touchpointThua.find((x) => x.kind === "TAO_LEAD");
    // Tranh chấp hoa hồng / chống TU_CLAIM cần biết AI — chỉ id, không PII.
    expect(tp?.signals.nhanSuGioiThieu).toEqual({ employeeId: "E7" });
  });

  it("nhóm Phụ huynh INACTIVE ⇒ luật PH_GIOI_THIEU không khớp", () => {
    const r = quyNguon(
      tin({ duongVao: "nhap-tay", phuHuynhGioiThieu: { parentUserId: "U1", studentId: "S1" } }),
      cauHinh({}, ["PARENT_REFERRAL"]),
    );
    expect(r.luat).toBe("UNKNOWN");
    expect(r.nguoi).toBeNull();
    expect(r.touchpointThua.find((x) => x.kind === "TAO_LEAD")?.signals.phuHuynhGioiThieu).toEqual({ parentUserId: "U1", studentId: "S1" });
  });
});

// ── D12 GIỮ NGUYÊN ở đường TẠO lead (chủ dự án chốt 09/10/2026, ĐẢO phần TU_CLAIM-lúc-tạo của đợt củng cố) ──────────────────────────────
// Lead nhập từ form nội bộ có PHIÊN ĐĂNG NHẬP (sale-form · sale-form-app · nhập khách hàng) ghi NGƯỜI GÕ làm nhân sự giới thiệu, kèm snapshot vai +
// dấu vết (mã NV · vai · đơn vị), để luôn biết nguồn từ nhân sự là AI nhập. Chặn tự nhận CHỈ còn ở đường ĐỔI nguồn của lead đã có (`doiNguonLead`
// → `phatHienGianLan`; ca DB [NHH-FRD-03*]). Cấy: thêm lại một cổng «người nhập = người hưởng ⇒ gỡ người» vào `hoanTat` ⇒ [DYN-TC-01..03] đỏ.
describe("[DYN-TC] đường tạo lead: người NHẬP là người giới thiệu ⇒ được GHI (D12), không cờ, không xem tay", () => {
  /** Người nhập: nhân sự E1. */
  const NHAP = { employeeId: "E1", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false, employeeCode: "SR.NV.01", orgUnitId: "ou-1" };
  const NGUOI_KHAC = { employeeId: "E2", roleCodes: ["CENTER_MANAGER"], vaiTuHienTai: false, employeeCode: "SR.NV.02", orgUnitId: "ou-1" };

  it("[DYN-TC-01] NV_GIOI_THIEU: nhân sự được chọn = chính người nhập ⇒ GHI người + vai + dấu vết; không cờ, không THIEU_NGUOI, không dấu vết tự nhận", () => {
    const r = quyNguon(tin({ duongVao: "nhap-tay", nguoiNhap: NHAP, nhanSuGioiThieu: NHAP }), cauHinh());
    expect(r.luat).toBe("NV_GIOI_THIEU");
    expect(r.groupCode).toBe("EMPLOYEE_REFERRAL");
    expect(r.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E1" });
    expect(r.referrerMissing).toBe(false);
    expect(r.canhBao).toEqual([]);
    expect(r.xemTay).toEqual([]);
    expect(r.anhChup.referrerRoleCode).toBe("SALE");
    expect(r.signals.nguoiGioiThieu).toEqual({ employeeCode: "SR.NV.01", roleCodes: ["CENTER_SALES_CSM"], orgUnitId: "ou-1" });
    expect(r.touchpointThua.find((t) => t.kind === "TAO_LEAD")?.signals.tuClaim).toBeUndefined();
  });

  it("[DYN-TC-01b] đối chứng: nhân sự được chọn là NGƯỜI KHÁC ⇒ ghi người khác + vai của họ (người gõ không bị ghi đè)", () => {
    const r = quyNguon(tin({ duongVao: "nhap-tay", nguoiNhap: NHAP, nhanSuGioiThieu: NGUOI_KHAC }), cauHinh());
    expect(r.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E2" });
    expect(r.referrerMissing).toBe(false);
    expect(r.canhBao).toEqual([]);
    expect(r.xemTay).toEqual([]);
    expect(r.anhChup.referrerRoleCode).toBe("MANAGER");
  });

  it("[DYN-TC-02] CHON_NGUON (ô chọn nguồn): nhân sự được chọn = chính người nhập ⇒ GHI; người khác ⇒ ghi người khác", () => {
    const chon = (n: typeof NHAP) => ({
      groupCode: "EMPLOYEE_REFERRAL",
      nguoi: { kind: "EMPLOYEE" as const, employeeId: n.employeeId },
      giaiTrinh: null,
      loi: null,
      anhChup: { referrerRoleCode: "SALE" as const, referrerSaleUserId: null, nguoiGioiThieu: { employeeCode: n.employeeCode, roleCodes: [...n.roleCodes], orgUnitId: n.orgUnitId }, nguon: null },
    });
    const tu = quyNguon(tin({ duongVao: "nhap-tay", nguoiNhap: NHAP, nguonChon: chon(NHAP) }), cauHinh());
    expect(tu).toMatchObject({ luat: "CHON_NGUON", groupCode: "EMPLOYEE_REFERRAL", nguoi: { kind: "EMPLOYEE", employeeId: "E1" }, referrerMissing: false, canhBao: [] });
    expect(tu.anhChup).toMatchObject({ referrerRoleCode: "SALE", nguoiGioiThieu: { employeeCode: "SR.NV.01" } });
    const khac = quyNguon(tin({ duongVao: "nhap-tay", nguoiNhap: NHAP, nguonChon: chon(NGUOI_KHAC) }), cauHinh());
    expect(khac).toMatchObject({ nguoi: { kind: "EMPLOYEE", employeeId: "E2" }, referrerMissing: false, canhBao: [] });
  });

  it("[DYN-TC-03] PH giới thiệu mà Sale phụ trách PH LÀ người nhập ⇒ Sale đó VẪN được ghi (Sale nhập khách do phụ huynh của mình giới thiệu là việc bình thường); không cờ", () => {
    const ph = { parentUserId: "P1", studentId: null };
    const tu = quyNguon(tin({ duongVao: "nhap-tay", nguoiNhap: NHAP, phuHuynhGioiThieu: ph, saleCuaPhuHuynh: "U1" }), cauHinh());
    expect(tu.luat).toBe("PH_GIOI_THIEU");
    expect(tu.nguoi).toEqual({ kind: "PARENT", parentUserId: "P1", studentId: null });
    expect(tu.anhChup.referrerSaleUserId).toBe("U1");
    expect(tu.canhBao).toEqual([]);
    expect(tu.xemTay).toEqual([]);
    expect(tu.touchpointThua.find((t) => t.kind === "TAO_LEAD")?.signals.tuClaim).toBeUndefined();
    // thiếu Sale PH vẫn là cờ xem tay (cổng THIEU_SALE_PH không đổi)
    const thieu = quyNguon(tin({ duongVao: "nhap-tay", nguoiNhap: NHAP, phuHuynhGioiThieu: ph, saleCuaPhuHuynh: null }), cauHinh());
    expect(thieu.xemTay).toEqual(["THIEU_SALE_PH"]);
  });

  it("[DYN-TC-04] chủ NGUỒN tự nhập lead của chính nguồn mình là việc BÌNH THƯỜNG: bản chụp GIỮ chủ, KHÔNG cờ, KHÔNG xem tay; chủ khác ⇒ cũng chụp chủ (đối chứng dương)", () => {
    const TRUONG = [{ code: "TRUONG_HOC", referrerRequirement: "NONE" as const }];
    const dung = (chu: string | null) => cauHinh({}, [], "EMPLOYEE_REFERRAL", TRUONG, { TRUONG_HOC: { chuNhanVienId: chu, cuaSoRiengNgay: 45 } });
    const nguonChon = { groupCode: "TRUONG_HOC", nguoi: null, giaiTrinh: null, loi: null, anhChup: ANH_CHUP_TRONG };
    const tu = quyNguon(tin({ duongVao: "nhap-tay", nguoiNhap: NHAP, nguonChon }), dung("E1"));
    expect(tu.signals.nguon).toEqual({ cuaSoNgay: 45, chuNhanVienId: "E1" });
    expect(tu.canhBao).toEqual([]);
    expect(tu.xemTay).toEqual([]);
    const khac = quyNguon(tin({ duongVao: "nhap-tay", nguoiNhap: NHAP, nguonChon }), dung("E5"));
    expect(khac.signals.nguon).toEqual({ cuaSoNgay: 45, chuNhanVienId: "E5" });
    expect(khac.canhBao).toEqual([]);
  });

  it("[DYN-TC-05] KẾ THỪA: nguyên văn lời khai của lần trước, người nhập hôm nay không đổi gì (kể cả trùng người giới thiệu cũ)", () => {
    const goc = {
      leadId: "L0",
      attributedAt: d("2026-09-01T00:00:00.000Z"),
      groupCode: "EMPLOYEE_REFERRAL",
      originalGroupCode: "EMPLOYEE_REFERRAL",
      nguoi: { kind: "EMPLOYEE" as const, employeeId: "E1" },
      referrerMissing: false,
      otherSourceNote: null,
      anhChup: { referrerRoleCode: "SALE" as const, referrerSaleUserId: null, nguoiGioiThieu: null, nguon: null },
    };
    const r = quyNguon(tin({ keThua: goc, nguoiNhap: NHAP }), cauHinh());
    expect(r.luat).toBe("KE_THUA_SDT");
    expect(r.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E1" });
    expect(r.canhBao).toEqual([]);
  });

  it("[DYN-TC-06] không có người nhập (webhook máy) ⇒ nhân sự được chọn vẫn ghi", () => {
    const r = quyNguon(tin({ duongVao: "nhap-tay", nguoiNhap: null, nhanSuGioiThieu: NHAP }), cauHinh());
    expect(r.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E1" });
    expect(r.canhBao).toEqual([]);
  });

  it("[DYN-TC-08] người được nhận diện qua MÃ NV trên phiếu công khai (sale-form, không phiên): mã là của NGƯỜI GIỚI THIỆU ⇒ ghi người đó", () => {
    const r = quyNguon(tin({ duongVao: "sale-form", nhanKhai: "sale-form", nguoiNhap: NHAP }), cauHinh());
    expect(r.luat).toBe("KHAI_TAY");
    expect(r.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E1" });
    expect(r.canhBao).toEqual([]);
    expect(r.referrerMissing).toBe(false);
  });

  it("[DYN-TC-09] nhãn máy 'sale-form-app' (đường /nhap-khach-hang) KHÔNG có người nhập ⇒ không đoán người: nhóm OTHER + giải trình + xem tay (đối chứng âm của D12)", () => {
    const r = quyNguon(tin({ duongVao: "sale-form-app", nhanKhai: "sale-form-app", nguoiNhap: null }), cauHinh());
    expect(r.nguoi).toBeNull();
    expect(r.groupCode).toBe("OTHER");
    expect(r.xemTay).toContain("MA_NV_KHONG_GIAI");
  });
});

describe("[DYN-NC] bản chụp `signals.nguon` được GHI ở mọi attribution mới và KẾ THỪA nguyên văn", () => {
  const TRUONG = [{ code: "TRUONG_HOC", referrerRequirement: "NONE" as const }];
  const nguonChon = { groupCode: "TRUONG_HOC", nguoi: null, giaiTrinh: null, loi: null, anhChup: ANH_CHUP_TRONG };

  it("[DYN-NC-04] nguồn có cửa sổ riêng + chủ ⇒ chụp đúng hai giá trị; nguồn KHÔNG có cửa sổ riêng ⇒ chụp setting chung (90), không NULL", () => {
    const r = quyNguon(tin({ duongVao: "nhap-tay", nguonChon }), cauHinh({}, [], "EMPLOYEE_REFERRAL", TRUONG, { TRUONG_HOC: { cuaSoRiengNgay: 30, chuNhanVienId: "E5" } }));
    expect(r.signals.nguon).toEqual({ cuaSoNgay: 30, chuNhanVienId: "E5" });
    expect(r.anhChup.nguon).toEqual({ cuaSoNgay: 30, chuNhanVienId: "E5" });
    const chung = quyNguon(tin({ duongVao: "nhap-tay", nguonChon }), cauHinh({}, [], "EMPLOYEE_REFERRAL", TRUONG));
    expect(chung.signals.nguon).toEqual({ cuaSoNgay: 90, chuNhanVienId: null });
  });

  it("[DYN-NC-05] mọi luật đều chụp (UNKNOWN cũng có `signals.nguon`) — không để lọt đường nào không có bản chụp", () => {
    const r = quyNguon(tin(), cauHinh({ autoAttribution: false }));
    expect(r.luat).toBe("UNKNOWN");
    expect(r.signals.nguon).toEqual({ cuaSoNgay: 90, chuNhanVienId: null });
  });

  it("[DYN-NC-06] KẾ THỪA: hàng gốc ĐÃ có bản chụp ⇒ chép NGUYÊN VĂN, bất kể nguồn sống đã đổi chủ/cửa sổ; hàng gốc CHƯA có bản chụp ⇒ chụp từ nhóm LÚC NÀY", () => {
    const gocCoChup = {
      leadId: "L0",
      attributedAt: d("2026-09-01T00:00:00.000Z"),
      groupCode: "TRUONG_HOC",
      originalGroupCode: "TRUONG_HOC",
      nguoi: null,
      referrerMissing: false,
      otherSourceNote: null,
      anhChup: { ...ANH_CHUP_TRONG, nguon: { cuaSoNgay: 60, chuNhanVienId: "E-LUC-DO" } },
    };
    const ch = cauHinh({}, [], "EMPLOYEE_REFERRAL", TRUONG, { TRUONG_HOC: { cuaSoRiengNgay: 7, chuNhanVienId: "E-HOM-NAY" } });
    expect(quyNguon(tin({ keThua: gocCoChup }), ch).signals.nguon).toEqual({ cuaSoNgay: 60, chuNhanVienId: "E-LUC-DO" });
    const gocChuaChup = { ...gocCoChup, anhChup: { ...ANH_CHUP_TRONG, nguon: null } };
    expect(quyNguon(tin({ keThua: gocChuaChup }), ch).signals.nguon).toEqual({ cuaSoNgay: 7, chuNhanVienId: "E-HOM-NAY" });
  });
});
