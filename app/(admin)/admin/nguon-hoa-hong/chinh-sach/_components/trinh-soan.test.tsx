// @vitest-environment jsdom
/**
 * [NHH-FE-04] · [NHH-FE-07] · [NHH-FE-TS-*] — TRÌNH SOẠN chính sách (builder 7 bước) trên phần tử thật, Server Action giả lập.
 *
 * Điều canh ở đây là HÀNH VI mà tsc và lưới thuần không chạm tới:
 *   · "Tiếp" chỉ đi khi bước hợp lệ; lỗi hiện cạnh ô, focus ô lỗi đầu tiên; bấm tắt sang bước sau cũng bị chặn ở bước lỗi đầu;
 *   · lỗi máy chủ về ĐÚNG ô, form KHÔNG mất dữ liệu, sửa ô là lỗi biến mất;
 *   · nút Kích hoạt: không quyền ⇒ không vẽ; có quyền nhưng chưa đạt ⇒ tắt kèm lý do; đủ ⇒ sáng, hộp thoại nói đúng ngày, gọi đúng action;
 *   · chỉ đọc ⇒ mọi ô khoá, không có nút Lưu, có "Tạo phiên bản mới".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
import type { DuLieuSoanClient } from "./kieu-soan";
import { TrinhSoan, type PropsTrinhSoan } from "./trinh-soan";

const dl: DuLieuSoanClient = {
  vai: [
    { code: "SALE", name: "Sale (người chốt đơn)", isAcquisition: false, resolverType: "TRANSACTION_ROLE", resolverKey: null },
    { code: "CENTER_MANAGER", name: "Quản lý cơ sở", isAcquisition: false, resolverType: "ORG_UNIT_ROLE", resolverKey: null },
    { code: "REFERRER_PARENT", name: "Phụ huynh giới thiệu", isAcquisition: true, resolverType: "DIRECT_PERSON", resolverKey: null },
  ],
  nhomNguon: [{ id: "g1", code: "PAID_ADS", name: "Nguồn từ Quảng cáo", coHoaHong: true, trangThai: "HOAT_DONG", hieuLucTu: null, hieuLucDen: null, coNguoiPhuTrach: false, referrerRequirement: "NONE" }],
  coSo: [{ orgUnitId: "ou1", centerId: "c1", label: "CS1 · Cơ sở 1" }],
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

const moi = (p: Partial<PropsTrinhSoan> = {}): PropsTrinhSoan => ({
  cheDo: "tao-moi",
  policyId: null,
  luuDau: null,
  formDau: formRong(),
  dl,
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

const o = (truong: string) => document.querySelector<HTMLElement>(`[data-truong="${truong}"]`) as HTMLInputElement;
const nut = (ten: string | RegExp) => screen.getByRole("button", { name: ten }) as HTMLButtonElement;
const buocHienTai = () => screen.getByRole("heading", { level: 2, name: /Bước \d\/7/ }).textContent ?? "";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  for (const f of [R.replace, R.push, A.luu, A.kiem, A.kich, A.huy, A.thu, T.success, T.error, T.message]) f.mockReset();
});
afterEach(cleanup);

describe("[DYN-CE-UI] ô chọn nhóm nguồn nói THẬT về cờ commissionEnabled (luật 12: không hứa chính sách chạy khi nó bất hoạt)", () => {
  const dlHaiNguon: DuLieuSoanClient = {
    ...dl,
    nhomNguon: [
      { id: "g1", code: "PAID_ADS", name: "Nguồn từ Quảng cáo", coHoaHong: true, trangThai: "HOAT_DONG", hieuLucTu: null, hieuLucDen: null, coNguoiPhuTrach: false, referrerRequirement: "NONE" },
      { id: "g2", code: "WALK_IN", name: "Nguồn KH tự đến", coHoaHong: false, trangThai: "HOAT_DONG", hieuLucTu: null, hieuLucDen: null, coNguoiPhuTrach: false, referrerRequirement: "NONE" },
    ],
  };
  const hienNhomNguon = (id: string) => {
    render(<TrinhSoan {...moi({ dl: dlHaiNguon, formDau: { ...formRong(), phamVi: { loai: "SOURCE_GROUP", sourceGroupId: id } } })} />);
  };

  it("[DYN-CE-UI-01] nguồn cờ FALSE: nhãn lựa chọn ghi rõ + dòng cảnh báo hiện khi CHỌN nó; nguồn cờ TRUE: không nhãn phụ, không cảnh báo (đối chứng dương)", () => {
    hienNhomNguon("g2");
    expect(screen.getByRole("option", { name: /Nguồn KH tự đến — không tham gia hoa hồng theo nguồn/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Nguồn từ Quảng cáo — có hoa hồng theo nguồn" })).toBeTruthy();
    expect(screen.getByTestId("nguon-khong-hoa-hong").textContent).toContain("không chạy và không kích hoạt được");
    cleanup();
    hienNhomNguon("g1");
    expect(screen.queryByTestId("nguon-khong-hoa-hong")).toBeNull();
  });
});

describe("[NHH-FE-04] 'Tiếp' chỉ đi khi bước hợp lệ; lỗi cạnh ô; focus ô lỗi đầu", () => {
  it("[NHH-FE-04j] form trống + Tiếp ⇒ ở lại bước 1, lỗi hiện CẠNH từng ô (aria-invalid), focus nhảy vào ô lỗi ĐẦU TIÊN", () => {
    render(<TrinhSoan {...moi()} />);
    fireEvent.click(nut("Tiếp"));
    expect(buocHienTai()).toMatch(/Bước 1\/7/);
    expect(o("policyCode").getAttribute("aria-invalid")).toBe("true");
    expect(o("name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Nhập mã chính sách.")).toBeTruthy();
    expect(document.activeElement).toBe(o("policyCode"));
  });

  it("[NHH-FE-04k] sửa ô lỗi ⇒ lỗi của ô đó biến mất NGAY (không đợi bấm lại), ô khác vẫn còn lỗi", () => {
    render(<TrinhSoan {...moi()} />);
    fireEvent.click(nut("Tiếp"));
    fireEvent.change(o("policyCode"), { target: { value: "SR.QD.1/A" } });
    expect(screen.queryByText("Nhập mã chính sách.")).toBeNull();
    expect(o("policyCode").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("Nhập tên chính sách.")).toBeTruthy();
  });

  it("[NHH-FE-04l] hợp lệ bước 1 ⇒ sang bước 2; bước 2 trống ⇒ lỗi ở 'vai', focus vào nhóm chọn", () => {
    render(<TrinhSoan {...moi()} />);
    fireEvent.change(o("policyCode"), { target: { value: "SR.QD.1/A" } });
    fireEvent.change(o("name"), { target: { value: "Chính sách A" } });
    fireEvent.click(screen.getByLabelText(/^Khách hàng mới/));
    fireEvent.click(nut("Tiếp"));
    expect(buocHienTai()).toMatch(/Bước 2\/7/);
    fireEvent.click(nut("Tiếp"));
    expect(buocHienTai()).toMatch(/Bước 2\/7/);
    expect(screen.getByText("Chọn ít nhất một vai được hưởng.")).toBeTruthy();
    expect(document.activeElement).toBe(o("vai"));
  });

  it("[NHH-FE-04m] bấm TẮT sang bước 7 trên form trống bị chặn ở bước lỗi ĐẦU (bước 1), không nhảy tới bước 7", () => {
    render(<TrinhSoan {...moi()} />);
    fireEvent.click(screen.getByRole("button", { name: /Kích hoạt$/ }));
    expect(buocHienTai()).toMatch(/Bước 1\/7/);
    expect(screen.getByText("Nhập mã chính sách.")).toBeTruthy();
  });

  it("[NHH-FE-04n] bấm LÙI luôn được, không đòi hợp lệ", () => {
    render(<TrinhSoan {...moi({ formDau: formDu(), buocDau: "cach-tinh" })} />);
    fireEvent.click(screen.getByRole("button", { name: /Bối cảnh/ }));
    expect(buocHienTai()).toMatch(/Bước 1\/7/);
  });
});

describe("[NHH-FE-05] bước Cách tính: gõ 3 ⇒ 3%, tổng cộng đúng, lỗi đúng ô", () => {
  it("[NHH-FE-05m] gõ 3 và 2,5 ⇒ dòng tổng '5,5%'; vượt trần ⇒ chữ 'vượt trần 9%' cạnh tổng", () => {
    render(<TrinhSoan {...moi({ formDau: formDu({ o: {} }), buocDau: "cach-tinh" })} />);
    fireEvent.change(screen.getByLabelText("Tỉ lệ Sale (người chốt đơn) · Khách hàng mới"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Tỉ lệ Quản lý cơ sở · Khách hàng mới"), { target: { value: "2,5" } });
    expect(screen.getByText("5,5%")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tỉ lệ Quản lý cơ sở · Khách hàng mới"), { target: { value: "7" } });
    const tong = screen.getByRole("rowheader", { name: "Tổng trong chính sách này" }).closest("tr")!;
    expect(tong.textContent).toMatch(/10%\s*vượt trần 9%/);
  });

  it("[NHH-FE-05n] bấm 'Không trả' ⇒ ô thành nhãn 'Không trả' có nút hoàn tác; hoàn tác ⇒ ô nhập trống trở lại", () => {
    render(<TrinhSoan {...moi({ formDau: formDu({ o: {} }), buocDau: "cach-tinh" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Không trả hoa hồng: Sale (người chốt đơn) · Khách hàng mới" }));
    expect(screen.getByText("Không trả")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Bỏ loại trừ: Sale/ }));
    expect((screen.getByLabelText("Tỉ lệ Sale (người chốt đơn) · Khách hàng mới") as HTMLInputElement).value).toBe("");
  });

  it("[NHH-FE-05o] vai đã chọn mà không có ô nào ⇒ 'Tiếp' báo ở ô ĐẦU của vai đó, bằng tên vai", () => {
    render(<TrinhSoan {...moi({ formDau: formDu({ o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" } } }), buocDau: "cach-tinh" })} />);
    fireEvent.click(nut("Tiếp"));
    expect(buocHienTai()).toMatch(/Bước 3\/7/);
    expect(screen.getByText(/Vai "Quản lý cơ sở" chưa có tỉ lệ nào/)).toBeTruthy();
  });
});

describe("[NHH-FE-04] lưu nháp và lỗi máy chủ", () => {
  it("[NHH-FE-04p] lưu thành công: gửi ĐÚNG chữ đã gõ ('4' chứ không '0.04' — quy đổi ở máy chủ), toast, và chuyển URL sang trang sửa nháp giữ nguyên bước", async () => {
    A.luu.mockResolvedValue({ ok: true, policyId: "p9", versionId: "v9", versionNo: 1, vanBanId: "d1", updatedAt: "2026-10-08T03:05:00.000Z", hangRao: OK });
    render(<TrinhSoan {...moi({ formDau: formDu(), buocDau: "hieu-luc" })} />);
    fireEvent.click(nut("Lưu nháp"));
    await waitFor(() => expect(R.replace).toHaveBeenCalled());
    const goi = A.luu.mock.calls[0]![0] as { form: FormChinhSach; policyId: string | null; versionId: string | null; updatedAtDaThay: string | null };
    expect(goi.form.o["NEW|SALE"]).toEqual({ kieu: "PERCENT", phanTram: "4" });
    expect(goi.policyId).toBeNull();
    expect(goi.versionId).toBeNull();
    expect(R.replace).toHaveBeenCalledWith("/nguon-hoa-hong/chinh-sach/p9/soan?v=v9&buoc=hieu-luc");
    expect(T.success).toHaveBeenCalledWith("Đã lưu nháp v1");
  });

  it("[NHH-FE-04q] lưu khi form thiếu mã/tên: KHÔNG gọi máy chủ, nhảy tới bước có lỗi và focus ô lỗi", () => {
    render(<TrinhSoan {...moi({ formDau: formDu({ policyCode: "" }), buocDau: "cach-tinh" })} />);
    fireEvent.click(nut("Lưu nháp"));
    expect(A.luu).not.toHaveBeenCalled();
    expect(buocHienTai()).toMatch(/Bước 1\/7/);
    expect(document.activeElement).toBe(o("policyCode"));
  });

  it("[NHH-FE-04r] máy chủ từ chối 'trùng mã': lỗi hiện cạnh ô policyCode, form GIỮ NGUYÊN dữ liệu, URL không đổi; sửa ô ⇒ lỗi máy chủ biến mất", async () => {
    A.luu.mockResolvedValue({ ok: false, loi: [{ truong: "policyCode", thongBao: "Mã này đã có chính sách khác dùng — đổi mã.", buoc: "boi-canh" }], chung: null });
    render(<TrinhSoan {...moi({ formDau: formDu(), buocDau: "hieu-luc" })} />);
    fireEvent.click(nut("Lưu nháp"));
    await screen.findByText("Mã này đã có chính sách khác dùng — đổi mã.");
    expect(buocHienTai()).toMatch(/Bước 1\/7/);
    expect(o("policyCode").value).toBe("SR.QD.300/HV");
    expect(o("name").value).toBe("Hoa hồng học viên mới");
    // Focus do `useEffect` sau khi state đổi — `findByText` có thể thoả TRƯỚC khi effect chạy. Cấy 08/10: ca này đỏ NGẪU NHIÊN (2/~60 lượt
    // chạy cả bộ song song, kể cả lượt cấy một lỗi chẳng liên quan) ⇒ đo bằng `waitFor`, không đọc `activeElement` ngay.
    await waitFor(() => expect(document.activeElement).toBe(o("policyCode")));
    expect(R.replace).not.toHaveBeenCalled();
    fireEvent.change(o("policyCode"), { target: { value: "SR.QD.300/HV2" } });
    expect(screen.queryByText("Mã này đã có chính sách khác dùng — đổi mã.")).toBeNull();
  });

  it("[NHH-FE-04s] lỗi chung của máy chủ hiện ở ĐẦU form (role=alert), không gắn vào ô vô tội", async () => {
    A.luu.mockResolvedValue({ ok: false, loi: [], chung: "Có người vừa sửa bản nháp này — tải lại trang." });
    render(<TrinhSoan {...daLuu({ buocDau: "hieu-luc" })} />);
    fireEvent.change(o("lyDo"), { target: { value: "đã sửa" } });
    fireEvent.click(nut("Lưu nháp"));
    const a = await screen.findByRole("alert");
    expect(a.textContent).toMatch(/Có người vừa sửa/);
    expect(o("lyDo").value).toBe("đã sửa");
  });

  it("[NHH-FE-04t] máy chủ trả vanBanIdDaTao ⇒ văn bản đã tạo được GIỮ (đổi thành 'dùng văn bản đã có'), lần Lưu kế gửi kieu 'co-san' — không tạo trùng", async () => {
    const moiVb = formDu({ vanBan: { kieu: "moi", documentCode: "SR.QD.999", title: "VB mới", issuedOn: "2026-03-01", publishedOn: "2026-03-02", effectiveOn: "2026-03-23", approvedByName: "Phúc", tep: null } });
    A.luu.mockResolvedValueOnce({ ok: false, loi: [{ truong: "policyCode", thongBao: "Mã trùng", buoc: "boi-canh" }], chung: null, vanBanIdDaTao: "dMoi" });
    render(<TrinhSoan {...moi({ formDau: moiVb, buocDau: "hieu-luc" })} />);
    fireEvent.click(nut("Lưu nháp"));
    await screen.findByText("Mã trùng");
    fireEvent.change(o("policyCode"), { target: { value: "SR.QD.300/KHAC" } });
    A.luu.mockResolvedValueOnce({ ok: true, policyId: "p1", versionId: "v1", versionNo: 1, vanBanId: "dMoi", updatedAt: "2026-10-08T03:05:00.000Z", hangRao: OK });
    fireEvent.click(nut("Lưu nháp"));
    await waitFor(() => expect(A.luu).toHaveBeenCalledTimes(2));
    const lan2 = A.luu.mock.calls[1]![0] as { form: FormChinhSach };
    expect(lan2.form.vanBan).toEqual({ kieu: "co-san", id: "dMoi" });
  });

  it("[NHH-FE-04u] sửa nháp: gửi updatedAt đã thấy + versionId; sau khi lưu, lần lưu kế gửi updatedAt MỚI", async () => {
    A.luu.mockResolvedValue({ ok: true, policyId: "p1", versionId: "v1", versionNo: 1, vanBanId: "d1", updatedAt: "2026-10-08T03:09:00.000Z", hangRao: OK });
    render(<TrinhSoan {...daLuu({ buocDau: "hieu-luc" })} />);
    fireEvent.change(o("lyDo"), { target: { value: "lần 1" } });
    fireEvent.click(nut("Lưu nháp"));
    await waitFor(() => expect(A.luu).toHaveBeenCalledTimes(1));
    expect(A.luu.mock.calls[0]![0]).toMatchObject({ policyId: "p1", versionId: "v1", updatedAtDaThay: "2026-10-08T03:00:00.000Z" });
    await screen.findByText(/Đã lưu v1 lúc/);
    fireEvent.change(o("lyDo"), { target: { value: "lần 2" } });
    fireEvent.click(nut("Lưu nháp"));
    await waitFor(() => expect(A.luu).toHaveBeenCalledTimes(2));
    expect(A.luu.mock.calls[1]![0]).toMatchObject({ updatedAtDaThay: "2026-10-08T03:09:00.000Z" });
  });
});

describe("[NHH-FE-07] nút Kích hoạt chỉ sáng khi đủ điều kiện", () => {
  it("[NHH-FE-07q] KHÔNG có quyền activate ⇒ không vẽ nút, nêu tên quyền", () => {
    render(<TrinhSoan {...daLuu({ coQuyenKichHoat: false })} />);
    expect(screen.queryByRole("button", { name: /Kích hoạt…/ })).toBeNull();
    expect(screen.getByText(/commission_policies:activate/)).toBeTruthy();
  });

  it("[NHH-FE-07r] hàng rào còn ✕ ⇒ nút TẮT + lý do cạnh nút (aria-describedby); thanh bên hiện lỗi", () => {
    render(<TrinhSoan {...daLuu({ hangRaoDau: { loi: [{ ma: "VAN_BAN_THIEU", thongBao: "Văn bản thiếu: coTep." }], canhBao: [], somNhat: "2026-03-23" } })} />);
    const b = nut(/Kích hoạt…/);
    expect(b.disabled).toBe(true);
    expect(document.getElementById(b.getAttribute("aria-describedby")!)?.textContent).toMatch(/Còn 1 điều kiện chưa đạt/);
    expect(screen.getByText("Văn bản thiếu: tệp đính kèm.")).toBeTruthy();
  });

  it("[NHH-FE-07s] sửa sau lần lưu cuối ⇒ nút TẮT, lý do 'lưu nháp để kiểm lại', và thanh bên nhắc kết quả là của bản đã lưu", () => {
    render(<TrinhSoan {...daLuu({ buocDau: "hieu-luc" })} />);
    fireEvent.change(o("lyDo"), { target: { value: "đổi lý do" } });
    expect(screen.getByText(/có thay đổi chưa lưu/)).toBeTruthy();
    expect(screen.getByText(/Kết quả bên dưới là của bản đã lưu/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Kích hoạt$/ }));
    const b = nut(/Kích hoạt…/);
    expect(b.disabled).toBe(true);
    expect(document.getElementById(b.getAttribute("aria-describedby")!)?.textContent).toMatch(/sửa sau lần lưu cuối/);
  });

  it("[NHH-FE-07t] đủ điều kiện: nút sáng; hộp thoại tóm tắt + nút xác nhận nói ĐÚNG ngày; xác nhận gọi kichHoatAction đúng versionId rồi sang trang chi tiết", async () => {
    A.kich.mockResolvedValue({ ok: true, canhBao: [] });
    render(<TrinhSoan {...daLuu()} />);
    const b = nut(/Kích hoạt…/);
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    const hop = await screen.findByRole("dialog");
    // hộp thoại được portal ra ngoài `.admin-scope` ⇒ phải tự mang class, nếu không `bg-primary` rơi về CAM toàn cục (đã chụp được 08/10)
    expect(hop.className).toContain("admin-scope");
    expect(within(hop).getByText("Kích hoạt chính sách này?")).toBeTruthy();
    expect(within(hop).getByText("SR.QD.300/HV — Hoa hồng học viên mới")).toBeTruthy();
    expect(within(hop).getByText("Sale (người chốt đơn) 4% · Quản lý cơ sở 2%")).toBeTruthy();
    fireEvent.click(within(hop).getByRole("button", { name: "Kích hoạt từ 23/03/2026" }));
    await waitFor(() => expect(A.kich).toHaveBeenCalledWith({ versionId: "v1", xacNhanLyDo: null, updatedAtDaThay: "2026-10-08T03:00:00.000Z" }));
    await waitFor(() => expect(R.push).toHaveBeenCalledWith("/nguon-hoa-hong/chinh-sach/p1"));
  });

  it("[NHH-FE-07u] có CẢNH BÁO: hộp thoại đòi lý do ≥ 10 ký tự (nút xác nhận tắt tới lúc đủ), và gửi lý do đã cắt khoảng trắng", async () => {
    A.kich.mockResolvedValue({ ok: true, canhBao: [] });
    render(<TrinhSoan {...daLuu({ hangRaoDau: { loi: [], canhBao: [{ ma: "UNKNOWN_TANG", thongBao: "Mức nguồn không rõ tăng" }], somNhat: "2026-03-23" } })} />);
    fireEvent.click(nut(/Kích hoạt…/));
    const hop = await screen.findByRole("dialog");
    const xn = within(hop).getByRole("button", { name: "Kích hoạt từ 23/03/2026" }) as HTMLButtonElement;
    expect(xn.disabled).toBe(true);
    const ly = within(hop).getByLabelText(/Lý do xác nhận cảnh báo/);
    fireEvent.change(ly, { target: { value: "ngắn" } });
    expect(xn.disabled).toBe(true);
    // Cấy 08/10 (rà soát độc lập): bỏ `.trim()` ở ô xác nhận XANH — 9 ký tự chữ + khoảng trắng đệm (dài 15 thô) lọt qua. Server cắt khoảng trắng
    // rồi mới đo (`xacNhan.length < 10`), nên ô PHẢI đo sau cắt, và 10 ký tự chữ là đủ (biên).
    fireEvent.change(ly, { target: { value: "   123456789   " } });
    expect(xn.disabled).toBe(true);
    fireEvent.change(ly, { target: { value: "1234567890" } });
    expect(xn.disabled).toBe(false);
    fireEvent.change(ly, { target: { value: "  BLĐ chấp nhận mức mới  " } });
    expect(xn.disabled).toBe(false);
    fireEvent.click(xn);
    await waitFor(() => expect(A.kich).toHaveBeenCalledWith({ versionId: "v1", xacNhanLyDo: "BLĐ chấp nhận mức mới", updatedAtDaThay: "2026-10-08T03:00:00.000Z" }));
  });

  it("[NHH-FE-07v] máy chủ chặn kích hoạt (hàng rào đổi giữa chừng): hộp thoại đóng, thanh bên cập nhật lỗi mới, KHÔNG chuyển trang", async () => {
    A.kich.mockResolvedValue({ ok: false, loi: [], chung: "Không kích hoạt được — còn điều kiện chưa đạt.", hangRao: { loi: [{ ma: "VUOT_TRAN", thongBao: "Vượt trần ở CS1" }], canhBao: [], somNhat: null } });
    render(<TrinhSoan {...daLuu()} />);
    fireEvent.click(nut(/Kích hoạt…/));
    const hop = await screen.findByRole("dialog");
    fireEvent.click(within(hop).getByRole("button", { name: "Kích hoạt từ 23/03/2026" }));
    await screen.findByText("Vượt trần ở CS1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(R.push).not.toHaveBeenCalled();
    expect(nut(/Kích hoạt…/).disabled).toBe(true);
    // Hộp thoại đã đóng thì lý do KHÔNG được biến mất theo: dưới 1280px thanh hàng rào nằm ngoài tầm nhìn, nên phản hồi phải tới tận người bấm.
    expect(T.error).toHaveBeenCalledWith("Không kích hoạt được — còn điều kiện chưa đạt.");
  });

  it("[NHH-FE-07v2] nháp bị người khác sửa sau khi xem (VERSION_DA_DOI, không kèm hàng rào): lý do hiện qua toast — không nuốt im lặng", async () => {
    A.kich.mockResolvedValue({ ok: false, loi: [], chung: "Nháp vừa được sửa sau khi bạn xem — tải lại để duyệt đúng nội dung hiện tại." });
    render(<TrinhSoan {...daLuu()} />);
    fireEvent.click(nut(/Kích hoạt…/));
    const hop = await screen.findByRole("dialog");
    fireEvent.click(within(hop).getByRole("button", { name: "Kích hoạt từ 23/03/2026" }));
    await waitFor(() => expect(T.error).toHaveBeenCalledWith("Nháp vừa được sửa sau khi bạn xem — tải lại để duyệt đúng nội dung hiện tại."));
    expect(R.push).not.toHaveBeenCalled();
  });
});

describe("[NHH-FE-07] chế độ chỉ đọc", () => {
  it("[NHH-FE-07w] phiên bản đã kích hoạt: mọi ô nhập disabled, không có nút Lưu nháp, có 'Tạo phiên bản mới' và lý do khoá", () => {
    render(<TrinhSoan {...daLuu({ khoa: { lyDo: "Phiên bản v1 đang ở trạng thái “Đang áp dụng” — không sửa được." }, buocDau: "boi-canh" })} />);
    expect(screen.getByText(/không sửa được/)).toBeTruthy();
    expect(o("policyCode").closest("fieldset")!.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Lưu nháp" })).toBeNull();
    expect(screen.getByRole("link", { name: "Tạo phiên bản mới" }).getAttribute("href")).toBe("/nguon-hoa-hong/chinh-sach/p1/soan");
  });

  it("[NHH-FE-07x] chỉ đọc vẫn đi lại giữa các bước được (xem), không bị chặn bởi kiểm hợp lệ", () => {
    render(<TrinhSoan {...daLuu({ khoa: { lyDo: "khoá" }, formDau: formRong(), buocDau: "boi-canh" })} />);
    fireEvent.click(nut("Tiếp"));
    expect(buocHienTai()).toMatch(/Bước 2\/7/);
  });

  it("[NHH-FE-07y] không có quyền soạn nhưng CÓ quyền kích hoạt trên bản nháp đủ điều kiện: ô khoá, không nút Lưu, nút Kích hoạt vẫn sáng", () => {
    render(<TrinhSoan {...daLuu({ coQuyenSoan: false, coQuyenKichHoat: true })} />);
    expect(screen.queryByRole("button", { name: "Lưu nháp" })).toBeNull();
    expect(nut(/Kích hoạt…/).disabled).toBe(false);
  });

  it("[NHH-FE-07z] chính sách đã tồn tại: mã/tên/chủ sở hữu khoá (bất biến giữa các phiên bản)", () => {
    render(<TrinhSoan {...daLuu({ buocDau: "boi-canh" })} />);
    expect(o("policyCode").disabled).toBe(true);
    expect(o("name").disabled).toBe(true);
  });
});

describe("[NHH-FE-08] huỷ bản nháp", () => {
  // Cấy 08/10 (rà soát độc lập): ba phép XANH 1221/1221 — gửi lý do RỖNG (server từ chối `Phải có lý do huỷ nháp`), hiện nút Huỷ khi đang TẠO MỚI,
  // và (ca 07t2 bên trên) nút xác nhận in ngày KẾT THÚC. Nút "Huỷ bản nháp" chưa từng được bấm trong bộ test nào.
  it("[NHH-FE-08a] sửa nháp: 'Huỷ bản nháp' gọi huyNhapAction đúng versionId + lý do KHÔNG rỗng; thành công ⇒ toast + về trang chi tiết", async () => {
    A.huy.mockResolvedValue({ ok: true });
    render(<TrinhSoan {...daLuu({ buocDau: "boi-canh" })} />);
    fireEvent.click(nut("Huỷ bản nháp"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Huỷ bản nháp" }));
    await waitFor(() => expect(A.huy).toHaveBeenCalledTimes(1));
    const goi = A.huy.mock.calls[0]![0] as { versionId: string; lyDo: string };
    expect(goi.versionId).toBe("v1");
    expect(goi.lyDo.trim().length).toBeGreaterThan(0);
    await waitFor(() => expect(R.push).toHaveBeenCalledWith("/nguon-hoa-hong/chinh-sach/p1"));
    expect(T.success).toHaveBeenCalledWith("Đã huỷ bản nháp");
  });

  it("[NHH-FE-08b] máy chủ từ chối huỷ ⇒ toast lỗi nguyên văn, KHÔNG chuyển trang", async () => {
    A.huy.mockResolvedValue({ ok: false, loi: [], chung: "Version vừa đổi trạng thái." });
    render(<TrinhSoan {...daLuu({ buocDau: "boi-canh" })} />);
    fireEvent.click(nut("Huỷ bản nháp"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Huỷ bản nháp" }));
    await waitFor(() => expect(T.error).toHaveBeenCalledWith("Version vừa đổi trạng thái."));
    expect(R.push).not.toHaveBeenCalled();
    expect(T.success).not.toHaveBeenCalled();
  });

  it("[NHH-FE-08d] huỷ nháp là việc KHÔNG đảo ngược ⇒ bấm lần đầu chỉ mở hộp xác nhận (nêu hậu quả, cảnh báo thay đổi chưa lưu); 'Huỷ' đóng hộp mà không gọi action", async () => {
    // Cấy 08/10: `huyBanNhap` gọi action ngay khi bấm nút — một cú chạm nhầm cạnh 'Quay lại' xoá bản nháp và mọi thứ đã gõ.
    render(<TrinhSoan {...daLuu({ buocDau: "boi-canh" })} />);
    fireEvent.change(o("description"), { target: { value: "đã gõ dở" } });
    fireEvent.click(nut("Huỷ bản nháp"));
    const hop = await screen.findByRole("dialog");
    expect(A.huy).not.toHaveBeenCalled();
    expect(within(hop).getByText(/Huỷ bản nháp v1\?/)).toBeTruthy();
    expect(within(hop).getByText(/không khôi phục được/i)).toBeTruthy();
    expect(within(hop).getByText(/thay đổi chưa lưu/i)).toBeTruthy();
    fireEvent.click(within(hop).getByRole("button", { name: "Huỷ" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(A.huy).not.toHaveBeenCalled();
    expect(R.push).not.toHaveBeenCalled();
  });

  it("[NHH-FE-08c] đang TẠO MỚI: không có nút Huỷ trước lần lưu đầu, và vẫn không có ngay sau lần lưu đầu (chưa chuyển trang)", async () => {
    A.luu.mockResolvedValue({ ok: true, policyId: "p9", versionId: "v9", versionNo: 1, vanBanId: "d1", updatedAt: "2026-10-08T03:05:00.000Z", hangRao: OK });
    render(<TrinhSoan {...moi({ formDau: formDu(), buocDau: "hieu-luc" })} />);
    expect(screen.queryByRole("button", { name: "Huỷ bản nháp" })).toBeNull();
    fireEvent.click(nut("Lưu nháp"));
    await waitFor(() => expect(R.replace).toHaveBeenCalled());
    expect(screen.getByText(/Đã lưu v1/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Huỷ bản nháp" })).toBeNull();
  });

  it("[NHH-FE-07t2] có ngày kết thúc: nút xác nhận vẫn nói ngày BẮT ĐẦU hiệu lực; tóm tắt nói 'đến hết …'", async () => {
    // Cấy 08/10: `ngayNut: ngayDMY(f.hieuLucDen || f.hieuLucTu)` XANH — fixture 07t không có ngày kết thúc nên hai vế cho cùng một chữ.
    render(<TrinhSoan {...daLuu({ formDau: formDu({ hieuLucDen: "2026-12-31" }) })} />);
    fireEvent.click(nut(/Kích hoạt…/));
    const hop = await screen.findByRole("dialog");
    expect(within(hop).getByRole("button", { name: "Kích hoạt từ 23/03/2026" })).toBeTruthy();
    expect(within(hop).getByText("từ 23/03/2026 đến hết 31/12/2026")).toBeTruthy();
  });
});

describe("[NHH-FE-09] bàn phím & trình đọc màn hình", () => {
  it("[NHH-FE-09a] bấm 'Không trả hoa hồng' / 'Bỏ loại trừ' bằng bàn phím: focus KHÔNG rơi về <body> (React tái dùng đúng nút ở vị trí đó); nhãn nút đổi theo trạng thái", () => {
    // Một phát hiện review nói focus rơi về <body>; đo thật thì KHÔNG: hai nhánh render cùng kiểu `div > [..., button]` nên React giữ nguyên nút DOM.
    // Ca này ghim kết quả đo — nếu ai bọc nút trong `key`/phần tử khác kiểu thì focus mới rơi, và đây là chỗ đỏ.
    render(<TrinhSoan {...moi({ formDau: formDu(), buocDau: "cach-tinh" })} />);
    const ban = screen.getByRole("button", { name: /Không trả hoa hồng: Sale/ });
    ban.focus();
    fireEvent.click(ban);
    const bo = screen.getByRole("button", { name: /Bỏ loại trừ: Sale/ });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(bo);
    fireEvent.click(bo);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Không trả hoa hồng: Sale/ }));
  });

  it("[NHH-FE-09b] chuyển bước: focus sang tiêu đề bước mới (tabIndex -1) để trình đọc màn hình đọc 'Bước N/7'; vừa mở trang thì KHÔNG cướp focus", async () => {
    render(<TrinhSoan {...moi({ formDau: formDu(), buocDau: "boi-canh" })} />);
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(nut("Tiếp"));
    const tieuDe = screen.getByRole("heading", { level: 2, name: /Bước 2\/7/ });
    await waitFor(() => expect(document.activeElement).toBe(tieuDe));
    expect(tieuDe.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(nut("Quay lại"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: /Bước 1\/7/ })));
  });

  it("[NHH-FE-09c] bước lỗi vẫn thắng: 'Tiếp' trên form trống focus vào Ô LỖI chứ không vào tiêu đề", () => {
    render(<TrinhSoan {...moi()} />);
    fireEvent.click(nut("Tiếp"));
    expect(document.activeElement).toBe(o("policyCode"));
  });

  it("[NHH-FE-09d] lỗi của ô tỉ lệ là vùng role=alert (trình đọc màn hình đọc ra khi nó xuất hiện), không chỉ aria-describedby", () => {
    render(<TrinhSoan {...moi({ formDau: formDu(), buocDau: "cach-tinh" })} />);
    expect(screen.queryAllByRole("alert").length).toBe(0);
    fireEvent.change(o("o.NEW|SALE"), { target: { value: "abc" } });
    const canhBao = screen.getAllByRole("alert");
    expect(canhBao.length).toBe(1);
    expect(canhBao[0]!.id).toBe(o("o.NEW|SALE").getAttribute("aria-describedby"));
  });

  it("[NHH-FE-09e] lỗi tệp đính kèm từ máy chủ hiện CẠNH ô tệp (role=alert) và focus tới đó", async () => {
    const vb = { kieu: "moi" as const, documentCode: "SR.QD.1", title: "T", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23", approvedByName: "X", tep: { key: "zzz", ten: "zzz", url: "javascript:alert(1)" } };
    A.luu.mockResolvedValue({ ok: false, loi: [{ truong: "vanBan.tep", thongBao: "Tệp đính kèm không hợp lệ — hãy chọn lại tệp từ máy của bạn.", buoc: "van-ban" }], chung: null });
    render(<TrinhSoan {...moi({ formDau: formDu({ vanBan: vb }), buocDau: "van-ban" })} />);
    fireEvent.click(nut("Lưu nháp"));
    const loi = await screen.findByText(/Tệp đính kèm không hợp lệ/);
    expect(loi.getAttribute("role")).toBe("alert");
    await waitFor(() => expect(document.activeElement).toBe(o("vanBan.tep")));
  });
});

describe("[NHH-FE-06] bước Thử tính: không số giả", () => {
  it("tính ví dụ đúng (4% × 10.000.000 = 400.000đ); CHƯA chạy thử trên dữ liệu thật ⇒ không có số 'tác động' nào, nút Chạy thử tắt kèm lý do (chưa lưu)", async () => {
    render(<TrinhSoan {...moi({ formDau: formDu(), buocDau: "thu-tinh" })} />);
    expect(screen.getByText("400.000đ")).toBeTruthy();
    expect(screen.getByText("200.000đ")).toBeTruthy();
    expect(nut("Chạy thử").disabled).toBe(true);
    expect(screen.getByText(/Lưu nháp trước: thử tính chạy trên bản đã lưu/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/tác động ước tính \d/i);
    expect(A.thu).not.toHaveBeenCalled();
  });
});

void act;
