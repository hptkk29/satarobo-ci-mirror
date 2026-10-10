// Ca [ND-*] — nhãn đợt của một lần thu cho người đọc ("Đợt 1/3", "Toàn đơn").
//
// Vì sao viết mới: `requestLabel` (payment-requests-section.tsx) là hàm riêng trong tệp "use client",
// và mẫu số của nó đếm MỌI phiếu có installmentNo > 0 — kể cả VOID và đợt của bé KHÁC ⇒ đơn hai con
// × 3 đợt in "Đợt 1/6". Ở đây mẫu số = số đợt ≥ 1, không VOID, CÙNG bé với đợt đích.
import { describe, it, expect } from "vitest";
import { nhanDotLanThu } from "./nhan-dot";

const dot = (id: string, installmentNo: number, orderItemId: string | null, status = "PAID") => ({
  id,
  installmentNo,
  orderItemId,
  status,
});

describe("[ND-01] nhãn đợt", () => {
  it("một đợt trong 3 đợt của cùng bé ⇒ 'Đợt 2/3'", () => {
    const ds = [dot("a", 1, "con1"), dot("b", 2, "con1"), dot("c", 3, "con1")];
    expect(nhanDotLanThu([{ id: "b" }], ds)).toBe("Đợt 2/3");
  });

  it("đơn hai con × 3 đợt ⇒ mẫu số theo ĐÚNG bé, không cộng dồn thành /6", () => {
    const ds = [
      dot("a1", 1, "con1"), dot("a2", 2, "con1"), dot("a3", 3, "con1"),
      dot("b1", 1, "con2"), dot("b2", 2, "con2"), dot("b3", 3, "con2"),
    ];
    expect(nhanDotLanThu([{ id: "b2" }], ds)).toBe("Đợt 2/3");
  });

  it("đợt VOID không tính vào mẫu số", () => {
    const ds = [dot("a", 1, null), dot("b", 2, null), dot("x", 3, null, "VOID")];
    expect(nhanDotLanThu([{ id: "a" }], ds)).toBe("Đợt 1/2");
  });

  it("chỉ một đợt ⇒ không in mẫu số", () => {
    expect(nhanDotLanThu([{ id: "a" }], [dot("a", 1, null)])).toBe("Đợt 1");
  });

  it("lần thu gộp hai đợt ⇒ 'Đợt 1+2/3'", () => {
    const ds = [dot("a", 1, null), dot("b", 2, null), dot("c", 3, null)];
    expect(nhanDotLanThu([{ id: "b" }, { id: "a" }], ds)).toBe("Đợt 1+2/3");
  });

  it("phiếu thu toàn đơn (installmentNo 0) ⇒ 'Toàn đơn'", () => {
    expect(nhanDotLanThu([{ id: "z" }], [dot("z", 0, null)])).toBe("Toàn đơn");
  });

  it("không có đợt đích (tiền mặt, lời khai) ⇒ null", () => {
    expect(nhanDotLanThu([], [dot("a", 1, null)])).toBeNull();
  });
});
