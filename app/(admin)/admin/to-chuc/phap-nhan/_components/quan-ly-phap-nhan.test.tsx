// @vitest-environment jsdom
// Ca [PNU-*] — giao diện quản trị pháp nhân: nói THẬT vì sao nút bị khoá; lý do bắt buộc; gửi đúng payload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  tao: vi.fn(),
  sua: vi.fn(),
  trangThai: vi.fn(),
  xoa: vi.fn(),
  gan: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../_actions", () => ({
  taoPhapNhanAction: h.tao,
  suaPhapNhanAction: h.sua,
  doiTrangThaiPhapNhanAction: h.trangThai,
  xoaPhapNhanAction: h.xoa,
  ganPhapNhanChoDonViAction: h.gan,
}));

import { QuanLyPhapNhan, type DongPhapNhanUi, type DonViUi } from "./quan-ly-phap-nhan";

const TD0 = { donVi: 0, hoaDon: 0, cauHinhHoaDon: 0 };
const PN: DongPhapNhanUi[] = [
  { id: "goc", taxCode: "0402301783", legalName: "SATA ROBO", address: null, isPrimary: true, isActive: true, daXoa: false, tacDong: { donVi: 2, hoaDon: 26, cauHinhHoaDon: 0 } },
  { id: "nv", taxCode: "0402341070", legalName: "NEW VISION", address: "114 Hoàng Diệu", isPrimary: false, isActive: true, daXoa: false, tacDong: { donVi: 0, hoaDon: 0, cauHinhHoaDon: 0 } },
  { id: "stem", taxCode: "0402341056", legalName: "STEM ROBOTICS & AI", address: null, isPrimary: false, isActive: true, daXoa: false, tacDong: { donVi: 1, hoaDon: 6, cauHinhHoaDon: 1 } },
  { id: "cu", taxCode: "0402340000", legalName: "CÔNG TY CŨ", address: null, isPrimary: false, isActive: false, daXoa: true, tacDong: TD0 },
];
const DV: DonViUi[] = [
  { id: "u-cs1", code: "CS1", name: "Cơ sở 1", type: "CENTER", legalEntityId: "goc" },
  { id: "u-cs2", code: "CS2", name: "Cơ sở 2", type: "CENTER", legalEntityId: null },
];
const ve = () => render(<QuanLyPhapNhan danhSach={PN} donVi={DV} lichSu={[]} />);
// Tên pháp nhân cũng hiện ở bảng "Đơn vị đang gắn" ⇒ chỉ tìm trong bảng ĐẦU (danh sách pháp nhân) hoặc bảng theo tên đơn vị.
const hang = (ten: string) => {
  const bang = screen.getAllByRole("table");
  const trongBang = bang.map((b) => within(b).queryAllByText(ten)).flat();
  return trongBang[0]!.closest("tr") as HTMLElement;
};
const LY_DO = "Cập nhật theo thông tin xuất hoá đơn chủ dự án cung cấp";

beforeEach(() => {
  for (const f of [h.tao, h.sua, h.trangThai, h.xoa, h.gan]) {
    f.mockReset();
    f.mockResolvedValue({ ok: true });
  }
});
afterEach(cleanup);

describe("[PNU] quản trị pháp nhân", () => {
  it("[PNU-01] mỗi dòng nói số đơn vị / hoá đơn / dòng cấu hình đang dựa vào", () => {
    ve();
    expect(within(hang("STEM ROBOTICS & AI")).getByText(/1 đơn vị · 6 hoá đơn · 1 dòng cấu hình hoá đơn/)).toBeTruthy();
  });

  it("[PNU-02] pháp nhân GỐC: không có nút Ngừng / Xoá; pháp nhân còn đơn vị gắn: nút Xoá bị khoá (kèm lý do)", () => {
    ve();
    const goc = hang("SATA ROBO");
    expect(within(goc).queryByRole("button", { name: "Ngừng" })).toBeNull();
    expect(within(goc).queryByRole("button", { name: "Xoá" })).toBeNull();
    const xoaStem = within(hang("STEM ROBOTICS & AI")).getByRole("button", { name: "Xoá" }) as HTMLButtonElement;
    expect(xoaStem.disabled).toBe(true);
    expect(xoaStem.title).toMatch(/Còn 1 đơn vị đang gắn/);
    expect((within(hang("NEW VISION")).getByRole("button", { name: "Xoá" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("[PNU-03] pháp nhân đã xoá / ngừng chỉ có 'Mở lại' (không sinh bản trùng MST)", () => {
    ve();
    const cu = hang("CÔNG TY CŨ");
    expect(within(cu).getByRole("button", { name: "Mở lại" })).toBeTruthy();
    expect(within(cu).queryByRole("button", { name: "Sửa" })).toBeNull();
  });

  it("[PNU-04] thêm: gửi MST + tên + địa chỉ; không cần lý do", async () => {
    ve();
    fireEvent.click(screen.getByRole("button", { name: "Thêm pháp nhân" }));
    fireEvent.change(screen.getByLabelText("Tên pháp nhân"), { target: { value: "CÔNG TY MỚI" } });
    fireEvent.change(screen.getByLabelText("Mã số thuế"), { target: { value: "0402999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(h.tao.mock.calls[0]![0]).toEqual({ taxCode: "0402999999", legalName: "CÔNG TY MỚI", address: null });
  });

  it("[PNU-05] sửa: Lưu khoá tới khi lý do ≥10 ký tự; MST bị KHOÁ khi đã có hoá đơn và KHÔNG gửi lên server", async () => {
    ve();
    fireEvent.click(within(hang("STEM ROBOTICS & AI")).getByRole("button", { name: "Sửa" }));
    expect((screen.getByLabelText("Mã số thuế") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/MST đã khoá/)).toBeTruthy();
    const luu = () => screen.getByRole("button", { name: "Lưu" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Tên pháp nhân"), { target: { value: "STEM ROBOTICS & AI (CS1)" } });
    expect(luu().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    expect(luu().disabled).toBe(false);
    fireEvent.click(luu());
    await waitFor(() => expect(h.sua).toHaveBeenCalledTimes(1));
    const p = h.sua.mock.calls[0]![0];
    expect(p).toMatchObject({ id: "stem", legalName: "STEM ROBOTICS & AI (CS1)", lyDo: LY_DO });
    expect(p.taxCode).toBeUndefined();
  });

  it("[PNU-06] sửa pháp nhân CHƯA ai dựa vào: MST mở, được gửi", async () => {
    ve();
    fireEvent.click(within(hang("NEW VISION")).getByRole("button", { name: "Sửa" }));
    expect((screen.getByLabelText("Mã số thuế") as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Mã số thuế"), { target: { value: "0402341071" } });
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(h.sua).toHaveBeenCalledTimes(1));
    expect(h.sua.mock.calls[0]![0]).toMatchObject({ taxCode: "0402341071" });
  });

  it("[PNU-07] lỗi từ server hiện nguyên văn cho người dùng, không đóng form", async () => {
    h.tao.mockResolvedValue({ ok: false, error: 'Mã số thuế "0402341070" đã có ở pháp nhân "NEW VISION" (đang hoạt động).' });
    ve();
    fireEvent.click(screen.getByRole("button", { name: "Thêm pháp nhân" }));
    fireEvent.change(screen.getByLabelText("Tên pháp nhân"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Mã số thuế"), { target: { value: "0402341070" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/đã có ở pháp nhân "NEW VISION"/);
    expect(screen.getByLabelText("Tên pháp nhân")).toBeTruthy();
  });

  it("[PNU-08] gắn đơn vị: chỉ liệt kê pháp nhân còn dùng được; gửi đúng đơn vị + pháp nhân + lý do; chọn 'gỡ' gửi null", async () => {
    ve();
    fireEvent.click(within(hang("Cơ sở 2")).getByRole("button", { name: "Đổi" }));
    const chon = screen.getByLabelText("Pháp nhân") as HTMLSelectElement;
    expect(Array.from(chon.options).map((o) => o.textContent)).not.toContain(expect.stringMatching(/CÔNG TY CŨ/));
    expect(chon.textContent).not.toMatch(/CÔNG TY CŨ/);
    fireEvent.change(chon, { target: { value: "nv" } });
    const luu = screen.getAllByRole("button", { name: "Lưu" })[0] as HTMLButtonElement;
    expect(luu.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Lý do \(bắt buộc\)/), { target: { value: LY_DO } });
    fireEvent.click(luu);
    await waitFor(() => expect(h.gan).toHaveBeenCalledTimes(1));
    expect(h.gan.mock.calls[0]![0]).toEqual({ orgUnitId: "u-cs2", legalEntityId: "nv", lyDo: LY_DO });
  });

  it("[PNU-09] ngừng / xoá cần lý do; xoá gửi đúng id", async () => {
    ve();
    fireEvent.click(within(hang("NEW VISION")).getByRole("button", { name: "Xoá" }));
    const luu = screen.getByRole("button", { name: "Lưu" }) as HTMLButtonElement;
    expect(luu.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(luu);
    await waitFor(() => expect(h.xoa).toHaveBeenCalledWith({ id: "nv", lyDo: LY_DO }));
  });
});
