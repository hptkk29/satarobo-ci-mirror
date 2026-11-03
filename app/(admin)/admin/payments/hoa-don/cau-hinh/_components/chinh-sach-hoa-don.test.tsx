// @vitest-environment jsdom
// Ca [CSUI-*] — giao diện khu "Chính sách hoá đơn" + "Nhà cung cấp & ký (chỉ đọc)" (S7, Invoice Hub). Render THẬT theo vai: mỗi ca "KHÔNG thấy nút X"
// đi kèm đối chứng dương ("vai kia THẤY nút X") — luật 12; ca chỉ khẳng định SỰ VẮNG MẶT luôn ĐẠT khi tính năng hỏng hoàn toàn.
// Cờ nút do server tính bằng `hanhDongChinhSachChoPhep` (test thuần ở `chinh-sach-phien-ban.test.ts`); ở đây kiểm CÁCH VẼ + dây nối tới action.
import { readFileSync } from "node:fs";
import { resolve as duongDan } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { HanhDongChinhSach } from "@/lib/finance/hoa-don/quyen";
import { phanTichNoiDung, type NoiDungChinhSach } from "@/lib/finance/hoa-don/chinh-sach-phien-ban";
import type { KetQuaMoPhongChinhSach } from "@/lib/finance/hoa-don/chinh-sach-mo-phong";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  sp: { current: new URLSearchParams() },
  toastOk: vi.fn(),
  tao: vi.fn(),
  gui: vi.fn(),
  duyet: vi.fn(),
  tuChoi: vi.fn(),
  ketThuc: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, refresh: h.refresh }),
  usePathname: () => "/payments/hoa-don/cau-hinh",
  useSearchParams: () => h.sp.current,
}));
vi.mock("sonner", () => ({ toast: { success: h.toastOk, error: vi.fn() } }));
vi.mock("../_chinh-sach-actions", () => ({
  taoNhapChinhSachAction: h.tao,
  guiDuyetChinhSachAction: h.gui,
  duyetChinhSachAction: h.duyet,
  tuChoiChinhSachAction: h.tuChoi,
  hetHieuLucChinhSachAction: h.ketThuc,
}));

import { ChinhSachHoaDon, type BanHienThi } from "./chinh-sach-hoa-don";
import { NhaCungCapChiDoc } from "./nha-cung-cap-chi-doc";
import { MoPhongBang } from "./mo-phong-bang";

const dong = (loaiKhoan: string, phanTram = 8) => ({
  loaiKhoan,
  mucThue: { kieu: "SUAT", phanTram },
  kieuGia: "DA_GOM_THUE",
  donViTinh: "Lần",
  donViTinhBuoi: "Buổi",
  cachThuSoBuoi: "MOT_KHOA_MO_TA_SO_BUOI",
  mauMoTaSoBuoi: "({n} buổi)",
});
const nd = (o: Record<string, unknown> = {}): NoiDungChinhSach => {
  const r = phanTichNoiDung({
    anhXaThue: [dong("COURSE"), dong("EXAM", 10)],
    thoiDiemLap: "DO_KE_TOAN_CHOT",
    cheDoToiDa: "SHADOW",
    nguoiMua: { buyerInfoLevel: "NGUOI_TIEU_DUNG" },
    lamTron: "HALF_UP",
    legalBasisRef: [{ vanBan: "Văn bản thử", dieu: "5", doTinCay: "TRUNG", canKeToanXacNhan: true }],
    ...o,
  });
  if (!r.ok) throw new Error(r.loi.join("|"));
  return r.noiDung;
};

const CAM: HanhDongChinhSach = { guiDuyet: false, apDungNgay: false, duyet: false, tuChoi: false, ketThuc: false, lyDoKhongDuyet: null };
const ketQuaMP: KetQuaMoPhongChinhSach = {
  xemTruoc: true,
  ngay: "2026-07-01",
  soMau: 2,
  soMauDoiKetQua: 1,
  soMauSauLoi: 1,
  chenhLechThue: -664_889,
  dong: [
    {
      mau: { ma: "mau-COURSE", tenGoc: "Khoá học (mẫu)", loaiKhoan: "COURSE", soTien: 8_976_000, soBuoi: 48 },
      truoc: { ok: true, thanhTienTruocThue: 8_311_111, tienThue: 664_889, congTien: 8_976_000, nhomThue: "SUAT:8", quyTac: "x@v1", canhBao: [] },
      sau: { ok: true, thanhTienTruocThue: 8_976_000, tienThue: 0, congTien: 8_976_000, nhomThue: "KCT", quyTac: "x@v2", canhBao: [] },
      doi: true,
    },
    {
      mau: { ma: "mau-PRODUCT", tenGoc: "Khoản thu (mẫu)", loaiKhoan: "PRODUCT", soTien: 1_234_567, soBuoi: null },
      truoc: { ok: true, thanhTienTruocThue: 1_143_117, tienThue: 91_450, congTien: 1_234_567, nhomThue: "SUAT:8", quyTac: "x@v1", canhBao: [] },
      sau: { ok: false, ma: "KHONG_CO", thongDiep: "Chưa có quy tắc hoá đơn nào hiệu lực" },
      doi: true,
    },
  ],
};

const ban = (o: Partial<BanHienThi> & { id: string }): BanHienThi => ({
  phienBan: 1,
  centerId: "cs1",
  trangThai: "NHAP",
  hieuLucTu: "2026-07-01",
  hieuLucDen: null,
  tenNguoiTao: "Kế toán A",
  tenNguoiDuyet: null,
  lyDo: null,
  noiDung: nd(),
  loiNoiDung: [],
  moPhong: { ok: true, ketQua: ketQuaMP, hash: "a".repeat(64) },
  hanhDong: CAM,
  lichSu: [{ id: "l1", hanhDong: "TAO_CHINH_SACH_HOA_DON", luc: "2026-11-01T03:00:00.000Z", nguoi: "Kế toán A", lyDo: "Soạn phiên bản đầu" }],
  ...o,
});

const ve = (o: { ban?: BanHienThi[]; rieng?: boolean; chung?: boolean } = {}) =>
  render(
    <ChinhSachHoaDon
      centerId="cs1"
      tenCoSo="CS1 · Trụ sở"
      phapNhan={{ ma: "NEW_VISION", ten: "NEW VISION", maSoThue: "0402341070" }}
      ban={o.ban ?? []}
      coTheSoanRieng={o.rieng ?? false}
      coTheSoanChung={o.chung ?? false}
    />,
  );
const moBan = (id: string) => (h.sp.current = new URLSearchParams({ chinhSach: id }));
const nut = (ten: RegExp | string) => screen.queryByRole("button", { name: ten });

beforeEach(() => {
  vi.clearAllMocks();
  h.sp.current = new URLSearchParams();
  h.tao.mockResolvedValue({ ok: true, data: { id: "moi", phienBan: 3, trangThai: "NHAP" } });
  for (const f of [h.gui, h.duyet, h.tuChoi, h.ketThuc]) f.mockResolvedValue({ ok: true, data: { id: "a", phienBan: 1, trangThai: "HIEU_LUC" } });
});
afterEach(cleanup);

describe("[CSUI-01] trạng thái rỗng + nút soạn theo quyền (cả hai chiều)", () => {
  it("chưa có bản nào ⇒ nói vì sao rỗng + nói hệ thống KHÔNG tự đặt mức thuế", () => {
    ve();
    expect(screen.getByText(/chưa có chính sách nào/i)).toBeTruthy();
    expect(screen.getByText(/KHÔNG tự đặt mức thuế/)).toBeTruthy();
  });
  it("kế toán cơ sở: thấy 'Soạn bản riêng', KHÔNG thấy 'Soạn bản dùng chung'; kế toán Hội sở: thấy cả hai; chỉ-xem: không nút nào + câu giải thích", () => {
    const a = ve({ rieng: true, chung: false });
    expect(nut(/Soạn bản riêng/)).toBeTruthy();
    expect(nut(/Soạn bản dùng chung/)).toBeNull();
    a.unmount();
    const b = ve({ rieng: true, chung: true });
    expect(nut(/Soạn bản riêng/)).toBeTruthy();
    expect(nut(/Soạn bản dùng chung/)).toBeTruthy();
    b.unmount();
    ve({ rieng: false, chung: false });
    expect(nut(/Soạn bản/)).toBeNull();
    expect(screen.getByText(/Bạn chỉ xem được khu này/)).toBeTruthy();
  });
  it("tiêu đề nêu RÕ pháp nhân + cơ sở đang xem", () => {
    ve();
    expect(screen.getByText("NEW VISION")).toBeTruthy();
    expect(screen.getByText(/MST 0402341070/)).toBeTruthy();
    expect(screen.getByText("CS1 · Trụ sở")).toBeTruthy();
  });
});

describe("[CSUI-02] danh sách + mở chi tiết giữ qua URL", () => {
  const ds = [ban({ id: "a", phienBan: 2, trangThai: "CHO_DUYET" }), ban({ id: "b", phienBan: 1, trangThai: "HIEU_LUC", centerId: null, hieuLucDen: "2026-12-31" })];
  it("mỗi phiên bản một dòng: phạm vi, hiệu lực dd/mm/yyyy, trạng thái bằng chữ", () => {
    ve({ ban: ds });
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("Chờ duyệt")).toBeTruthy();
    expect(screen.getByText("Đang hiệu lực")).toBeTruthy();
    expect(screen.getByText("Dùng chung")).toBeTruthy();
    expect(screen.getByText(/01\/07\/2026 → 31\/12\/2026/)).toBeTruthy();
    expect(screen.getByText(/01\/07\/2026 → không giới hạn/)).toBeTruthy();
  });
  it("bấm 'Xem' ⇒ ghi ?chinhSach=<id> lên URL (replace, không cuộn); mở sẵn từ URL ⇒ hiện chi tiết", () => {
    const a = ve({ ban: ds });
    fireEvent.click(screen.getByRole("button", { name: /Xem phiên bản 2/ }));
    expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don/cau-hinh?chinhSach=a", { scroll: false });
    a.unmount();
    moBan("a");
    ve({ ban: ds });
    expect(screen.getByRole("article", { name: /Chi tiết phiên bản 2/ })).toBeTruthy();
  });
  it("id trên URL không thuộc phạm vi (bản của cơ sở khác / đã đổi) ⇒ nói không tìm thấy, KHÔNG dựng chi tiết", () => {
    moBan("khong-co");
    ve({ ban: ds });
    expect(screen.getByRole("alert").textContent).toMatch(/Không tìm thấy phiên bản này/);
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("[CSUI-03] chi tiết: nội dung, căn cứ, mô phỏng trước/sau", () => {
  it("bảng ánh xạ thuế + căn cứ chưa ký (chỉ được chạy thử) + hiệu lực QR mặc định 4 giờ", () => {
    moBan("a");
    ve({ ban: [ban({ id: "a" })] });
    const art = within(screen.getByRole("article"));
    const thue = within(art.getByRole("region", { name: "Ánh xạ thuế" }));
    expect(thue.getByText("Học phí khoá học")).toBeTruthy(); // nhãn tiếng Việt thay cho mã thô
    expect(thue.getByText("(COURSE)")).toBeTruthy(); // mã vẫn hiện nhỏ để đối chiếu
    expect(thue.getByText("10%")).toBeTruthy();
    expect(thue.getAllByText(/Số tiền trên đơn đã gồm thuế/).length).toBe(2);
    expect(art.getByText(/Cần kế toán xác nhận — chưa ai ký, chỉ được chạy thử/)).toBeTruthy();
    expect(art.getByText(/4 giờ \(mặc định 4 giờ\)/)).toBeTruthy();
  });
  it("căn cứ có 'người ký duyệt' do người soạn gõ ⇒ nói là KHAI + CHƯA xác minh, không in như một chữ ký đã kiểm (luật 12)", () => {
    moBan("a");
    const canCu = [{ vanBan: "Văn bản thử", dieu: "5", doTinCay: "TRUNG", canKeToanXacNhan: true, daKyDuyetBoi: "Kế toán trưởng", daKyDuyetLuc: "2026-10-30" }];
    ve({ ban: [ban({ id: "a", noiDung: nd({ legalBasisRef: canCu, cheDoToiDa: "TU_DONG" }) })] });
    const dong = within(screen.getByRole("article")).getByText(/Kế toán trưởng/).textContent ?? "";
    expect(dong).toMatch(/Người soạn khai/);
    expect(dong).toMatch(/30\/10\/2026/);
    expect(dong).toMatch(/chưa xác minh/);
    expect(dong).not.toMatch(/^Đã ký duyệt bởi/);
    // đối chứng: căn cứ chưa có người ký vẫn nói "chưa ai ký"
    cleanup();
    moBan("a");
    ve({ ban: [ban({ id: "a" })] });
    expect(within(screen.getByRole("article")).getByText(/chưa ai ký, chỉ được chạy thử/)).toBeTruthy();
  });
  it("QR khai 6 giờ ⇒ hiện 6 giờ, KHÔNG nói 'mặc định'", () => {
    moBan("a");
    ve({ ban: [ban({ id: "a", noiDung: nd({ nguoiMua: { buyerInfoLevel: "NGUOI_TIEU_DUNG", qrTtlGio: 6 } }) })] });
    expect(screen.getByText("6 giờ")).toBeTruthy();
    expect(screen.queryByText(/mặc định 4 giờ/)).toBeNull();
  });
  it("mô phỏng: nói rõ số liệu MẪU, tóm tắt số khoản đổi + chênh thuế, khoản KHÔNG còn quy tắc, bảng trước/sau", () => {
    moBan("a");
    ve({ ban: [ban({ id: "a" })] });
    const mp = within(screen.getByRole("region", { name: "Mô phỏng trước và sau" }));
    expect(mp.getByText(/không phải hoá đơn thật/)).toBeTruthy();
    expect(mp.getByRole("status").textContent).toMatch(/1\/2 khoản mẫu đổi kết quả, tổng thuế giảm 664\.889đ/);
    expect(mp.getByText(/1 khoản mẫu sẽ KHÔNG còn quy tắc/)).toBeTruthy();
    expect(mp.getAllByText(/Thuế/).length).toBeGreaterThanOrEqual(2);
    expect(mp.getByText("Chưa có quy tắc cho loại khoản này")).toBeTruthy();
    expect(mp.getAllByText("Đổi").length).toBe(2);
  });
  it("bản đã hiệu lực không có bảng mô phỏng (không cần) và có câu 'không sửa được'", () => {
    moBan("a");
    ve({ ban: [ban({ id: "a", trangThai: "HIEU_LUC", moPhong: null })] });
    expect(screen.queryByRole("region", { name: "Mô phỏng trước và sau" })).toBeNull();
    expect(screen.getByText(/Bản đã có hiệu lực không sửa được/)).toBeTruthy();
  });
  it("nội dung DB hỏng ⇒ báo lỗi, không dựng bảng, không cho 'Soạn bản mới từ bản này'", () => {
    moBan("a");
    ve({ ban: [ban({ id: "a", noiDung: null, loiNoiDung: ["anhXaThue: rỗng"], moPhong: null })], rieng: true });
    expect(screen.getByRole("alert").textContent).toMatch(/không đọc được: anhXaThue: rỗng/);
    expect(screen.queryByText("Ánh xạ thuế theo loại khoản")).toBeNull();
    expect(nut(/Soạn bản mới từ bản này/)).toBeNull();
  });
  it("mô phỏng không dựng được ⇒ nói lỗi và KHÔNG có nút Duyệt dù vai được phép (không có băm để gửi)", () => {
    moBan("a");
    ve({ ban: [ban({ id: "a", trangThai: "CHO_DUYET", moPhong: { ok: false, loi: ["nội dung sai"] }, hanhDong: { ...CAM, duyet: true, tuChoi: true } })] });
    expect(screen.getByText(/Không dựng được mô phỏng: nội dung sai/)).toBeTruthy();
    const duyet = nut("Duyệt") as HTMLButtonElement;
    expect(duyet.disabled).toBe(true);
  });
});

describe("[CSUI-04] NÚT theo vai: vai thấy / vai không thấy, kèm đối chứng dương", () => {
  const choDuyet = { trangThai: "CHO_DUYET" as const };
  it("kế toán Hội sở: thấy Duyệt + Từ chối, KHÔNG thấy Gửi duyệt (không còn phân biệt người soạn / người khác)", () => {
    moBan("a");
    ve({ ban: [ban({ id: "a", ...choDuyet, hanhDong: { ...CAM, duyet: true, tuChoi: true } })] });
    expect(nut("Duyệt")).toBeTruthy();
    expect(nut("Từ chối")).toBeTruthy();
    expect(nut("Gửi duyệt")).toBeNull();
  });
  it("người KHÔNG có quyền duyệt xem bản chờ duyệt: KHÔNG có Duyệt/Từ chối, và thấy LỜI GIẢI THÍCH vì sao (không phải khoảng trống)", () => {
    moBan("a");
    ve({ ban: [ban({ id: "a", ...choDuyet, hanhDong: { ...CAM, lyDoKhongDuyet: "Đang chờ kế toán Hội sở duyệt (tài khoản của bạn chưa có quyền duyệt chính sách)." } })] });
    expect(nut("Duyệt")).toBeNull();
    expect(nut("Từ chối")).toBeNull();
    expect(screen.getByText(/chưa có quyền duyệt chính sách/)).toBeTruthy();
    expect(screen.queryByLabelText(/Lý do \(ít nhất/)).toBeNull();
  });
  it("kế toán cơ sở xem bản chờ duyệt: KHÔNG Duyệt; thấy câu 'Đang chờ kế toán Hội sở duyệt'", () => {
    moBan("a");
    ve({ ban: [ban({ id: "a", ...choDuyet, hanhDong: { ...CAM, lyDoKhongDuyet: "Đang chờ kế toán Hội sở duyệt." } })] });
    expect(nut("Duyệt")).toBeNull();
    expect(screen.getByText("Đang chờ kế toán Hội sở duyệt.")).toBeTruthy();
  });
  it("bản NHÁP: người có quyền ghi thấy Gửi duyệt (đối chứng dương); người chỉ xem thì không có nút nào", () => {
    moBan("a");
    const a = ve({ ban: [ban({ id: "a", hanhDong: { ...CAM, guiDuyet: true } })] });
    expect(nut("Gửi duyệt")).toBeTruthy();
    expect(nut("Duyệt")).toBeNull();
    a.unmount();
    ve({ ban: [ban({ id: "a" })] });
    expect(nut("Gửi duyệt")).toBeNull();
    expect(screen.queryByRole("region", { name: "Hành động" })).toBeNull();
  });
  it("bản HIỆU LỰC: Hội sở thấy 'Kết thúc hiệu lực'; kế toán cơ sở không thấy", () => {
    moBan("a");
    const a = ve({ ban: [ban({ id: "a", trangThai: "HIEU_LUC", moPhong: null, hanhDong: { ...CAM, ketThuc: true } })] });
    expect(nut("Kết thúc hiệu lực")).toBeTruthy();
    a.unmount();
    ve({ ban: [ban({ id: "a", trangThai: "HIEU_LUC", moPhong: null })] });
    expect(nut("Kết thúc hiệu lực")).toBeNull();
  });
  it("không có nút SỬA nội dung ở bất kỳ trạng thái nào (sửa = phiên bản mới)", () => {
    for (const t of ["NHAP", "CHO_DUYET", "HIEU_LUC", "HET_HIEU_LUC", "TU_CHOI"] as const) {
      moBan("a");
      const r = ve({ ban: [ban({ id: "a", trangThai: t, hanhDong: { guiDuyet: true, apDungNgay: true, duyet: true, tuChoi: true, ketThuc: true, lyDoKhongDuyet: null } })] });
      expect(nut(/^Sửa/), t).toBeNull();
      r.unmount();
    }
  });
});

describe("[CSUI-04b] bản chờ duyệt KHÔNG có mô phỏng: nút Duyệt không bật được VÀ có câu giải thích (không im lặng)", () => {
  it("duyet=true nhưng moPhong=null ⇒ Duyệt tắt dù đã gõ lý do; hiện câu 'Chưa có bảng mô phỏng'", () => {
    moBan("a");
    ve({ ban: [ban({ id: "a", trangThai: "CHO_DUYET", moPhong: null, hanhDong: { ...CAM, duyet: true, tuChoi: true } })] });
    expect(screen.getByText(/Chưa có bảng mô phỏng cho phiên bản này/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Lý do \(ít nhất/), { target: { value: "Đã đối chiếu với kế toán trưởng" } });
    expect((screen.getByLabelText(/Tôi đã xem bảng mô phỏng/) as HTMLInputElement).disabled).toBe(true);
    expect((nut("Duyệt") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("[CSUI-05] luồng Duyệt: lý do + đã xem mô phỏng ⇒ gửi đúng băm", () => {
  const veDuyet = () => {
    moBan("a");
    return ve({ ban: [ban({ id: "a", trangThai: "CHO_DUYET", hanhDong: { ...CAM, duyet: true, tuChoi: true } })] });
  };
  it("Duyệt tắt cho tới khi có lý do ≥ 10 ký tự VÀ đã tick 'đã xem mô phỏng'; bấm ⇒ action nhận id + lý do + băm của bảng đang hiện", async () => {
    veDuyet();
    const btn = () => nut("Duyệt") as HTMLButtonElement;
    expect(btn().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Lý do \(ít nhất/), { target: { value: "ngắn quá" } });
    fireEvent.click(screen.getByLabelText(/Tôi đã xem bảng mô phỏng/));
    expect(btn().disabled).toBe(true); // lý do còn ngắn
    fireEvent.change(screen.getByLabelText(/Lý do \(ít nhất/), { target: { value: "Đã đối chiếu với kế toán trưởng" } });
    expect(btn().disabled).toBe(false);
    fireEvent.click(screen.getByLabelText(/Tôi đã xem bảng mô phỏng/)); // bỏ tick
    expect(btn().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Tôi đã xem bảng mô phỏng/));
    fireEvent.click(btn());
    await waitFor(() => expect(h.duyet).toHaveBeenCalledTimes(1));
    expect(h.duyet).toHaveBeenCalledWith({ id: "a", lyDo: "Đã đối chiếu với kế toán trưởng", hashMoPhong: "a".repeat(64) });
    await waitFor(() => expect(h.toastOk).toHaveBeenCalled());
    expect(h.refresh).toHaveBeenCalled();
  });
  it("server từ chối ⇒ hiện lỗi (role=alert), KHÔNG toast thành công, KHÔNG làm mới", async () => {
    h.duyet.mockResolvedValue({ ok: false, error: "Người tạo chính sách không được tự duyệt" });
    veDuyet();
    fireEvent.change(screen.getByLabelText(/Lý do \(ít nhất/), { target: { value: "Đã đối chiếu với kế toán trưởng" } });
    fireEvent.click(screen.getByLabelText(/Tôi đã xem bảng mô phỏng/));
    fireEvent.click(nut("Duyệt") as HTMLButtonElement);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/không được tự duyệt/));
    expect(h.toastOk).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it("Từ chối KHÔNG đòi xem mô phỏng; chỉ cần lý do", async () => {
    veDuyet();
    const btn = nut("Từ chối") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Lý do \(ít nhất/), { target: { value: "Chưa đúng phạm vi áp dụng" } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(h.tuChoi).toHaveBeenCalledWith({ id: "a", lyDo: "Chưa đúng phạm vi áp dụng" }));
  });
  it("Gửi duyệt và Kết thúc hiệu lực gọi đúng action với tham số của chúng", async () => {
    moBan("a");
    const a = ve({ ban: [ban({ id: "a", hanhDong: { ...CAM, guiDuyet: true } })] });
    fireEvent.change(screen.getByLabelText(/Lý do \(ít nhất/), { target: { value: "Đã soát nội dung xong" } });
    fireEvent.click(nut("Gửi duyệt") as HTMLButtonElement);
    await waitFor(() => expect(h.gui).toHaveBeenCalledWith({ id: "a", lyDo: "Đã soát nội dung xong" }));
    a.unmount();
    moBan("a");
    ve({ ban: [ban({ id: "a", trangThai: "HIEU_LUC", moPhong: null, hanhDong: { ...CAM, ketThuc: true } })] });
    const kt = nut("Kết thúc hiệu lực") as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Lý do \(ít nhất/), { target: { value: "Thay bằng phiên bản mới" } });
    expect(kt.disabled).toBe(true); // chưa chọn ngày
    fireEvent.change(screen.getByLabelText(/Kết thúc hiệu lực vào hết ngày/), { target: { value: "2026-12-31" } });
    expect(kt.disabled).toBe(false);
    fireEvent.click(kt);
    await waitFor(() => expect(h.ketThuc).toHaveBeenCalledWith({ id: "a", lyDo: "Thay bằng phiên bản mới", ngayKetThuc: "2026-12-31" }));
  });
});

describe("[CSUI-06] panel soạn: mở theo URL chỉ khi người xem được phép ở phạm vi đó", () => {
  it("?soan=chung: kế toán cơ sở KHÔNG thấy form (URL gõ tay không mở được thứ họ không làm được); Hội sở THẤY (đối chứng dương)", () => {
    h.sp.current = new URLSearchParams({ soan: "chung" });
    const a = ve({ rieng: true, chung: false });
    expect(screen.queryByRole("form", { name: "Soạn phiên bản chính sách" })).toBeNull();
    a.unmount();
    ve({ rieng: true, chung: true });
    const f = screen.getByRole("form", { name: "Soạn phiên bản chính sách" });
    expect(within(f).getByText(/dùng chung toàn NEW VISION/)).toBeTruthy();
  });
  it("?soan=rieng: form nói phạm vi RIÊNG cơ sở; bấm nút ⇒ ghi URL; Huỷ ⇒ bỏ ?soan", () => {
    ve({ rieng: true });
    fireEvent.click(nut(/Soạn bản riêng/) as HTMLButtonElement);
    expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don/cau-hinh?soan=rieng", { scroll: false });
    cleanup();
    h.sp.current = new URLSearchParams({ soan: "rieng" });
    ve({ rieng: true });
    expect(screen.getByText(/riêng CS1 · Trụ sở/)).toBeTruthy();
    fireEvent.click(nut("Huỷ") as HTMLButtonElement);
    expect(h.replace).toHaveBeenLastCalledWith("/payments/hoa-don/cau-hinh", { scroll: false });
  });
  it("'Soạn bản mới từ bản này': chép nội dung (thuế, căn cứ) nhưng để TRỐNG ngày hiệu lực và lý do", () => {
    h.sp.current = new URLSearchParams({ soan: "tu:a" });
    ve({ ban: [ban({ id: "a" })], rieng: true });
    const f = screen.getByRole("form", { name: "Soạn phiên bản chính sách" });
    expect((within(f).getByLabelText("Hiệu lực từ ngày") as HTMLInputElement).value).toBe("");
    expect((within(f).getByLabelText(/Lý do soạn/) as HTMLInputElement).value).toBe("");
    expect(within(f).getAllByLabelText("Loại khoản").map((i) => (i as HTMLInputElement).value)).toEqual(["COURSE", "EXAM"]);
    expect((within(f).getByLabelText("Thời điểm lập hoá đơn") as HTMLSelectElement).value).toBe("DO_KE_TOAN_CHOT");
  });
});

describe("[CSUI-07] form soạn: KHÔNG mặc định pháp lý, kiểm trước khi gửi, gửi đúng phạm vi", () => {
  const moForm = (chung = false) => {
    h.sp.current = new URLSearchParams({ soan: chung ? "chung" : "rieng" });
    ve({ rieng: true, chung: true });
    return screen.getByRole("form", { name: "Soạn phiên bản chính sách" });
  };
  it("form mới: thời điểm lập, chế độ tối đa, mức người mua, mức thuế, kiểu giá, cách thể hiện số buổi đều TRỐNG (bắt chọn)", () => {
    const f = moForm();
    for (const l of ["Thời điểm lập hoá đơn", "Chế độ tối đa", "Mức thông tin người mua", "Mức thuế", "Cách ghi giá trên đơn", "Cách thể hiện số buổi"]) {
      expect((within(f).getByLabelText(l) as HTMLSelectElement).value, l).toBe("");
    }
    expect((within(f).getByLabelText("Hiệu lực từ ngày") as HTMLInputElement).value).toBe("");
  });
  it("làm tròn chỉ có 'Nửa lên' và bị khoá; ô QR nói biên 1–168 và mặc định 4 giờ", () => {
    const f = moForm();
    const lt = within(f).getByLabelText("Làm tròn") as HTMLSelectElement;
    expect(lt.disabled).toBe(true);
    expect(lt.value).toBe("HALF_UP");
    expect(within(f).getByText(/Từ 1 đến 168 giờ/)).toBeTruthy();
    expect((within(f).getByLabelText(/Số giờ hiệu lực của mã QR/) as HTMLInputElement).placeholder).toBe("Để trống = 4");
  });
  it("bấm Lưu khi còn trống ⇒ liệt kê lỗi bằng tiếng Việt, KHÔNG gọi action", async () => {
    const f = moForm();
    fireEvent.click(within(f).getByRole("button", { name: "Lưu bản nháp" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Ngày bắt đầu hiệu lực/);
    expect(alert.textContent).toMatch(/Phải chọn thời điểm lập hoá đơn/);
    expect(alert.textContent).toMatch(/Ghi lý do/);
    expect(h.tao).not.toHaveBeenCalled();
  });
  it("căn cứ cần kế toán xác nhận mà chưa ký + chế độ TỰ ĐỘNG ⇒ chặn trước khi gửi, có cảnh báo ngay cạnh ô chế độ", async () => {
    const f = moForm();
    // Luật cap chỉ chạy khi các ô khác đã hợp lệ (zod kiểm chéo sau khi từng ô qua) — điền hết trước.
    fireEvent.change(within(f).getByLabelText("Hiệu lực từ ngày"), { target: { value: "2026-07-01" } });
    fireEvent.change(within(f).getByLabelText("Thời điểm lập hoá đơn"), { target: { value: "KHI_THU_TIEN" } });
    fireEvent.change(within(f).getByLabelText("Mức thông tin người mua"), { target: { value: "NGUOI_TIEU_DUNG" } });
    fireEvent.change(within(f).getByLabelText("Loại khoản"), { target: { value: "TAT_CA" } });
    fireEvent.change(within(f).getByLabelText("Mức thuế"), { target: { value: "KCT" } });
    fireEvent.change(within(f).getByLabelText("Cách ghi giá trên đơn"), { target: { value: "DA_GOM_THUE" } });
    fireEvent.change(within(f).getByLabelText("Cách thể hiện số buổi"), { target: { value: "SO_BUOI_LA_SO_LUONG" } });
    fireEvent.change(within(f).getByLabelText(/Lý do soạn/), { target: { value: "Bản dùng chung cho pháp nhân" } });
    fireEvent.click(within(f).getByRole("button", { name: "Thêm căn cứ" }));
    fireEvent.change(within(f).getByLabelText("Tên văn bản"), { target: { value: "Văn bản thử" } });
    fireEvent.change(within(f).getByLabelText("Độ tin cậy của nguồn"), { target: { value: "TRUNG" } });
    fireEvent.click(within(f).getByLabelText(/Cần kế toán xác nhận trước khi dùng/));
    fireEvent.change(within(f).getByLabelText("Chế độ tối đa"), { target: { value: "TU_DONG" } });
    expect(within(f).getByText(/chỉ chọn được “Tắt” hoặc “Chạy thử”/)).toBeTruthy();
    fireEvent.click(within(f).getByRole("button", { name: "Lưu bản nháp" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/chưa ai ký duyệt/);
    expect(h.tao).not.toHaveBeenCalled();
  });
  it("điền đủ ⇒ gọi action với centerId của cơ sở (bản riêng) và nội dung đúng hình dạng; thành công ⇒ toast + mở bản mới trên URL", async () => {
    const f = moForm();
    fireEvent.change(within(f).getByLabelText("Hiệu lực từ ngày"), { target: { value: "2026-07-01" } });
    fireEvent.change(within(f).getByLabelText("Thời điểm lập hoá đơn"), { target: { value: "KHI_THU_TIEN" } });
    fireEvent.change(within(f).getByLabelText("Chế độ tối đa"), { target: { value: "SHADOW" } });
    fireEvent.change(within(f).getByLabelText("Mức thông tin người mua"), { target: { value: "NGUOI_TIEU_DUNG" } });
    fireEvent.change(within(f).getByLabelText(/Số giờ hiệu lực của mã QR/), { target: { value: "6" } });
    fireEvent.change(within(f).getByLabelText("Loại khoản"), { target: { value: "COURSE" } }); // ô CHỌN (không còn gõ tự do)
    fireEvent.change(within(f).getByLabelText("Mức thuế"), { target: { value: "SUAT" } });
    fireEvent.change(within(f).getByLabelText(/Thuế suất dòng 1/), { target: { value: "8" } });
    fireEvent.change(within(f).getByLabelText("Cách ghi giá trên đơn"), { target: { value: "DA_GOM_THUE" } });
    fireEvent.change(within(f).getByLabelText("Cách thể hiện số buổi"), { target: { value: "MOT_KHOA_MO_TA_SO_BUOI" } });
    fireEvent.change(within(f).getByLabelText(/Lý do soạn/), { target: { value: "Soạn theo biên bản họp kế toán" } });
    fireEvent.click(within(f).getByRole("button", { name: "Lưu bản nháp" }));
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    const goi = h.tao.mock.calls[0]![0] as Record<string, unknown>;
    expect(goi).toMatchObject({ phapNhanMa: "NEW_VISION", centerId: "cs1", hieuLucTu: "2026-07-01", hieuLucDen: null, lyDo: "Soạn theo biên bản họp kế toán" });
    expect(goi.noiDung).toMatchObject({
      thoiDiemLap: "KHI_THU_TIEN",
      cheDoToiDa: "SHADOW",
      lamTron: "HALF_UP",
      nguoiMua: { buyerInfoLevel: "NGUOI_TIEU_DUNG", qrTtlGio: 6 },
      anhXaThue: [{ loaiKhoan: "COURSE", mucThue: { kieu: "SUAT", phanTram: 8 }, kieuGia: "DA_GOM_THUE" }],
    });
    await waitFor(() => expect(h.toastOk).toHaveBeenCalled());
    expect(h.replace).toHaveBeenCalledWith("/payments/hoa-don/cau-hinh?chinhSach=moi", { scroll: false });
  });
  it("bản DÙNG CHUNG gửi centerId = null", async () => {
    const f = moForm(true);
    fireEvent.change(within(f).getByLabelText("Hiệu lực từ ngày"), { target: { value: "2026-07-01" } });
    fireEvent.change(within(f).getByLabelText("Thời điểm lập hoá đơn"), { target: { value: "KHI_THU_TIEN" } });
    fireEvent.change(within(f).getByLabelText("Chế độ tối đa"), { target: { value: "TAT" } });
    fireEvent.change(within(f).getByLabelText("Mức thông tin người mua"), { target: { value: "NGUOI_TIEU_DUNG" } });
    fireEvent.change(within(f).getByLabelText("Loại khoản"), { target: { value: "TAT_CA" } });
    fireEvent.change(within(f).getByLabelText("Mức thuế"), { target: { value: "KCT" } });
    fireEvent.change(within(f).getByLabelText("Cách ghi giá trên đơn"), { target: { value: "DA_GOM_THUE" } });
    fireEvent.change(within(f).getByLabelText("Cách thể hiện số buổi"), { target: { value: "SO_BUOI_LA_SO_LUONG" } });
    fireEvent.change(within(f).getByLabelText(/Lý do soạn/), { target: { value: "Bản dùng chung cho pháp nhân" } });
    fireEvent.click(within(f).getByRole("button", { name: "Lưu bản nháp" }));
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect((h.tao.mock.calls[0]![0] as { centerId: unknown }).centerId).toBeNull();
  });
  it("server từ chối ⇒ hiện lỗi trong form, không đóng form", async () => {
    h.tao.mockResolvedValue({ ok: false, error: "Chính sách dùng chung chỉ kế toán Hội sở được tạo." });
    const f = moForm(true);
    fireEvent.change(within(f).getByLabelText("Hiệu lực từ ngày"), { target: { value: "2026-07-01" } });
    fireEvent.change(within(f).getByLabelText("Thời điểm lập hoá đơn"), { target: { value: "KHI_THU_TIEN" } });
    fireEvent.change(within(f).getByLabelText("Chế độ tối đa"), { target: { value: "TAT" } });
    fireEvent.change(within(f).getByLabelText("Mức thông tin người mua"), { target: { value: "NGUOI_TIEU_DUNG" } });
    fireEvent.change(within(f).getByLabelText("Loại khoản"), { target: { value: "TAT_CA" } });
    fireEvent.change(within(f).getByLabelText("Mức thuế"), { target: { value: "KCT" } });
    fireEvent.change(within(f).getByLabelText("Cách ghi giá trên đơn"), { target: { value: "DA_GOM_THUE" } });
    fireEvent.change(within(f).getByLabelText("Cách thể hiện số buổi"), { target: { value: "SO_BUOI_LA_SO_LUONG" } });
    fireEvent.change(within(f).getByLabelText(/Lý do soạn/), { target: { value: "Bản dùng chung cho pháp nhân" } });
    fireEvent.click(within(f).getByRole("button", { name: "Lưu bản nháp" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/chỉ kế toán Hội sở/));
    expect(screen.getByRole("form", { name: "Soạn phiên bản chính sách" })).toBeTruthy();
    expect(h.toastOk).not.toHaveBeenCalled();
  });
});

describe("[CSUI-08] khu Nhà cung cấp & ký: CHỈ ĐỌC", () => {
  const dongNcc = (o: Record<string, unknown> = {}) => ({
    id: "c1",
    centerId: "cs1",
    phapNhanMa: "NEW_VISION",
    kyHieu: "1C26MNV",
    hieuLucTu: "2026-01-01",
    hieuLucDen: "2026-12-31",
    dangBat: true,
    legalEntityId: null,
    nhaCungCapMa: "MISA_MEINVOICE",
    moiTruongNcc: "sandbox",
    loaiHoaDon: "CO_MA",
    phuongThucKy: "HSM",
    khoaBiMat: "MISA_MAC_DINH",
    chungThuHetHan: "2027-03-31",
    cheDoHub: null,
    ...o,
  });
  it("hiện từng cột bằng chữ người dùng hiểu; NULL ⇒ 'Chưa khai'; cheDoHub NULL ≡ Tắt", () => {
    render(<NhaCungCapChiDoc tenCoSo="CS1 · Trụ sở" tenPhapNhan={{ NEW_VISION: "NEW VISION" }} dong={[dongNcc(), dongNcc({ id: "c2", nhaCungCapMa: null, moiTruongNcc: null, loaiHoaDon: null, phuongThucKy: null, khoaBiMat: null, chungThuHetHan: null, cheDoHub: "SHADOW", legalEntityId: "le1" })]} />);
    expect(screen.getByText("MISA meInvoice")).toBeTruthy();
    expect(screen.getByText("Thử nghiệm (sandbox)")).toBeTruthy();
    expect(screen.getByText("HSM — ký tại nhà cung cấp")).toBeTruthy();
    expect(screen.getByText("MISA_MAC_DINH")).toBeTruthy();
    expect(screen.getByText("31/03/2027")).toBeTruthy();
    expect(screen.getByText("Tắt")).toBeTruthy();
    expect(screen.getByText("Chạy thử (không phát hành)")).toBeTruthy();
    expect(screen.getAllByText("Chưa khai").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("Chỉ đọc")).toBeTruthy();
  });
  it("KHÔNG có ô nhập, danh sách chọn, form hay nút hành động nào — chỉ icon hướng dẫn (luật 12: không hứa thứ chưa làm được)", () => {
    const { container } = render(<NhaCungCapChiDoc tenCoSo="CS1" tenPhapNhan={{}} dong={[dongNcc()]} />);
    expect(container.querySelectorAll("input, select, textarea, form").length).toBe(0);
    const nuts = [...container.querySelectorAll("button")];
    expect(nuts.length).toBeGreaterThan(0);
    for (const n of nuts) expect(n.getAttribute("aria-label") ?? "", n.outerHTML).toMatch(/^Xem hướng dẫn/);
  });
  it("chưa có dòng cấu hình ⇒ nói vì sao rỗng và chỉ về khu 'Pháp nhân & ký hiệu'", () => {
    render(<NhaCungCapChiDoc tenCoSo="CS1" tenPhapNhan={{}} dong={[]} />);
    expect(screen.getByText(/chưa có dòng cấu hình nào/)).toBeTruthy();
  });
});

describe("[CSUI-09] bảng mô phỏng trình bày riêng", () => {
  it("không đổi gì ⇒ nói 'Không khoản mẫu nào đổi kết quả'", () => {
    render(<MoPhongBang ketQua={{ ...ketQuaMP, soMauDoiKetQua: 0, soMauSauLoi: 0, chenhLechThue: 0, dong: ketQuaMP.dong.slice(0, 1).map((d) => ({ ...d, doi: false })) }} />);
    expect(screen.getByRole("status").textContent).toMatch(/Không khoản mẫu nào đổi kết quả/);
    expect(screen.getByText("Giữ nguyên")).toBeTruthy();
  });
  it("tổng thuế tăng ⇒ nói 'tăng'; không so được (null) ⇒ không nói con số", () => {
    const a = render(<MoPhongBang ketQua={{ ...ketQuaMP, chenhLechThue: 12_345 }} />);
    expect(screen.getByRole("status").textContent).toMatch(/tổng thuế tăng 12\.345đ/);
    a.unmount();
    render(<MoPhongBang ketQua={{ ...ketQuaMP, chenhLechThue: null }} />);
    expect(screen.getByRole("status").textContent).not.toMatch(/tổng thuế/);
  });
});

describe("[CSUI-W1] lưới ghim: tệp client không kéo mã server (node:crypto, db, hàm quyền) vào bundle", () => {
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const TEP = ["chinh-sach-hoa-don.tsx", "chinh-sach-form.tsx", "chinh-sach-nhap.ts", "mo-phong-bang.tsx"];
  it.each(TEP)("%s: mọi import từ quyen / chinh-sach-mo-phong / chinh-sach-db đều là `import type`; không node:*, không db", (t) => {
    const ma = boChuThich(readFileSync(duongDan(process.cwd(), "app/(admin)/admin/payments/hoa-don/cau-hinh/_components", t), "utf8"));
    expect(ma).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s*"@\/lib\/finance\/hoa-don\/(?:quyen|chinh-sach-mo-phong|chinh-sach-db|cau-hinh-nha-cung-cap-db)"/m);
    expect(ma).not.toMatch(/from\s*"node:/);
    expect(ma).not.toMatch(/from\s*"@\/lib\/db/);
    expect(ma).not.toMatch(/\bserver-only\b/);
  });
  it("khu chỉ-đọc không import action nào", () => {
    const ma = boChuThich(readFileSync(duongDan(process.cwd(), "app/(admin)/admin/payments/hoa-don/cau-hinh/_components/nha-cung-cap-chi-doc.tsx"), "utf8"));
    expect(ma).not.toMatch(/_actions|_chinh-sach-actions|useState|useTransition|"use client"/);
  });
  it("khu server nạp dữ liệu chỉ đọc qua dịch vụ (không db trần) và tính cờ nút bằng đúng vị từ dùng chung", () => {
    const ma = boChuThich(readFileSync(duongDan(process.cwd(), "app/(admin)/admin/payments/hoa-don/cau-hinh/_components/khu-chinh-sach-hub.tsx"), "utf8"));
    expect(ma).not.toMatch(/from\s*"@\/lib\/db"/);
    expect((ma.match(/\bhanhDongChinhSachChoPhep\s*\(/g) ?? []).length).toBe(1);
    expect((ma.match(/\bduocGhiChinhSach\s*\(/g) ?? []).length).toBe(2);
  });
});

describe("[CSUI-W2] lưới ghim: cờ Hub gác khu mới, cờ TẮT thì trang không nạp gì thêm", () => {
  const boChuThich = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const ma = boChuThich(readFileSync(duongDan(process.cwd(), "app/(admin)/admin/payments/hoa-don/cau-hinh/page.tsx"), "utf8"));
  it("page.tsx hỏi cờ đúng 1 lần (chỉ khi đã có cơ sở) và `<KhuChinhSachHub` chỉ nằm sau điều kiện cờ", () => {
    expect((ma.match(/laHubChinhSachBat\s*\(\s*\)/g) ?? []).length).toBe(1);
    expect(ma).toMatch(/const\s+hubBat\s*=\s*coSo\s*\?\s*await\s+laHubChinhSachBat\s*\(\s*\)\s*:\s*false/);
    expect((ma.match(/<KhuChinhSachHub/g) ?? []).length).toBe(1);
    expect(ma).toMatch(/\{coSo\s*&&\s*hubBat\s*\?\s*\(\s*<div className="mt-10">/);
  });
  it("khu mới nằm TRONG trang Cấu hình sẵn có: không tab con mới, không route mới", () => {
    const tabs = readFileSync(duongDan(process.cwd(), "app/(admin)/admin/payments/hoa-don/cau-hinh/_components/cau-hinh-tabs.tsx"), "utf8");
    expect((tabs.match(/key:\s*"/g) ?? []).length).toBe(1);
  });
});
