// @vitest-environment jsdom
/**
 * [DISC-KHF-*] Form nhận bài DISC: thách đố thứ hai (năm sinh của con) + gợi ý đăng nhập. Dữ liệu GIẢ, không DB/mạng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const M = vi.hoisted(() => ({
  yeuCau: vi.fn(async (_s: string) => ({ ok: true, cooldownSec: 60 }) as { ok: boolean; error?: string; cooldownSec?: number }),
  nhan: vi.fn(async (_i: Record<string, unknown>) => ({ ok: false, error: "Không nhận được bài với thông tin này." }) as { ok: boolean; error?: string; canDangNhap?: boolean }),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("./nhan-disc-actions", () => ({ requestDiscClaimOtp: M.yeuCau, claimDiscResult: M.nhan }));
vi.mock("sonner", () => ({ toast: M.toast }));

import { NhanDiscForm } from "./nhan-disc-form";

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function toiBuocNhan() {
  render(<NhanDiscForm />);
  fireEvent.change(screen.getByLabelText(/Số điện thoại/), { target: { value: "0905000111" } });
  fireEvent.change(screen.getByLabelText(/Mã nhận bài/), { target: { value: "ABCDE-23456" } });
  fireEvent.change(screen.getByLabelText(/Năm sinh của con/), { target: { value: "2015" } });
  fireEvent.click(screen.getByRole("button", { name: "Gửi mã xác minh" }));
  await waitFor(() => expect(screen.getByLabelText(/Mã xác minh 6 chữ số/)).toBeTruthy());
}

describe("[DISC-KHF-01] ô năm sinh của con", () => {
  it("có ô bắt buộc, chỉ nhận chữ số tối đa 4 ký tự, kèm lời giải thích và gợi ý đăng nhập tiếng Việt có dấu", () => {
    render(<NhanDiscForm />);
    const o = screen.getByLabelText(/Năm sinh của con/) as HTMLInputElement;
    expect(o.required).toBe(true);
    expect(o.maxLength).toBe(4);
    expect(o.inputMode).toBe("numeric");
    fireEvent.change(o, { target: { value: "20a1b5" } });
    expect(o.value).toBe("2015");
    expect(screen.getByText(/Nhập sai nhiều lần, bài sẽ bị khoá/)).toBeTruthy();
    const goiY = screen.getByText(/Nếu bạn đã có tài khoản Sata Robo/);
    expect(goiY.querySelector("a")?.getAttribute("href")).toBe("/login");
  });
  it("gửi mã xác minh KHÔNG kèm năm sinh (chỉ SĐT) — năm sinh chỉ đi cùng lượt nhận", async () => {
    await toiBuocNhan();
    expect(M.yeuCau).toHaveBeenCalledWith("0905000111");
  });
  it("lượt nhận gửi đủ SĐT · OTP · mã · NĂM SINH · mật khẩu", async () => {
    await toiBuocNhan();
    fireEvent.change(screen.getByLabelText(/Mã xác minh 6 chữ số/), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: "matkhau-gia-1" } });
    fireEvent.change(screen.getByLabelText(/Nhập lại mật khẩu/), { target: { value: "matkhau-gia-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Nhận kết quả" }));
    await waitFor(() => expect(M.nhan).toHaveBeenCalledTimes(1));
    expect(M.nhan.mock.calls[0]![0]).toEqual({ soDienThoai: "0905000111", otp: "123456", maNhan: "ABCDE-23456", namSinhCon: "2015", matKhau: "matkhau-gia-1", dongYTiepThi: false });
  });
  it("N7: ô tích tiếp thị của CHỦ SỐ mặc định KHÔNG tích; tích thì gửi dongYTiepThi=true", async () => {
    await toiBuocNhan();
    const o = screen.getByRole("checkbox") as HTMLInputElement;
    expect(o.checked).toBe(false);
    fireEvent.change(screen.getByLabelText(/Mã xác minh 6 chữ số/), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: "matkhau-gia-1" } });
    fireEvent.change(screen.getByLabelText(/Nhập lại mật khẩu/), { target: { value: "matkhau-gia-1" } });
    fireEvent.click(o);
    fireEvent.click(screen.getByRole("button", { name: "Nhận kết quả" }));
    await waitFor(() => expect(M.nhan).toHaveBeenCalledTimes(1));
    expect(M.nhan.mock.calls[0]![0]).toMatchObject({ dongYTiepThi: true });
  });
  it("lỗi chung hiện đúng câu server trả, không tiết lộ nguyên nhân; không chuyển sang màn thành công", async () => {
    await toiBuocNhan();
    fireEvent.change(screen.getByLabelText(/Mã xác minh 6 chữ số/), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: "matkhau-gia-1" } });
    fireEvent.change(screen.getByLabelText(/Nhập lại mật khẩu/), { target: { value: "matkhau-gia-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Nhận kết quả" }));
    await waitFor(() => expect(M.toast.error).toHaveBeenCalledWith("Không nhận được bài với thông tin này."));
    expect(screen.queryByText(/Đã nhận kết quả DISC/)).toBeNull();
  });
  it("ĐỐI CHỨNG DƯƠNG: server báo ok ⇒ màn thành công", async () => {
    M.nhan.mockResolvedValueOnce({ ok: true });
    await toiBuocNhan();
    fireEvent.change(screen.getByLabelText(/Mã xác minh 6 chữ số/), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: "matkhau-gia-1" } });
    fireEvent.change(screen.getByLabelText(/Nhập lại mật khẩu/), { target: { value: "matkhau-gia-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Nhận kết quả" }));
    await waitFor(() => expect(screen.getByText(/Đã nhận kết quả DISC/)).toBeTruthy());
  });
});

describe("[DISC-KHF-D2] thông điệp trung tính nhưng chỉ đường được", () => {
  it("sau khi xin mã: hướng dẫn nằm TẠI CHỖ (không chỉ toast), có đường đăng nhập, không nói số có/không có tài khoản", async () => {
    await toiBuocNhan();
    const hd = screen.getByTestId("disc-xacminh-huong-dan");
    expect(hd.textContent).toMatch(/Nếu số này có bài đang chờ/);
    expect(hd.textContent).toMatch(/Chưa thấy mã/);
    expect(hd.textContent).toMatch(/hocvien\.satarobo\.vn/);
    expect(hd.querySelector("a")?.getAttribute("href")).toBe("/login");
    // trung tính: không khẳng định số này CÓ / KHÔNG CÓ tài khoản hay bài
    expect(hd.textContent).not.toMatch(/số này (đã có tài khoản\.|không có|chưa có)/i);
    expect(hd.textContent).not.toMatch(/không tìm thấy|không tồn tại/i);
  });
  it("gõ sai số ⇒ 'Đổi số điện thoại' mở lại ô số và xoá mã xác minh đã gõ", async () => {
    await toiBuocNhan();
    fireEvent.change(screen.getByLabelText(/Mã xác minh 6 chữ số/), { target: { value: "123456" } });
    expect((screen.getByLabelText(/Số điện thoại/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("disc-doi-so"));
    expect((screen.getByLabelText(/Số điện thoại/) as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByLabelText(/Mã xác minh 6 chữ số/)).toBeNull();
    expect(screen.queryByTestId("disc-xacminh-huong-dan")).toBeNull();
  });
  it("lỗi hiện TẠI CHỖ với role=alert (không chỉ toast)", async () => {
    await toiBuocNhan();
    fireEvent.change(screen.getByLabelText(/Mã xác minh 6 chữ số/), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Nhận kết quả" }));
    const a = await screen.findByRole("alert");
    expect(a.textContent).toBe("Không nhận được bài với thông tin này.");
  });
  it("CAN_DANG_NHAP ⇒ màn có nút Đăng nhập dẫn tới /login", async () => {
    M.nhan.mockResolvedValueOnce({ ok: false, canDangNhap: true });
    await toiBuocNhan();
    fireEvent.change(screen.getByLabelText(/Mã xác minh 6 chữ số/), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Nhận kết quả" }));
    const l = await screen.findByRole("link", { name: "Đăng nhập" });
    expect(l.getAttribute("href")).toBe("/login");
  });
});

describe("[DISC-KHF-PW] mật khẩu nhập hai lần + nút con mắt", () => {
  it("hai lần nhập khác nhau ⇒ báo lỗi tại chỗ, KHÔNG gọi máy chủ", async () => {
    await toiBuocNhan();
    fireEvent.change(screen.getByLabelText(/Mã xác minh 6 chữ số/), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: "matkhau-gia-1" } });
    fireEvent.change(screen.getByLabelText(/Nhập lại mật khẩu/), { target: { value: "matkhau-gia-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Nhận kết quả" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/chưa giống nhau/);
    expect(M.nhan).not.toHaveBeenCalled();
  });
  it("mật khẩu dưới 8 ký tự ⇒ báo lỗi tại chỗ, KHÔNG gọi máy chủ", async () => {
    await toiBuocNhan();
    fireEvent.change(screen.getByLabelText(/Mã xác minh 6 chữ số/), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: "ngan" } });
    fireEvent.change(screen.getByLabelText(/Nhập lại mật khẩu/), { target: { value: "ngan" } });
    fireEvent.click(screen.getByRole("button", { name: "Nhận kết quả" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/tối thiểu 8 ký tự/);
    expect(M.nhan).not.toHaveBeenCalled();
  });
  it("bỏ trống cả hai (người đã đăng nhập) ⇒ vẫn gửi", async () => {
    await toiBuocNhan();
    fireEvent.change(screen.getByLabelText(/Mã xác minh 6 chữ số/), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Nhận kết quả" }));
    await waitFor(() => expect(M.nhan).toHaveBeenCalledTimes(1));
  });
  it("nút con mắt hiện/ẩn CẢ HAI ô mật khẩu và đổi nhãn đọc màn hình", async () => {
    await toiBuocNhan();
    const a = screen.getByLabelText(/Mật khẩu/) as HTMLInputElement;
    const b = screen.getByLabelText(/Nhập lại mật khẩu/) as HTMLInputElement;
    expect([a.type, b.type]).toEqual(["password", "password"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Hiện mật khẩu" })[0]!);
    expect([a.type, b.type]).toEqual(["text", "text"]);
    expect(screen.getAllByRole("button", { name: "Ẩn mật khẩu" }).length).toBe(2);
  });
});
