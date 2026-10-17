// @vitest-environment jsdom
/**
 * Ca [BCT-*] — "Bàn chứng từ" của màn Hoá đơn điện tử (docs/ke-toan-hoa-don/PLAN.md §10, cổng GĐ 4).
 *
 * Ca đáng giá nhất là [BCT-01]: SANG DÒNG KHÁC THÌ Ô SỐ VÀ Ô TỆP PHẢI RỖNG. Không có nó, tệp PDF của
 * khách A (mang MST, CCCD) nằm lại trong ô chọn tệp khi kế toán bấm sang khách B — bấm Lưu là gắn
 * hoá đơn của A vào lần thu của B, rồi GĐ 6 gửi email tờ đó cho B. Đây là bẫy "router.refresh không
 * reset form" (defaultValue/state chỉ đọc lúc mount); chặn bằng `key={dong.key}` trên thân ngăn.
 * Canh bằng HÀNH VI (gõ + chọn tệp + đổi dòng), không grep chuỗi `key=` (luật 11).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  huy: vi.fn(),
  luu: vi.fn(),
  xacNhan: vi.fn(),
  khongTrung: vi.fn(),
  taiTep: vi.fn(),
  toastOk: vi.fn(),
  guiLai: vi.fn(),
  xemTruocGan: vi.fn(),
  ganGhiDanh: vi.fn(),
  toastWarn: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/payments/hoa-don",
  useRouter: () => ({ replace: h.replace, refresh: h.refresh, push: vi.fn() }),
}));
vi.mock("../_actions", () => ({
  kyTaiLenHoaDonAction: vi.fn(),
  xacMinhTepHoaDonAction: vi.fn(),
  luuHoaDonNhapAction: h.luu,
  khongXuatHoaDonAction: vi.fn(),
  goHoaDonAction: vi.fn(),
  huyHoaDonAction: h.huy,
  xacNhanHoaDonAction: h.xacNhan,
  khongTrungHoaDonAction: h.khongTrung,
  guiLaiEmailHoaDonAction: h.guiLai,
  xemTruocGanGhiDanhAction: h.xemTruocGan,
  ganGhiDanhHoaDonAction: h.ganGhiDanh,
}));
// Tải tệp lên kho (URL ký sẵn + PUT) — ngoài phạm vi ngăn; ca chỉ cần payload của bước LƯU.
vi.mock("./tai-tep-hoa-don", () => ({ taiTepHoaDon: h.taiTep }));
vi.mock("sonner", () => ({ toast: { success: h.toastOk, error: vi.fn(), warning: h.toastWarn } }));

import { BanChungTu } from "./ban-chung-tu";

const dong = (key: string, tenKhach: string, o: Partial<DongHangCho> = {}): DongHangCho => ({
  key,
  ngan: "cho",
  nhan: "Chờ xuất",
  tone: "warning",
  orderId: `don-${key}`,
  maDon: `ORD-${key}`,
  tenKhach,
  sdt: "090****456",
  coSo: { ma: "CS1", ten: "Cơ sở 1" },
  ngayThu: "2026-09-10",
  ngayThuLabel: "10/09/2026",
  soTien: 3_000_000,
  nguon: "CK",
  nguonLabel: "Chuyển khoản · FT1",
  nhanDot: "Đợt 1",
  thieu: 0,
  traTruoc: 0,
  ngoaiDot: 0,
  tienTha: 0,
  khoanIds: [`p-${key}`],
  khoan: [{ id: `p-${key}`, soTien: 3_000_000 }],
  coTtHoaDon: false,
  emailNhan: "ph***@gmail.com",
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
  thanhPhanGop: [key],
  gopVoi: [],
  phatHanhMisa: { hien: false, bat: false, cau: null, moiTruong: null },
  misa: null,
  ...o,
});

const A = dong("dot:a", "Nguyễn Văn An");
const B = dong("dot:b", "Trần Thị Bình");
// Bộ lọc mặc định: mọi cơ sở, tháng hiện tại (không ghi lên URL) — các ca cũ vẽ đúng như trước khi có lọc.
const LOC_MAC_DINH = { url: { coSo: null, thang: null }, coSo: null, thang: "2026-09", thangMacDinh: "2026-09", cacCoSo: [], cacThang: [] };
const DEM = { cho: 2, lech: 0, nhap: 0, "phat-hanh": 0, "da-xuat": 0, "khong-xuat": 0, "don-huy": 0, "can-dieu-chinh": 0 } as const;

function dung(dangChon: DongHangCho | null, ghiDe: Partial<Parameters<typeof BanChungTu>[0]> = {}) {
  return (
    <BanChungTu
      ngan="cho"
      dem={{ ...DEM }}
      dongTrongNgan={[A, B]}
      dangChon={dangChon}
      chonKhongThay={false}
      thieuCoSo={0}
      khoOk
      loc={LOC_MAC_DINH}
      {...ghiDe}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom không có matchMedia — giả DESKTOP (≥ xl): ngăn đứng cạnh, không Sheet.
  window.matchMedia = ((q: string) => ({
    matches: true,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

const oSo = () => screen.getByLabelText("Số hoá đơn") as HTMLInputElement;
const oPdf = () => screen.getByLabelText("Tệp PDF hoá đơn") as HTMLInputElement;

describe("[BCT-01] sang dòng khác ⇒ ô số + ô tệp RỖNG (không mang PDF của khách A sang khách B)", () => {
  it("gõ số + chọn tệp ở dòng A, đổi sang dòng B ⇒ số rỗng, không còn tệp", () => {
    const { rerender } = render(dung(A));
    fireEvent.change(oSo(), { target: { value: "127" } });
    const tep = new File(["%PDF-1.7"], "hoa-don-khach-A.pdf", { type: "application/pdf" });
    fireEvent.change(oPdf(), { target: { files: [tep] } });
    expect(oSo().value).toBe("127");
    expect(screen.getByText(/hoa-don-khach-A\.pdf/)).toBeTruthy();

    rerender(dung(B));

    expect(oSo().value).toBe("");
    expect(screen.queryByText(/hoa-don-khach-A\.pdf/)).toBeNull();
    expect(screen.getByText("Chọn hoặc kéo tệp PDF vào đây")).toBeTruthy();
  });

  it("đối chứng dương: CÙNG dòng được vẽ lại (refresh) thì ô vẫn giữ — reset là do đổi dòng, không phải do vẽ lại", () => {
    const { rerender } = render(dung(A));
    fireEvent.change(oSo(), { target: { value: "127" } });
    rerender(dung({ ...A }));
    expect(oSo().value).toBe("127");
  });
});

describe("[BCT-02] chọn dòng ⇒ khoá lần thu lên URL, giữ ngăn", () => {
  it("bấm tên khách ở bảng ⇒ router.replace(?ngan=cho&chon=<khoá>)", () => {
    render(dung(null));
    const nut = screen.getAllByRole("button", { name: /Trần Thị Bình/ });
    fireEvent.click(nut[nut.length - 1]!);
    expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don?ngan=cho&chon=dot%3Ab", { scroll: false });
  });

  it("desktop chưa chọn gì ⇒ ngăn hiện sẵn dòng ĐẦU, không đổi URL", () => {
    render(dung(null));
    expect(screen.getByRole("complementary", { name: "Chứng từ của lần thu" }).textContent).toContain("Nguyễn Văn An");
    expect(h.replace).not.toHaveBeenCalled();
  });
});

describe("[BCT-03] ngăn xử lý nói thật", () => {
  it("tải phiếu thu trỏ đúng đơn + khoá lần thu (mã hoá URL)", () => {
    render(dung(A));
    const link = screen.getByRole("link", { name: /Tải phiếu thu/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/payments/hoa-don/phieu-cho?don=don-dot%3Aa&chon=dot%3Aa");
  });

  it("không phải kế toán của cơ sở ⇒ không có link tải, không có nút lưu; nói lý do", () => {
    const lyDo = "Cần quyền payments:confirm tại cơ sở của đơn — hỏi Quản trị hệ thống";
    const khongQuyen = dong("dot:c", "Lê C", {
      hanhDong: {
        taiPhieu: false,
        taiLen: { bat: false, lyDo },
        xacNhan: { bat: false, lyDo },
        khongXuat: false,
        ganThem: false,
        canhBao: [],
        ngoaiLe: null,
      },
    });
    render(dung(khongQuyen, { dongTrongNgan: [khongQuyen] }));
    expect(screen.queryByRole("link", { name: /Tải phiếu thu/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lưu hoá đơn" })).toBeNull();
    expect(screen.getAllByText(lyDo).length).toBeGreaterThan(0);
  });

  it("nút Lưu tắt khi chưa chọn tệp PDF", () => {
    render(dung(A));
    expect((screen.getByRole("button", { name: "Lưu hoá đơn" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("bước ③ Xác nhận: sáng ⇒ nhãn nói đúng việc (gửi tới đâu); tắt ⇒ disabled + câu lý do", () => {
    const nhapDong = (bat: boolean) =>
      dong("dot:n", "Phạm Nhật", {
        ngan: "nhap",
        nhan: "Đã tải tệp",
        tone: "info",
        hoaDonNhap: {
          id: "hd1",
          kyHieu: "1C26TSR",
          soHoaDon: bat ? "127" : null,
          ngayPhatHanh: "2026-09-20",
          tepPdfTen: "hd.pdf",
          tepXmlTen: null,
          guiEmailKhach: true,
          phienBan: "2026-09-20T01:00:00.000Z",
          xuatTheoSoDaThu: false,
          xuatTheoSoDaThuLyDo: null,
          khongTrungLyDo: null,
        },
        hoaDon: {
          id: "hd1",
          trangThai: "NHAP",
          nguon: "TAI_LEN" as const,
          kyHieu: "1C26TSR",
          soHoaDon: bat ? "127" : null,
          ngayPhatHanh: "2026-09-20",
          coPdf: true,
          coXml: false,
        },
        hanhDong: {
          taiPhieu: true,
          taiLen: { bat: true },
          xacNhan: bat
            ? { bat: true, nhan: "Xác nhận & gửi tới ph***@gmail.com" }
            : { bat: false, lyDo: "Còn thiếu số hoá đơn" },
          khongXuat: true,
          ganThem: false,
          canhBao: [],
          ngoaiLe: null,
        },
      });
    const { unmount } = render(dung(nhapDong(true), { ngan: "nhap", dongTrongNgan: [nhapDong(true)] }));
    const nut = screen.getByRole("button", { name: "Xác nhận & gửi tới ph***@gmail.com" }) as HTMLButtonElement;
    expect(nut.disabled).toBe(false);
    unmount();

    render(dung(nhapDong(false), { ngan: "nhap", dongTrongNgan: [nhapDong(false)] }));
    expect((screen.getByRole("button", { name: "Xác nhận" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Còn thiếu số hoá đơn")).toBeTruthy();
  });

  it("ngăn rỗng ⇒ nói vì sao rỗng + đường về Chờ xuất", () => {
    render(dung(null, { ngan: "lech", dongTrongNgan: [] }));
    expect(screen.getByText("Không có lần thu nào lệch số tiền hay nghi trùng.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Về ngăn Chờ xuất" })).toBeTruthy();
  });
});

describe("[BCT-04..06] GĐ 8 — huỷ hoá đơn đã xác nhận", () => {
  const HD_XN = {
    id: "hd1",
    trangThai: "DA_XAC_NHAN" as const,
    nguon: "TAI_LEN" as const,
    kyHieu: "1C26TSR",
    soHoaDon: "127",
    ngayPhatHanh: "2026-09-20",
    coPdf: true,
    coXml: false,
  };
  const daXuat = (o: Partial<DongHangCho> = {}) =>
    dong("dot:x", "Đỗ Xuân", { ngan: "da-xuat", nhan: "Đã xuất", tone: "success", hoaDon: HD_XN, huy: { bat: true }, ...o });
  const moRong = (d: DongHangCho) => render(dung(d, { ngan: d.ngan, dongTrongNgan: [d] }));

  it("[BCT-04] dòng CẦN ĐIỀU CHỈNH ⇒ hộp đỏ + lý do + Tải PDF + nút 'Huỷ hoá đơn để xuất lại…'; KHÔNG có ô tải tệp", () => {
    const d = daXuat({
      ngan: "can-dieu-chinh",
      nhan: "Cần điều chỉnh",
      tone: "danger",
      canDieuChinh: ["Đơn đã bị huỷ / hoàn sau khi xuất hoá đơn"],
    });
    moRong(d);
    expect(screen.getByRole("region", { name: "Cần điều chỉnh" }).textContent).toContain("Đơn đã bị huỷ / hoàn");
    expect(screen.getByRole("link", { name: /Tải PDF/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Huỷ hoá đơn để xuất lại…" })).toBeTruthy();
    expect(screen.queryByLabelText("Tệp PDF hoá đơn")).toBeNull();
  });

  it("[BCT-05] dòng đã xuất: nút Huỷ TẮT tới khi đủ 10 ký tự; gửi đúng tham số rồi mở dòng hàng chờ vừa nhận lại khoản", async () => {
    h.huy.mockResolvedValue({ ok: true, data: { chon: "dot:x", ngan: "cho" } });
    moRong(daXuat());
    fireEvent.click(screen.getByRole("button", { name: "Huỷ hoá đơn này…" }));
    const nut = () => screen.getByRole("button", { name: "Huỷ hoá đơn" }) as HTMLButtonElement;
    expect(nut().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Lý do huỷ hoá đơn"), { target: { value: "nhầm" } });
    expect(nut().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Lý do huỷ hoá đơn"), { target: { value: "Tải nhầm tờ của khách khác" } });
    expect(nut().disabled).toBe(false);
    fireEvent.click(nut());
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don?ngan=cho&chon=dot%3Ax", { scroll: false }));
    expect(h.huy).toHaveBeenCalledWith({ orderId: "don-dot:x", hoaDonId: "hd1", lyDo: "Tải nhầm tờ của khách khác" });
  });

  it("[BCT-05b] đối chứng: nút huỷ TẮT (thiếu quyền) ⇒ nói lý do, không có nút", () => {
    moRong(daXuat({ huy: { bat: false, lyDo: "Cần quyền payments:confirm tại cơ sở của đơn — hỏi Quản trị hệ thống" } }));
    expect(screen.queryByRole("button", { name: /Huỷ hoá đơn/ })).toBeNull();
    expect(screen.getByText(/Cần quyền payments:confirm/)).toBeTruthy();
  });

  it("[BCT-06] dòng chờ từng có hoá đơn đã huỷ ⇒ nói ra + lý do; 'Xem PDF' CHỈ khi tải được", () => {
    const vs = (taiDuoc: boolean) =>
      dong("dot:y", "Võ Yến", {
        hoaDonDaHuy: [{ id: "hdA", so: "1C26TSR-127", huyLucLabel: "12/09/2026", lyDo: "Tải nhầm tệp", taiDuoc }],
      });
    const { unmount } = moRong(vs(true));
    const muc = screen.getByRole("region", { name: "Hoá đơn đã huỷ" });
    expect(muc.textContent).toContain("Lần thu này từng có hoá đơn 1C26TSR-127");
    expect(muc.textContent).toContain("Lý do: Tải nhầm tệp");
    expect((screen.getByRole("link", { name: "Xem PDF bản đã huỷ" }) as HTMLAnchorElement).getAttribute("href")).toBe(
      "/payments/hoa-don/hdA/tai-ve?loai=pdf",
    );
    unmount();
    moRong(vs(false));
    expect(screen.queryByRole("link", { name: "Xem PDF bản đã huỷ" })).toBeNull();
  });
});

describe("[BCT-07..09] GĐ 8 — xuất theo số đã thu · không trùng · xác nhận ghim phiên bản · ngăn đơn huỷ", () => {
  const PB = "2026-09-20T01:00:00.000Z";
  const NHAN = "Xác nhận & gửi tới ph***@gmail.com";
  const NHAP = {
    id: "hd1",
    kyHieu: "1C26TSR",
    soHoaDon: "127",
    ngayPhatHanh: "2026-09-20",
    tepPdfTen: "hd.pdf",
    tepXmlTen: null,
    guiEmailKhach: true,
    phienBan: PB,
    xuatTheoSoDaThu: false,
    xuatTheoSoDaThuLyDo: null,
    khongTrungLyDo: null,
  };
  const HD_NHAP = { id: "hd1", trangThai: "NHAP" as const, nguon: "TAI_LEN" as const, kyHieu: "1C26TSR", soHoaDon: "127", ngayPhatHanh: "2026-09-20", coPdf: true, coXml: false };
  const moRong = (d: DongHangCho) => render(dung(d, { ngan: d.ngan, dongTrongNgan: [d] }));
  const nut = (ten: string) => screen.getByRole("button", { name: ten }) as HTMLButtonElement;

  it("[BCT-07] lần thu THIẾU: Lưu TẮT tới khi tick VÀ đủ 10 ký tự; payload mang số đã thấy + lựa chọn", async () => {
    const CAU = "Thiếu 1.000.000đ so với Đợt 1. Chờ phụ huynh chuyển nốt, hoặc tick “Xuất theo số đã thu”…";
    const thieu = dong("dot:t", "Hồ Thiếu", {
      ngan: "lech",
      thieu: 1_000_000,
      hanhDong: {
        taiPhieu: true,
        taiLen: { bat: true },
        xacNhan: { bat: false, lyDo: CAU },
        khongXuat: true,
        ganThem: true,
        canhBao: [],
        ngoaiLe: { loai: "THEO_SO_DA_THU", daChon: false, cau: CAU },
      },
    });
    h.taiTep.mockResolvedValue({ khoa: "hoa-don/x.pdf", ten: "hd.pdf", co: 10, sha256: "ab".repeat(32) });
    h.luu.mockResolvedValue({ ok: true, data: { hoaDonId: "hd9" } });
    moRong(thieu);
    // Câu lối ra đứng ĐẦU "Cần lưu ý", không nhắc lại dòng "Thiếu …" riêng.
    const luuY = screen.getByRole("region", { name: "Cần lưu ý" });
    expect(luuY.querySelector("li")?.textContent).toBe(CAU);
    expect(luuY.querySelectorAll("li").length).toBe(1);

    fireEvent.change(oPdf(), { target: { files: [new File(["%PDF-1.7"], "hd.pdf", { type: "application/pdf" })] } });
    expect(nut("Lưu hoá đơn").disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Xuất theo số đã thu — 3\.000\.000đ/ }));
    expect(nut("Lưu hoá đơn").disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Lý do xuất theo số đã thu"), { target: { value: "ngắn" } });
    expect(nut("Lưu hoá đơn").disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Lý do xuất theo số đã thu"), { target: { value: "  PH xin trả nốt kỳ sau  " } });
    expect(nut("Lưu hoá đơn").disabled).toBe(false);
    fireEvent.click(nut("Lưu hoá đơn"));
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(h.luu.mock.calls[0]![0]).toMatchObject({ soTienDaThay: 3_000_000, theoSoDaThu: { lyDo: "PH xin trả nốt kỳ sau" } });
  });

  it("[BCT-07b] đối chứng: lần thu ĐỦ ⇒ không có ô chọn, Lưu sáng khi có tệp, gửi theoSoDaThu = null", async () => {
    h.taiTep.mockResolvedValue({ khoa: "hoa-don/x.pdf", ten: "hd.pdf", co: 10, sha256: "ab".repeat(32) });
    h.luu.mockResolvedValue({ ok: true, data: { hoaDonId: "hd9" } });
    moRong(A);
    expect(screen.queryByRole("checkbox", { name: /Xuất theo số đã thu/ })).toBeNull();
    fireEvent.change(oPdf(), { target: { files: [new File(["%PDF-1.7"], "hd.pdf", { type: "application/pdf" })] } });
    expect(nut("Lưu hoá đơn").disabled).toBe(false);
    fireEvent.click(nut("Lưu hoá đơn"));
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(h.luu.mock.calls[0]![0]).toMatchObject({ soTienDaThay: 3_000_000, theoSoDaThu: null });
  });

  describe("[BCT-08] nghi trùng — bản nháp", () => {
    const CAU = "Khoản khai tay có thể trùng tiền đã về (cùng đơn có khoản chuyển khoản). Đã đối chiếu là KHÔNG trùng ⇒ …";
    const nghi = (daChon: boolean) =>
      dong("dot:n", "Lý Nghi", {
        ngan: "nhap",
        nhan: "Đã tải tệp",
        tone: "info",
        hoaDonNhap: { ...NHAP, khongTrungLyDo: daChon ? "Đối chiếu sao kê 10/09: CK là đợt 2" : null },
        hoaDon: HD_NHAP,
        hanhDong: {
          taiPhieu: true,
          taiLen: { bat: true },
          xacNhan: daChon ? { bat: true, nhan: NHAN } : { bat: false, lyDo: CAU },
          khongXuat: true,
          ganThem: false,
          canhBao: [],
          ngoaiLe: { loai: "KHONG_TRUNG", daChon, cau: CAU },
        },
      });

    it("Xác nhận TẮT + chỉ chỗ bấm; khối mở TẠI CHỖ (không dialog); Ghi nhận tắt <10 ký tự; gửi kèm phiên bản", async () => {
      h.khongTrung.mockResolvedValue({ ok: true, data: { hoaDonId: "hd1" } });
      moRong(nghi(false));
      expect(nut("Xác nhận").disabled).toBe(true);
      expect(screen.getByText("Mở sau khi ghi nhận “Không trùng” ngay trên.")).toBeTruthy();
      fireEvent.click(nut("Không trùng — vẫn xuất…"));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(nut("Ghi nhận không trùng").disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("Vì sao không trùng?"), { target: { value: "trùng?" } });
      expect(nut("Ghi nhận không trùng").disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("Vì sao không trùng?"), { target: { value: "Đối chiếu sao kê 10/09: CK là đợt 2" } });
      expect(nut("Ghi nhận không trùng").disabled).toBe(false);
      fireEvent.click(nut("Ghi nhận không trùng"));
      await waitFor(() => expect(h.refresh).toHaveBeenCalled());
      expect(h.khongTrung).toHaveBeenCalledWith({
        orderId: "don-dot:n",
        hoaDonId: "hd1",
        phienBan: PB,
        lyDo: "Đối chiếu sao kê 10/09: CK là đợt 2",
      });
    });

    it("đã ghi nhận ⇒ nói lại lý do, KHÔNG còn nút mở khối; Xác nhận sáng; không in lại câu lối ra", () => {
      moRong(nghi(true));
      expect(screen.getByText("Đã xác nhận không trùng: “Đối chiếu sao kê 10/09: CK là đợt 2”")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Không trùng — vẫn xuất/ })).toBeNull();
      expect(nut(NHAN).disabled).toBe(false);
      expect(screen.queryByText(CAU)).toBeNull();
    });
  });

  it("[BCT-08b] Xác nhận gửi ĐÚNG phiên bản + nhãn đã thấy; toast nói gửi tới đâu", async () => {
    const d = dong("dot:x", "Mai Xác", {
      ngan: "nhap",
      nhan: "Đã tải tệp",
      tone: "info",
      hoaDonNhap: NHAP,
      hoaDon: HD_NHAP,
      hanhDong: {
        taiPhieu: true,
        taiLen: { bat: true },
        xacNhan: { bat: true, nhan: NHAN },
        khongXuat: true,
        ganThem: false,
        canhBao: [],
        ngoaiLe: null,
      },
    });
    h.xacNhan.mockResolvedValue({ ok: true, data: { daXacNhan: 1, conCho: [], keKe: null, guiToi: "ph***@gmail.com" } });
    moRong(d);
    fireEvent.click(nut(NHAN));
    await waitFor(() => expect(h.xacNhan).toHaveBeenCalledTimes(1));
    expect(h.xacNhan).toHaveBeenCalledWith({ orderId: "don-dot:x", hoaDonId: "hd1", phienBan: PB, nhanDaThay: NHAN });
    await waitFor(() => expect(h.toastOk).toHaveBeenCalledWith("Đã xác nhận hoá đơn · cấp 1 phiếu thu · đang gửi tới ph***@gmail.com"));
  });

  it("[BCT-09] ngăn ĐƠN HUỶ ⇒ nói đúng câu của luật, KHÔNG có ô tải hoá đơn", () => {
    const lyDo = "Đợt của lần thu này đã bị huỷ — chọn 'Không xuất' hoặc xử lý hoàn tiền";
    const d = dong("dot:h", "Đặng Huỷ", {
      ngan: "don-huy",
      nhan: "Đợt đã huỷ",
      tone: "muted",
      hanhDong: {
        taiPhieu: true,
        taiLen: { bat: false, lyDo },
        xacNhan: { bat: false, lyDo },
        khongXuat: true,
        ganThem: false,
        canhBao: [],
        ngoaiLe: null,
      },
    });
    moRong(d);
    expect(screen.getByText(lyDo)).toBeTruthy();
    expect(screen.queryByLabelText("Tệp PDF hoá đơn")).toBeNull();
    expect(screen.queryByText("Đơn đã huỷ — không tải hoá đơn cho lần thu này.")).toBeNull();
  });
});

describe("[BCT-10/11] GĐ 8 — email cho khách trên dòng đã xuất", () => {
  const HD_XN = { id: "hd1", trangThai: "DA_XAC_NHAN" as const, nguon: "TAI_LEN" as const, kyHieu: "1C26TSR", soHoaDon: "127", ngayPhatHanh: "2026-09-20", coPdf: true, coXml: false };
  const LOI = { loai: "LOI" as const, nhan: "Gửi email tới ph***@gmail.com không được — tải về gửi qua Zalo", tone: "danger" as const, chiTiet: null };
  const daXuat = (email: Partial<NonNullable<DongHangCho["email"]>> = {}) =>
    dong("dot:e", "Hà Email", {
      ngan: "da-xuat",
      nhan: "Đã xuất",
      tone: "success",
      hoaDon: HD_XN,
      huy: { bat: true },
      email: { trangThai: LOI, lanGui: 1, guiLai: { bat: true, nhan: "Gửi lại email" }, toiMacDinh: "ph***@gmail.com", toiDon: null, ...email },
    });
  const moRong = (d: DongHangCho) => render(dung(d, { ngan: d.ngan, dongTrongNgan: [d] }));
  const nut = (ten: string | RegExp) => screen.getByRole("button", { name: ten }) as HTMLButtonElement;

  it("[BCT-10] trạng thái + lượt; 'Gửi lại email' gửi đúng địa chỉ ĐÃ THẤY rồi làm mới; đang chạy ⇒ tắt + nói lý do", async () => {
    h.guiLai.mockResolvedValue({ ok: true, data: { toi: "ph***@gmail.com", lanGui: 2 } });
    const { unmount } = moRong(daXuat());
    const khoi = screen.getByRole("region", { name: "Email cho khách" });
    expect(khoi.textContent).toContain(LOI.nhan);
    expect(khoi.textContent).toContain("lượt 1");
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(nut("Gửi lại email"));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.guiLai).toHaveBeenCalledWith({ orderId: "don-dot:e", hoaDonId: "hd1", nguon: "HOA_DON", toiDaThay: "ph***@gmail.com" });
    expect(h.toastOk).toHaveBeenCalledWith("Đã xếp lượt gửi thứ 2 tới ph***@gmail.com — email đi trong vài phút");
    unmount();

    const lyDo = "Lượt gửi trước còn đang chạy — đợi kết quả rồi hãy gửi lại";
    moRong(daXuat({ guiLai: { bat: false, lyDo, nhan: "Gửi lại email" } }));
    expect(nut("Gửi lại email").disabled).toBe(true);
    expect(screen.getByText(lyDo)).toBeTruthy();
  });

  it("[BCT-11] gửi tới email HIỆN TẠI của đơn phải bấm HAI lần; lần một KHÔNG gọi action", async () => {
    h.guiLai.mockResolvedValue({ ok: true, data: { toi: "ke***@example.com", lanGui: 2 } });
    moRong(daXuat({ toiDon: "ke***@example.com" }));
    fireEvent.click(screen.getByRole("radio", { name: /Email hiện tại của đơn\s*ke\*\*\*@example\.com/ }));
    fireEvent.click(nut("Gửi lại email"));
    expect(h.guiLai).not.toHaveBeenCalled();
    fireEvent.click(nut("Bấm lần nữa để gửi tới ke***@example.com"));
    await waitFor(() => expect(h.guiLai).toHaveBeenCalledTimes(1));
    expect(h.guiLai).toHaveBeenCalledWith({ orderId: "don-dot:e", hoaDonId: "hd1", nguon: "DON_HIEN_TAI", toiDaThay: "ke***@example.com" });
  });
});

describe("[BCT-KEY] không phần tử anh em nào trùng `key` trong ngăn", () => {
  // Smoke 27/09 bắt hai lần trong một ngày: hai khối anh em cùng `key={hoaDon.id}` ⇒ React cảnh báo và
  // có thể vẽ lặp / bỏ sót khối (khối email hiện hai lần; khối "Không trùng" + nút Xác nhận). Không ca
  // hành vi nào đỏ vì khối vẫn có mặt — chỉ cảnh báo của React nói ra, nên lưới đọc đúng cảnh báo ấy.
  const trungKhoa = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((c) => c.some((x) => typeof x === "string" && x.includes("same key")));
  const HD = { id: "hd1", nguon: "TAI_LEN" as const, kyHieu: "1C26TSR", soHoaDon: "127", ngayPhatHanh: "2026-09-20", coPdf: true, coXml: false };

  it("dòng đã xuất có email + nút huỷ; dòng nháp nghi trùng có 'Không trùng' + nút Xác nhận ⇒ 0 cảnh báo", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const daXuat = dong("dot:k1", "Khoá Một", {
        ngan: "da-xuat",
        hoaDon: { ...HD, trangThai: "DA_XAC_NHAN" },
        huy: { bat: true },
        email: {
          trangThai: { loai: "DA_GUI", nhan: "Đã gửi", tone: "success", chiTiet: null },
          lanGui: 1,
          guiLai: { bat: true, nhan: "Gửi lại email" },
          toiMacDinh: "ph***@gmail.com",
          toiDon: null,
        },
      });
      const { unmount } = render(dung(daXuat, { ngan: "da-xuat", dongTrongNgan: [daXuat] }));
      unmount();
      const CAU = "nghi trùng";
      const nghi = dong("dot:k2", "Khoá Hai", {
        ngan: "nhap",
        hoaDon: { ...HD, trangThai: "NHAP" },
        hoaDonNhap: {
          id: "hd1",
          kyHieu: "1C26TSR",
          soHoaDon: "127",
          ngayPhatHanh: "2026-09-20",
          tepPdfTen: "hd.pdf",
          tepXmlTen: null,
          guiEmailKhach: true,
          phienBan: "2026-09-20T01:00:00.000Z",
          xuatTheoSoDaThu: false,
          xuatTheoSoDaThuLyDo: null,
          khongTrungLyDo: null,
        },
        hanhDong: {
          taiPhieu: true,
          taiLen: { bat: true },
          xacNhan: { bat: false, lyDo: CAU },
          khongXuat: true,
          ganThem: false,
          canhBao: [],
          ngoaiLe: { loai: "KHONG_TRUNG", daChon: false, cau: CAU },
        },
      });
      render(dung(nghi, { ngan: "nhap", dongTrongNgan: [nghi] }));
      expect(screen.getByRole("button", { name: "Không trùng — vẫn xuất…" })).toBeTruthy();
      expect(trungKhoa(spy)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("[BCT-12/13] GĐ 8b — mục Gắn ghi danh", () => {
  const DAU = "cd".repeat(32);
  const coGan = () => dong("dot:g", "Lý Gắn", { khoanChuaGanGhiDanh: [{ id: "p-dot:g", soTien: 3_000_000 }], coTheGanGhiDanh: true });
  const moRong = (d: DongHangCho) => render(dung(d, { dongTrongNgan: [d] }));
  const kiem = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Kiểm gắn ghi danh…" }));
    await waitFor(() => expect(h.xemTruocGan).toHaveBeenCalled());
  };

  it("[BCT-12] dòng không cần gắn ⇒ KHÔNG có mục; không khoản nào gắn được ⇒ KHÔNG có nút gắn, chỉ nói lý do", async () => {
    const { unmount } = moRong(dong("dot:k", "Không Gắn"));
    expect(screen.queryByRole("region", { name: "Gắn ghi danh" })).toBeNull();
    unmount();

    const LY_DO = "Học viên của đơn chưa có ghi danh — xếp lớp trước";
    h.xemTruocGan.mockResolvedValue({
      ok: true,
      data: { key: "dot:g", dau: DAU, chan: null, soGan: 0, soTach: 0, dong: [{ paymentId: "p", soTienLabel: "3.000.000đ", ngayLabel: "16/09/2026", trongLanThu: true, ketQua: "BO_QUA", dich: [], lyDo: LY_DO }] },
    });
    moRong(coGan());
    await kiem();
    expect(await screen.findByText("Chưa gắn được khoản nào — xem lý do ở từng khoản trên")).toBeTruthy();
    // Lý do nói ĐÚNG MỘT lần — ở dòng khoản (smoke 27/09: bản đầu in cả ở dòng lẫn câu tổng).
    expect(screen.getAllByText(new RegExp(LY_DO)).length).toBe(1);
    expect(screen.queryByRole("button", { name: /^Gắn ghi danh cho/ })).toBeNull();
  });

  it("[BCT-12b] đối chứng: có khoản gắn được ⇒ in đích + nút đếm đúng (kèm số khoản chia)", async () => {
    h.xemTruocGan.mockResolvedValue({
      ok: true,
      data: {
        key: "dot:g",
        dau: DAU,
        chan: null,
        soGan: 1,
        soTach: 1,
        dong: [
          { paymentId: "p1", soTienLabel: "3.000.000đ", ngayLabel: "16/09/2026", trongLanThu: true, ketQua: "GAN", dich: [{ ten: "Nguyễn Bé Một", khoa: "Sata 4", lop: "S4-A", soTienLabel: "3.000.000đ" }], lyDo: null },
          { paymentId: "p2", soTienLabel: "5.000.000đ", ngayLabel: "18/09/2026", trongLanThu: false, ketQua: "TACH", dich: [{ ten: "Bé A", khoa: "Sata 4", lop: null, soTienLabel: "3.000.000đ" }, { ten: "Bé B", khoa: "Sata 3", lop: null, soTienLabel: "2.000.000đ" }], lyDo: null },
        ],
      },
    });
    moRong(coGan());
    await kiem();
    const muc = await screen.findByRole("region", { name: "Gắn ghi danh" });
    expect(muc.textContent).toContain("→ Nguyễn Bé Một · Sata 4 · S4-A");
    expect(muc.textContent).toContain("→ chia 3.000.000đ cho Bé A (Sata 4) · 2.000.000đ cho Bé B (Sata 3)");
    expect(muc.textContent).toContain("(lần thu khác của đơn)");
    expect(screen.getByRole("button", { name: "Gắn ghi danh cho 2 khoản (chia 1 khoản theo bé)" })).toBeTruthy();
  });

  it("[BCT-13] bấm gắn ⇒ gửi ĐÚNG dấu kế hoạch đã xem; báo xong + bước tiếp; làm mới", async () => {
    h.xemTruocGan.mockResolvedValue({
      ok: true,
      data: { key: "dot:g", dau: DAU, chan: null, soGan: 1, soTach: 0, dong: [{ paymentId: "p1", soTienLabel: "3.000.000đ", ngayLabel: "", trongLanThu: true, ketQua: "GAN", dich: [{ ten: "Bé", khoa: "Sata 4", lop: null, soTienLabel: "3.000.000đ" }], lyDo: null }] },
    });
    h.ganGhiDanh.mockResolvedValue({ ok: true, data: { gan: 1, tach: 0, thongDiep: "Đã gắn ghi danh cho 1 khoản", buocTiep: "Tải hoá đơn lên rồi bấm Xác nhận để cấp phiếu thu" } });
    moRong(coGan());
    await kiem();
    fireEvent.click(await screen.findByRole("button", { name: "Gắn ghi danh cho 1 khoản" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.ganGhiDanh).toHaveBeenCalledWith({ orderId: "don-dot:g", lanThuKey: "dot:g", dauKeHoach: DAU });
    expect(h.toastOk).toHaveBeenCalledWith("Đã gắn ghi danh cho 1 khoản");
    expect(h.toastWarn).toHaveBeenCalledWith("Tải hoá đơn lên rồi bấm Xác nhận để cấp phiếu thu");
  });
});

// ─── Bộ lọc cơ sở + tháng (PLAN §10 "[CS1 ▾] [Tháng 9 ▾]") · bảng mở trang của dòng đang chọn ─────
describe("[BCT-14..17] bộ lọc cơ sở + tháng — URL giữ bộ lọc; ô chỉ bày thứ có tác dụng", () => {
  const LOC_CS1 = {
    url: { coSo: "cs1", thang: "2026-08" },
    coSo: "cs1",
    thang: "2026-08",
    thangMacDinh: "2026-09",
    cacCoSo: [
      { id: "cs1", ma: "CS1", ten: "Cơ sở 1" },
      { id: "cs2", ma: "CS2", ten: "Cơ sở 2" },
    ],
    cacThang: [
      { gia: "2026-09", nhan: "Tháng 9/2026" },
      { gia: "2026-08", nhan: "Tháng 8/2026" },
    ],
  };

  it("[BCT-14] đổi ngăn + chọn dòng ⇒ URL GIỮ cơ sở + tháng", () => {
    render(dung(null, { loc: LOC_CS1 }));
    const tab = screen.getByRole("link", { name: /Đã xuất/ });
    expect(tab.getAttribute("href")).toBe("/payments/hoa-don?ngan=da-xuat&coSo=cs1&thang=2026-08");
    const nut = screen.getAllByRole("button", { name: /Trần Thị Bình/ });
    fireEvent.click(nut[nut.length - 1]!);
    expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don?ngan=cho&chon=dot%3Ab&coSo=cs1&thang=2026-08", { scroll: false });
  });

  it("[BCT-15] ô cơ sở bày ĐÚNG các cơ sở được truyền (phạm vi kế toán) + 'Tất cả'; đổi ⇒ bỏ dòng chọn, giữ tháng", () => {
    render(dung(A, { loc: LOC_CS1 }));
    const o = screen.getByLabelText("Cơ sở") as HTMLSelectElement;
    expect([...o.options].map((x) => [x.value, x.textContent])).toEqual([
      ["", "Tất cả cơ sở"],
      ["cs1", "CS1 · Cơ sở 1"],
      ["cs2", "CS2 · Cơ sở 2"],
    ]);
    expect(o.value).toBe("cs1");
    fireEvent.change(o, { target: { value: "cs2" } });
    expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don?ngan=cho&coSo=cs2&thang=2026-08", { scroll: false });
  });

  it("[BCT-15b] đối chứng: chỉ làm kế toán MỘT cơ sở ⇒ KHÔNG có ô cơ sở (chọn gì cũng như nhau)", () => {
    render(dung(null, { loc: { ...LOC_CS1, cacCoSo: [LOC_CS1.cacCoSo[0]!] } }));
    expect(screen.queryByLabelText("Cơ sở")).toBeNull();
  });

  it("[BCT-16] ô tháng CHỈ ở ngăn sổ đã xong (Đã xuất / Không xuất); tháng mặc định ⇒ bỏ khỏi URL", () => {
    const { unmount } = render(dung(null, { loc: LOC_CS1 }));
    // Ngăn việc tồn không lọc tháng ⇒ ô tháng ở đây là lời hứa suông (luật 12).
    expect(screen.queryByLabelText("Tháng")).toBeNull();
    unmount();
    render(dung(null, { loc: LOC_CS1, ngan: "da-xuat", dongTrongNgan: [] }));
    const o = screen.getByLabelText("Tháng") as HTMLSelectElement;
    expect(o.value).toBe("2026-08");
    fireEvent.change(o, { target: { value: "2026-09" } });
    expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don?ngan=da-xuat&coSo=cs1", { scroll: false });
  });

  it("[BCT-17] Xác nhận gửi bộ lọc đang xem cho action (dòng kế tiếp tính trên tập đã lọc) và URL mới giữ bộ lọc", async () => {
    const d = dong("dot:x", "Mai Xác", {
      ngan: "nhap",
      nhan: "Đã tải tệp",
      tone: "info",
      hoaDonNhap: {
        id: "hd1",
        kyHieu: "1C26TSR",
        soHoaDon: "127",
        ngayPhatHanh: "2026-09-20",
        tepPdfTen: "hd.pdf",
        tepXmlTen: null,
        guiEmailKhach: true,
        phienBan: "2026-09-20T01:00:00.000Z",
        xuatTheoSoDaThu: false,
        xuatTheoSoDaThuLyDo: null,
        khongTrungLyDo: null,
      },
      hoaDon: { id: "hd1", trangThai: "NHAP", nguon: "TAI_LEN" as const, kyHieu: "1C26TSR", soHoaDon: "127", ngayPhatHanh: "2026-09-20", coPdf: true, coXml: false },
      hanhDong: {
        taiPhieu: true,
        taiLen: { bat: true },
        xacNhan: { bat: true, nhan: "Xác nhận" },
        khongXuat: true,
        ganThem: false,
        canhBao: [],
        ngoaiLe: null,
      },
    });
    h.xacNhan.mockResolvedValue({ ok: true, data: { daXacNhan: 0, conCho: [], keKe: "dot:y", guiToi: null } });
    render(dung(d, { ngan: "nhap", dongTrongNgan: [d], loc: LOC_CS1 }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(h.xacNhan).toHaveBeenCalledTimes(1));
    expect(h.xacNhan.mock.calls[0]![0]).toMatchObject({ coSo: "cs1", thang: "2026-08" });
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don?ngan=nhap&chon=dot%3Ay&coSo=cs1&thang=2026-08", { scroll: false }),
    );
  });
});

describe("[BCT-18] bảng mở TRANG chứa dòng đang chọn (xác nhận xong ⇒ dòng kế tiếp có thể ở trang sau)", () => {
  const NHIEU = Array.from({ length: 25 }, (_, i) => dong(`dot:n${i + 1}`, `Khách số ${i + 1}`));
  // Tên khách của các dòng ĐANG HIỆN trên bảng (ô đầu của nút bấm dòng).
  const tenTrongBang = (c: HTMLElement) =>
    [...c.querySelectorAll("table tbody tr td button > span:first-child")].map((s) => s.textContent);
  // Bảng nhớ TRANG theo tab (sessionStorage, `khoaTrang`) — ca trước lật sang trang 2 thì ca sau khôi
  // phục trang 2. Mỗi ca phải xanh khi chạy MỘT MÌNH (luật 18).
  beforeEach(() => window.sessionStorage.clear());

  it("dòng thứ 23 đang chọn ⇒ bảng hiện trang chứa nó, dòng được tô sáng", () => {
    const { container } = render(dung(NHIEU[22]!, { dongTrongNgan: NHIEU }));
    const hang = [...container.querySelectorAll("table tbody tr")];
    expect(tenTrongBang(container)).toContain("Khách số 23");
    expect(tenTrongBang(container)).not.toContain("Khách số 1");
    expect(hang.find((tr) => tr.textContent?.includes("Khách số 23"))!.getAttribute("aria-selected")).toBe("true");
  });

  it("đối chứng: chưa chọn gì ⇒ trang 1 (dòng đầu hiện ở ngăn)", () => {
    const { container } = render(dung(null, { dongTrongNgan: NHIEU }));
    expect(tenTrongBang(container)).toContain("Khách số 1");
    expect(tenTrongBang(container)).not.toContain("Khách số 23");
  });
});

// Q2 (29/09) — gộp lần thu cùng đơn. Ô chọn chỉ ĐỔI DÒNG ĐANG CHỌN sang khoá gộp; server dựng lại từ khoá.
describe("[BCT-GOP] khối 'Gộp với lần thu khác của đơn'", () => {
  const TIEN_MAT = { key: "k:cash", ngayThuLabel: "12/09/2026", soTien: 2_000_000, nguonLabel: "Tiền mặt / ghi tay", nhan: "Chờ xuất" };
  const CK = { key: "dot:a", ngayThuLabel: "10/09/2026", soTien: 3_000_000, nguonLabel: "Chuyển khoản · FT1", nhan: "Thiếu 2.000.000đ" };

  it("[BCT-GOP-01] dòng chưa gộp: liệt kê lần thu kia (chưa chọn); tick ⇒ chọn dòng khoá gộp, KHÔNG mang ngăn cũ", () => {
    const d = dong("dot:a", "Nguyễn Văn An", { ngan: "lech", gopVoi: [{ ...TIEN_MAT, daGop: false }] });
    render(dung(d, { ngan: "lech", dongTrongNgan: [d] }));
    const khoi = screen.getByRole("region", { name: "Gộp lần thu" });
    expect(khoi.textContent).toContain("Gộp với lần thu khác của đơn");
    const o = screen.getByRole("checkbox", { name: /2\.000\.000đ.*12\/09\/2026.*Tiền mặt/ }) as HTMLInputElement;
    expect(o.checked).toBe(false);
    fireEvent.click(o);
    expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don?chon=gop%3Adot%3Aa%2Bk%3Acash", { scroll: false });
  });

  it("[BCT-GOP-02] dòng gộp: thành phần đều đã chọn; bỏ chọn một ⇒ quay về dòng còn lại (không còn khoá gộp)", () => {
    const d = dong("gop:dot:a+k:cash", "Nguyễn Văn An", {
      soTien: 5_000_000,
      thanhPhanGop: ["dot:a", "k:cash"],
      gopVoi: [
        { ...CK, daGop: true },
        { ...TIEN_MAT, daGop: true },
      ],
    });
    render(dung(d, { dongTrongNgan: [d] }));
    expect(screen.getByRole("region", { name: "Gộp lần thu" }).textContent).toContain("Đang gộp 2 lần thu");
    const khoi = screen.getByRole("region", { name: "Gộp lần thu" });
    const o = within(khoi).getAllByRole("checkbox").filter((x) => (x as HTMLInputElement).checked);
    expect(o).toHaveLength(2);
    fireEvent.click(within(khoi).getByRole("checkbox", { name: /^2\.000\.000đ.*12\/09\/2026/ }));
    expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don?chon=dot%3Aa", { scroll: false });
  });

  it("[BCT-GOP-03] lưu nháp dòng gộp ⇒ action nhận ĐÚNG khoá gộp + số của cả tập (server dựng lại từ khoá)", async () => {
    h.taiTep.mockResolvedValue({ khoa: "hoa-don/x.pdf", ten: "hd.pdf", co: 10, sha256: "ab".repeat(32) });
    h.luu.mockResolvedValue({ ok: true, data: { hoaDonId: "hd1" } });
    const d = dong("gop:dot:a+k:cash", "Nguyễn Văn An", {
      soTien: 5_000_000,
      thanhPhanGop: ["dot:a", "k:cash"],
      gopVoi: [
        { ...CK, daGop: true },
        { ...TIEN_MAT, daGop: true },
      ],
    });
    render(dung(d, { dongTrongNgan: [d] }));
    fireEvent.change(oPdf(), { target: { files: [new File(["%PDF-1.7"], "hd.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu hoá đơn" }));
    await waitFor(() => expect(h.luu).toHaveBeenCalled());
    expect(h.luu.mock.calls[0]![0]).toMatchObject({ lanThuKey: "gop:dot:a+k:cash", soTienDaThay: 5_000_000 });
  });

  it("[BCT-GOP-04] đối chứng: không có ứng viên gộp, hoặc dòng đã có hoá đơn ⇒ KHÔNG có khối gộp", () => {
    render(dung(A));
    expect(screen.queryByRole("region", { name: "Gộp lần thu" })).toBeNull();
    const coHd = dong("dot:x", "Lê X", {
      ngan: "nhap",
      gopVoi: [{ ...TIEN_MAT, daGop: false }],
      hoaDon: { id: "hd1", trangThai: "NHAP", nguon: "TAI_LEN" as const, kyHieu: "1C26TSR", soHoaDon: "1", ngayPhatHanh: "2026-09-12", coPdf: true, coXml: false },
    });
    render(dung(coHd, { ngan: "nhap", dongTrongNgan: [coHd] }));
    expect(screen.queryByRole("region", { name: "Gộp lần thu" })).toBeNull();
  });
});

// Smoke 30/09 ở 1440 (bảng + ngăn 400px): nhãn "Đang tải tệp MISA · mô phỏng" bị đẩy ra mép phải bảng và bị cắt.
// Gốc: cột Khách để `max-w-[16rem]` trên <td> — bảng `table-layout:auto` BỎ QUA max-width của ô, nên tên dài
// (nowrap) giữ nguyên bề rộng và đẩy cột Trạng thái ra ngoài. Mẹo đúng: ô Khách `w-full max-w-0` ⇒ cột này
// nhận phần CÒN LẠI và `truncate` bên trong mới thật sự cắt; các cột số/nhãn giữ đủ bề rộng chữ.
// jsdom không dựng bố cục ⇒ khoá bằng LỚP của phần tử thật (không đo được px ở đây).
describe("[BCT-07] bảng hàng chờ — nhãn trạng thái dài không bị cắt", () => {
  const dai = dong("dot:c", "Nguyễn Phương Quỳnh Anh Đặng Thị Thuỳ Dương", { nhan: "Đang tải tệp MISA · mô phỏng", tone: "info" });
  it("ô Khách co lại (w-full max-w-0) — cột nhường chỗ là cột tên (đã cắt …), không phải cột trạng thái", () => {
    render(dung(null, { dongTrongNgan: [dai] }));
    const nut = screen.getAllByRole("button", { name: /Quỳnh Anh/ });
    const oKhach = nut[nut.length - 1]!.closest("td")!;
    expect(oKhach.className).toMatch(/(^|\s)w-full(\s|$)/);
    expect(oKhach.className).toMatch(/(^|\s)max-w-0(\s|$)/);
    expect(nut[nut.length - 1]!.className).toMatch(/(^|\s)truncate(\s|$)/);
  });
  it("nhãn trạng thái vẽ ĐỦ chữ, ô của nó không cắt", () => {
    render(dung(null, { dongTrongNgan: [dai] }));
    const nhan = screen.getAllByText("Đang tải tệp MISA · mô phỏng");
    const trongBang = nhan.find((e) => e.closest("table"))!;
    expect(trongBang).toBeTruthy();
    for (const el of [trongBang, trongBang.closest("td")!]) {
      expect(el.className).not.toMatch(/(^|\s)(truncate|overflow-hidden|max-w-\S+)(\s|$)/);
    }
  });
});
