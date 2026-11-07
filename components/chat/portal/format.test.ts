// Bẫy được canh ở đây: mọi mốc giờ chat phải là ĐỒNG HỒ VN bất kể TZ tiến trình.
// Vercel chạy UTC, máy dev +07 — test này đỏ nếu ai đó thay `vnParts` bằng
// `toLocaleString`/`getHours` (bug "chạy máy tôi thì được", xem lib/time/vn.ts).

import { describe, expect, it } from "vitest";
import {
  formatChatTimestamp,
  formatConversationTime,
  formatVnClock,
  formatVnDate,
} from "./format";

describe("format — mốc giờ chat theo đồng hồ VN", () => {
  it("đổi UTC sang giờ VN (+7), không dùng TZ của máy chạy", () => {
    // 02:15Z = 09:15 giờ VN cùng ngày.
    expect(formatVnClock(new Date("2026-08-09T02:15:00.000Z"))).toBe("09:15");
    expect(formatChatTimestamp(new Date("2026-08-09T02:15:00.000Z"))).toBe("09/08 09:15");
  });

  it("qua mốc nửa đêm VN: 17:30Z là 00:30 NGÀY HÔM SAU ở VN", () => {
    const d = new Date("2026-08-09T17:30:00.000Z");
    expect(formatVnClock(d)).toBe("00:30");
    expect(formatVnDate(d)).toBe("10/08/2026");
    expect(formatChatTimestamp(d)).toBe("10/08 00:30");
  });

  it("nhận cả chuỗi ISO (payload broadcast) lẫn Date", () => {
    expect(formatChatTimestamp("2026-08-09T02:15:00.000Z")).toBe("09/08 09:15");
  });

  describe("danh sách hội thoại", () => {
    const now = new Date("2026-08-09T05:00:00.000Z"); // 12:00 ngày 09/08 giờ VN

    it("cùng NGÀY VN → chỉ giờ", () => {
      expect(formatConversationTime(new Date("2026-08-09T02:15:00.000Z"), now)).toBe("09:15");
    });

    it("khác ngày, cùng năm → ngày/tháng", () => {
      expect(formatConversationTime(new Date("2026-08-07T02:15:00.000Z"), now)).toBe("07/08");
    });

    it("khác năm → có năm", () => {
      expect(formatConversationTime(new Date("2025-12-31T02:15:00.000Z"), now)).toBe("31/12/2025");
    });

    it("tin lúc 23:30 giờ VN hôm nay KHÔNG bị coi là hôm qua", () => {
      // 16:30Z ngày 09/08 = 23:30 ngày 09/08 giờ VN — cùng ngày VN với `now`.
      expect(formatConversationTime(new Date("2026-08-09T16:30:00.000Z"), now)).toBe("23:30");
    });
  });
});
