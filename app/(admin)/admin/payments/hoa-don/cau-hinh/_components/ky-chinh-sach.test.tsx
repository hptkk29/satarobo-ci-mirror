// @vitest-environment jsdom
// Ca [KCSU-*] — màn «Chính sách ký»: hạn mức đi HAI bước (nhập → xem lại cũ/mới → lưu), NỚI hạn mức đòi tick xác nhận, người không có quyền KHÔNG thấy nút,
// số đã dùng / còn lại hiện đúng. Máy chủ ép lại các luật này (lưới DB `[KCD-04b]`) — màn chỉ giúp người dùng thấy trước.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  luu: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: null })),
  dung: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: null })),
  bat: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, data: null })),
  refresh: vi.fn(),
  success: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: vi.fn() } }));
vi.mock("../_ky-chinh-sach-actions", () => ({ luuHanMucKyAction: h.luu, tamDungKyAction: h.dung, batLaiKyAction: h.bat }));

import { KyChinhSach, type TheChinhSach } from "./ky-chinh-sach";

const CHINH_SACH = {
  phapNhanMa: "STEM_ROBOTICS_AI",
  tamDung: false,
  tamDungLuc: null,
  tamDungBoiId: null,
  tamDungLyDo: null,
  tamDungSuCo: false,
  hanMucMoiHoaDon: 10_000_000,
  hanMucMoiNgay: 50_000_000,
  soToiDa: 20,
  cuaSoPhut: 60,
  nguongTanSuat: null,
  capNhatBoiId: "u1",
  capNhatLuc: "2026-11-04T03:00:00.000Z",
};
const THE: TheChinhSach[] = [{ phapNhanMa: "STEM_ROBOTICS_AI", ten: "STEM ROBOTICS AI", chinhSach: CHINH_SACH, suDung: { tongNgay: 12_000_000, soTrongCuaSo: 4 } }];
const LICH_SU = [
  { id: "l1", phapNhanMa: "STEM_ROBOTICS_AI", action: "SUA_HAN_MUC_KY", luc: "2026-11-04T03:00:00.000Z", nguoi: "Quản trị tối cao", lyDo: "Khai hạn mức", maChiDao: null, truocSau: [] },
];

const dien = (nhan: string | RegExp, v: string) => fireEvent.change(screen.getByLabelText(nhan), { target: { value: v } });
const LY_DO = /^Lý do \(bắt buộc/;

function moFormHanMuc() {
  render(<KyChinhSach the={THE} lichSu={LICH_SU} duocSua xemHanMuc />);
  fireEvent.click(screen.getByRole("button", { name: "Khai / sửa hạn mức" }));
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("[KCSU] màn Chính sách ký", () => {
  it("[KCSU-01] người KHÔNG có quyền sửa: thấy trạng thái + hạn mức nhưng KHÔNG có nút nào (không hứa việc máy chủ chắc chắn từ chối)", () => {
    render(<KyChinhSach the={THE} lichSu={LICH_SU} duocSua={false} xemHanMuc />);
    expect(screen.getByText("Đang ký bình thường")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Khai \/ sửa hạn mức|Tạm dừng ký|Bật lại ký/ })).toBeNull();
  });

  it("[KCSU-02] số ĐÃ DÙNG / CÒN LẠI + trạng thái ký tự động + người đổi gần nhất hiện đúng; nói rõ giờ Việt Nam", () => {
    render(<KyChinhSach the={THE} lichSu={LICH_SU} duocSua xemHanMuc />);
    const dung = screen.getByLabelText("Hạn mức đã dùng — STEM ROBOTICS AI");
    expect(dung.textContent).toContain("12.000.000đ / 50.000.000đ");
    expect(dung.textContent).toContain("còn 38.000.000đ");
    expect(dung.textContent).toContain("4 / 20 hoá đơn");
    expect(dung.textContent).toContain("còn 16");
    expect(dung.textContent).toMatch(/giờ Việt Nam/);
    expect(screen.getByText(/Đủ điều kiện tự ký theo chính sách/)).toBeTruthy();
    expect(screen.getByText(/Thay đổi gần nhất: Sửa hạn mức — Quản trị tối cao/)).toBeTruthy();
  });

  it("[KCSU-03] kế toán cơ sở (xemHanMuc=false): không thấy số hạn mức, không thấy số đã dùng", () => {
    render(<KyChinhSach the={[{ ...THE[0]!, suDung: null }]} lichSu={[]} duocSua={false} xemHanMuc={false} />);
    expect(screen.queryByText(/Tối đa mỗi hoá đơn/)).toBeNull();
    expect(screen.queryByLabelText(/Hạn mức đã dùng/)).toBeNull();
  });

  it("[KCSU-04] SIẾT hạn mức: bước 1 chỉ XEM LẠI (không gọi máy chủ), hiện cũ → mới, KHÔNG có ô xác nhận nới; bước 2 lưu, không gửi cờ nới", async () => {
    moFormHanMuc();
    dien("Tối đa mỗi hoá đơn (VND)", "8000000");
    dien(LY_DO, "Siết lại theo chỉ đạo");
    fireEvent.click(screen.getByRole("button", { name: "Xem lại thay đổi" }));
    expect(h.luu).not.toHaveBeenCalled();
    const xem = screen.getByLabelText("Xem lại thay đổi hạn mức");
    expect(xem.textContent).toContain("10.000.000đ → 8.000.000đ");
    expect(screen.queryByLabelText(/NỚI hạn mức/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và lưu hạn mức" }));
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(h.luu.mock.calls[0]![0]).toMatchObject({ phapNhanMa: "STEM_ROBOTICS_AI", hanMucMoiHoaDon: 8_000_000, lyDo: "Siết lại theo chỉ đạo", xacNhanNoiLong: undefined, maChiDao: null });
  });

  it("[KCSU-05] NỚI hạn mức: phải tick xác nhận — chưa tick thì KHÔNG gọi máy chủ và báo rõ; tick + mã chỉ đạo BGĐ ⇒ gửi `xacNhanNoiLong: true` + mã", async () => {
    moFormHanMuc();
    dien("Tối đa mỗi hoá đơn (VND)", "15000000");
    dien(LY_DO, "BGĐ duyệt nâng hạn mức mỗi hoá đơn");
    fireEvent.click(screen.getByRole("button", { name: "Xem lại thay đổi" }));
    expect(screen.getByLabelText("Xem lại thay đổi hạn mức").textContent).toContain("Tăng hạn mức mỗi hoá đơn");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và lưu hạn mức" }));
    expect(h.luu).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/NỚI hạn mức/);
    fireEvent.click(screen.getByLabelText(/Tôi xác nhận NỚI hạn mức/));
    fireEvent.change(screen.getByLabelText(/Mã \/ ghi chú chỉ đạo của Ban Giám đốc/), { target: { value: "BGĐ-11/2026-07" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và lưu hạn mức" }));
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(h.luu.mock.calls[0]![0]).toMatchObject({ hanMucMoiHoaDon: 15_000_000, xacNhanNoiLong: true, maChiDao: "BGĐ-11/2026-07" });
  });

  it("[KCSU-06] không đổi gì ⇒ không sang bước xem lại, báo rõ; sai luật (lý do ngắn) ⇒ báo ngay, không gọi máy chủ", () => {
    moFormHanMuc();
    dien(LY_DO, "Lưu mà không đổi gì cả");
    fireEvent.click(screen.getByRole("button", { name: "Xem lại thay đổi" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Không có giá trị nào thay đổi/);
    dien(LY_DO, "ngắn");
    fireEvent.click(screen.getByRole("button", { name: "Xem lại thay đổi" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Lý do/);
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("[KCSU-07] «Quay lại sửa» từ bước xem lại về ô nhập và bỏ tick xác nhận (không giữ lại xác nhận cho giá trị khác)", () => {
    moFormHanMuc();
    dien("Tối đa mỗi hoá đơn (VND)", "15000000");
    dien(LY_DO, "BGĐ duyệt nâng hạn mức mỗi hoá đơn");
    fireEvent.click(screen.getByRole("button", { name: "Xem lại thay đổi" }));
    fireEvent.click(screen.getByLabelText(/Tôi xác nhận NỚI hạn mức/));
    fireEvent.click(screen.getByRole("button", { name: "Quay lại sửa" }));
    expect(screen.getByLabelText("Tối đa mỗi hoá đơn (VND)")).toBeTruthy();
    dien("Tối đa mỗi hoá đơn (VND)", "16000000");
    fireEvent.click(screen.getByRole("button", { name: "Xem lại thay đổi" }));
    expect((screen.getByLabelText(/Tôi xác nhận NỚI hạn mức/) as HTMLInputElement).checked).toBe(false);
  });
});
