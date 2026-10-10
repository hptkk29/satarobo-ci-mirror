// @vitest-environment jsdom
/**
 * [NHH-DSP-UI-*] — UI khiếu nại trên PHẦN TỬ THẬT (jsdom): `TaoKhieuNaiNut` (gửi) và `KhieuNaiSheet` (xem + quyết). Hàm gọi máy chủ được TIÊM.
 *
 * Luật 12 ("nút nói thật"): mỗi ca "KHÔNG thấy nút X" đi kèm đối chứng dương "ca kia THẤY nút X" (CLAUDE.md luật 11 — ca chỉ khẳng định SỰ VẮNG MẶT luôn ĐẠT khi tính năng hỏng hoàn toàn).
 * Bảng `viec` ở đây đúng là thứ `viecDuocLam` tính (đã so với service THẬT ở `[NHH-DSP-V1]`); ca này kiểm component VẼ đúng theo bảng ấy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/khieu-nai/_actions", () => ({
  taoKhieuNaiAction: vi.fn(),
  nhanKhieuNaiAction: vi.fn(),
  quyetDinhKhieuNaiAction: vi.fn(),
  dongKhieuNaiAction: vi.fn(),
}));

import type { ChiTietKhieuNai } from "@/lib/hoa-hong/khieu-nai-doc";
import { KhieuNaiSheet, type HanhDongKhieuNai } from "./khieu-nai-sheet";
import { TaoKhieuNaiNut, type KetQuaGui } from "./tao-khieu-nai-nut";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LY_DO = "Dòng hoa hồng này tính thiếu so với thoả thuận ban đầu của tôi";
const BANG_CHUNG = "Tin nhắn Zalo ngày 05/10 của quản lý xác nhận mức hưởng";

// ═══ TaoKhieuNaiNut ═════════════════════════════════════════════════════════════════════════════════════
describe("[NHH-DSP-UI-TK] TaoKhieuNaiNut", () => {
  const dich = { loai: "DONG" as const, id: "dong-1" };

  it("[NHH-DSP-UI-TK1] không có quyền gửi ⇒ KHÔNG vẽ gì (không nút xám); đối chứng: có quyền ⇒ thấy nút", () => {
    const gui = vi.fn();
    const { container, rerender } = render(<TaoKhieuNaiNut dich={dich} coQuyenGui={false} gui={gui} />);
    expect(container.innerHTML).toBe("");
    rerender(<TaoKhieuNaiNut dich={dich} coQuyenGui gui={gui} />);
    expect(screen.getByRole("button", { name: "Khiếu nại dòng này" })).toBeTruthy();
  });

  it("[NHH-DSP-UI-TK2] nhãn theo đích: dòng ⇒ 'Khiếu nại dòng này', khoản thu ⇒ 'Khiếu nại khoản thu này'", () => {
    render(<TaoKhieuNaiNut dich={{ loai: "KHOAN", id: "p1" }} coQuyenGui gui={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Khiếu nại khoản thu này" })).toBeTruthy();
  });

  it("[NHH-DSP-UI-TK3] gửi form trống ⇒ lỗi CẠNH từng ô (lý do, bằng chứng), focus nhảy ô lỗi đầu, KHÔNG gọi máy chủ", async () => {
    const gui = vi.fn();
    render(<TaoKhieuNaiNut dich={dich} coQuyenGui gui={gui} />);
    fireEvent.click(screen.getByRole("button", { name: "Khiếu nại dòng này" }));
    fireEvent.click(screen.getByRole("button", { name: "Gửi khiếu nại" }));
    const lyDo = screen.getByLabelText("Lý do khiếu nại");
    const bc = screen.getByLabelText("Bằng chứng");
    expect(lyDo.getAttribute("aria-invalid")).toBe("true");
    expect(bc.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    await waitFor(() => expect(document.activeElement).toBe(lyDo));
    expect(gui).not.toHaveBeenCalled();
    // sửa một ô ⇒ lỗi ô ấy biến mất, ô kia còn
    fireEvent.change(lyDo, { target: { value: LY_DO } });
    expect(lyDo.getAttribute("aria-invalid")).toBeNull();
    expect(bc.getAttribute("aria-invalid")).toBe("true");
  });

  it("[NHH-DSP-UI-TK4] đủ ô ⇒ gọi máy chủ với đích + lý do + bằng chứng ĐÃ TRIM; thành công ⇒ thấy mã khiếu nại + link mở thẳng nó", async () => {
    const gui = vi.fn<(d: unknown) => Promise<KetQuaGui>>().mockResolvedValue({ ok: true, disputeId: "cmuzmk8e3003vgnr9r5b9yjnk" });
    render(<TaoKhieuNaiNut dich={dich} coQuyenGui gui={gui} />);
    fireEvent.click(screen.getByRole("button", { name: "Khiếu nại dòng này" }));
    fireEvent.change(screen.getByLabelText("Lý do khiếu nại"), { target: { value: `  ${LY_DO}  ` } });
    fireEvent.change(screen.getByLabelText("Bằng chứng"), { target: { value: `  ${BANG_CHUNG} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi khiếu nại" }));
    await waitFor(() => expect(gui).toHaveBeenCalledTimes(1));
    expect(gui.mock.calls[0]![0]).toEqual({ dich, lyDo: LY_DO, bangChung: [{ ghiChu: BANG_CHUNG }] });
    await screen.findByText(/Đã gửi khiếu nại B9YJNK/);
    const link = screen.getByRole("link", { name: "Xem khiếu nại" });
    expect(link.getAttribute("href")).toBe("/nguon-hoa-hong/khieu-nai?tt=tat-ca&mo=cmuzmk8e3003vgnr9r5b9yjnk");
    expect(TOAST.success).toHaveBeenCalledTimes(1);
  });

  it("[NHH-DSP-UI-TK5] máy chủ từ chối theo ô ⇒ lỗi hiện đúng ô; từ chối chung (trùng khiếu nại đang mở) ⇒ hiện đầu form; form KHÔNG đóng, nội dung đã gõ còn nguyên", async () => {
    const gui = vi
      .fn<(d: unknown) => Promise<KetQuaGui>>()
      .mockResolvedValueOnce({ ok: false, loi: [{ truong: "bangChung", thongBao: "Ghi ít nhất một bằng chứng cụ thể." }], chung: null })
      .mockResolvedValueOnce({ ok: false, loi: [], chung: "Bạn đã có một khiếu nại đang xử lý cho mục này." });
    render(<TaoKhieuNaiNut dich={dich} coQuyenGui gui={gui} />);
    fireEvent.click(screen.getByRole("button", { name: "Khiếu nại dòng này" }));
    fireEvent.change(screen.getByLabelText("Lý do khiếu nại"), { target: { value: LY_DO } });
    fireEvent.change(screen.getByLabelText("Bằng chứng"), { target: { value: BANG_CHUNG } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi khiếu nại" }));
    await screen.findByText("Ghi ít nhất một bằng chứng cụ thể.");
    expect(screen.getByLabelText("Bằng chứng").getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText("Lý do khiếu nại") as HTMLTextAreaElement).value).toBe(LY_DO);
    fireEvent.click(screen.getByRole("button", { name: "Gửi khiếu nại" }));
    await screen.findByText("Bạn đã có một khiếu nại đang xử lý cho mục này.");
    expect(screen.queryByText(/Đã gửi khiếu nại/)).toBeNull();
  });

  it("[NHH-DSP-UI-TK6] Huỷ gập form lại; lỗi mạng ⇒ câu thử lại, không văng", async () => {
    const gui = vi.fn<(d: unknown) => Promise<KetQuaGui>>().mockRejectedValue(new Error("mạng"));
    render(<TaoKhieuNaiNut dich={dich} coQuyenGui gui={gui} />);
    fireEvent.click(screen.getByRole("button", { name: "Khiếu nại dòng này" }));
    fireEvent.change(screen.getByLabelText("Lý do khiếu nại"), { target: { value: LY_DO } });
    fireEvent.change(screen.getByLabelText("Bằng chứng"), { target: { value: BANG_CHUNG } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi khiếu nại" }));
    await screen.findByText(/Không gửi được lúc này/);
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.queryByLabelText("Lý do khiếu nại")).toBeNull();
    expect(screen.getByRole("button", { name: "Khiếu nại dòng này" })).toBeTruthy();
  });
});

// ═══ KhieuNaiSheet ══════════════════════════════════════════════════════════════════════════════════════
const KHONG = { nhan: false, nhanLai: false, giao: false, quyet: false, dongDoiNguon: false };

function ctDong(p: Partial<ChiTietKhieuNai> = {}): ChiTietKhieuNai {
  return {
    id: "cmuzmk8e3003vgnr9r5b9yjnk",
    trangThai: "OPEN",
    ketQua: "CHO_XU_LY",
    resolution: null,
    lyDo: LY_DO,
    bangChung: [BANG_CHUNG],
    quyetDinh: null,
    dongDieuChinh: null,
    dich: {
      loai: "DONG",
      dongId: "d1",
      vai: "SALE",
      soTien: 363636,
      ky: "2026-10",
      nguoiHuong: "Lê Thị Phương Liên",
      viSao: { tieuDe: "Hoa hồng phát sinh từ khoản thu · SALE", buoc: [{ nhan: "Công thức", giaTri: "9.090.909đ × 4% = 363.636đ" }], canhBao: [] },
    },
    nguoiKhieuNai: { id: "u-kn", ten: "Lê Thị Phương Liên" },
    nguoiXuLy: null,
    centerId: "cs1",
    coSoTen: "Trụ sở chính - Nguyễn Hữu Thọ",
    taoLuc: new Date("2026-10-12T03:00:00.000Z"),
    lichSu: [{ luc: new Date("2026-10-12T03:00:00.000Z"), hanhDong: "Gửi khiếu nại", nguoi: "Lê Thị Phương Liên", lyDo: null }],
    viec: KHONG,
    daCoDongDoiNguon: null,
    choQuyet: null,
    ...p,
  };
}

const CHO_QUYET = {
  vai: [
    { code: "SALE", ten: "Sale" },
    { code: "REFERRER_EMPLOYEE", ten: "Nhân sự giới thiệu" },
  ],
  ungVienXuLy: [
    { id: "hr1", ten: "HR một" },
    { id: "hr2", ten: "HR hai" },
  ],
};

function hanhDongGia(): HanhDongKhieuNai & { nhan: ReturnType<typeof vi.fn>; quyet: ReturnType<typeof vi.fn>; dong: ReturnType<typeof vi.fn> } {
  return { nhan: vi.fn().mockResolvedValue({ ok: true }), quyet: vi.fn().mockResolvedValue({ ok: true }), dong: vi.fn().mockResolvedValue({ ok: true }) };
}
const veSheet = (ct: ChiTietKhieuNai, hd = hanhDongGia()) => {
  render(<KhieuNaiSheet ct={ct} dongHref="/nguon-hoa-hong/khieu-nai" hanhDong={hd} />);
  return hd;
};
const nut = (ten: string | RegExp) => screen.queryByRole("button", { name: ten });

describe("[NHH-DSP-UI-SH] KhieuNaiSheet — nội dung", () => {
  it("[NHH-DSP-UI-SH10] khiếu nại về DÒNG: người duyệt thấy vai · người hưởng · SỐ TIỀN đang ghi sổ · kỳ NGAY, không cần mở ngăn 'Vì sao'", () => {
    veSheet(ctDong());
    expect(screen.getByText(/Sale \(người chốt đơn\)/)).toBeTruthy();
    expect(screen.getByText("363.636đ")).toBeTruthy();
    expect(screen.getByText(/kỳ 2026-10/)).toBeTruthy();
  });

  it("[NHH-DSP-UI-SH11] duyệt 'sửa nguồn' mà CHƯA đóng ⇒ pill 'chờ đổi nguồn' (không xanh 'xong'); đã CLOSED ⇒ 'Được duyệt — sửa nguồn' (đối chứng)", () => {
    const { unmount } = render(<KhieuNaiSheet ct={ctDong({ trangThai: "APPROVED", ketQua: "DUOC_DUYET_DOI_NGUON", resolution: "SOURCE_CORRECTION" })} dongHref="/x" hanhDong={hanhDongGia()} />);
    expect(screen.getAllByText("Đã duyệt — chờ đổi nguồn").length).toBeGreaterThan(0);
    unmount();
    render(<KhieuNaiSheet ct={ctDong({ trangThai: "CLOSED", ketQua: "DUOC_DUYET_DOI_NGUON", resolution: "SOURCE_CORRECTION" })} dongHref="/x" hanhDong={hanhDongGia()} />);
    expect(screen.queryByText("Đã duyệt — chờ đổi nguồn")).toBeNull();
    expect(screen.getAllByText("Được duyệt — sửa nguồn").length).toBeGreaterThan(0);
  });

  it("[NHH-DSP-UI-SH12] 'Xử lý' đứng TRƯỚC 'Lịch sử'; lý do của bước 'Quyết định' không in hai lần", () => {
    const LY = "Đã đối chiếu biên bản thoả thuận, bù phần thiếu";
    veSheet(
      ctDong({
        trangThai: "CLOSED",
        ketQua: "DUOC_DUYET_DIEU_CHINH_TIEN",
        quyetDinh: { lyDo: LY, nguoi: "HR một", luc: new Date("2026-11-20T03:00:00.000Z") },
        dongDieuChinh: { soTien: 50_000, ky: "2026-11" },
        lichSu: [{ luc: new Date("2026-11-20T03:00:00.000Z"), hanhDong: "Quyết định", nguoi: "HR một", lyDo: LY }],
      }),
    );
    const tieuDe = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(tieuDe.indexOf("Xử lý")).toBeGreaterThan(-1);
    expect(tieuDe.indexOf("Xử lý")).toBeLessThan(tieuDe.indexOf("Lịch sử"));
    expect(screen.getAllByText(LY)).toHaveLength(1);
  });

  it("[NHH-DSP-UI-SH1] hiện mã, kết quả bằng chữ (không mã enum), cơ sở, lý do + bằng chứng đã gửi, 'Vì sao' thu gọn, lịch sử", () => {
    veSheet(ctDong());
    expect(screen.getByText("Khiếu nại B9YJNK")).toBeTruthy();
    expect(screen.getByText("Chờ tiếp nhận")).toBeTruthy();
    expect(screen.getByText(LY_DO)).toBeTruthy();
    expect(screen.getByText(BANG_CHUNG)).toBeTruthy();
    expect(screen.getByText("Không sửa được sau khi gửi.")).toBeTruthy();
    expect(screen.getByText("Vì sao con số này")).toBeTruthy();
    expect(screen.getByText("Gửi khiếu nại")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/OPEN|UNDER_REVIEW|CHO_XU_LY/);
  });

  it("[NHH-DSP-UI-SH2] khiếu nại về KHOẢN THU: người duyệt thấy các dòng của khoản; người khiếu nại thì KHÔNG (dongCuaKhoan = null)", () => {
    const base = { loai: "KHOAN" as const, paymentId: "p1", soTien: 10_000_000, ngayThu: new Date("2026-10-12T03:00:00.000Z"), maDon: "ORD-1" };
    const { unmount } = render(
      <KhieuNaiSheet
        ct={ctDong({ dich: { ...base, dongCuaKhoan: [{ id: "x", vai: "CENTER_MANAGER", nguoiHuong: "Quản lý A", soTien: 200_000, loaiDong: "ORIGINAL", ky: "2026-10", coO: true }] } })}
        dongHref="/x"
        hanhDong={hanhDongGia()}
      />,
    );
    expect(screen.getByText("Các dòng hoa hồng của khoản thu")).toBeTruthy();
    expect(screen.getByText(/Quản lý cơ sở · Quản lý A/)).toBeTruthy();
    unmount();
    render(<KhieuNaiSheet ct={ctDong({ dich: { ...base, dongCuaKhoan: null } })} dongHref="/x" hanhDong={hanhDongGia()} />);
    expect(screen.queryByText("Các dòng hoa hồng của khoản thu")).toBeNull();
  });

  it("[NHH-DSP-UI-SH3] đã quyết: hiện kết quả, người quyết, lý do, số tiền ĐÃ GHI SỔ (có dấu) và kỳ", () => {
    veSheet(
      ctDong({
        trangThai: "CLOSED",
        ketQua: "DUOC_DUYET_DIEU_CHINH_TIEN",
        resolution: "MONEY_ADJUSTMENT",
        quyetDinh: { lyDo: "Đã đối chiếu biên bản, bù phần thiếu", nguoi: "HR một", luc: new Date("2026-11-20T03:00:00.000Z") },
        dongDieuChinh: { soTien: 50_000, ky: "2026-11" },
      }),
    );
    expect(screen.getByText("Quyết định")).toBeTruthy();
    expect(screen.getAllByText("Được duyệt — điều chỉnh tiền").length).toBeGreaterThan(0);
    expect(screen.getByText("Đã đối chiếu biên bản, bù phần thiếu")).toBeTruthy();
    expect(screen.getByText("+50.000đ")).toBeTruthy();
    expect(screen.getByText(/vào kỳ 2026-11/)).toBeTruthy();
  });

  it("[NHH-DSP-UI-SH4] đóng Sheet ⇒ điều hướng về địa chỉ giữ bộ lọc (không rơi về trang trắng)", async () => {
    render(<KhieuNaiSheet ct={ctDong()} dongHref="/nguon-hoa-hong/khieu-nai?tt=tat-ca" hanhDong={hanhDongGia()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Close|Đóng/i })[0]!);
    await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/nguon-hoa-hong/khieu-nai?tt=tat-ca"));
  });
});

describe("[NHH-DSP-UI-SH] KhieuNaiSheet — nút CHỈ vẽ khi máy chủ sẽ nhận (luật 12)", () => {
  it("[NHH-DSP-UI-SH5] người khiếu nại / không giữ quyền duyệt: KHÔNG nút nào, chỉ có câu nói trạng thái; đối chứng: người duyệt THẤY 'Nhận xử lý'", () => {
    veSheet(ctDong());
    expect(nut(/Nhận xử lý|Nhận lại|Giao lại|Đóng khiếu nại|Từ chối|Duyệt/)).toBeNull();
    expect(screen.getByText(/đang chờ HR nhận xử lý/)).toBeTruthy();
    cleanup();
    veSheet(ctDong({ viec: { ...KHONG, nhan: true }, choQuyet: CHO_QUYET }));
    expect(nut("Nhận xử lý")).toBeTruthy();
  });

  it("[NHH-DSP-UI-SH6] 'Nhận xử lý' gọi máy chủ với đúng id rồi làm mới trang; thất bại ⇒ câu lỗi của máy chủ hiện ngay trong khu xử lý", async () => {
    const hd = veSheet(ctDong({ viec: { ...KHONG, nhan: true }, choQuyet: CHO_QUYET }));
    fireEvent.click(nut("Nhận xử lý")!);
    await waitFor(() => expect(hd.nhan).toHaveBeenCalledWith({ disputeId: "cmuzmk8e3003vgnr9r5b9yjnk" }));
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
    cleanup();
    ROUTER.refresh.mockClear();
    const hd2 = hanhDongGia();
    hd2.nhan.mockResolvedValue({ ok: false, loi: [], chung: "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang." });
    veSheet(ctDong({ viec: { ...KHONG, nhan: true }, choQuyet: CHO_QUYET }), hd2);
    fireEvent.click(nut("Nhận xử lý")!);
    await screen.findByText("Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    expect(ROUTER.refresh).not.toHaveBeenCalled();
  });

  it("[NHH-DSP-UI-SH7] đang do NGƯỜI KHÁC xử lý: chỉ 'Nhận lại cho tôi', KHÔNG form quyết định (chỉ người đang xử lý quyết được)", () => {
    veSheet(ctDong({ trangThai: "UNDER_REVIEW", ketQua: "DANG_XEM_XET", nguoiXuLy: { id: "hr1", ten: "HR một" }, viec: { ...KHONG, nhanLai: true }, choQuyet: CHO_QUYET }));
    expect(nut("Nhận lại cho tôi")).toBeTruthy();
    expect(screen.queryByText("Cách giải quyết")).toBeNull();
    expect(screen.getByText(/Đang do HR một xử lý/)).toBeTruthy();
  });

  it("[NHH-DSP-UI-SH8] giao lại: chọn người ⇒ gọi với nguoiNhanId; chưa chọn ⇒ nút TẮT; người đang xử lý không có trong danh sách", async () => {
    const hd = veSheet(
      ctDong({ trangThai: "UNDER_REVIEW", ketQua: "DANG_XEM_XET", nguoiXuLy: { id: "hr1", ten: "HR một" }, viec: { ...KHONG, giao: true, quyet: true }, choQuyet: CHO_QUYET }),
    );
    const giao = nut("Giao lại")!;
    expect((giao as HTMLButtonElement).disabled).toBe(true);
    const chon = screen.getByLabelText("Giao lại cho") as HTMLSelectElement;
    expect(within(chon).queryByText("HR một")).toBeNull();
    fireEvent.change(chon, { target: { value: "hr2" } });
    expect((nut("Giao lại") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(nut("Giao lại")!);
    await waitFor(() => expect(hd.nhan).toHaveBeenCalledWith({ disputeId: "cmuzmk8e3003vgnr9r5b9yjnk", nguoiNhanId: "hr2" }));
  });

  it("[NHH-DSP-UI-SH9] 'sửa nguồn' đã duyệt: CHƯA có dòng đổi nguồn ⇒ KHÔNG nút, nói rõ phải làm gì; CÓ dòng ⇒ nút 'Đóng khiếu nại' gọi máy chủ", async () => {
    const co = { trangThai: "APPROVED" as const, ketQua: "DUOC_DUYET_DOI_NGUON" as const, resolution: "SOURCE_CORRECTION" as const, viec: { ...KHONG, dongDoiNguon: true } };
    veSheet(ctDong({ ...co, daCoDongDoiNguon: false }));
    expect(nut("Đóng khiếu nại")).toBeNull();
    expect(screen.getByText(/chưa thấy dòng điều chỉnh do đổi nguồn/)).toBeTruthy();
    cleanup();
    const hd = veSheet(ctDong({ ...co, daCoDongDoiNguon: true }));
    fireEvent.click(nut("Đóng khiếu nại")!);
    await waitFor(() => expect(hd.dong).toHaveBeenCalledWith({ disputeId: "cmuzmk8e3003vgnr9r5b9yjnk" }));
  });
});

describe("[NHH-DSP-UI-QD] KhieuNaiSheet — form quyết định", () => {
  const dangXuLy = (p: Partial<ChiTietKhieuNai> = {}) =>
    ctDong({ trangThai: "UNDER_REVIEW", ketQua: "DANG_XEM_XET", nguoiXuLy: { id: "hr1", ten: "HR một" }, viec: { ...KHONG, giao: true, quyet: true }, choQuyet: CHO_QUYET, ...p });
  const chonCach = (ten: string) => fireEvent.click(screen.getByLabelText(new RegExp(ten)));

  it("[NHH-DSP-UI-QD1] KHÔNG chọn sẵn cách giải; nút xác nhận TẮT cho tới khi chọn (duyệt nhầm bằng Enter là ghi tiền thật)", () => {
    veSheet(dangXuLy());
    for (const r of screen.getAllByRole("radio")) expect((r as HTMLInputElement).checked).toBe(false);
    expect((nut("Chọn cách giải quyết") as HTMLButtonElement).disabled).toBe(true);
  });

  it("[NHH-DSP-UI-QD2] TỪ CHỐI thiếu lý do ⇒ lỗi cạnh ô, focus vào ô, KHÔNG gọi máy chủ; có lý do ⇒ gọi với { loai: TU_CHOI, lyDo }", async () => {
    const hd = veSheet(dangXuLy());
    chonCach("Từ chối");
    fireEvent.click(nut("Từ chối khiếu nại")!);
    const lyDo = screen.getByLabelText("Lý do quyết định");
    expect(lyDo.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(lyDo));
    expect(hd.quyet).not.toHaveBeenCalled();
    fireEvent.change(lyDo, { target: { value: "Hồ sơ thoả thuận không ghi mức hưởng này" } });
    fireEvent.click(nut("Từ chối khiếu nại")!);
    await waitFor(() => expect(hd.quyet).toHaveBeenCalledWith({ disputeId: "cmuzmk8e3003vgnr9r5b9yjnk", dauVao: { loai: "TU_CHOI", lyDo: "Hồ sơ thoả thuận không ghi mức hưởng này" } }));
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
  });

  it("[NHH-DSP-UI-QD3] ĐIỀU CHỈNH TIỀN (đích dòng): nút nói đúng việc sẽ xảy ra theo dấu + số; Trừ bớt ⇒ số ÂM; thiếu số tiền ⇒ lỗi theo ô soTien", async () => {
    const hd = veSheet(dangXuLy());
    chonCach("Điều chỉnh tiền");
    expect(nut("Duyệt và ghi điều chỉnh")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Lý do quyết định"), { target: { value: "Đã đối chiếu biên bản, bù phần thiếu" } });
    fireEvent.click(nut("Duyệt và ghi điều chỉnh")!);
    expect(screen.getByLabelText("Số tiền điều chỉnh (đồng)").getAttribute("aria-invalid")).toBe("true");
    expect(hd.quyet).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Số tiền điều chỉnh (đồng)"), { target: { value: "50000" } });
    expect(nut("Duyệt và ghi +50.000đ vào kỳ đang mở")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trừ bớt" }));
    expect(nut("Duyệt và ghi −50.000đ vào kỳ đang mở")).toBeTruthy();
    fireEvent.click(nut("Duyệt và ghi −50.000đ vào kỳ đang mở")!);
    await waitFor(() => expect(hd.quyet).toHaveBeenCalledTimes(1));
    expect(hd.quyet.mock.calls[0]![0]).toEqual({
      disputeId: "cmuzmk8e3003vgnr9r5b9yjnk",
      dauVao: { loai: "DUYET_TIEN", lyDo: "Đã đối chiếu biên bản, bù phần thiếu", soTien: -50_000, mauDongId: null, roleCode: null },
    });
  });

  it("[NHH-DSP-UI-QD4] đích KHOẢN THU: phải chọn dòng mẫu + vai; thiếu ⇒ lỗi theo ô; đủ ⇒ payload mang mauDongId + roleCode; khoản chưa có dòng nào ⇒ nói chưa thể ghi điều chỉnh tiền", async () => {
    const dich = (dongCuaKhoan: NonNullable<Extract<ChiTietKhieuNai["dich"], { loai: "KHOAN" }>["dongCuaKhoan"]>): ChiTietKhieuNai["dich"] => ({
      loai: "KHOAN",
      paymentId: "p1",
      soTien: 10_000_000,
      ngayThu: new Date("2026-10-12T03:00:00.000Z"),
      maDon: "ORD-1",
      dongCuaKhoan,
    });
    const dong = (id: string, vai: string, ten: string) => ({ id, vai, nguoiHuong: ten, soTien: 200_000, loaiDong: "ORIGINAL", ky: "2026-10", coO: true });
    const hd = veSheet(dangXuLy({ dich: dich([dong("m1", "CENTER_MANAGER", "Quản lý A"), dong("m2", "MARKETING", "Marketing B")]) }));
    chonCach("Điều chỉnh tiền");
    fireEvent.change(screen.getByLabelText("Lý do quyết định"), { target: { value: "Người giới thiệu có thật theo xác nhận" } });
    fireEvent.change(screen.getByLabelText("Số tiền điều chỉnh (đồng)"), { target: { value: "80000" } });
    fireEvent.click(nut(/Duyệt và ghi \+80\.000đ/)!);
    expect(screen.getByText(/Chọn một dòng hoa hồng của khoản thu này/)).toBeTruthy();
    expect(screen.getByText(/Chọn vai mà người khiếu nại lẽ ra được hưởng/)).toBeTruthy();
    expect(hd.quyet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/Quản lý cơ sở · Quản lý A/));
    fireEvent.change(screen.getByLabelText("Vai người khiếu nại được hưởng"), { target: { value: "REFERRER_EMPLOYEE" } });
    fireEvent.click(nut(/Duyệt và ghi \+80\.000đ/)!);
    await waitFor(() => expect(hd.quyet).toHaveBeenCalledTimes(1));
    expect(hd.quyet.mock.calls[0]![0].dauVao).toEqual({ loai: "DUYET_TIEN", lyDo: "Người giới thiệu có thật theo xác nhận", soTien: 80_000, mauDongId: "m1", roleCode: "REFERRER_EMPLOYEE" });

    cleanup();
    veSheet(dangXuLy({ dich: dich([]) }));
    chonCach("Điều chỉnh tiền");
    expect(screen.getByText(/chưa thể ghi điều chỉnh tiền/)).toBeTruthy();
  });

  it("[NHH-DSP-UI-QD5] máy chủ từ chối theo ô (vd số âm vượt số ròng) ⇒ lỗi hiện ĐÚNG ô soTien, Sheet không đóng, không làm mới trang", async () => {
    const hd = hanhDongGia();
    hd.quyet.mockResolvedValue({ ok: false, loi: [{ truong: "soTien", thongBao: "Không đòi lại quá số đã ghi: số ròng hiện tại của người này ở ô tính là 363636 đồng." }], chung: null });
    veSheet(dangXuLy(), hd);
    chonCach("Điều chỉnh tiền");
    fireEvent.change(screen.getByLabelText("Lý do quyết định"), { target: { value: "Đòi lại phần đã trả thừa theo biên bản" } });
    fireEvent.click(screen.getByRole("button", { name: "Trừ bớt" }));
    fireEvent.change(screen.getByLabelText("Số tiền điều chỉnh (đồng)"), { target: { value: "999999" } });
    fireEvent.click(nut(/Duyệt và ghi −999\.999đ/)!);
    await screen.findByText(/Không đòi lại quá số đã ghi/); // đúng MỘT chỗ: lỗi theo ô không lặp lại ở đầu khu xử lý
    expect(screen.getByLabelText("Số tiền điều chỉnh (đồng)").getAttribute("aria-invalid")).toBe("true");
    expect(ROUTER.refresh).not.toHaveBeenCalled();
  });

  it("[NHH-DSP-UI-QD6] SỬA NGUỒN chỉ cần lý do; nhãn nút nói đúng việc kế tiếp", async () => {
    const hd = veSheet(dangXuLy());
    chonCach("Sửa nguồn");
    expect(nut("Duyệt — sửa nguồn ở màn lead")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Lý do quyết định"), { target: { value: "Nguồn ghi sai, cần sửa ở màn lead" } });
    fireEvent.click(nut("Duyệt — sửa nguồn ở màn lead")!);
    await waitFor(() => expect(hd.quyet).toHaveBeenCalledWith({ disputeId: "cmuzmk8e3003vgnr9r5b9yjnk", dauVao: { loai: "DUYET_DOI_NGUON", lyDo: "Nguồn ghi sai, cần sửa ở màn lead" } }));
  });
});
