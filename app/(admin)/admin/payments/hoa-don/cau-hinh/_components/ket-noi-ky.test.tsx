// @vitest-environment jsdom
// Ca [KNK-*] — màn «Kết nối & ký»: mật khẩu chỉ đi VÀO (không bao giờ hiện lại), khoá mã hoá thiếu ⇒ khoá ô mật khẩu có lý do, lỗi nhập hiện rõ.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  luu: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: { id: "kn1", doiMatKhau: true } })),
  kiemTra: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: { ma: "OK" } })),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("../_ket-noi-actions", () => ({ luuKetNoiAction: h.luu, kiemTraKetNoiAction: h.kiemTra }));

import { KetNoiKy, type TheKetNoi } from "./ket-noi-ky";

const KET_NOI = {
  id: "kn1",
  phapNhanMa: "NEW_VISION",
  moiTruong: "SANDBOX",
  nhaCungCapMa: "VIN_HOADON",
  dangBat: true,
  baseUrl: "https://demows.vin-hoadon.com",
  mst: "0402341070",
  tenDangNhap: "ketoan",
  coMatKhau: true,
  matKhauCapNhatLuc: "2026-11-04T03:00:00.000Z",
  phuongThucKy: "USB_TOKEN",
  cheDoKy: "LO",
  chungThuSerial: "5400FA1B2C3D",
  chungThuThumbprint: null,
  chungThuChuTheMst: null,
  chungThuNhaPhatHanh: null,
  chungThuHetHan: "2026-11-20",
  misaAppId: null,
  misaLoaiHoaDon: null,
  kiemTraLuc: "2026-11-04T03:05:00.000Z",
  kiemTraKetQua: "OK",
  capNhatBoiId: "u1",
  capNhatLuc: "2026-11-04T03:00:00.000Z",
};
const THE: TheKetNoi[] = [
  {
    phapNhanMa: "NEW_VISION",
    ten: "NEW VISION",
    maSoThue: "0402341070",
    nhaCungCapMa: "VIN_HOADON",
    tenNhaCungCap: "VIN-HOADON",
    trangThai: { nhan: "Đang dùng kết nối đã khai", muc: "success", chiTiet: "ký bằng USB token; ký cả lô." },
    ketNoi: KET_NOI,
    canhBaoChungThu: { muc: "warning", cau: "Chứng thư số còn 16 ngày — gia hạn sớm để không gián đoạn ký." },
    ketQuaKiemTra: { cau: "Đăng nhập được VIN-HOADON", muc: "success" },
  },
  {
    phapNhanMa: "SATA_ROBO",
    ten: "SATA ROBO",
    maSoThue: "0402301783",
    nhaCungCapMa: "MISA_MEINVOICE",
    tenNhaCungCap: "MISA",
    trangThai: { nhan: "Đang dùng cấu hình trên máy chủ", muc: "info", chiTiet: "Chưa khai ở màn này." },
    ketNoi: null,
    canhBaoChungThu: null,
    ketQuaKiemTra: { cau: "Chưa kiểm tra", muc: "muted" },
  },
  {
    phapNhanMa: "KHONG_PHAN_MEM",
    ten: "PHÁP NHÂN CHƯA KHAI PHẦN MỀM",
    maSoThue: "0301234567",
    nhaCungCapMa: null,
    tenNhaCungCap: null,
    trangThai: { nhan: "Chưa dùng được", muc: "danger", chiTiet: "Pháp nhân chưa khai phần mềm phát hành." },
    ketNoi: null,
    canhBaoChungThu: null,
    ketQuaKiemTra: { cau: "Chưa kiểm tra", muc: "muted" },
  },
];

const ve = (o: { khoaOk?: boolean; duocSua?: boolean } = {}) =>
  render(<KetNoiKy the={THE} moiTruong="SANDBOX" khoaOk={o.khoaOk ?? true} lyDoThieuKhoa={o.khoaOk === false ? "Máy chủ chưa đặt khoá mã hoá bí mật (HOA_DON_KHOA_BI_MAT)." : null} lichSu={[]} duocSua={o.duocSua ?? true} />);
const the = (ten: string) => screen.getByRole("region", { name: ten });
/** Nút THAO TÁC của một vùng — không tính nút «?» trợ giúp (aria-label bắt đầu «Xem hướng dẫn»): người chỉ xem vẫn được đọc hướng dẫn. */
const nutThaoTac = (vung: HTMLElement) => Array.from(vung.querySelectorAll("button")).filter((b) => !/^Xem hướng dẫn/.test(b.getAttribute("aria-label") ?? ""));
const nut = (ten: string, ten2: RegExp) => Array.from(the(ten).querySelectorAll("button")).find((b) => ten2.test(b.textContent ?? ""))!;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("[KNK] hiển thị", () => {
  it("[KNK-01] mỗi pháp nhân một thẻ; trạng thái, cách ký, chế độ, tài khoản, chứng thư và kết quả kiểm tra hiện đúng; KHÔNG có giá trị mật khẩu nào trong DOM", () => {
    const { container } = ve();
    expect(screen.getAllByRole("region")).toHaveLength(3);
    const vin = the("NEW VISION");
    expect(vin.textContent).toContain("Đang dùng kết nối đã khai");
    expect(vin.textContent).toContain("USB token");
    expect(vin.textContent).toContain("Ký cả lô");
    expect(vin.textContent).toContain("ketoan");
    expect(vin.textContent).toContain("serial 5400FA1B2C3D");
    expect(vin.textContent).toContain("gia hạn sớm");
    expect(vin.textContent).toContain("Đăng nhập được VIN-HOADON");
    expect(vin.textContent).toMatch(/Mật khẩu:\s*đã đặt lúc/);
    expect(container.innerHTML).not.toMatch(/value="[^"]*mat-khau/i);
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0); // ô mật khẩu chỉ có khi mở form
  });

  // [ĐẢO 05/11/2026] Trước đây pháp nhân chưa khai phần mềm trong mã thì KHÔNG có nút. Nay nhà cung cấp do Quản trị tối cao chọn ngay trên form, nên mọi pháp nhân đều có nút.
  it("[KNK-02] ĐÃ ĐẢO: pháp nhân chưa khai phần mềm ⇒ nói rõ «chưa khai phần mềm» nhưng CÓ nút «Khai kết nối» cho Quản trị tối cao; không có nút cho người chỉ xem", () => {
    ve();
    const t = the("PHÁP NHÂN CHƯA KHAI PHẦN MỀM");
    expect(t.textContent).toContain("chưa khai phần mềm phát hành");
    expect(within(t).getByRole("button", { name: /Khai kết nối/ })).toBeTruthy();
    cleanup();
    ve({ duocSua: false });
    expect(nutThaoTac(the("PHÁP NHÂN CHƯA KHAI PHẦN MỀM"))).toHaveLength(0);
  });

  it("[KNK-03] thiếu khoá mã hoá ⇒ banner đỏ có lý do và ô mật khẩu bị khoá (đối chứng dương: có khoá thì ô mở)", () => {
    ve({ khoaOk: false });
    expect(screen.getByRole("alert").textContent).toContain("HOA_DON_KHOA_BI_MAT");
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    expect((screen.getByLabelText("Mật khẩu VIN") as HTMLInputElement).disabled).toBe(true);
    cleanup();
    ve({ khoaOk: true });
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    expect((screen.getByLabelText("Mật khẩu VIN") as HTMLInputElement).disabled).toBe(false);
  });
});

describe("[KNK] quyền thay đổi (BGĐ 04/11/2026)", () => {
  it("[KNK-20] người KHÔNG phải Quản trị tối cao: thấy cấu hình + lời giải thích, KHÔNG có nút Khai/Sửa/Kiểm tra nào (nút chắc chắn bị máy chủ từ chối là lời hứa suông)", () => {
    ve({ duocSua: false });
    expect(screen.getByText(/Bạn đang/).textContent).toContain("Quản trị tối cao");
    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect(nutThaoTac(document.body)).toHaveLength(0);
    expect(the("NEW VISION").textContent).toContain("serial 5400FA1B2C3D"); // vẫn XEM được
  });
  it("[KNK-21] ĐỐI CHỨNG DƯƠNG: Quản trị tối cao thấy nút Sửa kết nối", () => {
    ve({ duocSua: true });
    expect(nut("NEW VISION", /Sửa kết nối/)).toBeTruthy();
    expect(screen.queryByText(/Bạn đang/)).toBeNull();
  });
  it("[KNK-22] MISA: form có AppID + loại hoá đơn + mật khẩu MISA; để trống cả khối = giữ biến môi trường (câu nói rõ)", () => {
    ve();
    fireEvent.click(nut("SATA ROBO", /Khai kết nối/));
    expect(screen.getByLabelText("AppID MISA")).toBeTruthy();
    expect(screen.getByLabelText("Loại hoá đơn MISA")).toBeTruthy();
    expect((screen.getByLabelText("Mật khẩu MISA") as HTMLInputElement).type).toBe("password");
    expect(the("SATA ROBO").textContent).toContain("biến môi trường");
  });
});

describe("[KNK] biểu mẫu", () => {
  it("[KNK-10] ô mật khẩu: type=password, autocomplete=new-password, LUÔN trống kể cả khi đã có mật khẩu (placeholder nói «giữ mật khẩu đang lưu»)", () => {
    ve();
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    const mk = screen.getByLabelText("Mật khẩu VIN") as HTMLInputElement;
    expect(mk.type).toBe("password");
    expect(mk.autocomplete).toBe("new-password");
    expect(mk.value).toBe("");
    expect(mk.placeholder).toMatch(/giữ mật khẩu đang lưu/);
  });

  it("[KNK-11] lưu thiếu lý do ⇒ báo lỗi ngay ở trình duyệt, KHÔNG gọi action; đủ lý do ⇒ gọi action đúng một lần với mật khẩu để trống = null", async () => {
    ve();
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Lý do/);
    expect(h.luu).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: "Gia hạn chứng thư số của token" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(h.luu.mock.calls[0]![0]).toMatchObject({ phapNhanMa: "NEW_VISION", moiTruong: "SANDBOX", nhaCungCapMa: "VIN_HOADON", matKhauMoi: null, phuongThucKy: "USB_TOKEN" });
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(h.refresh).toHaveBeenCalled();
  });

  it("[KNK-12] đổi địa chỉ mà không nhập lại mật khẩu ⇒ chặn ở trình duyệt? — KHÔNG: luật «nhập lại mật khẩu» là của MÁY CHỦ; lỗi máy chủ hiện nguyên văn, form giữ nguyên để sửa", async () => {
    h.luu.mockResolvedValueOnce({ ok: false, error: "Đổi địa chỉ, MST hoặc tên đăng nhập thì phải nhập lại mật khẩu — mật khẩu cũ không được dùng cho nơi khác." });
    ve();
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    fireEvent.change(screen.getByLabelText(/Địa chỉ máy chủ VIN/), { target: { value: "https://may-khac.example.test" } });
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: "Đổi máy chủ VIN theo thông báo" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/nhập lại mật khẩu/));
    expect(screen.getByLabelText(/Địa chỉ máy chủ VIN/)).toBeTruthy(); // form còn mở
  });

  it("[KNK-13] MISA: không có ô địa chỉ/MST/tài khoản/mật khẩu, USB bị khoá; chọn chế độ ký chỉ hiện với USB; chế độ nền (NEN) KHÔNG có trong danh sách", () => {
    ve();
    fireEvent.click(nut("SATA ROBO", /Khai kết nối/));
    expect(screen.queryByLabelText("Mật khẩu VIN")).toBeNull();
    expect(screen.queryByLabelText(/Địa chỉ máy chủ VIN/)).toBeNull();
    const usb = Array.from(screen.getByLabelText("Cách ký").querySelectorAll("option")).find((o) => /USB/.test(o.textContent ?? ""))!;
    expect((usb as HTMLOptionElement).disabled).toBe(true);
    cleanup();
    ve();
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    const cd = Array.from(screen.getByLabelText("Chế độ ký").querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(cd).toEqual(["TUNG_LENH", "LO"]);
    fireEvent.change(screen.getByLabelText("Cách ký"), { target: { value: "HSM_NHA_CUNG_CAP" } });
    expect(screen.queryByLabelText("Chế độ ký")).toBeNull();
  });

  it("[KNK-14] «Kiểm tra kết nối» chỉ có ở thẻ VIN đã khai; bấm ⇒ gọi action đúng pháp nhân; kết quả xấu hiện lỗi", async () => {
    ve();
    expect(nut("SATA ROBO", /Kiểm tra/)).toBeUndefined();
    fireEvent.click(nut("NEW VISION", /Kiểm tra kết nối/));
    await waitFor(() => expect(h.kiemTra).toHaveBeenCalledWith({ phapNhanMa: "NEW_VISION" }));
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    // Nút đổi nhãn «Đang kiểm tra…» và khoá cho tới khi lượt chuyển tiếp (action + làm mới trang) xong: bấm lần hai NGAY lúc `success` vừa gọi thì trên máy chậm (CI gương) nút chưa quay lại ⇒ `nut()` trả undefined.
    await waitFor(() => expect(nut("NEW VISION", /Kiểm tra kết nối/)).toBeDefined());
    h.kiemTra.mockResolvedValueOnce({ ok: true, data: { ma: "DANG_NHAP_SAI" } });
    fireEvent.click(nut("NEW VISION", /Kiểm tra kết nối/));
    await waitFor(() => expect(h.error).toHaveBeenCalled());
  });

  it("[KNK-15] Huỷ đóng form và xoá mật khẩu đã gõ khỏi trạng thái (mở lại ⇒ ô trống)", () => {
    ve();
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    fireEvent.change(screen.getByLabelText("Mật khẩu VIN"), { target: { value: "mat-khau-dang-go" } });
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.queryByLabelText("Mật khẩu VIN")).toBeNull();
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    expect((screen.getByLabelText("Mật khẩu VIN") as HTMLInputElement).value).toBe("");
  });
});

describe("[KNK] chọn nhà cung cấp của pháp nhân (05/11/2026)", () => {
  it("[KNK-30] form có ô «Nhà cung cấp hoá đơn» với CẢ HAI lựa chọn, nhà cung cấp đang dùng được đánh dấu; chưa đổi thì KHÔNG có cảnh báo đổi", () => {
    ve();
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    const o = screen.getByLabelText("Nhà cung cấp hoá đơn") as HTMLSelectElement;
    expect(Array.from(o.options).map((x) => x.textContent)).toEqual(["MISA", "VIN-HOADON (đang dùng)"]);
    expect(o.value).toBe("VIN_HOADON");
    expect(screen.queryByText(/Đổi từ/)).toBeNull();
  });

  it("[KNK-31] đổi VIN → MISA: cảnh báo nói đủ điều kiện, ô của nhà cung cấp cũ bị XOÁ (không mang sang), form chuyển sang ô MISA, USB (MISA chưa hỗ trợ) tự về HSM", () => {
    ve();
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    fireEvent.change(screen.getByLabelText(/Địa chỉ máy chủ VIN/), { target: { value: "https://vin-cu.example.test" } });
    fireEvent.change(screen.getByLabelText("Nhà cung cấp hoá đơn"), { target: { value: "MISA_MEINVOICE" } });
    const canhBao = screen.getByText(/Đổi từ VIN-HOADON sang MISA/).closest("[role=alert]") as HTMLElement;
    expect(canhBao.textContent).toMatch(/tạm dừng ký/);
    expect(canhBao.textContent).toMatch(/xoá/);
    expect(screen.getByLabelText("AppID MISA")).toBeTruthy();
    expect(screen.queryByLabelText("Mật khẩu VIN")).toBeNull();
    expect((screen.getByLabelText("Địa chỉ API MISA (https, kết thúc /api/v3)") as HTMLInputElement).value).toBe(""); // địa chỉ VIN vừa gõ KHÔNG sang MISA
    expect((screen.getByLabelText("Tên đăng nhập") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Cách ký") as HTMLSelectElement).value).toBe("HSM_NHA_CUNG_CAP");
  });

  it("[KNK-32] lưu sau khi đổi ⇒ action nhận nhà cung cấp MỚI, không mang địa chỉ / tài khoản cũ, mật khẩu null; thông báo nhắc bật lại ký", async () => {
    ve();
    fireEvent.click(nut("NEW VISION", /Sửa kết nối/));
    fireEvent.change(screen.getByLabelText("Nhà cung cấp hoá đơn"), { target: { value: "MISA_MEINVOICE" } });
    // Tắt kết nối ⇒ lưu dở được (chưa khai tài khoản MISA); khai đủ khi BẬT là luật của `kiemKetNoi` (đã có ca riêng).
    fireEvent.click(screen.getByLabelText(/Bật kết nối này/));
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: "Chuyển pháp nhân sang MISA theo quyết định" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(h.luu.mock.calls[0]![0]).toMatchObject({ phapNhanMa: "NEW_VISION", nhaCungCapMa: "MISA_MEINVOICE", baseUrl: null, tenDangNhap: null, matKhauMoi: null, phuongThucKy: "HSM_NHA_CUNG_CAP" });
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(String(h.success.mock.calls[0]![0])).toMatch(/MISA.*bật lại ký/);
  });

  it("[KNK-33] chiều ngược: pháp nhân mặc định MISA đổi sang VIN ⇒ form VIN (địa chỉ máy chủ VIN, mật khẩu VIN), còn ô AppID MISA biến mất; luật khai đủ do máy chủ + `kiemKetNoi` giữ", async () => {
    ve();
    fireEvent.click(nut("SATA ROBO", /Khai kết nối/));
    expect(screen.getByLabelText("AppID MISA")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Nhà cung cấp hoá đơn"), { target: { value: "VIN_HOADON" } });
    expect(screen.queryByLabelText("AppID MISA")).toBeNull();
    expect(screen.getByLabelText("Mật khẩu VIN")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: "HO chuyển sang VIN-HOADON theo quyết định" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    // bật kết nối mà thiếu địa chỉ VIN ⇒ chặn ngay ở trình duyệt, KHÔNG gọi action
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" | ")).toMatch(/Thiếu địa chỉ máy chủ VIN/);
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("[KNK-34] người CHỈ XEM không có ô chọn nhà cung cấp (không vẽ nút khai/sửa)", () => {
    ve({ duocSua: false });
    expect(screen.queryByLabelText("Nhà cung cấp hoá đơn")).toBeNull();
    expect(nutThaoTac(the("NEW VISION"))).toHaveLength(0);
  });
});
