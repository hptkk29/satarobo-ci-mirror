// @vitest-environment jsdom
/**
 * [HCX-UI-*] — NÚT «XỬ LÝ» + HỘP THOẠI ở dòng hàng chờ (tab Sổ, R9 · T1) trên PHẦN TỬ THẬT, Server Action giả lập.
 *
 * Canh cái `tsc` không thấy: nút chỉ có khi quyền ∧ có hành động làm được; hộp thoại xin XEM TRƯỚC khi mở; nhãn nút gửi đổi theo BƯỚC (quyết thẳng · lập đề nghị · duyệt cấp 2);
 * người đề nghị KHÔNG gửi được duyệt cho chính đề nghị của mình; cổng đang chặn thì «Giải phóng» khoá nhưng «Từ chối» vẫn dùng được; lỗi của server hiện NGAY TRONG hộp thoại.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const R = vi.hoisted(() => ({ refresh: vi.fn() }));
const A = vi.hoisted(() => ({ xem: vi.fn(), deNghi: vi.fn(), quyet: vi.fn(), xemTay: vi.fn() }));
const T = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: R.refresh }) }));
vi.mock("sonner", () => ({ toast: T }));
vi.mock("../_actions-hang-cho", () => ({
  xemTruocHangChoAction: A.xem,
  deNghiHangChoAction: A.deNghi,
  quyetHangChoAction: A.quyet,
  chuyenXemTayHangChoAction: A.xemTay,
}));
// Nút «Dời sang kỳ sau» nằm cùng bảng và import action của tab Kỳ (kéo next-auth + Prisma) ⇒ giả.
vi.mock("../../ky/_actions", () => ({ doiHangChoSangKySauAction: vi.fn() }));

import type { XemTruocView } from "@/lib/hoa-hong/hang-cho-xu-ly-hanh-dong";
import type { DongHangChoSo } from "@/lib/hoa-hong/hang-cho-so-doc";
import { BANG_CHUNG_TOI_THIEU } from "@/lib/hoa-hong/hang-cho-xu-ly";
import { LY_DO_TOI_THIEU } from "@/lib/hoa-hong/kieu";
import { HangChoSoBang } from "./hang-cho-so-bang";
import { NutXuLyHangCho } from "./nut-xu-ly-hang-cho";

beforeEach(() => {
  for (const f of [...Object.values(R), ...Object.values(A), ...Object.values(T)]) f.mockReset();
});
afterEach(cleanup);

const LY_DO = "Đã đối chiếu với kế toán trưởng";
const BANG_CHUNG = "Biên bản 14/10, phiếu PT-2026-1234";

const xemMau = (p: Partial<XemTruocView> = {}): XemTruocView => ({
  holdId: "h1",
  code: "INPUT_DRIFT",
  giaiPhong: { ok: true, tongTuyetDoi: 600_000, tongRong: 0, chenh: [{ khoa: "SALE|USER|aaaaaaaaa111111", chenh: -300_000 }, { khoa: "SALE|USER|bbbbbbbbb222222", chenh: 300_000 }], kyDuKien: "2026-11" },
  tien: 600_000,
  nguong: 10_000_000,
  cap: "MOT_CAP",
  chuCap: "Dưới ngưỡng duyệt hai cấp — một người có quyền quyết được.",
  trangThai: "CHUA_XU_LY",
  deNghi: null,
  xemTay: null,
  laNguoiDeNghi: false,
  ...p,
});
const CHO_PHEP = { giaiPhong: true, tuChoi: true, chuyenXemTay: true };

function mo(choPhep = CHO_PHEP) {
  render(<NutXuLyHangCho holdId="h1" tenMa="Đầu vào đã đổi sau khi tính" lyDoHold="Đầu vào đã đổi sau khi ô được tính" tienAnhHuong={600_000} choPhep={choPhep} />);
  fireEvent.click(screen.getAllByRole("button", { name: /Xử lý/ })[0]!);
  return screen.getByRole("dialog");
}
const gui = () => document.querySelector<HTMLButtonElement>('[data-xac-nhan="XU_LY_HANG_CHO"]')!;
const chon = (c: "AP_DUNG" | "GIU_NGUYEN" | "XEM_TAY") => fireEvent.click(document.querySelector<HTMLInputElement>(`[data-chon="${c}"]`)!);
const dien = (hop: HTMLElement, lyDo: string, bangChung: string | null) => {
  fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: lyDo } });
  if (bangChung !== null) fireEvent.change(within(hop).getByLabelText(/Bằng chứng/), { target: { value: bangChung } });
};

describe("[HCX-UI-01] mở hộp thoại ⇒ xin XEM TRƯỚC từ server (không tự tính ở client)", () => {
  it("gọi xem trước đúng một lần với holdId; in chênh lệch từng người + tổng; chưa chọn cách xử lý thì nút gửi khoá", async () => {
    A.xem.mockResolvedValue({ ok: true, thongBao: "", xem: xemMau() });
    const hop = mo();
    expect(A.xem).toHaveBeenCalledTimes(1);
    expect(A.xem).toHaveBeenCalledWith({ holdId: "h1" });
    await screen.findByText(/Nếu giải phóng bây giờ/);
    expect(hop.textContent).toContain("Tiền bị ảnh hưởng");
    expect(hop.textContent).toMatch(/Tổng tuyệt đối/);
    expect(hop.textContent).toContain("ghi vào kỳ 2026-11");
    expect(hop.textContent).toContain("SALE · …111111");
    expect(gui().disabled).toBe(true);
    expect(gui().textContent).toBe("Chọn cách xử lý");
  });

  it("server từ chối xem trước ⇒ lý do hiện trong hộp thoại, không có lựa chọn nào", async () => {
    A.xem.mockResolvedValue({ ok: false, ma: "HANG_CHO_KHONG_MO", loi: "Hàng chờ không tồn tại hoặc ngoài phạm vi của bạn." });
    mo();
    const canhBao = await screen.findByRole("alert");
    expect(canhBao.textContent).toContain("ngoài phạm vi");
    expect(document.querySelectorAll("[data-chon]")).toHaveLength(0);
  });
});

describe("[HCX-UI-02] dưới ngưỡng: MỘT người quyết thẳng", () => {
  it("«Giải phóng» đòi lý do + bằng chứng đủ dài; gửi đúng { holdId, quyetDinh, lyDo, bangChung, tienDaThay = số đã thấy }; thành công ⇒ toast + làm mới + đóng", async () => {
    A.xem.mockResolvedValue({ ok: true, thongBao: "", xem: xemMau() });
    A.quyet.mockResolvedValue({ ok: true, thongBao: "Đã giải phóng: ghi 2 dòng điều chỉnh.", daXuLyTruoc: false, soDong: 2, tong: 0 });
    const hop = mo();
    await screen.findByText(/Nếu giải phóng bây giờ/);
    chon("AP_DUNG");
    expect(gui().textContent).toBe("Giải phóng");
    expect(gui().disabled).toBe(true); // chưa có lý do
    dien(hop, "x".repeat(LY_DO_TOI_THIEU - 1), "y".repeat(BANG_CHUNG_TOI_THIEU));
    expect(gui().disabled).toBe(true); // lý do thiếu 1 ký tự
    dien(hop, LY_DO, "y".repeat(BANG_CHUNG_TOI_THIEU - 1));
    expect(gui().disabled).toBe(true); // bằng chứng thiếu 1 ký tự
    dien(hop, LY_DO, BANG_CHUNG);
    expect(gui().disabled).toBe(false); // đối chứng dương
    expect(A.quyet).not.toHaveBeenCalled();
    fireEvent.click(gui());
    await waitFor(() => expect(R.refresh).toHaveBeenCalledTimes(1));
    expect(A.quyet).toHaveBeenCalledWith({ holdId: "h1", quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000 });
    expect(A.deNghi).not.toHaveBeenCalled();
    expect(T.success).toHaveBeenCalledWith("Đã giải phóng: ghi 2 dòng điều chỉnh.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("«Từ chối» gửi quyetDinh = GIU_NGUYEN (cùng action quyết)", async () => {
    A.xem.mockResolvedValue({ ok: true, thongBao: "", xem: xemMau() });
    A.quyet.mockResolvedValue({ ok: true, thongBao: "Đã từ chối điều chỉnh (giữ nguyên).", daXuLyTruoc: false, soDong: 0, tong: 0 });
    const hop = mo();
    await screen.findByText(/Nếu giải phóng bây giờ/);
    chon("GIU_NGUYEN");
    expect(gui().textContent).toBe("Từ chối (giữ nguyên)");
    dien(hop, LY_DO, BANG_CHUNG);
    fireEvent.click(gui());
    await waitFor(() => expect(A.quyet).toHaveBeenCalledTimes(1));
    expect(A.quyet.mock.calls[0]![0]).toMatchObject({ quyetDinh: "GIU_NGUYEN", holdId: "h1" });
  });

  it("server từ chối ⇒ lý do hiện TRONG hộp thoại (role=alert), hộp thoại KHÔNG đóng, không toast thành công, không làm mới", async () => {
    A.xem.mockResolvedValue({ ok: true, thongBao: "", xem: xemMau() });
    A.quyet.mockResolvedValue({ ok: false, ma: "TIEN_DA_DOI", loi: "Số tiền điều chỉnh tính lại lớn hơn số bạn đã xem." });
    const hop = mo();
    await screen.findByText(/Nếu giải phóng bây giờ/);
    chon("AP_DUNG");
    dien(hop, LY_DO, BANG_CHUNG);
    fireEvent.click(gui());
    const canhBao = await screen.findByRole("alert");
    expect(canhBao.textContent).toContain("lớn hơn số bạn đã xem");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(T.success).not.toHaveBeenCalled();
    expect(R.refresh).not.toHaveBeenCalled();
  });
});

describe("[HCX-UI-03] từ ngưỡng: HAI người — nhãn nút theo BƯỚC", () => {
  const hai = (p: Partial<XemTruocView> = {}) => xemMau({ cap: "HAI_CAP", chuCap: "Số tiền đạt hoặc vượt ngưỡng 100.000 — cần hai người.", nguong: 100_000, ...p });

  it("chưa có đề nghị ⇒ «Lập đề nghị (chờ người khác duyệt)» ⇒ gọi action ĐỀ NGHỊ, KHÔNG gọi action quyết", async () => {
    A.xem.mockResolvedValue({ ok: true, thongBao: "", xem: hai() });
    A.deNghi.mockResolvedValue({ ok: true, thongBao: "Đã lập đề nghị.", daCoTruoc: false });
    const hop = mo();
    await screen.findByText(/cần hai người/);
    chon("AP_DUNG");
    expect(gui().textContent).toBe("Lập đề nghị (chờ người khác duyệt)");
    dien(hop, LY_DO, BANG_CHUNG);
    fireEvent.click(gui());
    await waitFor(() => expect(A.deNghi).toHaveBeenCalledTimes(1));
    expect(A.deNghi).toHaveBeenCalledWith({ holdId: "h1", quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG });
    expect(A.quyet).not.toHaveBeenCalled();
  });

  it("có đề nghị của người KHÁC, cùng chiều ⇒ «Duyệt cấp 2 và giải phóng» ⇒ gọi action QUYẾT; hộp thoại in người đề nghị và lý do của họ", async () => {
    A.xem.mockResolvedValue({
      ok: true,
      thongBao: "",
      xem: hai({ trangThai: "CHO_DUYET_CAP_HAI", deNghi: { nguoiId: "u1", tenNguoi: "Người một", luc: "2026-10-14T03:00:00.000Z", quyetDinh: "AP_DUNG", tien: 600_000, lyDo: "Đã đối chiếu", bangChung: "PT-1" } }),
    });
    A.quyet.mockResolvedValue({ ok: true, thongBao: "Đã giải phóng.", daXuLyTruoc: false, soDong: 2, tong: 0 });
    const hop = mo();
    await screen.findByText(/Đề nghị cấp 1/);
    expect(hop.textContent).toContain("Người một");
    expect(hop.textContent).toContain("Đã đối chiếu");
    chon("AP_DUNG");
    expect(gui().textContent).toBe("Duyệt cấp 2 và giải phóng");
    dien(hop, "Đồng ý, số khớp biên bản", "Biên bản 14/10 đã kiểm");
    fireEvent.click(gui());
    await waitFor(() => expect(A.quyet).toHaveBeenCalledTimes(1));
    expect(A.deNghi).not.toHaveBeenCalled();
  });

  it("đề nghị là của CHÍNH MÌNH ⇒ nút gửi khoá + nói rõ «cần người KHÁC duyệt» (không để bấm rồi mới bị từ chối)", async () => {
    A.xem.mockResolvedValue({
      ok: true,
      thongBao: "",
      xem: hai({ laNguoiDeNghi: true, deNghi: { nguoiId: "toi", tenNguoi: "Tôi", luc: "2026-10-14T03:00:00.000Z", quyetDinh: "AP_DUNG", tien: 600_000, lyDo: "Đã đối chiếu", bangChung: "PT-1" } }),
    });
    const hop = mo();
    await screen.findByText(/Đề nghị cấp 1/);
    chon("AP_DUNG");
    dien(hop, LY_DO, BANG_CHUNG);
    expect(gui().disabled).toBe(true);
    expect(hop.textContent).toMatch(/chính bạn/);
    expect(hop.textContent).toMatch(/KHÁC duyệt/);
  });

  it("cấp 1 đề nghị chiều NÀY, người khác chọn chiều KIA ⇒ KHÔNG kẹt: lập đề nghị MỚI theo chiều của mình (đề nghị mới nhất thắng)", async () => {
    A.xem.mockResolvedValue({
      ok: true,
      thongBao: "",
      xem: hai({ deNghi: { nguoiId: "u1", tenNguoi: "Người một", luc: "2026-10-14T03:00:00.000Z", quyetDinh: "GIU_NGUYEN", tien: 600_000, lyDo: "Giữ nguyên", bangChung: "PT-1" } }),
    });
    const hop = mo();
    await screen.findByText(/Đề nghị cấp 1/);
    chon("AP_DUNG");
    dien(hop, LY_DO, BANG_CHUNG);
    expect(gui().disabled).toBe(false);
    expect(gui().textContent).toBe("Lập lại đề nghị (chờ người khác duyệt)");
    expect(hop.querySelector("[data-de-nghi-lai]")?.textContent).toMatch(/chiều khác/);
  });

  it("số tiền đã TĂNG vượt trần của đề nghị cấp 1 ⇒ KHÔNG hiện «Duyệt» (sẽ bị TIEN_DA_DOI mãi) mà là «Lập lại đề nghị»; kể cả với CHÍNH người đề nghị", async () => {
    const tang = hai({
      giaiPhong: { ok: true, tongTuyetDoi: 900_000, tongRong: 0, chenh: [{ khoa: "SALE|USER|aaaaaaaaa111111", chenh: -450_000 }, { khoa: "SALE|USER|bbbbbbbbb222222", chenh: 450_000 }], kyDuKien: "2026-11" },
      tien: 900_000,
      deNghi: { nguoiId: "u1", tenNguoi: "Người một", luc: "2026-10-14T03:00:00.000Z", quyetDinh: "AP_DUNG", tien: 600_000, lyDo: "Đã đối chiếu", bangChung: "PT-1" },
    });
    for (const laNguoiDeNghi of [false, true]) {
      cleanup();
      A.xem.mockResolvedValue({ ok: true, thongBao: "", xem: { ...tang, laNguoiDeNghi } });
      const hop = mo();
      await screen.findByText(/Đề nghị cấp 1/);
      chon("AP_DUNG");
      dien(hop, LY_DO, BANG_CHUNG);
      expect(gui().textContent, String(laNguoiDeNghi)).toBe("Lập lại đề nghị (chờ người khác duyệt)");
      expect(gui().disabled, String(laNguoiDeNghi)).toBe(false);
      expect(hop.querySelector("[data-de-nghi-lai]")?.textContent).toMatch(/TĂNG/);
    }
  });
});

describe("[HCX-UI-04] cổng của «Giải phóng» đang chặn", () => {
  it("xem trước báo lỗi cổng ⇒ nói đúng lý do, «Giải phóng» khoá, «Từ chối» VẪN chọn và gửi được (an toàn tiền)", async () => {
    A.xem.mockResolvedValue({
      ok: true,
      thongBao: "",
      xem: xemMau({ giaiPhong: { ok: false, ma: "DAU_VAO_DA_DOI", loi: "Đầu vào đã đổi sau khi hàng chờ được lập — Tính lại để thấy chênh lệch mới." } }),
    });
    A.quyet.mockResolvedValue({ ok: true, thongBao: "Đã từ chối điều chỉnh.", daXuLyTruoc: false, soDong: 0, tong: 0 });
    const hop = mo();
    await screen.findByText(/Chưa giải phóng được/);
    expect(hop.textContent).toContain("Tính lại để thấy chênh lệch mới");
    expect(document.querySelector<HTMLInputElement>('[data-chon="AP_DUNG"]')!.disabled).toBe(true);
    chon("GIU_NGUYEN");
    dien(hop, LY_DO, BANG_CHUNG);
    expect(gui().disabled).toBe(false);
    fireEvent.click(gui());
    await waitFor(() => expect(A.quyet).toHaveBeenCalledTimes(1));
  });
});

describe("[HCX-UI-05] chuyển xem tay — chỉ cần lý do", () => {
  it("không đòi bằng chứng; gửi { holdId, lyDo } tới action xem tay; không gọi quyết/đề nghị", async () => {
    A.xem.mockResolvedValue({ ok: true, thongBao: "", xem: xemMau() });
    A.xemTay.mockResolvedValue({ ok: true, thongBao: "Đã chuyển xem tay.", daCoTruoc: false });
    const hop = mo();
    await screen.findByText(/Nếu giải phóng bây giờ/);
    chon("XEM_TAY");
    expect(within(hop).queryByLabelText(/Bằng chứng/)).toBeNull();
    dien(hop, "Cần kế toán trưởng xem khoản này", null);
    expect(gui().textContent).toBe("Chuyển xem tay");
    fireEvent.click(gui());
    await waitFor(() => expect(A.xemTay).toHaveBeenCalledWith({ holdId: "h1", lyDo: "Cần kế toán trưởng xem khoản này" }));
    expect(A.quyet).not.toHaveBeenCalled();
    expect(A.deNghi).not.toHaveBeenCalled();
  });

  it("`choPhep` tắt từng hành động ⇒ lựa chọn tương ứng bị khoá (đối chứng: bật thì chọn được)", async () => {
    A.xem.mockResolvedValue({ ok: true, thongBao: "", xem: xemMau() });
    mo({ giaiPhong: false, tuChoi: true, chuyenXemTay: false });
    await screen.findByText(/Nếu giải phóng bây giờ/);
    const d = (c: string) => document.querySelector<HTMLInputElement>(`[data-chon="${c}"]`)!.disabled;
    expect([d("AP_DUNG"), d("GIU_NGUYEN"), d("XEM_TAY")]).toEqual([true, false, true]);
  });
});

describe("[HCX-UI-06] bảng: nút «Xử lý» chỉ khi quyền ∧ có hành động làm được", () => {
  const huongDuoc = { giaiPhong: { duoc: true as const }, tuChoi: { duoc: true as const }, chuyenXemTay: { duoc: true as const }, deXuatId: null };
  const huongKhong = (lyDo: string) => ({ giaiPhong: { duoc: false as const, lyDo }, tuChoi: { duoc: false as const, lyDo }, chuyenXemTay: { duoc: false as const, lyDo }, deXuatId: "dx1" });
  const dong = (p: Partial<DongHangChoSo> = {}): DongHangChoSo => ({
    id: "h1",
    holdKey: "hk1",
    ma: "INPUT_DRIFT",
    tenMa: "Đầu vào đã đổi sau khi tính",
    nhom: "CHAN_KHOA_KY",
    loai: "CHO_DIEU_CHINH",
    chanKhoa: true,
    kyChan: "2026-10",
    doiDuoc: false,
    paymentId: "pay_1",
    orderId: "ord_1",
    orderItemId: null,
    studentId: "stu_1",
    tenHocVien: "Nguyễn Bảo Minh",
    centerId: "cs1",
    coSo: { code: "CS1", ten: "Cơ sở 211 Nguyễn Hữu Thọ" },
    vai: null,
    lyDoMa: null,
    lyDo: "Đầu vào đã đổi sau khi ô được tính",
    khongCoLead: false,
    buoc: "Duyệt: áp dụng hoặc giữ nguyên",
    lienKet: null,
    tienVai: null,
    tienAnhHuong: 600_000,
    xuLy: { huong: huongDuoc, trangThai: "CHUA_XU_LY", deNghi: null, xemTay: null },
    taoLuc: new Date("2026-10-14T03:00:00Z"),
    ...p,
  });
  const bang = (dongs: DongHangChoSo[], coTheXuLy: boolean) =>
    render(<HangChoSoBang dong={dongs} tong={dongs.length} trang={1} kichThuoc={25} hrefTrang={() => "/x"} coTheDoiKy={false} coTheXuLy={coTheXuLy} />);
  const nutXuLy = () => document.querySelectorAll("[data-xu-ly-hang-cho]");

  it("có quyền ∧ hành động làm được ⇒ có nút (đối chứng dương); thiếu quyền ⇒ không; hàng chờ của đề xuất ⇒ không; mã khác (xuLy=null) ⇒ không", () => {
    const { unmount } = bang([dong()], true);
    expect(nutXuLy().length).toBeGreaterThan(0);
    expect([...nutXuLy()].every((n) => n.getAttribute("data-xu-ly-hang-cho") === "h1")).toBe(true);
    unmount();
    bang([dong()], false);
    expect(nutXuLy()).toHaveLength(0);
    cleanup();
    bang([dong({ xuLy: { huong: huongKhong("thuộc đề xuất"), trangThai: "CHUA_XU_LY", deNghi: null, xemTay: null } })], true);
    expect(nutXuLy()).toHaveLength(0);
    cleanup();
    bang([dong({ ma: "CAP_EXCEEDED", tenMa: "Vượt trần tổng tỉ lệ", xuLy: null, tienAnhHuong: null })], true);
    expect(nutXuLy()).toHaveLength(0);
  });

  it("trạng thái xử lý hiện cho MỌI người xem (kể cả không có quyền xử lý); tiền ảnh hưởng và ngày tạo có mặt", () => {
    bang([dong({ xuLy: { huong: huongDuoc, trangThai: "CHO_DUYET_CAP_HAI", deNghi: { nguoiId: "u1", tenNguoi: "Người một", luc: new Date("2026-10-14T03:00:00Z"), quyetDinh: "AP_DUNG", tien: 600_000 }, xemTay: null } })], false);
    expect(document.querySelector('[data-trang-thai-xu-ly="CHO_DUYET_CAP_HAI"]')?.textContent).toContain("Chờ người khác duyệt");
    expect(document.querySelector('[data-trang-thai-xu-ly="CHO_DUYET_CAP_HAI"]')?.textContent).toContain("Người một");
    expect(document.querySelector("[data-tien-anh-huong]")?.textContent).toContain("600.000");
    expect(document.querySelector("[data-tao-luc]")?.textContent).toMatch(/14\/10\/2026/);
    expect(nutXuLy()).toHaveLength(0);
  });
});
