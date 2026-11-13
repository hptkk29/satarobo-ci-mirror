// @vitest-environment jsdom
/**
 * [CDGV-UI-*] Bảng chi tiết công dạy một giáo viên — trên PHẦN TỬ THẬT (jsdom), dữ liệu dựng bằng ĐÚNG hàm server
 * (`chiTietGiaoVien`), không tự chế hình dạng dòng.
 *
 * Luật 12: nút "Chi tiết" phải MỞ được thật; dòng ở cơ sở ngoài phạm vi KHÔNG lộ tên lớp, phòng, người, liên kết — đối
 * chứng dương: dòng trong phạm vi thì CÓ đủ.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import type { BuoiDay, LoaiCongDay } from "@/lib/cham-cong/cong-day";
import { chiTietGiaoVien } from "@/lib/cham-cong/cong-day-chi-tiet";
import { ChiTietGiaoVienTable } from "./chi-tiet-giao-vien";

afterEach(cleanup);

const DM: LoaiCongDay[] = [
  { code: "LC", name: "Lớp chính", source: "CLASS", role: "MAIN", basis: "PER_SESSION", factor: 1, countsInPeriod: true, isActive: true, categoryCode: null },
];

function buoi(id: string, centerId: string, tenLop: string, ymd = "2026-10-13"): BuoiDay {
  return {
    id,
    source: "CLASS",
    userId: "u1",
    role: "MAIN",
    ymd,
    minutes: 120,
    categoryCode: null,
    hienThi: {
      gioBatDau: "17:30",
      gioKetThuc: "19:30",
      gioThuc: false,
      lopId: `lop-${id}`,
      tenLop,
      centerId,
      phong: `P-${id}`,
      trangThai: "COMPLETED",
      gvChinhId: "u1",
      gvThayId: "u9",
      nguoiDayThucId: null,
    },
  };
}

function ve(ds: BuoiDay[]) {
  const ct = chiTietGiaoVien(ds, DM, { loai: null, trangThai: null }, new Set(["cs1"]));
  render(
    <ChiTietGiaoVienTable ngays={ct.ngays} tong={ct.tong} tenNguoi={{ u1: "GV Một", u9: "GV Chín" }} tenCoSo={{ cs1: "CS1", cs2: "CS2" }} />,
  );
  return ct;
}

describe("[CDGV-UI] chi tiết giáo viên", () => {
  it("[CDGV-UI-01] nút Chi tiết MỞ phần chi tiết của đúng dòng, bấm lần nữa thì ĐÓNG", () => {
    ve([buoi("a", "cs1", "ROBOTICS 01")]);
    const nut = screen.getByRole("button", { name: "Chi tiết" });
    expect(nut.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Mã buổi:")).toBeNull();
    fireEvent.click(nut);
    expect(screen.getByRole("button", { name: "Đóng" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Mã buổi:")).toBeTruthy();
    expect(screen.getByText("GV Chín")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mở lớp" }).getAttribute("href")).toBe("/classes/lop-a");
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(screen.queryByText("Mã buổi:")).toBeNull();
  });

  it("[CDGV-UI-02] dòng ở cơ sở NGOÀI phạm vi: không tên lớp, phòng, người, liên kết — dòng trong phạm vi thì có", () => {
    ve([buoi("a", "cs1", "LOP CS1"), buoi("b", "cs2", "LOP BI MAT CS2")]);
    expect(screen.getByText("LOP CS1")).toBeTruthy();
    expect(screen.queryByText("LOP BI MAT CS2")).toBeNull();
    expect(screen.getByText("Lớp ở cơ sở khác")).toBeTruthy();
    expect(screen.queryByText(/P-b/)).toBeNull();
    // Mở chi tiết dòng bị che: không có người, không có liên kết.
    const dongs = screen.getAllByRole("button", { name: "Chi tiết" });
    fireEvent.click(dongs[1]);
    const dl = document.querySelector("dl") as HTMLElement;
    expect(within(dl).queryByText("GV Chín")).toBeNull();
    expect(within(dl).queryByRole("link")).toBeNull();
  });

  it("[CDGV-UI-03] dòng tổng ngày và tổng tháng in đúng số của hàm server", () => {
    const ct = ve([buoi("a", "cs1", "L1"), buoi("b", "cs1", "L2"), buoi("c", "cs1", "L3", "2026-10-14")]);
    expect(ct.tong).toEqual({ buoi: 3, phut: 360, cong: 3 });
    expect(screen.getByText("Tổng tháng: 3 buổi · 360 phút · 3 công")).toBeTruthy();
    expect(screen.getByText("Tổng ngày: 2 buổi · 240 phút · 2 công")).toBeTruthy();
    expect(screen.getByText("Tổng ngày: 1 buổi · 120 phút · 1 công")).toBeTruthy();
  });
});
