// @vitest-environment jsdom
/** [HDNAV-E*] Trạng thái LỖI của trang con: nói đúng màn nào hỏng, có mã để đọc cho kỹ thuật, có đường thử lại. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LoiKhuVuc } from "./loi-khu-vuc";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("[HDNAV-E1] lỗi trang con", () => {
  it("in tiêu đề riêng của trang (không mượn câu của bàn chứng từ) + mã lỗi; Thử lại gọi reset", () => {
    const reset = vi.fn();
    render(<LoiKhuVuc error={Object.assign(new Error("boom"), { digest: "abc123" })} reset={reset} tieuDe="Không tải được cấu hình hoá đơn" moTa="Máy chủ báo lỗi." />);
    expect(screen.getByText("Không tải được cấu hình hoá đơn")).toBeTruthy();
    expect(screen.getByText("abc123")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("đối chứng: không có digest ⇒ không in dòng 'Mã lỗi'; vẫn có lối về màn Thanh toán", () => {
    render(<LoiKhuVuc error={new Error("boom")} reset={() => undefined} tieuDe="T" moTa="M" />);
    expect(screen.queryByText(/Mã lỗi/)).toBeNull();
    expect(screen.getByRole("link", { name: "Về màn Thanh toán" }).getAttribute("href")).toBe("/payments");
  });
});
