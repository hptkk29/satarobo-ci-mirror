// lib/students/remove-from-classes.test.ts — chốt quy tắc gỡ HV khỏi lớp (THUẦN, không DB).
//
// Hồi quy được canh (sự cố 07/08/2026): xoá học viên xong lớp vẫn còn tên học viên đó,
// vì `deleteStudent` không đụng Enrollment. Test này khoá 2 điều dễ trôi:
//   (a) tập trạng thái "còn sống" phải phủ ĐỦ mọi trạng thái mà roster/sĩ số coi là
//       đang-thuộc-lớp, cộng PENDING (chờ xếp lớp);
//   (b) trạng thái đích phải HỢP LỆ theo state machine ENROLLMENT_TRANSITIONS —
//       PENDING không có đường sang WITHDREW, phải đi CANCELLED.
import { describe, expect, it } from "vitest";
import type { EnrollmentStatus } from "@prisma/client";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { canTransition } from "@/lib/enrollments/status";
import {
  REMOVABLE_ENROLLMENT_STATUSES,
  removalTargetStatus,
} from "./remove-from-classes";

describe("REMOVABLE_ENROLLMENT_STATUSES", () => {
  it("phủ hết trạng thái mà roster/sĩ số coi là đang thuộc lớp", () => {
    for (const s of ENROLLMENT_ACTIVE_STATUS_LIST) {
      expect(REMOVABLE_ENROLLMENT_STATUSES).toContain(s);
    }
  });

  it("có thêm PENDING — chờ xếp lớp cũng phải dọn", () => {
    expect(REMOVABLE_ENROLLMENT_STATUSES).toContain("PENDING");
  });

  it("không đụng trạng thái đã kết thúc", () => {
    for (const s of ["COMPLETED", "WITHDREW", "TRANSFERRED", "CANCELLED"] as const) {
      expect(REMOVABLE_ENROLLMENT_STATUSES).not.toContain(s);
    }
  });
});

describe("removalTargetStatus", () => {
  it("PENDING → CANCELLED (chưa từng xếp lớp)", () => {
    expect(removalTargetStatus("PENDING")).toBe("CANCELLED");
  });

  it("đang học / bảo lưu → WITHDREW", () => {
    for (const s of ["CONFIRMED", "STUDYING", "ACTIVE", "PAUSED"] as const) {
      expect(removalTargetStatus(s)).toBe("WITHDREW");
    }
  });

  it("mọi chuyển trạng thái sinh ra đều HỢP LỆ theo state machine", () => {
    for (const from of REMOVABLE_ENROLLMENT_STATUSES) {
      const to = removalTargetStatus(from);
      expect(
        canTransition(from, to),
        `${from} → ${to} không hợp lệ theo ENROLLMENT_TRANSITIONS`,
      ).toBe(true);
    }
  });

  it("đích luôn là trạng thái kết thúc — gỡ xong không quay lại lớp", () => {
    const terminal: EnrollmentStatus[] = ["WITHDREW", "CANCELLED"];
    for (const from of REMOVABLE_ENROLLMENT_STATUSES) {
      const to = removalTargetStatus(from);
      expect(terminal).toContain(to);
      expect(ENROLLMENT_ACTIVE_STATUS_LIST).not.toContain(to);
    }
  });
});
