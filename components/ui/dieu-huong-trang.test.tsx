// @vitest-environment jsdom
/**
 * Thanh điều hướng trang + dãy số.
 *
 * Hai thứ hay sai và người dùng chỉ thấy triệu chứng khó hiểu:
 *   · nút Đầu/Cuối ở biên chỉ MỜ ĐI chứ vẫn bấm được (khi vẽ bằng <Link>);
 *   · chèn `…` để thay cho đúng một số — trông như đang giấu gì đó, mà chỗ trống chỉ là
 *     một trang bấm được.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NGAN, dayTrang } from "@/lib/ui/day-trang";
import { DieuHuongTrang } from "@/components/ui/dieu-huong-trang";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";

describe("dayTrang", () => {
  it("ít trang → hiện hết, không có dấu ngăn", () => {
    expect(dayTrang(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("một trang / không có trang → chỉ [1]", () => {
    expect(dayTrang(1, 1)).toEqual([1]);
    expect(dayTrang(1, 0)).toEqual([1]);
  });

  it("đứng giữa → đầu … quanh … cuối", () => {
    expect(dayTrang(50, 100)).toEqual([1, NGAN, 49, 50, 51, NGAN, 100]);
  });

  it("gần đầu → không có dấu ngăn bên trái", () => {
    expect(dayTrang(2, 100)).toEqual([1, 2, 3, NGAN, 100]);
  });

  it("gần cuối → không có dấu ngăn bên phải", () => {
    expect(dayTrang(99, 100)).toEqual([1, NGAN, 98, 99, 100]);
  });

  it("hụt ĐÚNG MỘT số → vẽ số đó, KHÔNG chèn `…`", () => {
    // `1 … 3 4 5` trông như giấu gì đó, trong khi chỗ trống chỉ là số 2.
    expect(dayTrang(4, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(dayTrang(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("trang hiện tại ngoài khoảng → kẹp lại, không nổ", () => {
    expect(dayTrang(999, 3)).toEqual([1, 2, 3]);
    expect(dayTrang(-5, 3)).toEqual([1, 2, 3]);
  });
});

describe("DieuHuongTrang", () => {
  it("một trang → không vẽ gì (đừng bày thanh vô dụng)", () => {
    const { container } = render(<DieuHuongTrang trang={1} soTrang={1} onDoi={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("có đủ Đầu / Trước / số / Sau / Cuối", () => {
    render(<DieuHuongTrang trang={5} soTrang={10} onDoi={vi.fn()} />);
    for (const nhan of ["Trang đầu", "Trang trước", "Trang sau", "Trang cuối"]) {
      expect(screen.getByLabelText(nhan)).toBeDefined();
    }
    expect(screen.getByLabelText("Trang 5").getAttribute("aria-current")).toBe("page");
  });

  it("bấm số → gọi đúng trang đó", () => {
    const onDoi = vi.fn();
    render(<DieuHuongTrang trang={5} soTrang={10} onDoi={onDoi} />);
    fireEvent.click(screen.getByLabelText("Trang 6"));
    expect(onDoi).toHaveBeenCalledWith(6);
  });

  it("Đầu/Cuối nhảy đúng biên", () => {
    const onDoi = vi.fn();
    render(<DieuHuongTrang trang={5} soTrang={10} onDoi={onDoi} />);
    fireEvent.click(screen.getByLabelText("Trang cuối"));
    expect(onDoi).toHaveBeenLastCalledWith(10);
    fireEvent.click(screen.getByLabelText("Trang đầu"));
    expect(onDoi).toHaveBeenLastCalledWith(1);
  });

  it("ở trang 1 → Đầu/Trước TẮT HẲN, bấm không gọi gì", () => {
    const onDoi = vi.fn();
    render(<DieuHuongTrang trang={1} soTrang={10} onDoi={onDoi} />);
    const dau = screen.getByLabelText("Trang đầu");
    expect(dau).toHaveProperty("disabled", true);
    fireEvent.click(dau);
    expect(onDoi).not.toHaveBeenCalled();
  });

  it("bản LINK: nút bấm được là <a> thật, nút ở biên là <button disabled>", () => {
    // <Link> mờ đi vẫn điều hướng — biên phải là button disabled mới thật sự chặn.
    //
    // Bản này là SERVER component tách riêng: `hrefCua` là một HÀM, mà hàm thì không
    // truyền được từ server sang client (sự cố 12/08/2026, digest 28380953). Bản client
    // nay KHÔNG còn prop đó ⇒ truyền nhầm là `tsc` báo đỏ chứ không đợi người dùng gặp.
    render(
      <DieuHuongTrangLink trang={1} soTrang={10} hrefCua={(n: number) => `/students?page=${n}`} />,
    );
    expect(screen.getByLabelText("Trang 2").tagName).toBe("A");
    expect(screen.getByLabelText("Trang 2").getAttribute("href")).toBe("/students?page=2");
    expect(screen.getByLabelText("Trang đầu").tagName).toBe("BUTTON");
    expect(screen.getByLabelText("Trang đầu")).toHaveProperty("disabled", true);
  });
});
