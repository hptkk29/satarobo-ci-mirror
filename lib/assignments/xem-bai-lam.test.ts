import { describe, expect, it } from "vitest";
import type { ContentQuestion } from "@/lib/assignments/question-content";
import type { DapAn } from "@/lib/assignments/lam-bai";
import { boDeBaiVideoGhep, dapAnDungThanhDong, dungBaiLamXem, traLoiThanhDong } from "./xem-bai-lam";
import { ghepDeBaiVideo } from "@/lib/assignments/question-content";

const single: ContentQuestion = { id: "q1", type: "single", question: "1-2=", options: ["3", "4", "5", "2"], correctIndex: 1 };
const multiple: ContentQuestion = { id: "q2", type: "multiple", question: "3*X=9", options: ["3", "2", "1", "căn 9"], correctIndices: [0, 3] };
const boolean: ContentQuestion = { id: "q3", type: "boolean", question: "1+1=2?", correct: true };
const ordering: ContentQuestion = { id: "q4", type: "ordering", question: "Xếp", items: ["1", "2", "3", "4"] };
const video: ContentQuestion = { id: "q5", type: "video", question: "nộp 1 video nhé" };

describe("[XB-01] bản xem cho giáo viên", () => {
  it("câu trả lời và đáp án đúng ra thành dòng chữ đọc được", () => {
    expect(traLoiThanhDong(single, { k: "single", i: 0 })).toEqual(["3"]);
    expect(traLoiThanhDong(multiple, { k: "multiple", i: [3, 0] })).toEqual(["căn 9", "3"]);
    expect(traLoiThanhDong(ordering, { k: "ordering", o: ["2", "1"] })).toEqual(["1. 2", "2. 1"]);
    expect(dapAnDungThanhDong(multiple)).toEqual(["3", "căn 9"]);
    expect(dapAnDungThanhDong(boolean)).toEqual(["Đúng"]);
  });
  it("bỏ trống ⇒ null; câu video không có câu trả lời dạng chữ", () => {
    expect(traLoiThanhDong(single, null)).toBeNull();
    expect(traLoiThanhDong(multiple, { k: "multiple", i: [] })).toBeNull();
    expect(traLoiThanhDong(video, null)).toBeNull();
    expect(dapAnDungThanhDong(video)).toBeNull();
  });
  it("bài 5 câu như ảnh chụp lỗi: chọn đúng 4 câu tự chấm + câu video ⇒ 8/10 máy chấm, còn 1 câu chấm tay", () => {
    const dap = new Map<string, DapAn>([
      ["q1", { k: "single", i: 1 }],
      ["q2", { k: "multiple", i: [0, 3] }],
      ["q3", { k: "boolean", v: true }],
      ["q4", { k: "ordering", o: ["1", "2", "3", "4"] }],
    ]);
    const r = dungBaiLamXem(
      [single, multiple, boolean, ordering, video].map((q) => ({ q, diemCau: null })),
      dap,
      10,
    );
    expect(r.cau).toHaveLength(5);
    expect(r.cau.map((c) => c.so)).toEqual([1, 2, 3, 4, 5]);
    expect(r.diemTuDong).toBe(8);
    expect(r.conChamTay).toBe(true);
    expect(r.soCauChamTay).toBe(1);
    expect(r.cau[4]).toMatchObject({ loai: "video", tiLe: null, traLoi: null });
  });
});

describe("[XB-02] bỏ đề video đã nối vào hướng dẫn", () => {
  it("bỏ đúng khối do ghepDeBaiVideo sinh ra, giữ nguyên phần hướng dẫn thật", () => {
    const qs = [{ type: "VIDEO", text: "nộp 1 video nhé" }];
    expect(boDeBaiVideoGhep(ghepDeBaiVideo("Nộp trước thứ Bảy.", qs))).toBe("Nộp trước thứ Bảy.");
    expect(boDeBaiVideoGhep(ghepDeBaiVideo(null, qs))).toBeNull();
    expect(boDeBaiVideoGhep(ghepDeBaiVideo("Hướng dẫn", [{ type: "VIDEO", text: "a" }, { type: "VIDEO", text: "b" }]))).toBe("Hướng dẫn");
  });
  it("hướng dẫn không có khối video thì giữ nguyên", () => {
    expect(boDeBaiVideoGhep("Làm bài cẩn thận")).toBe("Làm bài cẩn thận");
    expect(boDeBaiVideoGhep(null)).toBeNull();
  });
});
