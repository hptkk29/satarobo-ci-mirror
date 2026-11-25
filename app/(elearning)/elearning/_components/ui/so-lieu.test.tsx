// @vitest-environment jsdom
/**
 * Ô số (`SoLieu`) — nhãn KHÔNG được bị cắt thành "Chấm đúng hạn t…" ở điện thoại (hotfix 26/10/2026).
 *
 * Thẻ 2 cột ở 375px chỉ rộng ~160px; nhãn `truncate` một dòng cắt mất đúng chữ nói chỉ số đo cái gì. jsdom không đo được bố cục, nên ca
 * này khẳng định cái QUYẾT ĐỊNH việc cắt (lớp CSS của nhãn và của con số); chiều rộng thật kiểm bằng Playwright ở 375px
 * (tests/e2e/elearning/khung-dieu-huong.spec.ts) và bằng ảnh chụp trong báo cáo bàn giao.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}));

import { SoLieu } from "./trang";

afterEach(cleanup);

describe("SoLieu", () => {
  it("[SL-01] nhãn dài XUỐNG DÒNG (không `truncate`), con số vẫn `truncate`", () => {
    render(<SoLieu nhan="Chấm đúng hạn tháng này" so="87%" />);
    const nhan = screen.getByText("Chấm đúng hạn tháng này");
    expect(nhan.className).not.toMatch(/\btruncate\b/);
    expect(nhan.className).toMatch(/\bbreak-words\b/);
    expect(screen.getByText("87%").className).toMatch(/\btruncate\b/);
  });

  it("[SL-02] đủ chữ nhãn có trong DOM (không bị cắt ở tầng dữ liệu), kể cả khi là liên kết", () => {
    render(<SoLieu nhan="Chấm đúng hạn tháng này" so="5" href="/elearning/bao-cao" />);
    expect(screen.getByText("Chấm đúng hạn tháng này")).toBeTruthy();
    expect(document.querySelector('a[href="/elearning/bao-cao"]')).not.toBeNull();
  });
});
