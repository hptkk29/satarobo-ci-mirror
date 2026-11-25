// @vitest-environment jsdom
/**
 * Ca [PHM-UI-*] — lối "Phát hành qua MISA" trong ngăn lần thu (bước 1, 30/09/2026). Canh HÀNH VI trên phần
 * tử thật: nút vẽ theo `dong.phatHanhMisa` / `dong.misa` (đúng trường action đọc lại), xác nhận HAI bước bày
 * số tiền + môi trường + ký hiệu trước khi gửi, và gửi ĐÚNG số / môi trường đã bày. Mọi ca "không thấy" có
 * đối chứng dương (CLAUDE.md luật 11).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";
import type { KhoiMisa } from "@/lib/finance/hoa-don/nut-phat-hanh-misa";

const DAU_PH = "a".repeat(32);
const DAU_CON = "b".repeat(32);
const phuongAn = (chon: "PHU_HUYNH" | "CON", ten: string, dau: string, o: { email?: string | null } = {}) => ({
  chon,
  nguoiMua: { hoTen: ten, donVi: null, mst: null, diaChi: "1 Lê Duẩn, Đà Nẵng", cccd: null, email: o.email === undefined ? "an@example.com" : o.email, maKhachHang: null },
  dong: [{ stt: 1, ten: "Học phí khoá Sata4 (48 buổi)", soLuong: 1, donGia: 4_320_000, thanhTien: 4_320_000, thueSuat: 0 }],
  hinhThucThanhToan: "Chuyển khoản",
  tongThanhToan: 4_320_000,
  dau,
});
const XEM = (o: Record<string, unknown> = {}) => ({
  ok: true as const,
  data: {
    kyHieu: "1C26TSR",
    mstNguoiBan: "0402054690",
    ngayHoaDon: "2026-09-10",
    macDinh: "PHU_HUYNH" as const,
    phuHuynh: phuongAn("PHU_HUYNH", "Nguyễn Văn An", DAU_PH),
    con: { chon: "CON" as const, khongDuoc: "Con chưa có họ tên" },
    ...o,
  },
});
const h = vi.hoisted(() => ({
  xemTruoc: vi.fn(async (_i: unknown): Promise<unknown> => null),
  guiNhap: vi.fn(async (_i: unknown): Promise<unknown> => null),
  nhan: vi.fn(async (_i: unknown): Promise<unknown> => null),
  refresh: vi.fn(),
  phatHanh: vi.fn(async (_i: unknown) => ({ ok: true, data: { hoaDonId: "hd1", trangThai: "DA_XAC_NHAN", thongDiep: null } })),
  kiem: vi.fn(async (_i: unknown) => ({ ok: true, data: { hoaDonId: "hd1", trangThai: "DANG_PHAT_HANH", thongDiep: "chờ" } })),
  lai: vi.fn(async (_i: unknown) => ({ ok: true, data: { hoaDonId: "hd1", trangThai: "DA_XAC_NHAN", thongDiep: null } })),
  bo: vi.fn(async (_i: unknown) => ({ ok: true, data: { hoaDonId: "hd1" } })),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/payments/hoa-don",
  useRouter: () => ({ replace: vi.fn(), refresh: h.refresh, push: vi.fn() }),
}));
vi.mock("../_actions", () => ({
  kyTaiLenHoaDonAction: vi.fn(),
  xacMinhTepHoaDonAction: vi.fn(),
  luuHoaDonNhapAction: vi.fn(),
  khongXuatHoaDonAction: vi.fn(),
  goHoaDonAction: vi.fn(),
  huyHoaDonAction: vi.fn(),
  xacNhanHoaDonAction: vi.fn(),
  khongTrungHoaDonAction: vi.fn(),
  guiLaiEmailHoaDonAction: vi.fn(),
  xemTruocGanGhiDanhAction: vi.fn(),
  ganGhiDanhHoaDonAction: vi.fn(),
  goiYSoHoaDonAction: vi.fn(),
  phatHanhQuaMisaAction: h.phatHanh,
  xemTruocHoaDonAction: h.xemTruoc,
  guiNhapHoaDonVinAction: h.guiNhap,
  nhanNhapDaKyAction: h.nhan,
  kiemTraLaiPhatHanhAction: h.kiem,
  phatHanhLaiAction: h.lai,
  boPhatHanhLamTayAction: h.bo,
}));
vi.mock("./tai-tep-hoa-don", () => ({ taiTepHoaDon: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { NganLanThu } from "./ngan-lan-thu";

const dong = (o: Partial<DongHangCho> = {}): DongHangCho => ({
  key: "dot:a",
  ngan: "cho",
  nhan: "Chờ xuất",
  tone: "warning",
  orderId: "don-a",
  maDon: "ORD-A",
  tenKhach: "Nguyễn Văn An",
  sdt: null,
  coSo: { ma: "CS1", ten: "Cơ sở 1" },
  ngayThu: "2026-09-10",
  ngayThuLabel: "10/09/2026",
  ghiNhanLuc: "2026-09-10T03:00:00.000Z",
  soTien: 4_320_000,
  nguon: "CK",
  nguonLabel: "Chuyển khoản",
  nhanDot: "Đợt 1",
  thieu: 0,
  traTruoc: 0,
  ngoaiDot: 0,
  tienTha: 0,
  khoanIds: ["p1"],
  khoan: [{ id: "p1", soTien: 4_320_000 }],
  coTtHoaDon: false,
  emailNhan: "ph@example.com",
  kyHieuMau: "1C26TSR",
  coSoId: "cs1",
  cauHinhCoSo: [],
  hanhDong: {
    taiPhieu: true,
    taiLen: { bat: true },
    xacNhan: { bat: false, lyDo: "Chưa tải tệp PDF hoá đơn lên" },
    khongXuat: true,
    ganThem: false,
    canhBao: [],
    ngoaiLe: null,
  },
  hoaDonNhap: null,
  hoaDon: null,
  lyDoKhongXuat: null,
  huy: { bat: false },
  dinhChinh: { bat: false },
  canDieuChinh: [],
  hoaDonDaHuy: [],
  email: null,
  khoanChuaGanGhiDanh: [],
  coTheGanGhiDanh: false,
  thanhPhanGop: ["dot:a"],

  cocChuaTraDu: false,
  gopTuDongDonCoc: false,
  gopVoi: [],
  phatHanhMisa: { hien: true, bat: true, cau: null, moiTruong: "sandbox", nhaCungCap: "MISA_MEINVOICE" },
  misa: null,
  daGuiNhap: null,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.xemTruoc.mockResolvedValue(XEM());
  h.phatHanh.mockResolvedValue({ ok: true, data: { hoaDonId: "hd1", trangThai: "DA_XAC_NHAN", thongDiep: null } });
  h.guiNhap.mockResolvedValue({ ok: true, data: { ok: true, refId: "nhap-1", maGiaoDich: "MGD1", tomTat: { kyHieu: "1C26TSR", mstNguoiBan: "0402054690", tongThanhToan: 4_320_000, soDong: 1, nguoiMuaTen: "Nguyễn Bé An", nguoiMuaMst: null }, nhan: { loai: "CHUA_KY", thongDiep: "VIN chưa có số hoá đơn cho bản nháp này (chưa ký)." } } });
});

describe("[PHM-UI-01] dòng hàng chờ — nút vẽ theo dong.phatHanhMisa", () => {
  const moHop = async (o: Partial<DongHangCho> = {}) => {
    render(<NganLanThu dong={dong(o)} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Xem trước & phát hành/ }));
    return await screen.findByRole("dialog");
  };

  it("đối chứng dương: hiện + sáng ⇒ «Xem trước» dựng tờ (số tiền đã thấy) rồi MỚI phát hành, gửi ĐÚNG số + môi trường + người mua đã chọn + dấu tờ đã xem", async () => {
    const hop = await moHop();
    expect(h.xemTruoc).toHaveBeenCalledWith({ orderId: "don-a", lanThuKey: "dot:a", soTienDaThay: 4_320_000 });
    expect(h.phatHanh).not.toHaveBeenCalled();
    await waitFor(() => expect(hop.textContent).toContain("Học phí khoá Sata4 (48 buổi)"));
    expect(hop.textContent).toContain("4.320.000đ");
    expect(hop.textContent).toMatch(/1C26TSR/);
    expect(hop.textContent).toContain("Nguyễn Văn An");
    expect(hop.textContent).toMatch(/sandbox|thử/i);
    fireEvent.click(within(hop).getByRole("button", { name: /Phát hành 4\.320\.000đ/ }));
    await waitFor(() => expect(h.phatHanh).toHaveBeenCalledTimes(1));
    expect(h.phatHanh.mock.calls[0]![0]).toEqual({
      orderId: "don-a",
      lanThuKey: "dot:a",
      soTienDaThay: 4_320_000,
      moiTruongDaThay: "sandbox",
      nguoiMuaChon: "PHU_HUYNH",
      phieuDaThay: DAU_PH,
    });
    // Lối tải lên VẪN còn song song.
    expect(screen.getByText(/Hoặc tải hoá đơn đã làm ở MISA lên/)).toBeTruthy();
  });

  it("[PHM-XT-01] kế toán CHỌN con ⇒ tờ đổi theo lựa chọn và «Phát hành» gửi người mua + dấu của ĐÚNG tờ con; phương án không dùng được ⇒ nút tắt kèm lý do", async () => {
    h.xemTruoc.mockResolvedValue(XEM({ con: phuongAn("CON", "Nguyễn Bé An", DAU_CON) }));
    const hop = await moHop();
    await waitFor(() => expect(within(hop).getByRole("radio", { name: /Con \(học viên\)/ })).toBeTruthy());
    expect(within(hop).getByRole("radio", { name: /Ba \/ mẹ/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(hop).getByRole("radio", { name: /Con \(học viên\)/ }));
    expect(within(hop).getByRole("radio", { name: /Con \(học viên\)/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(hop).getByRole("button", { name: /Phát hành 4\.320\.000đ/ }));
    await waitFor(() => expect(h.phatHanh).toHaveBeenCalledTimes(1));
    expect(h.phatHanh.mock.calls[0]![0]).toMatchObject({ nguoiMuaChon: "CON", phieuDaThay: DAU_CON });
  });

  it("[PHM-XT-02] con KHÔNG dùng được (chưa có họ tên…) ⇒ nút chọn con disabled + câu lý do; không chọn nhầm được", async () => {
    const hop = await moHop();
    const nutCon = await within(hop).findByRole("radio", { name: /Con \(học viên\)/ });
    expect((nutCon as HTMLButtonElement).disabled).toBe(true);
    expect(nutCon.textContent).toContain("Con chưa có họ tên");
    fireEvent.click(nutCon);
    expect(within(hop).getByRole("radio", { name: /Ba \/ mẹ/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("[PHM-XT-03] luật tự động chọn sẵn CON ⇒ hộp mở với con được chọn + nhãn «theo quy tắc»", async () => {
    h.xemTruoc.mockResolvedValue(XEM({ macDinh: "CON", con: phuongAn("CON", "Nguyễn Bé An", DAU_CON) }));
    const hop = await moHop();
    await waitFor(() => expect(within(hop).getByRole("radio", { name: /Con \(học viên\)/ }).getAttribute("aria-checked")).toBe("true"));
    expect(within(hop).getByRole("radio", { name: /Con \(học viên\)/ }).textContent).toContain("theo quy tắc");
  });

  it("[PHM-XT-04] máy chủ từ chối lúc xem trước ⇒ hiện câu lỗi, KHÔNG có nút phát hành sáng; phát hành bị từ chối (tờ đã đổi) ⇒ hộp ở lại kèm câu lỗi", async () => {
    h.xemTruoc.mockResolvedValueOnce({ ok: false, error: "Thông tin người mua trên đơn còn thiếu" });
    const hop = await moHop();
    await waitFor(() => expect(hop.textContent).toContain("Thông tin người mua trên đơn còn thiếu"));
    expect((within(hop).getByRole("button", { name: /Phát hành 4\.320\.000đ/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    h.phatHanh.mockResolvedValueOnce({ ok: false, error: "Tờ hoá đơn vừa đổi so với bản bạn đã xem trước" } as never);
    const hop2 = await moHop();
    await waitFor(() => expect(within(hop2).getByRole("radio", { name: /Ba \/ mẹ/ })).toBeTruthy());
    fireEvent.click(within(hop2).getByRole("button", { name: /Phát hành 4\.320\.000đ/ }));
    await waitFor(() => expect(hop2.textContent).toContain("vừa đổi so với bản bạn đã xem trước"));
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("không hiện ⇒ không có nút, không có câu 'Hoặc tải lên' (luồng tay như cũ)", () => {
    render(<NganLanThu dong={dong({ phatHanhMisa: { hien: false, bat: false, cau: null, moiTruong: null, nhaCungCap: "MISA_MEINVOICE" } })} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    expect(screen.queryByRole("button", { name: /Xem trước & phát hành/ })).toBeNull();
    expect(screen.queryByText(/Hoặc tải hoá đơn đã làm ở MISA lên/)).toBeNull();
  });

  it("hiện mà TẮT ⇒ nút disabled + đúng câu lý do", () => {
    render(<NganLanThu dong={dong({ phatHanhMisa: { hien: true, bat: false, lyDo: "Thiếu địa chỉ người mua", cau: null, moiTruong: "production", nhaCungCap: "MISA_MEINVOICE" } })} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    expect((screen.getByRole("button", { name: /Xem trước & phát hành/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Thiếu địa chỉ người mua")).toBeTruthy();
  });

  it("hoá đơn thay thế ⇒ không nút, in câu 'làm tại MISA rồi tải lên'", () => {
    render(<NganLanThu dong={dong({ phatHanhMisa: { hien: false, bat: false, cau: "Hoá đơn thay thế: làm tại MISA rồi tải lên", moiTruong: null, nhaCungCap: "MISA_MEINVOICE" } })} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    expect(screen.getByText("Hoá đơn thay thế: làm tại MISA rồi tải lên")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Xem trước & phát hành/ })).toBeNull();
  });

  it("mô phỏng ⇒ hộp xem trước nói KHÔNG gửi email, không có giá trị pháp lý", async () => {
    const hop = await moHop({ phatHanhMisa: { hien: true, bat: true, cau: null, moiTruong: "gia-lap", nhaCungCap: "MISA_MEINVOICE" } });
    await waitFor(() => expect(hop.textContent).toMatch(/Không gửi \(mô phỏng\)/));
    expect(hop.textContent).toMatch(/không có giá trị pháp lý/);
  });

  it("[PHM-XT-05] «Gửi nháp» nằm TRONG hộp xem trước và chỉ khi nhà cung cấp là VIN ∧ nút sáng; gửi ĐÚNG người mua đã chọn + dấu tờ đã xem, rồi bày kết quả; đối chứng: MISA không có nút", async () => {
    h.xemTruoc.mockResolvedValue(XEM({ con: phuongAn("CON", "Nguyễn Bé An", DAU_CON) }));
    const vin = { hien: true, bat: true, cau: null, moiTruong: "production", nhaCungCap: "VIN_HOADON" } as const;
    const hop = await moHop({ phatHanhMisa: vin });
    await waitFor(() => expect(within(hop).getByRole("radio", { name: /Con \(học viên\)/ })).toBeTruthy());
    fireEvent.click(within(hop).getByRole("radio", { name: /Con \(học viên\)/ }));
    fireEvent.click(within(hop).getByRole("button", { name: /Gửi nháp \(không ký\)/ }));
    await waitFor(() => expect(h.guiNhap).toHaveBeenCalledTimes(1));
    expect(h.guiNhap.mock.calls[0]![0]).toEqual({ orderId: "don-a", lanThuKey: "dot:a", soTienDaThay: 4_320_000, nguoiMuaChon: "CON", phieuDaThay: DAU_CON });
    await waitFor(() => expect(hop.textContent).toContain("MGD1"));
    expect(h.phatHanh).not.toHaveBeenCalled();
    cleanup();
    const hopMisa = await moHop();
    await waitFor(() => expect(within(hopMisa).getByRole("radio", { name: /Ba \/ mẹ/ })).toBeTruthy());
    expect(within(hopMisa).queryByRole("button", { name: /Gửi nháp/ })).toBeNull();
  });

  it("[PHM-NHAN-UI-01] (25/11/2026) pháp nhân có HSM: VIN đã KÝ LUÔN bản nháp ⇒ hệ thống nhận hoá đơn về ⇒ hộp ĐÓNG, màn làm mới, báo «đã lưu số và tệp»; pháp nhân chưa ký ⇒ hộp ở lại + kết quả nháp", async () => {
    const vin = { hien: true, bat: true, cau: null, moiTruong: "production", nhaCungCap: "VIN_HOADON" } as const;
    h.guiNhap.mockResolvedValueOnce({ ok: true, data: { ok: true, refId: "nhap-1", maGiaoDich: "MGD1", tomTat: null, nhan: { loai: "DA_NHAN", hoaDonId: "hd1", trangThai: "DA_XAC_NHAN", thongDiep: null } } });
    const hop = await moHop({ phatHanhMisa: vin });
    await waitFor(() => expect(within(hop).getByRole("radio", { name: /Ba \/ mẹ/ })).toBeTruthy());
    fireEvent.click(within(hop).getByRole("button", { name: /Gửi nháp \(không ký\)/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.refresh).toHaveBeenCalled();
    cleanup();
    const hop2 = await moHop({ phatHanhMisa: vin });
    await waitFor(() => expect(within(hop2).getByRole("radio", { name: /Ba \/ mẹ/ })).toBeTruthy());
    fireEvent.click(within(hop2).getByRole("button", { name: /Gửi nháp \(không ký\)/ }));
    await waitFor(() => expect(hop2.textContent).toContain("MGD1"));
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("[PHM-NHAN-UI-02] VIN đã ký nhưng đơn đổi sau lúc gửi nháp ⇒ hộp ở lại và NÓI hoá đơn đã ký mang thông tin cũ (không im lặng)", async () => {
    const vin = { hien: true, bat: true, cau: null, moiTruong: "production", nhaCungCap: "VIN_HOADON" } as const;
    h.guiNhap.mockResolvedValueOnce({ ok: true, data: { ok: true, refId: "nhap-1", maGiaoDich: "MGD1", tomTat: null, nhan: { loai: "LOI", thongDiep: "Đơn đã đổi sau khi gửi nháp, nhưng VIN ĐÃ ký bản nháp cũ" } } });
    const hop = await moHop({ phatHanhMisa: vin });
    await waitFor(() => expect(within(hop).getByRole("radio", { name: /Ba \/ mẹ/ })).toBeTruthy());
    fireEvent.click(within(hop).getByRole("button", { name: /Gửi nháp \(không ký\)/ }));
    await waitFor(() => expect(hop.textContent).toContain("VIN ĐÃ ký bản nháp cũ"));
  });

  it("[PHM-XT-06] giải thích nằm sau dấu «?» (không in thành đoạn văn trên màn)", () => {
    render(<NganLanThu dong={dong()} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    expect(screen.getByRole("button", { name: /Xem hướng dẫn: phát hành qua MISA/ })).toBeTruthy();
    expect(screen.queryByText(/Hệ thống gửi hoá đơn sang/)).toBeNull();
  });
});

describe("[PHM-NHAN-UI-03] khối «Đã gửi nháp» — «Kiểm tra đã ký chưa»", () => {
  const dongNhap = () => dong({ daGuiNhap: { luc: "2026-11-25T02:00:00.000Z" } });
  it("bấm ⇒ gọi action chỉ với (đơn, khoá); VIN chưa ký ⇒ in lý do, KHÔNG làm mới; đã nhận ⇒ làm mới màn", async () => {
    h.nhan.mockResolvedValueOnce({ ok: true, data: { loai: "CHUA_KY", thongDiep: "VIN chưa có số hoá đơn cho bản nháp này (chưa ký)." } });
    render(<NganLanThu dong={dongNhap()} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra đã ký chưa/ }));
    await waitFor(() => expect(h.nhan).toHaveBeenCalledWith({ orderId: "don-a", lanThuKey: "dot:a" }));
    await waitFor(() => expect(screen.getByText(/chưa ký/)).toBeTruthy());
    expect(h.refresh).not.toHaveBeenCalled();
    h.nhan.mockResolvedValueOnce({ ok: true, data: { loai: "DA_NHAN", hoaDonId: "hd1", trangThai: "DA_XAC_NHAN", thongDiep: null } });
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra đã ký chưa/ }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });
  it("lỗi / từ chối của máy chủ ⇒ hiện câu lỗi (không nuốt)", async () => {
    h.nhan.mockResolvedValueOnce({ ok: false, error: "Bản nháp này gửi trước khi hệ thống ghi đủ dấu để tự nhận" });
    render(<NganLanThu dong={dongNhap()} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra đã ký chưa/ }));
    await waitFor(() => expect(screen.getAllByRole("alert").map((e) => e.textContent).join(" ")).toContain("ghi đủ dấu"));
  });
  it("giải thích nằm sau dấu «?» (không in thành đoạn văn)", () => {
    render(<NganLanThu dong={dongNhap()} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    expect(screen.getByRole("button", { name: /Xem hướng dẫn: bản nháp đã gửi/ })).toBeTruthy();
    expect(screen.queryByText(/Gửi nhầm \(vd cần/)).toBeNull();
  });
});

const MISA = (o: Partial<KhoiMisa> = {}): KhoiMisa => ({
  nhaCungCap: "MISA_MEINVOICE",
  trangThai: "DANG_PHAT_HANH",
  hoaDonId: "hd1",
  phienBan: "2026-09-30T03:00:00.000Z",
  so: null,
  loiMa: null,
  thongDiep: "Hết thời gian chờ MISA",
  soLanGui: 1,
  guiLucLabel: "10:00 30/09/2026",
  moPhong: false,
  moiTruong: "production",
  kiemTraLai: { bat: true },
  phatHanhLai: { bat: false },
  boLamTay: { bat: false },
  ...o,
});
const HD = { id: "hd1", nguon: "MISA_API" as const, kyHieu: "1C26TSR", soHoaDon: null, ngayPhatHanh: null, coPdf: false, coXml: false };

describe("[PHM-UI-02] ngăn Phát hành MISA — khối trạng thái", () => {
  it("ĐANG ⇒ 'Đang chờ MISA xác nhận' + Kiểm tra lại gọi action với đúng hoá đơn; KHÔNG có ô tải lên", async () => {
    render(<NganLanThu dong={dong({ ngan: "phat-hanh", hoaDon: { ...HD, trangThai: "DANG_PHAT_HANH" }, misa: MISA() })} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    expect(screen.getByText("Đang chờ MISA xác nhận")).toBeTruthy();
    expect(screen.queryByText(/Hoặc tải hoá đơn/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra lại/ }));
    await waitFor(() => expect(h.kiem).toHaveBeenCalledWith({ orderId: "don-a", hoaDonId: "hd1" }));
  });

  it("LỖI ⇒ mã + thông điệp MISA; Phát hành lại gửi phiên bản + môi trường; Bỏ, làm tay cần bấm HAI lần", async () => {
    render(
      <NganLanThu
        dong={dong({
          ngan: "phat-hanh",
          hoaDon: { ...HD, trangThai: "LOI_PHAT_HANH" },
          misa: MISA({ trangThai: "LOI_PHAT_HANH", loiMa: "InvalidTaxCode", thongDiep: "MST sai", kiemTraLai: { bat: false }, phatHanhLai: { bat: true }, boLamTay: { bat: true } }),
        })}
        goiYBanDau={null} coQuyenNgoaiLeKyHieu={false}
      />,
    );
    expect(screen.getByText("MISA từ chối phát hành")).toBeTruthy();
    expect(screen.getByText("InvalidTaxCode")).toBeTruthy();
    expect(screen.getByText(/MST sai/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Phát hành lại/ }));
    await waitFor(() =>
      expect(h.lai).toHaveBeenCalledWith({ orderId: "don-a", hoaDonId: "hd1", phienBan: "2026-09-30T03:00:00.000Z", moiTruongDaThay: "production" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Bỏ, làm tay" }));
    expect(h.bo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Bấm lần nữa để bỏ/ }));
    await waitFor(() => expect(h.bo).toHaveBeenCalledWith({ orderId: "don-a", hoaDonId: "hd1", phienBan: "2026-09-30T03:00:00.000Z" }));
  });

  it("nút tắt trong khối (thiếu cổng) ⇒ Phát hành lại disabled + nói lý do; Bỏ, làm tay vẫn còn", () => {
    render(
      <NganLanThu
        dong={dong({
          ngan: "phat-hanh",
          hoaDon: { ...HD, trangThai: "LOI_PHAT_HANH" },
          misa: MISA({ trangThai: "LOI_PHAT_HANH", kiemTraLai: { bat: false }, phatHanhLai: { bat: false, lyDo: "Chưa cấu hình kết nối MISA" }, boLamTay: { bat: true } }),
        })}
        goiYBanDau={null} coQuyenNgoaiLeKyHieu={false}
      />,
    );
    expect((screen.getByRole("button", { name: /Phát hành lại/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Chưa cấu hình kết nối MISA")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bỏ, làm tay" })).toBeTruthy();
  });
});

describe("[PHM-UI-03] hoá đơn đã xuất theo nguồn", () => {
  const daXuat = (nguon: "TAI_LEN" | "MISA_API" | "MISA_GIA_LAP") =>
    dong({
      ngan: "da-xuat",
      hoaDon: { id: "hd1", trangThai: "DA_XAC_NHAN", nguon, kyHieu: "1C26TSR", soHoaDon: "88", ngayPhatHanh: "2026-09-30", coPdf: true, coXml: true },
      huy: { bat: true },
      phatHanhMisa: { hien: false, bat: false, cau: null, moiTruong: null, nhaCungCap: "MISA_MEINVOICE" },
    });
  it("mô phỏng ⇒ nhãn 'MÔ PHỎNG — không có giá trị pháp lý'; đối chứng: tải lên thì không", () => {
    const { unmount } = render(<NganLanThu dong={daXuat("MISA_GIA_LAP")} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    expect(screen.getByText(/MÔ PHỎNG — không có giá trị pháp lý/)).toBeTruthy();
    unmount();
    render(<NganLanThu dong={daXuat("TAI_LEN")} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    expect(screen.queryByText(/MÔ PHỎNG/)).toBeNull();
  });
  it("nguồn MISA_API ⇒ mở Huỷ thấy câu 'huỷ / điều chỉnh trên MISA TRƯỚC'; đối chứng: tải lên thì không", () => {
    const { unmount } = render(<NganLanThu dong={daXuat("MISA_API")} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hoá đơn này/ }));
    expect(screen.getByText(/huỷ \/ điều chỉnh trên MISA TRƯỚC/)).toBeTruthy();
    unmount();
    render(<NganLanThu dong={daXuat("TAI_LEN")} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hoá đơn này/ }));
    expect(screen.queryByText(/huỷ \/ điều chỉnh trên MISA TRƯỚC/)).toBeNull();
  });
});

// Smoke 30/09 ở 375: ô "Email nhận" `truncate` cắt "Không gửi (mô phỏ…" — và cắt luôn email thật, đúng thông tin
// kế toán phải soát trước khi phát hành một chứng từ thuế. Ô trong hộp xác nhận phải XUỐNG DÒNG, không cắt.
// jsdom không dựng bố cục ⇒ khoá bằng LỚP của phần tử thật.
describe("[PHM-UI-03] hộp xác nhận — chữ xuống dòng, không cắt (375px)", () => {
  const moHop = async (o: Partial<DongHangCho>) => {
    render(<NganLanThu dong={dong(o)} goiYBanDau={null} coQuyenNgoaiLeKyHieu={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Xem trước & phát hành/ }));
    const hop = await screen.findByRole("dialog");
    await waitFor(() => expect(within(hop).getByRole("radio", { name: /Ba \/ mẹ/ })).toBeTruthy());
    return hop;
  };
  const khongCat = (el: HTMLElement) => {
    const dd = el.closest("dd")!;
    expect(dd).toBeTruthy();
    expect(dd.className).not.toMatch(/(^|\s)(truncate|overflow-hidden|whitespace-nowrap|line-clamp-\S+)(\s|$)/);
    expect(dd.className).toMatch(/\[overflow-wrap:anywhere\]/);
  };
  it("mô phỏng: 'Không gửi (mô phỏng)' không bị cắt", async () => {
    const hop = await moHop({ phatHanhMisa: { hien: true, bat: true, cau: null, moiTruong: "gia-lap", nhaCungCap: "MISA_MEINVOICE" } });
    khongCat(within(hop).getByText("Không gửi (mô phỏng)"));
  });
  it("email dài + tên người mua dài: cả hai ô xuống dòng", async () => {
    h.xemTruoc.mockResolvedValue(XEM({ phuHuynh: phuongAn("PHU_HUYNH", "Nguyễn Phương Quỳnh Anh Đặng Thị Thuỳ Dương", DAU_PH, { email: "nguyen.phuong.quynh.anh.phu.huynh.lop4@congtytnhhgiaoducsata.example.com" }) }));
    const hop = await moHop({});
    khongCat(within(hop).getByText(/congtytnhhgiaoducsata/));
    // Tên xuất hiện ở thẻ chọn người mua VÀ ở ô «Người mua» — canh ô trong bảng thông tin (dd).
    khongCat(within(hop).getAllByText(/Quỳnh Anh/).find((e) => e.closest("dd"))!);
  });
});
