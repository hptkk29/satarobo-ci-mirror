// @vitest-environment jsdom
/**
 * Khung khu học tập — liên kết "Bỏ qua điều hướng" KHÔNG được nhận Tab khi ngăn kéo (modal) đang mở.
 *
 * Hồi quy 26/10/2026: link nằm NGOÀI vùng `inert` của nền nên khi ngăn kéo mở ở điện thoại, từ phần tử cuối của ngăn kéo Tab rơi ra
 * link này rồi mới quay lại — MỖI vòng Tab đều đi qua nó (đo bằng Playwright: 14 lần Tab, link xuất hiện hai lần), và Enter ở đó
 * nhảy nền phía sau modal. Một modal rò tiêu điểm ra ngoài là lỗi a11y thật, không phải chuyện hình thức.
 *
 * jsdom không có thứ tự Tab, nên ca này khẳng định THỨ QUYẾT ĐỊNH nó: thuộc tính `inert` (trình duyệt loại phần tử inert khỏi thứ
 * tự Tab). Phần "Tab thật không đi qua" kiểm bằng Playwright ở tests/e2e/elearning/khung-dieu-huong.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Hai khối con là việc của bộ khác; ở đây chỉ cần nút mở menu và một liên kết trong ngăn kéo.
vi.mock("./topbar", () => ({
  Topbar: ({ onMenuClick }: { onMenuClick: () => void }) => (
    <button type="button" aria-label="Mở menu điều hướng" data-mo-menu onClick={onMenuClick} />
  ),
}));
vi.mock("./sidebar", () => ({
  SidebarContent: () => <a href="/elearning">Mục trong menu</a>,
}));

import { AppShell } from "./app-shell";

const dung = () =>
  render(
    <AppShell userId="u1" userName="Người học" khu={[]}>
      <p>nội dung trang</p>
    </AppShell>,
  );
const skip = () => screen.getByText("Bỏ qua điều hướng, tới nội dung");

afterEach(cleanup);

describe("skip link và ngăn kéo", () => {
  it("[AS-01] ĐỐI CHỨNG DƯƠNG: ngăn kéo ĐÓNG ⇒ skip link nhận Tab được (không inert) và trỏ đúng đích", () => {
    dung();
    expect(skip().hasAttribute("inert")).toBe(false);
    expect(skip().getAttribute("href")).toBe("#noi-dung");
    expect(document.getElementById("noi-dung")).not.toBeNull();
  });

  it("[AS-02] ngăn kéo MỞ ⇒ skip link INERT (rời khỏi thứ tự Tab), cùng lúc với phần nền", () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: "Mở menu điều hướng" }));
    expect(skip().hasAttribute("inert")).toBe(true);
    expect(document.getElementById("noi-dung")?.parentElement?.hasAttribute("inert")).toBe(true);
  });

  it("[AS-03] Esc đóng ngăn kéo ⇒ skip link nhận Tab lại", () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: "Mở menu điều hướng" }));
    expect(skip().hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(skip().hasAttribute("inert")).toBe(false);
  });

  it("[AS-04] không còn phần tử nhận Tab nào NGOÀI ngăn kéo khi nó mở (trừ phần tử trong chính ngăn kéo)", () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: "Mở menu điều hướng" }));
    const ngoai = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")].filter(
      (e) => !e.closest("[inert]") && !e.closest('[role="dialog"]'),
    );
    expect(ngoai.map((e) => e.textContent || e.getAttribute("aria-label"))).toEqual([]);
  });
});
