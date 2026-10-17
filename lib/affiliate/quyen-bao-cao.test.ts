/**
 * [AFR-QBC-*] — `quyenBaoCaoTuScope`: ánh xạ quyền → khối của «Hiệu quả» (AFF-P3 H1). Mỗi khối có ĐỐI CHỨNG DƯƠNG (có khoá ⇒ true) và ÂM (thiếu khoá ⇒ false), vì một ca chỉ khẳng định
 * «thiếu quyền thì không thấy» luôn ĐẠT khi hàm hỏng hoàn toàn (luật 11).
 */
import { describe, expect, it } from "vitest";

import { dungNguonHoaHongScope, type ModuleKey } from "@/lib/nguon-hoa-hong/scope";
import { quyenBaoCaoTuScope } from "./quyen-bao-cao";

const scope = (quyen: ModuleKey[], engine = true) =>
  dungNguonHoaHongScope({
    quyen: new Set(quyen),
    co: { nguon: true, engine, affiliate: true },
    centerIds: { Lead: "ALL", CommissionPeriod: "ALL", CommissionTransaction: "ALL" },
    cacCoSo: [],
  } as Parameters<typeof dungNguonHoaHongScope>[0]);

describe("[AFR-QBC-01] quyenBaoCaoTuScope", () => {
  it("lượt bấm ⇐ khoá tab Link (affiliates:view HOẶC affiliate_links:manage); không có ⇒ false", () => {
    expect(quyenBaoCaoTuScope(scope(["affiliates:view"])).luotBam).toBe(true);
    expect(quyenBaoCaoTuScope(scope(["affiliate_links:manage"])).luotBam).toBe(true);
    expect(quyenBaoCaoTuScope(scope(["affiliate_campaigns:view", "affiliate_referrals:view-org", "commission:view-center"])).luotBam).toBe(false);
  });

  it("referral ⇐ khoá tab Referral (view-org HOẶC manage); chỉ có xem campaign ⇒ false", () => {
    expect(quyenBaoCaoTuScope(scope(["affiliate_referrals:view-org"])).referral).toBe(true);
    expect(quyenBaoCaoTuScope(scope(["affiliate_referrals:manage"])).referral).toBe(true);
    expect(quyenBaoCaoTuScope(scope(["affiliate_campaigns:view", "affiliates:view"])).referral).toBe(false);
  });

  it("hoa hồng ⇐ view-center VÀ engine bật; chỉ view-self, hoặc engine tắt ⇒ false (hai vế đều có ca âm)", () => {
    expect(quyenBaoCaoTuScope(scope(["commission:view-center"], true)).hoaHong).toBe(true);
    expect(quyenBaoCaoTuScope(scope(["commission:view-center"], false)).hoaHong).toBe(false);
    expect(quyenBaoCaoTuScope(scope(["commission:view-self"], true)).hoaHong).toBe(false);
  });

  it("ba khối độc lập: Giám đốc (xem campaign + đối tác, không referral, không sổ) ⇒ chỉ lượt bấm", () => {
    expect(quyenBaoCaoTuScope(scope(["affiliates:view", "affiliate_campaigns:view", "affiliate_campaigns:activate"]))).toEqual({ luotBam: true, referral: false, hoaHong: false });
  });
});
