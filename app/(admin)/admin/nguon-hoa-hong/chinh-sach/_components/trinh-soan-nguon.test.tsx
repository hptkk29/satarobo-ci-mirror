// @vitest-environment jsdom
/**
 * [TSN-*] — TRÌNH SOẠN × NGUỒN ĐỘNG (E2a, 09/10/2026), trên phần tử thật, Server Action giả lập.
 *
 * Nguồn do admin tạo bằng giao diện có thể Nháp / Ngừng / ngoài khoảng hiệu lực / chưa khai người phụ trách. Trình soạn phải NÓI đúng điều guardrail sẽ làm, ở đúng chỗ, và chỉ mời bấm
 * những liên kết mà người xem làm được (luật 12). Mọi ca âm đi cặp với một ca dương.
 *
 *   [TSN-01] ô chọn nguồn: dòng nào cũng nói «có / không tham gia hoa hồng theo nguồn» + trạng thái; Ngừng/Nháp bị khoá; Lưu trữ không có mặt
 *   [TSN-02] bản nháp mang nguồn ĐÃ NGỪNG: ô chọn mở ra ĐÚNG nguồn đó (không trắng) + ghi chú «không kích hoạt được»
 *   [TSN-03] ghi chú nguồn: «Mở cấu hình nguồn» chỉ có khi người xem quản lý được nguồn; không thì nói nhờ ai
 *   [TSN-04] nguồn ngoài khoảng hiệu lực: CHỈ nói (vẫn kích hoạt được), không chặn
 *   [TSN-05] bước Người hưởng: hai nhóm «nguồn (acquisition)» / «giao dịch khác»; vai MỚI mô tả đúng (Sale phụ trách PH ≠ người giới thiệu)
 *   [TSN-06] gợi ý vai × nguồn: hiện khi nguồn thiếu chủ / sai kiểu, KHÔNG hiện khi đủ (đối chứng dương)
 *   [TSN-07] bước Kích hoạt: tổng vượt trần ⇒ khối 3 số ngay cạnh nút tắt; liên kết theo quyền; không vượt ⇒ không khối
 *   [TSN-08] kích hoạt bị chặn VUOT_TRAN ở máy chủ (đua) ⇒ thanh điều kiện CẬP NHẬT đúng khối, hộp thoại đóng
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const R = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const A = vi.hoisted(() => ({ luu: vi.fn(), kiem: vi.fn(), kich: vi.fn(), huy: vi.fn(), thu: vi.fn() }));
const T = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: R.replace, push: R.push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: T }));
vi.mock("../_actions", () => ({ luuNhapAction: A.luu, kiemHangRaoAction: A.kiem, kichHoatAction: A.kich, huyNhapAction: A.huy, thuTinhAction: A.thu }));

import { formRong, type FormChinhSach } from "@/lib/hoa-hong/chinh-sach-form";
import type { KetQuaKiemHangRao } from "@/lib/hoa-hong/hang-rao-ui";
import { dungHuongXuLyTran } from "@/lib/hoa-hong/huong-xu-ly-tran";
import type { NguonSoan } from "@/lib/hoa-hong/nguon-cho-soan";
import type { DuLieuSoanClient } from "./kieu-soan";
import { TrinhSoan, type PropsTrinhSoan } from "./trinh-soan";

const ns = (id: string, p: Partial<NguonSoan> = {}): NguonSoan => ({
  id,
  code: `MA_${id.toUpperCase()}`,
  name: `Nguồn ${id}`,
  coHoaHong: true,
  trangThai: "HOAT_DONG",
  hieuLucTu: null,
  hieuLucDen: null,
  coNguoiPhuTrach: true,
  referrerRequirement: "NONE",
  ...p,
});

const dlGoc: DuLieuSoanClient = {
  vai: [
    { code: "SALE", name: "Sale (người chốt đơn)", isAcquisition: false, resolverType: "TRANSACTION_ROLE", resolverKey: "LEAD_CONVERTED_BY" },
    { code: "CENTER_MANAGER", name: "Quản lý cơ sở", isAcquisition: false, resolverType: "ORG_UNIT_ROLE", resolverKey: "ASSIGNEE_QL_TT" },
    { code: "REFERRER_PARENT", name: "Phụ huynh giới thiệu", isAcquisition: true, resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT" },
    { code: "REFERRER_PARENT_SALE", name: "Sale phụ trách phụ huynh giới thiệu", isAcquisition: true, resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT_SALE" },
    { code: "SOURCE_OWNER", name: "Người phụ trách nguồn", isAcquisition: true, resolverType: "SOURCE_OWNER", resolverKey: "SOURCE_OWNER" },
  ],
  nhomNguon: [ns("a")],
  coSo: [{ orgUnitId: "ou1", centerId: "c1", label: "CS1 · Cơ sở 1" }],
  coTheSoHuuHoiSo: true,
  vanBan: [{ id: "d1", documentCode: "SR.QD.208", title: "Quy định hoa hồng", publishedOn: "2026-03-02", coTep: true, daThuHoi: false }],
  loaiGdBat: ["NEW", "RENEWAL"],
  tran: 0.09,
};
const dlVoi = (nhomNguon: NguonSoan[]): DuLieuSoanClient => ({ ...dlGoc, nhomNguon });

const formDu = (p: Partial<FormChinhSach> = {}): FormChinhSach => ({
  ...formRong(),
  policyCode: "SR.QD.300/HV",
  name: "Hoa hồng học viên mới",
  loaiGd: ["NEW"],
  vai: ["SALE", "CENTER_MANAGER"],
  o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" }, "NEW|CENTER_MANAGER": { kieu: "PERCENT", phanTram: "2" } },
  vanBan: { kieu: "co-san", id: "d1" },
  hieuLucTu: "2026-03-23",
  lyDo: "Theo SR.QD.300",
  ...p,
});

const OK: KetQuaKiemHangRao = { loi: [], canhBao: [], somNhat: "2026-03-23" };
const moi = (p: Partial<PropsTrinhSoan> = {}): PropsTrinhSoan => ({
  cheDo: "tao-moi",
  policyId: null,
  luuDau: null,
  formDau: formRong(),
  dl: dlGoc,
  coQuyenKichHoat: true,
  coQuyenQuanLyNguon: true,
  coQuyenSuaTran: true,
  khoa: null,
  hangRaoDau: null,
  buocDau: "boi-canh",
  coQuyenSoan: true,
  thuTinh: { coQuyen: true, khoangMacDinh: { tuNgay: "2026-07-01", denNgay: "2026-09-30" } },
  ...p,
});
const daLuu = (p: Partial<PropsTrinhSoan> = {}): PropsTrinhSoan =>
  moi({ cheDo: "sua-nhap", policyId: "p1", luuDau: { versionId: "v1", versionNo: 1, updatedAt: "2026-10-08T03:00:00.000Z" }, formDau: formDu(), hangRaoDau: OK, buocDau: "kich-hoat", ...p });
const theoNguon = (id: string, p: Partial<FormChinhSach> = {}) => ({ ...formRong(), phamVi: { loai: "SOURCE_GROUP" as const, sourceGroupId: id }, ...p });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  for (const f of [R.replace, R.push, A.luu, A.kiem, A.kich, A.huy, A.thu, T.success, T.error, T.message]) f.mockReset();
});
afterEach(cleanup);

const ochon = () => screen.getByLabelText("Nhóm nguồn") as HTMLSelectElement;
const opt = (ten: RegExp | string) => screen.getByRole("option", { name: ten }) as HTMLOptionElement;

describe("[TSN-01] ô chọn nguồn nói thật trạng thái + hoa hồng", () => {
  const ds = [
    ns("a", { coHoaHong: true }),
    ns("b", { coHoaHong: false }),
    ns("c", { trangThai: "NGUNG" }),
    ns("d", { trangThai: "NHAP", coHoaHong: false }),
    ns("e", { trangThai: "LUU_TRU" }),
  ];

  it("mỗi dòng có «có / không tham gia hoa hồng theo nguồn»; Ngừng · Nháp hiện nhưng KHOÁ; Lưu trữ không có; Hoạt động chọn được (đối chứng dương)", () => {
    render(<TrinhSoan {...moi({ dl: dlVoi(ds), formDau: theoNguon("") })} />);
    expect(opt("Nguồn a — có hoa hồng theo nguồn").disabled).toBe(false);
    expect(opt("Nguồn b — không tham gia hoa hồng theo nguồn").disabled).toBe(false);
    expect(opt("Nguồn c — có hoa hồng theo nguồn · Tạm ngừng").disabled).toBe(true);
    expect(opt("Nguồn d — không tham gia hoa hồng theo nguồn · Nháp").disabled).toBe(true);
    expect(screen.queryByRole("option", { name: /Nguồn e/ })).toBeNull();
  });
});

describe("[TSN-02] bản nháp mang nguồn ĐÃ NGỪNG", () => {
  it("ô chọn mở ra ĐÚNG nguồn đó (không trắng, option không khoá) và ghi chú nói «Đã ngừng … không kích hoạt được»; nguồn hoạt động cùng tình huống thì KHÔNG có ghi chú", () => {
    render(<TrinhSoan {...moi({ dl: dlVoi([ns("a"), ns("c", { trangThai: "NGUNG" })]), formDau: theoNguon("c") })} />);
    expect(ochon().value).toBe("c");
    expect(opt(/Nguồn c/).disabled).toBe(false);
    const ghi = screen.getByTestId("nguon-khong-hoat-dong");
    expect(ghi.textContent).toContain("Tạm ngừng");
    expect(ghi.textContent).toContain("không kích hoạt được");
    cleanup();
    render(<TrinhSoan {...moi({ dl: dlVoi([ns("a")]), formDau: theoNguon("a") })} />);
    expect(screen.queryByTestId("nguon-khong-hoat-dong")).toBeNull();
    expect(screen.queryByTestId("nguon-khong-hoa-hong")).toBeNull();
  });
});

describe("[TSN-03] liên kết «Mở cấu hình nguồn» theo quyền quản lý nguồn", () => {
  const ds = [ns("b", { coHoaHong: false, code: "TIKTOK_SHOP" })];

  it("có sources:manage ⇒ liên kết tới /nguon-hoa-hong/nguon/<mã>; KHÔNG ⇒ không liên kết, nói nhờ người có quyền quản lý nguồn", () => {
    render(<TrinhSoan {...moi({ dl: dlVoi(ds), formDau: theoNguon("b"), coQuyenQuanLyNguon: true })} />);
    const lk = within(screen.getByTestId("nguon-khong-hoa-hong")).getByRole("link", { name: "Mở cấu hình nguồn" });
    expect(lk.getAttribute("href")).toBe("/nguon-hoa-hong/nguon/TIKTOK_SHOP");
    cleanup();
    render(<TrinhSoan {...moi({ dl: dlVoi(ds), formDau: theoNguon("b"), coQuyenQuanLyNguon: false })} />);
    const ghi = screen.getByTestId("nguon-khong-hoa-hong");
    expect(within(ghi).queryByRole("link")).toBeNull();
    expect(ghi.textContent).toContain("sources:manage");
    expect(ghi.textContent).toContain("không chạy và không kích hoạt được");
  });
});

describe("[TSN-04] nguồn ngoài khoảng hiệu lực", () => {
  it("HẾT HẠN / CHƯA HIỆU LỰC ⇒ chỉ NÓI (lead mới không chọn được; chính sách vẫn kích hoạt được), không ghi chú «không kích hoạt được», option không khoá", () => {
    for (const trangThai of ["HET_HAN", "CHUA_HIEU_LUC"] as const) {
      render(<TrinhSoan {...moi({ dl: dlVoi([ns("x", { trangThai })]), formDau: theoNguon("x") })} />);
      const ghi = screen.getByTestId("nguon-ngoai-hieu-luc");
      expect(ghi.textContent).toContain("lead mới không chọn được");
      expect(ghi.textContent).toContain("vẫn kích hoạt được");
      expect(screen.queryByTestId("nguon-khong-hoat-dong")).toBeNull();
      expect(opt(/Nguồn x/).disabled).toBe(false);
      cleanup();
    }
  });
});

describe("[TSN-05] bước Người hưởng: hai nhóm + mô tả vai mới", () => {
  it("«Hoa hồng giao dịch khác» chứa Sale · QLCS; «Hoa hồng nguồn (acquisition)» chứa 3 vai giới thiệu/phụ trách; Sale phụ trách PH KHÔNG bị mô tả là «người giới thiệu» thường", () => {
    render(<TrinhSoan {...moi({ buocDau: "nguoi-huong" })} />);
    const gd = screen.getByRole("region", { name: "Hoa hồng giao dịch khác" });
    const ng = screen.getByRole("region", { name: "Hoa hồng nguồn (acquisition)" });
    expect(within(gd).getByLabelText(/Sale \(người chốt đơn\)/)).toBeTruthy();
    expect(within(gd).getByLabelText(/Quản lý cơ sở/)).toBeTruthy();
    expect(within(gd).queryByLabelText(/Người phụ trách nguồn/)).toBeNull();
    for (const t of [/Phụ huynh giới thiệu/, /Sale phụ trách phụ huynh giới thiệu/, /Người phụ trách nguồn/]) expect(within(ng).getByLabelText(t)).toBeTruthy();
    expect(ng.textContent).toContain("chốt tại lúc ghi nhận nguồn");
    expect(ng.textContent).toContain("khai ở cấu hình nguồn");
    expect(ng.textContent).toContain("chỉ trong cửa sổ ghi công");
    expect(gd.textContent).not.toContain("chỉ trong cửa sổ ghi công");
  });
});

describe("[TSN-06] gợi ý vai × nguồn (trước khi bấm Kích hoạt)", () => {
  it("vai «Người phụ trách nguồn» + nguồn CHƯA có chủ ⇒ gợi ý; nguồn CÓ chủ ⇒ không (đối chứng dương)", () => {
    render(<TrinhSoan {...moi({ buocDau: "nguoi-huong", dl: dlVoi([ns("a", { coNguoiPhuTrach: false })]), formDau: theoNguon("a", { vai: ["SOURCE_OWNER"] }) })} />);
    const g = screen.getByTestId("goi-y-vai");
    expect(g.querySelector('[data-ma="NGUON_CHUA_CO_NGUOI_PHU_TRACH"]')).not.toBeNull();
    expect(g.textContent).toContain("Nguồn a");
    cleanup();
    render(<TrinhSoan {...moi({ buocDau: "nguoi-huong", dl: dlVoi([ns("a", { coNguoiPhuTrach: true })]), formDau: theoNguon("a", { vai: ["SOURCE_OWNER"] }) })} />);
    expect(screen.queryByTestId("goi-y-vai")).toBeNull();
  });

  it("vai «Sale phụ trách PH giới thiệu» + nguồn kiểu EMPLOYEE ⇒ gợi ý; nguồn kiểu PARENT ⇒ không", () => {
    render(<TrinhSoan {...moi({ buocDau: "nguoi-huong", dl: dlVoi([ns("a", { referrerRequirement: "EMPLOYEE" })]), formDau: theoNguon("a", { vai: ["REFERRER_PARENT_SALE"] }) })} />);
    expect(screen.getByTestId("goi-y-vai").querySelector('[data-ma="NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU"]')).not.toBeNull();
    cleanup();
    render(<TrinhSoan {...moi({ buocDau: "nguoi-huong", dl: dlVoi([ns("a", { referrerRequirement: "PARENT" })]), formDau: theoNguon("a", { vai: ["REFERRER_PARENT_SALE"] }) })} />);
    expect(screen.queryByTestId("goi-y-vai")).toBeNull();
  });

  it("phạm vi chung + vai «Người phụ trách nguồn» ⇒ gợi ý nêu các nguồn đang hoạt động thiếu chủ; chọn thêm một vai thường không đổi gì", () => {
    render(<TrinhSoan {...moi({ buocDau: "nguoi-huong", dl: dlVoi([ns("a", { coNguoiPhuTrach: false }), ns("b", { coNguoiPhuTrach: true })]), formDau: { ...formRong(), vai: ["SOURCE_OWNER", "SALE"] } })} />);
    const g = screen.getByTestId("goi-y-vai");
    expect(g.querySelector('[data-ma="NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH"]')).not.toBeNull();
    expect(g.textContent).toContain("Nguồn a");
    expect(g.textContent).not.toContain("Nguồn b");
  });

  it("liên kết «Mở cấu hình nguồn» trong gợi ý đi theo quyền quản lý nguồn", () => {
    const props = (q: boolean) => moi({ buocDau: "nguoi-huong", coQuyenQuanLyNguon: q, dl: dlVoi([ns("a", { coNguoiPhuTrach: false, code: "EXPO" })]), formDau: theoNguon("a", { vai: ["SOURCE_OWNER"] }) });
    render(<TrinhSoan {...props(true)} />);
    expect(within(screen.getByTestId("goi-y-vai")).getByRole("link", { name: "Mở cấu hình nguồn" }).getAttribute("href")).toBe("/nguon-hoa-hong/nguon/EXPO");
    cleanup();
    render(<TrinhSoan {...props(false)} />);
    expect(within(screen.getByTestId("goi-y-vai")).queryByRole("link")).toBeNull();
  });
});

describe("[TSN-07] bước Kích hoạt: khối vượt trần", () => {
  const huong = dungHuongXuLyTran({ tongToiDa: 0.11, tran: 0.09 });
  const vuot: KetQuaKiemHangRao = { loi: [{ ma: "VUOT_TRAN", thongBao: "Vượt trần hoa hồng: tổng cao nhất 11% so với trần hiện tại 9%", huongXuLy: huong }], canhBao: [], somNhat: "2026-03-23" };

  it("tổng vượt trần ⇒ khối ngay trong bước (cạnh nút Kích hoạt tắt): 11% · 9% · 2 điểm; admin thấy liên kết; người không có quyền sửa trần KHÔNG thấy liên kết mà thấy Quản trị hệ thống", () => {
    render(<TrinhSoan {...daLuu({ hangRaoDau: vuot, coQuyenSuaTran: true })} />);
    const trongBuoc = within(screen.getByTestId("vuot-tran-o-buoc-kich-hoat"));
    expect(trongBuoc.getByTestId("khoi-vuot-tran").textContent).toContain("11%");
    expect(trongBuoc.getByRole("link", { name: "Mở Cấu hình vận hành để nâng trần" }).getAttribute("href")).toBe("/cau-hinh-van-hanh?tab=khach-hang");
    expect(screen.getByRole("button", { name: "Kích hoạt…" }).hasAttribute("disabled")).toBe(true);
    cleanup();
    render(<TrinhSoan {...daLuu({ hangRaoDau: vuot, coQuyenSuaTran: false })} />);
    const khong = within(screen.getByTestId("vuot-tran-o-buoc-kich-hoat"));
    expect(khong.queryByRole("link")).toBeNull();
    expect(khong.getByTestId("khoi-vuot-tran").textContent).toContain("Quản trị hệ thống");
    // thanh điều kiện bên cạnh cũng KHÔNG có liên kết nâng trần
    expect(screen.queryByRole("link", { name: /nâng trần/i })).toBeNull();
  });

  it("không vượt trần ⇒ không khối (cả trong bước lẫn thanh điều kiện)", () => {
    render(<TrinhSoan {...daLuu({ hangRaoDau: OK })} />);
    expect(screen.queryByTestId("vuot-tran-o-buoc-kich-hoat")).toBeNull();
    expect(screen.queryByTestId("khoi-vuot-tran")).toBeNull();
  });
});

describe("[TSN-08] kích hoạt bị chặn VUOT_TRAN ở máy chủ", () => {
  it("máy chủ trả hangRao có VUOT_TRAN + huongXuLy ⇒ hộp thoại đóng, thanh điều kiện hiện KHỐI với 3 số của máy chủ", async () => {
    const huong = dungHuongXuLyTran({ tongToiDa: 0.12, tran: 0.09 });
    A.kich.mockResolvedValue({ ok: false, loi: [], chung: "Không kích hoạt được — còn điều kiện chưa đạt.", hangRao: { loi: [{ ma: "VUOT_TRAN", thongBao: "Vượt trần hoa hồng: tổng cao nhất 12%", huongXuLy: huong }], canhBao: [], somNhat: null } });
    render(<TrinhSoan {...daLuu()} />);
    fireEvent.click(screen.getByRole("button", { name: /Kích hoạt…/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Kích hoạt từ/ }));
    await waitFor(() => expect(A.kich).toHaveBeenCalledTimes(1));
    const khoi = await screen.findAllByTestId("khoi-vuot-tran");
    expect(khoi.length).toBeGreaterThan(0);
    expect(khoi[0]!.textContent).toContain("12%");
    expect(khoi[0]!.textContent).toContain("3 điểm phần trăm");
  });
});
