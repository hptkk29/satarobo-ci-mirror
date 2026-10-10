// @vitest-environment jsdom
/**
 * [NHH-POL-10-UI-1x] — BƯỚC "THỬ TÍNH" trên phần tử thật (06 §5.2), Server Action giả lập. Chỉ ĐỌC: không ghi gì, không làm mới trang.
 *
 * Điều canh (HÀNH VI mà tsc và lưới thuần không chạm tới):
 *   · luật 12: nút "Chạy thử" — không quyền / bản đã khoá ⇒ KHÔNG vẽ; chưa lưu / sửa dở ⇒ TẮT kèm lý do riêng; đủ ⇒ gọi ĐÚNG action với ĐÚNG tham số;
 *   · bốn trạng thái: đang tính (khung bảng, role=status) · rỗng (chưa chạy / chạy xong không có khoản) · lỗi (role=alert) · không quyền;
 *   · kết quả: Hiện tại | Đề xuất | Chênh có dấu, 4 bảng phân rã, vượt trần liệt kê khoản · vai · tỉ lệ, chưa thể tính có lý do, "KHÔNG ghi sổ";
 *   · kết quả CŨ (bản nháp lưu lại / sửa dở) bị gắn nhãn và KHÔNG được dùng làm "tác động" ở hộp thoại kích hoạt.
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
import type { KetQuaMoPhong } from "@/lib/hoa-hong/mo-phong";
import type { DuLieuSoanClient } from "./kieu-soan";
import { TrinhSoan, type PropsTrinhSoan } from "./trinh-soan";

const dl: DuLieuSoanClient = {
  vai: [
    { code: "SALE", name: "Sale (người chốt đơn)", isAcquisition: false, resolverType: "TRANSACTION_ROLE", resolverKey: null },
    { code: "CENTER_MANAGER", name: "Quản lý cơ sở", isAcquisition: false, resolverType: "ORG_UNIT_ROLE", resolverKey: null },
  ],
  nhomNguon: [{ id: "g1", code: "PAID_ADS", name: "Nguồn từ Quảng cáo", coHoaHong: true, trangThai: "HOAT_DONG", hieuLucTu: null, hieuLucDen: null, coNguoiPhuTrach: false, referrerRequirement: "NONE" }],
  coSo: [
    { orgUnitId: "ou1", centerId: "c1", label: "CS1 · Cơ sở 1" },
    { orgUnitId: "ou2", centerId: "c2", label: "CS2 · Cơ sở 2" },
  ],
  coTheSoHuuHoiSo: true,
  vanBan: [{ id: "d1", documentCode: "SR.QD.208", title: "Quy định hoa hồng", publishedOn: "2026-03-02", coTep: true, daThuHoi: false }],
  loaiGdBat: ["NEW", "RENEWAL"],
  tran: 0.09,
};

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
const CAP_NHAT = "2026-10-08T03:00:00.000Z";
const CHAY_LUC = "2026-10-08T14:30:00.000Z";
const KHOANG = { tuNgay: "2026-07-01", denNgay: "2026-09-30" };

const props = (p: Partial<PropsTrinhSoan> = {}): PropsTrinhSoan => ({
  cheDo: "sua-nhap",
  policyId: "p1",
  luuDau: { versionId: "v1", versionNo: 1, updatedAt: CAP_NHAT },
  formDau: formDu(),
  dl,
  coQuyenKichHoat: true,
  coQuyenQuanLyNguon: true,
  coQuyenSuaTran: true,
  khoa: null,
  hangRaoDau: OK,
  buocDau: "thu-tinh",
  coQuyenSoan: true,
  thuTinh: { coQuyen: true, khoangMacDinh: KHOANG },
  ...p,
});

const dong = (khoa: string, nhan: string, soKhoan: number, coSo: number, hienTai: number, deXuat: number) => ({ khoa, nhan, soKhoan, coSo, hienTai, deXuat, chenh: deXuat - hienTai });

function ketQua(p: Partial<KetQuaMoPhong> = {}): KetQuaMoPhong {
  return {
    soKhoanTinhDuoc: 3,
    coSo: 12_000_000,
    hoaHong: { hienTai: 960_000, deXuat: 840_000, chenh: -120_000 },
    tiLeHieuDung: { hienTai: 0.08, deXuat: 0.07 },
    phanRa: {
      vai: [dong("SALE", "Sale (người chốt đơn)", 3, 12_000_000, 480_000, 360_000), dong("CENTER_MANAGER", "Quản lý cơ sở", 3, 12_000_000, 240_000, 240_000)],
      nguon: [dong("PAID_ADS", "Nguồn từ Quảng cáo", 2, 8_000_000, 640_000, 560_000), dong("UNKNOWN", "Không rõ nguồn", 1, 4_000_000, 320_000, 280_000)],
      donVi: [dong("c1", "CS1 · Cơ sở 1", 3, 12_000_000, 960_000, 840_000)],
      loai: [dong("NEW", "Học viên mới", 3, 12_000_000, 960_000, 840_000)],
    },
    tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 0, danhSach: [] }, biCat: false },
    chongLan: { hienTai: 0, deXuat: 0 },
    chuaTinh: { soKhoan: 0, theoLyDo: [] },
    thieuNguoi: { hienTai: [], deXuat: [] },
    soNguoiAnhHuong: 2,
    khoang: KHOANG,
    soKhoanTrongKhoang: 3,
    cat: null,
    ngoai: { soKhoanHoan: 0, tienHoan: 0, soKhoanKhongPhaiHocPhi: 0, soKhoanChuyenNoiBo: 0 },
    phamVi: { soCoSo: null },
    ...p,
  };
}

const xong = (k: KetQuaMoPhong, capNhat = CAP_NHAT) => ({ ok: true as const, ketQua: k, phienBanCapNhatLuc: capNhat, chayLuc: CHAY_LUC });

const nut = (ten: string | RegExp) => screen.getByRole("button", { name: ten }) as HTMLButtonElement;
const chayThu = () => fireEvent.click(nut("Chạy thử"));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  for (const f of [R.replace, R.push, A.luu, A.kiem, A.kich, A.huy, A.thu, T.success, T.error, T.message]) f.mockReset();
});
afterEach(cleanup);

describe("[NHH-POL-10-UI-10] cổng vào của nút 'Chạy thử' (luật 12)", () => {
  it("[NHH-POL-10-UI-10a] KHÔNG quyền thử tính ⇒ KHÔNG có nút, không ô nhập; nêu tên quyền", () => {
    render(<TrinhSoan {...props({ thuTinh: { coQuyen: false, khoangMacDinh: KHOANG } })} />);
    expect(screen.queryByRole("button", { name: "Chạy thử" })).toBeNull();
    expect(screen.queryByLabelText("Từ ngày")).toBeNull();
    expect(screen.getByText(/commission_policies:manage/)).toBeTruthy();
    expect(A.thu).not.toHaveBeenCalled();
  });

  it("[NHH-POL-10-UI-10b] phiên bản đã khoá (đã kích hoạt) ⇒ KHÔNG nút; chỉ đường 'tạo phiên bản mới'", () => {
    render(<TrinhSoan {...props({ khoa: { lyDo: "Phiên bản v1 đã kích hoạt." } })} />);
    expect(screen.queryByRole("button", { name: "Chạy thử" })).toBeNull();
    expect(screen.getByText(/thử tính dành cho bản nháp/)).toBeTruthy();
  });

  it("[NHH-POL-10-UI-10c] chưa lưu ⇒ nút TẮT + 'Lưu nháp trước' (cạnh nút, gắn aria-describedby); bấm cũng không gọi action", () => {
    render(<TrinhSoan {...props({ luuDau: null, cheDo: "tao-moi", policyId: null })} />);
    const b = nut("Chạy thử");
    expect(b.disabled).toBe(true);
    const lyDo = screen.getByText(/Lưu nháp trước: thử tính chạy trên bản đã lưu/);
    expect(b.getAttribute("aria-describedby")).toBe(lyDo.id);
    fireEvent.click(b);
    expect(A.thu).not.toHaveBeenCalled();
  });

  it("[NHH-POL-10-UI-10d] có quyền soạn KHÁC có quyền thử tính: người chỉ-đọc (coQuyenSoan=false) mà có quyền thử tính vẫn chạy được — thử tính không ghi gì", async () => {
    A.thu.mockResolvedValue(xong(ketQua()));
    render(<TrinhSoan {...props({ coQuyenSoan: false })} />);
    expect(nut("Chạy thử").disabled).toBe(false);
    chayThu();
    await waitFor(() => expect(A.thu).toHaveBeenCalledTimes(1));
  });

  it("[NHH-POL-10-UI-10e] đủ điều kiện ⇒ nút bật, không có dòng lý do", () => {
    render(<TrinhSoan {...props()} />);
    expect(nut("Chạy thử").disabled).toBe(false);
    expect(screen.queryByText(/Lưu nháp trước: thử tính chạy trên bản đã lưu/)).toBeNull();
    expect(screen.getByText(/Chưa chạy\. Chọn khoảng ngày/)).toBeTruthy(); // trạng thái rỗng "chưa chạy" hướng dẫn việc cần làm
  });
});

describe("[NHH-POL-10-UI-11] gọi action đúng tham số + bốn trạng thái", () => {
  it("[NHH-POL-10-UI-11a] khoảng mặc định do MÁY CHỦ đưa; bấm ⇒ gọi action với versionId đã lưu + khoảng + orgUnitId=null", async () => {
    A.thu.mockResolvedValue(xong(ketQua()));
    render(<TrinhSoan {...props()} />);
    expect((screen.getByLabelText("Từ ngày") as HTMLInputElement).value).toBe("2026-07-01");
    expect((screen.getByLabelText("Đến ngày") as HTMLInputElement).value).toBe("2026-09-30");
    chayThu();
    await waitFor(() => expect(A.thu).toHaveBeenCalledTimes(1));
    expect(A.thu).toHaveBeenCalledWith({ versionId: "v1", tuNgay: "2026-07-01", denNgay: "2026-09-30", orgUnitId: null });
  });

  it("[NHH-POL-10-UI-11b] đổi ngày + chọn cơ sở ⇒ tham số gửi đúng (orgUnitId của cơ sở đã chọn)", async () => {
    A.thu.mockResolvedValue(xong(ketQua()));
    render(<TrinhSoan {...props()} />);
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-08-15" } });
    fireEvent.change(screen.getByLabelText("Đến ngày"), { target: { value: "2026-09-15" } });
    fireEvent.change(screen.getByLabelText("Phạm vi"), { target: { value: "ou2" } });
    chayThu();
    await waitFor(() => expect(A.thu).toHaveBeenCalled());
    expect(A.thu).toHaveBeenCalledWith({ versionId: "v1", tuNgay: "2026-08-15", denNgay: "2026-09-15", orgUnitId: "ou2" });
  });

  it("[NHH-POL-10-UI-11c] ĐANG TÍNH ⇒ khung chờ (role=status, aria-busy) đúng hình bảng, nút tắt + đổi chữ, không in số nào; xong ⇒ khung biến mất", async () => {
    let xongLenh!: (v: unknown) => void;
    A.thu.mockReturnValue(new Promise((r) => (xongLenh = r)));
    render(<TrinhSoan {...props()} />);
    chayThu();
    const cho = await screen.findByRole("status", { name: "Đang thử tính…" });
    expect(cho.getAttribute("aria-busy")).toBe("true");
    expect(nut(/Đang thử tính/).disabled).toBe(true);
    expect(screen.queryByTestId("ket-qua-thu-tinh")).toBeNull();
    xongLenh(xong(ketQua()));
    await screen.findByTestId("ket-qua-thu-tinh");
    expect(screen.queryByRole("status", { name: "Đang thử tính…" })).toBeNull();
    expect(nut("Chạy thử").disabled).toBe(false);
  });

  it("[NHH-POL-10-UI-11d] LỖI máy chủ ⇒ role=alert nói vấn đề; nút bật lại để thử lại; không có bảng", async () => {
    A.thu.mockResolvedValue({ ok: false, chung: "Không thử tính được lúc này — thử lại, hoặc báo bộ phận kỹ thuật." });
    render(<TrinhSoan {...props()} />);
    chayThu();
    const loi = await screen.findByRole("alert");
    expect(loi.textContent).toMatch(/Không thử tính được/);
    expect(loi.textContent).toMatch(/báo bộ phận kỹ thuật/);
    expect(screen.queryByTestId("ket-qua-thu-tinh")).toBeNull();
    expect(nut("Chạy thử").disabled).toBe(false);
  });

  it("[NHH-POL-10-UI-11e] action NÉM (mất mạng) ⇒ không kẹt ở 'đang tính'; hiện lỗi mất kết nối", async () => {
    A.thu.mockRejectedValue(new Error("Failed to fetch"));
    render(<TrinhSoan {...props()} />);
    chayThu();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Mất kết nối/);
    expect(screen.queryByRole("status", { name: "Đang thử tính…" })).toBeNull();
  });

  it("[NHH-POL-10-UI-11f] ngày sai ⇒ lỗi CẠNH ô (aria-invalid + role=alert), KHÔNG gọi action; sửa lại ⇒ gọi được", async () => {
    A.thu.mockResolvedValue(xong(ketQua()));
    render(<TrinhSoan {...props()} />);
    fireEvent.change(screen.getByLabelText("Đến ngày"), { target: { value: "2026-06-30" } }); // trước ngày bắt đầu
    expect(screen.queryByRole("alert")).toBeNull(); // chưa bấm ⇒ chưa la
    chayThu();
    const loi = await screen.findByRole("alert");
    expect(loi.textContent).toMatch(/từ ngày bắt đầu/);
    expect(screen.getByLabelText("Đến ngày").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Đến ngày").getAttribute("aria-describedby")).toBe(loi.id);
    expect(A.thu).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Đến ngày"), { target: { value: "2026-09-30" } });
    expect(screen.queryByRole("alert")).toBeNull();
    chayThu();
    await waitFor(() => expect(A.thu).toHaveBeenCalledTimes(1));
  });

  it("[NHH-POL-10-UI-11h] bỏ trống 'Từ ngày': chưa bấm ⇒ KHÔNG la; bấm ⇒ lỗi gắn đúng ô 'Từ ngày' (không phải 'Đến ngày'), không gọi action", () => {
    render(<TrinhSoan {...props()} />);
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "" } });
    expect(screen.queryByRole("alert")).toBeNull();
    chayThu();
    const loi = screen.getByRole("alert");
    expect(loi.textContent).toMatch(/Ngày bắt đầu không hợp lệ/);
    expect(screen.getByLabelText("Từ ngày").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Từ ngày").getAttribute("aria-describedby")).toBe(loi.id);
    expect(screen.getByLabelText("Đến ngày").getAttribute("aria-invalid")).toBeNull();
    expect(A.thu).not.toHaveBeenCalled();
  });

  it("[NHH-POL-10-UI-11g] quá 186 ngày ⇒ chặn ở client với CÙNG câu của máy chủ", () => {
    render(<TrinhSoan {...props()} />);
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("Đến ngày"), { target: { value: "2026-09-30" } });
    chayThu();
    expect(screen.getByRole("alert").textContent).toMatch(/tối đa 186 ngày/);
    expect(A.thu).not.toHaveBeenCalled();
  });
});

describe("[NHH-POL-10-UI-12] kết quả", () => {
  async function chayVaLay(k: KetQuaMoPhong, pp: Partial<PropsTrinhSoan> = {}) {
    A.thu.mockResolvedValue(xong(k));
    render(<TrinhSoan {...props(pp)} />);
    chayThu();
    return within(await screen.findByTestId("ket-qua-thu-tinh"));
  }

  it("[NHH-POL-10-UI-12a] nhãn trung thực: 'Ước tính trên dữ liệu 01/07 – 30/09/2026, KHÔNG ghi sổ', giờ chạy giờ VN, dữ liệu là của hôm nay", async () => {
    const kq = await chayVaLay(ketQua());
    expect(kq.getByText(/Ước tính trên dữ liệu 01\/07 – 30\/09\/2026, KHÔNG ghi sổ\./)).toBeTruthy();
    expect(kq.getByText("21:30 08/10/2026")).toBeTruthy();
    expect(kq.getByText(/dữ liệu hôm nay, không phải ảnh chụp/)).toBeTruthy();
  });

  it("[NHH-POL-10-UI-12b] bảng Hiện tại | Đề xuất | Chênh: tiền định dạng VN, chênh CÓ DẤU (−), tỉ lệ hiệu dụng + chênh điểm %, số người", async () => {
    const kq = await chayVaLay(ketQua());
    const bang = kq.getByRole("region", { name: "Tóm tắt Hiện tại, Đề xuất, Chênh" });
    expect(within(bang).getByRole("columnheader", { name: "Tổng hoa hồng" })).toBeTruthy();
    expect(within(bang).getByRole("columnheader", { name: "Tỉ lệ hiệu dụng" })).toBeTruthy();
    const dongCua = (ten: string) => [...within(bang).getByRole("row", { name: new RegExp(`^${ten}`) }).querySelectorAll("td")].map((x) => x.textContent);
    expect(dongCua("Hiện tại")).toEqual(["960.000đ", "8,00%"]);
    expect(dongCua("Đề xuất")).toEqual(["840.000đ", "7,00%"]);
    expect(dongCua("Chênh")).toEqual(["−120.000đ", "−1,00 điểm %"]);
    expect(kq.getByText(/có hoa hồng thay đổi/).textContent).toContain("2 người");
    expect(kq.getByText(/Thực thu tính được \(sau VAT\):/).textContent).toContain("12.000.000đ"); // một số chung, không lặp hai cột
  });

  it("[NHH-POL-10-UI-12c] BỐN bảng phân rã (vai · nguồn · cơ sở · loại), mỗi bảng là vùng cuộn có tên + focus được bằng bàn phím; hàng mang tên người đọc được", async () => {
    const kq = await chayVaLay(ketQua());
    for (const ten of ["Theo vai hưởng", "Theo nhóm nguồn", "Theo cơ sở", "Theo loại giao dịch"]) {
      const vung = kq.getByRole("region", { name: ten });
      expect(vung.getAttribute("tabindex")).toBe("0");
    }
    const vai = kq.getByRole("region", { name: "Theo vai hưởng" });
    const sale = within(vai).getByRole("row", { name: /Sale \(người chốt đơn\)/ });
    expect(sale.textContent).toContain("480.000đ");
    expect(sale.textContent).toContain("360.000đ");
    expect(sale.textContent).toContain("−120.000đ");
    expect(within(kq.getByRole("region", { name: "Theo nhóm nguồn" })).getByRole("row", { name: /Không rõ nguồn/ })).toBeTruthy();
    expect(within(kq.getByRole("region", { name: "Theo loại giao dịch" })).getByRole("row", { name: /Học viên mới/ })).toBeTruthy();
    // dòng không đổi: chênh hiện "0đ" (không dấu), không phải "+0đ"
    const ql = within(vai).getByRole("row", { name: /Quản lý cơ sở/ });
    expect(ql.textContent).toMatch(/0đ$/);
    expect(ql.textContent).not.toMatch(/[+−]0đ/);
  });

  it("[NHH-POL-10-UI-12d] VƯỢT TRẦN: cảnh báo role=alert nêu số khoản + trần + 'không tự cắt'; bảng liệt kê khoản · cơ sở · tỉ lệ · các vai; 'và N khoản khác' khi bị cắt danh sách", async () => {
    const danhSach = [
      { kichBan: "deXuat" as const, paymentId: "pay-1", ngayThu: "2026-09-15", donVi: "CS1 · Cơ sở 1", loai: "NEW" as const, coSo: 10_000_000, tiLe: 0.1, tran: 0.09, vai: [{ roleCode: "SALE", vai: "Sale (người chốt đơn)", kieuTinh: "PERCENT", giaTri: "0.05" }, { roleCode: "CENTER_MANAGER", vai: "Quản lý cơ sở", kieuTinh: "PERCENT", giaTri: "0.02" }] },
    ];
    const kq = await chayVaLay(ketQua({ tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 31, danhSach }, biCat: true } }));
    const canh = kq.getAllByRole("alert").find((x) => /vượt trần/.test(x.textContent ?? ""))!;
    expect(canh.textContent).toMatch(/31 khoản có tổng tỉ lệ vượt trần 9%/);
    expect(canh.textContent).toMatch(/không tự cắt/);
    const bang = kq.getByRole("region", { name: "Khoản vượt trần dưới chính sách đề xuất" });
    const hang = within(bang).getByRole("row", { name: /15\/09\/2026/ });
    expect(hang.textContent).toContain("CS1 · Cơ sở 1");
    expect(hang.textContent).toContain("10,00%");
    expect(hang.textContent).toContain("Sale (người chốt đơn) 5%");
    expect(hang.textContent).toContain("Quản lý cơ sở 2%");
    expect(kq.getByText(/và 30 khoản khác cùng lỗi/)).toBeTruthy();
  });

  it("[NHH-POL-10-UI-12d2] VƯỢT TRẦN chỉ đường (09/10/2026): cảnh báo nêu việc cần làm + LIÊN KẾT tới Cấu hình vận hành khi nâng trần đủ để qua; tổng vượt cả giới hạn ô cấu hình ⇒ KHÔNG liên kết; danh sách bị cắt ⇒ vẫn liên kết, không bịa con số", async () => {
    const khoan = (tiLe: number) => ({ kichBan: "deXuat" as const, paymentId: "pay-1", ngayThu: "2026-09-15", donVi: "CS1 · Cơ sở 1", loai: "NEW" as const, coSo: 10_000_000, tiLe, tran: 0.09, vai: [{ roleCode: "SALE", vai: "Sale (người chốt đơn)", kieuTinh: "PERCENT", giaTri: "0.05" }] });
    const canhVuotTran = (kq: { getAllByRole: (vaiTro: string) => HTMLElement[] }) => kq.getAllByRole("alert").find((x) => /vượt trần/.test(x.textContent ?? ""))!;
    // (a) tổng 11% (≤ giới hạn 20%) ⇒ có liên kết, câu hướng dẫn nêu «tối thiểu 11%»
    const a = await chayVaLay(ketQua({ tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 1, danhSach: [khoan(0.11)] }, biCat: false } }));
    const ca = canhVuotTran(a);
    expect(ca.textContent).toContain("tối thiểu 11%");
    expect(ca.textContent).toContain("Quản trị hệ thống");
    const lk = within(ca).getByRole("link", { name: /Mở Cấu hình vận hành để nâng trần/ });
    expect(lk.getAttribute("href")).toBe("/cau-hinh-van-hanh?tab=khach-hang");
    cleanup();
    // (b) tổng 25% (> giới hạn 20% của ô) ⇒ nâng trần không đủ: KHÔNG liên kết, nói «chỉ còn cách chỉnh lại tỉ lệ»
    const b = await chayVaLay(ketQua({ tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 1, danhSach: [khoan(0.25)] }, biCat: false } }));
    const cb = canhVuotTran(b);
    expect(within(cb).queryByRole("link", { name: /nâng trần/i })).toBeNull();
    expect(cb.textContent).toMatch(/chỉ còn cách chỉnh lại tỉ lệ/);
    cleanup();
    // (c) danh sách bị cắt ⇒ không biết mức lớn nhất: vẫn có liên kết nhưng KHÔNG nêu «tối thiểu X%»
    const c = await chayVaLay(ketQua({ tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 31, danhSach: [khoan(0.11)] }, biCat: true } }));
    const cc = canhVuotTran(c);
    expect(within(cc).getByRole("link", { name: /Mở Cấu hình vận hành để nâng trần/ })).toBeTruthy();
    expect(cc.textContent).not.toContain("tối thiểu");
  });

  it("[NHH-POL-10-UI-12d3] KHÔNG có quyền sửa trần ⇒ cảnh báo vượt trần vẫn nói việc cần làm (Quản trị hệ thống nâng) nhưng KHÔNG có liên kết (đối chứng âm của 12d2)", async () => {
    const khoan = { kichBan: "deXuat" as const, paymentId: "pay-1", ngayThu: "2026-09-15", donVi: "CS1 · Cơ sở 1", loai: "NEW" as const, coSo: 10_000_000, tiLe: 0.11, tran: 0.09, vai: [{ roleCode: "SALE", vai: "Sale (người chốt đơn)", kieuTinh: "PERCENT", giaTri: "0.05" }] };
    const kq = await chayVaLay(ketQua({ tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 1, danhSach: [khoan] }, biCat: false } }), { coQuyenSuaTran: false });
    const ca = kq.getAllByRole("alert").find((x) => /vượt trần/.test(x.textContent ?? ""))!;
    expect(ca.textContent).toContain("Quản trị hệ thống");
    expect(within(ca).queryByRole("link")).toBeNull();
  });

  it("[NHH-POL-10-UI-12e] KHOẢN CHƯA THỂ TÍNH: đếm + lý do + tiền thu, nói rõ 'không bị tính là 0đ'; thiếu người hưởng có bảng riêng", async () => {
    const kq = await chayVaLay(
      ketQua({
        chuaTinh: { soKhoan: 3, theoLyDo: [{ ma: "CHUA_GAN_CON", nhan: "Khoản thu chưa gắn cho bé nào", soKhoan: 3, soTien: 9_000_000 }] },
        thieuNguoi: { hienTai: [{ ma: "KHONG_CO_LEAD", nhan: "Đơn không có lead — không biết ai chốt đơn", soKhoan: 2, soTien: 500_000 }], deXuat: [] },
      }),
    );
    expect(kq.getByText(/3 khoản chưa thể tính/)).toBeTruthy();
    const bang = kq.getByRole("region", { name: /Khoản chưa thể tính \(3\)/ });
    const hang = within(bang).getByRole("row", { name: /Khoản thu chưa gắn cho bé nào/ });
    expect(hang.textContent).toContain("9.000.000đ");
    expect(kq.getByText(/không bị tính là 0đ/)).toBeTruthy();
    // một kịch bản vượt trần thì kịch bản đó KHÔNG còn dòng nào để "thiếu" — bên kia vẫn phải hiện (không ẩn theo phía đề xuất)
    const thieu = within(kq.getByRole("region", { name: /Vai có quy tắc nhưng chưa có người hưởng/ })).getByRole("row", { name: /Đơn không có lead/ });
    const o = [...thieu.querySelectorAll("td")].map((x) => x.textContent);
    expect(o).toEqual(["2", "500.000đ", "0", "0đ"]);
  });

  it("[NHH-POL-10-UI-12f] CẮT: banner role=status nêu số khoản đã xét, mốc ngày, số chưa xét; hoàn / chuyển nội bộ được NÓI là không nằm trong thử tính", async () => {
    const kq = await chayVaLay(ketQua({ cat: { tran: 1500, soKhoanChuaXet: 230, xetTuNgay: "2026-08-12" }, ngoai: { soKhoanHoan: 4, tienHoan: -2_000_000, soKhoanKhongPhaiHocPhi: 1, soKhoanChuyenNoiBo: 2 } }));
    const c = kq.getAllByRole("status").find((x) => /1\.500 khoản gần nhất/.test(x.textContent ?? ""))!;
    expect(c.textContent).toMatch(/từ 12\/08\/2026/);
    expect(c.textContent).toMatch(/230 khoản cũ hơn/);
    expect(kq.getByText(/Không nằm trong thử tính: 4 khoản hoàn \/ điều chỉnh âm \(−2\.000\.000đ\); 2 khoản chuyển tiền nội bộ; 1 khoản không phải học phí\./)).toBeTruthy();
  });

  it("[NHH-POL-10-UI-12g] RỖNG sau khi chạy: nói thẳng không có khoản nào tính được — KHÔNG bảng 0đ; có khoản chưa tính thì chỉ đường", async () => {
    const kq = await chayVaLay(ketQua({ soKhoanTinhDuoc: 0, soKhoanTrongKhoang: 5, coSo: 0, hoaHong: { hienTai: 0, deXuat: 0, chenh: 0 }, tiLeHieuDung: { hienTai: null, deXuat: null }, phanRa: { vai: [], nguon: [], donVi: [], loai: [] }, soNguoiAnhHuong: 0, chuaTinh: { soKhoan: 5, theoLyDo: [{ ma: "CHUA_GAN_CON", nhan: "Khoản thu chưa gắn cho bé nào", soKhoan: 5, soTien: 1_000_000 }] } }));
    expect(kq.getByText(/Không có khoản thu nào tính được trong khoảng và phạm vi này \(có 5 khoản thu nhưng chưa thể tính/)).toBeTruthy();
    expect(kq.queryByRole("region", { name: "Tóm tắt Hiện tại, Đề xuất, Chênh" })).toBeNull();
    expect(kq.queryByRole("region", { name: "Theo vai hưởng" })).toBeNull();
  });

  it("[NHH-POL-10-UI-12h] không có cảnh báo nào ⇒ không vẽ khối cảnh báo (đối chứng: không báo động giả)", async () => {
    const kq = await chayVaLay(ketQua());
    expect(kq.queryByRole("alert")).toBeNull();
    expect(kq.queryByRole("list", { name: "Điều cần biết trước khi đọc số" })).toBeNull();
  });
});

describe("[NHH-POL-10-UI-13] kết quả cũ + giữ trạng thái + hộp thoại kích hoạt", () => {
  it("[NHH-POL-10-UI-13a] đổi bước rồi quay lại: kết quả VÀ ô đã nhập còn nguyên (state ở trình soạn, không mất khi đổi bước)", async () => {
    A.thu.mockResolvedValue(xong(ketQua()));
    render(<TrinhSoan {...props()} />);
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Phạm vi"), { target: { value: "ou1" } });
    chayThu();
    await screen.findByTestId("ket-qua-thu-tinh");
    fireEvent.click(nut("Quay lại"));
    expect(screen.queryByTestId("ket-qua-thu-tinh")).toBeNull();
    fireEvent.click(nut("Tiếp"));
    expect(screen.getByTestId("ket-qua-thu-tinh")).toBeTruthy();
    expect((screen.getByLabelText("Từ ngày") as HTMLInputElement).value).toBe("2026-08-01");
    expect((screen.getByLabelText("Phạm vi") as HTMLSelectElement).value).toBe("ou1");
  });

  it("[NHH-POL-10-UI-13b] sửa dở sau khi có kết quả ⇒ nút TẮT với câu 'sửa sau lần lưu cuối', kết quả gắn nhãn CŨ; lưu lại ⇒ vẫn CŨ (mốc bản nháp đổi) cho tới khi chạy lại", async () => {
    A.thu.mockResolvedValue(xong(ketQua()));
    A.luu.mockResolvedValue({ ok: true, policyId: "p1", versionId: "v1", versionNo: 1, vanBanId: null, updatedAt: "2026-10-08T05:00:00.000Z", hangRao: OK });
    render(<TrinhSoan {...props()} />);
    chayThu();
    await screen.findByTestId("ket-qua-thu-tinh");
    expect(screen.queryByText(/Kết quả này là của bản nháp ở lần lưu trước/)).toBeNull(); // mới: không nhãn cũ
    // quay về bước 1, sửa tên, quay lại bước thử tính
    for (let i = 0; i < 5; i++) fireEvent.click(nut("Quay lại"));
    fireEvent.change(document.querySelector<HTMLInputElement>('[data-truong="name"]')!, { target: { value: "Tên mới" } });
    for (let i = 0; i < 5; i++) fireEvent.click(nut("Tiếp"));
    expect(nut("Chạy thử").disabled).toBe(true);
    expect(screen.getByText(/sửa sau lần lưu cuối/)).toBeTruthy();
    expect(screen.getByText(/Kết quả này là của bản nháp ở lần lưu trước/)).toBeTruthy();
    // lưu nháp ⇒ nút bật lại nhưng kết quả VẪN cũ (mốc updatedAt đổi)
    fireEvent.click(nut("Lưu nháp"));
    await waitFor(() => expect(T.success).toHaveBeenCalled());
    expect(nut("Chạy thử").disabled).toBe(false);
    expect(screen.getByText(/Kết quả này là của bản nháp ở lần lưu trước/)).toBeTruthy();
    // chạy lại với mốc mới ⇒ hết nhãn cũ
    A.thu.mockResolvedValue(xong(ketQua(), "2026-10-08T05:00:00.000Z"));
    chayThu();
    await waitFor(() => expect(screen.queryByText(/Kết quả này là của bản nháp ở lần lưu trước/)).toBeNull());
    expect(A.thu).toHaveBeenLastCalledWith(expect.objectContaining({ versionId: "v1" }));
  });

  async function moHopThoai() {
    fireEvent.click(nut("Tiếp")); // thu-tinh → kich-hoat
    fireEvent.click(nut("Kích hoạt…"));
    return within(await screen.findByRole("dialog"));
  }

  it("[NHH-POL-10-UI-13c] hộp thoại kích hoạt — CHƯA thử tính: nói thẳng 'Chưa thử tính', KHÔNG số nào (không còn câu 'chưa thử tính được' của bản cũ)", async () => {
    render(<TrinhSoan {...props()} />);
    const hop = await moHopThoai();
    const td = hop.getByTestId("tac-dong-uoc-tinh");
    expect(td.textContent).toMatch(/Chưa thử tính trên dữ liệu thật/);
    expect(td.textContent).not.toMatch(/\d{3}\.\d{3}đ/);
  });

  it("[NHH-POL-10-UI-13d] hộp thoại — đã thử tính, bản còn nguyên: hiện khoảng · hiện tại → đề xuất · chênh có dấu · số người; vượt trần thêm dòng riêng", async () => {
    A.thu.mockResolvedValue(xong(ketQua({ tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 2, danhSach: [] }, biCat: false } })));
    render(<TrinhSoan {...props()} />);
    chayThu();
    await screen.findByTestId("ket-qua-thu-tinh");
    const hop = await moHopThoai();
    const td = hop.getByTestId("tac-dong-uoc-tinh");
    expect(td.textContent).toContain("01/07 – 30/09/2026");
    expect(td.textContent).toContain("960.000đ → 840.000đ");
    expect(td.textContent).toContain("−120.000đ");
    expect(td.textContent).toContain("2 người thay đổi");
    expect(td.textContent).toContain("2 khoản vượt trần 9%");
    expect(td.textContent).toMatch(/không ghi sổ/);
  });

  it("[NHH-POL-10-UI-13e] hộp thoại — kết quả CŨ (bản đã đổi): KHÔNG dùng số cũ làm 'tác động', bảo chạy lại", async () => {
    A.thu.mockResolvedValue(xong(ketQua(), "2026-10-08T01:00:00.000Z")); // mốc KHÁC bản đã lưu
    render(<TrinhSoan {...props()} />);
    chayThu();
    await screen.findByTestId("ket-qua-thu-tinh");
    const hop = await moHopThoai();
    const td = hop.getByTestId("tac-dong-uoc-tinh");
    expect(td.textContent).toMatch(/đã cũ/);
    expect(td.textContent).not.toContain("960.000");
    expect(td.textContent).not.toContain("840.000");
  });
});
