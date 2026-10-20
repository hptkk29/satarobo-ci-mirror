// @vitest-environment jsdom
/**
 * [ACX-*] — CÔNG TẮC BA CHẾ ĐỘ (Đối tác · Loại · Nhãn) và BỘ LỌC ĐỐI TÁC của tab Affiliate trên PHẦN TỬ THẬT (jsdom). Cả hai là server component thuần `<Link>`/`<form method="get">`:
 * toàn bộ trạng thái nằm trên URL, nên thứ cần canh là ĐỊA CHỈ mà chúng sinh ra.
 *
 *   [ACX-01] `docCheDoXemAffiliate`: rác ⇒ danh sách đối tác (không ném, không đoán)
 *   [ACX-02] công tắc: ba liên kết đúng địa chỉ; `aria-current` đúng chế độ; số «chờ duyệt» chỉ ở chế độ Đối tác và chỉ khi > 0 (không biết/0 ⇒ không in)
 *   [ACX-03] bộ lọc: chip trạng thái chỉ cho trạng thái CÓ đối tác (cộng trạng thái đang lọc dù 0) kèm số thật; mỗi chip GIỮ bộ lọc khác và BỎ `trang`; form GET giữ trạng thái bằng ô ẩn
 *   [ACX-04] ô tìm nói đúng nó tìm gì (người chỉ xem: không SĐT/email); «Bỏ mọi bộ lọc» chỉ khi đang lọc
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import type { TrangThaiDoiTac } from "@/lib/affiliate/ghi-doi-tac-dau-vao";
import { BoLocDoiTac } from "./bo-loc-doi-tac";
import { ChuyenXem, docCheDoXemAffiliate } from "./chuyen-xem";

afterEach(cleanup);

const BASE = "/nguon-hoa-hong/affiliate";

describe("[ACX-01] docCheDoXemAffiliate", () => {
  it("loai / nhan đúng; mọi giá trị khác (rác, rỗng, null, hoa-thường) ⇒ doi-tac", () => {
    expect(docCheDoXemAffiliate("loai")).toBe("loai");
    expect(docCheDoXemAffiliate("nhan")).toBe("nhan");
    for (const x of [null, "", "doi-tac", "LOAI", "tat-ca", "../etc", "loai ", "<script>"]) expect(docCheDoXemAffiliate(x), String(x)).toBe("doi-tac");
  });
});

describe("[ACX-02] ChuyenXem", () => {
  it("ba liên kết đúng địa chỉ (đối tác = không tham số)", () => {
    render(<ChuyenXem basePath={BASE} dangXem="doi-tac" soChoDuyet={null} />);
    expect(screen.getByRole("link", { name: "Đối tác" }).getAttribute("href")).toBe(BASE);
    expect(screen.getByRole("link", { name: "Loại đối tác" }).getAttribute("href")).toBe(`${BASE}?xem=loai`);
    expect(screen.getByRole("link", { name: "Nhãn" }).getAttribute("href")).toBe(`${BASE}?xem=nhan`);
  });

  it("aria-current CHỈ ở chế độ đang xem — cho cả ba chế độ", () => {
    for (const [dang, ten] of [["doi-tac", "Đối tác"], ["loai", "Loại đối tác"], ["nhan", "Nhãn"]] as const) {
      render(<ChuyenXem basePath={BASE} dangXem={dang} soChoDuyet={null} />);
      const dangChon = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
      expect(dangChon.map((a) => a.textContent), dang).toEqual([ten]);
      cleanup();
    }
  });

  it("«N chờ duyệt» chỉ ở mục Đối tác và chỉ khi N > 0; null / 0 ⇒ không in số (không biết ≠ 0)", () => {
    render(<ChuyenXem basePath={BASE} dangXem="loai" soChoDuyet={3} />);
    expect(screen.getByRole("link", { name: /Đối tác/ }).textContent).toContain("3 chờ duyệt");
    expect(screen.getByRole("link", { name: "Loại đối tác" }).textContent).not.toMatch(/chờ duyệt/);
    expect(screen.getByRole("link", { name: "Nhãn" }).textContent).not.toMatch(/chờ duyệt/);
    cleanup();
    for (const x of [null, 0]) {
      render(<ChuyenXem basePath={BASE} dangXem="doi-tac" soChoDuyet={x} />);
      expect(screen.queryByText(/chờ duyệt/), String(x)).toBeNull();
      cleanup();
    }
  });
});

const DEM = (p: Partial<Record<TrangThaiDoiTac, number>> = {}): Record<TrangThaiDoiTac, number> => ({ DRAFT: 0, PENDING: 0, ACTIVE: 0, SUSPENDED: 0, ENDED: 0, ...p });
const LOAI = [
  { ma: "PHU_HUYNH", ten: "Phụ huynh" },
  { ma: "KOL", ten: "KOL" },
];
const LOC = (p: Partial<React.ComponentProps<typeof BoLocDoiTac>> = {}) => (
  <BoLocDoiTac basePath={BASE} trangThai={null} loaiMa={null} tuKhoa={null} theoTrangThai={DEM({ PENDING: 2, ACTIVE: 5 })} cacLoai={LOAI} coTheXemLienHe {...p} />
);

describe("[ACX-03] BoLocDoiTac — chip trạng thái", () => {
  it("chỉ chip của trạng thái CÓ đối tác, kèm số thật; «Mọi trạng thái» mang TỔNG", () => {
    render(LOC());
    const nav = screen.getByRole("navigation", { name: "Lọc theo trạng thái đối tác" });
    const chu = within(nav).getAllByRole("link").map((a) => a.textContent);
    expect(chu).toEqual(["Mọi trạng thái (7)", "Chờ duyệt (2)", "Đang hoạt động (5)"]);
  });

  it("trạng thái đang lọc hiện chip DÙ không còn đối tác nào (để người dùng thấy mình đang lọc gì và bỏ được)", () => {
    render(LOC({ trangThai: "ENDED", theoTrangThai: DEM({ ACTIVE: 1 }) }));
    const nav = screen.getByRole("navigation", { name: "Lọc theo trạng thái đối tác" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Mọi trạng thái (1)", "Đang hoạt động (1)", "Đã kết thúc (0)"]);
    expect(within(nav).getByRole("link", { name: /Đã kết thúc/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: /Mọi trạng thái/ }).getAttribute("aria-current")).toBeNull();
  });

  it("mỗi chip GIỮ loại + từ khoá và KHÔNG mang `trang` (đổi bộ lọc là về trang 1)", () => {
    render(LOC({ loaiMa: "KOL", tuKhoa: "lan" }));
    const nav = screen.getByRole("navigation", { name: "Lọc theo trạng thái đối tác" });
    expect(within(nav).getByRole("link", { name: /Mọi trạng thái/ }).getAttribute("href")).toBe(`${BASE}?loai=KOL&q=lan`);
    expect(within(nav).getByRole("link", { name: /Chờ duyệt/ }).getAttribute("href")).toBe(`${BASE}?trangthai=PENDING&loai=KOL&q=lan`);
    for (const a of within(nav).getAllByRole("link")) expect(a.getAttribute("href")).not.toMatch(/trang=/);
  });

  it("từ khoá có ký tự đặc biệt được mã hoá trong URL (không vỡ địa chỉ, không chèn tham số)", () => {
    render(LOC({ tuKhoa: "a&trangthai=ENDED #x" }));
    const href = within(screen.getByRole("navigation", { name: "Lọc theo trạng thái đối tác" })).getByRole("link", { name: /Chờ duyệt/ }).getAttribute("href")!;
    expect(href).toContain("q=a%26trangthai%3DENDED%20%23x");
    expect(new URL(href, "http://x").searchParams.get("trangthai")).toBe("PENDING");
  });

  it("form GET giữ trạng thái bằng ô ẩn khi đang lọc; không có ô ẩn khi không lọc (đối chứng)", () => {
    const { container } = render(LOC({ trangThai: "PENDING" }));
    const form = screen.getByRole("search", { name: "Tìm đối tác" });
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe(BASE);
    expect((container.querySelector('input[name="trangthai"]') as HTMLInputElement).value).toBe("PENDING");
    cleanup();
    const r2 = render(LOC());
    expect(r2.container.querySelector('input[name="trangthai"]')).toBeNull();
  });

  it("ô chọn loại: «Mọi loại» + từng loại; chọn sẵn loại đang lọc", () => {
    render(LOC({ loaiMa: "KOL" }));
    const chon = screen.getByLabelText("Loại") as HTMLSelectElement;
    expect([...chon.options].map((o) => [o.value, o.textContent])).toEqual([["", "Mọi loại"], ["PHU_HUYNH", "Phụ huynh"], ["KOL", "KOL"]]);
    expect(chon.value).toBe("KOL");
    expect(chon.getAttribute("name")).toBe("loai");
  });
});

describe("[ACX-04] BoLocDoiTac — ô tìm + bỏ lọc", () => {
  it("người QUẢN LÝ: placeholder nói tìm được SĐT/email; người chỉ XEM: chỉ tên hoặc mã", () => {
    render(LOC({ coTheXemLienHe: true }));
    expect(screen.getByRole("searchbox").getAttribute("placeholder")).toMatch(/SĐT hoặc email/);
    cleanup();
    render(LOC({ coTheXemLienHe: false }));
    const o = screen.getByRole("searchbox");
    expect(o.getAttribute("placeholder")).toBe("Tên hoặc mã giới thiệu");
    expect(o.getAttribute("placeholder")).not.toMatch(/SĐT|email/);
  });

  it("từ khoá đang tìm được điền sẵn vào ô; tên ô là `q`", () => {
    render(LOC({ tuKhoa: "chị lan" }));
    const o = screen.getByRole("searchbox") as HTMLInputElement;
    expect(o.value).toBe("chị lan");
    expect(o.name).toBe("q");
  });

  it("«Bỏ mọi bộ lọc» chỉ khi ĐANG lọc (trạng thái HOẶC loại HOẶC từ khoá) và dẫn về địa chỉ gốc", () => {
    render(LOC());
    expect(screen.queryByRole("link", { name: "Bỏ mọi bộ lọc" })).toBeNull();
    cleanup();
    for (const p of [{ trangThai: "ACTIVE" as const }, { loaiMa: "KOL" }, { tuKhoa: "x" }]) {
      render(LOC(p));
      expect(screen.getByRole("link", { name: "Bỏ mọi bộ lọc" }).getAttribute("href"), JSON.stringify(p)).toBe(BASE);
      cleanup();
    }
  });
});
