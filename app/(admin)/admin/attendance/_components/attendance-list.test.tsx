// @vitest-environment jsdom
/**
 * Bảng buổi của MỘT lớp ở màn /attendance (admin) — yêu cầu 21/08.
 *
 * Chốt những điều dễ vỡ khi ai đó sửa lại bảng này:
 *   1. THỨ TỰ do server quyết (lib/lms/attendance-queue). Bộ lọc ở client chỉ được
 *      BỚT dòng, không được xếp lại — bản đầu tiên của màn này từng `.sort()` trong
 *      `useMemo` và thế là mọi công sắp bậc ở server bị đảo ngay khi gõ vào ô tìm.
 *   2. Buổi CHƯA TỚI GIỜ không bày 3 chip việc — chip xám ở một buổi tuần sau đọc
 *      như "đang thiếu", trong khi chưa tới lượt làm.
 *   3. Nút "Chốt buổi" chỉ sáng khi đủ CẢ BA việc. Nó là nút đổi trạng thái thật, bật
 *      sớm là chốt nhầm một buổi còn dở.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const complete = vi.fn();
vi.mock("../_actions", () => ({
  completeAttendanceSessionAction: (...args: unknown[]) => complete(...args),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) },
}));

// Hộp thoại tải ảnh thật kéo theo server action + presign R2 — ngoài phạm vi bảng này.
vi.mock("@/app/(teacher)/teacher/anh-lop/_components/upload-photo-dialog", () => ({
  UploadPhotoDialog: ({ initialSessionId }: { initialSessionId?: string }) => (
    <button type="button">
      {initialSessionId ? `Tải ảnh ${initialSessionId}` : "Đăng ảnh lớp"}
    </button>
  ),
}));

import { AttendanceList, type AttendanceListRow } from "./attendance-list";

function row(over: Partial<AttendanceListRow> & { id: string }): AttendanceListRow {
  return {
    classId: "c1",
    number: 1,
    sessionLabel: "Buổi 1 - Bài học",
    dateLabel: "T5, 21/08/2026",
    timeLabel: "18:00 - 20:00",
    phase: "PENDING",
    completed: false,
    roster: 10,
    marked: 0,
    attended: 0,
    attendanceDone: false,
    feedbackDone: false,
    photoDone: false,
    photoCovered: 0,
    ...over,
  };
}

const ROWS: AttendanceListRow[] = [
  row({
    id: "s-pending",
    number: 3,
    sessionLabel: "Buổi 3 - HP1 - Việc nợ ảnh",
    marked: 10,
    attended: 9,
    attendanceDone: true,
    feedbackDone: true,
  }),
  row({
    id: "s-today",
    number: 4,
    sessionLabel: "Buổi 4 - HP1 - Việc chiều nay",
    phase: "TODAY",
  }),
  row({
    id: "s-upcoming",
    number: 5,
    sessionLabel: "Buổi 5 - HP1 - Việc tuần sau",
    phase: "UPCOMING",
  }),
  row({
    id: "s-done",
    number: 1,
    sessionLabel: "Buổi 1 - HP1 - Xong hết",
    phase: "DONE",
    marked: 10,
    attended: 10,
    attendanceDone: true,
    feedbackDone: true,
    photoDone: true,
    photoCovered: 10,
  }),
];

function mount(rows: AttendanceListRow[], canComplete = true, canFeedback = true) {
  return render(
    <AttendanceList
      rows={rows}
      classId="c1"
      className="Sata 3 - CS1"
      canComplete={canComplete}
      canFeedback={canFeedback}
    />,
  );
}

/**
 * Nội dung cột "Buổi học" của từng dòng dữ liệu.
 *
 * 26/08 — cột này nay là cột ĐẦU TIÊN: hai cột "Buổi" + "Tiêu đề buổi" đã gộp làm
 * một, khớp site giáo viên (xem đầu attendance-list.tsx).
 */
function labels(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1) // bỏ hàng tiêu đề
    .map((tr) => within(tr).getAllByRole("cell")[0].textContent ?? "");
}

beforeEach(() => {
  complete.mockReset();
  refresh.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("AttendanceList", () => {
  it("giữ NGUYÊN thứ tự server đưa xuống — kể cả khi số buổi lộn xộn", () => {
    mount(ROWS);
    expect(labels()).toEqual([
      "Buổi 3 - HP1 - Việc nợ ảnh18:00 - 20:00",
      "Buổi 4 - HP1 - Việc chiều nay18:00 - 20:00",
      "Buổi 5 - HP1 - Việc tuần sau18:00 - 20:00",
      "Buổi 1 - HP1 - Xong hết18:00 - 20:00",
    ]);
  });

  it("số buổi, học phần và tên bài nằm CHUNG một cột", () => {
    mount([ROWS[0]]);
    const dataRow = screen.getAllByRole("row")[1];
    const cells = within(dataRow).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Buổi 3 - HP1 - Việc nợ ảnh");
    // Không còn cột "Buổi" riêng ⇒ ô kế tiếp là NGÀY, không phải tên bài lặp lại.
    expect(cells[1]).toHaveTextContent("21/08/2026");
  });

  it("lớp chưa ghim giáo trình vẫn có nhãn, không để ô trống", () => {
    // Server đã lo phần rút gọn: không tra được tên bài thì nhãn còn "Buổi N".
    mount([row({ id: "s-x", sessionLabel: "Buổi 1" })]);
    expect(labels()[0]).toContain("Buổi 1");
  });

  it("lọc theo từ khoá chỉ BỚT dòng, không đảo thứ tự", () => {
    mount(ROWS);
    fireEvent.change(screen.getByLabelText("Tìm buổi học"), {
      target: { value: "việc" },
    });
    expect(labels().map((t) => t.replace("18:00 - 20:00", ""))).toEqual([
      "Buổi 3 - HP1 - Việc nợ ảnh",
      "Buổi 4 - HP1 - Việc chiều nay",
      "Buổi 5 - HP1 - Việc tuần sau",
    ]);
  });

  it("chip đếm nhanh lọc đúng bậc, bấm lại thì bỏ lọc", () => {
    mount(ROWS);
    const chip = screen.getByRole("button", { name: /Đã hoàn tất/ });
    fireEvent.click(chip);
    expect(labels()).toHaveLength(1);
    fireEvent.click(chip);
    expect(labels()).toHaveLength(4);
  });

  it("buổi còn nợ ảnh: chip Ảnh/video KHÔNG xanh, hai chip kia xanh", () => {
    mount([ROWS[0]]);
    expect(screen.getByTitle("Ảnh/video 0/9: chưa xong")).toBeInTheDocument();
    expect(screen.getByTitle("Nhận xét: xong")).toBeInTheDocument();
    expect(screen.getByTitle("Điểm danh 10/10: xong")).toBeInTheDocument();
  });

  it("buổi chưa tới giờ KHÔNG bày chip việc", () => {
    mount([ROWS[2]]);
    expect(screen.queryByTitle(/Ảnh\/video/)).not.toBeInTheDocument();
    const dataRow = screen.getAllByRole("row")[1];
    expect(within(dataRow).getByText("Chưa tới giờ")).toBeInTheDocument();
  });

  it("cột Có mặt để dấu — khi chưa ai được điểm danh", () => {
    mount([ROWS[1]]);
    const dataRow = screen.getAllByRole("row")[1];
    // Cột: 0 Buổi học · 1 Ngày · 2 Có mặt · 3 Tình trạng · 4 Việc của buổi.
    expect(within(dataRow).getAllByRole("cell")[2]).toHaveTextContent("—");
  });

  it("ba nút việc trỏ đúng chỗ, link điểm danh giữ lớp đang mở", () => {
    mount([ROWS[1]]);
    expect(screen.getByRole("link", { name: /Điểm danh/ })).toHaveAttribute(
      "href",
      "/attendance?classId=c1&sessionId=s-today",
    );
    expect(screen.getByRole("link", { name: /Nhận xét/ })).toHaveAttribute(
      "href",
      "/sessions/s-today",
    );
    expect(screen.getByRole("button", { name: "Tải ảnh s-today" })).toBeInTheDocument();
  });

  it("thiếu việc thì nút Chốt buổi bị khoá và nói rõ còn thiếu gì", () => {
    mount([ROWS[0]]);
    const btn = screen.getByRole("button", { name: /Chốt buổi/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Còn thiếu: ảnh/video (0/9 em)");
  });

  it("đủ ba việc thì bấm được, gọi action rồi làm mới trang", async () => {
    complete.mockResolvedValue({ ok: true });
    mount([row({ ...ROWS[3], completed: false })]);
    fireEvent.click(screen.getByRole("button", { name: /Chốt buổi/ }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith("s-done"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith("Đã chốt buổi");
  });

  it("action từ chối thì báo lỗi và KHÔNG làm mới trang", async () => {
    complete.mockResolvedValue({ ok: false, error: "Chưa hoàn tất: còn thiếu ảnh" });
    mount([row({ ...ROWS[3], completed: false })]);
    fireEvent.click(screen.getByRole("button", { name: /Chốt buổi/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Chưa hoàn tất: còn thiếu ảnh"),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("buổi đã chốt hiện nhãn, không còn nút bấm lại", () => {
    mount([row({ ...ROWS[3], completed: true })]);
    // Nhãn phải KHÁC chữ với bậc "Đã hoàn tất" ở cột Tình trạng, nếu không cùng một
    // dòng có hai nhãn y hệt nhau nói hai chuyện khác nhau.
    expect(screen.getByText("Đã chốt buổi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hoàn tất/ })).not.toBeInTheDocument();
  });

  it("không có quyền sessions:edit thì không thấy nút chốt buổi", () => {
    mount([row({ ...ROWS[3], completed: false })], false);
    expect(screen.queryByRole("button", { name: /Hoàn tất/ })).not.toBeInTheDocument();
  });

  it("không còn dòng nào khớp thì nói rõ phải làm gì", () => {
    mount(ROWS);
    fireEvent.change(screen.getByLabelText("Tìm buổi học"), {
      target: { value: "zzz-không-có" },
    });
    expect(screen.getByText("Không có buổi học nào khớp bộ lọc")).toBeInTheDocument();
  });
});

describe("nút Nhận xét theo quyền (chủ dự án chốt 04/09/2026)", () => {
  it("KHÔNG có quyền → nút biến mất, các nút còn lại giữ nguyên", () => {
    // Sale / Quản lý lớp học: `/sessions/[id]` redirect họ ra, nên hiện nút là chỉ
    // đường tới ngõ cụt — bấm vào bị đá về, trông như hệ thống lỗi.
    // Điểm danh và Tải ảnh vẫn phải còn: đó đúng là hai việc họ ĐƯỢC làm.
    mount([row({ id: "s-nx-1" })], true, false);
    expect(screen.queryByRole("link", { name: /Nhận xét/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Điểm danh/ })).toBeTruthy();
  });

  it("CÓ quyền → nút hiện như cũ", () => {
    mount([row({ id: "s-nx-2" })], true, true);
    expect(screen.getByRole("link", { name: /Nhận xét/ })).toBeTruthy();
  });
});
