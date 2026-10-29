import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

describe("danh sách học bù đọc nhận xét từ MỤC, không chỉ từ phiếu buổi gốc", () => {
  // Hai danh sách (admin + site GV) trước đây chỉ hỏi `StudentSessionFeedback` của buổi vắng gốc, nên case làm theo luồng
  // mới luôn "0/n" dù trang trong đã có nhận xét. Hành vi cần DB nên khoá bằng mã nguồn: bỏ chú thích, đếm số lần.
  const nguon = readFileSync(resolve(process.cwd(), "lib/hoc-bu/case-doc.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  it("[TD-05] cả hai nơi đếm gọi phieuCoNoiDung(s) và vẫn giữ nhánh phiếu cũ cho case đời cũ", () => {
    expect(nguon.split("phieuCoNoiDung(s)").length - 1).toBe(2);
    expect(nguon.split("teacherEvaluation: true").length - 1).toBe(2);
    expect(nguon.split("evaluationRubric: true").length - 1).toBe(2);
    expect(nguon).toMatch(/phieuCoNoiDung\(s\) \|\| daCoPhieu\.has\(/);
    expect(nguon).toMatch(/phieuCoNoiDung\(s\) \|\| daNhanXet\.has\(/);
  });
});
