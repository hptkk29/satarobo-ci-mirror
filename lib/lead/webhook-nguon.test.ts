/**
 * Ca [NHH-SRC-WH-*] — `extractNguonFields`: rút TÍN HIỆU NGUỒN (quảng cáo/page) từ payload webhook. THUẦN.
 *
 * Vì sao có (luật 14): hàm này là cổng DUY NHẤT đưa ad_id/campaign/form/page của Facebook vào resolver, mà trước lượt cấy lỗi
 * không ca nào khoá TỪNG khoá của nó — gỡ alias `adgroup_id`, gỡ đọc `field_data`, hay gỡ `page_id` đều cho 0 ca đỏ (ca DB
 * [NHH-SRC-07a] chỉ đi một đường payload phẳng có ad_id/campaign_id/form_id).
 */
import { describe, expect, it, vi } from "vitest";

// Cô lập khỏi db/ingest (chỉ test hàm thuần).
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("./ingest", () => ({ ingestLead: vi.fn() }));

import { KHONG_CO_TIN_HIEU_NGUON } from "@/lib/nguon/tin-hieu";
import { extractNguonFields } from "./webhook";

describe("[NHH-SRC-WH-01] extractNguonFields — payload PHẲNG: từng khoá + alias camelCase", () => {
  it("snake_case đủ khoá ⇒ đúng ô, kể cả alias adgroup_id → adsetId", () => {
    const r = extractNguonFields({
      ad_id: "AD1",
      campaign_id: "CP1",
      adgroup_id: "AS1",
      campaign_name: "CS1_DN",
      form_id: "F1",
      fbclid: "fb-1",
      gclid: "g-1",
      page_id: "PG1",
    });
    expect(r.quangCao).toEqual({
      adId: "AD1",
      campaignId: "CP1",
      adsetId: "AS1",
      campaignName: "CS1_DN",
      formId: "F1",
      fbclid: "fb-1",
      gclid: "g-1",
    });
    expect(r.pageId).toBe("PG1");
  });

  it("alias adset_id và adgroupId (camelCase) cũng vào adsetId", () => {
    expect(extractNguonFields({ adset_id: "AS2", ad_id: "A" }).quangCao.adsetId).toBe("AS2");
    expect(extractNguonFields({ adgroupId: "AS3", adId: "A" }).quangCao.adsetId).toBe("AS3");
  });

  it("camelCase đủ khoá (adId · campaignId · campaignName · formId · pageId)", () => {
    const r = extractNguonFields({ adId: "AD1", campaignId: "CP1", campaignName: "N", formId: "F1", pageId: "PG1" });
    expect(r.quangCao).toMatchObject({ adId: "AD1", campaignId: "CP1", campaignName: "N", formId: "F1" });
    expect(r.pageId).toBe("PG1");
  });

  it("page_id MỘT mình (không quảng cáo nào) ⇒ vẫn là tín hiệu (page mapping)", () => {
    const r = extractNguonFields({ page_id: "PG9" });
    expect(r.pageId).toBe("PG9");
    expect(r).not.toBe(KHONG_CO_TIN_HIEU_NGUON);
  });

  it("số được đọc như chuỗi (Meta gửi id dạng số)", () => {
    expect(extractNguonFields({ ad_id: 123456 }).quangCao.adId).toBe("123456");
  });
});

describe("[NHH-SRC-WH-02] extractNguonFields — dạng `field_data` của Facebook Lead Ads", () => {
  it("khoá nằm trong field_data (values[] hoặc value), tên khoá so không phân biệt hoa thường", () => {
    const r = extractNguonFields({
      field_data: [
        { name: "AD_ID", values: ["AD7"] },
        { name: "campaign_id", value: "CP7" },
        { name: "Page_Id", values: ["PG7"] },
      ],
    });
    expect(r.quangCao.adId).toBe("AD7");
    expect(r.quangCao.campaignId).toBe("CP7");
    expect(r.pageId).toBe("PG7");
  });

  it("khoá ở payload phẳng THẮNG khoá cùng tên trong field_data", () => {
    const r = extractNguonFields({ ad_id: "PHANG", field_data: [{ name: "ad_id", values: ["TRONG"] }] });
    expect(r.quangCao.adId).toBe("PHANG");
  });
});

describe("[NHH-SRC-WH-03] extractNguonFields — không có tín hiệu nào ⇒ KHONG_CO_TIN_HIEU_NGUON (hành vi cũ), không ném", () => {
  it.each([[null], [undefined], ["chuỗi"], [42], [{}], [{ name: "A", phone: "0901234567" }]])("%j", (payload) => {
    expect(extractNguonFields(payload)).toBe(KHONG_CO_TIN_HIEU_NGUON);
  });

  it("chuỗi toàn khoảng trắng không phải tín hiệu", () => {
    expect(extractNguonFields({ ad_id: "   ", page_id: "" })).toBe(KHONG_CO_TIN_HIEU_NGUON);
  });

  it("KHÔNG mang PII: payload có tên/SĐT/email thì kết quả không chứa chúng", () => {
    const r = extractNguonFields({ ad_id: "AD1", full_name: "Nguyễn Văn A", phone: "0901234567", email: "a@b.vn" });
    expect(JSON.stringify(r)).not.toMatch(/0901234567|@|Nguyễn/);
  });
});

describe("[NHH-SRC-WH-04] extractNguonFields — `platform` (fb / ig / messenger… của Meta Lead Ads), TUỲ CHỌN 09/10/2026", () => {
  it("có platform + tín hiệu quảng cáo ⇒ platform nằm trong quangCao (snake và field_data)", () => {
    expect(extractNguonFields({ ad_id: "AD1", platform: "ig" }).quangCao.platform).toBe("ig");
    expect(extractNguonFields({ ad_id: "AD1", field_data: [{ name: "Platform", values: ["fb"] }] }).quangCao.platform).toBe("fb");
  });

  it("TƯƠNG THÍCH NGƯỢC: payload không có platform ⇒ quangCao KHÔNG có khoá platform (toEqual cũ giữ nguyên)", () => {
    const r = extractNguonFields({ ad_id: "AD1", campaign_id: "CP1" });
    expect("platform" in r.quangCao).toBe(false);
  });

  it("platform MỘT mình KHÔNG phải tín hiệu quảng cáo (như UTM một mình) ⇒ KHONG_CO_TIN_HIEU_NGUON", () => {
    expect(extractNguonFields({ platform: "fb" })).toBe(KHONG_CO_TIN_HIEU_NGUON);
  });

  it("platform đi cùng page_id (tín hiệu page) vẫn được giữ", () => {
    const r = extractNguonFields({ page_id: "PG1", platform: "fb" });
    expect(r.pageId).toBe("PG1");
    expect(r.quangCao.platform).toBe("fb");
  });

  it("chuỗi platform bị CẮT ở 40 ký tự (không bơm chuỗi lớn vào sổ nguồn — cùng tinh thần ca 09d của nguon-noi-day-duong)", () => {
    const r = extractNguonFields({ ad_id: "AD1", platform: "x".repeat(500) });
    expect(r.quangCao.platform).toHaveLength(40);
  });

  it("platform toàn khoảng trắng ⇒ coi như không có", () => {
    expect("platform" in extractNguonFields({ ad_id: "AD1", platform: "   " }).quangCao).toBe(false);
  });
});
