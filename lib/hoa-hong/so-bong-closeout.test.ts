// @vitest-environment node
/**
 * [L2-SB-*] — SO BÓNG: ba loại lệch CÓ LÝ DO RÕ + mọi thứ khác vẫn UNEXPECTED + cổng cutover chỉ chặn UNEXPECTED (AFF-L2, D-D · D-E). THUẦN.
 *
 * Ba loại lệch có quyết định (người điều phối, 13/10/2026), mỗi loại một mã RIÊNG để người đọc báo cáo thấy NGAY nó là loại nào:
 *   · chính sách theo campaign Affiliate        ⇒ AFFILIATE_CAMPAIGN_POLICY
 *   · hai engine định nghĩa «tái tục» khác nhau ⇒ EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE
 *   · Marketing đã duyệt (09/10/2026)           ⇒ MARKETING_* (đã có từ trước)
 *
 *   [L2-SB-01] fixture MỘT báo cáo đủ ba loại + một dòng "lạ" ⇒ ba mã expected riêng, đúng một UNEXPECTED, số liệu cộng đúng
 *   [L2-SB-02] cutover chỉ chặn khi UNEXPECTED > 0: báo cáo của [L2-SB-01] không có dòng lạ ⇒ không chặn; thêm một dòng lạ ⇒ chặn
 *   [L2-SB-03] D-E không nuốt đổi NGƯỜI: cùng vai, người cũ mất + người mới xuất hiện, phân loại khác ⇒ UNEXPECTED mã riêng (đối chứng: cùng người, khác số tiền ⇒ EXPECTED)
 *   [L2-SB-04] D-E không phải giấy phép chung: phân loại KHÔNG khác ⇒ chênh số tiền vẫn UNEXPECTED
 *   [L2-SB-05] bảng EXPECTED đóng: mỗi mã mới có trích dẫn + nhãn; phiên bản luật nằm trong dấu vân (đổi phiên bản ⇒ dấu đổi)
 */
import { describe, expect, it } from "vitest";

import { cacChanPrecheck } from "./cutover-kiem-tra";
import { MA_EXPECTED, PHIEN_BAN_LUAT_SO_BONG, TRICH_DAN, tongHopSoBong, type DongCu, type DongMoi, type KhoanSoBong, type NgoaiPhamViNap, type VaiDuKien } from "./so-bong";
import { NHAN_MA_EXPECTED, nhanMaSoBong } from "./so-bong-nhan";

const NGOAI: NgoaiPhamViNap = { khoanHoan: { soKhoan: 0, soTien: 0 }, khoanChuyenNoiBo: 0, khoanKhongPhaiHocPhi: { soKhoan: 0, soTien: 0 } };
const CUA_SO = { tuNgay: "2026-10-01", denNgay: "2026-10-31" };
const CS = [{ policyCode: "SR.QD.208", versionId: "v1", version: 1 }];

const cu = (roleCode: string, nguoiId: string, soTien: number): DongCu => ({ roleCode, nguoiId, soTien });
const moi = (roleCode: string, nguoiId: string, soTien: number, kind: DongMoi["kind"] = "USER"): DongMoi => ({ roleCode, kind, nguoiId, soTien });

function vai(roleCode: string, p: Partial<VaiDuKien> = {}): VaiDuKien {
  return { roleCode, trangThai: "SINH_DONG", scopeType: "GLOBAL", nguonKhongRo: false, thuHut: false, resolverType: "TRANSACTION_ROLE", coDongLoaiTruNhom: false, chinhSachCampaign: null, ...p };
}
const DU = { phienBanDaPhatHanh: true, campaignKhop: true, lienKetHopLe: true } as const;
const vaiCampaign = (): VaiDuKien => vai("AFFILIATE", { thuHut: true, scopeType: "CAMPAIGN", resolverType: "DIRECT_PERSON", chinhSachCampaign: { ...DU } });
const vaiMarketingLoaiTru = (): VaiDuKien => vai("MARKETING", { trangThai: "EXCLUDE", scopeType: "SOURCE_GROUP", resolverType: "ORG_UNIT_ROLE" });

function khoan(id: string, p: { cu?: DongCu[]; dong?: DongMoi[]; vai?: VaiDuKien[]; cuLaTaiTuc?: boolean; loaiMoi?: "NEW" | "RENEWAL" }): KhoanSoBong {
  return {
    paymentId: id,
    ngayThu: "2026-10-12",
    soTienThu: 10_000_000,
    cu: p.cu ?? [],
    cuLaTaiTuc: p.cuLaTaiTuc ?? false,
    loaiMoi: p.loaiMoi ?? "NEW",
    moi: { loai: "TINH", dong: p.dong ?? [], vai: p.vai ?? [], treoCoHangCho: [] },
  };
}

/** Ba khoản, mỗi khoản MỘT loại lệch có quyết định. */
const khoanCampaign = () => khoan("p1", { dong: [moi("AFFILIATE", "a1", 300_000, "AFFILIATE")], vai: [vaiCampaign()] });
const khoanTaiTuc = () => khoan("p2", { cuLaTaiTuc: true, loaiMoi: "NEW", cu: [], dong: [moi("SALE", "u1", 400_000)], vai: [vai("SALE")] });
const khoanMarketing = () => khoan("p3", { cu: [cu("MARKETING", "u3", 100_000)], dong: [], vai: [vaiMarketingLoaiTru()] });
/** Dòng "lạ": cùng người, cùng vai, khác số tiền, phân loại KHÔNG khác — không có quyết định nào bao phủ. */
const khoanLa = () => khoan("p4", { cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 399_000)], vai: [vai("SALE")] });

const bao = (ks: KhoanSoBong[]) => tongHopSoBong({ khoan: ks, ngoai: NGOAI, cuaSo: CUA_SO, asOf: "2026-10-31", chinhSach: CS });
const bangChung = (unexpectedDelta: number) => ({ invalidAttribution: 0, holdNghiemTrongDuKien: 0, unexpectedDelta, diTruChuaSanSang: false });

describe("[L2-SB-01] ba loại lệch, mỗi loại một mã; mọi thứ khác UNEXPECTED", () => {
  it("[L2-SB-01] campaign · tái tục kiểu cũ · Marketing đã duyệt ⇒ ba mã EXPECTED RIÊNG; dòng lạ ⇒ đúng MỘT UNEXPECTED", () => {
    const b = bao([khoanCampaign(), khoanTaiTuc(), khoanMarketing(), khoanLa()]);
    expect(Object.keys(b.expected.theoMa).sort()).toEqual(["AFFILIATE_CAMPAIGN_POLICY", "EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE", "MARKETING_REMOVED_FOR_NON_AD_SOURCE"]);
    expect(b.expected.soDong).toBe(3);
    expect(b.expected.theoMa.AFFILIATE_CAMPAIGN_POLICY).toMatchObject({ soDong: 1, moi: 300_000 });
    expect(b.expected.theoMa.EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE).toMatchObject({ soDong: 1, moi: 400_000 });
    expect(b.unexpected.soDong).toBe(1);
    expect(b.unexpected.theoMa).toHaveProperty("SO_TIEN_KHAC");
    // mỗi dòng expected mang LÝ DO nói đúng nguồn quyết định, không câu chung chung
    const lyDo = (ma: string) => b.dong.find((d) => d.ma === ma)!.lyDo;
    expect(lyDo("AFFILIATE_CAMPAIGN_POLICY")).toContain("D-D");
    expect(lyDo("EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE")).toContain("D-E");
  });
});

describe("[L2-SB-02] cổng cutover chỉ chặn UNEXPECTED > 0", () => {
  it("[L2-SB-02] ba loại có quyết định ⇒ UNEXPECTED = 0 ⇒ KHÔNG chặn; thêm một dòng lạ ⇒ CO_CHENH_BAT_NGO (đối chứng dương)", () => {
    const sach = bao([khoanCampaign(), khoanTaiTuc(), khoanMarketing()]);
    expect(sach.unexpected.soDong).toBe(0);
    expect(cacChanPrecheck(bangChung(sach.unexpected.soDong))).toEqual([]);
    const lo = bao([khoanCampaign(), khoanTaiTuc(), khoanMarketing(), khoanLa()]);
    expect(cacChanPrecheck(bangChung(lo.unexpected.soDong)).map((c) => c.ma)).toEqual(["CO_CHENH_BAT_NGO"]);
  });
});

describe("[L2-SB-03] D-E không nuốt việc ĐỔI NGƯỜI", () => {
  it("phân loại khác nhau NHƯNG cùng vai: người cũ mất, người mới xuất hiện ⇒ UNEXPECTED DOI_NGUOI_CUNG_VAI_KHI_PHAN_LOAI_KHAC cho CẢ HAI dòng", () => {
    const k = khoan("p5", { cuLaTaiTuc: false, loaiMoi: "RENEWAL", cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u2", 400_000)], vai: [vai("SALE")] });
    const b = bao([k]);
    expect(b.expected.soDong).toBe(0);
    expect(b.unexpected.soDong).toBe(2);
    expect(Object.keys(b.unexpected.theoMa)).toEqual(["DOI_NGUOI_CUNG_VAI_KHI_PHAN_LOAI_KHAC"]);
  });
  it("đối chứng dương: cùng người, khác số tiền, phân loại khác ⇒ EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE", () => {
    const k = khoan("p6", { cuLaTaiTuc: false, loaiMoi: "RENEWAL", cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 100_000)], vai: [vai("SALE")] });
    const b = bao([k]);
    expect(b.unexpected.soDong).toBe(0);
    expect(b.expected.theoMa).toHaveProperty("EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE");
  });
  it("khoản có HAI vai: vai A đổi người (UNEXPECTED), vai B chỉ đổi số tiền (EXPECTED) — phán đoán theo TỪNG VAI, không theo cả khoản", () => {
    const k = khoan("p7", {
      cuLaTaiTuc: false,
      loaiMoi: "RENEWAL",
      cu: [cu("SALE", "u1", 400_000), cu("CENTER_MANAGER", "u9", 200_000)],
      dong: [moi("SALE", "u2", 400_000), moi("CENTER_MANAGER", "u9", 100_000)],
      vai: [vai("SALE"), vai("CENTER_MANAGER")],
    });
    const b = bao([k]);
    expect(b.dong.filter((d) => d.roleCode === "SALE").every((d) => d.loai === "UNEXPECTED")).toBe(true);
    expect(b.dong.find((d) => d.roleCode === "CENTER_MANAGER")).toMatchObject({ loai: "EXPECTED_BUSINESS_DELTA", ma: "EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE" });
  });
});

describe("[L2-SB-04] D-E không phải giấy phép chung", () => {
  it("phân loại KHÔNG khác (cả hai cùng 'học viên mới') ⇒ chênh số tiền VẪN UNEXPECTED", () => {
    const b = bao([khoan("p8", { cuLaTaiTuc: false, loaiMoi: "NEW", cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 100_000)], vai: [vai("SALE")] })]);
    expect(b.expected.soDong).toBe(0);
    expect(b.unexpected.soDong).toBe(1);
  });
  it("khoản chưa tính được (GIU / lỗi cấu hình) không có dòng EXPECTED nào dù phân loại lệch", () => {
    const k: KhoanSoBong = { paymentId: "p9", ngayThu: "2026-10-12", soTienThu: 1, cu: [cu("SALE", "u1", 1)], cuLaTaiTuc: true, loaiMoi: "NEW", moi: { loai: "LOI_CAU_HINH", ma: "VUOT_TRAN", lyDo: "x" } };
    const b = bao([k]);
    expect(b.expected.soDong).toBe(0);
    expect(b.unexpected.soDong).toBe(1);
  });
});

describe("[L2-SB-04b] D-E không che TIỀN BIẾN MẤT: vai TREO / vai không còn ở engine mới", () => {
  it("phân loại khác + vai TREO (engine mới không trả vì ngoài cửa sổ) + phía cũ ĐÃ trả ⇒ UNEXPECTED MAT_DONG_TREO — không phải EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE", () => {
    for (const tt of ["TREO"] as const) {
      const k = khoan("p10", { cuLaTaiTuc: false, loaiMoi: "RENEWAL", cu: [cu("REFERRER_PARENT", "u1", 200_000)], dong: [], vai: [vai("REFERRER_PARENT", { trangThai: tt })] });
      const b = bao([k]);
      expect(b.expected.soDong, tt).toBe(0);
      expect(b.unexpected.soDong, tt).toBe(1);
      expect(b.unexpected.theoMa, tt).toHaveProperty("MAT_DONG_TREO");
      // và cổng cutover thật sự chặn (đây là điều bản cũ làm im)
      expect(cacChanPrecheck(bangChung(b.unexpected.soDong)).map((c) => c.ma)).toEqual(["CO_CHENH_BAT_NGO"]);
    }
  });
  it("vai KHÔNG còn tồn tại ở engine mới (không có trong danh sách vai) + phân loại khác ⇒ UNEXPECTED, không EXPECTED", () => {
    const k = khoan("p11", { cuLaTaiTuc: false, loaiMoi: "RENEWAL", cu: [cu("SALE", "u1", 400_000)], dong: [], vai: [] });
    const b = bao([k]);
    expect(b.expected.soDong).toBe(0);
    expect(b.unexpected.soDong).toBe(1);
  });
  it("đối chứng dương: cùng cảnh phân loại khác nhưng vai SINH_DONG (engine mới VẪN trả, chỉ khác số tiền) ⇒ vẫn EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE", () => {
    const k = khoan("p12", { cuLaTaiTuc: false, loaiMoi: "RENEWAL", cu: [cu("REFERRER_PARENT", "u1", 200_000)], dong: [moi("REFERRER_PARENT", "u1", 100_000)], vai: [vai("REFERRER_PARENT")] });
    const b = bao([k]);
    expect(b.unexpected.soDong).toBe(0);
    expect(b.expected.theoMa).toHaveProperty("EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE");
  });
});

describe("[L2-SB-05] bảng EXPECTED đóng", () => {
  it("hai mã mới có trích dẫn tài liệu + nhãn tiếng Việt; phiên bản luật là v6 và nằm trong dấu vân", () => {
    for (const ma of ["AFFILIATE_CAMPAIGN_POLICY", "EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE"] as const) {
      expect(MA_EXPECTED).toContain(ma);
      expect(TRICH_DAN[ma].length).toBeGreaterThan(40);
      expect(NHAN_MA_EXPECTED[ma].length).toBeGreaterThan(10);
      expect(nhanMaSoBong(ma)).toBe(NHAN_MA_EXPECTED[ma]);
    }
    expect(PHIEN_BAN_LUAT_SO_BONG).toBe("2026-10-26.v6");
    const b = bao([khoanCampaign()]);
    expect(b.phienBanLuat).toBe(PHIEN_BAN_LUAT_SO_BONG);
    expect(bao([khoanCampaign()]).dauVan).toBe(b.dauVan);
  });
});

describe("[L2-SB-06] chính sách campaign chỉ giải thích dòng do CHÍNH RULE ấy sinh/loại", () => {
  it("vai TREO (chưa có người) dù rule thắng là CAMPAIGN đủ điều kiện, mà engine cũ đang trả ⇒ UNEXPECTED MAT_DONG_TREO — mất tiền vì thiếu người không phải 'chính sách campaign'; đối chứng: SINH_DONG thì EXPECTED", () => {
    const k = (trangThai: VaiDuKien["trangThai"], dong: DongMoi[]) =>
      khoan("p10", { cu: [cu("AFFILIATE", "a1", 300_000)], dong, vai: [vai("AFFILIATE", { thuHut: true, scopeType: "CAMPAIGN", trangThai, chinhSachCampaign: { ...DU } })] });
    const treo = bao([k("TREO", [])]);
    expect(treo.expected.soDong).toBe(0);
    expect(treo.dong[0]).toMatchObject({ loai: "UNEXPECTED", ma: "MAT_DONG_TREO" });
    const sinh = bao([k("SINH_DONG", [moi("AFFILIATE", "a1", 100_000, "AFFILIATE")])]);
    expect(sinh.dong[0]).toMatchObject({ loai: "EXPECTED_BUSINESS_DELTA", ma: "AFFILIATE_CAMPAIGN_POLICY" });
  });
});
