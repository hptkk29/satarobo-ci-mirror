// #15 (câu 32) — che CCCD PH + địa chỉ MẶC ĐỊNH + guard reason break-glass.
// Test THUẦN: mask helper (lib/finance/pii-mask) + breakGlassSchema (lib/validators/audit).
// Luồng permission thật (assertPermission payments:view-pii + audit) chạm DB/session →
// phủ ở e2e; ở đây khoá 2 điều kiện cốt lõi: (1) mask che đúng, (2) reason<10 bị chặn.
import { describe, it, expect } from "vitest";
import { maskNationalId, maskAddress } from "@/lib/finance/pii-mask";
import { breakGlassSchema } from "@/lib/validators/audit";

describe("[#15] maskNationalId — che CCCD phụ huynh mặc định", () => {
  it("giữ 4 số đầu + 2 số cuối, giữa là ****", () => {
    expect(maskNationalId("0123456789")).toBe("0123****89");
    expect(maskNationalId("048201001234")).toBe("0482****34");
  });

  it("KHÔNG lộ trọn số CCCD (bản che khác bản gốc)", () => {
    const raw = "0123456789";
    const masked = maskNationalId(raw);
    expect(masked).not.toBe(raw);
    expect(masked).not.toContain("456"); // phần giữa bị che
  });

  it("chuỗi quá ngắn → che toàn bộ ****", () => {
    expect(maskNationalId("123")).toBe("****");
    expect(maskNationalId("123456")).toBe("****");
  });

  it("null/rỗng → null", () => {
    expect(maskNationalId(null)).toBeNull();
    expect(maskNationalId(undefined)).toBeNull();
    expect(maskNationalId("   ")).toBeNull();
  });
});

describe("[#15] maskAddress — che địa chỉ (rút gọn)", () => {
  it("giấu số nhà/đường, chỉ để lộ phần thô (quận/tỉnh)", () => {
    const raw = "12 Nguyễn Hữu Thọ, Hải Châu, Đà Nẵng";
    const masked = maskAddress(raw);
    expect(masked).toBe("…, Hải Châu, Đà Nẵng");
    expect(masked).not.toContain("12 Nguyễn Hữu Thọ"); // số nhà + đường bị giấu
  });

  it("địa chỉ 1 đoạn (không tách được quận/tỉnh) → che TOÀN BỘ, không lộ số nhà", () => {
    expect(maskAddress("114 Hoàng Diệu")).toBe("•••");
  });

  it("null/rỗng → null", () => {
    expect(maskAddress(null)).toBeNull();
    expect(maskAddress("")).toBeNull();
  });
});

describe("[#15] break-glass reason guard (câu 13 chuẩn ≥10 ký tự)", () => {
  it("reason < 10 ký tự bị chặn", () => {
    const r = breakGlassSchema.safeParse({ reason: "ngắn" });
    expect(r.success).toBe(false);
  });

  it("reason ≥ 10 ký tự hợp lệ", () => {
    const r = breakGlassSchema.safeParse({
      reason: "đối soát công nợ tháng 07 cho phụ huynh",
    });
    expect(r.success).toBe(true);
  });
});
