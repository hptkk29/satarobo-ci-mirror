// @vitest-environment jsdom
/**
 * [SB-AN] Menu gọn theo vai (28/09/2026) — mục có trong `anMenu` biến khỏi menu, dù người xem
 * GIỮ quyền của nó. Canh bằng HÀNH VI (link có / không trên DOM), kèm đối chứng dương: cùng
 * quyền, `anMenu` rỗng ⇒ mục hiện (không thì ca "không thấy X" đạt vì lý do sai — luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Sidebar chỉ MỞ nhóm chứa trang hiện tại (các nhóm khác gập, link không nằm trong DOM) ⇒ mỗi ca
// đặt đường dẫn vào đúng nhóm nó kiểm.
const h = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/chat/use-chat-unread", () => ({
  useChatUnread: (_id: string, seed: number) => seed,
}));

import { MUC_MENU_CO_THE_AN, Sidebar } from "./sidebar";

afterEach(cleanup);

const KE_TOAN = ["payments:manage", "payments:view", "payments:confirm", "students:view-all", "classes:view-all", "enrollments:view-all"];
const dung = (anMenu: readonly string[], pathname = "/dashboard") => {
  h.pathname = pathname;
  return render(<Sidebar granted={KE_TOAN} anMenu={anMenu} userId="" />);
};
const coLink = (ten: string) => screen.queryAllByRole("link", { name: ten }).length > 0;

describe("[SB-AN-01] mục trong anMenu biến mất, mục khác giữ nguyên", () => {
  it("ẩn Học viên ⇒ không còn link; Đăng ký học (cùng nhóm, không bị ẩn) vẫn còn", () => {
    dung(["/students"], "/enrollments");
    expect(coLink("Học viên")).toBe(false);
    expect(coLink("Đăng ký học")).toBe(true);
  });

  it("đối chứng dương: anMenu rỗng, CÙNG quyền, CÙNG trang ⇒ Học viên hiện", () => {
    dung([], "/enrollments");
    expect(coLink("Học viên")).toBe(true);
  });

  it("ẩn nhóm học viên/lớp không đụng Tài chính: Thanh toán, Công nợ vẫn còn", () => {
    dung(["/students", "/classes", "/enrollments"], "/payments");
    expect(coLink("Thanh toán")).toBe(true);
    expect(coLink("Công nợ")).toBe(true);
  });
});

describe("[SB-AN-02] Dashboard không bao giờ ẩn — kể cả khi bị khai", () => {
  it("anMenu chứa /dashboard ⇒ Dashboard vẫn hiện", () => {
    dung(["/dashboard"], "/dashboard");
    expect(coLink("Dashboard")).toBe(true);
  });
});

describe("[SB-AN-03] nhóm rỗng sau khi ẩn ⇒ nhóm biến mất", () => {
  it("ẩn mọi mục của nhóm 'Học viên & Đăng ký học' ⇒ không còn tiêu đề nhóm; đối chứng: không ẩn ⇒ có", () => {
    const cuaNhom = MUC_MENU_CO_THE_AN.filter((m) => m.nhom === "Học viên & Đăng ký học").map((m) => m.href);
    dung([]);
    expect(screen.queryAllByText("Học viên & Đăng ký học").length).toBeGreaterThan(0);
    cleanup();
    dung(cuaNhom);
    expect(screen.queryAllByText("Học viên & Đăng ký học")).toHaveLength(0);
  });
});
