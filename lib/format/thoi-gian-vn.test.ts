// lib/format/thoi-gian-vn.test.ts — ngày/giờ lịch VN (+07:00, YYYY-MM-DD).
// Ca [AG-TG-01] dời từ `lib/agents/gateway/ho-tro.test.ts` khi gỡ Cổng dữ liệu agent 02/10/2026.
import { describe, it, expect } from "vitest";
import { congNgay, gioVN, laNgayHopLe, ngayVN, soNgayGiua } from "./thoi-gian-vn";

describe("[TGVN-01] thời gian lịch Việt Nam", () => {
  it("UTC → giờ VN có +07:00, bỏ mili giây", () => {
    expect(gioVN(new Date("2026-09-25T02:00:00.123Z"))).toBe("2026-09-25T09:00:00+07:00");
  });
  it("23:30 UTC ngày 24 là ngày 25 ở VN", () => {
    expect(ngayVN(new Date("2026-09-24T23:30:00Z"))).toBe("2026-09-25");
  });
  it("ngày có thật trên lịch; cộng ngày + khoảng cách ngày qua ranh tháng", () => {
    expect(laNgayHopLe("2026-02-28")).toBe(true);
    expect(laNgayHopLe("2026-02-30")).toBe(false);
    expect(congNgay("2026-09-30", 1)).toBe("2026-10-01");
    expect(soNgayGiua("2026-09-30", "2026-10-02")).toBe(2);
  });
});
