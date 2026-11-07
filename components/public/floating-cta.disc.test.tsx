// @vitest-environment jsdom
/** [DISC-FLOAT-*] Nút nổi "Khám phá DISC": nhãn đúng, không che Zalo/học thử, ẩn ở /disc, cờ tắt thì vắng. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
import { FloatingCta } from "./floating-cta";

describe("[DISC-FLOAT-01] FloatingCta", () => {
  it("cờ BẬT: có nút DISC với nhãn đúng, trỏ /disc, và Zalo + học thử vẫn còn", () => {
    path = "/";
    render(<FloatingCta discEnabled />);
    const d = screen.getByTestId("disc-floating");
    expect(d.textContent).toBe("Khám phá DISC");
    expect(d.getAttribute("href")).toBe("/disc");
    expect(screen.getByRole("link", { name: /chat zalo/i })).toBeTruthy();
    // Thanh đáy điện thoại (giao diện public mới) thay nút "Học thử 1-1 miễn phí" cũ.
    expect(screen.getByText(/đặt học thử miễn phí/i)).toBeTruthy();
    // Nhãn KHÔNG được kèm "miễn phí" (PRD v2.0).
    expect(d.textContent).not.toMatch(/miễn phí/i);
  });
  it("DISC đứng TRÊN CÙNG ngăn xếp, trước Zalo (không đè hai nút cũ)", () => {
    path = "/";
    render(<FloatingCta discEnabled />);
    const d = screen.getByTestId("disc-floating");
    const zalo = screen.getByRole("link", { name: /chat zalo/i });
    expect(d.compareDocumentPosition(zalo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("có bản mobile riêng", () => {
    path = "/";
    render(<FloatingCta discEnabled />);
    expect(screen.getByTestId("disc-floating-mobile").textContent).toBe("Khám phá DISC");
  });
  it("cờ TẮT: không có nút nào (đối chứng dương ở ca đầu)", () => {
    path = "/";
    render(<FloatingCta />);
    expect(screen.queryByTestId("disc-floating")).toBeNull();
    expect(screen.queryByTestId("disc-floating-mobile")).toBeNull();
    expect(screen.getByRole("link", { name: /chat zalo/i })).toBeTruthy();
  });
  it("ở /disc: không hiện nút nào", () => {
    path = "/disc";
    const { container } = render(<FloatingCta discEnabled />);
    expect(container.innerHTML).toBe("");
  });
});
