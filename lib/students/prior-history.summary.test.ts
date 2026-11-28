// lib/students/prior-history.summary.test.ts — câu báo "khách đã từng học ở đâu" (THUẦN).
//
// Yêu cầu 21/08/2026: cho học viên nghỉ hẳn thì vẫn giữ dấu vết đã từng học tại cơ sở đó;
// gia đình đăng ký lại ở CƠ SỞ KHÁC thì sale bên đó phải biết. Câu này là thứ sale đọc
// khi bị chặn tạo lead trùng SĐT — nó phải nói được cơ sở nào, và KHÔNG được lộ PII.
//
// ⚠️ Import từ file `.summary` riêng chứ không từ `prior-history.ts`: file kia có
// `import "server-only"` nên nạp trong Vitest sẽ ném.
import { describe, expect, it } from "vitest";
import {
  summarizePriorHistory,
  type PriorHistoryRecord,
} from "./prior-history.summary";

const student = (over: Partial<PriorHistoryRecord> = {}): PriorHistoryRecord => ({
  role: "STUDENT",
  centerName: "CS1 Nguyễn Hữu Thọ",
  statusLabel: "đã nghỉ học",
  at: new Date("2026-03-15T00:00:00Z"),
  removed: false,
  ...over,
});

const lead = (over: Partial<PriorHistoryRecord> = {}): PriorHistoryRecord => ({
  role: "LEAD",
  centerName: "CS2 Hoàng Diệu",
  statusLabel: "đã đăng ký",
  at: new Date("2026-01-05T00:00:00Z"),
  removed: false,
  ...over,
});

describe("summarizePriorHistory", () => {
  it("không có lịch sử → null (không bịa thêm câu vào thông báo lỗi)", () => {
    expect(summarizePriorHistory([])).toBeNull();
  });

  it("đã từng HỌC → nói rõ cơ sở nào", () => {
    const msg = summarizePriorHistory([student()]);
    expect(msg).toContain("CS1 Nguyễn Hữu Thọ");
    expect(msg).toContain("đã từng học");
  });

  it("hồ sơ đã bị xoá (nghỉ hẳn) vẫn tra ra được, và nói là đã đóng", () => {
    const msg = summarizePriorHistory([student({ removed: true })]);
    expect(msg).toContain("CS1 Nguyễn Hữu Thọ");
    expect(msg).toContain("hồ sơ đã đóng");
  });

  it("ưu tiên kể chuyện ĐÃ HỌC; chỉ khi chưa từng học mới kể hồ sơ tư vấn", () => {
    const both = summarizePriorHistory([student(), lead()]);
    expect(both).toContain("đã từng học");
    expect(both).not.toContain("hồ sơ tư vấn");

    const onlyLead = summarizePriorHistory([lead()]);
    expect(onlyLead).toContain("hồ sơ tư vấn");
    expect(onlyLead).toContain("CS2 Hoàng Diệu");
  });

  it("chưa gắn cơ sở thì nói thẳng, không im lặng bỏ dòng", () => {
    const msg = summarizePriorHistory([student({ centerName: null })]);
    expect(msg).toContain("cơ sở chưa rõ");
  });

  it("nhiều cơ sở → kể tối đa 3, không xổ cả danh sách vào thông báo lỗi", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      student({ centerName: `CS${i + 1}` }),
    );
    const msg = summarizePriorHistory(many) ?? "";
    expect(msg).toContain("CS1");
    expect(msg).toContain("CS3");
    expect(msg).not.toContain("CS4");
  });

  it("KHÔNG lộ PII — câu chỉ có cơ sở / trạng thái / mốc, không tên người hay SĐT", () => {
    const msg = summarizePriorHistory([student(), lead()]) ?? "";
    expect(msg).not.toMatch(/\d{9,}/); // không có SĐT
    expect(msg).not.toMatch(/@/); // không có email
  });
});
