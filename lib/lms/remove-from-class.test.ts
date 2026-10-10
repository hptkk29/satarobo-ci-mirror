// lib/lms/remove-from-class.test.ts — luật "gỡ 1 học viên khỏi 1 lớp" (THUẦN, không DB).
//
// Yêu cầu chủ dự án 21/08/2026:
//   • gỡ ra mà em vẫn ĐANG HỌC  → em về trạng thái "chờ xếp lớp lại";
//   • gỡ ra mà em đã NGHỈ HỌC   → mở thêm nút "Nghỉ hẳn" (xoá khỏi hệ thống);
//   • và phải "check kỹ": chỉ hai kết luận trên khi em KHÔNG còn lớp nào khác.
import { describe, expect, it } from "vitest";
import type { StudentStatus } from "@prisma/client";
import {
  decideRemovalOutcome,
  describeRemovalOutcome,
  canLeaveSystemAfterRemoval,
} from "./remove-from-class";

const ALL_STATUSES: StudentStatus[] = ["ACTIVE", "PAUSED", "GRADUATED", "INACTIVE"];

describe("decideRemovalOutcome", () => {
  it("còn lớp khác → chưa kết luận gì, dù học viên ở trạng thái nào", () => {
    for (const studentStatus of ALL_STATUSES) {
      expect(
        decideRemovalOutcome({ studentStatus, otherLiveClassCount: 1 }),
      ).toBe("STILL_IN_OTHER_CLASSES");
    }
  });

  it("hết lớp + học viên đã NGHỈ HỌC → cho phép nghỉ hẳn", () => {
    expect(
      decideRemovalOutcome({ studentStatus: "INACTIVE", otherLiveClassCount: 0 }),
    ).toBe("CAN_LEAVE_SYSTEM");
  });

  it("hết lớp + học viên còn đang học/bảo lưu/hoàn thành → chờ xếp lớp lại", () => {
    for (const studentStatus of ["ACTIVE", "PAUSED", "GRADUATED"] as StudentStatus[]) {
      expect(
        decideRemovalOutcome({ studentStatus, otherLiveClassCount: 0 }),
      ).toBe("AWAITING_PLACEMENT");
    }
  });

  it("nghỉ hẳn CHỈ mở khi đã sạch lớp (khớp guard của deleteStudent)", () => {
    expect(canLeaveSystemAfterRemoval("CAN_LEAVE_SYSTEM")).toBe(true);
    expect(canLeaveSystemAfterRemoval("AWAITING_PLACEMENT")).toBe(false);
    expect(canLeaveSystemAfterRemoval("STILL_IN_OTHER_CLASSES")).toBe(false);
  });

  it("số lớp âm/không hợp lệ được coi như 0 — không bịa ra lớp", () => {
    expect(
      decideRemovalOutcome({ studentStatus: "ACTIVE", otherLiveClassCount: -3 }),
    ).toBe("AWAITING_PLACEMENT");
  });
});

describe("describeRemovalOutcome", () => {
  it("mỗi kết cục có câu tiếng Việt riêng, có kèm tên học viên", () => {
    const seen = new Set<string>();
    for (const o of ["AWAITING_PLACEMENT", "STILL_IN_OTHER_CLASSES", "CAN_LEAVE_SYSTEM"] as const) {
      const msg = describeRemovalOutcome(o, "Bé An", 2);
      expect(msg).toContain("Bé An");
      seen.add(msg);
    }
    expect(seen.size).toBe(3);
  });

  it("câu 'còn lớp khác' nói rõ còn mấy lớp", () => {
    expect(describeRemovalOutcome("STILL_IN_OTHER_CLASSES", "Bé An", 2)).toContain("2");
  });

  it("câu 'chờ xếp lớp' gọi đúng tên tab để giáo vụ biết tìm ở đâu", () => {
    expect(describeRemovalOutcome("AWAITING_PLACEMENT", "Bé An", 0)).toContain(
      "Chờ xếp lớp",
    );
  });
});
