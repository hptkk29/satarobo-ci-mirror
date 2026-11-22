// @vitest-environment jsdom
/**
 * [HDNAV-C*] Thanh tab con của Cấu hình: chỉ hiện tab CÓ chức năng thật (luật 12).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ pathname: "/payments/hoa-don/cau-hinh", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(h.query),
}));

import { CauHinhTabs, TAB_CON } from "./cau-hinh-tabs";

beforeEach(() => {
  cleanup();
  h.pathname = "/payments/hoa-don/cau-hinh";
  h.query = "";
});

describe("[HDNAV-C1] chỉ một tab con thật ⇒ KHÔNG vẽ thanh (không có gì để chọn, không tab 'sắp có')", () => {
  it("danh sách mặc định có đúng 'Pháp nhân & ký hiệu' và thanh tự ẩn", () => {
    expect(TAB_CON.map((t) => t.nhan)).toEqual(["Pháp nhân & ký hiệu"]);
    const { container } = render(<CauHinhTabs />);
    expect(container.querySelector("nav")).toBeNull();
  });
});

describe("[HDNAV-C2] từ hai tab con thật trở lên ⇒ đối chứng dương: thanh hiện, giữ phạm vi, aria-current đúng", () => {
  const HAI = [
    { key: "phap-nhan", nhan: "Pháp nhân & ký hiệu", href: "/payments/hoa-don/cau-hinh" },
    { key: "tam", nhan: "Tab thử nghiệm", href: "/payments/hoa-don/cau-hinh/tam" },
  ];

  it("hiện cả hai, link mang cơ sở + tháng, đúng một tab aria-current=page", () => {
    h.query = "coSo=cs1&thang=2026-08&chon=x";
    render(<CauHinhTabs danhSach={HAI} />);
    const a = screen.getByRole("link", { name: "Pháp nhân & ký hiệu" });
    const b = screen.getByRole("link", { name: "Tab thử nghiệm" });
    expect(a.getAttribute("aria-current")).toBe("page");
    expect(b.getAttribute("aria-current")).toBeNull();
    expect(b.getAttribute("href")).toBe("/payments/hoa-don/cau-hinh/tam?coSo=cs1&thang=2026-08");
  });

  it("phím → chuyển tiêu điểm sang tab kế", () => {
    render(<CauHinhTabs danhSach={HAI} />);
    const a = screen.getByRole("link", { name: "Pháp nhân & ký hiệu" });
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Tab thử nghiệm" }));
  });
});
