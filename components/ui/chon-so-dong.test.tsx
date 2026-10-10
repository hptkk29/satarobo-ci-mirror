// @vitest-environment jsdom
/**
 * ChonSoDong — ô chọn số dòng cho bảng phân trang Ở TẦNG DB.
 *
 * Thứ đáng test: đọc `?size=` an toàn (giá trị lạ không được làm vỡ truy vấn), và khi đổi
 * số dòng thì PHẢI xoá `page` — đang ở trang 7 với 20 dòng mà chuyển sang 100 thì trang 7
 * không còn tồn tại, người dùng rơi vào bảng trắng.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

import { ChonSoDong } from "@/components/ui/chon-so-dong";
import { docSoDong } from "@/lib/ui/phan-trang";

beforeEach(() => {
  replace.mockClear();
  searchParams = new URLSearchParams();
});

describe("docSoDong — PHẢI ở module dùng được cả hai phía", () => {
  it("module chứa nó KHÔNG được đánh dấu \"use client\"", async () => {
    // Sự cố 12/08/2026: `docSoDong` nằm trong file "use client", Server Component gọi thì
    // Next ném lúc CHẠY ("Attempted to call docSoDong() from the server…") — tsc và
    // next build đều xanh, người dùng thấy màn hình lỗi kèm mã digest. Test này là thứ
    // duy nhất bắt được loại lỗi đó trước khi lên môi trường thật.
    const fs = await import("node:fs");
    const src = fs.readFileSync("lib/ui/phan-trang.ts", "utf8");
    // Bỏ chú thích rồi mới soi: chính file đó GIẢI THÍCH về "use client" trong comment,
    // nên tìm chuỗi thô là tự đá vào chân mình.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").trim();
    expect(code.startsWith('"use client"') || code.startsWith("'use client'")).toBe(false);
  });

  it("nhận đúng 4 mức", () => {
    for (const n of [10, 20, 50, 100]) expect(docSoDong(String(n))).toBe(n);
  });

  it("giá trị lạ / rỗng / âm / khổng lồ → về mặc định 20", () => {
    // Đây là tham số người dùng gõ được thẳng vào URL. `take: 100000` là một cách làm
    // sập trang bằng thanh địa chỉ.
    for (const v of [undefined, "", "abc", "-5", "0", "99999", "20.5"]) {
      expect(docSoDong(v)).toBe(20);
    }
  });

  it("mảng (query lặp `?size=10&size=50`) → lấy phần tử đầu", () => {
    expect(docSoDong(["10", "50"])).toBe(10);
  });
});

describe("ChonSoDong", () => {
  it("hiện đúng 4 lựa chọn và đang chọn giá trị truyền vào", () => {
    render(<ChonSoDong soDong={50} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["10", "20", "50", "100"]);
    expect(select.value).toBe("50");
  });

  it("đổi số dòng ⇒ đặt `size` và XOÁ `page`", () => {
    searchParams = new URLSearchParams("page=7&q=an");
    render(<ChonSoDong soDong={20} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "100" } });

    const url = replace.mock.calls[0][0] as string;
    expect(url).toContain("size=100");
    expect(url).not.toContain("page=");
    expect(url).toContain("q=an"); // giữ nguyên bộ lọc đang có
  });

  it("về lại mức mặc định ⇒ BỎ HẲN `size` khỏi URL (không để ?size=20 rác)", () => {
    searchParams = new URLSearchParams("size=100");
    render(<ChonSoDong soDong={100} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "20" } });
    expect(replace.mock.calls[0][0]).not.toContain("size");
  });

  it("không cuộn trang khi đổi (danh sách không nhảy về đầu)", () => {
    render(<ChonSoDong soDong={20} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "50" } });
    expect(replace.mock.calls[0][1]).toEqual({ scroll: false });
  });

  it("có tổng thì hiện kèm đơn vị", () => {
    render(<ChonSoDong soDong={20} tong={168} tenDonVi="học viên" />);
    expect(screen.getByText(/168 học viên/)).toBeDefined();
  });
});
