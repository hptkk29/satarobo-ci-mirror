// @vitest-environment jsdom
/**
 * Ca [CTB-*] — BẢNG chứng từ ngân hàng (P7-E). Luật 12: NÚT NÓI THẬT — mỗi trạng thái chỉ hiện đúng những nút mà action cho phép, và luôn
 * kèm ĐỐI CHỨNG DƯƠNG (luật 11: ca chỉ khẳng định «không thấy X» luôn ĐẠT khi tính năng hỏng hoàn toàn). Canh bằng HÀNH VI trên phần tử thật.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { nutDuocPhep, type TrangThaiChungTu } from "@/lib/finance/hoa-don/chung-tu-ngan-hang";
import type { DongChungTu } from "@/lib/finance/hoa-don/chung-tu-ngan-hang-db";

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  danhDau: vi.fn(),
  huy: vi.fn(),
  kiemTra: vi.fn(),
  boSung: vi.fn(),
  tim: vi.fn(),
  taiLen: vi.fn(),
  ok: vi.fn(),
  loi: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../_actions", () => ({
  danhDauCanChungTuAction: h.danhDau,
  huyDanhDauChungTuAction: h.huy,
  kiemTraChungTuAction: h.kiemTra,
  yeuCauBoSungLaiChungTuAction: h.boSung,
  timKhoanTheoMaDonAction: h.tim,
  kyTaiLenChungTuAction: vi.fn(),
  ghiChungTuDaTaiAction: vi.fn(),
}));
vi.mock("./tai-tep-chung-tu", () => ({ taiChungTuLen: h.taiLen }));
vi.mock("sonner", () => ({ toast: { success: h.ok, error: h.loi } }));

import { BangChungTuNganHang } from "./bang-chung-tu-ngan-hang";

const dong = (id: string, trangThai: TrangThaiChungTu, o: Partial<DongChungTu> = {}): DongChungTu => ({
  id,
  paymentId: `cmpay000000${id}abcdef12`,
  maDon: `ORD-269926-0009${id}`,
  hocVien: `Học viên ${id}`,
  phuHuynh: null,
  soTien: 3_920_000,
  ngayThu: "2026-10-04T05:00:00.000Z",
  trangThaiKhoan: "PENDING",
  nhapLichSu: false,
  hoaDon: null,
  trangThai,
  lyDoDanhDau: "Cần sao kê MB ngày 04/10",
  nguoiDanhDau: "Kế toán A",
  danhDauLuc: "2026-10-26T01:00:00.000Z",
  tepTen: trangThai === "CHO_BO_SUNG" ? null : "sao-ke.pdf",
  nguoiTaiLen: trangThai === "CHO_BO_SUNG" ? null : "Kế toán A",
  taiLenLuc: trangThai === "CHO_BO_SUNG" ? null : "2026-10-27T01:00:00.000Z",
  kiemTraLuc: null,
  nguoiKiemTra: null,
  canBoSungLyDo: null,
  ghiChu: null,
  nut: nutDuocPhep(trangThai, trangThai !== "CHO_BO_SUNG"),
  ...o,
});

const DONG_DU = [dong("1", "CHO_BO_SUNG"), dong("2", "DA_TAI_LEN"), dong("3", "DA_KIEM_TRA", { nguoiKiemTra: "Kế toán B", kiemTraLuc: "2026-10-28T01:00:00.000Z" }), dong("4", "CAN_BO_SUNG_LAI", { canBoSungLyDo: "Ảnh bị cắt mất số tài khoản" })];

const hang = (ma: string) => screen.getByText(`ORD-269926-0009${ma}`).closest("tr") as HTMLElement;
const nut = (tr: HTMLElement, ten: RegExp) => within(tr).queryByRole("button", { name: ten }) ?? within(tr).queryByRole("link", { name: ten });

const vẽ = (dongs: DongChungTu[] = DONG_DU, khoOk = true) => render(<BangChungTuNganHang coSoId="cs1" tenCoSo="CS1 · Cơ sở 1" dong={dongs} locTrangThai={null} khoOk={khoOk} />);

beforeEach(() => {
  vi.clearAllMocks();
  h.danhDau.mockResolvedValue({ ok: true, data: { id: "hs" } });
  h.huy.mockResolvedValue({ ok: true, data: { id: "hs" } });
  h.kiemTra.mockResolvedValue({ ok: true, data: { id: "hs" } });
  h.boSung.mockResolvedValue({ ok: true, data: { id: "hs" } });
});

describe("[CTB-01] nút nói thật theo trạng thái (đối chứng DƯƠNG + ÂM trên cùng một bảng)", () => {
  it("CHỜ BỔ SUNG: có «Tải chứng từ lên» + «Huỷ đánh dấu»; KHÔNG có tải về / đã kiểm tra / cần bổ sung lại", () => {
    vẽ();
    const tr = hang("1");
    expect(nut(tr, /Tải chứng từ lên/)).not.toBeNull(); // dương
    expect(nut(tr, /Huỷ đánh dấu/)).not.toBeNull(); // dương
    expect(nut(tr, /Tải về/)).toBeNull();
    expect(nut(tr, /Đã kiểm tra/)).toBeNull();
    expect(nut(tr, /Cần bổ sung lại/)).toBeNull();
  });

  it("ĐÃ TẢI LÊN: thay tệp · tải về · đã kiểm tra · cần bổ sung lại; KHÔNG huỷ đánh dấu (đã có tệp)", () => {
    vẽ();
    const tr = hang("2");
    for (const t of [/Thay tệp/, /Tải về/, /Đã kiểm tra/, /Cần bổ sung lại/]) expect(nut(tr, t), String(t)).not.toBeNull();
    expect(nut(tr, /Huỷ đánh dấu/)).toBeNull();
    expect(within(tr).getByRole("link", { name: /Tải về/ }).getAttribute("href")).toBe("/payments/hoa-don/chung-tu-ngan-hang/2/tai-ve");
  });

  it("ĐÃ KIỂM TRA: chỉ tải về + cần bổ sung lại — KHÔNG thay tệp trực tiếp, KHÔNG kiểm tra lần nữa", () => {
    vẽ();
    const tr = hang("3");
    expect(nut(tr, /Tải về/)).not.toBeNull();
    expect(nut(tr, /Cần bổ sung lại/)).not.toBeNull();
    expect(nut(tr, /Thay tệp|Tải chứng từ lên/)).toBeNull();
    expect(nut(tr, /Đã kiểm tra/)).toBeNull();
    expect(within(tr).getByText(/Kiểm tra: Kế toán B/)).toBeTruthy();
  });

  it("CẦN BỔ SUNG LẠI: hiện lý do bị bác + cho thay tệp; KHÔNG đã kiểm tra", () => {
    vẽ();
    const tr = hang("4");
    expect(within(tr).getByText("Ảnh bị cắt mất số tài khoản")).toBeTruthy();
    expect(nut(tr, /Thay tệp/)).not.toBeNull();
    expect(nut(tr, /Đã kiểm tra/)).toBeNull();
  });

  it("kho chưa cấu hình ⇒ không vẽ nút tải lên / tải về (lời hứa suông) và nói rõ vì sao; vẫn thao tác trạng thái được", () => {
    vẽ(DONG_DU, false);
    expect(screen.getByText(/Kho lưu chứng từ chưa được cấu hình/)).toBeTruthy();
    expect(nut(hang("2"), /Thay tệp|Tải về/)).toBeNull();
    expect(nut(hang("2"), /Đã kiểm tra/)).not.toBeNull();
  });
});

describe("[CTB-02] thông tin theo yêu cầu P7: mã đơn · khoản · học viên · số tiền · ngày · hoá đơn · trạng thái · ai/lúc nào", () => {
  it("một dòng nhập lịch sử đang chờ kế toán hiện đủ các trường, kể cả «Nhập lịch sử» và «Chưa có hoá đơn»", () => {
    vẽ([dong("1", "CHO_BO_SUNG", { nhapLichSu: true, phuHuynh: "Phụ huynh X", hoaDon: null })]);
    const tr = hang("1");
    expect(within(tr).getByText("Học viên 1")).toBeTruthy();
    expect(within(tr).getByText(/PH: Phụ huynh X/)).toBeTruthy();
    expect(within(tr).getByText("Nhập lịch sử")).toBeTruthy();
    expect(within(tr).getByText("Chưa có hoá đơn")).toBeTruthy();
    expect(within(tr).getByText("Chờ kế toán")).toBeTruthy();
    expect(within(tr).getByText(/Kế toán A ·/)).toBeTruthy();
    expect(within(tr).getByText("Chờ bổ sung")).toBeTruthy();
    expect(within(tr).getByText(/…abcdef12/)).toBeTruthy();
  });

  it("phụ huynh bị che (null) thì KHÔNG có dòng «PH:»; có hoá đơn thì hiện số", () => {
    vẽ([dong("1", "DA_TAI_LEN", { phuHuynh: null, hoaDon: "1C26MAI-1" })]);
    const tr = hang("1");
    expect(within(tr).queryByText(/PH:/)).toBeNull();
    expect(within(tr).getByText("HĐ 1C26MAI-1")).toBeTruthy();
  });

  it("bảng rỗng ⇒ nói rõ chưa có khoản nào được đánh dấu", () => {
    vẽ([]);
    expect(screen.getByText(/Chưa có khoản nào được đánh dấu/)).toBeTruthy();
  });

  it("lọc theo trạng thái: chọn «Đã tải lên» chỉ còn dòng ở trạng thái đó; số đếm đúng", () => {
    vẽ();
    expect(screen.getByRole("button", { name: "Tất cả (4)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Đã tải lên (1)" }));
    expect(screen.queryByText("ORD-269926-00091")).toBeNull();
    expect(screen.getByText("ORD-269926-00092")).toBeTruthy();
  });
});

describe("[CTB-03] thao tác: lý do bắt buộc trước khi xác nhận; gửi đúng tham số; thành công thì làm mới", () => {
  it("«Cần bổ sung lại» chặn cho tới khi lý do đủ 10 ký tự; sau đó gọi action đúng khoản và làm mới", async () => {
    vẽ();
    const tr = hang("2");
    fireEvent.click(nut(tr, /Cần bổ sung lại/)!);
    const xacNhan = within(tr).getByRole("button", { name: "Xác nhận" }) as HTMLButtonElement;
    expect(xacNhan.disabled).toBe(true);
    fireEvent.change(within(tr).getByLabelText("Lý do"), { target: { value: "ngắn" } });
    expect(xacNhan.disabled).toBe(true);
    fireEvent.change(within(tr).getByLabelText("Lý do"), { target: { value: "Ảnh mờ, không đọc được số tiền" } });
    expect(xacNhan.disabled).toBe(false);
    fireEvent.click(xacNhan);
    await waitFor(() => expect(h.boSung).toHaveBeenCalledWith({ paymentId: "cmpay0000002abcdef12", lyDo: "Ảnh mờ, không đọc được số tiền" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });

  it("«Đã kiểm tra» không đòi lý do (ghi chú tuỳ chọn)", async () => {
    vẽ();
    const tr = hang("2");
    fireEvent.click(nut(tr, /Đã kiểm tra/)!);
    fireEvent.click(within(tr).getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(h.kiemTra).toHaveBeenCalledWith({ paymentId: "cmpay0000002abcdef12", ghiChu: "" }));
  });

  it("server từ chối ⇒ báo lỗi, KHÔNG làm mới như thể thành công", async () => {
    h.kiemTra.mockResolvedValue({ ok: false, error: "Chưa có tệp chứng từ để kiểm tra" });
    vẽ();
    const tr = hang("2");
    fireEvent.click(nut(tr, /Đã kiểm tra/)!);
    fireEvent.click(within(tr).getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(h.loi).toHaveBeenCalledWith("Chưa có tệp chứng từ để kiểm tra"));
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

describe("[CTB-04] thêm khoản cần chứng từ: tìm theo mã đơn → chọn khoản (kể cả nhập lịch sử) → đánh dấu", () => {
  const KET_QUA = {
    maDon: "ORD-261023-000005",
    khoan: [
      { paymentId: "cmpayLICHSU00000001", soTien: 3_920_000, ngayThu: "2026-10-04T05:00:00.000Z", trangThaiKhoan: "PENDING", nhapLichSu: true, daDanhDau: false, lyDoKhong: null },
      { paymentId: "cmpayDAXOA000000002", soTien: 100_000, ngayThu: "2026-10-05T05:00:00.000Z", trangThaiKhoan: "REJECTED", nhapLichSu: false, daDanhDau: false, lyDoKhong: "Khoản thu đã bị kế toán từ chối" },
    ],
  };

  it("khoản nhập lịch sử đánh dấu được (nút sáng sau khi có lý do); khoản bị từ chối chỉ hiện lý do, KHÔNG có nút", async () => {
    h.tim.mockResolvedValue({ ok: true, data: KET_QUA });
    vẽ([]);
    fireEvent.change(screen.getByLabelText("Mã đơn"), { target: { value: "ORD-261023-000005" } });
    fireEvent.click(screen.getByRole("button", { name: "Tìm khoản" }));
    await waitFor(() => expect(h.tim).toHaveBeenCalledWith({ coSoId: "cs1", maDon: "ORD-261023-000005" }));
    const nutDanhDau = await screen.findByRole("button", { name: "Đánh dấu cần chứng từ" });
    expect((nutDanhDau as HTMLButtonElement).disabled).toBe(true); // chưa có lý do
    expect(screen.getByText("Khoản thu đã bị kế toán từ chối")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Đánh dấu cần chứng từ" })).toHaveLength(1); // chỉ khoản đánh dấu được
    expect(screen.getByText("Nhập lịch sử")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Lý do cần chứng từ"), { target: { value: "Cần sao kê MB ngày 04/10" } });
    expect((nutDanhDau as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(nutDanhDau);
    await waitFor(() => expect(h.danhDau).toHaveBeenCalledWith({ paymentId: "cmpayLICHSU00000001", lyDo: "Cần sao kê MB ngày 04/10" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });

  it("không thấy đơn ⇒ nói rõ; mã đơn quá ngắn ⇒ nút Tìm khoản tắt", async () => {
    h.tim.mockResolvedValue({ ok: true, data: null });
    vẽ([]);
    expect((screen.getByRole("button", { name: "Tìm khoản" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Mã đơn"), { target: { value: "ORD-1" } });
    expect((screen.getByRole("button", { name: "Tìm khoản" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Tìm khoản" }));
    expect(await screen.findByText(/Không tìm thấy đơn này/)).toBeTruthy();
  });
});
