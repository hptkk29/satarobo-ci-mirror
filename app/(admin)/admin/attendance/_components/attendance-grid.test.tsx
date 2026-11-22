// @vitest-environment jsdom
/**
 * Lưới điểm danh admin khi lớp có em ĐANG BẢO LƯU (hàng mang `chuaToiLuot` = lý do).
 *
 * Em bảo lưu vẫn HIỆN (kèm lý do), nhưng server (`getSessionRosterStudentIds`) từ chối CẢ LÔ nếu có một em ngoài tập chấm được. Nên lưới phải:
 *   1. không đếm em đó vào "chưa đánh dấu" (nếu không thì không bao giờ lưu được);
 *   2. không để "Tất cả có mặt" gán cho em đó;
 *   3. không gửi em đó lên server.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const markAttendance = vi.fn();
vi.mock("../_actions", () => ({ markAttendance: (...a: unknown[]) => markAttendance(...a) }));

import { AttendanceGrid } from "./attendance-grid";

const hang = (id: string, ten: string, chuaToiLuot: string | null) => ({
  studentId: id,
  studentName: ten,
  studentPhone: null,
  enrollmentStatus: "ACTIVE",
  existing: null,
  chuaToiLuot,
});
const ROWS = [
  hang("a", "Học viên A", null),
  hang("b", "Học viên B", "Đang bảo lưu từ 01/10/2026"),
  hang("c", "Học viên C", null),
];

beforeEach(() => {
  markAttendance.mockReset();
  markAttendance.mockResolvedValue({ saved: 2 });
});

describe("[AGB] AttendanceGrid với học viên đang bảo lưu", () => {
  it("[AGB-01] hiện lý do bảo lưu và KHÔNG vẽ nút chấm cho em đó", () => {
    render(<AttendanceGrid sessionId="s1" rows={ROWS} lyDoKhoa={null} coQuyenKhongCanBu={false} />);
    expect(screen.getByText(/Đang bảo lưu từ 01\/10\/2026 — chưa điểm danh buổi này/)).toBeTruthy();
    // 2 em chấm được × 4 nhãn = 8 nút "Có mặt/Vắng/Muộn/Phép"; em bảo lưu không có nút nào
    expect(screen.getAllByRole("button", { name: /^(Có mặt|Vắng|Muộn|Phép)$/ })).toHaveLength(8);
  });

  it("[AGB-02] chỉ đếm 'chưa đánh dấu' trên em chấm được (2, không phải 3)", () => {
    render(<AttendanceGrid sessionId="s1" rows={ROWS} lyDoKhoa={null} coQuyenKhongCanBu={false} />);
    expect(screen.getByText("2", { selector: "span.font-bold" })).toBeTruthy();
  });

  it("[AGB-03] 'Tất cả có mặt' rồi Lưu ⇒ gửi đúng 2 em chấm được, KHÔNG có em bảo lưu, và không bị chặn vì 'còn chưa đánh dấu'", async () => {
    render(<AttendanceGrid sessionId="s1" rows={ROWS} lyDoKhoa={null} coQuyenKhongCanBu={false} />);
    fireEvent.click(screen.getByRole("button", { name: /tất cả/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Lưu/ }));
    await waitFor(() => expect(markAttendance).toHaveBeenCalledTimes(1));
    const [, records] = markAttendance.mock.calls[0] as [string, { studentId: string }[]];
    expect(records.map((r) => r.studentId).sort()).toEqual(["a", "c"]);
  });
});

// ── "Không cần bù": chỉ cấp quản lý cơ sở + bắt buộc lý do (22/10/2026) ─────────────────────────────────────────────
const MOT_EM = [hang("a", "Học viên A", null)];
const LY_DO_DU = "Phụ huynh báo con đã học trước";
const bamVang = () => fireEvent.click(screen.getByRole("button", { name: "Vắng" }));
const luuLai = () => fireEvent.click(screen.getByRole("button", { name: /^Lưu/ }));

describe("[AGB] 'Không cần bù' — quyền + lý do", () => {
  it("[AGB-04] KHÔNG có quyền ⇒ chọn Vắng chỉ có 'Cần học bù' / 'Đã học bù'; ĐỐI CHỨNG — có quyền thì có nút 'Không cần bù'", () => {
    const { unmount } = render(<AttendanceGrid sessionId="s1" rows={MOT_EM} lyDoKhoa={null} coQuyenKhongCanBu={false} />);
    bamVang();
    expect(screen.getByRole("button", { name: "Cần học bù" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Đã học bù" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Không cần bù" })).toBeNull();
    unmount();
    render(<AttendanceGrid sessionId="s1" rows={MOT_EM} lyDoKhoa={null} coQuyenKhongCanBu={true} />);
    bamVang();
    expect(screen.getByRole("button", { name: "Không cần bù" })).toBeTruthy();
  });

  it("[AGB-05] chọn 'Không cần bù' ⇒ hiện ô lý do; Lưu khi CHƯA đủ lý do bị chặn (không gọi máy chủ) và nói tên em; đủ lý do ⇒ gửi kèm lý do", async () => {
    render(<AttendanceGrid sessionId="s1" rows={MOT_EM} lyDoKhoa={null} coQuyenKhongCanBu={true} />);
    bamVang();
    expect(screen.queryByLabelText("Lý do không cần bù")).toBeNull(); // mặc định là 'Cần học bù' ⇒ chưa đòi lý do
    fireEvent.click(screen.getByRole("button", { name: "Không cần bù" }));
    const o = screen.getByLabelText("Lý do không cần bù") as HTMLInputElement;
    luuLai();
    expect(markAttendance).not.toHaveBeenCalled();
    expect(screen.getByText(/Học viên A: ghi lý do "Không cần bù" ít nhất/)).toBeTruthy();
    fireEvent.change(o, { target: { value: "ngắn" } });
    luuLai();
    expect(markAttendance).not.toHaveBeenCalled();
    fireEvent.change(o, { target: { value: `  ${LY_DO_DU}  ` } });
    luuLai();
    await waitFor(() => expect(markAttendance).toHaveBeenCalledTimes(1));
    const [, records] = markAttendance.mock.calls[0] as [string, { studentId: string; makeupStatus: string; lyDoKhongCanBu: string | null }[]];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ studentId: "a", makeupStatus: "NONE", lyDoKhongCanBu: LY_DO_DU });
  });

  it("[AGB-06] hàng ĐÃ là 'không cần bù' từ trước (bản ghi tải về là NONE): sửa ghi chú rồi Lưu KHÔNG đòi lý do lại và gửi lyDoKhongCanBu = null", async () => {
    const cu = { ...hang("e", "Học viên E", null), existing: { id: "x", status: "ABSENT", note: null, makeupStatus: "NONE", absenceReason: null } };
    render(<AttendanceGrid sessionId="s1" rows={[cu as never]} lyDoKhoa={null} coQuyenKhongCanBu={true} />);
    expect(screen.queryByLabelText("Lý do không cần bù")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Ghi chú (tuỳ chọn)"), { target: { value: "đã gọi phụ huynh" } });
    luuLai();
    await waitFor(() => expect(markAttendance).toHaveBeenCalledTimes(1));
    const [, records] = markAttendance.mock.calls[0] as [string, { makeupStatus: string; lyDoKhongCanBu: string | null }[]];
    expect(records[0]).toMatchObject({ makeupStatus: "NONE", lyDoKhongCanBu: null });
  });
});
