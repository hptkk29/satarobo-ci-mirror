/**
 * [NP-*] Trang Tất cả thông báo (dùng chung quản trị / site giáo viên / khu e-learning): hai prop TUỲ CHỌN của khu e-learning
 * (`anLocTrangThai`, `duoiTieuDe`) KHÔNG đổi gì cho nơi không truyền.
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NotificationsPage } from "./notifications-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, back: () => undefined, refresh: () => undefined }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { error: () => undefined, success: () => undefined } }));

afterEach(cleanup);

const base = { initialItems: [], initialCursor: null, groupCounts: [] };

/** Khối "Trạng thái" là phần tử cha của dòng chữ "Trạng thái" trong rail lọc. */
const khoiTrangThai = (c: HTMLElement) => {
  const p = Array.from(c.querySelectorAll("p")).find((e) => e.textContent === "Trạng thái");
  return p?.parentElement ?? null;
};

describe("[NP-01] mặc định KHÔNG đổi (site GV / quản trị)", () => {
  it("bộ lọc 'Trạng thái' hiện (không có thuộc tính hidden) và không có khối dưới tiêu đề", () => {
    const { container } = render(<NotificationsPage {...base} />);
    const khoi = khoiTrangThai(container);
    expect(khoi).not.toBeNull();
    expect(khoi!.hasAttribute("hidden")).toBe(false);
    expect(container.textContent).not.toContain("TAB-GIA");
  });
});

describe("[NP-02] khu e-learning dùng hai prop tuỳ chọn", () => {
  it("anLocTrangThai ⇒ khối 'Trạng thái' bị ẩn (tab thay thế); duoiTieuDe được vẽ", () => {
    const { container } = render(<NotificationsPage {...base} anLocTrangThai duoiTieuDe={<nav>TAB-GIA</nav>} />);
    expect(khoiTrangThai(container)!.hasAttribute("hidden")).toBe(true);
    expect(container.textContent).toContain("TAB-GIA");
  });
});
