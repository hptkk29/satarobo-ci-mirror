// @vitest-environment jsdom
// Ô chọn file Sheet: chặn file sai NGAY, và không bao giờ giữ file rác.
// Hai điều dễ vỡ được ghim ở đây: (1) input phải `sr-only` chứ không `hidden` — `hidden` làm bàn
// phím không tới được ô; (2) mọi lần chặn phải kèm `onChange(null)`, nếu không nút "Đọc file"
// vẫn cầm file cũ mà người dùng tưởng đã đổi.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SheetFilePicker } from "@/components/cham-cong/ui/sheet-file-picker";

function input(): HTMLInputElement {
  return screen.getByLabelText("Chọn file Sheet (.xlsx)") as HTMLInputElement;
}
function chon(file: File) {
  fireEvent.change(input(), { target: { files: [file] } });
}
const OK = () => new File(["x"], "lich-thang-9.xlsx");
const TO = () => new File([new ArrayBuffer(3 * 1024 * 1024)], "lich-thang-9.xlsx");

describe("SheetFilePicker", () => {
  it("input là sr-only, KHÔNG hidden (bàn phím vẫn tới được)", () => {
    render(<SheetFilePicker id="f" file={null} onChange={() => {}} />);
    expect(input().hidden).toBe(false);
    expect(input().className).toContain("sr-only");
    expect(input().className).not.toContain("hidden");
    expect(input().type).toBe("file");
  });

  it("file đúng đuôi + đúng cỡ: bắn file ra, không báo lỗi", () => {
    const onChange = vi.fn();
    render(<SheetFilePicker id="f" file={null} onChange={onChange} />);
    const f = OK();
    chon(f);
    expect(onChange).toHaveBeenCalledWith(f);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sai đuôi ⇒ lỗi role=alert + onChange(null)", () => {
    const onChange = vi.fn();
    render(<SheetFilePicker id="f" file={null} onChange={onChange} />);
    chon(new File(["x"], "lich.csv"));
    expect(screen.getByRole("alert").textContent).toBe("Chỉ nhận file .xlsx");
    expect(onChange).toHaveBeenCalledWith(null);
    expect(input().getAttribute("aria-invalid")).toBe("true");
  });

  it("quá cỡ ⇒ lỗi nêu đúng trần + onChange(null)", () => {
    const onChange = vi.fn();
    render(<SheetFilePicker id="f" file={null} onChange={onChange} />);
    chon(TO());
    expect(screen.getByRole("alert").textContent).toBe("File quá 2MB");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("chọn lại file hợp lệ sau khi bị chặn thì lỗi biến mất", () => {
    const onChange = vi.fn();
    render(<SheetFilePicker id="f" file={null} onChange={onChange} />);
    chon(new File(["x"], "lich.csv"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    chon(OK());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("đã có file: hiện tên + 'Bỏ chọn' trả về null", () => {
    const onChange = vi.fn();
    render(<SheetFilePicker id="f" file={OK()} onChange={onChange} />);
    expect(screen.getByTitle("lich-thang-9.xlsx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
