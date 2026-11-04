import { describe, it, expect } from "vitest";
import { NHAN_TAM_HOAN_THU, nhanTamHoanThu, ngayVN } from "@/lib/portal/tam-hoan-thu";

describe("[BL4-TH] nhãn tạm hoãn thu của cổng phụ huynh", () => {
  it("[BL4-TH-01] có hạn ⇒ 'Tạm hoãn thu do bảo lưu đến dd/MM/yyyy'", () => {
    expect(nhanTamHoanThu("2027-04-07T03:00:00.000Z")).toBe("Tạm hoãn thu do bảo lưu đến 07/04/2027");
  });

  it("[BL4-TH-02] KHÔNG có hạn ⇒ chỉ nhãn gốc — không bịa ngày", () => {
    expect(nhanTamHoanThu(null)).toBe(NHAN_TAM_HOAN_THU);
    expect(nhanTamHoanThu(null)).not.toMatch(/\d/);
  });

  it("[BL4-TH-03] ngày theo lịch VN, không theo UTC: 23:30 UTC ngày 6 đã là ngày 7 ở Việt Nam", () => {
    expect(ngayVN("2027-04-06T23:30:00.000Z")).toBe("07/04/2027");
    expect(ngayVN("2027-04-07T16:59:00.000Z")).toBe("07/04/2027"); // 23:59 VN vẫn cùng ngày
  });

  it("[BL4-TH-04] nhãn không chứa từ gây hiểu nhầm (quá hạn / gấp / thanh toán ngay)", () => {
    expect(nhanTamHoanThu("2027-04-07T03:00:00.000Z")).not.toMatch(/quá hạn|gấp|ngay|nợ/i);
  });
});
