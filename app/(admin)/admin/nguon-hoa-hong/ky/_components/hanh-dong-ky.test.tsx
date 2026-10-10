// @vitest-environment jsdom
/**
 * [NHH-KY-FE-01..10] — HÀNG NÚT + BỐN HỘP THOẠI của tab Kỳ trên PHẦN TỬ THẬT, Server Action giả lập.
 *
 * Điều canh ở đây là HÀNH VI mà `tsc` và lưới thuần không chạm tới:
 *   · chỉ nút của `chinh`/`phu` được vẽ; nút `khongVe` KHÔNG có trong DOM (không có nút xám bấm được), chỉ còn lý do;
 *   · hộp thoại khoá đọc lại ĐÚNG các con số + nêu hệ quả (kỳ nhận hoàn tiền sau khi khoá), nút xác nhận khoá cho tới khi lý do đủ dài, và gửi
 *     đi chính bản chụp số liệu đã hiện (để server so);
 *   · server từ chối ⇒ lý do hiện NGAY TRONG hộp thoại, hộp thoại KHÔNG đóng, không toast "thành công";
 *   · xuất bảng chi: tệp tải về đúng lượt xuất, và còn nút tải lại cho tới khi đóng (lượt xuất không lặp lại được).
 * Mỗi ca "không vẽ X" đi kèm đối chứng dương "ca kia vẽ X" (luật 11).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const R = vi.hoisted(() => ({ refresh: vi.fn() }));
const A = vi.hoisted(() => ({ tinh: vi.fn(), rasoat: vi.fn(), tralai: vi.fn(), khoa: vi.fn(), xuat: vi.fn(), dachi: vi.fn() }));
const T = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const F = vi.hoisted(() => ({ taiTep: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: R.refresh }) }));
vi.mock("sonner", () => ({ toast: T }));
vi.mock("../_actions", () => ({
  tinhKyAction: A.tinh,
  chuyenRaSoatAction: A.rasoat,
  traLaiAction: A.tralai,
  khoaKyAction: A.khoa,
  xuatKyAction: A.xuat,
  danhDauDaChiAction: A.dachi,
}));
vi.mock("./tai-tep", () => ({ taiTep: F.taiTep }));

import { hanhDongCuaKy, type DauVaoHanhDong } from "@/lib/hoa-hong/ky-man-hinh";
import { HanhDongKy, type DuLieuHanhDong } from "./hanh-dong-ky";

const SO_LIEU = { coSoTinh: 100_000_000, hoaHong: 3_000_000, dieuChinh: -120_000, soNguoi: 4, lastCalculatedAt: "2026-10-31T10:00:00.000Z" };

function dauVao(p: Partial<DauVaoHanhDong> = {}): DauVaoHanhDong {
  return {
    trangThai: "REVIEWING",
    truocMoc: false,
    coQuyenQuanLy: true,
    soChan: 0,
    lastCalculatedAt: new Date("2026-10-31T10:00:00.000Z"),
    dauVaoMoiNhat: new Date("2026-10-31T09:00:00.000Z"),
    cauChan: null,
    ngayTinhCuoi: "31/10/2026",
    xuatLuongBat: true,
    chuaXuat: { noiBo: 3, ngoai: 0 },
    soLoChoChi: 0,
    ...p,
  };
}

function du(p: Partial<DuLieuHanhDong> & { vao?: Partial<DauVaoHanhDong> } = {}): DuLieuHanhDong {
  const { vao, ...rest } = p;
  const v = dauVao(vao);
  const q = hanhDongCuaKy(v);
  return {
    thang: "2026-10",
    thangNhan: "10/2026",
    centerId: "cs1",
    coSoNhan: "CS1",
    kyId: "ky1",
    trangThai: v.trangThai,
    chinh: q.chinh,
    phu: q.phu,
    khongVe: q.khongVe,
    soLieu: SO_LIEU,
    soChan: v.soChan,
    kyGhiTiepNhan: "11/2026",
    phamViXuat: [
      { coSo: "CS1", trangThai: "LOCKED", soDongNoiBo: 3, tienNoiBo: 900_000, soDongNgoai: 0, tienNgoai: 0 },
      { coSo: "CS2", trangThai: "LOCKED", soDongNoiBo: 2, tienNoiBo: 600_000, soDongNgoai: 1, tienNgoai: 100_000 },
    ],
    soKyChuaKhoa: 2,
    loChoChi: [],
    ...rest,
  };
}

const nut = (ten: string | RegExp) => screen.getByRole("button", { name: ten }) as HTMLButtonElement;
const coNut = (ten: string | RegExp) => screen.queryByRole("button", { name: ten }) !== null;
const dienLyDo = (nhan: string | RegExp, v: string) => fireEvent.change(screen.getByLabelText(nhan), { target: { value: v } });

beforeEach(() => {
  for (const f of [...Object.values(R), ...Object.values(A), ...Object.values(T), ...Object.values(F)]) f.mockReset();
});
afterEach(cleanup);

describe("[NHH-KY-FE-01] nút nào VẼ, nút nào KHÔNG", () => {
  it("REVIEWING sạch ⇒ Khoá là nút CHÍNH (đứng đầu, tô đặc), Trả lại là nút phụ (viền); không có nút Tính/Xuất", () => {
    render(<HanhDongKy d={du()} />);
    const cac = screen.getAllByRole("button");
    expect(cac.map((b) => b.textContent?.trim())).toEqual(["Khoá kỳ", "Trả lại để tính lại"]);
    expect(cac[0]!.className).toMatch(/bg-primary/);
    expect(cac[1]!.className).not.toMatch(/bg-primary /);
    expect(screen.queryAllByRole("button").filter((b) => /bg-primary /.test(b.className))).toHaveLength(1); // đúng MỘT nút chính
    expect(coNut(/^Tính/)).toBe(false);
    expect(coNut(/Xuất/)).toBe(false);
  });

  it("còn hàng chờ chặn ⇒ KHÔNG có nút Khoá trong DOM, lý do nêu ĐÚNG câu từng loại; đối chứng: hết chặn ⇒ có nút Khoá", () => {
    const cau = "3 khoản chờ duyệt tay · 1 khoản vượt trần";
    const { unmount } = render(<HanhDongKy d={du({ vao: { soChan: 4, cauChan: cau } })} />);
    expect(coNut(/Khoá kỳ/)).toBe(false);
    expect(screen.getByText(new RegExp(cau.replace(/·/g, "·")))).toBeTruthy();
    expect(document.querySelector('[data-khong-ve="KHOA"]')).not.toBeNull();
    // Không có bước kế tiếp trong tay người này (việc nằm ở tab Sổ) ⇒ KHÔNG nút nào được tô thành nút chính chỉ vì nó đứng đầu.
    expect(screen.getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Trả lại để tính lại"]);
    expect(screen.getByRole("button", { name: "Trả lại để tính lại" }).className).not.toMatch(/bg-primary /);
    unmount();
    render(<HanhDongKy d={du()} />);
    expect(coNut(/Khoá kỳ/)).toBe(true);
    expect(document.querySelector('[data-khong-ve="KHOA"]')).toBeNull();
  });

  it("không có quyền quản lý ⇒ KHÔNG nút nào, một dòng lý do gọi tên quyền; kỳ chưa mở ⇒ nút 'Mở kỳ và Tính'", () => {
    const { unmount } = render(<HanhDongKy d={du({ vao: { coQuyenQuanLy: false } })} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/commission_periods:manage/)).toBeTruthy();
    unmount();
    render(<HanhDongKy d={du({ kyId: null, trangThai: null, vao: { trangThai: null, lastCalculatedAt: null, dauVaoMoiNhat: null } })} />);
    expect(nut("Mở kỳ và Tính")).toBeTruthy();
  });
});

describe("[NHH-KY-FE-02] Tính / Chuyển rà soát — thao tác một chạm, lỗi hiện NGAY CẠNH nút", () => {
  it("bấm Tính gọi đúng action (tháng + cơ sở), toast thành công, làm mới trang", async () => {
    A.tinh.mockResolvedValue({ ok: true, thongBao: "Đã tính kỳ 10/2026 — quét 12 khoản.", soKhoan: 12 });
    render(<HanhDongKy d={du({ vao: { trangThai: "OPEN", lastCalculatedAt: null, dauVaoMoiNhat: null } })} />);
    fireEvent.click(nut("Tính"));
    await waitFor(() => expect(T.success).toHaveBeenCalledWith("Đã tính kỳ 10/2026 — quét 12 khoản."));
    expect(A.tinh).toHaveBeenCalledWith({ thang: "2026-10", centerId: "cs1" });
    expect(R.refresh).toHaveBeenCalled();
  });

  it("Tính lỗi (có khoản không tính được) ⇒ vùng role=alert liệt kê từng khoản, KHÔNG toast thành công", async () => {
    A.tinh.mockResolvedValue({ ok: false, ma: "TINH_CO_LOI", loi: "2 khoản không tính được — kỳ chưa thể đặt “đã tính”.", chiTiet: ["Khoản p1: thiếu nhóm nguồn", "Khoản p2: lỗi cấu hình"] });
    render(<HanhDongKy d={du({ vao: { trangThai: "OPEN", lastCalculatedAt: null, dauVaoMoiNhat: null } })} />);
    fireEvent.click(nut("Tính"));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/2 khoản không tính được/)).toBeTruthy();
    expect(within(alert).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["Khoản p1: thiếu nhóm nguồn", "Khoản p2: lỗi cấu hình"]);
    expect(T.success).not.toHaveBeenCalled();
    expect(T.error).toHaveBeenCalled();
  });

  it("đang chạy ⇒ MỌI nút bị khoá (không bấm hai lần) và nút đang chạy ghi 'Đang tính…'", async () => {
    let xong: (v: unknown) => void = () => undefined;
    A.tinh.mockReturnValue(new Promise((r) => (xong = r)));
    render(<HanhDongKy d={du({ vao: { trangThai: "CALCULATED" } })} />);
    fireEvent.click(nut("Tính lại"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Đang tính/ })).toBeTruthy());
    expect(screen.getAllByRole<HTMLButtonElement>("button").every((b) => b.disabled)).toBe(true);
    await act(async () => xong({ ok: true, thongBao: "ok", soKhoan: 1 }));
    await waitFor(() => expect(screen.getAllByRole<HTMLButtonElement>("button").every((b) => !b.disabled)).toBe(true));
  });

  it("Chuyển rà soát gọi action với id kỳ", async () => {
    A.rasoat.mockResolvedValue({ ok: true, thongBao: "Đã chuyển kỳ sang rà soát." });
    render(<HanhDongKy d={du({ vao: { trangThai: "CALCULATED" } })} />);
    fireEvent.click(nut("Chuyển rà soát"));
    await waitFor(() => expect(A.rasoat).toHaveBeenCalledWith({ periodId: "ky1" }));
  });
});

describe("[NHH-KY-FE-03] hộp thoại KHOÁ: đọc lại ĐÚNG số, nêu hệ quả, xác nhận đúng bản chụp", () => {
  const mo = () => {
    render(<HanhDongKy d={du()} />);
    fireEvent.click(nut("Khoá kỳ"));
    return screen.getByRole("dialog");
  };

  it("in đủ sáu con số của kỳ (cơ sở tính · hoa hồng · điều chỉnh âm có dấu − · phải chi ròng · số người · chặn còn lại = 0) và kỳ nhận hoàn tiền sau khoá", () => {
    const hop = mo();
    const dl = hop.querySelector("[data-so-lieu-khoa]")!;
    const dong = [...dl.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(dong).toEqual([
      ["Tổng cơ sở tính", "100.000.000đ"],
      ["Tổng hoa hồng", "3.000.000đ"],
      ["Tổng điều chỉnh", "−120.000đ"],
      ["Phải chi ròng", "2.880.000đ"],
      ["Số người hưởng", "4"],
      ["Hàng chờ chặn còn lại", "0"],
    ]);
    expect(within(hop).getByText(/hoàn tiền hoặc điều chỉnh phát sinh cho tháng 10\/2026 sẽ ghi vào kỳ/)).toBeTruthy();
    expect(within(hop).getByText("11/2026")).toBeTruthy();
  });

  it("nút xác nhận KHOÁ cho tới khi lý do đủ 10 ký tự; đủ thì gọi action với CHÍNH bản chụp số liệu đã hiện", async () => {
    A.khoa.mockResolvedValue({ ok: true, thongBao: "Đã khoá kỳ 10/2026." });
    mo();
    const xacNhan = () => document.querySelector<HTMLButtonElement>('[data-xac-nhan="KHOA"]')!;
    expect(xacNhan().disabled).toBe(true);
    dienLyDo(/Lý do khoá/, "ngắn");
    expect(xacNhan().disabled).toBe(true);
    dienLyDo(/Lý do khoá/, "khoá kỳ 10 để chi lương");
    expect(xacNhan().disabled).toBe(false);
    fireEvent.click(xacNhan());
    await waitFor(() => expect(A.khoa).toHaveBeenCalledTimes(1));
    expect(A.khoa).toHaveBeenCalledWith({ periodId: "ky1", lyDo: "khoá kỳ 10 để chi lương", daThay: SO_LIEU });
    await waitFor(() => expect(T.success).toHaveBeenCalledWith("Đã khoá kỳ 10/2026."));
    expect(R.refresh).toHaveBeenCalled();
  });

  it("server TỪ CHỐI ⇒ lý do hiện trong hộp thoại, hộp thoại KHÔNG đóng, không toast thành công, lý do đã gõ còn nguyên", async () => {
    A.khoa.mockResolvedValue({ ok: false, ma: "SO_LIEU_DA_DOI", loi: "Số liệu của kỳ đã đổi từ lúc bạn mở hộp thoại — đóng hộp thoại, đọc lại số mới rồi khoá." });
    const hop = mo();
    dienLyDo(/Lý do khoá/, "khoá kỳ 10 để chi lương");
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-xac-nhan="KHOA"]')!);
    expect(await within(hop).findByRole("alert")).toBeTruthy();
    expect(within(hop).getByRole("alert").textContent).toMatch(/Số liệu của kỳ đã đổi/);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect((screen.getByLabelText(/Lý do khoá/) as HTMLTextAreaElement).value).toBe("khoá kỳ 10 để chi lương");
    expect(T.success).not.toHaveBeenCalled();
    expect(R.refresh).not.toHaveBeenCalled();
  });

  it("chưa biết kỳ kế tiếp ⇒ nói 'đang mở kế tiếp' chứ không bịa tháng", () => {
    render(<HanhDongKy d={du({ kyGhiTiepNhan: null })} />);
    fireEvent.click(nut("Khoá kỳ"));
    expect(within(screen.getByRole("dialog")).getByText("đang mở kế tiếp")).toBeTruthy();
  });
});

describe("[NHH-KY-FE-04] Trả lại — lý do bắt buộc", () => {
  it("lý do ngắn ⇒ nút khoá; đủ ⇒ gọi action với id kỳ + lý do", async () => {
    A.tralai.mockResolvedValue({ ok: true, thongBao: "Đã trả kỳ về “đã tính”." });
    render(<HanhDongKy d={du()} />);
    fireEvent.click(nut("Trả lại để tính lại"));
    const hop = screen.getByRole("dialog");
    const gui = within(hop).getByRole("button", { name: "Trả lại để tính lại" }) as HTMLButtonElement;
    expect(gui.disabled).toBe(true);
    dienLyDo(/Lý do trả lại/, "có khoản thu mới sau lần Tính");
    expect(gui.disabled).toBe(false);
    fireEvent.click(gui);
    await waitFor(() => expect(A.tralai).toHaveBeenCalledWith({ periodId: "ky1", lyDo: "có khoản thu mới sau lần Tính" }));
  });
});

describe("[NHH-KY-FE-05] XUẤT bảng chi", () => {
  const TEP = { tenTep: "hoa-hong-bang-luong-2026-10.xlsx", base64: "UEsDBA==" };
  const moXuat = () => {
    render(<HanhDongKy d={du({ trangThai: "LOCKED", vao: { trangThai: "LOCKED" } })} />);
    fireEvent.click(nut("Xuất bảng chi"));
    return screen.getByRole("dialog");
  };

  it("nêu kỳ nào VÀO lô (kèm số dòng và tiền) và kỳ nào KHÔNG (chưa khoá); lô nội bộ chỉ đếm dòng nội bộ", () => {
    const hop = moXuat();
    expect(within(hop).getByText(/Vào lô này: các kỳ đã khoá của tháng mà bạn quản lý/)).toBeTruthy();
    const dong = within(hop).getAllByRole("listitem").map((l) => l.textContent);
    expect(dong[0]).toMatch(/CS1.*3 dòng chưa vào lô.*900\.000đ/);
    expect(dong[1]).toMatch(/CS2.*2 dòng chưa vào lô.*600\.000đ/);
    expect(within(hop).getByText(/2 kỳ khác của tháng chưa khoá — KHÔNG vào lô này/)).toBeTruthy();
    expect(within(hop).getByText(/Người có tổng tháng âm được xuất 0 và kết chuyển/)).toBeTruthy();
  });

  it("xuất thành công ⇒ tải tệp ĐÚNG MỘT LẦN ngay, hiện tóm tắt + nút tải lại (gọi lại tải), trang làm mới nhưng hộp thoại vẫn mở", async () => {
    A.xuat.mockResolvedValue({
      ok: true,
      thongBao: "Đã xuất 3 dòng.",
      xuat: { batchId: "lo1", soDong: 3, tongChi: 900_000, soKyDaKhoa: 1, soKyChuaKhoa: 2, soKyNgoaiPhamVi: 0, amKetChuyen: [{ nguoi: "U:u1", so: -120_000 }], tep: TEP },
    });
    const hop = moXuat();
    dienLyDo(/Lý do xuất/, "xuất bảng lương hoa hồng tháng 10");
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-xac-nhan="XUAT"]')!);
    await waitFor(() => expect(F.taiTep).toHaveBeenCalledTimes(1));
    expect(F.taiTep).toHaveBeenCalledWith(TEP);
    expect(A.xuat).toHaveBeenCalledWith({ thang: "2026-10", kind: "PAYROLL", lyDo: "xuất bảng lương hoa hồng tháng 10" });
    expect(within(hop).getByText(/3 dòng · tổng chi 900\.000đ/)).toBeTruthy();
    expect(within(hop).getByText(/1 người có tổng tháng âm/)).toBeTruthy();
    expect(within(hop).getByText(/Tệp chỉ có ở lượt xuất này/)).toBeTruthy();
    fireEvent.click(within(hop).getByRole("button", { name: /Tải hoa-hong-bang-luong-2026-10\.xlsx/ }));
    expect(F.taiTep).toHaveBeenCalledTimes(2);
    expect(R.refresh).toHaveBeenCalledTimes(1); // kỳ đã đổi sang EXPORTED — trang phải đọc lại (hộp thoại vẫn mở để còn nút tải)
  });

  it("xuất bị từ chối ⇒ lý do trong hộp thoại, KHÔNG tải tệp nào, hộp thoại giữ nguyên", async () => {
    A.xuat.mockResolvedValue({ ok: false, ma: "KHONG_CO_DONG_DE_XUAT", loi: "Tháng 2026-10 không còn dòng nào chưa vào lô bảng lương." });
    const hop = moXuat();
    dienLyDo(/Lý do xuất/, "bấm xuất lần hai cho chắc");
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-xac-nhan="XUAT"]')!);
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/không còn dòng nào chưa vào lô/);
    expect(F.taiTep).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("lô QUYẾT TOÁN người ngoài là nút riêng, gửi kind EXTERNAL_SETTLEMENT và chỉ đếm dòng người ngoài", async () => {
    A.xuat.mockResolvedValue({ ok: false, ma: "X", loi: "x" });
    render(<HanhDongKy d={du({ trangThai: "LOCKED", vao: { trangThai: "LOCKED", chuaXuat: { noiBo: 3, ngoai: 1 } } })} />);
    fireEvent.click(nut("Xuất quyết toán người ngoài"));
    const hop = screen.getByRole("dialog");
    expect(within(hop).getAllByRole("listitem").map((l) => l.textContent).join("|")).toMatch(/CS2.*1 dòng chưa vào lô.*100\.000đ/);
    dienLyDo(/Lý do xuất/, "quyết toán người giới thiệu ngoài");
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-xac-nhan="XUAT_NGOAI"]')!);
    await waitFor(() => expect(A.xuat).toHaveBeenCalledWith({ thang: "2026-10", kind: "EXTERNAL_SETTLEMENT", lyDo: "quyết toán người giới thiệu ngoài" }));
  });

  it("cờ xuất TẮT ⇒ không có nút Xuất, có lý do gọi tên cờ", () => {
    render(<HanhDongKy d={du({ trangThai: "LOCKED", vao: { trangThai: "LOCKED", xuatLuongBat: false } })} />);
    expect(coNut(/Xuất/)).toBe(false);
    expect(screen.getByText(/Cho xuất bảng chi hoa hồng/)).toBeTruthy();
  });
});

describe("[NHH-KY-FE-06] ĐÁNH DẤU ĐÃ CHI", () => {
  const LO = [
    { id: "lo1", kind: "PAYROLL" as const, soDong: 3, tongTien: 900_000, taoLuc: "31/10/2026 14:05" },
    { id: "lo2", kind: "EXTERNAL_SETTLEMENT" as const, soDong: 1, tongTien: 100_000, taoLuc: "31/10/2026 14:06" },
  ];
  const moDaChi = () => {
    render(<HanhDongKy d={du({ trangThai: "EXPORTED", loChoChi: LO, vao: { trangThai: "EXPORTED", soLoChoChi: 2, chuaXuat: { noiBo: 0, ngoai: 0 } } })} />);
    fireEvent.click(nut("Đánh dấu đã chi"));
    return screen.getByRole("dialog");
  };

  it("liệt kê từng lô (loại · số dòng · tiền · lúc xuất), chọn sẵn lô đầu; chọn lô khác ⇒ action nhận ĐÚNG id lô đó", async () => {
    A.dachi.mockResolvedValue({ ok: true, thongBao: "Đã đánh dấu đã chi 1 dòng.", soDong: 1, soKyPaid: 0 });
    const hop = moDaChi();
    const radio = within(hop).getAllByRole("radio") as HTMLInputElement[];
    expect(radio.map((r) => r.checked)).toEqual([true, false]);
    expect(within(hop).getByText(/Quyết toán người ngoài/)).toBeTruthy();
    fireEvent.click(radio[1]!);
    dienLyDo(/Lý do \/ căn cứ đã chi/, "đã chuyển khoản quyết toán ngày 25/11");
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-xac-nhan="DA_CHI"]')!);
    await waitFor(() => expect(A.dachi).toHaveBeenCalledWith({ batchId: "lo2", lyDo: "đã chuyển khoản quyết toán ngày 25/11" }));
  });

  it("thiếu lý do ⇒ nút xác nhận khoá; lô bị server từ chối ⇒ lý do trong hộp thoại", async () => {
    A.dachi.mockResolvedValue({ ok: false, ma: "LO_DA_CHI", loi: "Lô lo1 đang PAID — chỉ lô EXPORTED mới đánh dấu đã chi." });
    const hop = moDaChi();
    const xn = document.querySelector<HTMLButtonElement>('[data-xac-nhan="DA_CHI"]')!;
    expect(xn.disabled).toBe(true);
    dienLyDo(/Lý do \/ căn cứ đã chi/, "đã chuyển khoản bảng lương");
    fireEvent.click(xn);
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/chỉ lô EXPORTED/);
  });
});
