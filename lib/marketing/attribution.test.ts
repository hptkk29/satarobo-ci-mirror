// @vitest-environment jsdom
// Hệ affiliate dựng từ 31/07 (bảng + màn quản lý + link ?ref=) nhưng KHÔNG form nào
// gửi `ref` ⇒ `Lead.affiliateId` chưa bao giờ được gắn. Lưới này khoá phần thuần.
import { describe, it, expect } from "vitest";
import {
  parseAttributionFromSearch,
  mergeAttribution,
  serializeAttribution,
  deserializeAttribution,
  readCookie,
} from "./attribution";

describe("parseAttributionFromSearch", () => {
  it("đọc đủ ref + utm + click-id, chấp nhận cả dạng có/không dấu ?", () => {
    const q = "?ref=ANNGUYEN&utm_source=fb&utm_medium=cpc&utm_campaign=t8&fbclid=abc";
    expect(parseAttributionFromSearch(q)).toEqual({
      ref: "ANNGUYEN",
      utmSource: "fb",
      utmMedium: "cpc",
      utmCampaign: "t8",
      fbclid: "abc",
    });
    expect(parseAttributionFromSearch("ref=X123")).toEqual({ ref: "X123" });
  });

  it("bỏ qua tham số rỗng/toàn khoảng trắng (không lưu khoá rác)", () => {
    expect(parseAttributionFromSearch("?ref=&utm_source=%20")).toEqual({});
  });

  it("cắt theo trần của validator lead — ref 32, utm 100", () => {
    const long = "A".repeat(200);
    const got = parseAttributionFromSearch(`?ref=${long}&utm_source=${long}`);
    expect(got.ref).toHaveLength(32);
    expect(got.utmSource).toHaveLength(100);
  });

  it("query không liên quan → rỗng (không tạo cookie thừa)", () => {
    expect(parseAttributionFromSearch("?page=2&q=robot")).toEqual({});
  });
});

describe("mergeAttribution — last-touch, không mất nguồn khi đi sâu vào site", () => {
  it("tham số mới ghi đè, tham số vắng mặt giữ nguyên", () => {
    const stored = { ref: "A", utmSource: "fb" };
    expect(mergeAttribution(stored, { ref: "B" })).toEqual({ ref: "B", utmSource: "fb" });
    expect(mergeAttribution(stored, {})).toEqual(stored);
  });
});

describe("cookie serialize/deserialize — luôn fail-safe", () => {
  it("khứ hồi giữ nguyên dữ liệu", () => {
    const a = { ref: "ANNGUYEN", utmCampaign: "hè 2026" };
    expect(deserializeAttribution(serializeAttribution(a))).toEqual(a);
  });

  it("cookie hỏng/không phải JSON/null → {} thay vì ném lỗi giữa lúc submit form", () => {
    expect(deserializeAttribution("khong-phai-json")).toEqual({});
    expect(deserializeAttribution(null)).toEqual({});
    expect(deserializeAttribution(encodeURIComponent('"chuỗi"'))).toEqual({});
  });

  it("bỏ khoá lạ và giá trị không phải chuỗi (cookie do người dùng sửa tay)", () => {
    const raw = encodeURIComponent(JSON.stringify({ ref: "OK", evil: "x", utmSource: 42 }));
    expect(deserializeAttribution(raw)).toEqual({ ref: "OK" });
  });
});

describe("readCookie", () => {
  it("lấy đúng cookie giữa nhiều cookie khác", () => {
    const c = "_fbp=fb.1.2; sr_attr=abc%3D; other=1";
    expect(readCookie(c, "sr_attr")).toBe("abc%3D");
    expect(readCookie(c, "khong-co")).toBeNull();
  });
});
