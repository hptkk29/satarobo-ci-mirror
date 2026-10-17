// @vitest-environment jsdom
/**
 * [SB-MO] Sidebar tô ĐÚNG MỘT mục — mục có href DÀI NHẤT khớp đầu đường dẫn.
 *
 * Chụp 26/09/2026 ở `/payments/hoa-don`: "Thanh toán" (`/payments`) và "Hoá đơn điện tử"
 * (`/payments/hoa-don`) cùng sáng, vì mỗi mục tự so `pathname.startsWith(href)`. Canh bằng HÀNH VI
 * (`aria-current`), kèm ĐỐI CHỨNG DƯƠNG: đứng ở `/payments` thì "Thanh toán" phải sáng.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ pathname: "/payments/hoa-don" }));
vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/chat/use-chat-unread", () => ({
  useChatUnread: (_id: string, seed: number) => seed,
}));

import { Sidebar } from "./sidebar";

afterEach(cleanup);

function dung(pathname: string) {
  h.pathname = pathname;
  render(<Sidebar granted={["payments:manage", "payments:confirm"]} anMenu={[]} userId="" hoaDonEnabled />);
}

const muc = (ten: string) => screen.getByRole("link", { name: ten });

describe("[SB-MO] đúng một mục đang mở", () => {
  it("ở /payments/hoa-don ⇒ CHỈ 'Hoá đơn điện tử' sáng, 'Thanh toán' không", () => {
    dung("/payments/hoa-don");
    expect(muc("Hoá đơn điện tử").getAttribute("aria-current")).toBe("page");
    expect(muc("Thanh toán").getAttribute("aria-current")).toBeNull();
    expect(document.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
  });

  it("đối chứng dương: ở /payments ⇒ 'Thanh toán' sáng", () => {
    dung("/payments");
    expect(muc("Thanh toán").getAttribute("aria-current")).toBe("page");
    expect(muc("Hoá đơn điện tử").getAttribute("aria-current")).toBeNull();
  });

  it("trang con của một mục (/payments/abc/phieu-thu) vẫn sáng mục cha", () => {
    dung("/payments/abc/phieu-thu");
    expect(muc("Thanh toán").getAttribute("aria-current")).toBe("page");
  });
});
