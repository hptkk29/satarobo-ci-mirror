// @vitest-environment node
/**
 * [AFL1-F*] — MÔ HÌNH FORM của trình soạn chính sách: phạm vi CAMPAIGN + kiểu «Cố định (số tiền)» (AFF-L1). Thuần.
 *
 *   [AFL1-F1] phạm vi CAMPAIGN: lưu nháp đòi chọn campaign; payload mang `{loai:"CAMPAIGN", campaignId}`; đảo ngược từ version CAMPAIGN KHÔNG nói «chưa soạn được»
 *   [AFL1-F2] `formChoCampaign` chỉ dựng sẵn thứ có thật (vai AFFILIATE / loại NEW) và để TRỐNG ngày · lý do · văn bản · tỉ lệ (quyết định của người soạn)
 *   [AFL1-F3] kiểu FIXED: số tiền đọc/kiểm đúng; kiểu guardrail còn chặn thì KHÔNG lưu được dù client gửi thẳng; kiểu mở thì thành rule FIXED_PER_PURCHASE
 *   [AFL1-F4] ví dụ tính + tổng tỉ lệ: số tiền cố định vào TIỀN ví dụ, KHÔNG vào tổng tỉ lệ
 *   [AFL1-F5] map lỗi máy chủ «campaign không tồn tại» về đúng ô
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { anhXaLoiMayChu, docSoTien, dungPayload, formChoCampaign, formRong, formTuPhienBan, kieuODungDuoc, kiemForm, loiLuuNhap, type FormChinhSach } from "./chinh-sach-form";
import { KIEU_TINH_CHUA_HO_TRO } from "./guardrail-kich-hoat";
import { tongTheoLoai, viDuTinh } from "./vi-du-tinh";

afterEach(() => vi.restoreAllMocks());

const formCamp = (p: Partial<FormChinhSach> = {}): FormChinhSach => ({
  ...formRong(),
  policyCode: "AFF-TET_2027",
  name: "Hoa hồng Affiliate — Tết",
  phamVi: { loai: "CAMPAIGN", campaignId: "c1" },
  loaiGd: ["NEW"],
  vai: ["AFFILIATE"],
  o: { "NEW|AFFILIATE": { kieu: "PERCENT", phanTram: "3" } },
  vanBan: { kieu: "co-san", id: "vb1" },
  hieuLucTu: "2026-11-01",
  hieuLucDen: "",
  lyDo: "Theo quy chế",
  ...p,
});
const truong = (f: FormChinhSach) => loiLuuNhap(f).map((l) => l.truong);

describe("[AFL1-F1] phạm vi CAMPAIGN", () => {
  it("chọn CAMPAIGN mà chưa chọn campaign ⇒ lỗi ở ô phamVi.campaignId; đã chọn ⇒ sạch; kiểm đầy đủ cũng đạt", () => {
    expect(truong(formCamp({ phamVi: { loai: "CAMPAIGN", campaignId: "" } }))).toEqual(["phamVi.campaignId"]);
    expect(loiLuuNhap(formCamp())).toEqual([]);
    expect(kiemForm(formCamp())).toEqual([]);
  });
  it("payload mang đúng phạm vi CAMPAIGN và rule AFFILIATE 0.03; schema chấp nhận biến thể mới", () => {
    const r = dungPayload(formCamp());
    if (!r.ok) throw new Error(JSON.stringify(r.loi));
    expect(r.payload.phamVi).toEqual({ loai: "CAMPAIGN", campaignId: "c1" });
    expect(r.payload.rules.map((x) => [x.transactionTypeCode, x.roleCode, x.calcKind, x.rate])).toEqual([["NEW", "AFFILIATE", "PERCENT", "0.03"]]);
  });
  it("đảo ngược version CAMPAIGN: ra form CAMPAIGN, KHÔNG có dòng «chưa soạn được ở màn này»; các phạm vi khác vẫn nói thẳng", () => {
    const goc = {
      policyCode: "AFF-X",
      name: "X",
      description: null,
      ownerOrgUnitId: null,
      effectiveFrom: new Date("2026-10-31T17:00:00.000Z"),
      effectiveTo: null,
      reason: "r",
      documentId: null,
      rules: [{ transactionTypeCode: "NEW", roleCode: "AFFILIATE", calcKind: "PERCENT" as const, rate: "0.030000", fixedAmount: null }],
    };
    const a = formTuPhienBan({ ...goc, scope: { scopeType: "CAMPAIGN", scopeSourceGroupId: null, scopeOrgUnitId: null, scopeCampaignId: "c9" } });
    expect(a.khongBieuDienDuoc).toEqual([]);
    expect(a.form.phamVi).toEqual({ loai: "CAMPAIGN", campaignId: "c9" });
    expect(a.form.o["NEW|AFFILIATE"]).toEqual({ kieu: "PERCENT", phanTram: "3" });
    const b = formTuPhienBan({ ...goc, scope: { scopeType: "PERSON", scopeSourceGroupId: null, scopeOrgUnitId: null, scopeCampaignId: null } });
    expect(b.khongBieuDienDuoc.join()).toContain("PERSON");
  });
});

describe("[AFL1-F2] formChoCampaign", () => {
  const c = { id: "c1", code: "TET_2027", name: "Tết 2027" };
  it("dựng sẵn phạm vi · vai AFFILIATE · loại NEW · mã/tên gợi ý; để TRỐNG ngày hiệu lực, lý do, văn bản, tỉ lệ", () => {
    const f = { ...formRong(), ...formChoCampaign(c, { coVaiAffiliate: true, coLoaiNew: true }) };
    expect(f).toMatchObject({ policyCode: "AFF-TET_2027", name: "Hoa hồng Affiliate — Tết 2027", phamVi: { loai: "CAMPAIGN", campaignId: "c1" }, vai: ["AFFILIATE"], loaiGd: ["NEW"] });
    expect(f.hieuLucTu).toBe("");
    expect(f.lyDo).toBe("");
    expect(f.vanBan).toEqual({ kieu: "chua" });
    expect(f.o).toEqual({});
    // mã gợi ý hợp lệ với bộ kiểm mã chính sách
    expect(truong(f).includes("policyCode")).toBe(false);
  });
  it("vai/loại đang tắt ⇒ KHÔNG dựng sẵn (guardrail sẽ chặn thứ đó)", () => {
    const f = formChoCampaign(c, { coVaiAffiliate: false, coLoaiNew: false });
    expect(f.vai).toEqual([]);
    expect(f.loaiGd).toEqual([]);
  });
});

describe("[AFL1-F3] kiểu cố định (số tiền)", () => {
  it("docSoTien: bỏ dấu ngăn nghìn, từ chối chữ / âm / thập phân / 0", () => {
    expect(docSoTien("500000")).toEqual({ kieu: "ok", soTien: 500_000 });
    expect(docSoTien("500.000")).toEqual({ kieu: "ok", soTien: 500_000 });
    expect(docSoTien(" 1,500,000 ")).toEqual({ kieu: "ok", soTien: 1_500_000 });
    expect(docSoTien("")).toEqual({ kieu: "trong" });
    expect(docSoTien(undefined)).toEqual({ kieu: "trong" });
    for (const xau of ["abc", "-5", "1.5e3", "0", "0000", "1234567890123"]) expect(docSoTien(xau).kieu, xau).toBe("loi");
  });
  it("`kieuODungDuoc` tự theo hằng của guardrail; EXCLUDE và PERCENT luôn được", () => {
    expect(kieuODungDuoc("PERCENT")).toBe(true);
    expect(kieuODungDuoc("EXCLUDE")).toBe(true);
    expect(kieuODungDuoc("FIXED_PER_PURCHASE")).toBe(!(KIEU_TINH_CHUA_HO_TRO as readonly string[]).includes("FIXED_PER_PURCHASE"));
  });
  const cố = (soTien: string) => formCamp({ o: { "NEW|AFFILIATE": { kieu: "FIXED_PER_PURCHASE", phanTram: "", soTien } } });
  it("khi guardrail còn chặn FIXED: lưu nháp BỊ TỪ CHỐI dù client gửi thẳng (ô khoá phải khoá thật); khi mở: thành rule FIXED_PER_PURCHASE", () => {
    const f = cố("500000");
    if (!kieuODungDuoc("FIXED_PER_PURCHASE")) {
      expect(loiLuuNhap(f).map((l) => l.truong)).toEqual(["o.NEW|AFFILIATE"]);
      expect(loiLuuNhap(f)[0]!.thongBao).toContain("chưa kích hoạt được");
      expect(dungPayload(f).ok).toBe(false);
    } else {
      const r = dungPayload(f);
      if (!r.ok) throw new Error(JSON.stringify(r.loi));
      expect(r.payload.rules[0]).toMatchObject({ calcKind: "FIXED_PER_PURCHASE", fixedAmount: 500_000, rate: null });
    }
  });
  it("khi mở FIXED (giả lập bằng cách đẩy hằng rỗng): số tiền hợp lệ ⇒ rule đúng; gõ sai ⇒ lỗi ở ô; ô trống ⇒ KHÔNG rule; đảo ngược trả đúng số tiền", async () => {
    vi.resetModules();
    vi.doMock("./guardrail-kich-hoat", () => ({ KIEU_TINH_CHUA_HO_TRO: [] as const }));
    const m = await import("./chinh-sach-form");
    expect(m.kieuODungDuoc("FIXED_PER_PURCHASE")).toBe(true);
    const ok = m.dungPayload(cố("500000"));
    if (!ok.ok) throw new Error(JSON.stringify(ok.loi));
    expect(ok.payload.rules[0]).toMatchObject({ transactionTypeCode: "NEW", roleCode: "AFFILIATE", calcKind: "FIXED_PER_PURCHASE", fixedAmount: 500_000, rate: null });
    expect(m.loiLuuNhap(cố("abc")).map((l) => l.truong)).toEqual(["o.NEW|AFFILIATE"]);
    const trong = m.dungPayload(cố(""));
    if (!trong.ok) throw new Error(JSON.stringify(trong.loi));
    expect(trong.payload.rules).toHaveLength(0);
    // kiểm đầy đủ: vai chỉ có ô cố định trống ⇒ nhắc nhập; có số ⇒ đủ
    expect(m.kiemForm(cố("")).map((l) => l.truong)).toContain("o.NEW|AFFILIATE");
    expect(m.kiemForm(cố("500000"))).toEqual([]);
    const ngc = m.formTuPhienBan({
      policyCode: "AFF-X",
      name: "X",
      description: null,
      ownerOrgUnitId: null,
      effectiveFrom: new Date("2026-10-31T17:00:00.000Z"),
      effectiveTo: null,
      reason: "r",
      documentId: null,
      scope: { scopeType: "CAMPAIGN", scopeSourceGroupId: null, scopeOrgUnitId: null, scopeCampaignId: "c1" },
      rules: [{ transactionTypeCode: "NEW", roleCode: "AFFILIATE", calcKind: "FIXED_PER_PURCHASE", rate: null, fixedAmount: 750_000 }],
    });
    expect(ngc.khongBieuDienDuoc).toEqual([]);
    expect(ngc.form.o["NEW|AFFILIATE"]).toEqual({ kieu: "FIXED_PER_PURCHASE", phanTram: "", soTien: "750000" });
    vi.doUnmock("./guardrail-kich-hoat");
    vi.resetModules();
  });
  it("TIER (thưởng theo bậc) và FIXED thiếu số tiền vẫn nói «chưa soạn được ở màn này» (không biến thành ô trống)", () => {
    const goc = {
      policyCode: "AFF-X",
      name: "X",
      description: null,
      ownerOrgUnitId: null,
      effectiveFrom: new Date("2026-10-31T17:00:00.000Z"),
      effectiveTo: null,
      reason: "r",
      documentId: null,
      scope: { scopeType: "GLOBAL", scopeSourceGroupId: null, scopeOrgUnitId: null, scopeCampaignId: null },
    };
    const t = formTuPhienBan({ ...goc, rules: [{ transactionTypeCode: "NEW", roleCode: "SALE", calcKind: "TIER_PERIOD_BONUS", rate: null, fixedAmount: null }] });
    expect(t.khongBieuDienDuoc.join()).toContain("TIER_PERIOD_BONUS");
    const f = formTuPhienBan({ ...goc, rules: [{ transactionTypeCode: "NEW", roleCode: "SALE", calcKind: "FIXED_PER_PURCHASE", rate: null, fixedAmount: null }] });
    expect(f.khongBieuDienDuoc.join()).toContain("FIXED_PER_PURCHASE");
  });
});

describe("[AFL1-F4] ví dụ tính: số tiền cố định", () => {
  const ff = formCamp({
    vai: ["AFFILIATE", "SALE"],
    o: { "NEW|AFFILIATE": { kieu: "FIXED_PER_PURCHASE", phanTram: "", soTien: "500000" }, "NEW|SALE": { kieu: "PERCENT", phanTram: "4" } },
  });
  it("tiền ví dụ = số cố định cho vai FIXED, % × cơ sở cho vai PERCENT; tổng TỈ LỆ chỉ cộng vai PERCENT", () => {
    const [t] = tongTheoLoai(ff, 0.09);
    expect(t).toMatchObject({ loai: "NEW", tongPhanTram: "4", vuotTran: false });
    const [vd] = viDuTinh(ff, 10_000_000, 0.09);
    expect(vd!.vai.find((v) => v.code === "AFFILIATE")).toEqual({ code: "AFFILIATE", tien: 500_000, loaiTru: false });
    expect(vd!.vai.find((v) => v.code === "SALE")).toEqual({ code: "SALE", tien: 400_000, loaiTru: false });
    expect(vd!.tongTien).toBe(900_000);
  });
});

describe("[AFL1-F5] lỗi máy chủ → ô", () => {
  it("«Campaign Affiliate … không tồn tại» ⇒ ô phamVi.campaignId (không rơi vào ô chung)", () => {
    const r = anhXaLoiMayChu({ kieu: "hoa-hong", ma: "DU_LIEU_KHONG_HOP_LE", message: "Campaign Affiliate c9 không tồn tại." });
    expect(r.loi.map((l) => l.truong)).toEqual(["phamVi.campaignId"]);
    expect(r.chung).toBeNull();
  });
});
