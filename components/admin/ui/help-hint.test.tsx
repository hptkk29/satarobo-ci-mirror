// @vitest-environment jsdom
/**
 * HelpHint — bố cục của nội dung hướng dẫn.
 *
 * Lỗi đã đo trên trình duyệt thật (15/10/2026): `TooltipContent` là `inline-flex`, nên hướng dẫn gồm chữ + thẻ `<b>` + chữ bị xếp
 * thành NHIỀU CỘT một-từ, đọc không nổi cả ở desktop lẫn 375px. jsdom không có bố cục nên không đo được "cột"; ca này ghim NGUYÊN
 * NHÂN: mọi thứ trong `children` phải nằm trong MỘT phần tử con duy nhất của hộp nội dung (ngoài mũi tên chỉ hướng).
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelpHint } from "./help-hint";

afterEach(cleanup);

describe("[HH-1] nội dung hướng dẫn nằm trong MỘT khối, không thành nhiều phần tử con của hộp flex", () => {
  it("chữ + <b> + chữ: hộp nội dung chỉ có MỘT phần tử con mang chữ, và nó chứa cả thẻ <b>", async () => {
    render(
      <HelpHint>
        Khách mua <b>12 / 24 / 36 / 48</b> buổi và trả <b>một lần</b>.
      </HelpHint>,
    );
    const nut = screen.getByRole("button", { name: "Xem hướng dẫn" });
    await act(async () => {
      fireEvent.pointerEnter(nut);
      fireEvent.mouseEnter(nut);
      fireEvent.focus(nut);
    });
    const hop = await screen.findByText(/trả/).then((el) => el.closest('[data-slot="tooltip-content"]')!);
    // Phần tử con mang chữ (bỏ mũi tên — nó không có chữ). Trước bản vá: mỗi <b> là một con riêng của hộp flex.
    const conCoChu = [...hop.children].filter((c) => (c.textContent ?? "").trim() !== "");
    expect(conCoChu).toHaveLength(1);
    expect(conCoChu[0]!.querySelectorAll("b")).toHaveLength(2);
    expect(conCoChu[0]!.textContent).toBe("Khách mua 12 / 24 / 36 / 48 buổi và trả một lần.");
  });
});
