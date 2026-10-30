// @vitest-environment node
// lib/ai-lead/dich-vu/hoi-thoai.test.ts — QUY TẮC ghi tên Facebook vào hội thoại. THUẦN. Mã ca: [AIL-HT-01..]
import { describe, expect, it } from "vitest";
import { tenSeGhi } from "./hoi-thoai";

describe("[AIL-HT-01] tenSeGhi", () => {
  it("hội thoại mới + tên có nguồn ⇒ ghi", () => {
    expect(tenSeGhi(null, { fbName: "Minh Anh", fbNameSource: "META_PROFILE_API" })).toEqual({ fbName: "Minh Anh", fbNameSource: "META_PROFILE_API" });
  });
  it("fbName vắng/null KHÔNG xoá tên đã có (lượt sau không lấy được tên không được làm mất tên lượt trước)", () => {
    const cu = { fbName: "Minh Anh", fbNameSource: "META_PROFILE_API" as const };
    expect(tenSeGhi(cu, { fbName: null })).toBeNull();
    expect(tenSeGhi(cu, {})).toBeNull();
  });
  it("tên khách tự khai KHÔNG đè tên có nguồn Meta/webhook (không hạ cấp ACCEPTED xuống HUMAN_QUEUED)", () => {
    expect(tenSeGhi({ fbName: "Minh Anh", fbNameSource: "META_PROFILE_API" }, { fbName: "Tên khác", fbNameSource: "CUSTOMER_STATED" })).toBeNull();
    expect(tenSeGhi({ fbName: "Minh Anh", fbNameSource: "WEBHOOK_PAYLOAD" }, { fbName: "Tên khác", fbNameSource: "CUSTOMER_STATED" })).toBeNull();
  });
  it("tên Meta MỚI đè tên khách tự khai (nguồn tin cậy hơn thắng) và đè tên Meta cũ (người dùng đổi tên)", () => {
    expect(tenSeGhi({ fbName: "tự gõ", fbNameSource: "CUSTOMER_STATED" }, { fbName: "Minh Anh", fbNameSource: "META_PROFILE_API" })).toEqual({
      fbName: "Minh Anh",
      fbNameSource: "META_PROFILE_API",
    });
    expect(tenSeGhi({ fbName: "A", fbNameSource: "META_PROFILE_API" }, { fbName: "B", fbNameSource: "META_PROFILE_API" })).toEqual({ fbName: "B", fbNameSource: "META_PROFILE_API" });
  });
  it("khách tự khai ghi được khi CHƯA có tên hoặc tên cũ cũng là tự khai", () => {
    expect(tenSeGhi({ fbName: null, fbNameSource: null }, { fbName: "tự gõ", fbNameSource: "CUSTOMER_STATED" })).not.toBeNull();
    expect(tenSeGhi({ fbName: "cũ", fbNameSource: "CUSTOMER_STATED" }, { fbName: "mới", fbNameSource: "CUSTOMER_STATED" })).not.toBeNull();
  });
  it("tên rỗng không ghi", () => {
    expect(tenSeGhi(null, { fbName: "", fbNameSource: "META_PROFILE_API" })).toBeNull();
  });
});
