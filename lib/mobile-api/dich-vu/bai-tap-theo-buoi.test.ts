import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("./hoc-tap", () => ({ batNeuTat: vi.fn(), dieuKienDe: vi.fn(), duocXemDiem: vi.fn(), lopCuaHocVien: vi.fn() }));

import { diemCaoNhat } from "./bai-tap-theo-buoi";

describe("bài tập theo buổi — điểm cao nhất (thuần)", () => {
  const luot = [
    { status: "GRADED", totalScore: 6 },
    { status: "GRADED", totalScore: 9 },
    { status: "SUBMITTED", totalScore: null },
    { status: "IN_PROGRESS", totalScore: null },
  ];
  it("[BTB-01] lấy lượt ĐÃ CHẤM cao nhất, bỏ qua lượt đang làm/chờ chấm", () => {
    expect(diemCaoNhat(luot, true)).toBe(9);
  });
  it("[BTB-02] không được hiện điểm (setting PH tắt / đề ẩn kết quả) ⇒ null dù có lượt đã chấm", () => {
    expect(diemCaoNhat(luot, false)).toBeNull();
  });
  it("[BTB-03] chưa có lượt chấm ⇒ null; điểm 0 là điểm hợp lệ (không bị coi là trống)", () => {
    expect(diemCaoNhat([{ status: "IN_PROGRESS", totalScore: null }], true)).toBeNull();
    expect(diemCaoNhat([{ status: "GRADED", totalScore: 0 }], true)).toBe(0);
  });
});
