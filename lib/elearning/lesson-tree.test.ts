import { describe, it, expect } from "vitest";
import { chonBaiTiepTheo, dungCay, langGieng } from "./lesson-tree";

const M = [
  {
    id: "m1",
    title: "Chương 1",
    lessons: [
      { id: "a", title: "Đọc", kind: "READ" },
      { id: "b", title: "Điểm danh", kind: "LIVE_SESSION" },
      { id: "c", title: "Kiểm tra", kind: "QUIZ" },
    ],
  },
  { id: "m2", title: "Chương 2", lessons: [{ id: "d", title: "Bài tập", kind: "TASK" }] },
  { id: "m3", title: "Chương rỗng", lessons: [] },
];

describe("[LT-01] dungCay — trạng thái lấy nguyên từ tiến độ server", () => {
  const cay = dungCay(M, [
    { lessonId: "a", status: "DONE" },
    { lessonId: "c", status: "IN_PROGRESS" },
  ]);
  it("trạng thái từng bài + đếm", () => {
    expect(cay.phang.map((b) => [b.lessonId, b.trangThai])).toEqual([
      ["a", "XONG"],
      ["b", "CHUA_HOC"],
      ["c", "DANG_HOC"],
      ["d", "CHUA_HOC"],
    ]);
    expect(cay).toMatchObject({ soBai: 4, soXong: 1 });
  });
  it("giữ chương rỗng (không nuốt) và đánh dấu loại bài không có màn người học", () => {
    expect(cay.chuong.map((c) => [c.moduleId, c.bai.length])).toEqual([["m1", 3], ["m2", 1], ["m3", 0]]);
    expect(cay.phang.find((b) => b.lessonId === "b")?.moDuoc).toBe(false);
    expect(cay.phang.find((b) => b.lessonId === "a")?.moDuoc).toBe(true);
  });
  it("trạng thái lạ (không phải DONE) coi là đang học, không bao giờ coi là xong", () => {
    const c = dungCay(M, [{ lessonId: "a", status: "VERIFIED_X" }]);
    expect(c.phang[0]!.trangThai).toBe("DANG_HOC");
    expect(c.soXong).toBe(0);
  });
});

describe("[LT-02] langGieng — Bài trước/sau chỉ dẫn tới bài có màn", () => {
  const { phang } = dungCay(M, []);
  it("bỏ qua buổi trực tiếp khi đi tới/lui", () => {
    expect(langGieng(phang, "a")).toMatchObject({ truoc: null, sau: { lessonId: "c" }, viTri: 1, tong: 3 });
    expect(langGieng(phang, "c")).toMatchObject({ truoc: { lessonId: "a" }, sau: { lessonId: "d" }, viTri: 2 });
    expect(langGieng(phang, "d")).toMatchObject({ truoc: { lessonId: "c" }, sau: null, viTri: 3 });
  });
  it("bài lạ ⇒ không có láng giềng, không ném", () => {
    expect(langGieng(phang, "khong-co")).toEqual({ truoc: null, sau: null, viTri: 0, tong: 3 });
  });
});

describe("[LT-03] chonBaiTiepTheo", () => {
  it("bài đang dở đứng trước bài chưa học dù xếp sau", () => {
    const { phang } = dungCay(M, [{ lessonId: "d", status: "IN_PROGRESS" }]);
    expect(chonBaiTiepTheo(phang)?.lessonId).toBe("d");
  });
  it("không có bài dở ⇒ bài chưa học đầu tiên CÓ MÀN (bỏ buổi trực tiếp)", () => {
    const { phang } = dungCay(M, [{ lessonId: "a", status: "DONE" }]);
    expect(chonBaiTiepTheo(phang)?.lessonId).toBe("c");
  });
  it("xong hết các bài mở được ⇒ null", () => {
    const { phang } = dungCay(M, [
      { lessonId: "a", status: "DONE" },
      { lessonId: "c", status: "DONE" },
      { lessonId: "d", status: "DONE" },
    ]);
    expect(chonBaiTiepTheo(phang)).toBeNull();
    expect(chonBaiTiepTheo([])).toBeNull();
  });
});
