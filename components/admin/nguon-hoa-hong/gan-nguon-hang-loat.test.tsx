// @vitest-environment jsdom
/**
 * [GHN-UI-*] HỘP THOẠI «Gán nguồn hàng loạt» — trên PHẦN TỬ THẬT (jsdom), hàm gọi máy chủ được TIÊM (`chay`). Phần tick chọn + thanh hành động: `chon-lead-hang-cho.test.tsx`.
 *
 *   [GHN-UI-02] nguồn «khách tự đến» (WALK_IN) được CHỌN SẴN; nguồn có hoa hồng ⇒ cảnh báo nói thẳng
 *   [GHN-UI-03] chưa chọn nguồn / lý do < 10 ký tự ⇒ lỗi cạnh ô, KHÔNG gọi máy chủ
 *   [GHN-UI-04] XEM TRƯỚC gửi `chiXem: true` kèm ĐÚNG phạm vi (`pham`) của view và CHƯA ghi; in số «sẽ đổi» + từng nhóm bị bỏ qua kèm vì sao (gồm «đã ở đúng nguồn này»); nút xác nhận mang đúng số
 *   [GHN-UI-05] xác nhận ⇒ gửi `chiXem: false` lặp theo con trỏ tới hết; KHÔNG báo nơi gọi làm mới giữa các lô — chỉ khi đóng (`khiDong(true)`)
 *   [GHN-UI-06] lỗi giữa chừng ⇒ báo, giữ phần đã làm; «Tiếp tục» chạy từ CON TRỎ, không từ đầu
 *   [GHN-UI-07] đóng khi CHƯA đổi gì ⇒ `khiDong(false)` (nơi gọi không làm mới, không bỏ chọn)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions-gan-hang-loat", () => ({ ganNguonHangLoatAction: vi.fn() }));

import type { KetQuaGanHangLoatAction } from "@/lib/nguon/gan-nguon-hang-loat-nhan";
import { HopGanNguonHangLoat, type GanHangLoatView } from "./gan-nguon-hang-loat";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const VIEW: GanHangLoatView = {
  soLead: 207,
  pham: { kieu: "ids", ids: ["a", "b", "c"] },
  coSoId: "cs2",
  moTa: "3 lead đã chọn ở CS2.",
  nguon: [
    { id: "g-ads", code: "PAID_ADS", name: "Nguồn từ Quảng Cáo", commissionEnabled: true },
    { id: "g-walk", code: "WALK_IN", name: "Nguồn KH tự đến Trung tâm", commissionEnabled: false },
  ],
};
const LY_DO = "  Lead nhập từ file Excel cũ, không còn căn cứ nguồn  ";
const lo = (o: Partial<Extract<KetQuaGanHangLoatAction, { ok: true }>> = {}): KetQuaGanHangLoatAction => ({
  ok: true,
  daDoi: 0,
  boQuaCoTien: 0,
  boQuaKhoa: 0,
  boQuaCungNguon: 0,
  boQuaVuaDoi: 0,
  khongDoiDuoc: 0,
  loiDauTien: null,
  daQuet: 0,
  conTro: null,
  hetLead: false,
  ...o,
});

const nhapLyDo = (v = LY_DO) => fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: v } });
const bamXemTruoc = () => fireEvent.click(screen.getByRole("button", { name: "Xem trước" }));
const mo = (chay: ReturnType<typeof vi.fn>, view = VIEW, khiDong = vi.fn()) => {
  render(<HopGanNguonHangLoat view={view} chay={chay as never} khiDong={khiDong} />);
  return khiDong;
};

describe("[GHN-UI-02] nguồn chọn sẵn + cảnh báo hoa hồng", () => {
  it("WALK_IN chọn sẵn; đổi sang nguồn có hoa hồng ⇒ cảnh báo; mô tả phạm vi được in", () => {
    mo(vi.fn());
    expect(screen.getByRole("dialog").textContent).toContain("3 lead đã chọn ở CS2.");
    const chon = screen.getByLabelText(/Gán tất cả sang nguồn/) as HTMLSelectElement;
    expect(chon.value).toBe("g-walk");
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.change(chon, { target: { value: "g-ads" } });
    expect(screen.getByRole("note").textContent).toMatch(/CÓ tính hoa hồng/);
  });
});

describe("[GHN-UI-03] đầu vào", () => {
  it("chưa chọn nguồn ⇒ lỗi; lý do ngắn ⇒ lỗi; đều KHÔNG gọi máy chủ", () => {
    const chay = vi.fn();
    mo(chay, { ...VIEW, nguon: [VIEW.nguon[0]!] });
    nhapLyDo();
    bamXemTruoc();
    expect(screen.getByText("Chọn nguồn sẽ gán cho các lead này.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Gán tất cả sang nguồn/), { target: { value: "g-ads" } });
    nhapLyDo("ngắn");
    bamXemTruoc();
    expect(screen.getByLabelText(/Lý do/).getAttribute("aria-invalid")).toBe("true");
    expect(chay).not.toHaveBeenCalled();
  });
});

describe("[GHN-UI-04] xem trước", () => {
  it("gửi chiXem=true kèm phạm vi của view tới hết; in số sẽ đổi + nhóm bỏ qua kèm vì sao; chưa ghi", async () => {
    const chay = vi
      .fn()
      .mockResolvedValueOnce(lo({ daDoi: 20, boQuaCoTien: 3, boQuaKhoa: 2, boQuaCungNguon: 1, daQuet: 26, conTro: "c1", hetLead: false }))
      .mockResolvedValueOnce(lo({ daDoi: 4, boQuaCoTien: 1, daQuet: 5, conTro: "c2", hetLead: true }));
    const khiDong = mo(chay);
    nhapLyDo();
    bamXemTruoc();
    await screen.findByRole("button", { name: "Đổi 24 lead" });
    expect(chay).toHaveBeenCalledTimes(2);
    expect(chay.mock.calls.map((c) => c[0].chiXem)).toEqual([true, true]);
    expect(chay.mock.calls[0]![0]).toMatchObject({ groupId: "g-walk", lyDo: "Lead nhập từ file Excel cũ, không còn căn cứ nguồn", coSoId: "cs2", pham: { kieu: "ids", ids: ["a", "b", "c"] }, conTro: null });
    expect(chay.mock.calls[1]![0].conTro).toBe("c1");
    const hop = screen.getByRole("dialog");
    expect(within(hop).getByText("Sẽ đổi nguồn").parentElement!.textContent).toContain("24");
    expect(within(hop).getByText(/Bỏ qua — đã có khoản thu/).parentElement!.textContent).toContain("4");
    expect(within(hop).getByText(/Bỏ qua — nguồn đang bị khoá/).parentElement!.textContent).toContain("2");
    expect(within(hop).getByText(/đã ở đúng nguồn này/).parentElement!.textContent).toContain("1");
    expect(within(hop).queryByText(/vừa bị người khác đổi/)).toBeNull(); // nhóm 0 không in
    expect(khiDong).not.toHaveBeenCalled();
  });

  it("phạm vi «cả bộ lọc» được gửi nguyên (kieu=loc + lyDo)", async () => {
    const chay = vi.fn().mockResolvedValue(lo({ daDoi: 5, daQuet: 5, conTro: "x", hetLead: true }));
    mo(chay, { ...VIEW, pham: { kieu: "loc", lyDo: "THIEU_NGUOI" }, soLead: 5, moTa: "5 lead «Thiếu người giới thiệu» ở CS2." });
    nhapLyDo();
    bamXemTruoc();
    await screen.findByRole("button", { name: "Đổi 5 lead" });
    expect(chay.mock.calls[0]![0].pham).toEqual({ kieu: "loc", lyDo: "THIEU_NGUOI" });
  });
});

describe("[GHN-UI-05] xác nhận", () => {
  it("gửi chiXem=false lặp theo con trỏ; không báo đóng giữa các lô; đóng ⇒ khiDong(true)", async () => {
    const chay = vi
      .fn()
      .mockResolvedValueOnce(lo({ daDoi: 30, daQuet: 30, conTro: "x", hetLead: true })) // xem trước
      .mockResolvedValueOnce(lo({ daDoi: 25, daQuet: 25, conTro: "c1", hetLead: false })) // ghi lô 1
      .mockResolvedValueOnce(lo({ daDoi: 5, daQuet: 5, conTro: "c2", hetLead: true })); // ghi lô 2
    const khiDong = mo(chay);
    nhapLyDo();
    bamXemTruoc();
    fireEvent.click(await screen.findByRole("button", { name: "Đổi 30 lead" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Đã gán 30 lead"));
    expect(chay.mock.calls.map((c) => c[0].chiXem)).toEqual([true, false, false]);
    expect(chay.mock.calls[1]![0].conTro).toBeNull();
    expect(chay.mock.calls[2]![0].conTro).toBe("c1");
    expect(khiDong).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(khiDong).toHaveBeenCalledWith(true);
  });
});

describe("[GHN-UI-06] lỗi giữa chừng", () => {
  it("báo lỗi, giữ phần đã làm; «Tiếp tục» chạy từ con trỏ, không từ đầu", async () => {
    const chay = vi
      .fn()
      .mockResolvedValueOnce(lo({ daDoi: 30, daQuet: 30, conTro: "x", hetLead: true })) // xem trước
      .mockResolvedValueOnce(lo({ daDoi: 25, daQuet: 25, conTro: "c1", hetLead: false })) // lô 1 thật
      .mockRejectedValueOnce(new Error("mất mạng")) // lô 2 thật
      .mockResolvedValueOnce(lo({ daDoi: 5, daQuet: 5, conTro: "c2", hetLead: true })); // tiếp tục
    mo(chay);
    nhapLyDo();
    bamXemTruoc();
    fireEvent.click(await screen.findByRole("button", { name: "Đổi 30 lead" }));
    const tiep = await screen.findByRole("button", { name: "Tiếp tục" });
    expect(screen.getByRole("alert").textContent).toMatch(/Mất kết nối/);
    fireEvent.click(tiep);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Đã gán 30 lead"));
    expect(chay.mock.calls[3]![0].conTro).toBe("c1");
    expect(chay.mock.calls[3]![0].chiXem).toBe(false);
  });
});

describe("[GHN-UI-07] đóng khi chưa đổi gì", () => {
  it("Huỷ ⇒ khiDong(false)", () => {
    const khiDong = mo(vi.fn());
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(khiDong).toHaveBeenCalledWith(false);
  });
});
