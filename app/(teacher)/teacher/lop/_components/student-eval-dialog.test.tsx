// @vitest-environment jsdom
/**
 * Hộp thoại "Nhận xét buổi học" sau thay đổi 21/08.
 *
 * Ba thứ phải khoá bằng test, vì cả ba đều là kiểu hỏng ÂM THẦM (màn hình vẫn đẹp,
 * dữ liệu mới sai):
 *   1. Mở phiếu CŨ (4 mục) rồi bấm Lưu phải giữ được chữ giáo viên đã viết — upsert ghi
 *      đè TRỌN cột `notes`, mồi ô rỗng là xoá trắng mà không ai thấy.
 *   2. Ô "Dự án" hết là <input>: tên đến từ buổi học, giáo viên không gõ tay nữa.
 *   3. Trần 2000 ký tự phải chặn ở client kèm số dư — phiếu cũ ghép lại có thể dài hơn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { normalizeEvalNotes } from "@/lib/lms/session-eval-rubric";

const saveSessionEval = vi.fn();
vi.mock("@/app/(admin)/admin/sessions/[id]/_actions", () => ({
  saveSessionEval: (...args: unknown[]) => saveSessionEval(...args),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { StudentEvalDialog } from "./student-eval-dialog";

function moPhieu(props: Partial<Parameters<typeof StudentEvalDialog>[0]> = {}) {
  render(
    <StudentEvalDialog
      sessionId="s1"
      studentId="hv1"
      studentName="Nguyễn An"
      courseName="Sata 3"
      sessionTopic="Cảm biến"
      sessionDate="2026-08-17"
      projectName="Dự án 7: Robot dò line"
      existing={null}
      done={false}
      pdfHref="/teacher/nhan-xet/pdf/s1/hv1"
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Nhận xét|Xem phiếu/ }));
}

beforeEach(() => {
  saveSessionEval.mockReset();
  saveSessionEval.mockResolvedValue({ ok: true });
  toastError.mockReset();
});

describe("StudentEvalDialog — ô Đánh giá chung + tên dự án tự điền", () => {
  it("chỉ còn MỘT ô nhận xét, không còn 4 ô Kiến thức/Kỹ năng/Thái độ/Đề xuất", () => {
    moPhieu();
    expect(screen.getByLabelText(/Đánh giá chung/)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Nhận xét về kiến thức/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/Nhận xét về đề xuất/i)).toBeNull();
  });

  it("tên dự án hiện ra nhưng KHÔNG phải ô nhập — và được gửi lên nguyên vẹn", async () => {
    moPhieu();
    const ten = screen.getByText("Dự án 7: Robot dò line");
    expect(ten.tagName).not.toBe("INPUT");
    expect(ten.closest("input")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Đánh giá chung/), {
      target: { value: "Con học tốt." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lưu nhận xét/ }));
    await waitFor(() => expect(saveSessionEval).toHaveBeenCalledTimes(1));
    expect(saveSessionEval.mock.calls[0][0]).toMatchObject({
      projectName: "Dự án 7: Robot dò line",
      notes: { overall: "Con học tốt." },
    });
  });

  it("khối gợi ý 4 khía cạnh hiện sẵn (thay cho 4 nhãn ô cũ)", () => {
    moPhieu();
    expect(screen.getByText(/Hướng dẫn gợi ý khi viết nhận xét chung/)).toBeTruthy();
    expect(screen.getByText("Kiến thức:")).toBeTruthy();
    expect(screen.getByText("Đề xuất:")).toBeTruthy();
  });

  it("phiếu CŨ 4 mục → ô nhập được mồi sẵn bằng 4 mục ghép lại, không mất chữ", () => {
    moPhieu({
      existing: {
        projectName: "Dự án 1: Làm quen hệ thống",
        notes: normalizeEvalNotes({
          knowledge: "Nắm chắc bài cũ.",
          skill: "Lắp ráp gọn.",
          attitude: "",
          proposal: "Luyện thêm ở nhà.",
        }),
        rubric: {},
      },
      done: true,
    });
    const o = screen.getByLabelText(/Đánh giá chung/) as HTMLTextAreaElement;
    expect(o.value).toBe(
      "Kiến thức: Nắm chắc bài cũ.\nKỹ năng: Lắp ráp gọn.\nĐề xuất: Luyện thêm ở nhà.",
    );
  });

  it("phiếu trắng (không chữ, không động rubric) bị CHẶN — không ghi phiếu bịa", async () => {
    moPhieu();
    fireEvent.click(screen.getByRole("button", { name: /Lưu nhận xét/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(saveSessionEval).not.toHaveBeenCalled();
  });

  it("phiếu CŨ ghép lại >2000 mà GV KHÔNG sửa chữ → vẫn lưu được (chỉ đổi rubric)", async () => {
    const dai = "x".repeat(1200); // 2 mục × 1200 + nhãn > 2000
    moPhieu({
      existing: {
        projectName: null,
        notes: normalizeEvalNotes({ knowledge: dai, skill: dai }),
        rubric: {},
      },
      done: true,
    });
    const o = screen.getByLabelText(/Đánh giá chung/) as HTMLTextAreaElement;
    expect(o.value.length).toBeGreaterThan(2000);
    fireEvent.click(screen.getByRole("button", { name: /Lưu nhận xét/ }));
    await waitFor(() => expect(saveSessionEval).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("phiếu CŨ >2000 mà GV CÓ sửa chữ → phải rút xuống dưới trần mới lưu được", async () => {
    const dai = "x".repeat(1200);
    moPhieu({
      existing: {
        projectName: null,
        notes: normalizeEvalNotes({ knowledge: dai, skill: dai }),
        rubric: {},
      },
      done: true,
    });
    const o = screen.getByLabelText(/Đánh giá chung/) as HTMLTextAreaElement;
    fireEvent.change(o, { target: { value: o.value + " thêm chữ" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu nhận xét/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(saveSessionEval).not.toHaveBeenCalled();
  });

  it("quá 2000 ký tự → chặn Lưu và nói rõ thừa bao nhiêu, KHÔNG cắt ngầm", async () => {
    moPhieu();
    fireEvent.change(screen.getByLabelText(/Đánh giá chung/), {
      target: { value: "x".repeat(2010) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lưu nhận xét/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain("10 ký tự");
    expect(saveSessionEval).not.toHaveBeenCalled();
  });
});
