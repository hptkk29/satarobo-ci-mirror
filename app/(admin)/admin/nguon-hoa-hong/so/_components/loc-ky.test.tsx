// @vitest-environment jsdom
/**
 * [NHH-KY-LOC-UI-*] — dải "đang lọc theo kỳ" của hàng chờ tab Sổ trên phần tử thật.
 *
 * Khi người xem đến từ link "Xem ở tab Sổ" của tab Kỳ, danh sách (và mọi con số trên chip) chỉ là hàng chờ CHẶN khoá kỳ đó. Dải này nói điều ấy bằng chữ và cho đường thoát:
 * không có nó, "Cần xử lý (3)" ở đây và "Cần xử lý (7)" ở lần mở trước là hai con số cùng nhãn khác phạm vi mà không ai giải thích.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { LocKy } from "./loc-ky";

afterEach(cleanup);

describe("[NHH-KY-LOC-UI-01] LocKy", () => {
  it("nêu kỳ (MM/YYYY) + cơ sở + 'chặn khoá', có liên kết thật 'Bỏ lọc kỳ' tới địa chỉ truyền vào", () => {
    render(<LocKy ky="2026-10" coSo="CS1" hrefBo="/nguon-hoa-hong/so?coSo=cs1" />);
    const dai = screen.getByRole("status");
    expect(dai.textContent).toContain("Đang chỉ xem hàng chờ chặn khoá kỳ 10/2026");
    expect(dai.textContent).toContain("CS1");
    expect(screen.getByRole("link", { name: "Bỏ lọc kỳ" }).getAttribute("href")).toBe("/nguon-hoa-hong/so?coSo=cs1");
  });

  it("không chọn cơ sở ⇒ không in 'undefined'/'null'/dấu chấm lửng; đối chứng: có cơ sở ⇒ có tên", () => {
    const { unmount } = render(<LocKy ky="2026-11" coSo={null} hrefBo="/x" />);
    expect(screen.getByRole("status").textContent).toBe("Đang chỉ xem hàng chờ chặn khoá kỳ 11/2026Bỏ lọc kỳ");
    unmount();
    render(<LocKy ky="2026-11" coSo="CS2" hrefBo="/x" />);
    expect(screen.getByRole("status").textContent).toContain("kỳ 11/2026 · CS2");
  });
});
