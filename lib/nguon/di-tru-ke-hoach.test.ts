/**
 * Ca [DTG-*] — KẾ HOẠCH BACKFILL lead cũ (hướng E, 11/10/2026). THUẦN, ngày TUYỆT ĐỐI (luật 19).
 *
 * Mốc: lead tạo TRƯỚC khi bật `nguon.enabled` không có `LeadAttribution`; engine coi chúng là `UNKNOWN` và `doiNguonLead` TỪ CHỐI chúng («Lead chưa có quy nguồn»), nên người
 * duyệt không có đường sửa. Backfill phải GHI cả dòng xem tay lẫn UNKNOWN. Tiền phải tất định + kiểm toán được + phê duyệt được:
 * số duyệt (N, M) và digest SHA-256 của kế hoạch chặn mọi thay đổi giữa lúc duyệt và lúc ghi.
 *
 *   [DTG-01]   phân loại GHI: AUTO / MANUAL_REVIEW / UNKNOWN / INVALID — rời nhau, AUTO + REVIEW + UNKNOWN = N (kể cả lead trùng SĐT)
 *   [DTG-01b]  dòng biên: UNKNOWN + xem tay (AFF_CHUA_PHAN_LOAI) là REVIEW; nhãn trống là UNKNOWN; trùng SĐT KHÔNG làm rơi dòng khỏi REVIEW
 *   [DTG-02]   INVALID > 0 ⇒ từ chối ghi (cổng «INVALID = 0 trước khi bật nguon.enabled» đặt ở chính lệnh ghi)
 *   [DTG-03]   `--expect` / `--expect-review` lệch ⇒ ABORT; khớp ⇒ ok
 *   [DTG-04]   digest: tất định (không phụ thuộc thứ tự đầu vào) và NHẠY với từng thứ làm đổi tiền (nhóm · người · vai · chủ nguồn · cửa sổ)
 *   [DTG-05]   nhãn #10/#14/#22 SAU mốc ⇒ ghi OTHER + giải trình + coXemTay (KHÔNG auto-map sang nguồn có hoa hồng)
 *   [DTG-06]   dữ liệu ghi KHÔNG có `Lead.source`/cột nào ngoài nguồn; `referrerKind` null khi không có người (CHECK nguoi_gioi_thieu_chk)
 *   [DTG-07]   `signals.nguon` (bản chụp chủ + cửa sổ) CÓ MẶT ở mọi dòng — thiếu nó engine rơi về chủ/cửa sổ SỐNG (đổi lịch sử tiền)
 *   [DTG-07b]  nhóm chưa có chủ ⇒ bản chụp `chuNhanVienId = null` ("không có chủ lúc ghi") ⇒ kế hoạch LIỆT KÊ nhóm đó; nhóm thiếu trong danh mục ⇒ chặn
 *   [DTG-08]   nguồn chưa có chủ ⇒ lệnh ghi MẶC ĐỊNH TỪ CHỐI (NGUON_CHUA_CO_CHU) trừ khi chấp nhận ĐÚNG danh sách; thừa/thiếu/sai mã đều từ chối; kế hoạch không thiếu chủ ⇒ không đòi gì; thứ tự cổng: digest đứng trước
 */
import { describe, expect, it } from "vitest";
import { anhXaNhanCu, chuanHoaNhanNguon, type HangDiTru } from "./anh-xa-nhan-cu";
import { NHOM_NHAN_SU_GOC, VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import { dungDuLieuGhiDiTru } from "./di-tru-du-lieu";
import { dungKeHoachDiTru, kiemCongGhi, phanLoaiGhi, type ChiTietLeadDiTru, type KeHoachDiTru, type NhomDiTru } from "./di-tru-ke-hoach";

/** Chấp nhận ĐÚNG các nguồn thiếu chủ của kế hoạch — để ca KHÔNG nhắm vào cổng nguồn-thiếu-chủ vẫn đi qua nó. */
const chap = (k: KeHoachDiTru): string[] => k.nhomChuNull.map((g) => g.code);

const TRUOC = new Date("2026-09-15T03:00:00.000Z");
const SAU_MOC = new Date("2026-10-08T03:00:00.000Z");

const NHOM: NhomDiTru[] = [
  { id: "g-ads", code: "PAID_ADS", ownerEmployeeId: "E_MKT", attributionWindowDays: null },
  { id: "g-nv", code: "EMPLOYEE_REFERRAL", ownerEmployeeId: null, attributionWindowDays: 60 },
  { id: "g-org", code: "CENTER_ORGANIC", ownerEmployeeId: null, attributionWindowDays: null },
  { id: "g-ph", code: "PARENT_REFERRAL", ownerEmployeeId: null, attributionWindowDays: null },
  { id: "g-walk", code: "WALK_IN", ownerEmployeeId: null, attributionWindowDays: null },
  { id: "g-other", code: "OTHER", ownerEmployeeId: null, attributionWindowDays: null },
  { id: "g-unk", code: "UNKNOWN", ownerEmployeeId: null, attributionWindowDays: null },
];

function hang(leadId: string, nhan: string | null, o: { luc?: Date; affiliate?: { ton: boolean; loai: null } | null } = {}): HangDiTru {
  const luc = o.luc ?? TRUOC;
  return {
    leadId,
    kq: anhXaNhanCu({ nhan, createdAt: luc, affiliate: o.affiliate ?? null, nguoiNhap: null, maNvTrongNote: null }, VAI_SANG_NGUON_MAC_DINH, NHOM_NHAN_SU_GOC),
    nhanChuan: chuanHoaNhanNguon(nhan),
    createdAt: luc,
  };
}
const invalid = (leadId: string): HangDiTru => ({ leadId, kq: { loai: "INVALID", nhanChuan: "nhan la" }, nhanChuan: "nhan la", createdAt: TRUOC });

const chiTiet = (hs: readonly HangDiTru[]): Map<string, ChiTietLeadDiTru> =>
  new Map(hs.map((h) => [h.leadId, { conversionEntry: h.nhanChuan, nguoiGioiThieu: null }]));

const ke = (hs: readonly HangDiTru[], o: { nhom?: NhomDiTru[]; cuaSo?: number | null; ct?: Map<string, ChiTietLeadDiTru> } = {}) =>
  dungKeHoachDiTru({ hang: hs, chiTiet: o.ct ?? chiTiet(hs), nhom: o.nhom ?? NHOM, cuaSoMacDinhNgay: o.cuaSo === undefined ? 90 : o.cuaSo });

describe("[DTG-01] phanLoaiGhi — bốn loại rời nhau", () => {
  it("nhãn sạch (Ads) ⇒ AUTO; nhãn rỗng ⇒ UNKNOWN; nhãn cần người mà không có người ⇒ MANUAL_REVIEW; nhãn lạ ⇒ INVALID", () => {
    expect(phanLoaiGhi(hang("a", "Ads").kq)).toBe("AUTO");
    expect(phanLoaiGhi(hang("b", null).kq)).toBe("UNKNOWN");
    expect(phanLoaiGhi(hang("c", "Quản Lý Trung Tâm").kq)).toBe("MANUAL_REVIEW");
    expect(phanLoaiGhi(invalid("d").kq)).toBe("INVALID");
  });

  it("AUTO + REVIEW + UNKNOWN = N (số GHI); INVALID đếm RIÊNG và không nằm trong N", () => {
    const hs = [hang("1", "Ads"), hang("2", "Ads"), hang("3", null), hang("4", "Quản Lý Trung Tâm"), hang("5", "Sale tự kiếm"), hang("6", "Organic"), invalid("7")];
    const k = ke(hs);
    expect(k.tong).toEqual({ auto: 3, review: 2, unknown: 1, invalid: 1, ghi: 6 });
    expect(k.tong.auto + k.tong.review + k.tong.unknown).toBe(k.tong.ghi);
    expect(k.dong).toHaveLength(6);
    expect(k.invalid).toEqual([{ leadId: "7", nhanChuan: "nhan la" }]);
  });
});

describe("[DTG-01b] dòng biên", () => {
  it("UNKNOWN kèm xem tay (aff chưa phân loại) là MANUAL_REVIEW chứ không UNKNOWN trơn — người duyệt phải thấy lý do", () => {
    const h = hang("1", "quatang", { affiliate: { ton: true, loai: null } });
    expect(h.kq).toMatchObject({ loai: "UNKNOWN", xemTay: ["AFF_CHUA_PHAN_LOAI"] });
    expect(phanLoaiGhi(h.kq)).toBe("MANUAL_REVIEW");
  });

  it("lead TRÙNG SĐT vẫn ghi theo loại của chính nó: duplicate + THIEU_NGUOI ⇒ vẫn MANUAL_REVIEW (không rơi khỏi số --expect-review)", () => {
    // `tomTatDiTru` ưu tiên Duplicate hơn mọi lý do xem tay (trừ NHAN_CHOT_THEO_PHIEU) ⇒ dòng này KHÔNG được đếm là manualReview ở báo cáo sáu nhóm,
    // nhưng nó VẪN được ghi với coXemTay = true. Số người duyệt ký phải là số THỰC SỰ vào review.
    const h = hang("1", "Quản Lý Trung Tâm");
    const k = ke([h]);
    expect(k.tong.review).toBe(1);
    expect(k.dong[0]).toMatchObject({ loai: "MANUAL_REVIEW", xemTay: ["THIEU_NGUOI"], referrerMissing: true });
  });
});

describe("[DTG-02] INVALID > 0 ⇒ KHÔNG ghi, không ghi một phần", () => {
  it("có INVALID ⇒ từ chối với mã INVALID, kể cả khi mọi số duyệt khớp", () => {
    const k = ke([hang("1", "Ads"), invalid("2")]);
    const r = kiemCongGhi(k, { soDuyet: k.tong.ghi, soDuyetReview: k.tong.review, sha: k.sha, chapNhanNguonChuaCoChu: chap(k) });
    expect(r).toMatchObject({ ok: false, ma: "INVALID" });
    if (!r.ok) expect(r.lyDo).toMatch(/1/);
  });
  it("đối chứng dương: không INVALID + số khớp ⇒ ok", () => {
    const k = ke([hang("1", "Ads"), hang("2", null)]);
    expect(kiemCongGhi(k, { soDuyet: 2, soDuyetReview: 0, sha: k.sha, chapNhanNguonChuaCoChu: chap(k) })).toEqual({ ok: true });
  });
});

describe("[DTG-03] số đã duyệt lệch ⇒ ABORT trước phép ghi đầu tiên", () => {
  const k = ke([hang("1", "Ads"), hang("2", "Quản Lý Trung Tâm"), hang("3", null)]);
  it("expect lệch ⇒ LECH_TONG; expect-review lệch ⇒ LECH_REVIEW", () => {
    expect(kiemCongGhi(k, { soDuyet: 2, soDuyetReview: 1, sha: k.sha, chapNhanNguonChuaCoChu: chap(k) })).toMatchObject({ ok: false, ma: "LECH_TONG" });
    expect(kiemCongGhi(k, { soDuyet: 3, soDuyetReview: 0, sha: k.sha, chapNhanNguonChuaCoChu: chap(k) })).toMatchObject({ ok: false, ma: "LECH_REVIEW" });
    expect(kiemCongGhi(k, { soDuyet: 3, soDuyetReview: 1, sha: k.sha, chapNhanNguonChuaCoChu: chap(k) })).toEqual({ ok: true });
  });
  it("digest lệch ⇒ LECH_SHA (kế hoạch đổi giữa lúc duyệt và lúc ghi)", () => {
    expect(kiemCongGhi(k, { soDuyet: 3, soDuyetReview: 1, sha: "0".repeat(64), chapNhanNguonChuaCoChu: chap(k) })).toMatchObject({ ok: false, ma: "LECH_SHA" });
  });
  it("số duyệt đúng nhưng nhóm thiếu trong danh mục ⇒ THIEU_NHOM (không ghi dòng mồ côi)", () => {
    const thieu = ke([hang("1", "Ads")], { nhom: NHOM.filter((g) => g.code !== "PAID_ADS") });
    expect(thieu.thieuNhom).toEqual(["PAID_ADS"]);
    expect(kiemCongGhi(thieu, { soDuyet: 1, soDuyetReview: 0, sha: thieu.sha, chapNhanNguonChuaCoChu: chap(thieu) })).toMatchObject({ ok: false, ma: "THIEU_NHOM" });
  });
});

describe("[DTG-04] digest kế hoạch", () => {
  const hs = [hang("1", "Ads"), hang("2", "Quản Lý Trung Tâm"), hang("3", null), hang("4", "Organic")];
  const goc = ke(hs).sha;

  it("là SHA-256 hex 64 ký tự, tất định, KHÔNG phụ thuộc thứ tự đầu vào", () => {
    expect(goc).toMatch(/^[0-9a-f]{64}$/);
    expect(ke([...hs].reverse()).sha).toBe(goc);
    expect(ke(hs).sha).toBe(goc);
  });
  it("NHẠY: đổi nhóm của một lead / thêm một lead / bỏ một lead ⇒ khác", () => {
    expect(ke([hang("1", "Organic"), ...hs.slice(1)]).sha).not.toBe(goc);
    expect(ke([...hs, hang("5", "Ads")]).sha).not.toBe(goc);
    expect(ke(hs.slice(1)).sha).not.toBe(goc);
  });
  it("NHẠY với thứ quyết định tiền: chủ nguồn · cửa sổ riêng · cửa sổ mặc định đổi giữa lúc duyệt và lúc ghi ⇒ khác", () => {
    const doiChu = NHOM.map((g) => (g.code === "PAID_ADS" ? { ...g, ownerEmployeeId: "E_KHAC" } : g));
    const doiCuaSo = NHOM.map((g) => (g.code === "EMPLOYEE_REFERRAL" ? { ...g, attributionWindowDays: 30 } : g));
    expect(ke(hs, { nhom: doiChu }).sha).not.toBe(goc);
    expect(ke(hs, { nhom: doiCuaSo }).sha).not.toBe(goc);
    expect(ke(hs, { cuaSo: 120 }).sha).not.toBe(goc);
  });
  it("KHÔNG nhạy với thứ không đổi tiền: nhóm KHÔNG được dùng đổi chủ ⇒ sha giữ nguyên (không báo động giả)", () => {
    const doiChuNhomKhongDung = NHOM.map((g) => (g.code === "WALK_IN" ? { ...g, ownerEmployeeId: "E_AI_DO" } : g));
    expect(ke(hs, { nhom: doiChuNhomKhongDung }).sha).toBe(goc);
  });
});

describe("[DTG-05] nhãn #10/#14/#22 SAU mốc 06/10 ⇒ OTHER + giải trình + coXemTay (không auto-map)", () => {
  it("«Khác» sau mốc ⇒ OTHER, giải trình ≥ 10 ký tự, xemTay NHAN_CHOT_THEO_PHIEU, loại MANUAL_REVIEW", () => {
    for (const nhan of ["Khác", "Nguồn khác", "Nhập tay"]) {
      const h = hang("x", nhan, { luc: SAU_MOC });
      const k = ke([h]);
      const d = k.dong[0]!;
      expect(d.groupCode, nhan).toBe("OTHER");
      expect(d.loai, nhan).toBe("MANUAL_REVIEW");
      expect(d.xemTay, nhan).toEqual(["NHAN_CHOT_THEO_PHIEU"]);
      expect((d.otherSourceNote ?? "").length, nhan).toBeGreaterThanOrEqual(10);
      expect(d.referrerEmployeeId, nhan).toBeNull();
      const w = dungDuLieuGhiDiTru(d, { cuaSoNgay: 90, chuNhanVienId: null });
      expect((w.duLieu.signals as { coXemTay?: boolean }).coXemTay, nhan).toBe(true);
    }
  });
  it("đối chứng dương: CÙNG nhãn nhưng TRƯỚC mốc ⇒ đích đã chốt (không phải OTHER)", () => {
    const k = ke([hang("x", "Khác", { luc: TRUOC })]);
    expect(k.dong[0]!.groupCode).toBe("EMPLOYEE_REFERRAL");
    expect(k.dong[0]!.xemTay).toEqual(["THIEU_NGUOI"]);
  });
});

describe("[DTG-06] dữ liệu ghi: chỉ nguồn, không động tới Lead.source", () => {
  const h = hang("1", "Ads");
  const d = ke([h]).dong[0]!;
  const w = dungDuLieuGhiDiTru(d, { cuaSoNgay: 90, chuNhanVienId: "E_MKT" });

  it("DuLieuNguon không có cột `source`; conversionEntry = ảnh chụp đường vào; attributedAt = Lead.createdAt; matchedRule = DI_TRU", () => {
    expect(Object.keys(w.duLieu)).not.toContain("source");
    expect(w.duLieu.conversionEntry).toBe("ads");
    expect(w.duLieu.attributedAt).toEqual(TRUOC);
    expect(w.duLieu.matchedRule).toBe("DI_TRU");
    expect(w.duLieu.groupId).toBe("g-ads");
    expect(w.duLieu.originalGroupId).toBe("g-ads");
    expect(w.duLieu.inheritedFromLeadId).toBeNull();
  });
  it("không có người ⇒ referrerKind NULL và mọi cột người NULL (CHECK nguoi_gioi_thieu_chk)", () => {
    const c = ke([hang("2", "Quản Lý Trung Tâm")]).dong[0]!;
    const r = dungDuLieuGhiDiTru(c, { cuaSoNgay: 60, chuNhanVienId: null }).duLieu;
    expect(r.referrerKind).toBeNull();
    expect(r.referrerEmployeeId).toBeNull();
    expect(r.referrerMissing).toBe(true);
    expect(r.referrerRoleCode).toBe("MANAGER"); // vai ngữ nghĩa của nhãn («Quản Lý») — vẫn là snapshot, không phải người
  });
  it("có người ⇒ referrerKind EMPLOYEE + đúng một cột nhân viên + dấu vết nguoiGioiThieu (mã · vai · đơn vị, không PII)", () => {
    const base = ke([hang("3", "Ads")]).dong[0]!;
    const coNguoi = { ...base, referrerEmployeeId: "E_SALE", referrerRoleCode: "SALE" as const, nguoiGioiThieu: { employeeCode: "SR.NV.006", roleCodes: ["CENTER_SALES_CSM"], orgUnitId: "OU1" } };
    const r = dungDuLieuGhiDiTru(coNguoi, { cuaSoNgay: 60, chuNhanVienId: null }).duLieu;
    expect(r.referrerKind).toBe("EMPLOYEE");
    expect(r.referrerEmployeeId).toBe("E_SALE");
    expect(r.referrerParentUserId).toBeNull();
    expect((r.signals as { nguoiGioiThieu: unknown }).nguoiGioiThieu).toEqual({ employeeCode: "SR.NV.006", roleCodes: ["CENTER_SALES_CSM"], orgUnitId: "OU1" });
  });
  it("một touchpoint TAO_LEAD tại Lead.createdAt, signals.diTru = true, không PII", () => {
    expect(w.touchpoint).toMatchObject({ kind: "TAO_LEAD", occurredAt: TRUOC, claimedGroupId: "g-ads", conversionEntry: "ads" });
    expect(w.touchpoint.signals).toMatchObject({ diTru: true, nhanGoc: "ads" });
  });
  it("cách xác định: SYSTEM_IMPORT; nhóm UNKNOWN ⇒ UNKNOWN", () => {
    expect(w.duLieu.identificationMethod).toBe("SYSTEM_IMPORT");
    const u = ke([hang("4", null)]).dong[0]!;
    expect(dungDuLieuGhiDiTru(u, { cuaSoNgay: 90, chuNhanVienId: null }).duLieu.identificationMethod).toBe("UNKNOWN");
  });
});

describe("[DTG-07] signals.nguon — bản chụp chủ + cửa sổ có mặt ở MỌI dòng", () => {
  it("signals.nguon = { cuaSoNgay, chuNhanVienId } đúng bản đưa vào (kể cả chủ null); signals mang nhanGoc · stt · diTru", () => {
    const d = ke([hang("1", "Ads")]).dong[0]!;
    const w = dungDuLieuGhiDiTru(d, { cuaSoNgay: 45, chuNhanVienId: "E_MKT" });
    const s = w.duLieu.signals as Record<string, unknown>;
    expect(s.nguon).toEqual({ cuaSoNgay: 45, chuNhanVienId: "E_MKT" });
    expect(s).toMatchObject({ nhanGoc: "ads", diTru: true });
    expect(typeof s.stt).toBe("number");
    const khongChu = dungDuLieuGhiDiTru(d, { cuaSoNgay: 90, chuNhanVienId: null }).duLieu.signals as Record<string, unknown>;
    expect(khongChu.nguon).toEqual({ cuaSoNgay: 90, chuNhanVienId: null });
  });
  it("dòng KHÔNG xem tay ⇒ không có coXemTay/xemTay trong signals (đối chứng dương của DTG-05)", () => {
    const d = ke([hang("1", "Ads")]).dong[0]!;
    const s = dungDuLieuGhiDiTru(d, { cuaSoNgay: 90, chuNhanVienId: null }).duLieu.signals as Record<string, unknown>;
    expect(s.coXemTay).toBeUndefined();
    expect(s.xemTay).toBeUndefined();
  });
});

describe("[DTG-07b] chủ nguồn vắng lúc ghi (bản chụp null, theo luật lịch sử) ⇒ phải được liệt kê trước khi ghi", () => {
  it("kế hoạch liệt kê nhóm ĐƯỢC DÙNG mà chưa có chủ (nhomChuNull); nhóm có chủ không bị liệt kê", () => {
    const k = ke([hang("1", "Ads"), hang("2", "Organic"), hang("3", null)]);
    expect(k.nhomChuNull.map((g) => g.code).sort()).toEqual(["CENTER_ORGANIC", "UNKNOWN"]);
    expect(k.theoNhom.find((g) => g.code === "PAID_ADS")).toMatchObject({ chuNhanVienId: "E_MKT", soLead: 1 });
  });
  it("nhóm KHÔNG có lead nào trong kế hoạch thì không bị cảnh báo", () => {
    const k = ke([hang("1", "Ads")]);
    expect(k.nhomChuNull).toEqual([]);
  });
});

describe("[DTG-08] cổng NGUỒN CHƯA CÓ CHỦ — mặc định từ chối, chấp nhận phải gõ ĐÚNG tên từng nguồn", () => {
  // Ads (có chủ E_MKT) + Quản Lý (EMPLOYEE_REFERRAL, chưa chủ) + nhãn rỗng (UNKNOWN, chưa chủ) ⇒ nhomChuNull = [EMPLOYEE_REFERRAL, UNKNOWN]
  const k = ke([hang("1", "Ads"), hang("2", "Quản Lý Trung Tâm"), hang("3", null)]);
  const duyet = (chapNhanNguonChuaCoChu: readonly string[], sha = k.sha) => kiemCongGhi(k, { soDuyet: 3, soDuyetReview: 1, sha, chapNhanNguonChuaCoChu });

  it("tiền đề: kế hoạch có đúng hai nguồn thiếu chủ (PAID_ADS có chủ thì KHÔNG nằm trong đó)", () => {
    expect(k.nhomChuNull.map((g) => g.code).sort()).toEqual(["EMPLOYEE_REFERRAL", "UNKNOWN"]);
  });
  it("không khai gì ⇒ NGUON_CHUA_CO_CHU, lý do NÓI danh sách phải khai và đúng cờ", () => {
    const r = duyet([]);
    expect(r).toMatchObject({ ok: false, ma: "NGUON_CHUA_CO_CHU" });
    if (!r.ok) {
      expect(r.lyDo).toContain("--chap-nhan-nguon-chua-co-chu=EMPLOYEE_REFERRAL,UNKNOWN");
      expect(r.lyDo).toMatch(/KHÔNG ghi gì/);
    }
  });
  it("khai đúng tập (mọi thứ tự, trùng lặp không đổi nghĩa) ⇒ ok", () => {
    expect(duyet(["EMPLOYEE_REFERRAL", "UNKNOWN"])).toEqual({ ok: true });
    expect(duyet(["UNKNOWN", "EMPLOYEE_REFERRAL"])).toEqual({ ok: true });
    expect(duyet(["UNKNOWN", "EMPLOYEE_REFERRAL", "UNKNOWN"])).toEqual({ ok: true });
  });
  it("khai THIẾU một nguồn ⇒ từ chối (không có cờ «đồng ý hết»)", () => {
    expect(duyet(["UNKNOWN"])).toMatchObject({ ok: false, ma: "NGUON_CHUA_CO_CHU" });
    expect(duyet(["EMPLOYEE_REFERRAL"])).toMatchObject({ ok: false, ma: "NGUON_CHUA_CO_CHU" });
  });
  it("khai THỪA một nguồn (đã có chủ / gõ sai mã) ⇒ từ chối — sự chấp nhận gắn với đúng kế hoạch đã đọc", () => {
    expect(duyet(["EMPLOYEE_REFERRAL", "UNKNOWN", "PAID_ADS"])).toMatchObject({ ok: false, ma: "NGUON_CHUA_CO_CHU" });
    expect(duyet(["EMPLOYEE_REFERAL", "UNKNOWN"])).toMatchObject({ ok: false, ma: "NGUON_CHUA_CO_CHU" });
  });
  it("ĐỐI CHỨNG DƯƠNG: kế hoạch KHÔNG có nguồn thiếu chủ ⇒ không đòi gì (khai [] ok); khai mã bất kỳ ⇒ từ chối", () => {
    const du = ke([hang("1", "Ads")]);
    expect(du.nhomChuNull).toEqual([]);
    expect(kiemCongGhi(du, { soDuyet: 1, soDuyetReview: 0, sha: du.sha, chapNhanNguonChuaCoChu: [] })).toEqual({ ok: true });
    expect(kiemCongGhi(du, { soDuyet: 1, soDuyetReview: 0, sha: du.sha, chapNhanNguonChuaCoChu: ["UNKNOWN"] })).toMatchObject({ ok: false, ma: "NGUON_CHUA_CO_CHU" });
  });
  it("khai chủ nguồn SAU lượt chạy thử đổi digest (G-line mang chủ) ⇒ LECH_SHA đến TRƯỚC cổng này", () => {
    const sauKhaiChu = ke([hang("1", "Ads"), hang("2", "Quản Lý Trung Tâm"), hang("3", null)], {
      nhom: NHOM.map((g) => (g.code === "EMPLOYEE_REFERRAL" ? { ...g, ownerEmployeeId: "E_NV" } : g)),
    });
    expect(sauKhaiChu.sha).not.toBe(k.sha);
    // người chạy cầm digest CŨ + danh sách CŨ ⇒ digest lệch, không phải «nguồn chưa chủ»
    expect(kiemCongGhi(sauKhaiChu, { soDuyet: 3, soDuyetReview: 1, sha: k.sha, chapNhanNguonChuaCoChu: ["EMPLOYEE_REFERRAL", "UNKNOWN"] })).toMatchObject({ ok: false, ma: "LECH_SHA" });
    // …và nếu cầm digest MỚI nhưng vẫn khai danh sách cũ ⇒ danh sách lệch (nguồn đã có chủ không cần chấp nhận)
    expect(kiemCongGhi(sauKhaiChu, { soDuyet: 3, soDuyetReview: 1, sha: sauKhaiChu.sha, chapNhanNguonChuaCoChu: ["EMPLOYEE_REFERRAL", "UNKNOWN"] })).toMatchObject({ ok: false, ma: "NGUON_CHUA_CO_CHU" });
    expect(kiemCongGhi(sauKhaiChu, { soDuyet: 3, soDuyetReview: 1, sha: sauKhaiChu.sha, chapNhanNguonChuaCoChu: ["UNKNOWN"] })).toEqual({ ok: true });
  });
});
