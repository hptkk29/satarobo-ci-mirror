// @vitest-environment jsdom
/**
 * Tab "Đánh giá & Nhận xét" của trang lớp (admin/Đào tạo).
 *
 * Vì sao cần test: lỗi được báo 18/08 là "chỗ đánh giá trong lớp học của admin không xem
 * được đánh giá các buổi học". Hai cái bẫy phải chốt lại bằng test, không phải bằng mắt:
 *   1. phiếu RUBRIC-ONLY (comment = null) từng ra thẻ TRỐNG ở admin vì đường đọc cũ chỉ
 *      lấy comment+rating — đúng lỗi đã vá cho phụ huynh mà quên vá cho quản lý;
 *   2. học viên có phiếu nhưng KHÔNG còn trong sĩ số (học bù / đã chuyển lớp) từng biến
 *      mất khỏi màn quản lý.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ClassFeedbackPanel } from "./class-feedback-panel";
import type { ClassSessionFeedbackData } from "@/lib/classes/session-feedback-data";

const RONG: ClassSessionFeedbackData = {
  sessions: [],
  students: [],
  entries: [],
  totalSessions: 0,
};

const DATA: ClassSessionFeedbackData = {
  totalSessions: 2,
  sessions: [
    {
      id: "s2",
      dateISO: "2026-08-10T02:00:00.000Z",
      seq: 2,
      label: "Bài 2: Cảm biến",
      status: "COMPLETED",
      attended: 2,
      reviewed: 2,
      attendanceTaken: true,
      complete: true,
    },
    {
      id: "s1",
      dateISO: "2026-08-03T02:00:00.000Z",
      seq: 1,
      label: "Bài 1: Làm quen",
      status: "COMPLETED",
      attended: 2,
      reviewed: 1,
      attendanceTaken: true,
      complete: false,
    },
  ],
  students: [
    { id: "hv1", name: "Nguyễn An", studentCode: "CS1-26-AAA", isGuest: false, reviewedCount: 2 },
    { id: "hv2", name: "Trần Bình", studentCode: null, isGuest: false, reviewedCount: 0 },
    { id: "hv9", name: "Lê Học Bù", studentCode: "CS2-26-ZZZ", isGuest: true, reviewedCount: 1 },
  ],
  entries: [
    {
      sessionId: "s1",
      studentId: "hv1",
      projectName: "Dự án 1: Xe dò line",
      // Phiếu CŨ (trước 21/08): 4 mục rời, chưa có "Đánh giá chung" — giữ nguyên ở đây
      // để khoá đường đọc ngược; phiếu dạng mới có case riêng bên dưới.
      notes: {
        overall: "",
        knowledge: "Nắm chắc bài cũ.",
        skill: "",
        attitude: "",
        proposal: "",
      },
      rubric: null,
      comment: "Kiến thức: Nắm chắc bài cũ.",
      rating: 4,
      teacherName: "GV Hoà",
      updatedAtISO: "2026-08-03T05:00:00.000Z",
    },
    {
      // Phiếu RUBRIC-ONLY — không văn xuôi, không sao. Trước đây admin thấy ô trống.
      sessionId: "s2",
      studentId: "hv1",
      projectName: null,
      notes: null,
      rubric: { "kt-cu": 1, "td-tt": 5 },
      comment: "",
      rating: null,
      teacherName: "GV Dạy Thay",
      updatedAtISO: "2026-08-10T05:00:00.000Z",
    },
    {
      sessionId: "s2",
      studentId: "hv9",
      projectName: null,
      notes: null,
      rubric: { "kt-moi": 2 },
      comment: "",
      rating: null,
      teacherName: "GV Hoà",
      updatedAtISO: "2026-08-10T05:00:00.000Z",
    },
  ],
};

describe("ClassFeedbackPanel — nhận xét buổi học của cả lớp", () => {
  it("lớp chưa có buổi nào → báo rõ, không dựng bảng rỗng", () => {
    render(<ClassFeedbackPanel data={RONG} />);
    expect(screen.getByText(/Lớp chưa có buổi học nào/)).toBeTruthy();
  });

  it("bảng tổng quan liệt kê từng buổi kèm tiến độ đã-nhận-xét/đi-học", () => {
    const { container } = render(<ClassFeedbackPanel data={DATA} />);
    // Tên bài xuất hiện ở CẢ bảng tổng quan lẫn tiêu đề thẻ phiếu bên dưới — chủ ý.
    const bang = container.querySelector("table") as HTMLTableElement;
    const dong = within(bang).getAllByRole("row").slice(1); // bỏ hàng tiêu đề
    expect(dong).toHaveLength(2);
    expect(within(dong[0]).getByText("Bài 2: Cảm biến")).toBeTruthy();
    expect(within(dong[0]).getByText("2/2")).toBeTruthy();
    expect(within(dong[1]).getByText("Bài 1: Làm quen")).toBeTruthy();
    expect(within(dong[1]).getByText("1/2")).toBeTruthy();
  });

  it("mỗi buổi có lối bấm sang trang chi tiết buổi (trước đây phải tự gõ URL)", () => {
    render(<ClassFeedbackPanel data={DATA} />);
    const links = screen.getAllByRole("link", { name: /Mở buổi/ });
    expect(links.map((a) => a.getAttribute("href")).sort()).toEqual([
      "/sessions/s1",
      "/sessions/s2",
    ]);
  });

  it("phiếu RUBRIC-ONLY vẫn hiện đủ nội dung — đây là lỗi gốc được báo", () => {
    render(<ClassFeedbackPanel data={DATA} />);
    // Text mức 1 của tiêu chí "kt-cu" và mức 5 của "td-tt" (lib/lms/session-eval-rubric).
    expect(screen.getByText(/Nhớ rõ toàn bộ kiến thức cũ/)).toBeTruthy();
    expect(screen.getByText(/dễ bị phân tâm/)).toBeTruthy();
    // Và KHÔNG được rơi vào thông báo "phiếu chưa có nội dung".
    expect(screen.queryByText(/Phiếu chưa có nội dung nhận xét/)).toBeNull();
  });

  it("phiếu văn xuôi hiện nhãn mục + tên dự án + người viết phiếu (GV dạy thay)", () => {
    render(<ClassFeedbackPanel data={DATA} />);
    expect(screen.getByText(/Nắm chắc bài cũ/)).toBeTruthy();
    // 26/08 — thẻ đã có nhãn "Dự án:" đứng trước, nên tiền tố "Dự án 1:" trong giá trị
    // ĐÃ LƯU bị cắt lúc hiển thị (displayProjectName). Trước đó in ra
    // "Dự án: Dự án 1: Xe dò line", và con số còn chọi với số buổi của phiếu.
    expect(screen.getByText(/Xe dò line/)).toBeTruthy();
    expect(screen.queryByText(/Dự án 1: Xe dò line/)).toBeNull();
    expect(screen.getByText(/GV: GV Dạy Thay/)).toBeTruthy();
  });

  it("học viên chưa có phiếu nào vẫn có dòng riêng, ghi rõ là chưa có", () => {
    render(<ClassFeedbackPanel data={DATA} />);
    expect(screen.getByText("Trần Bình")).toBeTruthy();
    expect(screen.getByText(/Chưa có nhận xét nào cho học viên này/)).toBeTruthy();
  });

  it("học viên có phiếu nhưng ngoài sĩ số (học bù) KHÔNG bị bỏ sót", () => {
    render(<ClassFeedbackPanel data={DATA} />);
    const ten = screen.getByText("Lê Học Bù");
    expect(within(ten).getByText("Ngoài sĩ số")).toBeTruthy();
    expect(screen.getByText(/Tiếp thu kiến thức tốt/)).toBeTruthy();
  });
});
