/**
 * Ca [QH-*] — ô "Quan hệ với học sinh" là ô chọn (26/09/2026): nhận ra giá trị cũ khi CHẮC,
 * không đoán khi mập mờ.
 */
import { describe, expect, it } from "vitest";
import { QUAN_HE, quanHeTuChuoi } from "./quan-he";

describe("quanHeTuChuoi", () => {
  it("[QH-01] khớp đúng chữ (hoa thường, khoảng trắng thừa, dạng tổ hợp NFD)", () => {
    expect(quanHeTuChuoi("mẹ")).toBe("Mẹ");
    expect(quanHeTuChuoi("  BỐ ")).toBe("Bố");
    expect(quanHeTuChuoi("Bà".normalize("NFD"))).toBe("Bà");
    expect(quanHeTuChuoi("người giám hộ")).toBe("Người giám hộ");
  });

  it("[QH-02] gõ không dấu mà chỉ một mục khớp ⇒ nhận ra", () => {
    expect(quanHeTuChuoi("me")).toBe("Mẹ");
    expect(quanHeTuChuoi("bo")).toBe("Bố");
    expect(quanHeTuChuoi("ong")).toBe("Ông");
  });

  it("[QH-03] 'Ba' (bố — miền Nam) ≠ 'Bà' ⇒ KHÔNG đoán; chữ lạ / trống ⇒ null", () => {
    expect(quanHeTuChuoi("Ba")).toBeNull();
    expect(quanHeTuChuoi("mẹ bé")).toBeNull();
    expect(quanHeTuChuoi("")).toBeNull();
    expect(quanHeTuChuoi(null)).toBeNull();
    // Mọi mục của danh sách tự nhận ra chính nó.
    for (const q of QUAN_HE) expect(quanHeTuChuoi(q)).toBe(q);
  });
});
