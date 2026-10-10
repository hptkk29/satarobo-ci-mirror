// @vitest-environment jsdom
/**
 * [RSX-05] Lỗi MẠNG lúc lưu ảnh đại diện KHÔNG được làm sập trang hồ sơ (25/09/2026).
 *
 * Action ném (mất kết nối, deploy mới đổi mã action…) thay vì trả `{ ok:false }`. Trong
 * `startTransition`, lời hứa bị từ chối đi thẳng lên error boundary và thay CẢ trang bằng
 * màn lỗi — mất luôn chữ đang gõ dở ở form bên dưới. Phải bắt tại chỗ và báo trong khung ảnh.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../[id]/_anh-dai-dien-actions", () => ({
  datAnhDaiDienHocVien: vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AnhDaiDienHoSo } from "./anh-dai-dien";

describe("[RSX-05] lưu ảnh gặp lỗi mạng", () => {
  it("gỡ ảnh khi action NÉM ⇒ báo lỗi trong khung, không ném ra ngoài", async () => {
    render(<AnhDaiDienHoSo studentId="hv_1" ten="Nguyễn Minh An" url="https://cdn.x/y.jpg" />);
    fireEvent.click(screen.getByRole("button", { name: /Gỡ ảnh/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bấm lần nữa/ }));
    expect(await screen.findByText("Mất kết nối — chưa lưu được ảnh. Thử lại.")).toBeTruthy();
  });
});
