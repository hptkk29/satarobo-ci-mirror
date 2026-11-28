import { describe, expect, it } from "vitest";
import { baiCuaMotBuoi, gomBaiTheoNoi } from "./bai-cua-buoi";

const b = (id: string, classSessionId: string | null, lessonId: string | null = null) => ({ id, classSessionId, lessonId });

describe("gom bài về buổi", () => {
  it("[BCB-01] một buổi giao 2 bài ⇒ cả hai đều về buổi đó, đúng thứ tự giao (bản cũ chỉ giữ bài đầu)", () => {
    const g = gomBaiTheoNoi([b("a", "s1"), b("b", "s1"), b("c", "s2")]);
    expect(baiCuaMotBuoi(g, "s1", null).map((x) => x.id)).toEqual(["a", "b"]);
    expect(baiCuaMotBuoi(g, "s2", null).map((x) => x.id)).toEqual(["c"]);
  });
  it("[BCB-02] bài gắn thẳng buổi đứng trước bài gắn theo giáo trình; hai bài cùng giáo trình đều hiện", () => {
    const g = gomBaiTheoNoi([b("gt1", null, "L1"), b("gt2", null, "L1"), b("buoi", "s1")]);
    expect(baiCuaMotBuoi(g, "s1", "L1").map((x) => x.id)).toEqual(["buoi", "gt1", "gt2"]);
  });
  it("[BCB-03] bài không gắn buổi/giáo trình vào khongGanBuoi, không rơi vào buổi nào", () => {
    const g = gomBaiTheoNoi([b("x", null), b("y", null), b("z", "s1")]);
    expect(g.khongGanBuoi.map((a) => a.id)).toEqual(["x", "y"]);
    expect(baiCuaMotBuoi(g, "s9", null)).toEqual([]);
  });
});
