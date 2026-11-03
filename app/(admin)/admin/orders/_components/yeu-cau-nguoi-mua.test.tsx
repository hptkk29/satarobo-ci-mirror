// @vitest-environment jsdom
/**
 * Ca [YCN-UI-*] — khối «Thông tin người mua qua mã QR» (Invoice Hub S11) trên phần tử THẬT.
 * Canh: mỗi trạng thái nói đúng việc người dùng làm được; nút «Áp dụng» chỉ sáng khi đủ thông tin (luật 12: không hứa suông); mã QR chỉ có ngay sau khi tạo;
 * lỗi «đơn đã được sửa» hiện nút ghi đè; nguồn của từng ô được nói ra.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ tao: vi.fn(), capLai: vi.fn(), huy: vi.fn(), apDung: vi.fn() }));
vi.mock("../_actions-nguoi-mua", () => ({
  taoYeuCauNguoiMuaAction: h.tao,
  capLaiYeuCauNguoiMuaAction: h.capLai,
  huyYeuCauNguoiMuaAction: h.huy,
  apDungYeuCauNguoiMuaAction: h.apDung,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import type { KhoiYeuCauNguoiMua } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-doc-db";
import { YeuCauNguoiMua } from "./yeu-cau-nguoi-mua";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const KHOI: KhoiYeuCauNguoiMua = {
  id: "yc1",
  trangThai: "DANG_MO",
  hetHanLuc: "2026-11-02T07:00:00.000Z",
  linkHetHan: false,
  guiLuc: null,
  soLanMo: 0,
  dangKhoa: false,
  o: {},
  duDay: false,
  thieu: ["loai", "ten", "cccd", "diaChi"],
  sai: [],
};
const DAY_DU: KhoiYeuCauNguoiMua = {
  ...KHOI,
  guiLuc: "2026-11-02T03:30:00.000Z",
  o: {
    loai: { giaTri: "CA_NHAN", nguon: "PHU_HUYNH" },
    ten: { giaTri: "Nguyễn Thị Phụ Huynh", nguon: "PHU_HUYNH" },
    cccd: { giaTri: "048123456789", nguon: "PHU_HUYNH" },
    diaChi: { giaTri: "114 Hoàng Diệu, Đà Nẵng", nguon: "SALE_NHAP_THAY" },
  },
  duDay: true,
  thieu: [],
};
const ve = (khoi: KhoiYeuCauNguoiMua | null, onNhapThay?: () => void) => render(<YeuCauNguoiMua orderId="don1" khoi={khoi} onNhapThay={onNhapThay} />);

describe("[YCN-UI-01] chưa có yêu cầu", () => {
  it("nói thẳng «chưa tạo mã», có đúng một nút tạo; KHÔNG có nút Áp dụng / Cấp lại / Thu hồi", () => {
    ve(null);
    expect(screen.getByText(/Chưa tạo mã/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tạo mã QR cho phụ huynh" })).toBeTruthy();
    for (const n of [/Áp dụng/, /Cấp lại/, /Thu hồi/, /Nhập thay/]) expect(screen.queryByRole("button", { name: n })).toBeNull();
  });

  it("tạo thành công ⇒ hiện ảnh QR + liên kết + lời cảnh báo «chỉ hiện lần này»; tạo lỗi ⇒ báo lỗi, không hiện QR", async () => {
    h.tao.mockResolvedValueOnce({ ok: false, error: "Đơn đã có yêu cầu đang mở." });
    ve(null);
    fireEvent.click(screen.getByRole("button", { name: "Tạo mã QR cho phụ huynh" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Đơn đã có yêu cầu đang mở."));
    expect(screen.queryByRole("img")).toBeNull();
    h.tao.mockResolvedValueOnce({ ok: true, id: "yc2", lienKet: "https://test.satarobo.vn/thong-tin-hoa-don/yc2.TOKEN", qr: "data:image/svg+xml;base64,AAA", hetHanLuc: "2026-11-02T07:00:00.000Z" });
    fireEvent.click(screen.getByRole("button", { name: "Tạo mã QR cho phụ huynh" }));
    await waitFor(() => expect(screen.getByRole("img", { name: /Mã QR/ })).toBeTruthy());
    expect(screen.getByText(/chỉ hiện lần này/)).toBeTruthy();
  });

  it("[YCN-UI-01b] liên kết KHÔNG in ra màn (không ô nhập, không chuỗi URL) — chỉ có nút «Sao chép liên kết», bấm thì chép ĐÚNG liên kết", async () => {
    const LK = "https://test.satarobo.vn/thong-tin-hoa-don/yc2.TOKENBIMAT";
    h.tao.mockResolvedValueOnce({ ok: true, id: "yc2", lienKet: LK, qr: "data:image/svg+xml;base64,AAA", hetHanLuc: "2026-11-02T07:00:00.000Z" });
    const viet = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: viet }, configurable: true });
    const { container } = ve(null);
    fireEvent.click(screen.getByRole("button", { name: "Tạo mã QR cho phụ huynh" }));
    await waitFor(() => expect(screen.getByRole("img", { name: /Mã QR/ })).toBeTruthy());
    expect(container.textContent).not.toContain("TOKENBIMAT");
    expect(container.textContent).not.toContain("thong-tin-hoa-don");
    expect(screen.queryByLabelText("Liên kết gửi phụ huynh")).toBeNull();
    expect(container.querySelector("input[readonly]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sao chép liên kết/ }));
    await waitFor(() => expect(viet).toHaveBeenCalledWith(LK));
    expect(toast.success).toHaveBeenCalledWith("Đã sao chép liên kết");
  });

  it("[YCN-UI-01c] nút «Phóng to» mở hộp thoại ẢNH LỚN để phụ huynh quét; đóng được; mã vẫn còn sau khi đóng", async () => {
    h.tao.mockResolvedValueOnce({ ok: true, id: "yc2", lienKet: "https://test.satarobo.vn/x", qr: "data:image/svg+xml;base64,AAA", hetHanLuc: "2026-11-02T07:00:00.000Z" });
    ve(null);
    fireEvent.click(screen.getByRole("button", { name: "Tạo mã QR cho phụ huynh" }));
    await waitFor(() => expect(screen.getByRole("img", { name: /Mã QR để phụ huynh mở/ })).toBeTruthy());
    expect(screen.queryByRole("dialog")).toBeNull(); // chưa phóng to ⇒ chưa có hộp thoại
    fireEvent.click(screen.getByRole("button", { name: /Phóng to/ }));
    const hop = await screen.findByRole("dialog");
    expect(hop.textContent).toMatch(/Đưa mã này cho phụ huynh quét/);
    const anhLon = screen.getByRole("img", { name: /phóng to/ });
    expect(anhLon.getAttribute("src")).toBe("data:image/svg+xml;base64,AAA"); // CÙNG ảnh, không dựng lại mã
    expect(anhLon.className).toMatch(/aspect-square/);
    expect(anhLon.className).toMatch(/bg-white/); // nền trắng — mã QR trên nền tối/trong suốt khó quét
    fireEvent.keyDown(hop, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("img", { name: /Mã QR để phụ huynh mở/ })).toBeTruthy();
  });
});

describe("[YCN-UI-02] đang mở", () => {
  it("chưa đủ thông tin: nút «Áp dụng vào đơn» KHOÁ và lý do được nói (kèm tên ô thiếu); đối chứng: đủ thì sáng", () => {
    const { unmount } = ve(KHOI);
    expect((screen.getByRole("button", { name: "Áp dụng vào đơn" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/Chưa đủ.*Loại người mua.*Họ và tên ba\/mẹ.*Số CCCD ba\/mẹ.*Địa chỉ/);
    expect(screen.getByText("Đang chờ phụ huynh")).toBeTruthy();
    unmount();
    ve(DAY_DU);
    expect((screen.getByRole("button", { name: "Áp dụng vào đơn" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Phụ huynh đã gửi")).toBeTruthy();
  });

  it("mỗi ô nói NGUỒN (phụ huynh nhập / nhân viên nhập thay) và loại hiển thị bằng chữ, không bằng mã", () => {
    ve(DAY_DU);
    expect(screen.getAllByText("Phụ huynh nhập").length).toBeGreaterThan(0);
    expect(screen.getByText("Nhân viên nhập thay")).toBeTruthy();
    expect(screen.getByText("Cá nhân")).toBeTruthy();
    expect(screen.queryByText("CA_NHAN")).toBeNull();
  });

  it("mã hết hạn được nói ra nhưng nhân viên VẪN nhập thay / cấp lại được", () => {
    ve({ ...KHOI, linkHetHan: true });
    expect(screen.getByText("Mã đã hết hạn")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cấp lại mã" }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    ve({ ...KHOI, linkHetHan: true }, vi.fn());
    expect((screen.getByRole("button", { name: "Nhập thay phụ huynh" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("mã đang bị khoá ⇒ có câu nói rõ; không khoá thì không có", () => {
    const { unmount } = ve({ ...KHOI, dangKhoa: true });
    expect(screen.getByText(/tạm khoá/)).toBeTruthy();
    unmount();
    ve(KHOI);
    expect(screen.queryByText(/tạm khoá/)).toBeNull();
  });

  it("đơn đã được sửa ⇒ hiện lời cảnh báo + nút «Ghi đè và áp dụng»; bấm thì gọi action với ghiDe=true", async () => {
    h.apDung.mockResolvedValueOnce({ ok: false, ma: "DON_DA_DOI", error: "Đơn đã được sửa (invoiceEmail)." });
    ve(DAY_DU);
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng vào đơn" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("invoiceEmail"));
    expect(h.apDung).toHaveBeenLastCalledWith("don1", "yc1", false);
    h.apDung.mockResolvedValueOnce({ ok: true, hoaDonConHieuLuc: [] });
    fireEvent.click(screen.getByRole("button", { name: "Ghi đè và áp dụng" }));
    await waitFor(() => expect(h.apDung).toHaveBeenLastCalledWith("don1", "yc1", true));
  });

  it("áp dụng khi đơn đã có hoá đơn ⇒ cảnh báo «hoá đơn đó không tự đổi»", async () => {
    h.apDung.mockResolvedValueOnce({ ok: true, hoaDonConHieuLuc: [{ id: "hd1", trangThai: "DA_XAC_NHAN", so: "1C26TSR-127" }] });
    ve(DAY_DU);
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng vào đơn" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(String(toast.warning.mock.calls[0]![0])).toMatch(/KHÔNG tự đổi/);
  });
});

describe("[YCN-UI-03] nhập thay phụ huynh = mở hộp thoại «Người mua trên hoá đơn» (không còn biểu mẫu thu nhỏ riêng)", () => {
  it("có `onNhapThay` ⇒ nút «Nhập thay phụ huynh» sáng, bấm gọi ĐÚNG hàm mở hộp thoại một lần; KHÔNG có ô nhập nào ngay trong khối này", () => {
    const mo = vi.fn();
    const { container } = ve(KHOI, mo);
    fireEvent.click(screen.getByRole("button", { name: "Nhập thay phụ huynh" }));
    expect(mo).toHaveBeenCalledTimes(1);
    expect(container.querySelector("input,select,textarea")).toBeNull(); // biểu mẫu thu nhỏ cũ ĐÃ GỠ
    expect(screen.queryByLabelText("Loại người mua")).toBeNull();
  });
  it("KHÔNG có `onNhapThay` (người xem không mở được hộp thoại) ⇒ KHÔNG vẽ nút (luật 12) và nói lý do bằng chữ; đối chứng ở ca trên", () => {
    ve(KHOI);
    expect(screen.queryByRole("button", { name: "Nhập thay phụ huynh" })).toBeNull();
    expect(screen.getByText(/Nhập thay phụ huynh cần quyền sửa đơn và quyền xem thông tin khách/)).toBeTruthy();
  });
});

describe("[YCN-UI-05] hiển thị theo LOẠI người mua + ô nhạy cảm", () => {
  const CA_NHAN_DAY: KhoiYeuCauNguoiMua = {
    ...DAY_DU,
    o: {
      ...DAY_DU.o,
      sdt: { giaTri: "090xxxx456", nguon: "PHU_HUYNH" },
      tenHocVien: { giaTri: "Nguyễn Văn Bé", nguon: "PHU_HUYNH" },
      ngaySinhHocVien: { giaTri: "••/••/••••", nguon: "PHU_HUYNH" },
      cccdHocVien: { giaTri: "048xxxxx321", nguon: "PHU_HUYNH" },
    },
  };
  it("cá nhân: hiện họ tên ba/mẹ · CCCD · SĐT · địa chỉ · khối học viên; KHÔNG hiện «Mã số thuế»; ô bắt buộc thiếu ghi «Chưa có», ô tuỳ chọn thiếu ghi «—»", () => {
    ve(KHOI); // chưa có ô nào
    for (const nhan of ["Họ và tên ba/mẹ", "Số CCCD ba/mẹ", "SĐT ba/mẹ", "Họ và tên học viên", "Ngày sinh học viên", "Số CCCD học viên"]) expect(screen.getByText(nhan), nhan).toBeTruthy();
    expect(screen.queryByText("Mã số thuế")).toBeNull();
    expect(screen.queryByText("Tên doanh nghiệp")).toBeNull();
    const dd = (nhan: string) => screen.getByText(nhan).closest("div")!.querySelector("dd")!.textContent;
    expect(dd("Số CCCD ba/mẹ")).toBe("Chưa có"); // BẮT BUỘC
    expect(dd("SĐT ba/mẹ")).toBe("—"); // tuỳ chọn
    expect(dd("Số CCCD học viên")).toBe("—");
  });
  it("doanh nghiệp: hiện tên doanh nghiệp · MST · địa chỉ · email; KHÔNG hiện ô của cá nhân (CCCD, SĐT, học viên); email BẮT BUỘC nên thiếu ghi «Chưa có»", () => {
    ve({ ...KHOI, o: { loai: { giaTri: "DOANH_NGHIEP", nguon: "PHU_HUYNH" }, ten: { giaTri: "Công ty TNHH Sata", nguon: "PHU_HUYNH" } }, thieu: ["maSoThue", "diaChi", "email"] });
    for (const nhan of ["Tên doanh nghiệp", "Mã số thuế", "Địa chỉ", "Email nhận hoá đơn"]) expect(screen.getByText(nhan), nhan).toBeTruthy();
    for (const an of ["Số CCCD ba/mẹ", "SĐT ba/mẹ", "Họ và tên học viên", "Ngày sinh học viên", "Số CCCD học viên"]) expect(screen.queryByText(an), an).toBeNull();
    expect(screen.getByText("Email nhận hoá đơn").closest("div")!.querySelector("dd")!.textContent).toBe("Chưa có");
    expect(screen.getByRole("status").textContent).toMatch(/còn thiếu: Mã số thuế, Địa chỉ, Email nhận hoá đơn/);
  });
  it("giá trị ĐÃ CHE từ máy chủ (người thiếu quyền xem PII) được in NGUYÊN VĂN — giao diện không tự «giải che», không đoán lại", () => {
    ve(CA_NHAN_DAY);
    expect(screen.getByText("090xxxx456")).toBeTruthy();
    expect(screen.getByText("••/••/••••")).toBeTruthy();
    expect(screen.getByText("048xxxxx321")).toBeTruthy();
  });
});

describe("[YCN-UI-04] trạng thái cuối", () => {
  it.each([
    ["DA_AP_DUNG", "Đã áp dụng"],
    ["THU_HOI", "Đã thu hồi"],
    ["HET_HAN", "Đã hết hạn"],
  ] as const)("%s ⇒ nhãn «%s», chỉ còn nút «Tạo mã mới», không nút xử lý", (trangThai, nhan) => {
    ve({ ...KHOI, trangThai });
    expect(screen.getByText(nhan)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tạo mã mới" })).toBeTruthy();
    for (const n of [/Áp dụng vào đơn/, /Cấp lại/, /Thu hồi$/, /Nhập thay/]) expect(screen.queryByRole("button", { name: n })).toBeNull();
  });
});
