// @vitest-environment jsdom
// Nút "Xuất Excel" của Lưới phân ca — chọn cơ sở trước khi tải (chủ dự án 07/10/2026).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NutXuatLuoiPhanCa, duongXuatLuoi } from "./nut-xuat-luoi-phan-ca";

afterEach(cleanup);

const KHOI = [
  { id: "co-so-nguyen-huu-tho", label: "CS1 · 211 Nguyễn Hữu Thọ" },
  { id: "co-so-hoang-dieu", label: "CS2 · 114 Hoàng Diệu" },
];

describe("[NXL] nút xuất lưới phân ca", () => {
  it("[NXL-01] đường tải mang đúng kỳ + danh sách cơ sở", () => {
    expect(duongXuatLuoi("2026-10", ["co-so-nguyen-huu-tho"])).toBe(
      "/api/admin/cham-cong/phan-ca/export?ky=2026-10&coSo=co-so-nguyen-huu-tho",
    );
    expect(duongXuatLuoi("2026-10", ["a", "b"])).toBe("/api/admin/cham-cong/phan-ca/export?ky=2026-10&coSo=a,b");
  });

  it("[NXL-02] mở menu ⇒ mỗi cơ sở một mục + mục 'Tất cả' khi ≥ 2 cơ sở", async () => {
    render(<NutXuatLuoiPhanCa ky="2026-10" kyLabel="tháng 10/2026" khoi={KHOI} dangXem="co-so-hoang-dieu" />);
    fireEvent.click(screen.getByRole("button", { name: /Xuất Excel lưới phân ca/ }));
    expect(await screen.findByText("CS1 · 211 Nguyễn Hữu Thọ")).toBeTruthy();
    expect(screen.getByText("CS2 · 114 Hoàng Diệu")).toBeTruthy();
    expect(screen.getByText("đang xem")).toBeTruthy();
    expect(screen.getByText("Tất cả 2 cơ sở (một tệp)")).toBeTruthy();
  });

  it("[NXL-03] chỉ một cơ sở ⇒ KHÔNG có mục 'Tất cả' (lời hứa suông)", async () => {
    render(<NutXuatLuoiPhanCa ky="2026-10" kyLabel="tháng 10/2026" khoi={KHOI.slice(0, 1)} dangXem="co-so-nguyen-huu-tho" />);
    fireEvent.click(screen.getByRole("button", { name: /Xuất Excel lưới phân ca/ }));
    expect(await screen.findByText("CS1 · 211 Nguyễn Hữu Thọ")).toBeTruthy();
    expect(screen.queryByText(/Tất cả/)).toBeNull();
  });

  it("[NXL-04] không có cơ sở nào ⇒ không vẽ nút", () => {
    const { container } = render(<NutXuatLuoiPhanCa ky="2026-10" kyLabel="tháng 10/2026" khoi={[]} dangXem="x" />);
    expect(container.innerHTML).toBe("");
  });
});
