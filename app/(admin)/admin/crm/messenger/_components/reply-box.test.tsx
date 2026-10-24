// @vitest-environment jsdom
/**
 * S-2b — HỘP TRẢ LỜI phải NÓI THẬT về việc tin có tới khách hay không.
 *
 * Đây là chỗ lỗi cũ hiện ra với người dùng: action trả `{ ok: true }` là ô này bắn
 * `toast.success("Đã gửi")`, bất kể tin có đi hay không. Test dựng component THẬT,
 * bấm nút THẬT, rồi soi loại toast đã bắn — không so chuỗi mã nguồn (quy ước 21).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  replyAction: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: h.success, warning: h.warning, error: h.error },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("../actions", () => ({ replyAction: h.replyAction }));

import { ReplyBox } from "./reply-box";

// `@testing-library/user-event` KHÔNG có trong repo và luật kho cấm tự thêm thư viện,
// nên dùng `fireEvent` — với <input> điều khiển thì `change` là đủ để React nhận giá trị.
function go(noiDung = "Dạ em chào chị") {
  fireEvent.change(screen.getByPlaceholderText(/Nhập trả lời/i), {
    target: { value: noiDung },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Gửi/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("[S-2b] hộp trả lời — 'Đã gửi' chỉ khi ĐÃ GỬI THẬT", () => {
  it("gửi thật ⇒ toast success", async () => {
    h.replyAction.mockResolvedValue({ ok: true, daGuiThat: true });
    render(<ReplyBox conversationId="conv-1" moPhong={false} />);
    go();
    await waitFor(() => expect(h.success).toHaveBeenCalledTimes(1));
    expect(h.warning).not.toHaveBeenCalled();
  });

  it("MÔ PHỎNG ⇒ TUYỆT ĐỐI không toast success; phải là cảnh báo mang đúng câu của server", async () => {
    h.replyAction.mockResolvedValue({
      ok: true,
      daGuiThat: false,
      canhBao: "Chế độ mô phỏng — khách KHÔNG nhận được tin này.",
    });
    render(<ReplyBox conversationId="conv-1" moPhong />);
    go();
    await waitFor(() => expect(h.warning).toHaveBeenCalledTimes(1));
    expect(h.success).not.toHaveBeenCalled();
    expect(String(h.warning.mock.calls[0]![0])).toMatch(/KHÔNG/);
  });

  it("thất bại (ngoài cửa sổ 24h) ⇒ toast error mang nguyên câu giải thích", async () => {
    h.replyAction.mockResolvedValue({
      ok: false,
      error: "Facebook chỉ cho trả lời trong 24 giờ kể từ tin nhắn cuối của khách.",
    });
    render(<ReplyBox conversationId="conv-1" moPhong={false} />);
    go();
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
    expect(h.success).not.toHaveBeenCalled();
    expect(String(h.error.mock.calls[0]![0])).toMatch(/24 giờ/);
  });

  it("ở chế độ mô phỏng, người dùng thấy cảnh báo NGAY trên ô nhập, không phải bấm mới biết", async () => {
    h.replyAction.mockResolvedValue({ ok: true, daGuiThat: false, canhBao: "…" });
    render(<ReplyBox conversationId="conv-1" moPhong />);
    expect(screen.getByRole("status")).toHaveTextContent(/mô phỏng/i);
  });

  it("đang chạy thật thì KHÔNG hiện cảnh báo mô phỏng (đừng doạ người dùng vô cớ)", () => {
    render(<ReplyBox conversationId="conv-1" moPhong={false} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
