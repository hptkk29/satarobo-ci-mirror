import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { demDiemDanh, gomBanGhi, hangChamDuoc } from "./panel-gv";

const MARKABLE = ["PRESENT", "LATE", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"] as const;
type M = (typeof MARKABLE)[number];

const LY_DO = "Em học từ buổi 25";
const rows = [
  { studentId: "a", chuaToiLuot: null },
  { studentId: "b", chuaToiLuot: null },
  { studentId: "c", chuaToiLuot: LY_DO },
];

describe("[G29] bảng điểm danh GV — em chưa tới lượt không chặn việc lưu", () => {
  it("[G29-01] chấm hết em chấm được ⇒ unmarked = 0 dù còn em chưa tới lượt", () => {
    const state = {
      a: { status: "PRESENT" as M, note: "" },
      b: { status: "LATE" as M, note: "" },
      c: { status: null, note: "" },
    };
    const { counts, unmarked } = demDiemDanh<M, (typeof rows)[number]>(rows, state, MARKABLE);
    expect(unmarked).toBe(0);
    expect(counts.PRESENT).toBe(1);
    expect(counts.LATE).toBe(1);
  });

  it("[G29-02] bản ghi gửi server KHÔNG bao giờ chứa em chưa tới lượt, kể cả khi state có nhãn", () => {
    const state = {
      a: { status: "PRESENT" as M, note: " ok " },
      b: { status: null, note: "" },
      c: { status: "PRESENT" as M, note: "" }, // ví dụ "tất cả có mặt" bản cũ gán nhầm
    };
    const recs = gomBanGhi<M, (typeof rows)[number]>(rows, state);
    expect(recs).toEqual([{ studentId: "a", status: "PRESENT", note: "ok" }]);
    // Bất biến: records ⊆ tập server nhận (chuaToiLuot === null).
    const serverNhan = new Set(rows.filter((r) => r.chuaToiLuot === null).map((r) => r.studentId));
    for (const r of recs) expect(serverNhan.has(r.studentId)).toBe(true);
  });

  it("[G29-03] em chưa tới lượt có nhãn cũ không làm đổi bộ đếm", () => {
    const state = { c: { status: "ABSENT_UNEXCUSED" as M, note: "" } };
    const { counts, unmarked } = demDiemDanh<M, (typeof rows)[number]>(rows, state, MARKABLE);
    expect(counts.ABSENT_UNEXCUSED).toBe(0);
    expect(unmarked).toBe(2);
  });

  it("[G29-04] hangChamDuoc giữ đúng tập mà roster server ghi nhận", () => {
    expect(hangChamDuoc(rows).map((r) => r.studentId)).toEqual(["a", "b"]);
  });

  it("[G29-05] dây nối: page.tsx truyền chuaToiLuot vào panel", () => {
    const src = readFileSync(resolve(process.cwd(), "app/(teacher)/teacher/lop/page.tsx"), "utf8")
      .replace(/\/\/[^\n]*/g, "");
    expect(src.match(/chuaToiLuot:\s*r\.chuaToiLuot/g)?.length).toBe(1);
  });
});
