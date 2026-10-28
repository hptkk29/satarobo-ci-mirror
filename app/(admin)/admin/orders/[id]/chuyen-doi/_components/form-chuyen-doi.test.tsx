// @vitest-environment jsdom
/**
 * Ca [FCD-*] — màn CHUYỂN ĐỔI dựng THẬT theo từng VAI (27/10/2026).
 *
 * Test thuần của `xep-lop-theo-buoi-bat-dau.ts` xanh kể cả khi form vẽ sai (hoặc không vẽ) các lựa chọn; chỉ dựng thật mới biết. Mọi ca "KHÔNG thấy X" đi kèm ĐỐI CHỨNG DƯƠNG
 * (vai khác THẤY X) — nếu không, ca xanh cả khi cả form không render gì (CLAUDE.md luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DongChuyenDoi, LopUngVien, PhuHuynhChuyenDoi } from "@/lib/orders/chuyen-doi-don";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../_actions", () => ({
  chuyenDoiDonAction: vi.fn(async () => ({ ok: true, soCon: 1, soPhieuHocBu: 0, soChoDuyet: 0 })),
  doiBuoiBatDauAction: vi.fn(async () => ({ ok: true, buoiBatDau: 1, canBu: 0 })),
}));

import { FormChuyenDoi } from "./form-chuyen-doi";

afterEach(cleanup);

const PH: PhuHuynhChuyenDoi = {
  ten: "Phụ huynh fixture",
  sdt: "0905123456",
  email: "ph@example.test",
  quanHe: "",
  gioiTinh: "",
  ngaySinh: "",
  facebook: "",
  diaChi: "",
  tinh: "",
  phuong: "",
};

const lop = (id: string, ten: string, soBuoiDaQua: number, p: Partial<LopUngVien> = {}): LopUngVien => ({
  id,
  ten,
  maLop: null,
  lich: null,
  siSo: 3,
  siSoToiDa: 12,
  daDay: false,
  soBuoiDaQua,
  tenCoSo: null,
  khacCoSo: false,
  ...p,
});

const dong = (p: Partial<DongChuyenDoi> = {}): DongChuyenDoi => ({
  orderItemId: "it1",
  tenDong: "Sata 4",
  courseId: "k1",
  tenKhoa: "Sata 4",
  tongSoBuoiKhoa: 48,
  soBuoiMua: null,
  khoangBuoi: { min: 1, max: 1, macDinh: 1, muaDuKhoa: true },
  tenBe: "Bé Một",
  ngaySinh: "",
  gioiTinh: "",
  lopTruong: "",
  truong: "",
  leadChildId: null,
  studentId: null,
  enrollmentId: null,
  buoiBatDauDaLuu: null,
  phamVi: false,
  lop: [lop("l0", "Lớp chưa học", 0), lop("l3", "Lớp đã học 3 buổi", 3), lop("l8", "Lớp đã học 8 buổi", 8), lop("ld", "Lớp đã đầy", 0, { daDay: true })],
  ...p,
});

const dung = (vai: "SALE" | "QLCS" | "ADMIN", d: DongChuyenDoi[] = [dong()]) =>
  render(<FormChuyenDoi orderId="o1" maDon="ORD-1" phuHuynh={PH} dong={d} vai={vai} tran={6} donHocBong={false} />);

/** Dòng đếm "N lớp xếp được / hiện có" dưới ô chọn lớp. */
const dongDem = () => screen.getByText(/lớp (xếp được|hiện có)/);

describe("[FCD] form chuyển đổi dựng thật theo vai", () => {
  it("[FCD-01] không còn ô 'Xếp bé này'; có ô phụ huynh sửa được (họ tên, email) và SĐT chỉ-đọc", () => {
    dung("SALE");
    expect(screen.queryByText(/Xếp bé này/)).toBeNull();
    expect((screen.getByLabelText(/Họ tên/, { selector: "#ph-ten" }) as HTMLInputElement).value).toBe("Phụ huynh fixture");
    expect((screen.getByLabelText(/Email/, { selector: "#ph-email" }) as HTMLInputElement).value).toBe("ph@example.test");
    const sdt = screen.getByLabelText(/Số điện thoại/, { selector: "#ph-sdt" }) as HTMLInputElement;
    expect(sdt.readOnly).toBe(true);
  });

  it("[FCD-02] SALE: lớp đã học 8 buổi (v = 8 > trần 6) bị ẩn, lớp đầy ẩn; QLCS và ADMIN THẤY lớp vượt trần (đối chứng dương) nhưng vẫn không thấy lớp đầy", () => {
    dung("SALE");
    expect(dongDem().textContent).toContain("2 lớp xếp được"); // lớp chưa học + lớp đã học 3 buổi
    expect(dongDem().textContent).toContain("1 lớp đã đầy không hiện");
    expect(dongDem().textContent).toContain("1 lớp học trước quá trần 6 buổi");
    cleanup();
    dung("QLCS");
    expect(dongDem().textContent).toContain("3 lớp hiện có");
    expect(dongDem().textContent).not.toContain("quá trần");
    cleanup();
    dung("ADMIN");
    expect(dongDem().textContent).toContain("hiện có");
  });

  it("[FCD-03] mua 24 buổi ⇒ ô 'Bắt đầu học từ buổi' có mặc định 25; mua đủ khoá ⇒ KHÔNG có ô đó", () => {
    dung("SALE", [dong({ soBuoiMua: 24, khoangBuoi: { min: 1, max: 25, macDinh: 25, muaDuKhoa: false } })]);
    expect((screen.getByLabelText(/Bắt đầu học từ buổi/, { selector: "#be-1-bd" }) as HTMLInputElement).value).toBe("25");
    cleanup();
    dung("SALE");
    expect(screen.queryByLabelText(/Bắt đầu học từ buổi/, { selector: "#be-1-bd" })).toBeNull();
  });

  it("[FCD-04] đổi buổi bắt đầu xuống 1 ⇒ lớp đã học 8 buổi quay lại/biến mất theo luật: mua 24 buổi, S = 25 ⇒ sale thấy CẢ lớp đã học 8 buổi (lớp chưa tới buổi 25)", () => {
    dung("SALE", [dong({ soBuoiMua: 24, khoangBuoi: { min: 1, max: 25, macDinh: 25, muaDuKhoa: false } })]);
    expect(dongDem().textContent).toContain("3 lớp xếp được"); // l0, l3, l8 đều chưa tới buổi 25
    fireEvent.change(screen.getByLabelText(/Bắt đầu học từ buổi/, { selector: "#be-1-bd" }), { target: { value: "1" } });
    expect(dongDem().textContent).toContain("1 lớp học trước quá trần 6 buổi"); // S = 1: lớp đã học 8 buổi ⇒ v = 8 > 6
    expect(dongDem().textContent).toContain("2 lớp xếp được");
  });

  it("[FCD-05] ô đồng ý hình ảnh (NĐ 13/2023) có mặt, MẶC ĐỊNH không tích", () => {
    dung("SALE");
    const o = screen.getByRole("checkbox", { name: /đồng ý cho trung tâm sử dụng hình ảnh/i }) as HTMLInputElement;
    expect(o.checked).toBe(false);
  });

  it("[FCD-06] ô thông tin bé điền sẵn từ dữ liệu nạp (giới tính, lớp ở trường, trường, ngày sinh)", () => {
    dung("SALE", [dong({ gioiTinh: "FEMALE", lopTruong: "4", truong: "Tiểu học Trần Văn Ơn", ngaySinh: "2017-03-09" })]);
    expect((screen.getByLabelText(/Giới tính/, { selector: "#be-1-gt" }) as HTMLSelectElement).value).toBe("FEMALE");
    expect((screen.getByLabelText(/Lớp đang học ở trường/) as HTMLSelectElement).value).toBe("4");
    expect((screen.getByLabelText(/Trường đang học/) as HTMLInputElement).value).toBe("Tiểu học Trần Văn Ơn");
    expect((screen.getByLabelText(/Ngày sinh/, { selector: "#be-1-ns" }) as HTMLInputElement).value).toBe("2017-03-09");
  });

  it("[FCD-07] ADMIN: dòng ĐÃ chuyển đổi (đơn thường) có nút 'Sửa buổi bắt đầu'; SALE và QLCS KHÔNG có (đối chứng dương: admin thấy)", () => {
    const daXep = dong({ enrollmentId: "gd1", buoiBatDauDaLuu: 1, soBuoiMua: 24, khoangBuoi: { min: 1, max: 25, macDinh: 25, muaDuKhoa: false } });
    dung("ADMIN", [daXep]);
    expect(screen.getByRole("button", { name: "Sửa buổi bắt đầu" })).toBeTruthy();
    cleanup();
    dung("QLCS", [daXep]);
    expect(screen.queryByRole("button", { name: "Sửa buổi bắt đầu" })).toBeNull();
    cleanup();
    dung("SALE", [daXep]);
    expect(screen.queryByRole("button", { name: "Sửa buổi bắt đầu" })).toBeNull();
  });

  it("[FCD-08] dòng SCOPE: KHÔNG ô buổi bắt đầu (quyền học quyết) và ADMIN cũng không có nút sửa buổi bắt đầu", () => {
    dung("ADMIN", [dong({ phamVi: true, khoangBuoi: null, soBuoiMua: 24 })]);
    expect(screen.queryByLabelText(/Bắt đầu học từ buổi/, { selector: "#be-1-bd" })).toBeNull();
    cleanup();
    dung("ADMIN", [dong({ phamVi: true, khoangBuoi: null, enrollmentId: "gd1" })]);
    expect(screen.queryByRole("button", { name: "Sửa buổi bắt đầu" })).toBeNull();
  });

  it("[FCD-09] chưa chọn lớp nào ⇒ nút 'Xếp vào lớp' khoá và thanh dưới nói 'Chưa chọn lớp'", () => {
    dung("SALE");
    expect((screen.getByRole("button", { name: /Xếp vào lớp/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Chưa chọn lớp cho bé nào/)).toBeTruthy();
  });

  it("[FCD-10] đơn học bổng 100% có dòng thông báo", () => {
    render(<FormChuyenDoi orderId="o1" maDon="ORD-1" phuHuynh={PH} dong={[dong()]} vai="ADMIN" tran={6} donHocBong />);
    expect(screen.getByText(/học bổng 100%/)).toBeTruthy();
  });
});
