/**
 * [GLD-*] Luật phát / thu hồi / xoay link giới thiệu (AFF-P1) — THUẦN.
 *
 *   [GLD-01] kiemChuoiLink: chuỗi khoẻ ⇒ ok; MỖI vế hỏng ⇒ đúng mã (thu hồi · đối tác · membership · campaign · website · theo dõi · trang đích · website không gắn campaign) + ĐỐI CHỨNG DƯƠNG
 *   [GLD-02] trangDichConHieuLuc tính bằng khopDuongDan trên trang ĐANG BẬT (trang tắt / không khớp ⇒ TRANG_DICH_KHONG_CON)
 *   [GLD-03] kiemPhatLink: membership của người khác ⇒ từ chối; website không gắn campaign ⇒ từ chối; đường dẫn ngoài trang đích ⇒ từ chối; host ngoài tên miền ⇒ từ chối
 *   [GLD-04] kiemPhatLink dùng CHÍNH kiemLienKet: campaign tạm dừng / membership hết hạn ⇒ từ chối bằng câu của kiemLienKet
 *   [GLD-05] hạn mức link: đủ N ⇒ từ chối kèm câu nói rõ; xoay (laXoay) KHÔNG bị chặn
 *   [GLD-06] kiemThuHoi: lý do ≥ 10 ký tự (9 ⇒ từ chối, 10 ⇒ qua); link đã thu hồi ⇒ từ chối
 *   [GLD-07] phatLinkSchema: loại ngoài LINK|QR|CODE, trường lạ, nhãn dài ⇒ từ chối; nhãn trống ⇒ null
 *   [GLD-08] anToken: 4 ký tự đầu + «…», không lộ phần còn lại
 *   [GLD-09] kiemDuongDanLink: không ?, không #, phải bắt đầu /
 */
import { describe, expect, it } from "vitest";
import {
  LY_DO_TOI_THIEU_LINK,
  SO_LINK_HOAT_DONG_TOI_DA,
  anToken,
  kiemChuoiLink,
  kiemDuongDanLink,
  kiemPhatLink,
  kiemThuHoi,
  phatLinkSchema,
  type ChuoiLink,
} from "./ghi-link-dau-vao";
import type { TrangDichChuoi } from "./trang-dich-hieu-luc";

/** Trang đích trong chuỗi (đã giải host, đã thu hẹp theo campaign). */
const td = (pathPattern: string, isActive = true, host = "quatang.edu.vn", trackingEnabled = true): TrangDichChuoi => ({ id: `lp:${host}:${pathPattern}`, label: null, pathPattern, isActive, host, trackingEnabled });

const NOW = new Date("2026-10-13T03:00:00.000Z");
const TOT: ChuoiLink = {
  taiSan: { status: "ACTIVE", landingPath: "/khoa-hoc/robot", landingHost: "quatang.edu.vn" },
  doiTac: { status: "ACTIVE" },
  thanhVien: { status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: null },
  campaign: { code: "TET_2027", status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: new Date("2027-03-01T00:00:00.000Z"), cookieWindowDays: 30 },
  campaignGanSite: true,
  site: { baseUrl: "https://quatang.edu.vn", allowedDomains: ["quatang.edu.vn", "covua.quatang.edu.vn"], status: "ACTIVE", trackingEnabled: true },
  trangDich: [td("/khoa-hoc/*", true)],
};
const { taiSan: _bo, ...CHUOI_PHAT } = TOT;
void _bo;
const PHAT = { partyId: "p1", membershipPartyId: "p1", chuoi: CHUOI_PHAT, duongDan: "/khoa-hoc/robot", landingPageId: null, soLinkDangChay: 0, laXoay: false, nguon: { loai: "NGUON", canhBao: null } } as const;

describe("[GLD-01] kiemChuoiLink", () => {
  it("chuỗi khoẻ ⇒ ok (đối chứng dương)", () => {
    expect(kiemChuoiLink(TOT, NOW)).toEqual({ ok: true });
  });
  const ca: [string, ChuoiLink, string][] = [
    ["link thu hồi", { ...TOT, taiSan: { ...TOT.taiSan, status: "REVOKED" } }, "LINK_DA_THU_HOI"],
    ["đối tác ngừng", { ...TOT, doiTac: { status: "SUSPENDED" } }, "DOI_TAC_KHONG_HOAT_DONG"],
    ["membership tạm ngừng", { ...TOT, thanhVien: { ...TOT.thanhVien, status: "SUSPENDED" } }, "THANH_VIEN_KHONG_HOAT_DONG"],
    ["membership hết hạn", { ...TOT, thanhVien: { ...TOT.thanhVien, effectiveTo: new Date("2026-10-12T00:00:00.000Z") } }, "THANH_VIEN_HET_HAN"],
    ["campaign tạm dừng", { ...TOT, campaign: { ...TOT.campaign, status: "PAUSED" } }, "CAMPAIGN_KHONG_HOAT_DONG"],
    ["campaign hết hạn", { ...TOT, campaign: { ...TOT.campaign, effectiveTo: new Date("2026-10-13T03:00:00.000Z") } }, "CAMPAIGN_HET_HAN"],
    ["website ngừng", { ...TOT, site: { ...TOT.site, status: "INACTIVE" } }, "WEBSITE_KHONG_HOAT_DONG"],
    ["website tắt theo dõi", { ...TOT, site: { ...TOT.site, trackingEnabled: false } }, "THEO_DOI_DANG_TAT"],
    ["website bị gỡ khỏi campaign", { ...TOT, campaignGanSite: false }, "SITE_KHONG_GAN_CAMPAIGN"],
  ];
  it.each(ca)("%s ⇒ %s", (_ten, chuoi, ma) => {
    const kq = kiemChuoiLink(chuoi, NOW);
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.tatCa).toContain(ma);
  });
  it("mã cục bộ SITE_KHONG_GAN_CAMPAIGN đứng SAU mọi mã của kiemLienKet", () => {
    const kq = kiemChuoiLink({ ...TOT, campaignGanSite: false, campaign: { ...TOT.campaign, status: "PAUSED" } }, NOW);
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.tatCa).toEqual(["CAMPAIGN_KHONG_HOAT_DONG", "SITE_KHONG_GAN_CAMPAIGN"]);
  });
  it("mã lỗi khớp CHECK ReferralClick_outcome_chk (^[A-Z_]{2,40}$)", () => {
    const kq = kiemChuoiLink({ ...TOT, campaignGanSite: false, taiSan: { ...TOT.taiSan, status: "REVOKED" } }, NOW);
    expect(kq.ok).toBe(false);
    if (!kq.ok) for (const m of kq.tatCa) expect(m).toMatch(/^[A-Z_]{2,40}$/);
  });
});

describe("[GLD-02] trang đích còn hiệu lực", () => {
  it("trang đích bị TẮT sau khi phát ⇒ TRANG_DICH_KHONG_CON", () => {
    const kq = kiemChuoiLink({ ...TOT, trangDich: [td("/khoa-hoc/*", false)] }, NOW);
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.ma).toBe("TRANG_DICH_KHONG_CON");
  });
  it("mẫu trang đích bị SỬA không còn khớp đường dẫn của link ⇒ TRANG_DICH_KHONG_CON", () => {
    const kq = kiemChuoiLink({ ...TOT, trangDich: [td("/tuyen-sinh/*", true)] }, NOW);
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.ma).toBe("TRANG_DICH_KHONG_CON");
  });
  it("mẫu tiền tố khớp đường dẫn con; có thêm trang khác tắt vẫn ok (đối chứng dương)", () => {
    expect(kiemChuoiLink({ ...TOT, trangDich: [td("/khoa-hoc/*", true), td("/x", false)] }, NOW)).toEqual({ ok: true });
  });
});

describe("[GLD-03] kiemPhatLink — cổng phát", () => {
  it("chuỗi khoẻ ⇒ ok, trả đường dẫn đã chuẩn hoá (đối chứng dương)", () => {
    expect(kiemPhatLink(PHAT, NOW)).toEqual({ ok: true, landingPath: "/khoa-hoc/robot", landingHost: "quatang.edu.vn", landingPageId: "lp:quatang.edu.vn:/khoa-hoc/*" });
  });
  it("membership của đối tác KHÁC ⇒ từ chối, gắn ô membershipId", () => {
    const kq = kiemPhatLink({ ...PHAT, membershipPartyId: "p2" }, NOW);
    expect(kq).toMatchObject({ ok: false, truong: "membershipId" });
  });
  it("website không gắn campaign ⇒ từ chối, gắn ô siteId", () => {
    const kq = kiemPhatLink({ ...PHAT, chuoi: { ...PHAT.chuoi, campaignGanSite: false } }, NOW);
    expect(kq).toMatchObject({ ok: false, truong: "siteId" });
  });
  it("đường dẫn không khớp trang đích nào đang bật ⇒ từ chối, nói về TRANG ĐÍCH", () => {
    const kq = kiemPhatLink({ ...PHAT, duongDan: "/admin" }, NOW);
    expect(kq).toMatchObject({ ok: false, truong: "landingPath" });
    if (!kq.ok) expect(kq.loi).toContain("trang đích");
  });
  it("trang đích tắt ⇒ từ chối", () => {
    expect(kiemPhatLink({ ...PHAT, chuoi: { ...PHAT.chuoi, trangDich: [td("/khoa-hoc/*", false)] } }, NOW).ok).toBe(false);
  });
  it("host của baseUrl ngoài allowedDomains ⇒ từ chối", () => {
    const kq = kiemPhatLink({ ...PHAT, chuoi: { ...PHAT.chuoi, site: { ...PHAT.chuoi.site, baseUrl: "https://evil.com" } } }, NOW);
    expect(kq).toMatchObject({ ok: false, truong: "landingPath" });
  });
  it.each(["//evil.com", "/khoa-hoc/../admin", "/khoa-hoc/%2e%2e/x", "/khoa-hoc/a%2fb"])("đường dẫn nguy hiểm %s ⇒ từ chối", (duongDan) => {
    expect(kiemPhatLink({ ...PHAT, duongDan }, NOW).ok).toBe(false);
  });
});

describe("[GLD-04] cùng kiemLienKet với lúc khách bấm", () => {
  it.each([
    ["campaign tạm dừng", { campaign: { ...CHUOI_PHAT.campaign, status: "PAUSED" as const } }, "Campaign không ở trạng thái đang chạy."],
    ["đối tác ngừng", { doiTac: { status: "ENDED" as const } }, "Đối tác không còn ở trạng thái hoạt động."],
    ["membership chưa tới ngày", { thanhVien: { ...CHUOI_PHAT.thanhVien, effectiveFrom: new Date("2026-11-01T00:00:00.000Z") } }, "Tư cách thành viên chưa tới ngày hiệu lực."],
    ["website ngừng", { site: { ...CHUOI_PHAT.site, status: "INACTIVE" as const } }, null],
  ])("%s ⇒ từ chối", (_t, patch, cau) => {
    const kq = kiemPhatLink({ ...PHAT, chuoi: { ...PHAT.chuoi, ...patch } }, NOW);
    expect(kq.ok).toBe(false);
    if (!kq.ok && cau) expect(kq.loi).toBe(cau);
  });
});

describe("[GLD-05] hạn mức", () => {
  it(`đủ ${SO_LINK_HOAT_DONG_TOI_DA} link đang chạy ⇒ từ chối kèm con số; ${SO_LINK_HOAT_DONG_TOI_DA - 1} ⇒ qua`, () => {
    const kq = kiemPhatLink({ ...PHAT, soLinkDangChay: SO_LINK_HOAT_DONG_TOI_DA }, NOW);
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.loi).toContain(String(SO_LINK_HOAT_DONG_TOI_DA));
    expect(kiemPhatLink({ ...PHAT, soLinkDangChay: SO_LINK_HOAT_DONG_TOI_DA - 1 }, NOW).ok).toBe(true);
  });
  it("xoay mã KHÔNG bị hạn mức chặn (thu hồi một, tạo một)", () => {
    expect(kiemPhatLink({ ...PHAT, soLinkDangChay: SO_LINK_HOAT_DONG_TOI_DA, laXoay: true }, NOW).ok).toBe(true);
  });
});

describe("[GLD-06] kiemThuHoi", () => {
  it("lý do đúng ngưỡng", () => {
    expect(kiemThuHoi({ status: "ACTIVE", lyDo: "x".repeat(LY_DO_TOI_THIEU_LINK - 1) })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(kiemThuHoi({ status: "ACTIVE", lyDo: "x".repeat(LY_DO_TOI_THIEU_LINK) })).toEqual({ ok: true });
    expect(kiemThuHoi({ status: "ACTIVE", lyDo: "   " + "x".repeat(LY_DO_TOI_THIEU_LINK - 1) + "   " })).toMatchObject({ ok: false });
    expect(kiemThuHoi({ status: "ACTIVE", lyDo: null })).toMatchObject({ ok: false });
  });
  it("link đã thu hồi ⇒ từ chối dù lý do tốt", () => {
    expect(kiemThuHoi({ status: "REVOKED", lyDo: "một lý do đủ dài" })).toMatchObject({ ok: false, truong: "trangThai" });
  });
});

describe("[GLD-07] phatLinkSchema", () => {
  const OK = { partyId: "p1", membershipId: "m1", siteId: "s1", landingPath: "/x", type: "LINK", label: "  Poster  " };
  it("hợp lệ; nhãn được cắt, rỗng ⇒ null", () => {
    expect(phatLinkSchema.parse(OK).label).toBe("Poster");
    expect(phatLinkSchema.parse({ ...OK, label: "   " }).label).toBeNull();
  });
  it("loại lạ / trường lạ / nhãn quá dài / thiếu id ⇒ từ chối", () => {
    expect(phatLinkSchema.safeParse({ ...OK, type: "SMS" }).success).toBe(false);
    expect(phatLinkSchema.safeParse({ ...OK, token: "ABCDEFGHJK" }).success).toBe(false);
    expect(phatLinkSchema.safeParse({ ...OK, label: "x".repeat(121) }).success).toBe(false);
    expect(phatLinkSchema.safeParse({ ...OK, partyId: " " }).success).toBe(false);
  });
});

describe("[GLD-08] anToken", () => {
  it("4 ký tự đầu + «…», không lộ phần sau", () => {
    expect(anToken("K8F29XQ47M")).toBe("K8F2…");
    expect(anToken("K8F29XQ47M")).not.toContain("9XQ47M");
  });
});

describe("[GLD-09] kiemDuongDanLink", () => {
  it("chấp nhận /…; từ chối rỗng, thiếu /, có ? hoặc #", () => {
    expect(kiemDuongDanLink(" /khoa-hoc/robot ")).toEqual({ ok: true, duongDan: "/khoa-hoc/robot" });
    for (const x of ["", "  ", "khoa-hoc", "/x?y=1", "/x#a"]) expect(kiemDuongDanLink(x).ok).toBe(false);
  });
});

// ═══ [GLD-08] AFF-L6 — ĐA TÊN MIỀN / ĐA TRANG ĐÍCH: trang đích gắn với TÊN MIỀN, không chỉ đường dẫn ═══════════════════════
describe("[GLD-08] một website nhiều tên miền", () => {
  const HAI = [td("/khoa-hoc/*"), td("/giai-dau/*", true, "covua.quatang.edu.vn"), td("/", true, "covua.quatang.edu.vn")];
  const LINK_COVUA: ChuoiLink = { ...TOT, taiSan: { status: "ACTIVE", landingPath: "/giai-dau/2027", landingHost: "covua.quatang.edu.vn" }, trangDich: HAI };

  it("link trên tên miền thứ hai còn hiệu lực khi trang đích CỦA TÊN MIỀN ĐÓ còn bật (đối chứng dương)", () => {
    expect(kiemChuoiLink(LINK_COVUA, NOW)).toEqual({ ok: true });
  });
  it("cùng đường dẫn nhưng KHÁC tên miền ⇒ không khớp: trang đích `/giai-dau/*` của covua không cứu link trên quatang.edu.vn", () => {
    const kq = kiemChuoiLink({ ...LINK_COVUA, taiSan: { ...LINK_COVUA.taiSan, landingHost: "quatang.edu.vn" } }, NOW);
    expect(kq).toMatchObject({ ok: false, ma: "TRANG_DICH_KHONG_CON" });
  });
  it("trang đích của tên miền ấy tắt theo dõi RIÊNG (website vẫn bật) ⇒ TRANG_DICH_KHONG_CON", () => {
    const kq = kiemChuoiLink({ ...LINK_COVUA, trangDich: [td("/giai-dau/*", true, "covua.quatang.edu.vn", false)] }, NOW);
    expect(kq).toMatchObject({ ok: false, ma: "TRANG_DICH_KHONG_CON" });
  });
  it("Admin gỡ tên miền khỏi danh sách của website SAU khi link đã phát ⇒ link hết hiệu lực dù trang đích còn", () => {
    const kq = kiemChuoiLink({ ...LINK_COVUA, site: { ...LINK_COVUA.site, allowedDomains: ["quatang.edu.vn"] } }, NOW);
    expect(kq).toMatchObject({ ok: false, ma: "TRANG_DICH_KHONG_CON" });
  });
  it("thu hẹp theo campaign: danh sách trang đích CHỈ còn trang quatang ⇒ link trên covua hết hiệu lực (lịch sử không bị xoá — chỉ cổng từ chối)", () => {
    const kq = kiemChuoiLink({ ...LINK_COVUA, trangDich: [td("/khoa-hoc/*")] }, NOW);
    expect(kq).toMatchObject({ ok: false, ma: "TRANG_DICH_KHONG_CON" });
  });

  const PHAT2 = { ...PHAT, chuoi: { ...PHAT.chuoi, trangDich: HAI } } as const;
  it("phát theo trang đích đã chọn: tên miền lấy từ DÒNG trang đích, snapshot ghi cả tên miền lẫn id", () => {
    const kq = kiemPhatLink({ ...PHAT2, duongDan: "/giai-dau/2027", landingPageId: "lp:covua.quatang.edu.vn:/giai-dau/*" }, NOW);
    expect(kq).toEqual({ ok: true, landingPath: "/giai-dau/2027", landingHost: "covua.quatang.edu.vn", landingPageId: "lp:covua.quatang.edu.vn:/giai-dau/*" });
  });
  it("không chọn trang đích ⇒ tìm trên tên miền của website; đường dẫn chỉ có ở tên miền kia ⇒ từ chối", () => {
    expect(kiemPhatLink({ ...PHAT2, duongDan: "/giai-dau/2027", landingPageId: null }, NOW)).toMatchObject({ ok: false, truong: "landingPath" });
    expect(kiemPhatLink({ ...PHAT2, duongDan: "/khoa-hoc/robot", landingPageId: null }, NOW)).toMatchObject({ ok: true, landingHost: "quatang.edu.vn" });
  });
  it("id trang đích không thuộc chuỗi (website khác / campaign không cho dùng) ⇒ từ chối, gắn ô landingPageId", () => {
    expect(kiemPhatLink({ ...PHAT2, duongDan: "/giai-dau/2027", landingPageId: "lp:khac" }, NOW)).toMatchObject({ ok: false, truong: "landingPageId" });
  });
  it("đã chọn trang đích A thì đường dẫn PHẢI khớp mẫu của A — không mượn trang đích khác để qua cổng", () => {
    expect(kiemPhatLink({ ...PHAT2, duongDan: "/khoa-hoc/robot", landingPageId: "lp:covua.quatang.edu.vn:/giai-dau/*" }, NOW)).toMatchObject({ ok: false, truong: "landingPath" });
  });
  it("trang đích tắt theo dõi riêng ⇒ không phát được, kể cả khi chọn đúng id", () => {
    const chuoi = { ...PHAT.chuoi, trangDich: [td("/giai-dau/*", true, "covua.quatang.edu.vn", false)] };
    expect(kiemPhatLink({ ...PHAT, chuoi, duongDan: "/giai-dau/2027", landingPageId: "lp:covua.quatang.edu.vn:/giai-dau/*" }, NOW).ok).toBe(false);
  });
  it("schema: nhận `landingPageId` nhưng KHÔNG nhận tên miền từ client (strict)", () => {
    const OK = { partyId: "p1", membershipId: "m1", siteId: "s1", landingPath: "/x", type: "LINK", label: null };
    expect(phatLinkSchema.safeParse({ ...OK, landingPageId: "lp1" }).success).toBe(true);
    expect(phatLinkSchema.safeParse({ ...OK, landingPageId: null }).success).toBe(true);
    expect(phatLinkSchema.safeParse({ ...OK, landingHost: "evil.com" }).success).toBe(false);
    expect(phatLinkSchema.safeParse({ ...OK, host: "evil.com" }).success).toBe(false);
  });
});
