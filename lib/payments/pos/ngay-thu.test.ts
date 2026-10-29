// Ngày thu (Payment.paidDate) của một giao dịch: thẻ POS ⇒ giờ quẹt (Q-C 29/09); chuyển khoản ⇒ GIỜ NGÂN HÀNG thực nhận (đảo 24/10/2026).
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

  it("[POS-N02] chuyển khoản ⇒ transferredAt (giờ ngân hàng) khi hợp lệ — KHÔNG phải lúc gắn [ĐẢO 24/10]", () => {
    // Ca cũ ghim "SEPAY ⇒ now" và đã được chủ dự án đảo: gắn tay lúc 16:29 ngày 07/10 cho tiền về 19:03 ngày 30/08
    // đã đưa một khoản tháng 8 vào doanh thu tháng 10 (đối soát T9–T10).
    for (const provider of ["SEPAY", "PAYOS", ""]) {
      expect(ngayThuCuaGiaoDich({ provider, transferredAt: quet }, bayGio).getTime()).toBe(quet.getTime());
    }
  });

  it("[POS-N03] chuyển khoản mà transferredAt ở TƯƠNG LAI (lệch múi giờ / dữ liệu lạ) ⇒ không bao giờ trả tương lai", () => {
    const tuongLai = new Date("2026-10-09T03:00:00.000Z");
    expect(ngayThuCuaGiaoDich({ provider: "SEPAY", transferredAt: tuongLai }, bayGio).getTime()).toBe(bayGio.getTime());
  });

  it("[POS-N04] `card_pos` viết thường KHÔNG phải thẻ POS (so khớp đúng hằng) — đi đường chuyển khoản", () => {
    expect(ngayThuCuaGiaoDich({ provider: "card_pos", transferredAt: quet }, bayGio).getTime()).toBe(quet.getTime());
  });
});
