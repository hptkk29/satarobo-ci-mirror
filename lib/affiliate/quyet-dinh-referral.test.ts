/**
 * [AFF-QD-*] — quyết định ghi nhận một lượt gửi biểu mẫu qua link giới thiệu. THUẦN, ngày tuyệt đối (luật 19).
 * Thứ tự lý do là một phần của luật: link hỏng → quá cookie → tự giới thiệu → không giải được nguồn → hợp lệ.
 */
import { describe, expect, it } from "vitest";
import { quyetDinhReferral, trangThaiSauQuyNguon, trangThaiTuQuyetDinh, type DauVaoQuyetDinhReferral } from "./quyet-dinh-referral";

const BAY_GIO = new Date("2026-11-20T03:00:00.000Z");
const NGAY = 24 * 60 * 60 * 1000;

const OK: DauVaoQuyetDinhReferral = {
  chuoi: { ok: true },
  cookie: { clickAt: null, cookieWindowDays: 30 },
  tuGioiThieu: { chan: false, canCu: [] },
  nguon: { sourceGroupId: "g-1", tu: "RULE_LOAI" },
  origin: "KHOP",
  now: BAY_GIO,
};

describe("[AFF-QD-01] quyetDinhReferral — thứ tự lý do", () => {
  it("mọi thứ ổn ⇒ HỢP LỆ, mang nguồn đã giải và bậc quyết định", () => {
    expect(quyetDinhReferral(OK)).toEqual({ loai: "HOP_LE", sourceGroupId: "g-1", tuDau: "RULE_LOAI", canCuTuGioiThieu: [] });
  });

  it("chuỗi link hỏng ⇒ TỪ CHỐI, mang mã đầu tiên; đứng TRƯỚC mọi lý do khác", () => {
    const q = quyetDinhReferral({
      ...OK,
      chuoi: { ok: false, ma: "LINK_DA_THU_HOI", tatCa: ["LINK_DA_THU_HOI", "CAMPAIGN_HET_HAN"] },
      cookie: { clickAt: new Date(BAY_GIO.getTime() - 90 * NGAY), cookieWindowDays: 30 },
      tuGioiThieu: { chan: true, canCu: ["SDT"] },
      nguon: { sourceGroupId: null, tu: "XEM_TAY", lyDo: "x" },
    });
    expect(q).toMatchObject({ loai: "TU_CHOI", ma: "LINK_KHONG_HOP_LE", maLink: "LINK_DA_THU_HOI" });
  });

  it("click quá cửa sổ cookie ⇒ TỪ CHỐI; đứng trước tự-giới-thiệu và nguồn", () => {
    const q = quyetDinhReferral({
      ...OK,
      cookie: { clickAt: new Date(BAY_GIO.getTime() - 31 * NGAY), cookieWindowDays: 30 },
      tuGioiThieu: { chan: true, canCu: ["SDT"] },
    });
    expect(q).toMatchObject({ loai: "TU_CHOI", ma: "NGOAI_CUA_SO_COOKIE" });
  });

  it("đúng biên cửa sổ: bấm cách đây 29 ngày vẫn hợp lệ; vắng click ⇒ không đo cửa sổ", () => {
    expect(quyetDinhReferral({ ...OK, cookie: { clickAt: new Date(BAY_GIO.getTime() - 29 * NGAY), cookieWindowDays: 30 } }).loai).toBe("HOP_LE");
    expect(quyetDinhReferral({ ...OK, cookie: { clickAt: null, cookieWindowDays: 1 } }).loai).toBe("HOP_LE");
  });

  it("mốc click ở TƯƠNG LAI (đồng hồ giả) ⇒ TỪ CHỐI, không coi là còn hạn", () => {
    const q = quyetDinhReferral({ ...OK, cookie: { clickAt: new Date(BAY_GIO.getTime() + NGAY), cookieWindowDays: 30 } });
    expect(q).toMatchObject({ loai: "TU_CHOI", ma: "NGOAI_CUA_SO_COOKIE" });
  });

  it("tự giới thiệu bị chặn ⇒ TỪ CHỐI và giữ nguyên căn cứ; campaign cho phép (chan=false) vẫn mang căn cứ để ghi bằng chứng", () => {
    const chan = quyetDinhReferral({ ...OK, tuGioiThieu: { chan: true, canCu: ["SDT", "EMAIL"] } });
    expect(chan).toMatchObject({ loai: "TU_CHOI", ma: "TU_GIOI_THIEU", chiTiet: "SDT, EMAIL", canCuTuGioiThieu: ["SDT", "EMAIL"] });
    const cho = quyetDinhReferral({ ...OK, tuGioiThieu: { chan: false, canCu: ["SDT"] } });
    expect(cho).toMatchObject({ loai: "HOP_LE", canCuTuGioiThieu: ["SDT"] });
  });

  it("Origin LỆCH ⇒ XEM TAY (không tự từ chối); VẮNG thì không cản — và LỆCH đứng SAU tự-giới-thiệu (lý do cứng hơn đi trước)", () => {
    expect(quyetDinhReferral({ ...OK, origin: "LECH" })).toMatchObject({ loai: "XEM_TAY" });
    expect(quyetDinhReferral({ ...OK, origin: "VANG" }).loai).toBe("HOP_LE");
    expect(quyetDinhReferral({ ...OK, origin: "LECH", tuGioiThieu: { chan: true, canCu: ["SDT"] } })).toMatchObject({ loai: "TU_CHOI", ma: "TU_GIOI_THIEU" });
  });

  it("không giải được nguồn ⇒ XEM TAY kèm lý do — KHÔNG rơi âm thầm về một nguồn nào", () => {
    const q = quyetDinhReferral({ ...OK, nguon: { sourceGroupId: null, tu: "XEM_TAY", lyDo: "Chưa cấu hình nguồn" } });
    expect(q).toEqual({ loai: "XEM_TAY", lyDo: "Chưa cấu hình nguồn", canCuTuGioiThieu: [] });
  });
});

describe("[AFF-QD-02] trạng thái", () => {
  it("quyết định → trạng thái lúc tạo", () => {
    expect(trangThaiTuQuyetDinh(quyetDinhReferral(OK))).toBe("VALID");
    expect(trangThaiTuQuyetDinh(quyetDinhReferral({ ...OK, tuGioiThieu: { chan: true, canCu: ["SDT"] } }))).toBe("REJECTED");
    expect(trangThaiTuQuyetDinh(quyetDinhReferral({ ...OK, nguon: { sourceGroupId: null, tu: "XEM_TAY", lyDo: "x" } }))).toBe("MANUAL_REVIEW");
  });

  const hopLe = quyetDinhReferral(OK);

  it("luật AFFILIATE_REFERRAL thắng cho ĐÚNG đối tác này ⇒ VALID", () => {
    expect(trangThaiSauQuyNguon({ quyetDinh: hopLe, partyId: "p1", attribution: { matchedRule: "AFFILIATE_REFERRAL", referrerAffiliateId: "p1" } })).toEqual({ status: "VALID", lyDo: null });
  });

  it("luật thắng nhưng người giới thiệu là đối tác KHÁC ⇒ không VALID (không nhận công người khác)", () => {
    const r = trangThaiSauQuyNguon({ quyetDinh: hopLe, partyId: "p1", attribution: { matchedRule: "AFFILIATE_REFERRAL", referrerAffiliateId: "p2" } });
    expect(r.status).toBe("MANUAL_REVIEW");
  });

  it("khách đã có nguồn gốc (KE_THUA_SDT) ⇒ REJECTED_DUPLICATE — first-claim", () => {
    expect(trangThaiSauQuyNguon({ quyetDinh: hopLe, partyId: "p1", attribution: { matchedRule: "KE_THUA_SDT", referrerAffiliateId: null } }).status).toBe("REJECTED_DUPLICATE");
  });

  it("luật khác thắng (nhóm đích vừa ngừng, cờ con tắt) ⇒ XEM TAY, lý do nêu luật thắng", () => {
    const r = trangThaiSauQuyNguon({ quyetDinh: hopLe, partyId: "p1", attribution: { matchedRule: "DUONG_VAO_MAC_DINH", referrerAffiliateId: null } });
    expect(r.status).toBe("MANUAL_REVIEW");
    expect(r.lyDo).toContain("DUONG_VAO_MAC_DINH");
  });

  it("không đọc được attribution (nguồn tắt) ⇒ XEM TAY, không VALID bừa", () => {
    expect(trangThaiSauQuyNguon({ quyetDinh: hopLe, partyId: "p1", attribution: null }).status).toBe("MANUAL_REVIEW");
  });

  it("quyết định TỪ CHỐI / XEM TAY giữ nguyên bất kể attribution", () => {
    const tc = quyetDinhReferral({ ...OK, tuGioiThieu: { chan: true, canCu: ["SDT"] } });
    expect(trangThaiSauQuyNguon({ quyetDinh: tc, partyId: "p1", attribution: { matchedRule: "AFFILIATE_REFERRAL", referrerAffiliateId: "p1" } }).status).toBe("REJECTED");
    const xt = quyetDinhReferral({ ...OK, nguon: { sourceGroupId: null, tu: "XEM_TAY", lyDo: "x" } });
    expect(trangThaiSauQuyNguon({ quyetDinh: xt, partyId: "p1", attribution: null }).status).toBe("MANUAL_REVIEW");
  });
});
