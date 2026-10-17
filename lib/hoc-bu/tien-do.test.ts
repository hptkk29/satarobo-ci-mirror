import { describe, expect, it } from "vitest";
import { demTienDo } from "./tien-do";

describe("demTienDo — tiến độ case để Sale nhắc", () => {
  it("[TD-01] chưa điểm danh ai ⇒ 0/0/0", () => {
    expect(demTienDo([{ status: "PLACED", coNhanXet: false }, { status: "PLACED", coNhanXet: false }])).toEqual({
      daDiemDanh: 0,
      coMat: 0,
      daNhanXet: 0,
    });
  });

  it("[TD-02] vắng cũng là ĐÃ điểm danh; nhận xét chỉ đếm bé có mặt", () => {
    expect(
      demTienDo([
        { status: "PRESENT", coNhanXet: true },
        { status: "PRESENT", coNhanXet: false },
        // Bé vắng có phiếu cũ ở buổi gốc — KHÔNG tính vào nhận xét của case.
        { status: "ABSENT", coNhanXet: true },
        { status: "PLACED", coNhanXet: false },
      ]),
    ).toEqual({ daDiemDanh: 3, coMat: 2, daNhanXet: 1 });
  });
});
