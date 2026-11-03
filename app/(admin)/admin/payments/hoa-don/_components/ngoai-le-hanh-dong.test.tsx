// @vitest-environment jsdom
// Ca [NLH-*] — nút xử lý MỘT ngoại lệ hoá đơn (S12, Invoice Hub). Render THẬT: nút chỉ vẽ khi bấm được (luật 12), mỗi ca «KHÔNG thấy» có đối chứng dương,
// form lý do mở TẠI DÒNG (không modal), lý do < 10 ký tự không gửi được, lỗi của máy chủ hiện cho người dùng, thành công thì làm mới.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastOk: vi.fn(),
  xuLy: vi.fn(async (_i: unknown) => ({ ok: true, data: { id: "nl1", trangThai: "DANG_XU_LY" } }) as unknown),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: h.toastOk, error: vi.fn() } }));
vi.mock("../canh-bao/_ngoai-le-actions", () => ({ xuLyNgoaiLeAction: h.xuLy }));

import type { HanhDongChoPhep } from "@/lib/finance/hoa-don/ngoai-le-xu-ly";
import { NgoaiLeHanhDong } from "./ngoai-le-hanh-dong";

const DU: HanhDongChoPhep = { nhan: true, daXuLy: true, boQua: true, lyDoKhong: null };
const dung = (hd = DU) => render(<ul><li><NgoaiLeHanhDong id="nl1" viec="Nghi thu trùng — đơn ORD-1" hanhDong={hd} /></li></ul>);

beforeEach(() => {
  vi.clearAllMocks();
  h.xuLy.mockResolvedValue({ ok: true, data: { id: "nl1", trangThai: "DANG_XU_LY" } });
});
afterEach(cleanup);

describe("[NLH-01] nút nào được vẽ", () => {
  it("đủ quyền ⇒ ba nút, mỗi nút có nhãn đọc được RIÊNG cho dòng (aria-label nêu việc)", () => {
    dung();
    expect(screen.getByRole("button", { name: /Nhận xử lý: Nghi thu trùng — đơn ORD-1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Đã xử lý: Nghi thu trùng/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bỏ qua: Nghi thu trùng/ })).toBeTruthy();
  });

  it("đã nhận rồi ⇒ mất nút «Nhận xử lý», còn hai nút kia (đối chứng của ca trên)", () => {
    dung({ ...DU, nhan: false });
    expect(screen.queryByRole("button", { name: /Nhận xử lý/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Đã xử lý:/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bỏ qua:/ })).toBeTruthy();
  });

  it("từng cờ ĐỘC LẬP: chỉ `nhan` ⇒ chỉ nút Nhận; chỉ `daXuLy` ⇒ chỉ nút Đã xử lý; chỉ `boQua` ⇒ chỉ nút Bỏ qua", () => {
    const tenNut = () => screen.queryAllByRole("button").map((b) => b.getAttribute("aria-label")?.split(":")[0]);
    dung({ nhan: true, daXuLy: false, boQua: false, lyDoKhong: null });
    expect(tenNut()).toEqual(["Nhận xử lý"]);
    cleanup();
    dung({ nhan: false, daXuLy: true, boQua: false, lyDoKhong: null });
    expect(tenNut()).toEqual(["Đã xử lý"]);
    cleanup();
    dung({ nhan: false, daXuLy: false, boQua: true, lyDoKhong: null });
    expect(tenNut()).toEqual(["Bỏ qua"]);
  });

  it("ngoài phạm vi ⇒ KHÔNG nút nào nhưng NÓI vì sao; đối chứng dương ở ca đầu", () => {
    dung({ nhan: false, daXuLy: false, boQua: false, lyDoKhong: "Ngoại lệ thuộc cơ sở khác — chỉ kế toán cơ sở đó hoặc kế toán Hội sở xử lý." });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/thuộc cơ sở khác/)).toBeTruthy();
  });

  it("đã đóng (không nút, không lời) ⇒ không vẽ gì", () => {
    const { container } = dung({ nhan: false, daXuLy: false, boQua: false, lyDoKhong: null });
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("[NLH-02] nhận xử lý: một bước, không form", () => {
  it("bấm ⇒ gọi action đúng tham số, báo thành công, làm mới", async () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Nhận xử lý/ }));
    await waitFor(() => expect(h.xuLy).toHaveBeenCalledWith({ id: "nl1", hanhDong: "NHAN_XU_LY", lyDo: "" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.toastOk).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("máy chủ từ chối ⇒ câu lỗi hiện NGAY cạnh nút (role=alert), KHÔNG làm mới, KHÔNG báo thành công", async () => {
    h.xuLy.mockResolvedValue({ ok: false, error: "Ngoại lệ này đã có người nhận xử lý." });
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Nhận xử lý/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/đã có người nhận/);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.toastOk).not.toHaveBeenCalled();
  });
});

describe("[NLH-03] «Đã xử lý» / «Bỏ qua»: form lý do TẠI DÒNG", () => {
  it("mở form: có nhãn, gợi ý đúng nghĩa từng bước; nút xác nhận khoá tới khi đủ 10 ký tự THẬT (khoảng trắng không tính) và nói còn thiếu bao nhiêu", () => {
    dung();
    const bo = screen.getByRole("button", { name: /Bỏ qua:/ });
    fireEvent.click(bo);
    expect(bo.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/KHÔNG báo lại đúng việc này/)).toBeTruthy();
    const xacNhan = screen.getByRole("button", { name: "Xác nhận bỏ qua" }) as HTMLButtonElement;
    expect(xacNhan.disabled).toBe(true);
    const o = screen.getByLabelText(/Vì sao bỏ qua/);
    fireEvent.change(o, { target: { value: "   ngắn    " } });
    expect(xacNhan.disabled).toBe(true);
    expect(screen.getByText(/Còn thiếu 6 ký tự/)).toBeTruthy();
    fireEvent.change(o, { target: { value: "Đã được kế toán Hội sở xác nhận" } });
    expect(xacNhan.disabled).toBe(false);
    expect(screen.getByText(/Đủ điều kiện/)).toBeTruthy();
  });

  it("gợi ý của «Đã xử lý» khác «Bỏ qua»: nguyên nhân còn thì hệ thống mở lại", () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Đã xử lý:/ }));
    expect(screen.getByText(/nguyên nhân còn, hệ thống sẽ mở lại/)).toBeTruthy();
    expect(screen.queryByText(/KHÔNG báo lại/)).toBeNull();
  });

  it("gửi ⇒ action nhận lý do đã cắt khoảng trắng; thành công thì đóng form, làm mới, báo thành công", async () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Đã xử lý:/ }));
    fireEvent.change(screen.getByLabelText(/Đã xử lý bằng cách nào/), { target: { value: "  Đã hoàn khoản thu trùng ở MISA  " } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đã xử lý" }));
    await waitFor(() => expect(h.xuLy).toHaveBeenCalledWith({ id: "nl1", hanhDong: "DA_XU_LY", lyDo: "Đã hoàn khoản thu trùng ở MISA" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("máy chủ từ chối ⇒ lỗi nằm TRONG form (role=alert, gắn aria-describedby), form vẫn mở, lý do người dùng gõ KHÔNG mất", async () => {
    h.xuLy.mockResolvedValue({ ok: false, error: "Ngoại lệ vừa được người khác xử lý — tải lại trang để xem trạng thái mới." });
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Bỏ qua:/ }));
    const o = screen.getByLabelText(/Vì sao bỏ qua/) as HTMLTextAreaElement;
    fireEvent.change(o, { target: { value: "Khoản thu hộ đã xác nhận" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận bỏ qua" }));
    const loi = await screen.findByRole("alert");
    expect(loi.textContent).toMatch(/người khác xử lý/);
    expect(o.getAttribute("aria-describedby")).toContain(loi.id);
    expect(o.getAttribute("aria-invalid")).toBe("true");
    expect(o.value).toBe("Khoản thu hộ đã xác nhận");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("Esc và «Huỷ» đóng form; bấm lại nút mở thì gập; mở bước kia thì ĐỔI nhãn (không hai form cùng lúc)", () => {
    dung();
    const xu = screen.getByRole("button", { name: /Đã xử lý:/ });
    fireEvent.click(xu);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(xu);
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(xu);
    fireEvent.click(xu);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(xu);
    fireEvent.click(screen.getByRole("button", { name: /Bỏ qua:/ }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByLabelText(/Vì sao bỏ qua/)).toBeTruthy();
  });
});
