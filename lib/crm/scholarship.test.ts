import { describe, it, expect } from "vitest";
import { computeEnrollmentPrice } from "@/lib/finance/pricing";
import {
  canGrantFullScholarship,
  isFullWaiver,
  scholarshipAuditReason,
  SCHOLARSHIP_FORBIDDEN,
} from "./scholarship";

describe("[HB-01] canGrantFullScholarship — chỉ Quản trị tối cao", () => {
  it("SUPER_ADMIN → được cấp", () => {
    expect(canGrantFullScholarship({ isSuperAdmin: true })).toBe(true);
  });

  it("mọi vai khác → KHÔNG được cấp", () => {
    // Đây là yêu cầu gốc 31/08/2026: "khoá chức năng miễn phí học bổng toàn phần cho
    // tất cả các role ngoại trừ super_admin". Trước đó màn chốt lead cho giảm học phí
    // theo % / số tiền tuỳ ý mà KHÔNG chặn vai nào.
    expect(canGrantFullScholarship({ isSuperAdmin: false })).toBe(false);
  });

  it("fail-closed với giá trị không phải boolean true", () => {
    // Actor dựng tay ở test cũ / system-actor có thể thiếu field. Thiếu ⇒ CHẶN, không
    // được coi là "chưa biết nên cho qua" — đây là cổng cho tiền biến mất khỏi công nợ.
    expect(canGrantFullScholarship({ isSuperAdmin: undefined as never })).toBe(false);
    expect(canGrantFullScholarship({ isSuperAdmin: null as never })).toBe(false);
    expect(canGrantFullScholarship({ isSuperAdmin: 1 as never })).toBe(false);
  });

  it("câu từ chối nói rõ ai mới cấp được", () => {
    expect(SCHOLARSHIP_FORBIDDEN).toContain("Quản trị tối cao");
  });
});

describe("[HB-02] scholarshipAuditReason — nhật ký thay cho ô lý do đã gỡ", () => {
  it("có tên người cấp và mốc thời gian", () => {
    // Ô "Lý do ưu đãi" (bắt buộc ≥10 ký tự) đã gỡ theo chốt "chỉ cần ô tick". Dòng này
    // là thứ THAY THẾ nó trong nhật ký — mất nó là học phí bốc hơi khỏi công nợ mà
    // không ai trả lời được "ai cho".
    const at = new Date("2026-08-31T10:20:30.000Z");
    const reason = scholarshipAuditReason("Hồ Đắc Phúc", at);
    expect(reason).toContain("Hồ Đắc Phúc");
    expect(reason).toContain("2026-08-31T10:20:30.000Z");
    expect(reason).toContain("Học bổng toàn phần");
  });

  it("đủ dài để qua ràng buộc lý do cũ (≥10 ký tự) nếu đường nào còn kiểm", () => {
    expect(
      scholarshipAuditReason("A", new Date("2026-01-01T00:00:00.000Z")).length,
    ).toBeGreaterThanOrEqual(10);
  });
});

describe("[HB-03] isFullWaiver — phân biệt miễn TOÀN PHẦN với giảm một phần", () => {
  const waives = (listPrice: number, discount: Parameters<typeof computeEnrollmentPrice>[0]["discount"]) =>
    isFullWaiver(listPrice, computeEnrollmentPrice({ listPrice, discount }).finalPrice);

  it("giảm 100% → miễn toàn phần", () => {
    expect(waives(9_000_000, { type: "PERCENT", value: 100 })).toBe(true);
    expect(waives(9_000_000, { type: "SCHOLARSHIP", value: 100 })).toBe(true);
  });

  it("giảm đúng bằng giá lớp (số tiền) → miễn toàn phần", () => {
    expect(waives(9_000_000, { type: "AMOUNT", value: 9_000_000 })).toBe(true);
    // Nhập dư cũng về 0 — computeEnrollmentPrice kẹp ≤ giá gốc.
    expect(waives(9_000_000, { type: "AMOUNT", value: 99_000_000 })).toBe(true);
  });

  it("giảm MỘT PHẦN → KHÔNG chặn (import lịch sử khách cũ vẫn nhập được)", () => {
    expect(waives(9_000_000, { type: "PERCENT", value: 99 })).toBe(false);
    expect(waives(9_000_000, { type: "AMOUNT", value: 500_000 })).toBe(false);
  });

  it("không giảm gì → không phải miễn", () => {
    expect(waives(9_000_000, null)).toBe(false);
  });

  it("lớp chưa gán giá (listPrice = 0) → KHÔNG tính là miễn học phí", () => {
    // finalPrice cũng = 0 ở đây, nên nếu chỉ kiểm `finalPrice === 0` thì MỌI lớp chưa
    // có giá đều bị chặn oan — kể cả khi không ai định miễn gì.
    expect(waives(0, null)).toBe(false);
    expect(waives(0, { type: "PERCENT", value: 100 })).toBe(false);
  });
});
