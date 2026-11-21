// @vitest-environment jsdom
/**
 * [AFF-FORM-*] — Biểu mẫu Tạo / Sửa campaign Affiliate trên PHẦN TỬ THẬT (jsdom); hàm lưu được TIÊM.
 *
 *   [AFF-FORM-01] TẠO: điền sẵn · xem trước mã · kiểm đầu vào cạnh ô (aria-invalid + role=alert) · gọi ĐÚNG · lỗi máy chủ cạnh ô
 *   [AFF-FORM-02] SỬA đang chạy: ô ảnh hưởng ghi nhận KHOÁ kèm lý do; tên / mô tả / hạn sửa được; chỉ gửi ô ĐÃ ĐỔI
 *   [AFF-FORM-03] SỬA tạm dừng: đổi tham số ⇒ lý do hiện ra và bắt buộc; nháp thì không đòi
 *   [AFF-FORM-04] khoá lạc quan & nút Lưu nói thật
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương "ca kia THẤY X" (CLAUDE.md luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions", () => ({ taoCampaignAction: vi.fn(), suaCampaignAction: vi.fn() }));

import type { TrangThaiCampaign } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { CampaignForm, type CampaignDeSua } from "./campaign-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOC = "2026-10-13T02:00:00.123Z";
const LY_DO = "Lý do đủ dài để qua cổng";
const NGUON = [
  { id: "s1", code: "DOI_TAC", ten: "Giới thiệu bởi đối tác", moTa: null },
  { id: "s2", code: "SU_KIEN", ten: "Sự kiện", moTa: null },
];

const camp = (status: TrangThaiCampaign, p: Partial<CampaignDeSua> = {}): CampaignDeSua => ({
  id: "c1",
  code: "TET_2027",
  status,
  capNhatLuc: MOC,
  name: "Giới thiệu Tết",
  description: null,
  attributionModel: "FIRST_VALID",
  cookieWindowDays: 30,
  protectWindowDays: 90,
  allowSelfReferral: false,
  partnerCanViewAmount: null,
  defaultSourceGroupId: "s1",
  effectiveFrom: "2026-09-30T17:00:00.000Z",
  effectiveTo: null,
  ...p,
});

const taoOk = { ok: true as const, id: "c9", code: "TET_2027", updatedAt: MOC };
const suaOk = { ok: true as const, doi: true, truongDoi: ["name" as const], updatedAt: MOC };

function tao(luuTao = vi.fn(async () => taoOk)) {
  render(<CampaignForm cheDo="tao" nguon={NGUON} luuTao={luuTao as never} />);
  return { luuTao };
}
function sua(status: TrangThaiCampaign, p: Partial<CampaignDeSua> = {}, luuSua = vi.fn(async () => suaOk), extra: { nguonMacDinhHong?: { id: string; ten: string; lyDo: string } } = {}) {
  render(<CampaignForm cheDo="sua" campaign={camp(status, p)} nguon={NGUON} luuSua={luuSua as never} {...extra} />);
  return { luuSua };
}
const nhap = (nhan: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(nhan), { target: { value } });

describe("[AFF-FORM-01] tạo campaign", () => {
  it("điền sẵn mặc định an toàn: mô hình «Người đầu tiên hợp lệ», cookie 30, bảo vệ 90, KHÔNG cho tự giới thiệu; mô hình SPLIT ghi «chưa dùng được»", () => {
    tao();
    expect((screen.getByRole("radio", { name: /Người đầu tiên hợp lệ/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Cửa sổ cookie (ngày)") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Thời gian bảo vệ (ngày)") as HTMLInputElement).value).toBe("90");
    expect((screen.getByRole("checkbox", { name: /tự giới thiệu/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("radio", { name: /Chia giữa nhiều người/ }).closest("label")?.textContent).toMatch(/chưa dùng được/);
  });

  it("[AFF-FORM-XT1] TẠO: «Số tiền hoa hồng ở cổng đối tác» mặc định «Theo cấp trên» (an toàn: loại chưa cài thì ẨN) và nói hệ quả của từng lựa chọn", () => {
    tao();
    const o = screen.getByLabelText("Số tiền hoa hồng ở cổng đối tác") as HTMLSelectElement;
    expect(o.value).toBe("THEO_CAP_TREN");
    expect(document.body.textContent).toMatch(/loại chưa cài thì ẨN/);
    nhap("Số tiền hoa hồng ở cổng đối tác", "HIEN");
    expect(document.body.textContent).toMatch(/kể cả khi loại của họ đang ẨN/);
    nhap("Số tiền hoa hồng ở cổng đối tác", "AN");
    expect(document.body.textContent).toMatch(/kể cả khi loại của họ đang HIỆN/);
  });

  it("nhãn nói rõ HỆ QUẢ của «tự giới thiệu» ở cả hai trạng thái", () => {
    tao();
    expect(document.body.textContent).toMatch(/Tắt \(nên giữ\): khách trùng với chính người giới thiệu/);
    fireEvent.click(screen.getByRole("checkbox", { name: /tự giới thiệu/ }));
    expect(document.body.textContent).toMatch(/Bật: khách trùng với chính người giới thiệu .* VẪN được tính công/);
  });

  it("gõ tên làm mã ⇒ xem trước mã chuẩn hoá (bỏ dấu, HOA, gạch dưới)", () => {
    tao();
    nhap("Mã campaign", "Tết 2027");
    expect(document.body.textContent).toContain("Mã sẽ là: TET_2027");
  });

  it("cookie 0 và bảo vệ 731 ⇒ lỗi CẠNH từng ô (aria-invalid + role=alert + aria-describedby), KHÔNG gọi máy chủ", async () => {
    const { luuTao } = tao();
    nhap("Tên campaign", "Giới thiệu Tết");
    nhap("Mã campaign", "tet-2027");
    nhap("Cửa sổ cookie (ngày)", "0");
    nhap("Thời gian bảo vệ (ngày)", "731");
    fireEvent.click(screen.getByRole("button", { name: "Tạo campaign" }));
    const ck = screen.getByLabelText("Cửa sổ cookie (ngày)");
    await waitFor(() => expect(ck.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByLabelText("Thời gian bảo vệ (ngày)").getAttribute("aria-invalid")).toBe("true");
    const loi = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(loi.some((t) => /Cửa sổ cookie phải từ 1 đến 365/.test(t ?? ""))).toBe(true);
    expect(loi.some((t) => /Thời gian bảo vệ phải từ 1 đến 730/.test(t ?? ""))).toBe(true);
    expect(ck.getAttribute("aria-describedby")).toMatch(/loi-cookieWindowDays/);
    expect(luuTao).not.toHaveBeenCalled();
    // lỗi tự xoá khi sửa ô — không đứng đó nói dối
    nhap("Cửa sổ cookie (ngày)", "45");
    expect(screen.getByLabelText("Cửa sổ cookie (ngày)").getAttribute("aria-invalid")).toBeNull();
  });

  it("tên rỗng và mã sai khuôn ⇒ lỗi cạnh ô; hết hạn không sau bắt đầu ⇒ lỗi cạnh ô «Hết hiệu lực»", async () => {
    const { luuTao } = tao();
    nhap("Mã campaign", "ab");
    nhap("Hiệu lực từ ngày", "2026-12-01");
    nhap("Hết hiệu lực vào ngày", "2026-11-01");
    fireEvent.click(screen.getByRole("button", { name: "Tạo campaign" }));
    await waitFor(() => expect(screen.getByLabelText("Tên campaign").getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByLabelText("Mã campaign").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Hết hiệu lực vào ngày").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/SAU ngày bắt đầu/);
    expect(luuTao).not.toHaveBeenCalled();
  });

  it("hợp lệ ⇒ gọi ĐÚNG (mã, ngày VN → ISO, số là số, chuỗi rỗng → null) rồi toast, điều hướng về chi tiết theo MÃ máy chủ trả", async () => {
    const { luuTao } = tao();
    nhap("Tên campaign", "  Giới thiệu Tết ");
    nhap("Mã campaign", "tết 2027");
    nhap("Cửa sổ cookie (ngày)", "45");
    nhap("Hiệu lực từ ngày", "2026-11-01");
    nhap("Nguồn mặc định", "s2");
    fireEvent.click(screen.getByRole("radio", { name: /Xem tay từng trường hợp/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tạo campaign" }));
    await waitFor(() => expect(luuTao).toHaveBeenCalledTimes(1));
    expect(luuTao).toHaveBeenCalledWith({
      code: "tết 2027",
      name: "  Giới thiệu Tết ",
      description: "",
      attributionModel: "MANUAL_REVIEW",
      cookieWindowDays: 45,
      protectWindowDays: 90,
      allowSelfReferral: false,
      partnerCanViewAmount: null,
      defaultSourceGroupId: "s2",
      effectiveFrom: "2026-10-31T17:00:00.000Z",
      effectiveTo: null,
    });
    await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/nguon-hoa-hong/campaign/TET_2027"));
    expect(TOAST.success).toHaveBeenCalled();
  });

  it("lỗi máy chủ «mã đã có» hiện CẠNH ô mã; ô không bị xoá; lỗi khác hiện ở banner", async () => {
    const luuTao = vi.fn(async () => ({ ok: false as const, loi: "Mã «TET_2027» đã có.", truong: "code" }));
    tao(luuTao as never);
    nhap("Tên campaign", "Giới thiệu Tết");
    nhap("Mã campaign", "tet_2027");
    fireEvent.click(screen.getByRole("button", { name: "Tạo campaign" }));
    await waitFor(() => expect(screen.getByLabelText("Mã campaign").getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getAllByRole("alert")[0]!.textContent).toBe("Mã «TET_2027» đã có.");
    expect((screen.getByLabelText("Mã campaign") as HTMLInputElement).value).toBe("tet_2027");
    cleanup();
    const hong = vi.fn(async () => ({ ok: false as const, loi: "Không có quyền tạo campaign (affiliate_campaigns:manage).", truong: "quyen" }));
    tao(hong as never);
    nhap("Tên campaign", "Giới thiệu Tết");
    nhap("Mã campaign", "tet_2027");
    fireEvent.click(screen.getByRole("button", { name: "Tạo campaign" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/affiliate_campaigns:manage/);
  });

  it("ô nguồn mặc định chỉ liệt kê nguồn được truyền vào + lựa chọn «không đặt»", () => {
    tao();
    const o = screen.getByLabelText("Nguồn mặc định") as HTMLSelectElement;
    expect([...o.options].map((x) => x.textContent).slice(1)).toEqual(["Giới thiệu bởi đối tác", "Sự kiện"]);
  });
});

describe("[AFF-FORM-02] sửa campaign ĐANG CHẠY", () => {
  const KHOA = ["Cửa sổ cookie (ngày)", "Thời gian bảo vệ (ngày)", "Nguồn mặc định", "Hiệu lực từ ngày"];

  it("ô ảnh hưởng ghi nhận `disabled` KÈM lý do ngay dưới ô; tên / mô tả / hạn còn sửa được. Đối chứng dương: campaign NHÁP ⇒ mọi ô sửa được", () => {
    sua("ACTIVE");
    for (const nhan of KHOA) expect((screen.getByLabelText(nhan) as HTMLInputElement).disabled, nhan).toBe(true);
    expect((screen.getByRole("checkbox", { name: /tự giới thiệu/ }) as HTMLInputElement).disabled).toBe(true);
    for (const r of screen.getAllByRole("radio")) expect((r as HTMLInputElement).disabled).toBe(true);
    expect(document.body.textContent).toMatch(/Đang chạy — tạm dừng campaign trước khi đổi ô này/);
    for (const nhan of ["Tên campaign", "Mô tả", "Hết hiệu lực vào ngày"]) expect((screen.getByLabelText(nhan) as HTMLInputElement).disabled, nhan).toBe(false);
    expect((screen.getByLabelText("Mã campaign") as HTMLInputElement).disabled, "mã không đổi sau khi tạo").toBe(true);
    cleanup();
    sua("DRAFT");
    for (const nhan of KHOA) expect((screen.getByLabelText(nhan) as HTMLInputElement).disabled, nhan).toBe(false);
    expect(screen.queryByText(/Đang chạy — tạm dừng campaign trước khi đổi ô này/)).toBeNull();
  });

  it("đổi tên + hạn ⇒ CHỈ gửi hai ô đã đổi (không gửi lại cookie · bảo vệ… — gửi lại là bị chặn oan), không đòi lý do", async () => {
    const { luuSua } = sua("ACTIVE");
    nhap("Tên campaign", "Tên mới");
    nhap("Hết hiệu lực vào ngày", "2027-03-31");
    expect(screen.queryByLabelText(/Lý do/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(luuSua).toHaveBeenCalledTimes(1));
    expect(luuSua).toHaveBeenCalledWith({ id: "c1", updatedAtDaThay: MOC, vao: { name: "Tên mới", effectiveTo: "2027-03-30T17:00:00.000Z" }, lyDo: null });
    await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/nguon-hoa-hong/campaign/TET_2027"));
  });

  it("[AFF-FORM-XT2] ô «Số tiền hoa hồng ở cổng đối tác» là cài đặt HIỂN THỊ: sửa được cả khi ĐANG CHẠY, không đòi lý do; chỉ gửi ô đã đổi (null → true)", async () => {
    const { luuSua } = sua("ACTIVE");
    const o = screen.getByLabelText("Số tiền hoa hồng ở cổng đối tác") as HTMLSelectElement;
    expect(o.disabled).toBe(false); // đối chứng dương cạnh các ô ghi nhận bị khoá
    expect((screen.getByLabelText("Cửa sổ cookie (ngày)") as HTMLInputElement).disabled).toBe(true);
    expect(o.value).toBe("THEO_CAP_TREN");
    nhap("Số tiền hoa hồng ở cổng đối tác", "HIEN");
    expect(screen.queryByLabelText(/Lý do/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(luuSua).toHaveBeenCalledTimes(1));
    expect(luuSua).toHaveBeenCalledWith({ id: "c1", updatedAtDaThay: MOC, vao: { partnerCanViewAmount: true }, lyDo: null });
  });

  it("[AFF-FORM-XT3] campaign đang «Ẩn» (false) mở sửa đã chọn «Ẩn»; chọn «Theo cấp trên» ⇒ gửi null (không phải false)", async () => {
    const { luuSua } = sua("ACTIVE", { partnerCanViewAmount: false });
    expect((screen.getByLabelText("Số tiền hoa hồng ở cổng đối tác") as HTMLSelectElement).value).toBe("AN");
    nhap("Số tiền hoa hồng ở cổng đối tác", "THEO_CAP_TREN");
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(luuSua).toHaveBeenCalledTimes(1));
    expect((luuSua.mock.calls[0] as unknown as [{ vao: Record<string, unknown> }])[0].vao).toEqual({ partnerCanViewAmount: null });
  });

  it("hạn mới trước ngày bắt đầu ⇒ lỗi cạnh ô, KHÔNG gọi", async () => {
    const { luuSua } = sua("ACTIVE");
    nhap("Hết hiệu lực vào ngày", "2026-01-01");
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(screen.getByLabelText("Hết hiệu lực vào ngày").getAttribute("aria-invalid")).toBe("true"));
    expect(luuSua).not.toHaveBeenCalled();
  });
});

describe("[AFF-FORM-03] sửa campaign TẠM DỪNG / NHÁP — lý do", () => {
  it("PAUSED: đổi cookie ⇒ ô lý do HIỆN và BẮT BUỘC (lỗi cạnh ô, không gọi); đủ lý do ⇒ gọi chỉ với ô đã đổi + lý do", async () => {
    const { luuSua } = sua("PAUSED");
    expect(screen.queryByLabelText(/Lý do/)).toBeNull();
    nhap("Cửa sổ cookie (ngày)", "60");
    expect(screen.getByLabelText(/Lý do/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(screen.getByLabelText(/Lý do/).getAttribute("aria-invalid")).toBe("true"));
    expect(luuSua).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: `  ${LY_DO} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(luuSua).toHaveBeenCalledWith({ id: "c1", updatedAtDaThay: MOC, vao: { cookieWindowDays: 60 }, lyDo: LY_DO }));
  });

  it("PAUSED: chỉ đổi tên ⇒ KHÔNG đòi lý do. NHÁP: đổi cookie ⇒ KHÔNG đòi lý do (chưa từng chạy)", () => {
    sua("PAUSED");
    nhap("Tên campaign", "Tên khác");
    expect(screen.queryByLabelText(/Lý do/)).toBeNull();
    cleanup();
    sua("DRAFT");
    nhap("Cửa sổ cookie (ngày)", "60");
    expect(screen.queryByLabelText(/Lý do/)).toBeNull();
  });
});

describe("[AFF-FORM-04] khoá lạc quan & nút Lưu", () => {
  it("chưa đổi gì ⇒ nút Lưu khoá + nói «Chưa có thay đổi nào»; đổi rồi trả về y cũ ⇒ lại khoá", () => {
    sua("DRAFT");
    const luu = screen.getByRole("button", { name: "Lưu thay đổi" }) as HTMLButtonElement;
    expect(luu.disabled).toBe(true);
    expect(document.body.textContent).toMatch(/Chưa có thay đổi nào để lưu/);
    nhap("Tên campaign", "Khác");
    expect(luu.disabled).toBe(false);
    nhap("Tên campaign", "Giới thiệu Tết");
    expect(luu.disabled).toBe(true);
  });

  it("«vừa được người khác đổi» ⇒ banner nêu hệ quả (mất chỗ đang sửa) + «Tải lại dữ liệu mới»; bấm làm mới trang", async () => {
    const luuSua = vi.fn(async () => ({ ok: false as const, loi: "Campaign vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" }));
    sua("DRAFT", {}, luuSua as never);
    nhap("Tên campaign", "Khác");
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/vừa được người khác/);
    expect(banner.textContent).toMatch(/sẽ mất khi tải lại/);
    fireEvent.click(screen.getByRole("button", { name: "Tải lại dữ liệu mới" }));
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it("nguồn mặc định HIỆN TẠI đã hỏng ⇒ vẫn hiện ở ô chọn kèm «hiện không dùng được» + lý do; chưa đụng tới thì không bị coi là đổi", () => {
    sua("DRAFT", { defaultSourceGroupId: "s-hong" }, undefined, { nguonMacDinhHong: { id: "s-hong", ten: "Nguồn cũ", lyDo: "Nguồn «Nguồn cũ» hiện không dùng được." } });
    const o = screen.getByLabelText("Nguồn mặc định") as HTMLSelectElement;
    expect(o.value).toBe("s-hong");
    expect([...o.options].some((x) => /Nguồn cũ \(hiện không dùng được\)/.test(x.textContent ?? ""))).toBe(true);
    expect(document.body.textContent).toMatch(/Nguồn «Nguồn cũ» hiện không dùng được/);
    expect((screen.getByRole("button", { name: "Lưu thay đổi" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
