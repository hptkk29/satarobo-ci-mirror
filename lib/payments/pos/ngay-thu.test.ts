// Ngày thu (Payment.paidDate) của một giao dịch: thẻ POS ⇒ giờ quẹt; còn lại ⇒ lúc ghi (Q-C 29/09).
import { describe, it, expect } from "vitest";
import { ngayThuCuaGiaoDich } from "./ngay-thu";
import { PROVIDER_THE_POS } from "./kieu";

const quet = new Date("2026-09-29T10:31:35.000Z");
const bayGio = new Date("2026-10-02T03:00:00.000Z");

describe("ngayThuCuaGiaoDich", () => {
  it("[POS-N01] CARD_POS ⇒ transferredAt (giờ quẹt thẻ)", () => {
    expect(PROVIDER_THE_POS).toBe("CARD_POS");
    expect(ngayThuCuaGiaoDich({ provider: PROVIDER_THE_POS, transferredAt: quet }, bayGio).getTime()).toBe(
      quet.getTime(),
    );
  });

  it("[POS-N02] SEPAY / provider khác ⇒ now (giữ hành vi webhook)", () => {
    for (const provider of ["SEPAY", "PAYOS", "card_pos", ""]) {
      expect(ngayThuCuaGiaoDich({ provider, transferredAt: quet }, bayGio).getTime()).toBe(bayGio.getTime());
    }
  });
});
