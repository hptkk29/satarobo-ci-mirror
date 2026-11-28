// @vitest-environment jsdom
/**
 * [LBU] Học viên làm bài tập TỪNG CÂU — dựng component THẬT, bấm THẬT.
 * Ca gốc: giáo viên giao bài 5 câu (chọn 1 · đúng/sai · chọn nhiều · sắp xếp · nộp video) mà học viên chỉ thấy câu video.
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CauHoiHocVien, DapAn } from "@/lib/assignments/lam-bai";
import { CauHoiLamBai, coNoiDungDapAn, dapAnDeGui, type DapAnTheoCau } from "./lam-bai-cau-hoi";

const CAU: CauHoiHocVien[] = [
  { id: "q1", type: "single", question: "1-2=", imageUrl: null, options: ["3", "4", "5", "2"] },
  { id: "q2", type: "boolean", question: "1+1=2?", imageUrl: null },
  { id: "q3", type: "multiple", question: "3*X=9", imageUrl: null, options: ["3", "2", "1", "căn 9"] },
  { id: "q4", type: "ordering", question: "xếp theo thứ tự", imageUrl: null, muc: ["3", "1", "4", "2"] },
  { id: "q5", type: "video", question: "nộp 1 video nhé", imageUrl: null },
];

function Khung({ onState }: { onState?: (d: DapAnTheoCau) => void }) {
  const [d, setD] = useState<DapAnTheoCau>({});
  onState?.(d);
  return <CauHoiLamBai cauHoi={CAU} dapAn={d} onChange={(id, a) => setD((x) => ({ ...x, [id]: a }))} videoSlot={() => <div data-testid="o-video">Ô tải video</div>} />;
}

describe("[LBU-01] học viên thấy ĐỦ mọi câu giáo viên đã giao", () => {
  it("5 câu ⇒ 5 mục, đủ đề, đủ đáp án, ô video nằm đúng chỗ câu video", () => {
    render(<Khung />);
    for (const t of ["1-2=", "1+1=2?", "3*X=9", "xếp theo thứ tự", "nộp 1 video nhé"]) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByTestId("o-video")).toBeTruthy();
    // câu chọn 1 + câu chọn nhiều: đủ 4 đáp án mỗi câu
    expect(screen.getAllByRole("radio").length).toBe(4 + 2); // chọn 1 (4) + đúng/sai (2)
    expect(screen.getAllByRole("checkbox").length).toBe(4);
    // câu sắp xếp hiện đủ 4 mục ở thứ tự đã xáo
    expect(screen.getAllByLabelText(/Đưa “.*” xuống/).length).toBe(4);
  });
});

describe("[LBU-02] bấm chọn ghi đúng đáp án", () => {
  it("chọn 1 đáp án, đúng/sai, chọn nhiều, đổi thứ tự — và dapAnDeGui chỉ gửi câu đã làm", () => {
    let d: DapAnTheoCau = {};
    render(<Khung onState={(x) => (d = x)} />);
    expect(dapAnDeGui(d)).toEqual([]);

    fireEvent.click(screen.getByRole("radio", { name: /B\s*4/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Đúng" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /3$/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /căn 9/ }));
    fireEvent.click(screen.getByLabelText("Đưa “1” lên"));

    const gui = Object.fromEntries(dapAnDeGui(d).map((x) => [x.questionId, x.dapAn]));
    expect(gui.q1).toEqual({ k: "single", i: 1 });
    expect(gui.q2).toEqual({ k: "boolean", v: true });
    expect(gui.q3).toEqual({ k: "multiple", i: [0, 3] });
    expect(gui.q4).toEqual({ k: "ordering", o: ["1", "3", "4", "2"] });
    expect(gui.q5).toBeUndefined(); // câu video không có đáp án gõ/chọn
  });
  it("bỏ chọn một đáp án chọn-nhiều ⇒ rút khỏi tập; tập rỗng không gửi lên", () => {
    let d: DapAnTheoCau = {};
    render(<Khung onState={(x) => (d = x)} />);
    const o = screen.getByRole("checkbox", { name: /căn 9/ });
    fireEvent.click(o);
    expect(d.q3).toEqual({ k: "multiple", i: [3] });
    fireEvent.click(o);
    expect(d.q3).toEqual({ k: "multiple", i: [] });
    expect(dapAnDeGui(d)).toEqual([]);
  });
});

describe("[LBU-03] coNoiDungDapAn — đáp án rỗng không tính là đã trả lời", () => {
  it.each<[DapAn | undefined, boolean]>([
    [undefined, false],
    [{ k: "text", t: "  " }, false],
    [{ k: "text", t: "robot" }, true],
    [{ k: "fill", t: ["", " "] }, false],
    [{ k: "fill", t: ["", "ba"] }, true],
    [{ k: "multiple", i: [] }, false],
    [{ k: "matching", r: ["", ""] }, false],
    [{ k: "boolean", v: false }, true], // "Sai" là một câu trả lời thật
    [{ k: "single", i: 0 }, true], // chỉ số 0 là một câu trả lời thật
  ])("%j ⇒ %s", (a, kq) => {
    expect(coNoiDungDapAn(a)).toBe(kq);
  });
});
