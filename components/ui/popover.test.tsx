// @vitest-environment jsdom
/**
 * [HDUI-P*] — hành vi của `Popover` (bọc @base-ui/react/popover).
 *
 * Không có `@testing-library/user-event` trong repo, nên:
 *   · bấm = `fireEvent.click`;
 *   · Esc = `fireEvent.keyDown(Escape)`;
 *   · Enter/Space trên nút KHÔNG thử được ở jsdom (jsdom không đổi keydown thành click cho `<button>`); chúng chạy nhờ
 *     ngữ nghĩa nút native — ca P4 khoá rằng trigger LÀ `<button type="button">` chứ không phải `<div onClick>`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "./popover";

afterEach(cleanup);

function Mau() {
  return (
    <Popover>
      <PopoverTrigger aria-label="Xem cách xử lý">?</PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>Cách xử lý</PopoverTitle>
        <PopoverDescription>Mở từng dòng để xem chênh bao nhiêu.</PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}

describe("[HDUI-P1] bấm nút thì mở, aria-expanded phản ánh đúng", () => {
  it("đóng ⇒ mở sau một lần bấm", async () => {
    render(<Mau />);
    const nut = screen.getByRole("button", { name: "Xem cách xử lý" });
    expect(nut.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Cách xử lý")).toBeNull();
    await act(async () => {
      fireEvent.click(nut);
    });
    expect(nut.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Cách xử lý")).toBeDefined();
    expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();
  });
});

describe("[HDUI-P2] Esc đóng và trả focus về nút", () => {
  it("mở bằng bấm ⇒ Esc ⇒ nội dung mất, focus nằm ở nút mở", async () => {
    render(<Mau />);
    const nut = screen.getByRole("button", { name: "Xem cách xử lý" });
    await act(async () => {
      nut.focus();
      fireEvent.click(nut);
    });
    expect(screen.getByText("Cách xử lý")).toBeDefined();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect(nut.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(nut);
  });
});

describe("[HDUI-P3] bấm lần nữa vào nút thì đóng (không kẹt mở)", () => {
  it("click – click", async () => {
    render(<Mau />);
    const nut = screen.getByRole("button", { name: "Xem cách xử lý" });
    await act(async () => {
      fireEvent.click(nut);
    });
    await act(async () => {
      fireEvent.click(nut);
    });
    expect(nut.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("[HDUI-P5] hộp nổi không tràn: rộng tối đa 20rem NHƯNG không quá bề ngang màn (320px)", () => {
  it("class giới hạn bề rộng có min(20rem, 100vw - 2rem); không rơi về max-w cố định", async () => {
    render(<Mau />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Xem cách xử lý" }));
    });
    const hop = document.querySelector<HTMLElement>('[data-slot="popover-content"]')!;
    const lop = hop.className.split(/\s+/);
    // jsdom không đo được bố cục ⇒ khoá ở hợp đồng lớp CSS (đúng class tạo ra giới hạn). Mất `calc(100vw-2rem)` là
    // popover có nút/link rộng 20rem (320px) trên màn 320px — tràn khỏi mép.
    expect(lop).toContain("max-w-[min(20rem,calc(100vw-2rem))]");
    expect(lop).toContain("w-max");
    expect(lop.filter((l) => /^max-w-/.test(l))).toEqual(["max-w-[min(20rem,calc(100vw-2rem))]"]);
  });
});

describe("[HDUI-P6] mặc định mở phía dưới nút (side='bottom'), side tuỳ chỉnh được tôn trọng", () => {
  async function moVaLayPhia(side?: "top" | "bottom") {
    render(
      <Popover>
        <PopoverTrigger aria-label="Mở">?</PopoverTrigger>
        <PopoverContent side={side}>
          <PopoverTitle>Tiêu đề</PopoverTitle>
        </PopoverContent>
      </Popover>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    });
    return document.querySelector<HTMLElement>('[data-slot="popover-content"]')!.getAttribute("data-side");
  }

  it("không khai side ⇒ bottom", async () => {
    expect(await moVaLayPhia()).toBe("bottom");
  });

  it("khai side='top' ⇒ top (đối chứng: giá trị mặc định không bị cứng)", async () => {
    expect(await moVaLayPhia("top")).toBe("top");
  });
});

describe("[HDUI-P4] trigger là nút native (Enter/Space chạy nhờ ngữ nghĩa nút)", () => {
  it("<button>, có tên truy cập", () => {
    render(<Mau />);
    const nut = screen.getByRole("button", { name: "Xem cách xử lý" });
    expect(nut.tagName).toBe("BUTTON");
  });
});
