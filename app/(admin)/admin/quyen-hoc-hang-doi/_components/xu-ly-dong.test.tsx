// @vitest-environment jsdom
/**
 * [HD-UI] `<XuLyDong/>` — HÀNH VI của nút (luật 12: nút nói thật). Client KHÔNG tự suy quyền: nút ghi chỉ có khi server đưa `hanhDong`; vai chỉ-xem
 * (`hanhDong = []`) mở được chi tiết nhưng không thấy nút ghi nào; hành động cần lý do thì nút xác nhận khoá tới khi lý do ≥ 10 ký tự.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  thuLai: vi.fn(),
  dong: vi.fn(),
  giu: vi.fn(),
  thuHoi: vi.fn(),
  danhDau: vi.fn(),
  duyetHocVuot: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../_actions", () => ({
  thuCapLaiAction: (...a: unknown[]) => h.thuLai(...a),
  dongDongAction: (...a: unknown[]) => h.dong(...a),
  giuQuyenAction: (...a: unknown[]) => h.giu(...a),
  duyetThuHoiAction: (...a: unknown[]) => h.thuHoi(...a),
  danhDauCanDuyetAction: (...a: unknown[]) => h.danhDau(...a),
  duyetHocVuotAction: (...a: unknown[]) => h.duyetHocVuot(...a),
}));

import { XuLyDong } from "./xu-ly-dong";
import type { DongHangDoiDto } from "@/lib/entitlements/hang-doi/doc-hang-doi";

const DONG: DongHangDoiDto = {
  id: "dong-1",
  loai: "CAN_THU_HOI",
  trangThai: "OPEN",
  lyDo: "Tiền xác nhận không còn đủ.",
  chiTiet: [],
  daQuyet: null,
  ghiChuDong: null,
  taoLuc: "2026-10-10T00:00:00.000Z",
  capNhatLuc: "2026-10-10T00:00:00.000Z",
  dongLuc: null,
  quaHan: false,
  coSo: { id: "cs1", ten: "Cơ sở 1" },
  don: { id: "don-1", ma: "ORD-1" },
  dongDon: { id: "it-1", ten: "Sata 3" },
  khoa: { id: "k1", ten: "Sata 3" },
  hocVien: { id: "hv1", ten: "Bé A" },
  be: null,
  lop: null,
  quyenHoc: { id: "q1", trangThai: "ACTIVE", soBuoiMua: 48, daTieuThu: 0, soTien: null },
  coXemTien: false,
  hanhDong: [],
  coQuyenManage: false,
  coQuyenDuyetNgoaiLe: false,
  coBat: true,
  deXuatHocVuot: null,
};
const TEN_NUT_GHI = ["Thử cấp lại", "Đóng (có lý do)", "Giữ quyền học", "Duyệt thu hồi", "Cần duyệt tay"];

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of [h.thuLai, h.dong, h.giu, h.thuHoi, h.danhDau]) f.mockResolvedValue({ ok: true, daLam: true, thongBao: "xong" });
});
afterEach(cleanup);

describe("[HD-UI] XuLyDong — nút nói thật", () => {
  it("[HD-UI-01] hanhDong = [] (vai chỉ-xem / cờ tắt / dòng đã đóng): nhãn \"Chi tiết\", mở được chi tiết, KHÔNG có nút ghi nào", () => {
    render(<XuLyDong dong={DONG} />);
    expect(screen.queryByText("Xử lý")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chi tiết" }));
    expect(screen.getByText("Tiền xác nhận không còn đủ.")).toBeTruthy();
    for (const ten of TEN_NUT_GHI) expect(screen.queryByRole("button", { name: ten }), ten).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/chỉ có quyền xem/);
  });

  it("[HD-UI-02] lý do không-có-nút đi theo đúng nguyên nhân: có quyền manage nhưng cờ TẮT ⇒ nói cờ; dòng đã đóng ⇒ nói đã đóng", () => {
    const { unmount } = render(<XuLyDong dong={{ ...DONG, coQuyenManage: true, coBat: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Chi tiết" }));
    expect(screen.getByRole("status").textContent).toMatch(/chưa được bật/);
    unmount();
    render(<XuLyDong dong={{ ...DONG, coQuyenManage: true, trangThai: "DA_XU_LY" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Chi tiết" }));
    expect(screen.getByRole("status").textContent).toMatch(/đã đóng/i);
  });

  it("[HD-UI-03] đối chứng dương: hanhDong = [THU_LAI, DONG] ⇒ nhãn \"Xử lý\", đúng HAI nút ghi (không thừa nút nào, kể cả Duyệt thu hồi)", () => {
    render(<XuLyDong dong={{ ...DONG, coQuyenManage: true, hanhDong: ["THU_LAI", "DONG"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Xử lý" }));
    const co = TEN_NUT_GHI.filter((ten) => screen.queryByRole("button", { name: ten }));
    expect(co).toEqual(["Thử cấp lại", "Đóng (có lý do)"]);
  });

  it("[HD-UI-04] \"Thử cấp lại\" chạy ngay (không đòi lý do) và làm tươi trang khi có gì đổi", async () => {
    render(<XuLyDong dong={{ ...DONG, coQuyenManage: true, hanhDong: ["THU_LAI", "DONG"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Xử lý" }));
    fireEvent.click(screen.getByRole("button", { name: "Thử cấp lại" }));
    await waitFor(() => expect(h.thuLai).toHaveBeenCalledWith({ dongId: "dong-1" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.dong).not.toHaveBeenCalled();
  });

  it("[HD-UI-05] hành động cần lý do: nút xác nhận KHOÁ tới khi lý do ≥ 10 ký tự, rồi gọi ĐÚNG action với lý do đó; không action nào khác bị gọi", async () => {
    render(<XuLyDong dong={{ ...DONG, coQuyenManage: true, hanhDong: ["THU_LAI", "DONG", "GIU_QUYEN"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Xử lý" }));
    fireEvent.click(screen.getByRole("button", { name: "Giữ quyền học" }));
    const xacNhan = screen.getByRole("button", { name: /Xác nhận: Giữ quyền học/ }) as HTMLButtonElement;
    expect(xacNhan.disabled).toBe(true);
    const o = screen.getByLabelText(/Lý do/);
    fireEvent.change(o, { target: { value: "ngắn" } });
    expect(xacNhan.disabled).toBe(true);
    fireEvent.change(o, { target: { value: "Phụ huynh hẹn nộp bù cuối tuần" } });
    expect(xacNhan.disabled).toBe(false);
    fireEvent.click(xacNhan);
    await waitFor(() => expect(h.giu).toHaveBeenCalledWith({ dongId: "dong-1", lyDo: "Phụ huynh hẹn nộp bù cuối tuần" }));
    expect([h.thuLai, h.dong, h.thuHoi, h.danhDau].map((f) => f.mock.calls.length)).toEqual([0, 0, 0, 0]);
  });

  it("[HD-UI-06] server từ chối ⇒ KHÔNG làm tươi trang (không giả vờ đã đổi)", async () => {
    h.thuLai.mockResolvedValue({ ok: false, error: "Không có quyền" });
    render(<XuLyDong dong={{ ...DONG, coQuyenManage: true, hanhDong: ["THU_LAI"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Xử lý" }));
    fireEvent.click(screen.getByRole("button", { name: "Thử cấp lại" }));
    await waitFor(() => expect(h.thuLai).toHaveBeenCalled());
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

describe("[HD-UI] XuLyDong — dòng xin duyệt học vượt thêm (quyết định 5)", () => {
  const DUYET: DongHangDoiDto = {
    ...DONG,
    loai: "CHO_DUYET_HOC_VUOT",
    lyDo: "Lớp đã dạy 9 bài trước khi học viên vào — vượt trần học vượt 6 bài.",
    deXuatHocVuot: { soBaiCan: 9, tran: 6, baiDaGiu: "4–9", baiBoQua: "1–3", baiDeXuatThem: "1–3", quyenCan: "APPROVE_EXCEPTION" },
  };

  it("[HD-UI-10] QLCS (hanhDong = [DONG]): thấy đề xuất + câu 'cần quyền duyệt ngoại lệ', có nút Đóng, KHÔNG có nút Duyệt học vượt thêm", () => {
    render(<XuLyDong dong={{ ...DUYET, coQuyenManage: true, hanhDong: ["DONG"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Xử lý" }));
    expect(screen.getByRole("button", { name: "Đóng (có lý do)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Duyệt học vượt thêm" })).toBeNull();
    expect(screen.getByText(/Đề xuất học vượt thêm/).textContent).toMatch(/1–3/);
    expect(screen.getByText(/Cần người có quyền duyệt ngoại lệ/)).toBeTruthy();
  });

  it("[HD-UI-11] Giám đốc (hanhDong = [DONG, DUYET_HOC_VUOT]): có nút duyệt; xác nhận khoá tới khi lý do ≥ 10 ký tự rồi gọi ĐÚNG action duyệt (không action nào khác)", async () => {
    h.duyetHocVuot.mockResolvedValue({ ok: true, daLam: true, thongBao: "xong" });
    render(<XuLyDong dong={{ ...DUYET, coQuyenManage: true, coQuyenDuyetNgoaiLe: true, hanhDong: ["DONG", "DUYET_HOC_VUOT"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Xử lý" }));
    fireEvent.click(screen.getByRole("button", { name: "Duyệt học vượt thêm" }));
    const xacNhan = screen.getByRole("button", { name: /Xác nhận: Duyệt học vượt thêm/ }) as HTMLButtonElement;
    expect(xacNhan.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "Đồng ý cho bé học vượt đủ 3 bài đầu" } });
    expect(xacNhan.disabled).toBe(false);
    fireEvent.click(xacNhan);
    await waitFor(() => expect(h.duyetHocVuot).toHaveBeenCalledWith({ dongId: "dong-1", lyDo: "Đồng ý cho bé học vượt đủ 3 bài đầu" }));
    expect([h.thuLai, h.dong, h.giu, h.thuHoi, h.danhDau].map((f) => f.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
  });

  it("[HD-UI-12] người chỉ có approve-exception (không manage) vẫn có nút duyệt và KHÔNG bị báo 'chỉ có quyền xem'; vai chỉ-xem thì bị báo", () => {
    const { unmount } = render(<XuLyDong dong={{ ...DUYET, coQuyenManage: false, coQuyenDuyetNgoaiLe: true, hanhDong: ["DUYET_HOC_VUOT"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Xử lý" }));
    expect(screen.getByRole("button", { name: "Duyệt học vượt thêm" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
    render(<XuLyDong dong={{ ...DUYET, hanhDong: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Chi tiết" }));
    expect(screen.queryByRole("button", { name: "Duyệt học vượt thêm" })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/chỉ có quyền xem/);
  });

  it("[HD-UI-13] luật 12: người CHỈ có approve-exception + dòng ĐÃ ĐÓNG (hanhDong rỗng) ⇒ câu giải thích nói 'đã đóng', KHÔNG nói 'chỉ có quyền xem' (người đó không phải người chỉ-xem)", () => {
    render(<XuLyDong dong={{ ...DUYET, trangThai: "DA_XU_LY", coQuyenManage: false, coQuyenDuyetNgoaiLe: true, hanhDong: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Chi tiết" }));
    const t = screen.getByRole("status").textContent ?? "";
    expect(t).not.toMatch(/chỉ có quyền xem/);
    expect(t).toMatch(/đã đóng/i);
  });
});
