// @vitest-environment jsdom
/**
 * G-29 (08/10/2026) — panel điểm danh site GV với lớp có em CHƯA TỚI LƯỢT.
 * Bản cũ: đòi chấm đủ MỌI hàng mới cho Lưu, trong khi server chỉ nhận em tới lượt ⇒
 * giáo viên bị kẹt ở "Còn 1 em chưa đánh dấu" mà em đó không có nút nào để bấm.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const save = vi.fn();
vi.mock("../_actions", () => ({
  saveClassAttendanceAction: (...a: unknown[]) => save(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() },
}));

import { AttendancePanel, type AttendancePanelRow } from "./attendance-panel";

function row(id: string, name: string, chuaToiLuot: string | null): AttendancePanelRow {
  return {
    studentId: id,
    studentName: name,
    enrollmentStatus: "ACTIVE",
    existingStatus: null,
    existingNote: null,
    chuaToiLuot,
  };
}

beforeEach(() => {
  save.mockReset();
  toastError.mockReset();
  save.mockResolvedValue({ ok: true, saved: 2 });
});

describe("[G29-UI] AttendancePanel có em chưa tới lượt", () => {
  const rows = [row("a", "An", null), row("b", "Bình", null), row("c", "Chi", "Học từ buổi 25")];

  it("[G29-UI-01] chấm hai em tới lượt rồi Lưu ⇒ gọi action, lô KHÔNG chứa em chưa tới lượt", async () => {
    render(<AttendancePanel sessionId="s1" rows={rows} editable />);
    fireEvent.click(screen.getByLabelText("Có mặt — An"));
    fireEvent.click(screen.getByLabelText("Có mặt — Bình"));
    fireEvent.click(screen.getByRole("button", { name: /Lưu điểm danh/ }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const recs = save.mock.calls[0][1] as { studentId: string }[];
    expect(recs.map((r) => r.studentId).sort()).toEqual(["a", "b"]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("[G29-UI-02] 'Đánh dấu tất cả có mặt' không gán em chưa tới lượt; em đó không có nút trạng thái", async () => {
    render(<AttendancePanel sessionId="s1" rows={rows} editable />);
    expect(screen.queryByLabelText("Có mặt — Chi")).toBeNull();
    expect(screen.getByText(/Học từ buổi 25/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Đánh dấu tất cả có mặt/));
    fireEvent.click(screen.getByRole("button", { name: /Lưu điểm danh/ }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const recs = save.mock.calls[0][1] as { studentId: string }[];
    expect(recs.map((r) => r.studentId).sort()).toEqual(["a", "b"]);
  });

  it("[G29-UI-03] chưa chấm em nào tới lượt ⇒ vẫn bị chặn đúng ('Còn 2 em')", () => {
    render(<AttendancePanel sessionId="s1" rows={rows} editable />);
    fireEvent.click(screen.getByLabelText("Có mặt — An"));
    fireEvent.click(screen.getByRole("button", { name: /Lưu điểm danh/ }));
    expect(save).not.toHaveBeenCalled();
    expect(String(toastError.mock.calls[0]?.[0])).toMatch(/Còn 1 em/);
  });

  it("[G29-UI-04] cả lớp chưa tới lượt ⇒ nút Lưu bị khoá", () => {
    render(<AttendancePanel sessionId="s1" rows={[row("c", "Chi", "Học từ buổi 25")]} editable />);
    expect((screen.getByRole("button", { name: /Lưu điểm danh/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
