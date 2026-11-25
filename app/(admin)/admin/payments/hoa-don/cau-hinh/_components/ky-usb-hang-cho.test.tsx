// @vitest-environment jsdom
// Ca [KUH-*] — khu «Ký USB token»: nút chỉ sáng khi làm được, mã ghép máy hiện đúng một lần, người tạo lệnh được nhắc không tự ký.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  tao: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: { thanhCong: 1, loi: [] } })),
  kyLo: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: { thanhCong: 1, loi: [] } })),
  huy: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: { id: "l1" } })),
  kiemTra: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: { trangThai: "DANG_PHAT_HANH" } })),
  taoMa: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: { ma: "ABCDE-FGHJK", hetHan: "2026-11-04T03:10:00.000Z" } })),
  thuHoi: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: { id: "m1" } })),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("../_ky-usb-actions", () => ({
  taoLenhKyUsbAction: h.tao,
  kyLoUsbAction: h.kyLo,
  huyLenhKyUsbAction: h.huy,
  kiemTraLaiKyUsbAction: h.kiemTra,
  taoMaGhepMayKyAction: h.taoMa,
  thuHoiMayKyAction: h.thuHoi,
}));

import { KyUsbHangCho, coTheKy, coTheTaoLenh } from "./ky-usb-hang-cho";
import type { DongChoKyUsb } from "@/lib/finance/hoa-don/ky-usb/hang-cho-ky-usb";

const dong = (id: string, ten: string, lenh: DongChoKyUsb["lenh"], o: Partial<DongChoKyUsb> = {}): DongChoKyUsb => ({
  hoaDonId: id,
  phapNhanTen: "NEW VISION",
  nguoiMua: ten,
  soTien: 5_000_000,
  daGui: false,
  thongDiep: null,
  lenh,
  ...o,
});
const lenh = (trangThai: NonNullable<DongChoKyUsb["lenh"]>["trangThai"], nguoiYeuCauId = "u-khac") => ({ id: `l-${trangThai}`, trangThai, nguoiYeuCauId, nguoiKyId: null, hetHan: null, lyDo: trangThai === "LOI_KY" ? "KHONG_KET_NOI — Không kết nối được bộ ký." : null });

const DONG = [
  dong("hd1", "Khách chưa lệnh", null),
  dong("hd2", "Khách chờ ký", lenh("CHO_KY")),
  dong("hd3", "Khách tôi tạo", lenh("CHO_KY", "toi")),
  dong("hd4", "Khách đang ký", lenh("DANG_KY")),
  dong("hd5", "Khách lỗi ký", lenh("LOI_KY")),
  dong("hd6", "Khách đã gửi", lenh("LOI_KY"), { daGui: true, thongDiep: "Đang chờ nhà cung cấp xác nhận" }),
];
const MAY = [
  { id: "m1", tenMay: "Máy bàn 2", trangThai: "DANG_DUNG" as const, lanDungCuoi: "2026-11-04T02:00:00.000Z", hetHan: "2026-12-04T02:00:00.000Z" },
  { id: "m2", tenMay: "Máy cũ", trangThai: "DA_THU_HOI" as const, lanDungCuoi: null, hetHan: null },
];
const ve = (d = DONG, m = MAY) => render(<KyUsbHangCho dong={d} may={m} nguoiXemId="toi" />);
const chonHang = (ten: string) => fireEvent.click(screen.getByLabelText(`Chọn hoá đơn của ${ten}`));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("[KUH] điều kiện nút (thuần)", () => {
  it("[KUH-01] tạo lệnh được khi chưa có lệnh hoặc lệnh đã ở trạng thái cuối; KHÔNG khi lệnh còn sống. Ký được khi CHO_KY", () => {
    expect(coTheTaoLenh(DONG[0]!)).toBe(true);
    expect(coTheTaoLenh(DONG[4]!)).toBe(true); // LOI_KY ⇒ lập lệnh mới
    expect(coTheTaoLenh(DONG[1]!)).toBe(false);
    expect(coTheTaoLenh(DONG[3]!)).toBe(false);
    expect(coTheKy(DONG[1]!)).toBe(true);
    expect(coTheKy(DONG[3]!)).toBe(false);
    expect(coTheKy(DONG[0]!)).toBe(false);
  });
});

describe("[KUH] màn", () => {
  it("[KUH-02] ô chọn chỉ mở với dòng làm được gì đó; dòng ĐANG KÝ không chọn được (đối chứng dương: dòng chờ ký chọn được)", () => {
    ve();
    expect((screen.getByLabelText("Chọn hoá đơn của Khách đang ký") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Chọn hoá đơn của Khách chờ ký") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText("Chọn hoá đơn của Khách chưa lệnh") as HTMLInputElement).disabled).toBe(false);
  });

  it("[KUH-03] nút lô đếm ĐÚNG theo lựa chọn: chưa chọn ⇒ cả hai tắt; chọn 1 dòng chưa lệnh ⇒ chỉ «Tạo lệnh» sáng; chọn 1 dòng chờ ký ⇒ chỉ «Ký lô» sáng", () => {
    ve();
    const tao = () => screen.getByRole("button", { name: /^Tạo lệnh ký \(/ }) as HTMLButtonElement;
    const ky = () => screen.getByRole("button", { name: /^Ký lô \(/ }) as HTMLButtonElement;
    expect([tao().disabled, ky().disabled]).toEqual([true, true]);
    chonHang("Khách chưa lệnh");
    expect(tao().textContent).toBe("Tạo lệnh ký (1)");
    expect([tao().disabled, ky().disabled]).toEqual([false, true]);
    chonHang("Khách chưa lệnh");
    chonHang("Khách chờ ký");
    expect(ky().textContent).toBe("Ký lô (1)");
    expect([tao().disabled, ky().disabled]).toEqual([true, false]);
  });

  it("[KUH-04] bấm «Ký lô» ⇒ gọi action với ĐÚNG id lệnh của các dòng chờ ký đã chọn; chọn lẫn dòng chưa lệnh KHÔNG đưa id lạ vào", async () => {
    ve();
    chonHang("Khách chờ ký");
    chonHang("Khách chưa lệnh");
    fireEvent.click(screen.getByRole("button", { name: /^Ký lô \(/ }));
    await waitFor(() => expect(h.kyLo).toHaveBeenCalledTimes(1));
    expect(h.kyLo.mock.calls[0]![0]).toEqual({ lenhIds: ["l-CHO_KY"] });
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("[KUH-05] lỗi từng mục (vd tách nhiệm vụ) hiện trong khung cảnh báo, không nuốt; thành công một phần vẫn báo thành công", async () => {
    h.kyLo.mockResolvedValueOnce({ ok: true, data: { thanhCong: 0, loi: [{ id: "l-CHO_KY", error: "Người ký phải khác người yêu cầu." }] } });
    ve();
    chonHang("Khách chờ ký");
    fireEvent.click(screen.getByRole("button", { name: /^Ký lô \(/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Người ký phải khác người yêu cầu."));
    expect(h.error).toHaveBeenCalled();
  });

  it("[KUH-06] lệnh do CHÍNH người xem tạo ⇒ có dòng nhắc cần kế toán KHÁC ký; lệnh người khác tạo thì không nhắc", () => {
    ve();
    expect(screen.getAllByText(/cần một kế toán KHÁC bấm Ký/)).toHaveLength(1);
    const dongToi = screen.getByLabelText("Chọn hoá đơn của Khách tôi tạo").closest("tr")!;
    expect(dongToi.textContent).toContain("cần một kế toán KHÁC");
    expect(screen.getByLabelText("Chọn hoá đơn của Khách chờ ký").closest("tr")!.textContent).not.toContain("cần một kế toán KHÁC");
  });

  it("[KUH-07] «Kiểm tra lại» CHỈ có ở hoá đơn đã từng gửi; lỗi ký hiện lý do cố định", () => {
    ve();
    expect(screen.getAllByRole("button", { name: "Kiểm tra lại" })).toHaveLength(1);
    expect(screen.getByLabelText("Chọn hoá đơn của Khách lỗi ký").closest("tr")!.textContent).toContain("KHONG_KET_NOI");
  });

  it("[KUH-08] huỷ lệnh: phải nhập lý do ≥ 10 ký tự mới bấm được «Xác nhận huỷ»", async () => {
    ve();
    const hang = screen.getByLabelText("Chọn hoá đơn của Khách chờ ký").closest("tr")!;
    fireEvent.click(within(hang).getByRole("button", { name: "Huỷ lệnh" }));
    const xacNhan = within(hang).getByRole("button", { name: "Xác nhận huỷ" }) as HTMLButtonElement;
    expect(xacNhan.disabled).toBe(true);
    fireEvent.change(within(hang).getByLabelText("Lý do huỷ"), { target: { value: "Khách đổi pháp nhân" } });
    expect(xacNhan.disabled).toBe(false);
    fireEvent.click(xacNhan);
    await waitFor(() => expect(h.huy).toHaveBeenCalledWith({ lenhId: "l-CHO_KY", lyDo: "Khách đổi pháp nhân" }));
  });

  it("[KUH-09] ghép máy: mã hiện đúng MỘT lần (bấm «Đã nhập xong» là mất khỏi màn); máy đã thu hồi không có nút thu hồi; máy đang dùng có", async () => {
    ve();
    expect(screen.getAllByRole("button", { name: "Thu hồi" })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/Tên máy/), { target: { value: "Máy phòng kế toán" } });
    fireEvent.click(screen.getByRole("button", { name: "Ghép máy mới" }));
    await waitFor(() => expect(screen.getByLabelText("Mã ghép máy").textContent).toBe("ABCDE-FGHJK"));
    expect(h.taoMa).toHaveBeenCalledWith({ tenMay: "Máy phòng kế toán" });
    fireEvent.click(screen.getByRole("button", { name: "Đã nhập xong, ẩn mã" }));
    expect(screen.queryByLabelText("Mã ghép máy")).toBeNull();
    expect(document.body.textContent).not.toContain("ABCDE-FGHJK");
  });

  it("[KUH-10] danh sách rỗng ⇒ nói rõ, hai nút lô tắt", () => {
    ve([], []);
    expect(screen.getByText(/Không có hoá đơn nào của pháp nhân ký USB/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Ký lô \(/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
