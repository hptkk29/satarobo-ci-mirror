// @vitest-environment node
/**
 * G-06 · GIÁ TRỊ HỢP ĐỒNG — con số Sale CAM KẾT, không phải tiền đã vào tài khoản.
 *
 * Vì sao có hẳn một module cho một ô số: đây là lần thứ hai trong cùng đợt mà một con
 * số "trông như doanh thu" xuất hiện trên màn hình. Lần thứ nhất (B-02) đã phải dọn vì
 * ba màn cùng cộng tiền theo ba luật khác nhau. Nếu ai đó đem cột này cộng vào báo cáo
 * doanh thu thì tổng sẽ PHỒNG đúng bằng phần khách chưa đóng — và vẫn ra một con số
 * trông hợp lý, nên không ai phát hiện.
 *
 * Chốt 24/08/2026 (quyết định B3 + OQ-G2): doanh thu của toàn hệ thống lấy từ `Payment`
 * đã xác nhận, **KHÔNG** lấy `Order.totalAmount`, **KHÔNG** lấy `LeadChild.contractValue`.
 * Nhãn và lời chú giải ở đây là nơi DUY NHẤT viết ra ranh giới đó, để mọi màn dùng chung
 * một câu chữ thay vì mỗi người tự đặt tên.
 */
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VALUE_HINT,
  CONTRACT_VALUE_LABEL,
  CONTRACT_VALUE_MAX,
  parseContractValue,
} from "@/lib/lead/contract-value";

const ok = (raw: unknown) => {
  const r = parseContractValue(raw);
  if (!r.ok) throw new Error(`đáng lẽ hợp lệ: ${r.message}`);
  return r.value;
};

describe("[G-06] parseContractValue — ca hợp lệ", () => {
  it("số nguyên", () => {
    expect(ok(5_000_000)).toBe(5_000_000);
  });

  it("chuỗi số trần", () => {
    expect(ok("5000000")).toBe(5_000_000);
  });

  it("chuỗi có dấu phân cách kiểu vi-VN — người ta gõ y như trên hợp đồng", () => {
    expect(ok("5.000.000")).toBe(5_000_000);
    expect(ok("5.000.000 đ")).toBe(5_000_000);
  });

  it("0 là giá trị THẬT (học bổng toàn phần), không phải 'chưa nhập'", () => {
    expect(ok(0)).toBe(0);
    expect(ok("0")).toBe(0);
  });

  it("bằng đúng trần → nhận", () => {
    expect(ok(CONTRACT_VALUE_MAX)).toBe(CONTRACT_VALUE_MAX);
  });
});

describe("[G-06] parseContractValue — 'chưa nhập' phải ra null, KHÔNG ra 0", () => {
  // Nhầm hai thứ này là biến mọi phiếu chưa ai điền thành "hợp đồng 0 đồng", và
  // trung bình giá trị hợp đồng tụt thẳng xuống đáy mà không ai đụng vào dữ liệu.
  it.each([undefined, null, "", "   "])("%p → null", (raw) => {
    expect(ok(raw)).toBeNull();
  });
});

describe("[G-06] parseContractValue — ca từ chối", () => {
  it("số âm — hợp đồng không có giá trị âm; muốn ghi hoàn tiền thì đi đường Payment", () => {
    const r = parseContractValue(-1);
    expect(r.ok).toBe(false);
  });

  it("chuỗi âm cũng từ chối (không lặng lẽ bỏ dấu trừ)", () => {
    expect(parseContractValue("-5.000.000").ok).toBe(false);
  });

  it("vượt trần", () => {
    const r = parseContractValue(CONTRACT_VALUE_MAX + 1);
    expect(r.ok).toBe(false);
  });

  it("không phải số nguyên", () => {
    expect(parseContractValue(1234.5).ok).toBe(false);
  });

  it("NaN / Infinity", () => {
    expect(parseContractValue(Number.NaN).ok).toBe(false);
    expect(parseContractValue(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it("chữ không có số nào — KHÔNG được im lặng thành null", () => {
    // `null` ở đây nghĩa "người dùng để trống"; gõ "năm triệu" mà nhận null là
    // nuốt mất lượt nhập và người nhập tưởng đã lưu.
    expect(parseContractValue("năm triệu").ok).toBe(false);
  });

  it("kiểu lạ (object/boolean) → từ chối", () => {
    expect(parseContractValue({}).ok).toBe(false);
    expect(parseContractValue(true).ok).toBe(false);
  });
});

describe("[G-06] nhãn phải NÓI RÕ đây không phải tiền đã thu", () => {
  it("nhãn có chữ 'hợp đồng'", () => {
    expect(CONTRACT_VALUE_LABEL.toLowerCase()).toContain("hợp đồng");
  });

  it("chú giải phủ định thẳng chuyện 'đã thu' — người đọc màn hình phải thấy", () => {
    expect(CONTRACT_VALUE_HINT.toLowerCase()).toContain("không phải");
    expect(CONTRACT_VALUE_HINT.toLowerCase()).toContain("thu");
  });

  it("nhãn KHÔNG được gọi là doanh thu", () => {
    expect(CONTRACT_VALUE_LABEL.toLowerCase()).not.toContain("doanh thu");
  });
});
