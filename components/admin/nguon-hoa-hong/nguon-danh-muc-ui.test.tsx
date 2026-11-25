// @vitest-environment jsdom
/**
 * [NDM-*] Bảng "Tất cả nguồn" CÓ THAO TÁC (BangNguon) + hộp thoại đổi trạng thái (NutDoiTrangThai) — trên PHẦN TỬ THẬT (jsdom), hàm gọi máy chủ được TIÊM.
 *
 *   [NDM-01] cột: nhóm nguồn · hoa hồng nguồn · cửa sổ (RIÊNG hay MẶC ĐỊNH) · trạng thái («Ngoài hiệu lực» thay «Đang dùng» khi ACTIVE ∧ chọn được ∧ ngoài hiệu lực; KHÔNG báo động giả cho nguồn hệ thống gán)
 *   [NDM-02] nút ghi theo quyền (luật 12): coTheGhi=false ⇒ KHÔNG Sửa/Đổi trạng thái/cột Thao tác; coTheGhi=true ⇒ THẤY (đối chứng dương); KHÔNG BAO GIỜ có nút xoá
 *   [NDM-03] nút trạng thái nói thật: nguồn hệ thống không có «Lưu trữ», UNKNOWN / đích mặc định chỉ «Vì sao cố định?»
 *   [NDM-04] hộp thoại: lý do ≥ 10 ký tự chỉ khi cổng đòi; gọi ĐÚNG (id, mốc khoá lạc quan, trạng thái đích, lý do); «vừa đổi» ⇒ banner + Tải lại
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương "ca kia THẤY X" (CLAUDE.md luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions", () => ({
  taoNguonAction: vi.fn(),
  suaNguonAction: vi.fn(),
  doiTrangThaiNguonAction: vi.fn(),
  luuPageMappingAction: vi.fn(),
}));

import type { DongDanhMucNguonMo } from "@/lib/nguon/doc-danh-muc";
import type { KetQuaDoiTrangThaiAction } from "@/lib/nguon/ket-qua-action";
import { BangNguon } from "../../../app/(admin)/admin/nguon-hoa-hong/nguon/_components/bang-nguon";
import { NutDoiTrangThai, type NguonDeDoiTrangThai } from "./doi-trang-thai-nguon";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const NOW_ISO = "2026-10-09T03:00:00.000Z";

const dong = (p: Partial<DongDanhMucNguonMo> & Pick<DongDanhMucNguonMo, "id" | "code" | "name">): DongDanhMucNguonMo => ({
  documentNo: null,
  description: null,
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  isSystem: false,
  sortOrder: 100,
  status: "ACTIVE",
  sourceType: "MARKETING",
  commissionEnabled: false,
  attributionWindowDays: null,
  effectiveFrom: null,
  effectiveTo: null,
  chonDuoc: true,
  capNhatLuc: "2026-10-09T02:00:00.000Z",
  soLead30Ngay: 0,
  soLeadTong: 0,
  ownerEmployeeId: null,
  chinhSachRieng: false,
  ruleChuChay: false,
  ...p,
});

const DONG: DongDanhMucNguonMo[] = [
  dong({ id: "g-tiktok", code: "TIKTOK_ADS", name: "TikTok Ads", commissionEnabled: true, attributionWindowDays: 45 }),
  dong({ id: "g-nhap", code: "NHAP_THU", name: "Nguồn nháp", status: "DRAFT", chonDuoc: false, sourceType: "PARTNER" }),
  dong({ id: "g-het", code: "SU_KIEN_CU", name: "Sự kiện cũ", sourceType: "EVENT", chonDuoc: false, effectiveTo: "2026-02-01T00:00:00.000Z" }),
  dong({ id: "g-walk", code: "WALK_IN", name: "Khách tự đến", isSystem: true, sourceType: "OFFLINE", documentNo: 4 }),
  // Thực tế UNKNOWN: ACTIVE nhưng `selectable=false` ⇒ `chonDuoc=false` — KHÔNG phải «ngoài hiệu lực» (hệ thống gán, không ai chọn)
  dong({ id: "g-unk", code: "UNKNOWN", name: "Không rõ nguồn", isSystem: true, sourceType: "SYSTEM", selectable: false, chonDuoc: false }),
  dong({ id: "g-ads", code: "PAID_ADS", name: "Nguồn từ Quảng Cáo", isSystem: true, documentNo: 2, commissionEnabled: true }),
  dong({ id: "g-luutru", code: "CU_KY", name: "Nguồn lưu trữ", status: "ARCHIVED", chonDuoc: false }),
];

const bang = (coTheGhi: boolean, dichMacDinh: string[] = ["PAID_ADS", "UNKNOWN"], dong: DongDanhMucNguonMo[] = DONG, coQuyenKichHoat = true) =>
  render(<BangNguon dong={dong} cuaSoMacDinhNgay={90} coTheGhi={coTheGhi} coQuyenKichHoat={coQuyenKichHoat} dichMacDinh={dichMacDinh} nowIso={NOW_ISO} />);

// Dòng phụ dưới tên nguồn là «<số văn bản> · <mã>» (hoặc chỉ «<mã>») ⇒ khớp phần đuôi.
const hang = (ma: string) => screen.getByText(new RegExp(`(^|· )${ma}$`), { selector: "span.font-mono" }).closest("tr") as HTMLElement;

describe("[NDM-01] BangNguon — cột phản ánh dữ liệu thật", () => {
  it("nhóm nguồn bằng chữ; hoa hồng nguồn Có/Không; cửa sổ RIÊNG «45 ngày / Riêng» và MẶC ĐỊNH «90 ngày / Mặc định» (nói cái nào); tiêu đề cột là «Hoa hồng nguồn» ĐẦY ĐỦ (rút thành «Hoa hồng» thì «Không» đọc như «không ai được hoa hồng»)", () => {
    bang(false);
    expect(screen.getByRole("columnheader", { name: "Hoa hồng nguồn" })).toBeTruthy();
    const tt = within(hang("TIKTOK_ADS"));
    expect(tt.getByText("Quảng cáo")).toBeTruthy();
    expect(tt.getByText("Có")).toBeTruthy();
    expect(Array.from(hang("TIKTOK_ADS").querySelectorAll("td"))[2]!.textContent?.trim()).toBe("45 ngàyRiêng");
    const w = within(hang("WALK_IN"));
    expect(w.getByText("Tại trung tâm")).toBeTruthy();
    expect(Array.from(hang("WALK_IN").querySelectorAll("td"))[2]!.textContent?.trim()).toBe("90 ngàyMặc định");
    // 7 cột: [Nguồn, Nhóm nguồn, Cửa sổ, Hoa hồng nguồn, Trạng thái, Lead, Thao tác] — «Không» còn có thể xuất hiện ở dòng phụ nơi khác ⇒ chọn đúng ô theo vị trí cột
    const o = Array.from(hang("WALK_IN").querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(o[3]).toBe("Không");
    expect(Array.from(hang("TIKTOK_ADS").querySelectorAll("td"))[3]!.textContent?.trim()).toBe("Có");
    // dòng phụ của cột nhóm nói người nhập phải chọn thêm gì
    expect(within(hang("WALK_IN")).getByText("Không yêu cầu thêm")).toBeTruthy();
    // «Lead»: TỔNG là số chính, 30 ngày là dòng phụ (hai số khác nhau — đảo là đỏ)
    const lead = Array.from(hang("TIKTOK_ADS").querySelectorAll("td"))[5]!;
    expect(Array.from(lead.querySelectorAll("span")).map((x) => x.textContent)).toEqual(["0", "0 trong 30 ngày"]);
    expect(within(hang("NHAP_THU")).getByText("Đối tác")).toBeTruthy();
    expect(within(hang("UNKNOWN")).getByText("Hệ thống")).toBeTruthy();
  });

  it("«Ngoài hiệu lực» THAY «Đang dùng» cho dòng ACTIVE chọn được mà hết hạn — KHÔNG hiện cho dòng trong hiệu lực (đối chứng), nháp / lưu trữ, và nguồn hệ thống gán (UNKNOWN: selectable=false)", () => {
    bang(false);
    expect(within(hang("SU_KIEN_CU")).getByText("Ngoài hiệu lực")).toBeTruthy();
    expect(within(hang("SU_KIEN_CU")).queryByText("Đang dùng")).toBeNull();
    expect(within(hang("TIKTOK_ADS")).queryByText("Ngoài hiệu lực")).toBeNull();
    expect(within(hang("TIKTOK_ADS")).getByText("Đang dùng")).toBeTruthy();
    expect(within(hang("NHAP_THU")).queryByText("Ngoài hiệu lực")).toBeNull();
    expect(within(hang("NHAP_THU")).getByText("Nháp")).toBeTruthy();
    expect(within(hang("CU_KY")).queryByText("Ngoài hiệu lực")).toBeNull();
    expect(within(hang("CU_KY")).getByText("Lưu trữ")).toBeTruthy();
    expect(within(hang("UNKNOWN")).queryByText("Ngoài hiệu lực")).toBeNull();
    expect(within(hang("UNKNOWN")).getByText("Đang dùng")).toBeTruthy();
  });

  it("nguồn đã ngừng / lưu trữ / nháp VẪN được liệt kê và mở được chi tiết", () => {
    bang(false);
    for (const ma of ["NHAP_THU", "CU_KY"]) {
      const link = within(hang(ma)).getAllByRole("link")[0]!;
      expect(link.getAttribute("href")).toBe(`/nguon-hoa-hong/nguon/${ma}`);
    }
  });
});

describe("[NDM-02] nút ghi vẽ theo quyền — đối chứng dương", () => {
  it("coTheGhi=false ⇒ KHÔNG nút «Sửa», KHÔNG «Đổi trạng thái», KHÔNG cột «Thao tác»", () => {
    bang(false);
    expect(screen.queryByRole("link", { name: /^Sửa nguồn/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Đổi trạng thái|Vì sao/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Thao tác" })).toBeNull();
  });

  it("coTheGhi=true ⇒ THẤY cột «Thao tác», mỗi dòng có «Sửa» dẫn tới /<mã>/sua và nút trạng thái", () => {
    bang(true);
    expect(screen.getByRole("columnheader", { name: "Thao tác" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sửa nguồn TikTok Ads" }).getAttribute("href")).toBe("/nguon-hoa-hong/nguon/TIKTOK_ADS/sua");
    expect(screen.getByRole("link", { name: "Sửa nguồn Khách tự đến" }).getAttribute("href")).toBe("/nguon-hoa-hong/nguon/WALK_IN/sua");
    expect(screen.getAllByRole("link", { name: /^Sửa nguồn/ })).toHaveLength(DONG.length);
    expect(screen.getByRole("button", { name: "Đổi trạng thái: nguồn TikTok Ads" })).toBeTruthy();
  });

  it("KHÔNG BAO GIỜ có nút xoá — kể cả người có đủ quyền (danh mục chỉ lưu trữ)", () => {
    bang(true);
    expect(screen.queryByRole("button", { name: /xoá|xóa|delete/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /xoá|xóa|delete/i })).toBeNull();
  });
});

describe("[NDM-06] ô Thao tác chỉ có BIỂU TƯỢNG nhưng nút vẫn nói tên việc (bảng vừa khít 976px; icon-only phải có tên truy cập)", () => {
  it("mỗi nút trong ô Thao tác: không chữ hiển thị, có tên truy cập + title; nút ĐỔI TRẠNG THÁI ngoài bảng (trang chi tiết) vẫn là nút CHỮ", () => {
    bang(true);
    const sua = screen.getByRole("link", { name: "Sửa nguồn TikTok Ads" });
    expect(sua.textContent).toBe("");
    expect(sua.getAttribute("title")).toBe("Sửa nguồn");
    const doi = screen.getByRole("button", { name: "Đổi trạng thái: nguồn TikTok Ads" });
    expect(doi.textContent).toBe("");
    expect(doi.getAttribute("title")).toBe("Đổi trạng thái");
    const co = screen.getByRole("button", { name: "Vì sao không đổi trạng thái được: nguồn Nguồn từ Quảng Cáo" });
    expect(co.textContent).toBe("");
    cleanup();
    // đối chứng: dùng ngoài bảng (không truyền bieuTuong) ⇒ nút CHỮ, như trang chi tiết đang dựa vào
    render(<NutDoiTrangThai nguon={{ id: "g1", code: "TIKTOK_ADS", name: "TikTok Ads", status: "ACTIVE", isSystem: false, capNhatLuc: "2026-10-09T02:00:00.123Z", ownerEmployeeId: null, chinhSachRieng: false, ruleChuChay: false }} dichMacDinh={[]} coQuyenKichHoat nowIso={NOW_ISO} doi={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Đổi trạng thái: nguồn TikTok Ads" }).textContent).toBe("Đổi trạng thái");
  });
});

describe("[NDM-03] nút trạng thái nói thật", () => {
  it("nguồn hệ thống (WALK_IN) vẫn Ngừng được; nguồn là ĐÍCH MẶC ĐỊNH (PAID_ADS) và UNKNOWN chỉ có «Vì sao cố định?»; nháp / lưu trữ có nút", () => {
    bang(true);
    expect(within(hang("WALK_IN")).getByRole("button", { name: /^Đổi trạng thái/ })).toBeTruthy();
    expect(within(hang("PAID_ADS")).queryByRole("button", { name: /^Đổi trạng thái/ })).toBeNull();
    expect(within(hang("PAID_ADS")).getByRole("button", { name: /^Vì sao không đổi trạng thái được/ })).toBeTruthy();
    expect(within(hang("UNKNOWN")).queryByRole("button", { name: /^Đổi trạng thái/ })).toBeNull();
    expect(within(hang("UNKNOWN")).getByRole("button", { name: /^Vì sao không đổi trạng thái được/ })).toBeTruthy();
    expect(within(hang("NHAP_THU")).getByRole("button", { name: /^Đổi trạng thái/ })).toBeTruthy();
    expect(within(hang("CU_KY")).getByRole("button", { name: /^Đổi trạng thái/ })).toBeTruthy();
  });
});

const nguon = (p: Partial<NguonDeDoiTrangThai> = {}): NguonDeDoiTrangThai => ({
  id: "g1",
  code: "TIKTOK_ADS",
  name: "TikTok Ads",
  status: "ACTIVE",
  isSystem: false,
  capNhatLuc: "2026-10-09T02:00:00.123Z",
  ownerEmployeeId: null,
  chinhSachRieng: false,
  ruleChuChay: false,
  ...p,
});
const ok = (den: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED"): KetQuaDoiTrangThaiAction => ({ ok: true, den, updatedAt: "2026-10-09T03:00:00.000Z" });
const moHopThoai = (n: NguonDeDoiTrangThai, doi = vi.fn(), dich: string[] = [], coQuyenKichHoat = true) => {
  render(<NutDoiTrangThai nguon={n} dichMacDinh={dich} coQuyenKichHoat={coQuyenKichHoat} nowIso={NOW_ISO} doi={doi} />);
  fireEvent.click(screen.getByRole("button", { name: /Đổi trạng thái|Vì sao/ }));
  return doi;
};
const LY_DO = "Chủ dự án chốt ngày 09/10";

describe("[NDM-05] hộp thoại là PORTAL ngoài khung admin", () => {
  it("panel mang CHÍNH class `admin-scope` — không thì `--primary` rơi về CAM của :root và nút xác nhận hiện cam (đo trên ảnh chụp 09/10)", () => {
    moHopThoai(nguon(), vi.fn());
    expect(screen.getByRole("dialog").className.split(" ")).toContain("admin-scope");
  });
});

describe("[NDM-04] hộp thoại đổi trạng thái", () => {
  it("ACTIVE → Ngừng: lý do BẮT BUỘC — bỏ trống / ngắn ⇒ lỗi cạnh ô, KHÔNG gọi máy chủ; đủ ⇒ gọi ĐÚNG (id, mốc khoá lạc quan, đích, lý do đã trim)", async () => {
    const doi = vi.fn(async () => ok("INACTIVE"));
    moHopThoai(nguon(), doi);
    expect(screen.getByRole("radio", { name: /Ngừng/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Lưu trữ/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Ngừng/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ngừng" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/10 ký tự/);
    expect(doi).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "ngắn" } });
    fireEvent.click(screen.getByRole("button", { name: "Ngừng" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/10 ký tự/);
    expect(doi).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: `  ${LY_DO}  ` } });
    fireEvent.click(screen.getByRole("button", { name: "Ngừng" }));
    await waitFor(() => expect(doi).toHaveBeenCalledTimes(1));
    expect(doi).toHaveBeenCalledWith({ id: "g1", updatedAtDaThay: "2026-10-09T02:00:00.123Z", den: "INACTIVE", lyDo: LY_DO });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
    expect(TOAST.success).toHaveBeenCalled();
  });

  it("chọn «Lưu trữ» gửi den=ARCHIVED (nút xác nhận mang đúng tên việc, không phải «Xác nhận» chung)", async () => {
    const doi = vi.fn(async () => ok("ARCHIVED"));
    moHopThoai(nguon(), doi);
    fireEvent.click(screen.getByRole("radio", { name: /Lưu trữ/ }));
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu trữ" }));
    await waitFor(() => expect(doi).toHaveBeenCalledWith(expect.objectContaining({ den: "ARCHIVED", lyDo: LY_DO })));
  });

  it("chưa chọn trạng thái đích ⇒ nhắc chọn, không gọi", async () => {
    const doi = moHopThoai(nguon());
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Chọn trạng thái muốn chuyển sang.");
    expect(doi).not.toHaveBeenCalled();
  });

  it("DRAFT → Kích hoạt: KHÔNG đòi lý do (nhãn «tuỳ chọn»); gửi lyDo=null khi để trống. ĐỐI CHỨNG: ACTIVE → Ngừng đòi lý do", async () => {
    const doi = vi.fn(async () => ok("ACTIVE"));
    moHopThoai(nguon({ status: "DRAFT" }), doi);
    // chỉ hai lựa chọn hợp lệ từ nháp: Kích hoạt, Lưu trữ
    fireEvent.click(screen.getByRole("radio", { name: /Kích hoạt/ }));
    expect(screen.getByLabelText(/Lý do \(tuỳ chọn\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Kích hoạt" }));
    await waitFor(() => expect(doi).toHaveBeenCalledWith({ id: "g1", updatedAtDaThay: "2026-10-09T02:00:00.123Z", den: "ACTIVE", lyDo: null }));
    cleanup();
    moHopThoai(nguon({ status: "ACTIVE" }), vi.fn());
    fireEvent.click(screen.getByRole("radio", { name: /Ngừng/ }));
    expect(screen.getByLabelText(/Lý do \(tối thiểu 10 ký tự\)/)).toBeTruthy();
  });

  it("nguồn hệ thống: không có lựa chọn «Lưu trữ» và hộp thoại NÓI LÝ DO bằng đúng câu của cổng ghi", () => {
    moHopThoai(nguon({ code: "WALK_IN", name: "Khách tự đến", isSystem: true }));
    expect(screen.queryByRole("radio", { name: /Lưu trữ/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Ngừng/ })).toBeTruthy();
    expect(screen.getByText(/Nguồn hệ thống không lưu trữ được\./)).toBeTruthy();
  });

  it("nguồn là ĐÍCH MẶC ĐỊNH: hộp thoại chỉ đọc — nói «trỏ cấu hình sang nguồn khác trước», KHÔNG có nút xác nhận", () => {
    moHopThoai(nguon({ code: "PAID_ADS", name: "Quảng cáo", isSystem: true }), vi.fn(), ["PAID_ADS"]);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/trỏ cấu hình sang nguồn khác trước/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Xác nhận|Ngừng|Lưu trữ/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Đóng" })).toBeTruthy();
  });

  it("máy chủ báo «vừa được người khác thay đổi» ⇒ banner + «Tải lại» (làm mới trang, đóng hộp thoại)", async () => {
    const doi = vi.fn(async (): Promise<KetQuaDoiTrangThaiAction> => ({ ok: false, error: "Nguồn vừa được người khác thay đổi — hãy tải lại rồi thử lại.", field: "vuaDoi" }));
    moHopThoai(nguon(), doi);
    fireEvent.click(screen.getByRole("radio", { name: /Ngừng/ }));
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: "Ngừng" }));
    expect((await screen.findByRole("alert")).textContent).toContain("vừa được người khác thay đổi");
    fireEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    expect(ROUTER.refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("lỗi máy chủ khác (vd. đích mặc định) hiện NGUYÊN VĂN trong hộp thoại, hộp thoại không tự đóng, không toast thành công", async () => {
    const doi = vi.fn(async (): Promise<KetQuaDoiTrangThaiAction> => ({ ok: false, error: "Nguồn này đang là nguồn MẶC ĐỊNH của quy nguồn — trỏ cấu hình sang nguồn khác trước.", field: "trangThai" }));
    moHopThoai(nguon(), doi);
    fireEvent.click(screen.getByRole("radio", { name: /Ngừng/ }));
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: "Ngừng" }));
    expect((await screen.findByRole("alert")).textContent).toContain("MẶC ĐỊNH của quy nguồn");
    expect(TOAST.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ngừng" })).toBeTruthy();
  });
});

describe("[NDM-07] nút trạng thái KHÔNG vẽ lựa chọn mà máy chủ chắc chắn từ chối (W2, res2 R2-M1)", () => {
  // Cấy: bỏ `ownerEmployeeId`/`ruleChuChay` khỏi dữ liệu nút ở `BangNguon` ⇒ ca a đỏ; bỏ `coQuyenKichHoat` khỏi `thaoTacTrangThai` ⇒ ca b đỏ.
  it("a. nguồn NHÁP chưa có người phụ trách + rule chủ-nguồn đang chạy ⇒ hộp thoại KHÔNG có lựa chọn «Kích hoạt», nói vì sao; «Lưu trữ» vẫn có", () => {
    moHopThoai(nguon({ status: "DRAFT", ownerEmployeeId: null, ruleChuChay: true }));
    expect(screen.queryByRole("radio", { name: /Kích hoạt/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Lưu trữ/ })).toBeTruthy();
    expect(screen.getByText(/Khai người phụ trách \(Sửa nguồn\) trước khi kích hoạt/)).toBeTruthy();
    cleanup();
    // đối chứng dương: cùng nguồn ĐÃ CÓ người phụ trách ⇒ có lựa chọn «Kích hoạt»
    moHopThoai(nguon({ status: "DRAFT", ownerEmployeeId: "emp-1", ruleChuChay: true }));
    expect(screen.getByRole("radio", { name: /Kích hoạt/ })).toBeTruthy();
  });

  it("b. nguồn có chính sách RIÊNG đang chạy + người xem THIẾU quyền kích hoạt ⇒ nút thành «Vì sao không đổi được?» nêu TÊN khoá; có quyền ⇒ đổi được", () => {
    moHopThoai(nguon({ chinhSachRieng: true }), vi.fn(), [], false);
    expect(screen.queryByRole("radio")).toBeNull();
    // hai việc cùng một lý do ⇒ MỘT dòng («Ngừng · Lưu trữ — …»), không lặp đoạn dài hai lần (chụp thật 10/10 thấy lặp)
    expect(screen.getAllByText(/commission_policies:activate/)).toHaveLength(1);
    expect(screen.getByText("Ngừng · Lưu trữ")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Xác nhận|Ngừng|Lưu trữ/ })).toBeNull();
    cleanup();
    moHopThoai(nguon({ chinhSachRieng: true }), vi.fn(), [], true);
    expect(screen.getByRole("radio", { name: /Ngừng/ })).toBeTruthy();
  });

  it("c. BẢNG danh sách mang đủ dữ liệu cho nút: dòng nháp chưa chủ + rule chạy ⇒ nút vẫn là «Đổi trạng thái» (còn «Lưu trữ»); dòng ACTIVE có chính sách riêng + thiếu quyền ⇒ «Vì sao…»", () => {
    const dongNhap = dong({ id: "g-nhap2", code: "NHAP_2", name: "Nháp hai", status: "DRAFT", chonDuoc: false, ruleChuChay: true });
    const dongDinh = dong({ id: "g-dinh", code: "DINH_TIEN", name: "Có chính sách", chinhSachRieng: true });
    bang(true, [], [dongNhap, dongDinh], false);
    expect(within(hang("NHAP_2")).getByRole("button", { name: /^Đổi trạng thái/ })).toBeTruthy();
    expect(within(hang("DINH_TIEN")).queryByRole("button", { name: /^Đổi trạng thái/ })).toBeNull();
    expect(within(hang("DINH_TIEN")).getByRole("button", { name: /^Vì sao không đổi trạng thái được/ })).toBeTruthy();
  });
});
