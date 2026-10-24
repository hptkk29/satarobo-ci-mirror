// @vitest-environment node
/**
 * [AFC-*] — LUẬT GHI CAMPAIGN AFFILIATE, phần thuần (không DB). Ngày TUYỆT ĐỐI (luật 19). Mỗi ca chạy được MỘT MÌNH (luật 18).
 *
 *   [AFC-01] tạo: mã chuẩn hoá + kiểm khuôn · khoảng cookie / bảo vệ khớp CHECK · hiệu lực
 *   [AFC-02] sửa: ENDED khoá · ĐANG CHẠY chỉ tên/mô tả/hạn · PAUSED đổi tham số phải có lý do · DRAFT không đòi · ô không đổi không bị chặn
 *   [AFC-03] chuyển trạng thái: bảng chuyển, lý do khi tạm dừng / kết thúc
 *   [AFC-04] điều kiện KÍCH HOẠT: SPLIT · không nguồn · không website · hết hạn · nguồn không dùng được (nói đúng nguyên nhân)
 *   [AFC-05] quy tắc / website: trạng thái nào được đổi
 *   [AFC-06] XEM TRƯỚC nguồn qua `giaiNguonCuaDoiTac` THẬT: thứ tự ưu tiên, mâu thuẫn, thiếu cấu hình ⇒ XEM_TAY (không phải «không rõ»)
 */
import { describe, expect, it } from "vitest";
import {
  BAO_VE_NGAY,
  CHUYEN_TRANG_THAI,
  COOKIE_NGAY,
  dungDauVaoXemTruoc,
  dungRuleKey,
  kiemChuyenTrangThai,
  kiemDoiQuyTac,
  kiemGanWebsite,
  kiemGoWebsite,
  kiemKichHoatCampaign,
  kiemSuaCampaign,
  moHinhKichHoatDuoc,
  suaCampaignSchema,
  taoCampaignSchema,
  taoQuyTacSchema,
  tenHanhDongTrangThai,
  xemTruocNguon,
  type DuLieuKichHoat,
  type GiaTriCampaign,
  type NguonDeKiem,
} from "./ghi-campaign-dau-vao";

const NOW = new Date("2026-10-13T03:00:00.000Z");
const TU = new Date("2026-10-01T00:00:00.000Z");
const DEN = new Date("2026-12-31T00:00:00.000Z");

const HOP_LE = {
  code: "tet-2027",
  name: "Giới thiệu Tết",
  description: "",
  attributionModel: "FIRST_VALID",
  cookieWindowDays: 30,
  protectWindowDays: 90,
  allowSelfReferral: false,
  partnerCanViewAmount: null,
  defaultSourceGroupId: "",
  effectiveFrom: null,
  effectiveTo: null,
};

describe("[AFC-01] tạo campaign", () => {
  it("mã được chuẩn hoá (bỏ dấu, HOA, gạch dưới) và chuỗi rỗng thành null", () => {
    const r = taoCampaignSchema.safeParse({ ...HOP_LE, code: "  Tết 2027 ", description: "  ", defaultSourceGroupId: " " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.code).toBe("TET_2027");
      expect(r.data.description).toBeNull();
      expect(r.data.defaultSourceGroupId).toBeNull();
    }
  });

  it("mã ngắn hơn 3 ký tự hoặc dài hơn 40 bị từ chối, nói đúng ô `code`", () => {
    for (const code of ["ab", "A".repeat(41), "   "]) {
      const r = taoCampaignSchema.safeParse({ ...HOP_LE, code });
      expect(r.success, code).toBe(false);
      if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "code")).toBe(true);
    }
  });

  it("cookie: 1 và 365 qua, 0 và 366 không; bảo vệ: 1 và 730 qua, 0 và 731 không; số lẻ không", () => {
    const ok = (p: object) => taoCampaignSchema.safeParse({ ...HOP_LE, ...p }).success;
    expect(ok({ cookieWindowDays: COOKIE_NGAY.toiThieu })).toBe(true);
    expect(ok({ cookieWindowDays: COOKIE_NGAY.toiDa })).toBe(true);
    expect(ok({ cookieWindowDays: 0 })).toBe(false);
    expect(ok({ cookieWindowDays: COOKIE_NGAY.toiDa + 1 })).toBe(false);
    expect(ok({ cookieWindowDays: 7.5 })).toBe(false);
    expect(ok({ protectWindowDays: BAO_VE_NGAY.toiThieu })).toBe(true);
    expect(ok({ protectWindowDays: BAO_VE_NGAY.toiDa })).toBe(true);
    expect(ok({ protectWindowDays: 0 })).toBe(false);
    expect(ok({ protectWindowDays: BAO_VE_NGAY.toiDa + 1 })).toBe(false);
  });

  it("hiệu lực: hết hạn phải SAU bắt đầu (bằng nhau cũng không); thiếu một đầu thì được", () => {
    const loi = (from: Date | null, to: Date | null) => taoCampaignSchema.safeParse({ ...HOP_LE, effectiveFrom: from, effectiveTo: to });
    expect(loi(TU, DEN).success).toBe(true);
    expect(loi(TU, null).success).toBe(true);
    expect(loi(null, DEN).success).toBe(true);
    expect(loi(DEN, TU).success).toBe(false);
    const bang = loi(TU, TU);
    expect(bang.success).toBe(false);
    if (!bang.success) expect(bang.error.issues[0]?.path[0]).toBe("effectiveTo");
  });

  it("trường lạ (vd `status`, `activatedById`) bị từ chối — client không tự đặt trạng thái", () => {
    expect(taoCampaignSchema.safeParse({ ...HOP_LE, status: "ACTIVE" }).success).toBe(false);
    expect(suaCampaignSchema.safeParse({ code: "DOI_MA" }).success).toBe(false);
  });

  it("thiếu mô hình ghi nhận ⇒ từ chối (không có mặc định ngầm ở schema)", () => {
    const { attributionModel, ...thieu } = HOP_LE;
    void attributionModel;
    expect(taoCampaignSchema.safeParse(thieu).success).toBe(false);
  });
});

const HIEN_TAI: GiaTriCampaign = {
  name: "Tết",
  description: null,
  attributionModel: "FIRST_VALID",
  cookieWindowDays: 30,
  protectWindowDays: 90,
  allowSelfReferral: false,
  partnerCanViewAmount: null,
  defaultSourceGroupId: "src-1",
  effectiveFrom: TU,
  effectiveTo: DEN,
};
const sua = (trangThai: Parameters<typeof kiemSuaCampaign>[0]["trangThai"], patch: object, lyDo: string | null = null) =>
  kiemSuaCampaign({ trangThai, hienTai: HIEN_TAI, patch: suaCampaignSchema.parse(patch), lyDo });

describe("[AFC-02] sửa campaign", () => {
  it("ENDED không sửa gì", () => {
    const r = sua("ENDED", { name: "Tên khác" });
    expect(r.ok).toBe(false);
  });

  it("ĐANG CHẠY: sửa được tên · mô tả · ngày hết hiệu lực — không cần lý do", () => {
    const r = sua("ACTIVE", { name: "Tên mới", description: "Mô tả", effectiveTo: new Date("2027-01-31T00:00:00.000Z") });
    expect(r).toEqual({ ok: true, truongDoi: ["name", "description", "effectiveTo"], canLyDo: false });
  });

  it("[GCD-XT] ĐANG CHẠY: cài đặt HIỂN THỊ số tiền ở cổng đối tác sửa được, không cần lý do; vẫn là «trường đổi» thật (null → false là đổi, null → null thì không)", () => {
    expect(sua("ACTIVE", { partnerCanViewAmount: true })).toEqual({ ok: true, truongDoi: ["partnerCanViewAmount"], canLyDo: false });
    expect(sua("ACTIVE", { partnerCanViewAmount: false })).toEqual({ ok: true, truongDoi: ["partnerCanViewAmount"], canLyDo: false }); // null (theo loại) → false (ẩn tường minh) LÀ đổi
    expect(sua("ACTIVE", { partnerCanViewAmount: null })).toEqual({ ok: true, truongDoi: [], canLyDo: false }); // đã là null ⇒ không đổi
    expect(sua("PAUSED", { partnerCanViewAmount: true }).ok).toBe(true);
    // đối chứng ÂM: nó KHÔNG làm các tham số ghi nhận hết bị chặn
    expect(sua("ACTIVE", { partnerCanViewAmount: true, cookieWindowDays: 45 }).ok).toBe(false);
  });

  it("ĐANG CHẠY: mỗi tham số ghi nhận / nguồn mặc định / hiệu lực-từ bị chặn, nói tên trường và bảo tạm dừng trước", () => {
    for (const [k, v] of [
      ["attributionModel", "LAST_VALID"],
      ["cookieWindowDays", 45],
      ["protectWindowDays", 120],
      ["allowSelfReferral", true],
      ["defaultSourceGroupId", "src-2"],
      ["effectiveFrom", new Date("2026-09-01T00:00:00.000Z")],
    ] as const) {
      const r = sua("ACTIVE", { [k]: v });
      expect(r.ok, k).toBe(false);
      if (!r.ok) {
        expect(r.truong).toBe(k);
        expect(r.loi).toContain("tạm dừng");
      }
    }
  });

  it("ô gửi lại đúng giá trị cũ KHÔNG tính là đổi (form gửi mọi ô mỗi lần Lưu) — campaign đang chạy vẫn sửa được tên", () => {
    const r = sua("ACTIVE", { name: "Tên mới", attributionModel: "FIRST_VALID", cookieWindowDays: 30, effectiveFrom: TU });
    expect(r).toEqual({ ok: true, truongDoi: ["name"], canLyDo: false });
  });

  it("PAUSED: đổi tham số ghi nhận đòi lý do ≥ 10 ký tự; đổi tên thì không", () => {
    const thieu = sua("PAUSED", { cookieWindowDays: 45 }, "ngắn");
    expect(thieu.ok).toBe(false);
    if (!thieu.ok) expect(thieu.truong).toBe("lyDo");
    expect(sua("PAUSED", { cookieWindowDays: 45 }, "Đối tác xin kéo dài cửa sổ").ok).toBe(true);
    expect(sua("PAUSED", { name: "Tên mới" }).ok).toBe(true);
  });

  it("DRAFT: đổi tham số KHÔNG đòi lý do (chưa từng chạy, không có gì để hồi tố)", () => {
    expect(sua("DRAFT", { cookieWindowDays: 45, allowSelfReferral: true }).ok).toBe(true);
  });

  it("hiệu lực mới phải hợp lệ: hết hạn trước bắt đầu hiện có ⇒ chặn, nói ô effectiveTo", () => {
    const r = sua("ACTIVE", { effectiveTo: new Date("2026-09-01T00:00:00.000Z") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.truong).toBe("effectiveTo");
  });

  it("không có gì đổi ⇒ ok với danh sách rỗng", () => {
    expect(sua("PAUSED", { name: "Tết" })).toEqual({ ok: true, truongDoi: [], canLyDo: false });
  });
});

describe("[AFC-03] chuyển trạng thái", () => {
  it("bảng chuyển: DRAFT→ACTIVE/ENDED · ACTIVE→PAUSED/ENDED · PAUSED→ACTIVE/ENDED · ENDED không đi đâu", () => {
    const den = (t: keyof typeof CHUYEN_TRANG_THAI) => CHUYEN_TRANG_THAI[t].map((x) => x.den).sort();
    expect(den("DRAFT")).toEqual(["ACTIVE", "ENDED"]);
    expect(den("ACTIVE")).toEqual(["ENDED", "PAUSED"]);
    expect(den("PAUSED")).toEqual(["ACTIVE", "ENDED"]);
    expect(den("ENDED")).toEqual([]);
  });

  it("nhảy cóc / quay đầu bị chặn: DRAFT→PAUSED, ACTIVE→DRAFT, ENDED→ACTIVE", () => {
    for (const [tu, den] of [["DRAFT", "PAUSED"], ["ACTIVE", "DRAFT"], ["ENDED", "ACTIVE"], ["PAUSED", "DRAFT"], ["ACTIVE", "ACTIVE"]] as const) {
      expect(kiemChuyenTrangThai({ tu, den, lyDo: "lý do dài đủ rồi" }).ok, `${tu}→${den}`).toBe(false);
    }
  });

  it("tạm dừng và kết thúc đòi lý do ≥ 10 ký tự; kích hoạt và chạy lại thì không", () => {
    expect(kiemChuyenTrangThai({ tu: "ACTIVE", den: "PAUSED", lyDo: null }).ok).toBe(false);
    expect(kiemChuyenTrangThai({ tu: "ACTIVE", den: "PAUSED", lyDo: "      ngắn   " }).ok).toBe(false);
    expect(kiemChuyenTrangThai({ tu: "ACTIVE", den: "PAUSED", lyDo: "Đối tác vi phạm quy định" }).ok).toBe(true);
    expect(kiemChuyenTrangThai({ tu: "PAUSED", den: "ENDED", lyDo: null }).ok).toBe(false);
    expect(kiemChuyenTrangThai({ tu: "DRAFT", den: "ACTIVE", lyDo: null }).ok).toBe(true);
    expect(kiemChuyenTrangThai({ tu: "PAUSED", den: "ACTIVE", lyDo: null }).ok).toBe(true);
  });

  it("tên hành động nhật ký phân biệt kích hoạt / chạy lại / tạm dừng / huỷ nháp / kết thúc", () => {
    expect(tenHanhDongTrangThai("DRAFT", "ACTIVE")).toBe("CAMPAIGN_KICH_HOAT");
    expect(tenHanhDongTrangThai("PAUSED", "ACTIVE")).toBe("CAMPAIGN_CHAY_LAI");
    expect(tenHanhDongTrangThai("ACTIVE", "PAUSED")).toBe("CAMPAIGN_TAM_DUNG");
    expect(tenHanhDongTrangThai("DRAFT", "ENDED")).toBe("CAMPAIGN_HUY_NHAP");
    expect(tenHanhDongTrangThai("ACTIVE", "ENDED")).toBe("CAMPAIGN_KET_THUC");
  });
});

const NGUON_TOT: NguonDeKiem = { ten: "Giới thiệu bởi đối tác", status: "ACTIVE", selectable: true, effectiveFrom: null, effectiveTo: null };
/** Một quy tắc quy nguồn bình thường: loại/nhãn còn bật (hoặc không xét), không mang liên kết policyId. */
const QT = (sourceGroupId: string, p: Partial<DuLieuKichHoat["quyTac"][number]> = {}): DuLieuKichHoat["quyTac"][number] => ({
  sourceGroupId,
  loaiConDung: null,
  nhanConDung: null,
  policyId: null,
  policyCoPhienBanCuaCampaign: false,
  ...p,
});
/** `cheDoThuong: "NONE"` làm nền TRUNG TÍNH cho các ca không nói về thưởng (đã chọn rõ «không có mức riêng», không có chính sách) — ca về thưởng ở `kich-hoat-campaign.test.ts`. */
const DU_KICH_HOAT: DuLieuKichHoat = {
  attributionModel: "FIRST_VALID",
  defaultSourceGroupId: "src-1",
  effectiveFrom: TU,
  effectiveTo: DEN,
  quyTac: [],
  website: [{ ten: "quatang.edu.vn", status: "ACTIVE" }],
  nguon: new Map([["src-1", NGUON_TOT]]),
  cheDoThuong: "NONE",
  phienBanChinhSach: [],
  now: NOW,
};
const kich = (p: Partial<DuLieuKichHoat>) => kiemKichHoatCampaign({ ...DU_KICH_HOAT, ...p }).map((c) => c.thongBao);

describe("[AFC-04] điều kiện kích hoạt", () => {
  it("cấu hình đủ ⇒ không điều kiện nào chặn", () => {
    expect(kich({})).toEqual([]);
  });

  it("SPLIT chặn, và chỉ SPLIT: ba mô hình kia qua", () => {
    expect(moHinhKichHoatDuoc("SPLIT")).toBe(false);
    for (const m of ["FIRST_VALID", "LAST_VALID", "MANUAL_REVIEW"] as const) expect(moHinhKichHoatDuoc(m)).toBe(true);
    const loi = kich({ attributionModel: "SPLIT" });
    expect(loi).toHaveLength(1);
    expect(loi[0]).toContain("chưa dùng được");
  });

  it("không nguồn mặc định VÀ không quy tắc ⇒ chặn; chỉ có quy tắc thì qua; chỉ có nguồn mặc định thì qua", () => {
    expect(kich({ defaultSourceGroupId: null, quyTac: [] }).join()).toContain("nguồn mặc định");
    expect(kich({ defaultSourceGroupId: null, quyTac: [QT("src-1")] })).toEqual([]);
    expect(kich({ defaultSourceGroupId: "src-1", quyTac: [] })).toEqual([]);
  });

  it("không website, hoặc mọi website đều tắt ⇒ chặn (hai câu khác nhau); một website bật là đủ", () => {
    expect(kich({ website: [] }).join()).toContain("Chưa gắn website");
    const tat = kich({ website: [{ ten: "A", status: "INACTIVE" }, { ten: "B", status: "INACTIVE" }] });
    expect(tat.join()).toContain("đều đang tắt");
    expect(tat.join()).toContain("A, B");
    expect(kich({ website: [{ ten: "A", status: "INACTIVE" }, { ten: "B", status: "ACTIVE" }] })).toEqual([]);
  });

  it("đã hết hạn (hạn ≤ bây giờ) ⇒ chặn; hạn đúng lúc `now` cũng chặn; chưa tới ngày bắt đầu thì KHÔNG chặn", () => {
    expect(kich({ effectiveTo: new Date("2026-10-01T00:00:00.000Z"), effectiveFrom: new Date("2026-09-01T00:00:00.000Z") }).join()).toContain("hết hiệu lực");
    expect(kich({ effectiveTo: NOW, effectiveFrom: null }).join()).toContain("hết hiệu lực");
    expect(kich({ effectiveFrom: new Date("2026-11-01T00:00:00.000Z"), effectiveTo: DEN })).toEqual([]);
  });

  it("nguồn mặc định / nguồn của quy tắc không dùng được ⇒ chặn, NÓI ĐÚNG nguyên nhân và đúng tên nguồn", () => {
    const voi = (n: NguonDeKiem) => kich({ nguon: new Map([["src-1", n]]) }).join(" | ");
    expect(voi({ ...NGUON_TOT, status: "INACTIVE" })).toMatch(/Giới thiệu bởi đối tác.*Tạm ngừng/);
    expect(voi({ ...NGUON_TOT, status: "DRAFT" })).toMatch(/Giới thiệu bởi đối tác.*Nháp/);
    expect(voi({ ...NGUON_TOT, status: "ARCHIVED" })).toMatch(/Lưu trữ/);
    expect(voi({ ...NGUON_TOT, selectable: false })).toMatch(/chọn được/);
    expect(voi({ ...NGUON_TOT, effectiveTo: new Date("2026-10-01T00:00:00.000Z") })).toMatch(/hết hiệu lực/);
    expect(voi({ ...NGUON_TOT, effectiveFrom: new Date("2026-11-01T00:00:00.000Z") })).toMatch(/chưa tới ngày/);
  });

  it("nguồn của MỘT quy tắc hỏng cũng chặn; nguồn biến mất khỏi bảng cũng chặn", () => {
    const r = kich({
      defaultSourceGroupId: null,
      quyTac: [QT("src-hong")],
      nguon: new Map([["src-hong", { ...NGUON_TOT, ten: "Nguồn hỏng", status: "INACTIVE" }]]),
    });
    expect(r.join()).toContain("Nguồn hỏng");
    expect(kich({ nguon: new Map() }).join()).toContain("không còn tồn tại");
  });

  it("một nguồn dùng cho nhiều quy tắc chỉ báo MỘT lần; nhiều lỗi cùng lúc thì liệt kê đủ", () => {
    const hong = { ...NGUON_TOT, status: "INACTIVE" };
    const mot = kich({ quyTac: [QT("src-1"), QT("src-1")], nguon: new Map([["src-1", hong]]) });
    expect(mot).toHaveLength(1);
    const nhieu = kich({ attributionModel: "SPLIT", website: [], nguon: new Map([["src-1", hong]]) });
    expect(nhieu.length).toBe(3);
  });
});

describe("[AFC-05] quy tắc & website", () => {
  it("ruleKey đúng khuôn của CHECK: T:<type|*>|G:<tag|*>", () => {
    expect(dungRuleKey("t1", "g1")).toBe("T:t1|G:g1");
    expect(dungRuleKey("t1", null)).toBe("T:t1|G:*");
    expect(dungRuleKey(null, "g1")).toBe("T:*|G:g1");
  });

  it("quy tắc phải có loại HOẶC nhãn (cả hai trống bị chặn, nói ô typeId); chuỗi rỗng coi như trống", () => {
    expect(taoQuyTacSchema.safeParse({ typeId: null, tagId: null, sourceGroupId: "s" }).success).toBe(false);
    expect(taoQuyTacSchema.safeParse({ typeId: "", tagId: "  ", sourceGroupId: "s" }).success).toBe(false);
    expect(taoQuyTacSchema.safeParse({ typeId: "t", tagId: null, sourceGroupId: "s" }).success).toBe(true);
    expect(taoQuyTacSchema.safeParse({ typeId: null, tagId: "g", sourceGroupId: "s" }).success).toBe(true);
    expect(taoQuyTacSchema.safeParse({ typeId: "t", tagId: null, sourceGroupId: "" }).success).toBe(false);
    expect(taoQuyTacSchema.safeParse({ typeId: "t", tagId: null, sourceGroupId: "s", policyId: "p" }).success).toBe(false);
  });

  it("đổi quy tắc: DRAFT được · PAUSED cần lý do · ĐANG CHẠY phải tạm dừng trước · ENDED khoá", () => {
    expect(kiemDoiQuyTac({ trangThai: "DRAFT", lyDo: null }).ok).toBe(true);
    expect(kiemDoiQuyTac({ trangThai: "PAUSED", lyDo: null }).ok).toBe(false);
    expect(kiemDoiQuyTac({ trangThai: "PAUSED", lyDo: "Đổi nguồn theo chỉ đạo mới" }).ok).toBe(true);
    const chay = kiemDoiQuyTac({ trangThai: "ACTIVE", lyDo: "Đổi nguồn theo chỉ đạo mới" });
    expect(chay.ok).toBe(false);
    if (!chay.ok) expect(chay.loi).toContain("tạm dừng");
    expect(kiemDoiQuyTac({ trangThai: "ENDED", lyDo: "Đổi nguồn theo chỉ đạo mới" }).ok).toBe(false);
  });

  it("gắn website: site tắt không gắn mới được; đã gắn rồi thì báo; ENDED khoá; ĐANG CHẠY vẫn gắn thêm được", () => {
    const base = { trangThai: "DRAFT" as const, site: { status: "ACTIVE" }, daGan: false };
    expect(kiemGanWebsite(base).ok).toBe(true);
    expect(kiemGanWebsite({ ...base, trangThai: "ACTIVE" }).ok).toBe(true);
    expect(kiemGanWebsite({ ...base, site: { status: "INACTIVE" } }).ok).toBe(false);
    expect(kiemGanWebsite({ ...base, daGan: true }).ok).toBe(false);
    expect(kiemGanWebsite({ ...base, site: null }).ok).toBe(false);
    expect(kiemGanWebsite({ ...base, trangThai: "ENDED" }).ok).toBe(false);
  });

  it("gỡ website: campaign ĐANG CHẠY không được gỡ website bật cuối cùng; DRAFT/PAUSED thì được", () => {
    const base = { trangThai: "ACTIVE" as const, daGan: true, soWebsiteBatConLai: 0 };
    const chan = kiemGoWebsite(base);
    expect(chan.ok).toBe(false);
    expect(kiemGoWebsite({ ...base, soWebsiteBatConLai: 1 }).ok).toBe(true);
    expect(kiemGoWebsite({ ...base, trangThai: "PAUSED" }).ok).toBe(true);
    expect(kiemGoWebsite({ ...base, trangThai: "DRAFT" }).ok).toBe(true);
    expect(kiemGoWebsite({ ...base, daGan: false }).ok).toBe(false);
    expect(kiemGoWebsite({ ...base, trangThai: "ENDED", soWebsiteBatConLai: 3 }).ok).toBe(false);
  });
});

describe("[AFC-06] xem trước nguồn — qua giaiNguonCuaDoiTac THẬT", () => {
  const nguon = (id: string, ten: string, p: Partial<NguonDeKiem> = {}) => [id, { id, code: id.toUpperCase(), ten, status: "ACTIVE", selectable: true, effectiveFrom: null, effectiveTo: null, ...p }] as const;
  const BANG = new Map([nguon("s-loai", "Nguồn theo loại"), nguon("s-nhan", "Nguồn theo nhãn"), nguon("s-ca-hai", "Nguồn theo loại và nhãn"), nguon("s-camp", "Nguồn mặc định campaign"), nguon("s-type", "Nguồn mặc định loại")]);
  const chay = (p: Parameters<typeof dungDauVaoXemTruoc>[0], bang = BANG) => xemTruocNguon({ dauVao: dungDauVaoXemTruoc(p), nguon: bang, now: NOW });
  const DOI_TAC = { loaiId: "t1", nhanIds: ["g1"] };

  it("quy tắc theo CẢ loại và nhãn thắng quy tắc riêng loại và riêng nhãn", () => {
    const r = chay({
      quyTac: [
        { typeId: "t1", tagId: null, sourceGroupId: "s-loai" },
        { typeId: null, tagId: "g1", sourceGroupId: "s-nhan" },
        { typeId: "t1", tagId: "g1", sourceGroupId: "s-ca-hai" },
      ],
      campaignMacDinh: "s-camp",
      doiTac: DOI_TAC,
      loaiMacDinh: "s-type",
    });
    expect(r).toMatchObject({ loai: "NGUON", sourceGroupId: "s-ca-hai", tu: "RULE_LOAI_VA_NHAN" });
  });

  it("quy tắc theo LOẠI thắng quy tắc theo NHÃN khi hai cái trỏ hai nguồn khác nhau", () => {
    const r = chay({
      quyTac: [
        { typeId: null, tagId: "g1", sourceGroupId: "s-nhan" },
        { typeId: "t1", tagId: null, sourceGroupId: "s-loai" },
      ],
      campaignMacDinh: "s-camp",
      doiTac: DOI_TAC,
      loaiMacDinh: null,
    });
    expect(r).toMatchObject({ sourceGroupId: "s-loai", tu: "RULE_LOAI" });
  });

  it("không quy tắc nào khớp: nguồn mặc định CAMPAIGN thắng nguồn mặc định LOẠI; không có cả hai ⇒ lấy của loại", () => {
    const base = { quyTac: [{ typeId: "t-khac", tagId: null, sourceGroupId: "s-loai" }], doiTac: DOI_TAC };
    expect(chay({ ...base, campaignMacDinh: "s-camp", loaiMacDinh: "s-type" })).toMatchObject({ sourceGroupId: "s-camp", tu: "MAC_DINH_CAMPAIGN" });
    expect(chay({ ...base, campaignMacDinh: null, loaiMacDinh: "s-type" })).toMatchObject({ sourceGroupId: "s-type", tu: "MAC_DINH_LOAI" });
  });

  it("hai nhãn của đối tác trỏ hai nguồn khác nhau ở cùng bậc ⇒ MÂU THUẪN ⇒ XEM TAY kèm lý do, không chọn bừa", () => {
    const r = chay({
      quyTac: [
        { typeId: null, tagId: "g1", sourceGroupId: "s-nhan" },
        { typeId: null, tagId: "g2", sourceGroupId: "s-loai" },
      ],
      campaignMacDinh: "s-camp",
      doiTac: { loaiId: null, nhanIds: ["g1", "g2"] },
      loaiMacDinh: null,
    });
    expect(r.loai).toBe("XEM_TAY");
    if (r.loai === "XEM_TAY") expect(r.lyDo).toContain("mâu thuẫn");
  });

  it("thiếu cấu hình hoàn toàn ⇒ «cần xem tay» KÈM LÝ DO (không phải «không rõ», không nguồn nào)", () => {
    const r = chay({ quyTac: [], campaignMacDinh: null, doiTac: { loaiId: null, nhanIds: [] }, loaiMacDinh: null });
    expect(r.loai).toBe("XEM_TAY");
    if (r.loai === "XEM_TAY") {
      expect(r.lyDo.length).toBeGreaterThan(20);
      expect(JSON.stringify(r)).not.toMatch(/UNKNOWN|Không rõ/);
    }
  });

  it("nguồn được chọn nhưng hiện KHÔNG dùng được ⇒ vẫn trả nguồn đó, kèm cảnh báo nói nguyên nhân (không đổi sang nguồn khác âm thầm)", () => {
    const bang = new Map([nguon("s-camp", "Nguồn mặc định campaign", { status: "INACTIVE" })]);
    const r = chay({ quyTac: [], campaignMacDinh: "s-camp", doiTac: DOI_TAC, loaiMacDinh: null }, bang);
    expect(r).toMatchObject({ loai: "NGUON", sourceGroupId: "s-camp" });
    if (r.loai === "NGUON") expect(r.canhBao).toContain("Tạm ngừng");
    const tot = chay({ quyTac: [], campaignMacDinh: "s-camp", doiTac: DOI_TAC, loaiMacDinh: null });
    if (tot.loai === "NGUON") expect(tot.canhBao).toBeNull();
  });

  it("đối tác không có loại: chỉ quy tắc theo nhãn và mặc định áp được — quy tắc theo loại không khớp NULL với NULL", () => {
    const r = chay({ quyTac: [{ typeId: "t1", tagId: null, sourceGroupId: "s-loai" }], campaignMacDinh: "s-camp", doiTac: { loaiId: null, nhanIds: [] }, loaiMacDinh: null });
    expect(r).toMatchObject({ sourceGroupId: "s-camp", tu: "MAC_DINH_CAMPAIGN" });
  });
});
