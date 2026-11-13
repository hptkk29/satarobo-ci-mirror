// @vitest-environment jsdom
/**
 * [QDL-*] — khối "Dữ liệu của bạn" trong cổng DISC trên phần tử thật. Mọi ca "KHÔNG làm X" có đối chứng dương.
 *   [QDL-01] mới vào: chưa có khung xác nhận, chưa gọi action; nút Tải có (trang tổng) / không (trang chi tiết)
 *   [QDL-02] mở khung: nút "Xoá vĩnh viễn" bị khoá tới khi tick "Tôi hiểu"; chưa tick thì bấm cũng không gọi action
 *   [QDL-03] đủ hai bước ⇒ gọi action ĐÚNG MỘT lần với xacNhan "XOA" (+ id nếu xoá một lượt, không id nếu xoá tất cả)
 *   [QDL-04] "Giữ lại" đóng khung, không gọi action
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const xoa = vi.fn();
const push = vi.fn();
const refresh = vi.fn();
vi.mock("@/app/(portal)/portal/disc/_actions", () => ({ xoaKetQuaDiscAction: (...a: unknown[]) => xoa(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { QuyenDuLieuDisc } from "./quyen-du-lieu-disc";

beforeEach(() => {
  xoa.mockReset();
  xoa.mockResolvedValue({ ok: true, soBai: 1 });
  push.mockReset();
  refresh.mockReset();
});
afterEach(cleanup);

describe("[QDL] khối Dữ liệu của bạn", () => {
  it("[QDL-01] mới vào: không có khung xác nhận; nút Tải theo prop", () => {
    const { container, rerender } = render(<QuyenDuLieuDisc />);
    expect(container.querySelector("[data-khung-xac-nhan-xoa]")).toBeNull();
    expect(container.querySelector("[data-tai-du-lieu]")?.getAttribute("href")).toBe("/portal/disc/du-lieu-cua-toi");
    expect(container.querySelector("[data-mo-xoa]")).not.toBeNull();
    rerender(<QuyenDuLieuDisc idLuot="abc" choPhepTai={false} />);
    expect(container.querySelector("[data-tai-du-lieu]")).toBeNull();
    expect(xoa).not.toHaveBeenCalled();
  });

  it("[QDL-02] nút xoá vĩnh viễn khoá tới khi tick; chưa tick bấm cũng không gọi action", () => {
    const { container } = render(<QuyenDuLieuDisc />);
    fireEvent.click(container.querySelector("[data-mo-xoa]")!);
    const nut = container.querySelector("[data-xac-nhan-xoa]") as HTMLButtonElement;
    expect(nut.disabled).toBe(true);
    fireEvent.click(nut);
    expect(xoa).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector("[data-hieu-xoa]")!);
    expect((container.querySelector("[data-xac-nhan-xoa]") as HTMLButtonElement).disabled).toBe(false); // đối chứng dương
  });

  it("[QDL-03] hai bước đủ ⇒ gọi action đúng một lần, kèm xacNhan XOA", async () => {
    const { container, unmount } = render(<QuyenDuLieuDisc idLuot="luot-1" choPhepTai={false} />);
    fireEvent.click(container.querySelector("[data-mo-xoa]")!);
    fireEvent.click(container.querySelector("[data-hieu-xoa]")!);
    fireEvent.click(container.querySelector("[data-xac-nhan-xoa]")!);
    await waitFor(() => expect(xoa).toHaveBeenCalledTimes(1));
    expect(xoa).toHaveBeenCalledWith({ id: "luot-1", xacNhan: "XOA" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/portal/disc"));
    unmount();
    // xoá tất cả: KHÔNG gửi id
    const r2 = render(<QuyenDuLieuDisc />);
    fireEvent.click(r2.container.querySelector("[data-mo-xoa]")!);
    fireEvent.click(r2.container.querySelector("[data-hieu-xoa]")!);
    fireEvent.click(r2.container.querySelector("[data-xac-nhan-xoa]")!);
    await waitFor(() => expect(xoa).toHaveBeenCalledTimes(2));
    expect(xoa).toHaveBeenLastCalledWith({ xacNhan: "XOA" });
  });

  it("[QDL-04] Giữ lại đóng khung, không gọi action", () => {
    render(<QuyenDuLieuDisc />);
    fireEvent.click(screen.getByText(/Xoá kết quả của tôi/));
    fireEvent.click(screen.getByText("Giữ lại"));
    expect(document.querySelector("[data-khung-xac-nhan-xoa]")).toBeNull();
    expect(xoa).not.toHaveBeenCalled();
  });
});
