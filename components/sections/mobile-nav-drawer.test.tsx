// @vitest-environment jsdom
/**
 * `<MobileNavDrawer/>` — nửa MOBILE của header site public.
 *
 * ── VÌ SAO BỘ NÀY RA ĐỜI ─────────────────────────────────────────────────────────────────
 * Nút **Đăng nhập** chỉ tồn tại ở `components/public/header.tsx`, trong một khối mang
 * `hidden lg:flex`. Trên điện thoại khối đó không vẽ, và drawer này — thứ thay thế nó —
 * KHÔNG có mục nào trỏ `/login`. Kết quả: từ điện thoại, site public **không có đường nào
 * vào trang đăng nhập**. Phát hiện 13/09/2026 khi chủ dự án mở bằng điện thoại.
 *
 * Lớp lỗi ở đây không phải "một nút bị lỗi" mà là **hai bản của cùng một thanh điều hướng
 * trôi ra khỏi nhau**: ai thêm hành động vào bản desktop thì bản mobile không tự có. Nên ca
 * `[PUBLIC-NAV-T02]` canh đúng tính chất đó, không chỉ canh riêng nút đăng nhập.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { MobileNavDrawer } from "./mobile-nav-drawer";

const moDrawer = () => {
  fireEvent.click(screen.getByRole("button", { name: /mở menu|menu/i }));
};

/**
 * Dựng ĐÚNG nơi drawer được mount thật: bên trong `<header>` (xem
 * `components/public/header.tsx` — `<MobileNavDrawer />` nằm trong thẻ header đó).
 *
 * Bối cảnh này là thứ làm ca portal có nghĩa: render drawer TRẦN thì một bản vá hỏng kiểu
 * `portal(…, document.querySelector("header") ?? document.body)` vẫn xanh vì không có header
 * nào để rơi vào.
 */
const renderTrongHeader = () =>
  render(
    <header>
      <MobileNavDrawer />
    </header>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("[PUBLIC-NAV-T01] drawer mở ra và có mục thật", () => {
  it("chưa mở ⇒ không có mục điều hướng nào", () => {
    render(<MobileNavDrawer />);
    expect(screen.queryByRole("link", { name: /Trang chủ/ })).toBeNull();
  });

  it("mở ⇒ có đủ mục điều hướng chính", () => {
    // Ca này cũng trả lời nghi ngờ "drawer mở ra mà trống" từ ảnh chụp điện thoại.
    render(<MobileNavDrawer />);
    moDrawer();
    const href = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const can of ["/", "/ve-chung-toi", "/tin-tuc", "/lien-he"]) {
      expect(href, `drawer phải có mục ${can}`).toContain(can);
    }
  });
});

describe("[PUBLIC-NAV-T03] ⚠️ lớp phủ phải PORTAL ra `document.body`", () => {
  it("panel là con TRỰC TIẾP của <body>, không nằm lồng trong cây của header", () => {
    // CA NÀY CANH MỘT LỖI HIỂN THỊ THẬT (13/09/2026) mà nhìn mã thì vô hình.
    //
    // Drawer được mount BÊN TRONG `components/public/header.tsx`, và header đó mang
    // `backdrop-blur`. Theo spec Filter Effects, element có `backdrop-filter` khác `none`
    // trở thành KHỐI CHỨA cho mọi con `position: fixed`. Đo thật trong Chrome trước khi vá:
    //
    //     tổ tiên chặn = <header>, backdropFilter = blur(8px), cao = 65px
    //
    // ⇒ `inset-0` của nền mờ và `h-full` của panel tính theo hộp 65px đó thay vì theo màn
    // hình: panel cụt, nền mờ không phủ hết, và `<nav flex-1>` bị bóp còn CHIỀU CAO 0. Bảy
    // mục menu vẫn nằm nguyên trong DOM — nên triệu chứng nhìn hệt "drawer mở ra mà trống"
    // và rất dễ đi tìm nhầm ở `NAV_ITEMS`. Ca `[PUBLIC-NAV-T01]` ở trên KHÔNG bắt được: nó
    // đếm mục trong DOM, mà mục thì vẫn có đủ.
    //
    // jsdom không tính bố cục nên không thể khẳng định "panel cao bằng màn hình". Thứ kiểm
    // được, và cũng là thứ quyết định, là CHỖ ĐỨNG trong cây DOM: portal ra thẳng `<body>`
    // là bảo đảm không tổ tiên nào lọc/biến hình chen vào giữa.
    // BỌC TRONG <header> — bắt buộc, không phải trang trí. Ca này từng XANH GIẢ khi render
    // drawer trần: cấy lỗi `portal(…, document.querySelector('header') ?? document.body)` vẫn
    // qua, vì không có header nào nên nó rơi về body. Dựng đúng nơi mount thật thì phép
    // khẳng định mới phân biệt được "ra body" với "ở lại trong header".
    renderTrongHeader();
    moDrawer();
    const panel = document.querySelector('aside[role="dialog"]');
    expect(panel, "không tìm thấy panel của drawer").not.toBeNull();
    expect(panel!.parentElement).toBe(document.body);
    expect(panel!.closest("header")).toBeNull();
  });

  it("nền mờ cũng ra `document.body` — nếu không, nó chỉ phủ được vùng header", () => {
    renderTrongHeader();
    moDrawer();
    const nen = [...document.querySelectorAll("div")].find((d) =>
      d.className.toString().includes("bg-black/60"),
    );
    expect(nen?.closest("header"), "nền mờ không được nằm trong header").toBeFalsy();
    expect(nen, "không tìm thấy nền mờ").not.toBeUndefined();
    expect(nen!.parentElement).toBe(document.body);
  });
});

describe("[PUBLIC-NAV-T02] ⚠️ mọi hành động CHÍNH của header desktop phải có trong drawer", () => {
  it("có đường vào /login — thứ mà bản trước 13/09 thiếu hoàn toàn", () => {
    // Không có nó thì trên điện thoại KHÔNG có đường nào tới trang đăng nhập của site public.
    render(<MobileNavDrawer />);
    moDrawer();
    const href = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(href).toContain("/login");
  });

  it("có CTA đặt buổi học thử", () => {
    render(<MobileNavDrawer />);
    moDrawer();
    const href = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(href.some((h) => h?.startsWith("/lien-he"))).toBe(true);
  });

  it("KHỚP với header desktop: mọi `href` nội bộ của header phải có mặt trong drawer", async () => {
    // Đây mới là cổng thật. Canh riêng `/login` chỉ vá một lần; ca này chặn cả lớp lỗi "thêm
    // nút vào header, quên bản mobile". Đọc header như VĂN BẢN vì nó là Server Component
    // không render được ở đây — luật 11 nói đây là loại mong manh, nên neo hẹp: chỉ lấy
    // `href="/..."` nội bộ, và bỏ qua những đường vốn chỉ có nghĩa trên desktop.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("components/public/header.tsx", "utf8");
    const cuaHeader = [...src.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]!);
    expect(cuaHeader.length, "không đọc được href nào từ header — đổi cách neo").toBeGreaterThan(2);

    render(<MobileNavDrawer />);
    moDrawer();
    const cuaDrawer = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");

    const thieu = [...new Set(cuaHeader)].filter(
      (h) => !cuaDrawer.some((d) => d === h || d.startsWith(h.split("?")[0]!)),
    );
    expect(thieu, `header có mà drawer thiếu: ${thieu.join(", ")}`).toEqual([]);
  });
});
