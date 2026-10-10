// lib/rooms/center-filter.test.ts — phủ đủ nhánh của rào phòng ↔ cơ sở.
import { describe, expect, it } from "vitest";
import { roomCenterAssignmentError } from "./center-filter";

describe("roomCenterAssignmentError", () => {
  it("chặn phòng của cơ sở khác — lý do tồn tại của rào này", () => {
    expect(roomCenterAssignmentError("cs1", { centerId: "cs2" })).toBe(
      "Phòng thuộc cơ sở khác với buổi hẹn",
    );
  });

  it("cho qua phòng cùng cơ sở", () => {
    expect(roomCenterAssignmentError("cs1", { centerId: "cs1" })).toBeNull();
  });

  it("cho qua phòng dùng chung (centerId null)", () => {
    expect(roomCenterAssignmentError("cs1", { centerId: null })).toBeNull();
  });

  it("buổi chưa gán cơ sở thì không có gì để so", () => {
    expect(roomCenterAssignmentError(null, { centerId: "cs2" })).toBeNull();
  });

  it("phòng không tra ra là lỗi, không phải 'cho qua' — chặn roomId bịa", () => {
    expect(roomCenterAssignmentError("cs1", null)).toBe("Phòng không tồn tại");
    expect(roomCenterAssignmentError("cs1", undefined)).toBe("Phòng không tồn tại");
  });
});
