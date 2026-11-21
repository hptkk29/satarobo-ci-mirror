// @vitest-environment jsdom
// Nút "Thu hồi" đơn chưa duyệt (đợt 1 đơn từ, 08/10/2026) — bấm HAI lần mới gửi.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const goi = vi.hoisted(() => ({ withdraw: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/cham-cong/request-actions", () => ({ withdrawRequestAction: goi.withdraw }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: goi.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NutThuHoiDon } from "./nut-thu-hoi-don";

afterEach(() => {
  cleanup();
  goi.withdraw.mockReset();
  goi.refresh.mockReset();
});

describe("[NTH] nút thu hồi đơn", () => {
  it("[NTH-01] bấm lần 1 KHÔNG gửi gì — chỉ hiện xác nhận; 'Không' quay lại", () => {
    render(<NutThuHoiDon id="d1" />);
    fireEvent.click(screen.getByRole("button", { name: "Thu hồi" }));
    expect(goi.withdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Không" }));
    expect(screen.getByRole("button", { name: "Thu hồi" })).toBeTruthy();
    expect(goi.withdraw).not.toHaveBeenCalled();
  });

  it("[NTH-02] xác nhận ⇒ gọi action đúng id rồi làm mới trang", async () => {
    goi.withdraw.mockResolvedValue({ ok: true });
    render(<NutThuHoiDon id="d1" />);
    fireEvent.click(screen.getByRole("button", { name: "Thu hồi" }));
    fireEvent.click(screen.getByRole("button", { name: "Chắc chắn thu hồi" }));
    await waitFor(() => expect(goi.refresh).toHaveBeenCalled());
    expect(goi.withdraw).toHaveBeenCalledWith({ id: "d1" });
  });

  it("[NTH-03] server từ chối ⇒ không làm mới, nút trở về trạng thái đầu", async () => {
    goi.withdraw.mockResolvedValue({ ok: false, error: "Đơn đã được duyệt" });
    render(<NutThuHoiDon id="d1" />);
    fireEvent.click(screen.getByRole("button", { name: "Thu hồi" }));
    fireEvent.click(screen.getByRole("button", { name: "Chắc chắn thu hồi" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Thu hồi" })).toBeTruthy());
    expect(goi.refresh).not.toHaveBeenCalled();
  });
});
