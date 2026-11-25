// @vitest-environment jsdom
/**
 * Ca [NXL-*] — nút «Xuất liền» + hộp đối chiếu của Sale (BGĐ đổi yêu cầu 09/11/2026).
 * Canh: hộp liệt kê ĐẦY ĐỦ người mua / học viên / email / từng lần thu / tổng; nút «Xuất hoá đơn ngay» KHÓA tới khi Sale tick «đã đối chiếu»; chỉ khi xác nhận mới gọi máy chủ và gửi ĐÚNG dấu;
 * lỗi máy chủ nói thật (không báo thành công giả); kết quả nói thời gian xử lý và thư đã đi hay còn xếp hàng.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ xem: vi.fn(), xuat: vi.fn() }));
vi.mock("../_actions-nguoi-mua", () => ({ xemTruocXuatLienAction: h.xem, xuatLienAction: h.xuat }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { NutXuatLien } from "./nut-xuat-lien";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const XT = {
  ok: true as const,
  nguoiMua: { hoTen: "Lê Thị Mẹ", tenDonVi: null, maSoThue: null, diaChi: "5 Hoàng Diệu, Đà Nẵng", cccd: "048123456789", email: "me@example.com", dienThoai: "0905123456", maKhachHang: "CS1-PH-AB3K9P" },
  hocVien: "Trần Bảo An",
  emailNhan: "me@example.com",
  lanThu: [{ key: "k1", ngayThu: "2026-11-09", soTien: 3_000_000, nhanNguon: "Tiền mặt" }, { key: "k2", ngayThu: "2026-11-08", soTien: 1_000_000, nhanNguon: "Chuyển khoản" }],
  khongXuatLien: [{ ngayThu: "2026-11-07", soTien: 500_000, lyDo: "Còn khoản chưa được kế toán xác nhận" }],
  tongTien: 4_000_000,
  dauVan: "DAU-VAN-1",
};
/** Nút có thể còn khoá một thoáng khi phép chuyển (`useTransition`) chưa kết thúc — người thật không bấm nhanh tới mức đó, nhưng test thì có: chờ nút mở rồi mới bấm. */
const nutSan = async (ten: RegExp) => {
  const nut = (await screen.findByRole("button", { name: ten })) as HTMLButtonElement;
  await waitFor(() => expect(nut.disabled).toBe(false));
  return nut;
};
const mo = async () => {
  render(<NutXuatLien orderId="don1" />);
  fireEvent.click(screen.getByRole("button", { name: /Xuất liền/ }));
  return screen.findByRole("dialog");
};

describe("[NXL-01] hộp đối chiếu", () => {
  it("bấm «Xuất liền» ⇒ gọi XEM TRƯỚC (chưa xuất gì); hộp liệt kê đủ người mua · CCCD · địa chỉ · học viên · email · từng lần thu · tổng", async () => {
    h.xem.mockResolvedValue(XT);
    const hop = await mo();
    await screen.findByText("Đối chiếu trước khi xuất");
    for (const v of ["Lê Thị Mẹ", "048123456789", "5 Hoàng Diệu, Đà Nẵng", "0905123456", "CS1-PH-AB3K9P", "Trần Bảo An", "me@example.com", "09/11/2026", "08/11/2026", "Tiền mặt", "Chuyển khoản", "3.000.000", "1.000.000", "4.000.000", "Sẽ xuất 2 hoá đơn"]) {
      expect(hop.textContent, v).toContain(v);
    }
    expect(h.xem).toHaveBeenCalledWith("don1");
    expect(h.xuat).not.toHaveBeenCalled();
  });
  it("lần thu CHƯA xuất liền được hiện kèm lý do (Sale không tưởng đã xuất hết)", async () => {
    h.xem.mockResolvedValue(XT);
    const hop = await mo();
    await screen.findByText("Đối chiếu trước khi xuất");
    expect(hop.textContent).toContain("CHƯA xuất liền được");
    expect(hop.textContent).toContain("Còn khoản chưa được kế toán xác nhận");
  });
  it("đơn vị (doanh nghiệp): hiện tên đơn vị + MST + người liên hệ; không có email ⇒ nói rõ phải gửi Zalo", async () => {
    h.xem.mockResolvedValue({ ...XT, nguoiMua: { ...XT.nguoiMua, tenDonVi: "Công ty TNHH Sata", maSoThue: "0401234567", cccd: null }, emailNhan: null });
    const hop = await mo();
    await screen.findByText("Đối chiếu trước khi xuất");
    for (const v of ["Công ty TNHH Sata", "0401234567", "Người liên hệ", "Chưa có email"]) expect(hop.textContent, v).toContain(v);
  });
});

describe("[NXL-02] xác nhận trước khi xuất", () => {
  it("nút «Xuất hoá đơn ngay» KHÓA cho tới khi tick «đã đọc lại với phụ huynh»; chưa tick thì bấm cũng không gọi máy chủ", async () => {
    h.xem.mockResolvedValue(XT);
    await mo();
    const nut = (await screen.findByRole("button", { name: /Xuất hoá đơn ngay/ })) as HTMLButtonElement;
    expect(nut.disabled).toBe(true);
    fireEvent.click(nut);
    expect(h.xuat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(nut.disabled).toBe(false);
  });
  it("tick + xác nhận ⇒ gọi xuất với ĐÚNG đơn và ĐÚNG dấu của hộp; xong ⇒ báo thời gian xử lý + thư đã gửi", async () => {
    h.xem.mockResolvedValue(XT);
    h.xuat.mockResolvedValue({ ok: true, daXuat: 2, dangPhatHanh: 0, guiNgay: true, mili: 3400, ghiChu: [] });
    await mo();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(await nutSan(/Xuất hoá đơn ngay/));
    await screen.findByText("Đã xuất hoá đơn");
    expect(h.xuat).toHaveBeenCalledWith("don1", "DAU-VAN-1");
    const hop = screen.getByRole("dialog");
    expect(hop.textContent).toContain("3,4 giây".replace(",", ".")); // 3.4 giây theo toFixed
    expect(hop.textContent).toMatch(/Đã gửi hoá đơn tới email phụ huynh/);
    expect(toast.success).toHaveBeenCalled();
  });
  it("thư chưa gửi ngay (`guiNgay=false`) ⇒ nói thật «xếp hàng, đi ở nhịp kế tiếp», không khẳng định đã gửi", async () => {
    h.xem.mockResolvedValue(XT);
    h.xuat.mockResolvedValue({ ok: true, daXuat: 1, dangPhatHanh: 0, guiNgay: false, mili: 800, ghiChu: [] });
    await mo();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(await nutSan(/Xuất hoá đơn ngay/));
    await screen.findByText("Đã xuất hoá đơn");
    const hop = screen.getByRole("dialog");
    expect(hop.textContent).toMatch(/xếp hàng gửi email/);
    expect(hop.textContent).not.toMatch(/Đã gửi hoá đơn tới email phụ huynh/);
  });
});

describe("[NXL-03] lỗi nói thật", () => {
  it("xem trước bị từ chối (khoản chưa xác nhận…) ⇒ hiện đúng lời, KHÔNG có nút xuất; «Thử lại» gọi xem trước lại", async () => {
    h.xem.mockResolvedValue({ ok: false, error: "Chưa xuất liền được: Còn khoản chưa được kế toán xác nhận" });
    await mo();
    const loi = await screen.findByRole("alert");
    expect(loi.textContent).toContain("kế toán xác nhận");
    expect(screen.queryByRole("button", { name: /Xuất hoá đơn ngay/ })).toBeNull();
    fireEvent.click(await nutSan(/Thử lại/));
    await waitFor(() => expect(h.xem).toHaveBeenCalledTimes(2));
  });
  it("máy chủ báo dấu LỆCH (phụ huynh vừa gửi lại) ⇒ hiện lời, không báo thành công; Thử lại mở bản mới để đối chiếu lại", async () => {
    h.xem.mockResolvedValue(XT);
    h.xuat.mockResolvedValue({ ok: false, error: "Thông tin vừa thay đổi — mở lại hộp xác nhận để đối chiếu lại", ma: "DA_DOI" });
    await mo();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(await nutSan(/Xuất hoá đơn ngay/));
    expect((await screen.findByRole("alert")).textContent).toContain("vừa thay đổi");
    expect(screen.queryByText("Đã xuất hoá đơn")).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.click(await nutSan(/Thử lại/));
    await waitFor(() => expect(h.xem).toHaveBeenCalledTimes(2));
  });
  it("«Quay lại sửa» đóng hộp, KHÔNG xuất", async () => {
    h.xem.mockResolvedValue(XT);
    await mo();
    fireEvent.click(await nutSan(/Quay lại sửa/));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.xuat).not.toHaveBeenCalled();
  });
});
