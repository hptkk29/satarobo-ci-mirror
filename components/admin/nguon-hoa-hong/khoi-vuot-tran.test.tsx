// @vitest-environment jsdom
/**
 * [KVT-*] — KHỐI «VƯỢT TRẦN» + LIÊN KẾT NÂNG TRẦN (E2a, 09/10/2026) trên phần tử thật.
 *
 * Chủ dự án chốt: nâng trần là THAO TÁC của admin ở Cấu hình vận hành; hệ thống không tự nâng, không tự cắt. Khối này chỉ NÓI ba số của máy chủ (tổng · trần · vượt) và chỉ đường —
 * liên kết CHỈ vẽ cho người có quyền sửa ô trần (`settings:edit`), người khác thấy câu nói AI nâng được. Đối chứng dương đi kèm mọi ca âm.
 *
 *   [KVT-01] có quyền ∧ nâng trần đủ ⇒ khối nêu 3 số + liên kết «Mở Cấu hình vận hành để nâng trần» đúng href
 *   [KVT-02] KHÔNG quyền ⇒ cùng 3 số, KHÔNG liên kết, nêu Quản trị hệ thống
 *   [KVT-03] tổng vượt cả giới hạn ô ⇒ không liên kết dù có quyền; chỉ còn chỉnh tỉ lệ
 *   [KVT-04] KHÔNG có nút/ô sửa trần trong khối (không tự nâng) và 3 số đến từ `huongXuLy`, không từ chỗ khác
 *   [KVT-05] `LienKetNangTran` (dùng ở Thử tính): chỉ liên kết, theo quyền; duongDan null ⇒ không gì cả
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

import { dungHuongXuLyTran } from "@/lib/hoa-hong/huong-xu-ly-tran";
import { KhoiVuotTran, LienKetNangTran } from "./khoi-vuot-tran";

afterEach(cleanup);

describe("[KVT-01] có quyền sửa trần", () => {
  it("11% so với trần 9% ⇒ khối nêu «11%» · «9%» · «2 điểm phần trăm» và liên kết tới Cấu hình vận hành", () => {
    render(<KhoiVuotTran huongXuLy={dungHuongXuLyTran({ tongToiDa: 0.11, tran: 0.09 })} coQuyenSuaTran />);
    const khoi = screen.getByTestId("khoi-vuot-tran");
    const dd = within(khoi)
      .getAllByText(/%|điểm phần trăm/)
      .map((x) => x.textContent);
    expect(dd).toContain("11%");
    expect(dd).toContain("9%");
    expect(dd).toContain("2 điểm phần trăm");
    expect(within(khoi).getByText("Tổng tỉ lệ hiện tại")).toBeTruthy();
    expect(within(khoi).getByText("Trần hiện tại")).toBeTruthy();
    expect(within(khoi).getByText("Phần vượt")).toBeTruthy();
    const lk = within(khoi).getByRole("link", { name: "Mở Cấu hình vận hành để nâng trần" });
    expect(lk.getAttribute("href")).toBe("/cau-hinh-van-hanh?tab=khach-hang");
    expect(khoi.textContent).toMatch(/chỉnh lại tỉ lệ/);
    expect(khoi.textContent).toContain("kích hoạt lại");
  });
});

describe("[KVT-02] KHÔNG có quyền sửa trần", () => {
  it("cùng ba số, KHÔNG liên kết, nêu «Quản trị hệ thống» (đối chứng âm của KVT-01)", () => {
    render(<KhoiVuotTran huongXuLy={dungHuongXuLyTran({ tongToiDa: 0.11, tran: 0.09 })} coQuyenSuaTran={false} />);
    const khoi = screen.getByTestId("khoi-vuot-tran");
    expect(within(khoi).queryByRole("link")).toBeNull();
    expect(khoi.textContent).toContain("11%");
    expect(khoi.textContent).toContain("Quản trị hệ thống");
    expect(khoi.textContent).toContain("Cấu hình vận hành");
  });
});

describe("[KVT-03] nâng trần không đủ", () => {
  it("tổng 25% > giới hạn ô ⇒ không liên kết kể cả có quyền; câu chữ chỉ còn chỉnh tỉ lệ", () => {
    for (const coQuyen of [true, false]) {
      render(<KhoiVuotTran huongXuLy={dungHuongXuLyTran({ tongToiDa: 0.25, tran: 0.09 })} coQuyenSuaTran={coQuyen} />);
      const khoi = screen.getByTestId("khoi-vuot-tran");
      expect(within(khoi).queryByRole("link")).toBeNull();
      expect(khoi.textContent).toMatch(/nâng trần cũng không đủ/i);
      expect(khoi.textContent).toContain("25%");
      cleanup();
    }
  });
});

describe("[KVT-04] không tự nâng trần", () => {
  it("khối không chứa nút / ô nhập nào; ba số lấy từ `huongXuLy` (đổi huongXuLy ⇒ đổi số, không còn nguồn nào khác)", () => {
    const { rerender } = render(<KhoiVuotTran huongXuLy={dungHuongXuLyTran({ tongToiDa: 0.11, tran: 0.09 })} coQuyenSuaTran />);
    expect(within(screen.getByTestId("khoi-vuot-tran")).queryAllByRole("button")).toHaveLength(0);
    expect(within(screen.getByTestId("khoi-vuot-tran")).queryAllByRole("textbox")).toHaveLength(0);
    rerender(<KhoiVuotTran huongXuLy={dungHuongXuLyTran({ tongToiDa: 0.125, tran: 0.1 })} coQuyenSuaTran />);
    const khoi = screen.getByTestId("khoi-vuot-tran");
    expect(khoi.textContent).toContain("12,5%");
    expect(khoi.textContent).toContain("10%");
    expect(khoi.textContent).toContain("2,5 điểm phần trăm");
  });
});

describe("[KVT-05] LienKetNangTran", () => {
  it("có quyền ∧ có đường dẫn ⇒ một liên kết; không quyền ⇒ không gì; đường dẫn null ⇒ không gì", () => {
    const h = dungHuongXuLyTran({ tongToiDa: 0.11, tran: 0.09 });
    const { container, rerender } = render(<LienKetNangTran duongDan={h.duongDan} coQuyenSuaTran />);
    expect(screen.getByRole("link", { name: "Mở Cấu hình vận hành để nâng trần" })).toBeTruthy();
    rerender(<LienKetNangTran duongDan={h.duongDan} coQuyenSuaTran={false} />);
    expect(container.textContent).toBe("");
    rerender(<LienKetNangTran duongDan={null} coQuyenSuaTran />);
    expect(container.textContent).toBe("");
  });
});
