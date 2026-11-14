// @vitest-environment jsdom
/**
 * Ca [KQR-*] — dải «Mã QR cho phụ huynh tự điền» nằm trong thẻ «Người mua trên hoá đơn» (Invoice Hub, gộp thẻ 03/11/2026) trên phần tử THẬT.
 * Canh: mỗi trạng thái nói đúng việc người dùng làm được; mã QR chỉ có ngay sau khi tạo; liên kết không in ra màn; giờ tự xuất chỉ hiện khi có; dải KHÔNG còn nút «Áp dụng» / «Nhập thay».
 * (Các ca tạo mã / phóng to / sao chép chuyển từ bộ [YCN-UI-*] của thẻ QR cũ.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ tao: vi.fn(), capLai: vi.fn(), huy: vi.fn() }));
vi.mock("../_actions-nguoi-mua", () => ({
  taoYeuCauNguoiMuaAction: h.tao,
  capLaiYeuCauNguoiMuaAction: h.capLai,
  huyYeuCauNguoiMuaAction: h.huy,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import type { KhoiYeuCauNguoiMua } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-doc-db";
import { KhoiQr, nhanTrangThaiQr } from "./khoi-qr";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const KHOI: KhoiYeuCauNguoiMua = {
  id: "yc1",
  trangThai: "DANG_MO",
  hetHanLuc: "2026-11-03T07:00:00.000Z",
  linkHetHan: false,
  guiLuc: null,
  soLanMo: 0,
  dangKhoa: false,
  phDaNhap: false,
  xuatLoLuc: null,
  coTheXuatLien: false,
};
const DA_GUI: KhoiYeuCauNguoiMua = { ...KHOI, guiLuc: "2026-11-03T03:30:00.000Z", phDaNhap: true, coTheXuatLien: true };
const ve = (khoi: KhoiYeuCauNguoiMua | null) => render(<KhoiQr orderId="don1" yeuCau={khoi} />);

describe("[KQR-01] chưa có yêu cầu", () => {
  it("nói thẳng «chưa tạo mã», có đúng một nút tạo; KHÔNG có nút Cấp lại / Thu hồi / Áp dụng / Nhập thay", () => {
    ve(null);
    expect(screen.getAllByText(/Chưa tạo mã/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Tạo mã QR cho phụ huynh" })).toBeTruthy();
    for (const n of [/Áp dụng/, /Cấp lại/, /Thu hồi/, /Nhập thay/]) expect(screen.queryByRole("button", { name: n })).toBeNull();
  });

  it("tạo thành công ⇒ hiện ảnh QR + lời cảnh báo «chỉ hiện lần này»; tạo lỗi ⇒ báo lỗi, không hiện QR", async () => {
    h.tao.mockResolvedValueOnce({ ok: false, error: "Đơn đã có yêu cầu đang mở." });
    ve(null);
    fireEvent.click(screen.getByRole("button", { name: "Tạo mã QR cho phụ huynh" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Đơn đã có yêu cầu đang mở."));
    expect(screen.queryByRole("img")).toBeNull();
    h.tao.mockResolvedValueOnce({ ok: true, id: "yc2", lienKet: "https://test.satarobo.vn/thong-tin-hoa-don/yc2.TOKEN", qr: "data:image/svg+xml;base64,AAA", hetHanLuc: "2026-11-03T07:00:00.000Z" });
    fireEvent.click(screen.getByRole("button", { name: "Tạo mã QR cho phụ huynh" }));
    await waitFor(() => expect(screen.getByRole("img", { name: /Mã QR/ })).toBeTruthy());
    expect(screen.getByText(/chỉ hiện lần này/)).toBeTruthy();
  });

  it("[KQR-01b] liên kết KHÔNG in ra màn — chỉ có nút «Sao chép liên kết», bấm thì chép ĐÚNG liên kết", async () => {
    const LK = "https://test.satarobo.vn/thong-tin-hoa-don/yc2.TOKENBIMAT";
    h.tao.mockResolvedValueOnce({ ok: true, id: "yc2", lienKet: LK, qr: "data:image/svg+xml;base64,AAA", hetHanLuc: "2026-11-03T07:00:00.000Z" });
    const viet = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: viet }, configurable: true });
    const { container } = ve(null);
    fireEvent.click(screen.getByRole("button", { name: "Tạo mã QR cho phụ huynh" }));
    await waitFor(() => expect(screen.getByRole("img", { name: /Mã QR/ })).toBeTruthy());
    expect(container.textContent).not.toContain("TOKENBIMAT");
    expect(container.querySelector("input[readonly]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sao chép liên kết/ }));
    await waitFor(() => expect(viet).toHaveBeenCalledWith(LK));
    expect(toast.success).toHaveBeenCalledWith("Đã sao chép liên kết");
  });

  it("[KQR-01c] nút «Phóng to» mở hộp thoại ẢNH LỚN nền trắng; đóng được; mã vẫn còn sau khi đóng", async () => {
    h.tao.mockResolvedValueOnce({ ok: true, id: "yc2", lienKet: "https://test.satarobo.vn/x", qr: "data:image/svg+xml;base64,AAA", hetHanLuc: "2026-11-03T07:00:00.000Z" });
    ve(null);
    fireEvent.click(screen.getByRole("button", { name: "Tạo mã QR cho phụ huynh" }));
    await waitFor(() => expect(screen.getByRole("img", { name: /Mã QR để phụ huynh mở/ })).toBeTruthy());
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Phóng to/ }));
    const hop = await screen.findByRole("dialog");
    expect(hop.textContent).toMatch(/Đưa mã này cho phụ huynh quét/);
    const anhLon = screen.getByRole("img", { name: /phóng to/ });
    expect(anhLon.getAttribute("src")).toBe("data:image/svg+xml;base64,AAA");
    expect(anhLon.className).toMatch(/bg-white/);
    fireEvent.keyDown(hop, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("img", { name: /Mã QR để phụ huynh mở/ })).toBeTruthy();
  });
});

describe("[KQR-02] đang mở", () => {
  it("chưa ai gửi ⇒ «Đang chờ phụ huynh» + giờ hết hạn; có Cấp lại / Thu hồi; KHÔNG có giờ tự xuất", () => {
    ve(KHOI);
    expect(screen.getByText("Đang chờ phụ huynh")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Đang chờ phụ huynh quét mã \(hết hạn lúc/);
    expect(screen.getByRole("button", { name: "Cấp lại mã" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Thu hồi" })).toBeTruthy();
    expect(screen.queryByTestId("tu-xuat-luc")).toBeNull();
  });

  it("PH đã gửi ⇒ «Phụ huynh đã gửi», nói thông tin ĐÃ VÀO ĐƠN và gửi lại sẽ ghi đè; đối chứng: chưa gửi thì không có câu đó", () => {
    const { unmount } = ve(DA_GUI);
    expect(screen.getByText("Phụ huynh đã gửi")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/thông tin đã vào các ô phía trên.*lần gửi sau ghi đè lần trước/);
    unmount();
    ve(KHOI);
    expect(screen.getByRole("status").textContent).not.toMatch(/đã vào các ô/);
  });

  it("[KQR-02b] [09/11/2026 — BGĐ đổi] đã gửi ⇒ hiện HAI đường: giờ lô cuối ngày (khi máy chủ báo có `xuatLoLuc`) + nút «Xuất liền»; KHÔNG còn câu «tự xuất hoá đơn từ … sau n giờ»", () => {
    const { unmount } = ve({ ...DA_GUI, xuatLoLuc: "2026-11-03T16:30:00.000Z" });
    const khung = screen.getByTestId("xuat-hoa-don");
    expect(khung.textContent).toMatch(/cùng lô cuối ngày lúc/);
    expect(screen.getByTestId("xuat-lo-luc").textContent).toMatch(/23:30/);
    expect(khung.textContent).toMatch(/chỉ bấm khi phụ huynh cần hoá đơn ngay/i);
    expect(screen.getByRole("button", { name: /Xuất liền/ })).toBeTruthy();
    expect(khung.textContent).not.toMatch(/tự xuất hoá đơn từ|sửa trước giờ đó/);
    unmount();
    // lô chưa ở chế độ tự động ⇒ không bịa giờ, vẫn có nút
    ve(DA_GUI);
    expect(screen.queryByTestId("xuat-lo-luc")).toBeNull();
    expect(screen.getByRole("button", { name: /Xuất liền/ })).toBeTruthy();
  });

  it("[KQR-02c] phụ huynh CHƯA gửi (hoặc yêu cầu không còn mở) ⇒ KHÔNG có nút «Xuất liền» — không có gì để đối chiếu / xuất", () => {
    const { unmount } = ve(KHOI);
    expect(screen.queryByRole("button", { name: /Xuất liền/ })).toBeNull();
    expect(screen.queryByTestId("xuat-hoa-don")).toBeNull();
    unmount();
    ve({ ...DA_GUI, trangThai: "DA_AP_DUNG", coTheXuatLien: false });
    expect(screen.queryByRole("button", { name: /Xuất liền/ })).toBeNull();
  });

  it("mã hết hạn được nói ra nhưng nhân viên VẪN cấp lại được", () => {
    ve({ ...KHOI, linkHetHan: true });
    expect(screen.getByText("Mã đã hết hạn")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cấp lại mã" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("mã đang bị khoá ⇒ có câu nói rõ; không khoá thì không có", () => {
    const { unmount } = ve({ ...KHOI, dangKhoa: true });
    expect(screen.getByText(/tạm khoá/)).toBeTruthy();
    unmount();
    ve(KHOI);
    expect(screen.queryByText(/tạm khoá/)).toBeNull();
  });

  it("cấp lại / thu hồi gọi ĐÚNG action với đúng đơn + yêu cầu; thu hồi thành công thì báo", async () => {
    h.capLai.mockResolvedValueOnce({ ok: true, id: "yc3", lienKet: "https://x/y", qr: "data:image/svg+xml;base64,BBB", hetHanLuc: "2026-11-03T07:00:00.000Z" });
    h.huy.mockResolvedValueOnce({ ok: true });
    ve(KHOI);
    fireEvent.click(screen.getByRole("button", { name: "Cấp lại mã" }));
    await waitFor(() => expect(h.capLai).toHaveBeenCalledWith("don1", "yc1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã cấp mã mới — mã cũ không còn dùng được"));
    fireEvent.click(screen.getByRole("button", { name: "Thu hồi" }));
    await waitFor(() => expect(h.huy).toHaveBeenCalledWith("don1", "yc1", expect.any(String)));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã thu hồi mã QR"));
  });

  it("dải KHÔNG còn bảng ô riêng, nút «Áp dụng vào đơn» hay «Nhập thay» (đã gộp vào thẻ cha)", () => {
    const { container } = ve(DA_GUI);
    expect(container.querySelector("dl")).toBeNull();
    for (const n of [/Áp dụng/, /Ghi đè/, /Nhập thay/]) expect(screen.queryByRole("button", { name: n })).toBeNull();
  });
});

describe("[KQR-03] trạng thái cuối", () => {
  it.each([
    ["DA_AP_DUNG", "Đã xuất / đã đóng"],
    ["THU_HOI", "Đã thu hồi"],
    ["HET_HAN", "Đã hết hạn"],
  ] as const)("%s ⇒ nhãn «%s», chỉ còn nút «Tạo mã mới»", (trangThai, nhan) => {
    ve({ ...KHOI, trangThai });
    expect(screen.getByText(nhan)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tạo mã mới" })).toBeTruthy();
    for (const n of [/Cấp lại/, /Thu hồi$/]) expect(screen.queryByRole("button", { name: n })).toBeNull();
  });
  it("nhãn trạng thái: đủ mọi nhánh (hàm thuần)", () => {
    expect(nhanTrangThaiQr(null)).toBe("Chưa tạo mã");
    expect(nhanTrangThaiQr(KHOI)).toBe("Đang chờ phụ huynh");
    expect(nhanTrangThaiQr({ ...KHOI, linkHetHan: true })).toBe("Mã đã hết hạn");
    expect(nhanTrangThaiQr(DA_GUI)).toBe("Phụ huynh đã gửi");
    expect(nhanTrangThaiQr({ ...DA_GUI, linkHetHan: true })).toBe("Phụ huynh đã gửi");
  });
});
