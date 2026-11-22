// @vitest-environment node
/**
 * [GNA-*] — QUYẾT ĐỊNH ghi nguồn khi DUYỆT TAY một referral Affiliate (AFF-L3b). THUẦN.
 *
 * Câu hỏi: lead đang ở hiện trạng nguồn nào thì duyệt referral được ghi bằng đường nào, và khi nào KHÔNG ĐƯỢC ghi đè.
 *   [GNA-01] chưa có dòng quy nguồn ⇒ TAO_MOI (first-claim)
 *   [GNA-02] nhóm «chờ» (UNKNOWN) · không người giới thiệu · không khoá · CHƯA thu tiền ⇒ DE_NHOM_CHO; có thu tiền ⇒ TỪ CHỐI; nguồn khoá ⇒ TỪ CHỐI
 *   [GNA-03] đã là CHÍNH đối tác này + CÙNG campaign ⇒ DA_DUNG_NGUOI (idempotent); campaign khác ⇒ TỪ CHỐI
 *   [GNA-04] MỌI nguồn thật khác (đối tác khác, kế thừa SĐT, nhân sự, phụ huynh, nhóm không-chờ) ⇒ TỪ CHỐI «đã có người ghi nhận trước» — KHÔNG ghi đè
 *   [GNA-05] câu từ chối chỉ đường «Đổi nguồn» (không câu chung chung)
 */
import { describe, expect, it } from "vitest";
import { NHAN_TU_CHOI_GHI_NGUON, quyetDinhGhiNguonAffiliate, type HienTrangNguonCuaLead } from "./ghi-nguon-affiliate-duyet";

const P = "party_dich";
const C = "CAMP_DICH";
const hien = (ghi: Partial<HienTrangNguonCuaLead> = {}): HienTrangNguonCuaLead => ({ groupCode: "UNKNOWN", referrerKind: null, referrerAffiliateId: null, khoaNguon: false, campaignCodeChup: null, ...ghi });
const qd = (h: HienTrangNguonCuaLead | null, daCoThucThu = false) => quyetDinhGhiNguonAffiliate({ hienCo: h, partyId: P, campaignCode: C, daCoThucThu });
const loai = (h: HienTrangNguonCuaLead | null, thu = false) => {
  const r = qd(h, thu);
  return r.loai === "TU_CHOI" ? `TU_CHOI:${r.ma}` : r.loai;
};

describe("[GNA-01] chưa có nguồn", () => {
  it("không dòng quy nguồn ⇒ TAO_MOI (kể cả khi lead đã có khoản thu: không có người hưởng cũ nào để tranh)", () => {
    expect(loai(null)).toBe("TAO_MOI");
    expect(loai(null, true)).toBe("TAO_MOI");
  });
});

describe("[GNA-02] nhóm «chờ»", () => {
  it("UNKNOWN, không người, chưa thu, không khoá ⇒ DE_NHOM_CHO", () => expect(loai(hien())).toBe("DE_NHOM_CHO"));
  it("đã có khoản thu ⇒ TỪ CHỐI NHOM_CHO_DA_CO_THU (đổi người hưởng của hoa hồng đã tính ⇒ qua Đổi nguồn)", () => expect(loai(hien(), true)).toBe("TU_CHOI:NHOM_CHO_DA_CO_THU"));
  it("nguồn đang khoá ⇒ TỪ CHỐI NGUON_BI_KHOA (khoá thắng thu tiền: nói lý do gốc)", () => {
    expect(loai(hien({ khoaNguon: true }))).toBe("TU_CHOI:NGUON_BI_KHOA");
    expect(loai(hien({ khoaNguon: true }), true)).toBe("TU_CHOI:NGUON_BI_KHOA");
  });
  it("UNKNOWN nhưng ĐÃ có người giới thiệu (vd. nhân sự gõ mã sai) ⇒ KHÔNG phải nhóm chờ thuần ⇒ TỪ CHỐI", () => {
    expect(loai(hien({ referrerKind: "EMPLOYEE" }))).toBe("TU_CHOI:DA_CO_NGUOI_KHAC");
    expect(loai(hien({ referrerKind: "PARENT" }))).toBe("TU_CHOI:DA_CO_NGUOI_KHAC");
  });
});

describe("[GNA-03] đã đúng đối tác này", () => {
  const dung = { groupCode: "PARTNER_X", referrerKind: "AFFILIATE" as const, referrerAffiliateId: P };
  it("cùng campaign ⇒ DA_DUNG_NGUOI (không ghi lại)", () => expect(loai(hien({ ...dung, campaignCodeChup: C }))).toBe("DA_DUNG_NGUOI"));
  it("campaign khác / vắng bản chụp ⇒ TỪ CHỐI CUNG_DOI_TAC_KHAC_CAMPAIGN (engine sẽ đọc campaign cũ)", () => {
    expect(loai(hien({ ...dung, campaignCodeChup: "CAMP_KHAC" }))).toBe("TU_CHOI:CUNG_DOI_TAC_KHAC_CAMPAIGN");
    expect(loai(hien({ ...dung, campaignCodeChup: null }))).toBe("TU_CHOI:CUNG_DOI_TAC_KHAC_CAMPAIGN");
  });
  it("kể cả khi đã thu tiền, «đã đúng người» vẫn là DA_DUNG_NGUOI (không ghi gì nên không đổi tiền)", () => {
    expect(loai(hien({ ...dung, campaignCodeChup: C }), true)).toBe("DA_DUNG_NGUOI");
  });
});

describe("[GNA-04] KHÔNG ghi đè nguồn thật của người khác", () => {
  const CA = [
    ["đối tác KHÁC", { groupCode: "PARTNER_X", referrerKind: "AFFILIATE" as const, referrerAffiliateId: "party_khac", campaignCodeChup: C }],
    ["kế thừa SĐT (nhóm thật, không người)", { groupCode: "FACEBOOK_ADS", referrerKind: null }],
    ["nhân sự giới thiệu", { groupCode: "NHAN_SU", referrerKind: "EMPLOYEE" as const }],
    ["phụ huynh giới thiệu", { groupCode: "PHU_HUYNH", referrerKind: "PARENT" as const }],
    ["nhóm không-chờ không người giới thiệu (quảng cáo)", { groupCode: "QUANG_CAO", referrerKind: null }],
  ] as const;
  for (const [ten, ghi] of CA) {
    for (const thu of [false, true]) {
      it(`${ten}${thu ? " + đã thu tiền" : ""} ⇒ TỪ CHỐI DA_CO_NGUOI_KHAC`, () => {
        expect(loai(hien(ghi), thu)).toBe("TU_CHOI:DA_CO_NGUOI_KHAC");
      });
    }
  }
});

describe("[GNA-05] câu từ chối nói được việc cần làm", () => {
  it("câu «đã có người ghi nhận» và «đã có thu» đều chỉ đường «Đổi nguồn»", () => {
    expect(NHAN_TU_CHOI_GHI_NGUON.DA_CO_NGUOI_KHAC).toContain("Đổi nguồn");
    expect(NHAN_TU_CHOI_GHI_NGUON.DA_CO_NGUOI_KHAC).toContain("đã có người ghi nhận trước");
    expect(NHAN_TU_CHOI_GHI_NGUON.NHOM_CHO_DA_CO_THU).toContain("Đổi nguồn");
    expect(NHAN_TU_CHOI_GHI_NGUON.CUNG_DOI_TAC_KHAC_CAMPAIGN).toContain("Đổi nguồn");
  });
  it("mọi mã từ chối đều có câu", () => {
    for (const c of Object.values(NHAN_TU_CHOI_GHI_NGUON)) expect(c.length).toBeGreaterThan(20);
  });
});
