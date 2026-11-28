// @vitest-environment jsdom
/** [OSO-*] Ô nhập số của câu NUMERIC: định dạng, bàn phím, và THỜI ĐIỂM chốt lưu. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { OSo } from "./o-nhap-so";

afterEach(cleanup);

function Khung({ dau = "", onChot = vi.fn() }: { dau?: string; onChot?: (v: string) => void }) {
  const [v, setV] = useState(dau);
  return (
    <div>
      <OSo giaTri={v} donVi="đ" nhan="Trả lời câu 9" onDoi={setV} onChot={onChot} />
      <button type="button">Ngoài khối</button>
    </div>
  );
}

describe("[OSO-01] hiển thị + định dạng", () => {
  it("có đơn vị, và nhắc luật dấu thập phân khi chưa gõ gì", () => {
    render(<Khung />);
    expect(screen.getByText("đ")).toBeTruthy();
    expect(screen.getByText(/Dùng dấu , hoặc \./)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("🔴 gõ không đọc được ⇒ báo lỗi ngay (role=alert, aria-invalid); gõ lại số hợp lệ ⇒ hết lỗi", () => {
    render(<Khung />);
    const o = screen.getByLabelText("Trả lời câu 9");
    fireEvent.change(o, { target: { value: "1.000,5" } });
    expect(screen.getByRole("alert").textContent).toMatch(/MỘT dấu/);
    expect(o.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(o, { target: { value: "1000,5" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("[OSO-02] bàn phím", () => {
  it("bấm 1 2 , 5 ⇒ '12,5'; ⌫ xoá ký tự cuối", () => {
    render(<Khung />);
    for (const k of ["1", "2", "Dấu phẩy thập phân", "5"]) fireEvent.click(screen.getByRole("button", { name: k }));
    expect((screen.getByLabelText("Trả lời câu 9") as HTMLInputElement).value).toBe("12,5");
    fireEvent.click(screen.getByRole("button", { name: "Xoá ký tự cuối" }));
    expect((screen.getByLabelText("Trả lời câu 9") as HTMLInputElement).value).toBe("12,");
  });
});

describe("[OSO-03] chốt lưu khi tiêu điểm RỜI KHỐI, không theo từng phím", () => {
  it("🔴 từ ô sang phím KHÔNG lưu; ra ngoài khối thì lưu đúng giá trị đang hiện", () => {
    const onChot = vi.fn();
    render(<Khung dau="60" onChot={onChot} />);
    const o = screen.getByLabelText("Trả lời câu 9");
    const phim = screen.getByRole("button", { name: "5" });
    fireEvent.blur(o, { relatedTarget: phim });
    expect(onChot).not.toHaveBeenCalled();
    fireEvent.blur(phim, { relatedTarget: screen.getByRole("button", { name: "Ngoài khối" }) });
    expect(onChot).toHaveBeenCalledWith("60");
  });
});
