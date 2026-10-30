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

// L1 (UAT TEST 25/10/2026): đơn vị đang gắn pháp nhân đã NGỪNG ⇒ ô chọn từng hiển thị "(Gỡ)" trong khi state vẫn mang id cũ ⇒ Lưu bị từ chối
// với câu "đang ngừng hoạt động" dù người dùng thấy mình chọn Gỡ. Bộ ca dưới khoá: ô chọn khớp state ở MỌI trạng thái, mở form không tự đổi gì,
// pháp nhân hết hạn hiện RÕ (khoá, nói vì sao), Gỡ gửi null, chưa đổi gì thì không Lưu được.
describe("[PNU-L1] form 'Đổi pháp nhân' — ô chọn khớp state ở mọi trạng thái", () => {
  const TD = { donVi: 0, hoaDon: 0, cauHinhHoaDon: 0 };
  const PN2: DongPhapNhanUi[] = [
    { id: "goc", taxCode: "0402301783", legalName: "SATA ROBO", address: null, isPrimary: true, isActive: true, daXoa: false, tacDong: { donVi: 1, hoaDon: 0, cauHinhHoaDon: 0 } },
    { id: "nv", taxCode: "0402341070", legalName: "NEW VISION", address: null, isPrimary: false, isActive: true, daXoa: false, tacDong: TD },
    { id: "ngung", taxCode: "0402349999", legalName: "CÔNG TY NGỪNG", address: null, isPrimary: false, isActive: false, daXoa: false, tacDong: { donVi: 1, hoaDon: 0, cauHinhHoaDon: 0 } },
    { id: "cu", taxCode: "0402340000", legalName: "CÔNG TY ĐÃ XOÁ", address: null, isPrimary: false, isActive: false, daXoa: true, tacDong: { donVi: 1, hoaDon: 0, cauHinhHoaDon: 0 } },
  ];
  const DV2: DonViUi[] = [
    { id: "u-act", code: "DVA", name: "Đơn vị hoạt động", type: "CENTER", legalEntityId: "goc" },
    { id: "u-ngung", code: "DVN", name: "Đơn vị ngừng", type: "CENTER", legalEntityId: "ngung" },
    { id: "u-xoa", code: "DVX", name: "Đơn vị xoá", type: "CENTER", legalEntityId: "cu" },
    { id: "u-la", code: "DVL", name: "Đơn vị lạ", type: "CENTER", legalEntityId: "khong-co-trong-danh-sach" },
    { id: "u-trong", code: "DVT", name: "Đơn vị trống", type: "CENTER", legalEntityId: null },
  ];
  const ve2 = () => render(<QuanLyPhapNhan danhSach={PN2} donVi={DV2} lichSu={[]} />);
  const moForm = (tenDonVi: string) => {
    fireEvent.click(within(hang(tenDonVi)).getByRole("button", { name: "Đổi" }));
    return screen.getByLabelText("Pháp nhân") as HTMLSelectElement;
  };
  const nutLuu = () => screen.getAllByRole("button", { name: "Lưu" })[0] as HTMLButtonElement;
  const nhapLyDo = () => fireEvent.change(screen.getByLabelText(/Lý do \(bắt buộc\)/), { target: { value: LY_DO } });
  const chonDuoc = (chon: HTMLSelectElement) => Array.from(chon.options).filter((o) => !o.disabled).map((o) => o.value);

  it("[PNU-10] CHƯA gắn: ô chọn = Gỡ; mở form không gọi server; chưa đổi gì thì không Lưu được; chọn pháp nhân ⇒ gửi đúng id", async () => {
    ve2();
    const chon = moForm("Đơn vị trống");
    expect(chon.value).toBe("");
    expect(screen.queryByRole("note")).toBeNull();
    expect(h.gan).not.toHaveBeenCalled();
    nhapLyDo();
    expect(nutLuu().disabled).toBe(true);
    expect(screen.getByText(/Chưa đổi gì/)).toBeTruthy();
    fireEvent.change(chon, { target: { value: "nv" } });
    expect(nutLuu().disabled).toBe(false);
    fireEvent.click(nutLuu());
    await waitFor(() => expect(h.gan).toHaveBeenCalledTimes(1));
    expect(h.gan.mock.calls[0]![0]).toEqual({ orgUnitId: "u-trong", legalEntityId: "nv", lyDo: LY_DO });
  });

  it("[PNU-11] ĐANG HOẠT ĐỘNG: ô chọn đúng pháp nhân đang gắn, không cảnh báo; nguyên giá trị ⇒ không Lưu; chọn 'Gỡ' ⇒ gửi null", async () => {
    ve2();
    const chon = moForm("Đơn vị hoạt động");
    expect(chon.value).toBe("goc");
    expect(screen.queryByRole("note")).toBeNull();
    expect(h.gan).not.toHaveBeenCalled();
    nhapLyDo();
    expect(nutLuu().disabled).toBe(true);
    fireEvent.change(chon, { target: { value: "" } });
    expect(nutLuu().disabled).toBe(false);
    fireEvent.click(nutLuu());
    await waitFor(() => expect(h.gan).toHaveBeenCalledTimes(1));
    expect(h.gan.mock.calls[0]![0]).toEqual({ orgUnitId: "u-act", legalEntityId: null, lyDo: LY_DO });
  });

  it("[PNU-12] ĐÃ NGỪNG: ô chọn HIỆN đúng pháp nhân đó (không rơi về 'Gỡ'), có ghi chú rõ, mở form không đổi gì; id cũ KHÔNG bao giờ được gửi; 'Gỡ' ⇒ null", async () => {
    ve2();
    const chon = moForm("Đơn vị ngừng");
    expect(chon.value).toBe("ngung"); // L1: trước bản vá ô này hiển thị "" trong khi state mang "ngung"
    const hienTai = chon.selectedOptions[0]!;
    expect(hienTai.textContent).toMatch(/CÔNG TY NGỪNG.*0402349999.*đã ngừng.*không còn hợp lệ/);
    expect(hienTai.disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toMatch(/đã ngừng.*không tự đổi gì/);
    expect(h.gan).not.toHaveBeenCalled();
    // Chỉ pháp nhân CÒN DÙNG ĐƯỢC mới chọn được — đúng tập server chấp nhận (gắn mới pháp nhân ngừng/đã xoá bị `LEGAL_INACTIVE`).
    expect(chonDuoc(chon)).toEqual(["", "goc", "nv"]);
    // Chưa đổi gì: có lý do cũng không Lưu được ⇒ id pháp nhân ngừng không thể bị gửi đi (đó chính là đường gây lỗi L1).
    nhapLyDo();
    expect(nutLuu().disabled).toBe(true);
    // Lớp phòng thủ thứ hai: gửi form bằng đường khác (Enter / submit thẳng) cũng không đưa id pháp nhân ngừng lên server.
    fireEvent.submit(chon.closest("form")!);
    expect(h.gan).not.toHaveBeenCalled();
    fireEvent.change(chon, { target: { value: "" } });
    expect(nutLuu().disabled).toBe(false);
    fireEvent.click(nutLuu());
    await waitFor(() => expect(h.gan).toHaveBeenCalledTimes(1));
    expect(h.gan.mock.calls[0]![0]).toEqual({ orgUnitId: "u-ngung", legalEntityId: null, lyDo: LY_DO });
  });

  it("[PNU-13] ĐÃ XOÁ / KHÔNG XÁC ĐỊNH: hiện rõ nhãn đúng, khoá chọn lại, gỡ được; đổi sang pháp nhân còn dùng được vẫn gửi đúng id", async () => {
    ve2();
    let chon = moForm("Đơn vị xoá");
    expect(chon.value).toBe("cu");
    expect(chon.selectedOptions[0]!.textContent).toMatch(/CÔNG TY ĐÃ XOÁ.*đã xoá.*không còn hợp lệ/);
    nhapLyDo();
    expect(nutLuu().disabled).toBe(true);
    fireEvent.change(chon, { target: { value: "nv" } });
    fireEvent.click(nutLuu());
    await waitFor(() => expect(h.gan).toHaveBeenCalledTimes(1));
    expect(h.gan.mock.calls[0]![0]).toEqual({ orgUnitId: "u-xoa", legalEntityId: "nv", lyDo: LY_DO });
    cleanup();
    h.gan.mockClear();
    ve2();
    chon = moForm("Đơn vị lạ");
    expect(chon.value).toBe("khong-co-trong-danh-sach");
    expect(chon.selectedOptions[0]!.textContent).toMatch(/Pháp nhân không xác định.*không còn hợp lệ/);
    expect(h.gan).not.toHaveBeenCalled();
  });

  it("[PNU-14] bảng 'Đơn vị đang gắn': pháp nhân hết hạn được đánh dấu NGAY ở bảng; pháp nhân hoạt động / chưa gắn thì không (đối chứng dương)", () => {
    ve2();
    expect(within(hang("Đơn vị ngừng")).getByText(/đã ngừng — không còn hợp lệ/)).toBeTruthy();
    expect(within(hang("Đơn vị xoá")).getByText(/đã xoá — không còn hợp lệ/)).toBeTruthy();
    expect(within(hang("Đơn vị lạ")).getByText(/không xác định được — không còn hợp lệ/)).toBeTruthy();
    expect(within(hang("Đơn vị hoạt động")).queryByText(/không còn hợp lệ/)).toBeNull();
    expect(within(hang("Đơn vị trống")).queryByText(/không còn hợp lệ/)).toBeNull();
  });
});
