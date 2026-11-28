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
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { MobileNavDrawer } from "./mobile-nav-drawer";
import { mucGocGiaDinh } from "@/lib/public/goc-gia-dinh";

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

describe("[PUBLIC-NAV-T03] menu xổ ngay dưới thanh trên (`.mnav`), không còn ngăn kéo portal", () => {
  // Từ 02/11/2026 (giao diện public mới): bảng `.mnav` là `position: absolute` BÊN TRONG header dính, nên
  // không còn con `position: fixed` nào bị `backdrop-filter` của header bóp hộp chứa (lỗi 13/09/2026 từng buộc
  // phải portal ra <body>). Ca cũ ghim portal vì thiết kế cũ; ca này ghim thiết kế mới và đối chứng là: KHÔNG
  // còn lớp `position: fixed` nào trong menu.
  it("panel là `.mnav` nằm TRONG header, có id khớp aria-controls của nút", () => {
    renderTrongHeader();
    moDrawer();
    const panel = document.querySelector("#menu-dt.mnav");
    expect(panel, "không tìm thấy bảng .mnav").not.toBeNull();
    expect(panel!.closest("header")).not.toBeNull();
    expect(screen.getByRole("button", { name: /đóng menu/i }).getAttribute("aria-controls")).toBe("menu-dt");
  });

  it("menu không dùng lớp fixed/nền mờ (đối chứng của thiết kế cũ)", () => {
    renderTrongHeader();
    moDrawer();
    const panel = document.querySelector("#menu-dt")!;
    expect(panel.outerHTML).not.toMatch(/\bfixed\b/);
    expect([...document.querySelectorAll("div")].some((d) => d.className.toString().includes("bg-black/60"))).toBe(false);
  });

  it("Esc đóng menu", () => {
    renderTrongHeader();
    moDrawer();
    expect(document.querySelector("#menu-dt")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector("#menu-dt")).toBeNull();
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

  it("KHỚP với nhóm «Góc gia đình»: mọi lối vào header hiện sau khi bấm mở nhóm cũng phải có trong drawer", () => {
    // Header không còn chứa `href="/tu-sach"` dạng chữ (nhóm đọc từ lib/public/goc-gia-dinh.ts) nên ca trên không canh được chúng — ca này canh.
    const co = { tuSach: true, sucKhoe: true };
    render(<MobileNavDrawer discEnabled congThongTin={co} />);
    moDrawer();
    const cuaDrawer = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const m of mucGocGiaDinh(true, co)) expect(cuaDrawer, `drawer thiếu ${m.href}`).toContain(m.href);
  });
});

describe("[GOC-MENU-*] nhóm «Góc gia đình» trong menu điện thoại", () => {
  it("cả ba cờ BẬT: có nhóm gắn nhãn, ba lối vào hiện SẴN (không cần bấm mở thêm), đúng đích và đúng thứ tự", () => {
    render(<MobileNavDrawer discEnabled congThongTin={{ tuSach: true, sucKhoe: true }} />);
    moDrawer();
    const nhom = screen.getByRole("group", { name: "Góc gia đình" });
    expect(within(nhom).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Khám phá DISC", "/disc"],
      ["Tủ sách", "/tu-sach"],
      ["Sức khỏe", "/suc-khoe"],
    ]);
  });
  it("nhóm đứng ngay TRƯỚC «Liên hệ» và các mục khác không đổi chỗ", () => {
    render(<MobileNavDrawer discEnabled congThongTin={{ tuSach: true, sucKhoe: true }} />);
    moDrawer();
    const ds = [...document.querySelectorAll(".mnav-links > a, .mnav-links > .mnav-nhom")].map((e) => (e.classList.contains("mnav-nhom") ? "NHÓM" : e.textContent?.trim()));
    expect(ds).toEqual(["Trang chủ", "Về chúng tôi", "Khoá học", "Tin tức", "Tuyển dụng", "NHÓM", "Liên hệ"]);
  });
  it("cả ba cờ TẮT hoặc không truyền: không có nhóm (đối chứng dương: các mục còn lại vẫn đủ)", () => {
    render(<MobileNavDrawer />);
    moDrawer();
    expect(screen.queryByRole("group", { name: "Góc gia đình" })).toBeNull();
    expect(screen.getByRole("link", { name: "Liên hệ" })).toBeTruthy();
  });
  it("đúng MỘT cờ bật: mục đó hiện như liên kết thường, không có nhóm", () => {
    render(<MobileNavDrawer congThongTin={{ tuSach: false, sucKhoe: true }} />);
    moDrawer();
    expect(screen.queryByRole("group", { name: "Góc gia đình" })).toBeNull();
    expect(screen.getByRole("link", { name: "Sức khỏe" }).getAttribute("href")).toBe("/suc-khoe");
  });
});
