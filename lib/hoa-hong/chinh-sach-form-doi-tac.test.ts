// @vitest-environment node
/**
 * [CSDT-*] — MÔ HÌNH FORM của trình soạn chính sách: phạm vi AFFILIATE = MỨC RIÊNG MỘT ĐỐI TÁC (chủ dự án 22/11/2026: «đối tác 1: 3%, đối tác 2: 2%… admin
 * kiểm soát và setting theo từng thời gian»). Thuần. Đầu-cuối form → lưu → kích hoạt → engine: `[L2-DB-E2]` (tests/hoa-hong/affiliate-engine-closeout.spec.ts).
 *
 *   [CSDT-01] chọn «Mức riêng một đối tác» mà chưa chọn đối tác ⇒ lỗi ở ô `phamVi.affiliateId` (bước Bối cảnh); đã chọn ⇒ sạch; schema nhận biến thể
 *   [CSDT-02] payload mang ĐÚNG `{loai:"AFFILIATE", affiliateId}` (không rơi xuống ORG_UNIT của nhánh cuối)
 *   [CSDT-03] đảo ngược version AFFILIATE: KHÔNG «chưa soạn được ở màn này»; vòng form → payload → form giữ nguyên
 *   [CSDT-04] lỗi máy chủ «Affiliate … không tồn tại» về ô đối tác; «Campaign Affiliate … không tồn tại» VẪN về ô campaign (neo đầu câu)
 */
import { describe, expect, it } from "vitest";
import { anhXaLoiMayChu, buocCuaTruong, dungPayload, formChinhSachSchema, formRong, formTuPhienBan, kiemForm, loiLuuNhap, type FormChinhSach } from "./chinh-sach-form";

const formDt = (p: Partial<FormChinhSach> = {}): FormChinhSach => ({
  ...formRong(),
  policyCode: "SR.QD.300/DT1",
  name: "Mức riêng đối tác 1",
  phamVi: { loai: "AFFILIATE", affiliateId: "dt1" },
  loaiGd: ["NEW"],
  vai: ["AFFILIATE"],
  o: { "NEW|AFFILIATE": { kieu: "PERCENT", phanTram: "3" } },
  vanBan: { kieu: "co-san", id: "vb1" },
  hieuLucTu: "2026-12-01",
  hieuLucDen: "",
  lyDo: "Theo quyết định mức riêng",
  ...p,
});

describe("[CSDT-01] phạm vi «Mức riêng một đối tác»", () => {
  it("chưa chọn đối tác ⇒ lỗi đúng ô, ở bước Bối cảnh; đã chọn ⇒ sạch cả lưu nháp lẫn kiểm đủ; schema nhận", () => {
    const l = loiLuuNhap(formDt({ phamVi: { loai: "AFFILIATE", affiliateId: "" } }));
    expect(l.map((x) => [x.truong, x.buoc])).toEqual([["phamVi.affiliateId", "boi-canh"]]);
    expect(buocCuaTruong("phamVi.affiliateId")).toBe("boi-canh");
    expect(loiLuuNhap(formDt())).toEqual([]);
    expect(kiemForm(formDt())).toEqual([]);
    expect(formChinhSachSchema.safeParse(formDt()).success).toBe(true);
  });
});

describe("[CSDT-02] payload", () => {
  it("phạm vi AFFILIATE + rule AFFILIATE 3% + ngày hiệu lực (biên đầu ngày VN)", () => {
    const r = dungPayload(formDt());
    if (!r.ok) throw new Error(JSON.stringify(r.loi));
    expect(r.payload.phamVi).toEqual({ loai: "AFFILIATE", affiliateId: "dt1" });
    expect(r.payload.rules.map((x) => [x.transactionTypeCode, x.roleCode, x.calcKind, x.rate])).toEqual([["NEW", "AFFILIATE", "PERCENT", "0.03"]]);
    expect(r.payload.effectiveFrom.toISOString()).toBe("2026-11-30T17:00:00.000Z");
  });
});

describe("[CSDT-03] đảo ngược từ version đã lưu", () => {
  const goc = {
    policyCode: "SR.QD.300/DT1",
    name: "Mức riêng đối tác 1",
    description: null,
    ownerOrgUnitId: null,
    effectiveFrom: new Date("2026-11-30T17:00:00.000Z"),
    effectiveTo: null,
    reason: "Theo quyết định mức riêng",
    documentId: "vb1",
    rules: [{ transactionTypeCode: "NEW", roleCode: "AFFILIATE", calcKind: "PERCENT" as const, rate: "0.030000", fixedAmount: null }],
  };
  it("version AFFILIATE mở ra đúng phạm vi + đối tác; không «chưa soạn được»; vòng payload giữ nguyên", () => {
    const a = formTuPhienBan({ ...goc, scope: { scopeType: "AFFILIATE", scopeSourceGroupId: null, scopeOrgUnitId: null, scopeCampaignId: null, scopeAffiliateId: "dt9" } });
    expect(a.khongBieuDienDuoc).toEqual([]);
    expect(a.form.phamVi).toEqual({ loai: "AFFILIATE", affiliateId: "dt9" });
    const p1 = dungPayload(a.form);
    if (!p1.ok) throw new Error(JSON.stringify(p1.loi));
    expect(p1.payload.phamVi).toEqual({ loai: "AFFILIATE", affiliateId: "dt9" });
  });
  it("version AFFILIATE thiếu id đối tác (dữ liệu hỏng) ⇒ NÓI RÕ, không lặng lẽ thành GLOBAL", () => {
    const b = formTuPhienBan({ ...goc, scope: { scopeType: "AFFILIATE", scopeSourceGroupId: null, scopeOrgUnitId: null, scopeCampaignId: null, scopeAffiliateId: null } });
    expect(b.khongBieuDienDuoc.join()).toContain("AFFILIATE");
  });
});

describe("[CSDT-04] lỗi máy chủ về đúng ô", () => {
  const map = (message: string) => anhXaLoiMayChu({ kieu: "hoa-hong", ma: "DU_LIEU_KHONG_HOP_LE", message }).loi.map((l) => l.truong);
  it("«Affiliate … không tồn tại» ⇒ ô đối tác; «Campaign Affiliate … không tồn tại» ⇒ ô campaign", () => {
    expect(map("Affiliate dt9 không tồn tại.")).toEqual(["phamVi.affiliateId"]);
    expect(map("Campaign Affiliate c9 không tồn tại.")).toEqual(["phamVi.campaignId"]);
  });
});
