// @vitest-environment jsdom
/**
 * Panel "Điểm danh" của trang chi tiết lớp (admin).
 *
 * Vì sao cần test: sự cố 19/08/2026 — quản lý báo "giáo viên điểm danh rồi mà admin
 * không thấy". Hai cái bẫy, cái thứ hai mới là cái khiến người dùng không tự cứu được:
 *   1. trang mở sẵn buổi CHƯA điểm danh (luật chọn buổi — test riêng ở
 *      lib/classes/default-session.test.ts);
 *   2. bản cũ giữ `selectedId` và `rows` ở HAI state rời nên có một nhịp render mang
 *      key MỚI + rows CŨ ⇒ AttendanceGrid remount rồi lazy-init state từ roster buổi
 *      TRƯỚC và đứng yên như thế. Chọn đúng buổi đã điểm danh vẫn thấy trắng.
 * Test chốt: lưới KHÔNG BAO GIỜ được mount với cặp (sessionId, rows) lệch nhau.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { AttendanceRosterRow } from "@/lib/attendance/roster";

/** Ghi lại MỌI lần AttendanceGrid được mount, kèm props lúc mount. */
const mounts: { sessionId: string; studentIds: string[]; marked: number }[] = [];

vi.mock("../../../attendance/_components/attendance-grid", () => ({
  AttendanceGrid: ({ sessionId, rows }: { sessionId: string; rows: AttendanceRosterRow[] }) => {
    mounts.push({
      sessionId,
      studentIds: rows.map((r) => r.studentId),
      marked: rows.filter((r) => r.existing).length,
    });
    return (
      <div data-testid="grid" data-session={sessionId} data-marked={rows.filter((r) => r.existing).length}>
        {rows.map((r) => (
          <span key={r.studentId}>{r.studentName}</span>
        ))}
      </div>
    );
  },
}));

const loadRoster = vi.fn();
vi.mock("../_attendance-actions", () => ({
  loadClassSessionRoster: (...args: unknown[]) => loadRoster(...args),
}));

import { ClassAttendancePanel } from "./class-attendance-panel";
import type { SessionRow } from "./class-sessions-manage";

function row(id: string, name: string, marked: boolean): AttendanceRosterRow {
  return {
    studentId: id,
    studentName: name,
    studentPhone: null,
    enrollmentStatus: "ACTIVE",
    // `chuaToiLuot` BẮT BUỘC từ 28/09 — `null` = được học buổi này, đúng mặc định cho
    // mọi ca của bảng này (chúng đo việc chấm/điểm danh, không đo phạm vi buổi).
    chuaToiLuot: null,
    ketQuaBu: null, // T08 — BẮT BUỘC khai; các ca này đo việc chấm điểm danh, không đo kết quả học bù
    existing: marked
      ? {
          id: `att-${id}`,
          status: "PRESENT",
          note: null,
          makeupStatus: "NONE",
          absenceReason: null,
        }
      : null,
  };
}

const SESSIONS: SessionRow[] = [
  {
    id: "buoi-cu",
    date: "2026-08-03T11:00:00.000Z",
    topic: "Bài 1",
    status: "COMPLETED",
    seq: 1,
    soLoTrinh: 1,
    attendanceCount: 2,
    feedbackCount: 2,
  },
  {
    id: "buoi-moi",
    date: "2026-08-17T11:00:00.000Z",
    topic: "Bài 2",
    status: "SCHEDULED",
    seq: 2,
    soLoTrinh: 2,
    attendanceCount: 0,
    feedbackCount: 0,
  },
];

// Buổi mặc định = buổi CHƯA điểm danh (đúng tình huống thật của lớp đang chạy).
const ROSTER_TRONG = [row("hv1", "An", false), row("hv2", "Bình", false)];
const ROSTER_DA_DIEM_DANH = [row("hv1", "An", true), row("hv2", "Bình", true)];

beforeEach(() => {
  mounts.length = 0;
  loadRoster.mockReset();
});

describe("ClassAttendancePanel", () => {
  it("chọn buổi đã điểm danh → lưới hiện ĐÚNG dữ liệu buổi đó, không giữ buổi trước", async () => {
    loadRoster.mockResolvedValue({ ok: true, rows: ROSTER_DA_DIEM_DANH });
    render(
      <ClassAttendancePanel
        sessions={SESSIONS}
        initialSessionId="buoi-moi"
        initialRows={ROSTER_TRONG}
      />,
    );

    expect(screen.getByTestId("grid").getAttribute("data-marked")).toBe("0");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "buoi-cu" } });

    await waitFor(() => {
      expect(screen.getByTestId("grid").getAttribute("data-session")).toBe("buoi-cu");
    });
    expect(screen.getByTestId("grid").getAttribute("data-marked")).toBe("2");
  });

  it("KHÔNG bao giờ mount lưới với cặp (buổi, roster) lệch nhau", async () => {
    loadRoster.mockResolvedValue({ ok: true, rows: ROSTER_DA_DIEM_DANH });
    render(
      <ClassAttendancePanel
        sessions={SESSIONS}
        initialSessionId="buoi-moi"
        initialRows={ROSTER_TRONG}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "buoi-cu" } });
    await waitFor(() => {
      expect(screen.getByTestId("grid").getAttribute("data-session")).toBe("buoi-cu");
    });

    // Bản lỗi mount ("buoi-cu", roster của "buoi-moi") ⇒ marked = 0. Bản đúng không có.
    const lech = mounts.filter(
      (m) =>
        (m.sessionId === "buoi-cu" && m.marked !== 2) ||
        (m.sessionId === "buoi-moi" && m.marked !== 0),
    );
    expect(lech).toEqual([]);
  });

  it("nhãn <option> nói rõ buổi nào đã điểm danh", () => {
    render(
      <ClassAttendancePanel
        sessions={SESSIONS}
        initialSessionId="buoi-moi"
        initialRows={ROSTER_TRONG}
      />,
    );
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.some((t) => t.includes("đã điểm danh 2"))).toBe(true);
    expect(options.some((t) => t.includes("chưa điểm danh"))).toBe(true);
  });

  it("action lỗi → hiện lỗi, KHÔNG hiện lưới của buổi cũ", async () => {
    loadRoster.mockResolvedValue({ ok: false, error: "Không có quyền" });
    render(
      <ClassAttendancePanel
        sessions={SESSIONS}
        initialSessionId="buoi-moi"
        initialRows={ROSTER_TRONG}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "buoi-cu" } });

    await waitFor(() => {
      expect(screen.getByText("Không có quyền")).toBeTruthy();
    });
    expect(screen.queryByTestId("grid")).toBeNull();
  });
});
