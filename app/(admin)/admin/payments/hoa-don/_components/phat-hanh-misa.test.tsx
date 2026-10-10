// @vitest-environment jsdom
/**
 * Ca [PHM-UI-*] — lối "Phát hành qua MISA" trong ngăn lần thu (bước 1, 30/09/2026). Canh HÀNH VI trên phần
 * tử thật: nút vẽ theo `dong.phatHanhMisa` / `dong.misa` (đúng trường action đọc lại), xác nhận HAI bước bày
 * số tiền + môi trường + ký hiệu trước khi gửi, và gửi ĐÚNG số / môi trường đã bày. Mọi ca "không thấy" có
 * đối chứng dương (CLAUDE.md luật 11).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";
import type { KhoiMisa } from "@/lib/finance/hoa-don/nut-phat-hanh-misa";

const h = vi.hoisted(() => ({
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
  phatHanhQuaMisaAction: h.phatHanh,
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
  canDieuChinh: [],
  hoaDonDaHuy: [],
  email: null,
  khoanChuaGanGhiDanh: [],
  coTheGanGhiDanh: false,
  thanhPhanGop: ["dot:a"],
  gopVoi: [],
  phatHanhMisa: { hien: true, bat: true, cau: null, moiTruong: "sandbox" },
  misa: null,
  ...o,
});

beforeEach(() => vi.clearAllMocks());

describe("[PHM-UI-01] dòng hàng chờ — nút vẽ theo dong.phatHanhMisa", () => {
  it("đối chứng dương: hiện + sáng ⇒ bấm mở bước xác nhận (số tiền, ký hiệu, môi trường) rồi mới gửi ĐÚNG số + môi trường", async () => {
    render(<NganLanThu dong={dong()} />);
    fireEvent.click(screen.getByRole("button", { name: /Phát hành qua MISA/ }));
    expect(h.phatHanh).not.toHaveBeenCalled();
    const hop = screen.getByRole("group", { name: "Xác nhận phát hành qua MISA" });
    expect(hop.textContent).toContain("4.320.000đ");
    expect(hop.textContent).toMatch(/1C\d{2}TSR/);
    expect(hop.textContent).toContain("Nguyễn Văn An");
    expect(hop.textContent).toMatch(/sandbox|thử/i);
    fireEvent.click(screen.getByRole("button", { name: /Phát hành 4\.320\.000đ/ }));
    await waitFor(() => expect(h.phatHanh).toHaveBeenCalledTimes(1));
    expect(h.phatHanh.mock.calls[0]![0]).toEqual({
      orderId: "don-a",
      lanThuKey: "dot:a",
      soTienDaThay: 4_320_000,
      moiTruongDaThay: "sandbox",
    });
    // Lối tải lên VẪN còn song song.
    expect(screen.getByText(/Hoặc tải hoá đơn đã làm ở MISA lên/)).toBeTruthy();
  });

  it("không hiện ⇒ không có nút, không có câu 'Hoặc tải lên' (luồng tay như cũ)", () => {
    render(<NganLanThu dong={dong({ phatHanhMisa: { hien: false, bat: false, cau: null, moiTruong: null } })} />);
    expect(screen.queryByRole("button", { name: /Phát hành qua MISA/ })).toBeNull();
    expect(screen.queryByText(/Hoặc tải hoá đơn đã làm ở MISA lên/)).toBeNull();
  });

  it("hiện mà TẮT ⇒ nút disabled + đúng câu lý do", () => {
    render(<NganLanThu dong={dong({ phatHanhMisa: { hien: true, bat: false, lyDo: "Thiếu địa chỉ người mua", cau: null, moiTruong: "production" } })} />);
    expect((screen.getByRole("button", { name: /Phát hành qua MISA/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Thiếu địa chỉ người mua")).toBeTruthy();
  });

  it("hoá đơn thay thế ⇒ không nút, in câu 'làm tại MISA rồi tải lên'", () => {
    render(<NganLanThu dong={dong({ phatHanhMisa: { hien: false, bat: false, cau: "Hoá đơn thay thế: làm tại MISA rồi tải lên", moiTruong: null } })} />);
    expect(screen.getByText("Hoá đơn thay thế: làm tại MISA rồi tải lên")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Phát hành qua MISA/ })).toBeNull();
  });

  it("mô phỏng ⇒ hộp xác nhận nói KHÔNG gửi email, không có giá trị pháp lý", () => {
    render(<NganLanThu dong={dong({ phatHanhMisa: { hien: true, bat: true, cau: null, moiTruong: "gia-lap" } })} />);
    fireEvent.click(screen.getByRole("button", { name: /Phát hành qua MISA/ }));
    const hop = screen.getByRole("group", { name: "Xác nhận phát hành qua MISA" });
    expect(hop.textContent).toMatch(/Không gửi \(mô phỏng\)/);
    expect(hop.textContent).toMatch(/không có giá trị pháp lý/);
  });
});

const MISA = (o: Partial<KhoiMisa> = {}): KhoiMisa => ({
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
    render(<NganLanThu dong={dong({ ngan: "phat-hanh", hoaDon: { ...HD, trangThai: "DANG_PHAT_HANH" }, misa: MISA() })} />);
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
      phatHanhMisa: { hien: false, bat: false, cau: null, moiTruong: null },
    });
  it("mô phỏng ⇒ nhãn 'MÔ PHỎNG — không có giá trị pháp lý'; đối chứng: tải lên thì không", () => {
    const { unmount } = render(<NganLanThu dong={daXuat("MISA_GIA_LAP")} />);
    expect(screen.getByText(/MÔ PHỎNG — không có giá trị pháp lý/)).toBeTruthy();
    unmount();
    render(<NganLanThu dong={daXuat("TAI_LEN")} />);
    expect(screen.queryByText(/MÔ PHỎNG/)).toBeNull();
  });
  it("nguồn MISA_API ⇒ mở Huỷ thấy câu 'huỷ / điều chỉnh trên MISA TRƯỚC'; đối chứng: tải lên thì không", () => {
    const { unmount } = render(<NganLanThu dong={daXuat("MISA_API")} />);
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hoá đơn này/ }));
    expect(screen.getByText(/huỷ \/ điều chỉnh trên MISA TRƯỚC/)).toBeTruthy();
    unmount();
    render(<NganLanThu dong={daXuat("TAI_LEN")} />);
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hoá đơn này/ }));
    expect(screen.queryByText(/huỷ \/ điều chỉnh trên MISA TRƯỚC/)).toBeNull();
  });
});

// Smoke 30/09 ở 375: ô "Email nhận" `truncate` cắt "Không gửi (mô phỏ…" — và cắt luôn email thật, đúng thông tin
// kế toán phải soát trước khi phát hành một chứng từ thuế. Ô trong hộp xác nhận phải XUỐNG DÒNG, không cắt.
// jsdom không dựng bố cục ⇒ khoá bằng LỚP của phần tử thật.
describe("[PHM-UI-03] hộp xác nhận — chữ xuống dòng, không cắt (375px)", () => {
  const moHop = (o: Partial<DongHangCho>) => {
    render(<NganLanThu dong={dong(o)} />);
    fireEvent.click(screen.getByRole("button", { name: /Phát hành qua MISA/ }));
    return screen.getByRole("group", { name: "Xác nhận phát hành qua MISA" });
  };
  const khongCat = (el: HTMLElement) => {
    const dd = el.closest("dd")!;
    expect(dd).toBeTruthy();
    expect(dd.className).not.toMatch(/(^|\s)(truncate|overflow-hidden|whitespace-nowrap|line-clamp-\S+)(\s|$)/);
    expect(dd.className).toMatch(/\[overflow-wrap:anywhere\]/);
  };
  it("mô phỏng: 'Không gửi (mô phỏng)' không bị cắt", () => {
    const hop = moHop({ phatHanhMisa: { hien: true, bat: true, cau: null, moiTruong: "gia-lap" } });
    khongCat(within(hop).getByText("Không gửi (mô phỏng)"));
  });
  it("email dài + tên người mua dài: cả hai ô xuống dòng", () => {
    const hop = moHop({
      emailNhan: "nguyen.phuong.quynh.anh.phu.huynh.lop4@congtytnhhgiaoducsata.example.com",
      tenKhach: "Nguyễn Phương Quỳnh Anh Đặng Thị Thuỳ Dương",
      coTtHoaDon: true,
    });
    khongCat(within(hop).getByText(/congtytnhhgiaoducsata/));
    khongCat(within(hop).getByText(/Quỳnh Anh/));
  });
});
