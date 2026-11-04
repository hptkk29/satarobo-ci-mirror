// @vitest-environment jsdom
/**
 * [BCUI-1*] — UI đề xuất điều chỉnh trên PHẦN TỬ THẬT (jsdom): `DeXuatSheet` (xem + duyệt). Hàm gọi máy chủ được TIÊM.
 *
 * Luật 12 ("nút nói thật"): mỗi ca "KHÔNG thấy nút X" đi kèm đối chứng dương "ca kia THẤY nút X" (CLAUDE.md luật 11). `viec` ở đây đúng là thứ `viecCuaNguoiXem` tính (đã so ở
 * `lib/hoa-hong/de-xuat-doc.test.ts` [BCUI-01..03]); ca này kiểm component VẼ đúng theo nó.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  duyetDeXuatAction: vi.fn(),
  tuChoiDeXuatAction: vi.fn(),
}));

import type { DeXuatHienThi } from "@/lib/hoa-hong/de-xuat-doc";
import { DeXuatSheet, nhanNutDuyet, type HanhDongDeXuat } from "./de-xuat-sheet";
import { nhanSoTienDeXuat } from "./nhan-de-xuat";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LY_DO = "Đã đối chiếu hợp đồng và khoản thu, số điều chỉnh đúng";

function dx(p: Partial<DeXuatHienThi> = {}): DeXuatHienThi {
  return {
    id: "clx0000000000abc123",
    nguonGoc: "DISPUTE",
    trangThai: "APPROVED_L1",
    quanTri: "SECOND_APPROVAL_REQUIRED",
    soTien: { rong: 12_000_000, tuyetDoi: 12_000_000 },
    giaoDichGoc: { paymentId: "p1", maDon: "ORD260901000001", soTienThu: 40_000_000, ngayThu: new Date("2026-09-05T03:00:00Z") },
    goi: [{ vai: "SALE", nguoiHuong: "Nguyễn Thị Sale", chenh: 12_000_000, kyVong: 15_000_000, rong: 3_000_000 }],
    lyDoQuanTri: ["Số tiền điều chỉnh 12.000.000đ đạt hoặc vượt ngưỡng 10.000.000đ."],
    canhBao: [],
    lyDo: "Thiếu hoa hồng so với thoả thuận ban đầu",
    nguoiDeXuat: { id: "u-kn", ten: "Nguyễn Thị Sale" },
    capMot: { nguoi: { id: "u-hr1", ten: "HR Một" }, luc: new Date("2026-10-01T03:00:00Z"), lyDo: "Đã kiểm tra hợp đồng gốc" },
    capHai: null,
    tuChoi: null,
    lyDoLoiThoi: null,
    kyGhiSo: null,
    coSoMa: "CS1",
    coSoTen: "Cơ sở 1",
    disputeId: "kn-1",
    leadId: null,
    taoLuc: new Date("2026-10-01T03:00:00Z"),
    viec: { cap: 2, duyet: true, tuChoi: true, lyDoKhong: null },
    moDuocTrang: true,
    ...p,
  };
}

const hanhDong = (kq: Awaited<ReturnType<HanhDongDeXuat["duyet"]>> = { ok: true, ketQua: { loai: "DA_GHI", requestId: "x", origin: "DISPUTE", cap: 2, soDong: 1, tong: 12_000_000, kyGhi: "2026-10" } }) => ({
  duyet: vi.fn(async () => kq),
  tuChoi: vi.fn(async () => kq),
});

describe("[BCUI-10] DeXuatSheet — đủ bảy dữ kiện, mỗi cái một dòng có nhãn", () => {
  it("số tiền đề xuất · giao dịch gốc · lý do · trạng thái · người duyệt 1 · người duyệt 2 · kỳ ghi sổ", () => {
    render(<DeXuatSheet dx={dx()} dongHref="/x" hanhDong={hanhDong()} />);
    expect(screen.getByText("Số tiền đề xuất")).toBeTruthy();
    expect(screen.getByText("+12.000.000đ", { selector: "[data-so-tien]" })).toBeTruthy();
    expect(screen.getByText("Giao dịch gốc")).toBeTruthy();
    expect(screen.getByText(/ORD260901000001/)).toBeTruthy();
    expect(screen.getByText("Lý do")).toBeTruthy();
    expect(screen.getByText("Thiếu hoa hồng so với thoả thuận ban đầu")).toBeTruthy();
    expect(screen.getByText("Vì sao cần hai người duyệt")).toBeTruthy();
    expect(screen.getByText("Trạng thái duyệt")).toBeTruthy();
    expect(screen.getAllByText("Chờ duyệt cấp 2").length).toBeGreaterThan(0);
    expect(screen.getByText("Người duyệt 1")).toBeTruthy();
    expect(screen.getByText(/HR Một/)).toBeTruthy();
    expect(screen.getByText("Người duyệt 2")).toBeTruthy();
    expect(screen.getByText("Chưa duyệt")).toBeTruthy();
    expect(screen.getByText("Kỳ ghi sổ")).toBeTruthy();
    expect(screen.getByText("Chưa ghi sổ")).toBeTruthy();
  });

  it("đề xuất ĐÃ GHI SỔ: kỳ ghi sổ hiện 'Kỳ 10/2026', người duyệt 2 hiện tên; đối chứng với ca trên (chưa ghi sổ)", () => {
    const d = dx({ trangThai: "POSTED", kyGhiSo: "2026-10", capHai: { nguoi: { id: "u-hr2", ten: "HR Hai" }, luc: new Date("2026-10-02T03:00:00Z"), lyDo: "Đồng ý" }, viec: { cap: null, duyet: false, tuChoi: false, lyDoKhong: null } });
    render(<DeXuatSheet dx={d} dongHref="/x" hanhDong={hanhDong()} />);
    expect(screen.getByText("Kỳ 10/2026")).toBeTruthy();
    expect(screen.getByText(/HR Hai/)).toBeTruthy();
    expect(screen.queryByText("Chưa ghi sổ")).toBeNull();
  });

  it("MỘT người duyệt là đủ ⇒ dòng Người duyệt 2 nói 'Không cần' (không để trống khó hiểu)", () => {
    render(<DeXuatSheet dx={dx({ quanTri: "SINGLE_APPROVAL", lyDoQuanTri: [], trangThai: "PENDING", capMot: null, viec: { cap: 1, duyet: true, tuChoi: true, lyDoKhong: null } })} dongHref="/x" hanhDong={hanhDong()} />);
    expect(screen.getByText(/Không cần — một người duyệt là đủ/)).toBeTruthy();
  });

  it("có cảnh báo gian lận ⇒ nêu ra (role=status); đối chứng: không cảnh báo ⇒ không có", () => {
    const { rerender } = render(<DeXuatSheet dx={dx({ canhBao: ["TU_CLAIM"] })} dongHref="/x" hanhDong={hanhDong()} />);
    expect(screen.getByRole("status").textContent).toContain("TU_CLAIM");
    rerender(<DeXuatSheet dx={dx()} dongHref="/x" hanhDong={hanhDong()} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("[BCUI-11] DeXuatSheet — nút Duyệt chỉ vẽ khi máy chủ SẼ nhận (luật 12)", () => {
  it("viec.duyet=false ⇒ KHÔNG nút Duyệt/Từ chối, chỉ lý do; đối chứng: viec.duyet=true ⇒ thấy cả hai nút", () => {
    const khong = dx({ viec: { cap: 2, duyet: false, tuChoi: false, lyDoKhong: "Bạn đã duyệt cấp 1 — cấp 2 phải là một người khác." } });
    const { rerender } = render(<DeXuatSheet dx={khong} dongHref="/x" hanhDong={hanhDong()} />);
    expect(screen.queryByRole("button", { name: /Duyệt/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Từ chối/ })).toBeNull();
    expect(screen.getByText(/phải là một người khác/)).toBeTruthy();
    rerender(<DeXuatSheet dx={dx()} dongHref="/x" hanhDong={hanhDong()} />);
    expect(screen.getByRole("button", { name: /Duyệt cấp 2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Từ chối đề xuất" })).toBeTruthy();
  });

  it("nhãn nút nói đúng việc sẽ xảy ra: cấp 1 của đề xuất hai người CHƯA ghi sổ; cấp 2 / một người ⇒ ghi sổ kèm số tiền", () => {
    expect(nhanNutDuyet({ quanTri: "SECOND_APPROVAL_REQUIRED", viec: { cap: 1, duyet: true, tuChoi: true, lyDoKhong: null }, soTien: { rong: 1, tuyetDoi: 1 } })).toBe("Duyệt cấp 1 — chưa ghi sổ");
    expect(nhanNutDuyet({ quanTri: "SECOND_APPROVAL_REQUIRED", viec: { cap: 2, duyet: true, tuChoi: true, lyDoKhong: null }, soTien: { rong: 12_000_000, tuyetDoi: 12_000_000 } })).toBe("Duyệt cấp 2 và ghi +12.000.000đ vào kỳ đang mở");
    expect(nhanNutDuyet({ quanTri: "SINGLE_APPROVAL", viec: { cap: 1, duyet: true, tuChoi: true, lyDoKhong: null }, soTien: { rong: -500_000, tuyetDoi: 500_000 } })).toBe("Duyệt và ghi −500.000đ vào kỳ đang mở");
  });

  it("đã kết thúc ⇒ khu Xử lý nói 'đã kết thúc', không nút", () => {
    render(<DeXuatSheet dx={dx({ trangThai: "REJECTED", viec: { cap: null, duyet: false, tuChoi: false, lyDoKhong: null } })} dongHref="/x" hanhDong={hanhDong()} />);
    expect(screen.getByText(/đã kết thúc/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Duyệt|Từ chối/ })).toBeNull();
  });
});

describe("[BCUI-12] DeXuatSheet — gửi duyệt", () => {
  it("lý do quá ngắn ⇒ lỗi CẠNH ô, KHÔNG gọi máy chủ; đủ dài ⇒ gọi duyệt với đúng {requestId, nguonGoc, lyDo} rồi làm mới", async () => {
    const h = hanhDong();
    render(<DeXuatSheet dx={dx()} dongHref="/x" hanhDong={h} />);
    fireEvent.click(screen.getByRole("button", { name: /Duyệt cấp 2/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/ít nhất/);
    expect(h.duyet).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: /Duyệt cấp 2/ }));
    await waitFor(() => expect(h.duyet).toHaveBeenCalledTimes(1));
    expect(h.duyet).toHaveBeenCalledWith({ requestId: "clx0000000000abc123", nguonGoc: "DISPUTE", lyDo: LY_DO });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
    expect(TOAST.success).toHaveBeenCalledWith("Đã duyệt và ghi điều chỉnh vào sổ.");
  });

  it("kết quả LỖI THỜI ⇒ nói thẳng 'KHÔNG ghi sổ' và không báo thành công", async () => {
    const h = hanhDong({ ok: true, ketQua: { loai: "LOI_THOI", requestId: "x", origin: "DISPUTE", lyDo: "Số ròng đã đổi" } });
    render(<DeXuatSheet dx={dx()} dongHref="/x" hanhDong={h} />);
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: /Duyệt cấp 2/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/KHÔNG ghi sổ/));
    expect(TOAST.success).not.toHaveBeenCalled();
  });

  it("cấp 1 của đề xuất hai người ⇒ toast nói 'chờ người duyệt cấp 2. Sổ chưa đổi'; từ chối gọi đúng hàm tuChoi", async () => {
    const h1 = hanhDong({ ok: true, ketQua: { loai: "DA_DUYET_CAP_1", requestId: "x", origin: "SOURCE_CHANGE" } });
    const d = dx({ trangThai: "PENDING", capMot: null, nguonGoc: "SOURCE_CHANGE", viec: { cap: 1, duyet: true, tuChoi: true, lyDoKhong: null } });
    const { unmount } = render(<DeXuatSheet dx={d} dongHref="/x" hanhDong={h1} />);
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: "Duyệt cấp 1 — chưa ghi sổ" }));
    await waitFor(() => expect(TOAST.success).toHaveBeenCalledWith("Đã duyệt cấp 1 — chờ người duyệt cấp 2. Sổ chưa đổi."));
    unmount();

    const h2 = hanhDong({ ok: true, ketQua: { loai: "DA_TU_CHOI", requestId: "x", origin: "SOURCE_CHANGE" } });
    render(<DeXuatSheet dx={d} dongHref="/x" hanhDong={h2} />);
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: "Từ chối đề xuất" }));
    await waitFor(() => expect(h2.tuChoi).toHaveBeenCalledTimes(1));
    expect(h2.duyet).not.toHaveBeenCalled();
  });

  it("máy chủ từ chối (ok=false) ⇒ hiện câu của máy chủ, không làm mới trang", async () => {
    const h = hanhDong({ ok: false, loi: [], chung: "Bạn không có quyền duyệt đề xuất điều chỉnh hoa hồng (commission_disputes:review)." });
    render(<DeXuatSheet dx={dx()} dongHref="/x" hanhDong={h} />);
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: /Duyệt cấp 2/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/không có quyền/));
    expect(ROUTER.refresh).not.toHaveBeenCalled();
  });
});

describe("[BCUI-30] số tiền đề xuất NÓI THẬT: chuyển giữa hai người hưởng không được in «0đ» (chụp thật 1280px 10/10/2026 bắt được)", () => {
  // Gốc: gói đổi nguồn «A −16 triệu · B +16 triệu» có ròng 0 ⇒ tiêu đề Sheet in «0đ», nút «Duyệt … và ghi 0đ vào kỳ», cột bảng «0đ» — người duyệt không thấy số tiền đang dịch chuyển.
  it("[BCUI-30a] hàm thuần: một chiều ⇒ số có dấu như cũ; ròng 0 ⇒ «Chuyển X»; lệch ⇒ «Điều chỉnh X» + dòng tổng ròng", () => {
    expect(nhanSoTienDeXuat({ rong: 12_000_000, tuyetDoi: 12_000_000 })).toMatchObject({ chinh: "+12.000.000đ", phu: null });
    expect(nhanSoTienDeXuat({ rong: -500_000, tuyetDoi: 500_000 })).toMatchObject({ chinh: "−500.000đ", phu: null });
    const chuyen = nhanSoTienDeXuat({ rong: 0, tuyetDoi: 16_000_000 });
    expect(chuyen.chinh).toBe("Chuyển 16.000.000đ");
    expect(chuyen.phu).toMatch(/tổng hoa hồng không đổi/);
    const lech = nhanSoTienDeXuat({ rong: 2_000_000, tuyetDoi: 5_000_000 });
    expect(lech.chinh).toBe("Điều chỉnh 5.000.000đ");
    expect(lech.phu).toBe("Tổng hoa hồng +2.000.000đ");
  });

  it("[BCUI-30b] Sheet: tiêu đề số tiền của gói chuyển là «Chuyển 16.000.000đ» và có dòng phụ; KHÔNG in «0đ» làm số chính; đối chứng: gói một chiều vẫn «+12.000.000đ»", () => {
    const chuyen = dx({
      soTien: { rong: 0, tuyetDoi: 16_000_000 },
      goi: [
        { vai: "SOURCE_OWNER", nguoiHuong: "Chủ cũ", chenh: -16_000_000, kyVong: 0, rong: 16_000_000 },
        { vai: "SOURCE_OWNER", nguoiHuong: "Chủ mới", chenh: 16_000_000, kyVong: 16_000_000, rong: 0 },
      ],
    });
    const { rerender } = render(<DeXuatSheet dx={chuyen} dongHref="/x" hanhDong={hanhDong()} />);
    const so = document.querySelector("[data-so-tien]") as HTMLElement;
    expect(so.textContent).toBe("Chuyển 16.000.000đ");
    expect(screen.getByText(/tổng hoa hồng không đổi/)).toBeTruthy();
    rerender(<DeXuatSheet dx={dx()} dongHref="/x" hanhDong={hanhDong()} />);
    expect((document.querySelector("[data-so-tien]") as HTMLElement).textContent).toBe("+12.000.000đ");
    expect(screen.queryByText(/tổng hoa hồng không đổi/)).toBeNull();
  });

  it("[BCUI-30c] nhãn nút duyệt của gói chuyển nói «ghi chuyển 16.000.000đ», không «ghi 0đ»", () => {
    const viec = { cap: 2 as const, duyet: true, tuChoi: true, lyDoKhong: null };
    expect(nhanNutDuyet({ quanTri: "SECOND_APPROVAL_REQUIRED", viec, soTien: { rong: 0, tuyetDoi: 16_000_000 } })).toBe("Duyệt cấp 2 và ghi chuyển 16.000.000đ vào kỳ đang mở");
    expect(nhanNutDuyet({ quanTri: "SINGLE_APPROVAL", viec: { ...viec, cap: 1 }, soTien: { rong: 0, tuyetDoi: 160_000 } })).toBe("Duyệt và ghi chuyển 160.000đ vào kỳ đang mở");
  });
});

describe("[BCUI-32] nút duyệt KHÔNG bị cắt ở 375px (chụp thật 375×800 bắt được: «Duyệt cấp 2 và ghi chuyển 14.000.000đ vào kỳ đ…» tràn ra ngoài khung)", () => {
  // jsdom không bố cục nên khẳng định LỚP CSS quyết định việc xuống dòng: dưới `sm` nhãn dài được xuống dòng (không `nowrap`), từ `sm` trở lên giữ một dòng như mọi nút khác.
  it("nút «Duyệt …» cho phép xuống dòng dưới sm; từ sm giữ nowrap; chiều cao không khoá cứng (h-auto) để nhãn hai dòng không bị cắt", () => {
    render(<DeXuatSheet dx={dx({ soTien: { rong: 0, tuyetDoi: 14_000_000 } })} dongHref="/x" hanhDong={hanhDong()} />);
    const nut = screen.getByRole("button", { name: /Duyệt cấp 2 và ghi chuyển 14\.000\.000đ/ });
    const lop = nut.className.split(/\s+/);
    expect(lop).toContain("whitespace-normal");
    expect(lop).toContain("sm:whitespace-nowrap");
    expect(lop).toContain("h-auto");
    expect(lop).not.toContain("whitespace-nowrap");
    // đối chứng: «Từ chối» nhãn ngắn — giữ khuôn nút chuẩn (nowrap), không bị đổi lây
    expect(screen.getByRole("button", { name: "Từ chối đề xuất" }).className.split(/\s+/)).toContain("whitespace-nowrap");
  });
});
