// @vitest-environment jsdom
/**
 * [CFT-*] — mục "Thanh toán" của trang Cơ sở: nút Tạo / Xem danh mục chỉ vẽ khi ĐÍCH mở được (#665 mục 3, luật 12).
 *
 * Gốc: `canManage` = `payments:manage` (Kế toán HO có) nhưng đích — tab "Phương thức thanh toán" của Cấu hình vận hành — gác `settings:view` (chỉ Quản trị tối cao).
 * Nút "Tạo phương thức thanh toán" còn trỏ `/payment-methods/new` (trang đã XOÁ 14/09/2026) và "Xem toàn bộ danh mục →" trỏ `/payment-methods?centerId=` (chuyển hướng sang tab)
 * ⇒ Kế toán HO bấm vào bị đá về /centers. Nay link trỏ THẲNG tab, kèm `?centerId=`, và chỉ vẽ cho người mở được tab; người còn lại đọc một câu nói ai làm được.
 *
 * Đối chứng dương (luật 11): vai mở được tab THẤY nút — thiếu vế này thì "không thấy nút" xanh cả khi form chưa từng vẽ nút cho ai.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../_actions", () => ({ createCenter: vi.fn(), updateCenter: vi.fn() }));
vi.mock("@/components/admin/ImageUploader", () => ({ ImageUploader: () => null }));
class ResizeObserverGia {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverGia);

import { CenterForm } from "./center-form";

const CENTER = {
  id: "cs1",
  name: "CS1 - 211 Nguyễn Hữu Thọ",
  slug: "cs1",
  address: "211 Nguyễn Hữu Thọ",
  ward: null,
  district: null,
  city: "Đà Nẵng",
  phone: null,
  email: null,
  googleMapUrl: null,
  workingHours: null,
  managerName: null,
  managerUserId: null,
  logoUrl: null,
  bannerUrl: null,
  description: null,
  isActive: true,
  displayOrder: 0,
  latitude: null,
  longitude: null,
  allowedRadiusMeters: 150,
};

function dung(o: { canManage: boolean; coTheMoTabPhuongThuc: boolean }) {
  return render(<CenterForm center={CENTER} suaDuocHoSo payment={{ methods: [], sharedCount: 2, ...o }} />);
}

const lienKet = () => screen.queryAllByRole("link").map((a) => a.getAttribute("href") ?? "");

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("[CFT] nút Tạo / quản lý phương thức ở trang Cơ sở", () => {
  it("[CFT-01] ĐỐI CHỨNG DƯƠNG — mở được tab ⇒ MỘT nút, trỏ THẲNG tab Phương thức thanh toán kèm ?centerId=; không còn link tới trang đã xoá / chuyển hướng", () => {
    dung({ canManage: true, coTheMoTabPhuongThuc: true });
    const lk = screen.getByRole("link", { name: /Tạo \/ quản lý phương thức thanh toán/ });
    expect(lk.getAttribute("href")).toBe("/cau-hinh-van-hanh?tab=phuong-thuc-tt&centerId=cs1");
    const hrefs = lienKet();
    expect(hrefs.some((h) => h.startsWith("/payment-methods/new")), "trang /payment-methods/new đã xoá").toBe(false);
    expect(hrefs.some((h) => h.startsWith("/payment-methods?")), "không còn nhảy qua trang chuyển hướng").toBe(false);
    expect(screen.queryByText(/chỉ Quản trị tối cao mở được tab đó/)).toBeNull();
  });

  it("[CFT-02] có `payments:manage` nhưng KHÔNG mở được tab (Kế toán HO) ⇒ KHÔNG nút nào dẫn vào tab; một câu nói ai làm được", () => {
    dung({ canManage: true, coTheMoTabPhuongThuc: false });
    expect(screen.queryByRole("link", { name: /Tạo \/ quản lý phương thức thanh toán/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Xem toàn bộ danh mục/ })).toBeNull();
    expect(lienKet().some((h) => h.includes("cau-hinh-van-hanh") || h.includes("payment-methods"))).toBe(false);
    expect(document.body.textContent).toMatch(/Cấu hình vận hành.*chỉ Quản trị tối cao mở được tab đó/);
  });

  it("[CFT-03] không có `payments:manage` ⇒ không nút, không câu hướng dẫn (chỉ XEM)", () => {
    dung({ canManage: false, coTheMoTabPhuongThuc: true });
    expect(screen.queryByRole("link", { name: /Tạo \/ quản lý phương thức thanh toán/ })).toBeNull();
    expect(screen.queryByText(/chỉ Quản trị tối cao mở được tab đó/)).toBeNull();
  });
});
