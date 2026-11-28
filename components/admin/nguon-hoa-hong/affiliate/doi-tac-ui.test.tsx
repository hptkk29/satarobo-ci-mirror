// @vitest-environment jsdom
/**
 * [ADU-*] — BẢNG ĐỐI TÁC · SHEET TẠO/SỬA · HỘP THOẠI ĐỔI TRẠNG THÁI · NÚT SAO CHÉP LINK trên PHẦN TỬ THẬT (jsdom); hàm gọi máy chủ được TIÊM.
 *
 *   [ADU-01] bảng: nút GHI chỉ khi `coTheGhi` (đối chứng dương cùng ca); đối tác ĐÃ KẾT THÚC không có nút; không nút xoá; KHÔNG cột Link/Referral/Hoa hồng; chú thích «bị cắt» khi phạm vi lead giới hạn
 *   [ADU-02] nút «Link» (AFF-WEB): sao chép ĐÚNG URL CUỐI của link đang dùng (không dựng ?ref= từ tên miền cứng); chưa có link ⇒ nút dẫn sang tab tạo; không quyền/không việc để làm ⇒ không vẽ gì; clipboard hỏng ⇒ báo lỗi kèm link để chép tay
 *   [ADU-03] Sheet TẠO: ô khoá/gợi ý mã, loại ngừng không chọn được, thiếu loại ⇒ nói rõ + không lưu, lỗi cạnh ô (aria-invalid + role=alert), payload đúng, đổi sang TỔ CHỨC xoá nhân viên + cha, lỗi máy chủ map đúng ô, «vừa đổi» có Tải lại, Ctrl+Enter
 *   [ADU-04] Sheet SỬA: mã KHOÁ khi đã có lead; đổi mã đòi lý do; loại/nhãn đã ngừng đang giữ vẫn hiện; gửi đúng mốc khoá lạc quan
 *   [ADU-05] đổi trạng thái: danh sách LẤY TỪ bảng chuyển; ENDED không có nút; lý do chỉ khi cổng đòi; gọi đúng tham số; lỗi máy chủ
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
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/affiliate/_actions", () => ({
  taoDoiTacAction: vi.fn(),
  suaDoiTacAction: vi.fn(),
  doiTrangThaiDoiTacAction: vi.fn(),
  timNhanVienAction: vi.fn(),
  taoLoaiAction: vi.fn(),
  suaLoaiAction: vi.fn(),
  batTatLoaiAction: vi.fn(),
  taoNhanAction: vi.fn(),
  suaNhanAction: vi.fn(),
  batTatNhanAction: vi.fn(),
}));

// ReferrerPicker import mặc định `timNguoiGioiThieuAction` (kéo next-auth) — ô nhân viên của biểu mẫu này tiêm `tim` riêng nên không bao giờ gọi nó.
vi.mock("@/app/(admin)/admin/leads/nguon-actions", () => ({ timNguoiGioiThieuAction: vi.fn() }));

import type { DongDoiTac, TuyChonDoiTac } from "@/lib/affiliate/doc-doi-tac";
import type { KetQuaDoiTrangThaiDoiTac, KetQuaSuaDoiTac, KetQuaTaoDoiTac } from "@/lib/affiliate/ghi-doi-tac";
import type { NguoiDaChon } from "@/lib/nguon/chon-nguon";
import { BangDoiTac } from "../../../../app/(admin)/admin/nguon-hoa-hong/affiliate/_components/bang-doi-tac";
import { DoiTacSheet, HUONG_DAN_MA_TAO_LINK } from "./doi-tac-sheet";
import { NutDoiTrangThaiDoiTac, type DoiTacDeDoiTrangThai } from "./doi-trang-thai-doi-tac";
import { SaoChepLink } from "./sao-chep-link";
import type { HamTim } from "../referrer-picker";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOC = "2026-10-13T03:00:00.000Z";

const dong = (p: Partial<DongDoiTac> = {}): DongDoiTac => ({
  id: "dt-1",
  ma: "CHIAN",
  ten: "Chị An",
  kieu: "PERSON",
  trangThai: "ACTIVE",
  loai: { id: "loai-ph", ma: "PHU_HUYNH", ten: "Phụ huynh", dangDung: true, canDuyet: false },
  nhan: [],
  soChuongTrinh: 2,
  soLead: 7,
  soLeadDaChot: 3,
  dienThoai: "090xxxx456",
  email: "an*@example.com",
  ghiChu: null,
  tiLeThamChieu: null,
  coSoId: null,
  nhanVien: null,
  toChuc: null,
  soThanhVien: 0,
  maDaKhoa: false,
  capNhatLuc: MOC,
  ...p,
});

const TUY_CHON: TuyChonDoiTac = {
  loai: [
    { id: "loai-ph", ma: "PHU_HUYNH", ten: "Phụ huynh", dangDung: true, canDuyet: false },
    { id: "loai-kol", ma: "KOL", ten: "KOL", dangDung: true, canDuyet: true },
    { id: "loai-cu", ma: "CU", ten: "Loại cũ", dangDung: false, canDuyet: true },
  ],
  nhan: [
    { id: "nhan-gv", ma: "GV", ten: "Giáo viên", dangDung: true },
    { id: "nhan-cu", ma: "CU", ten: "Nhãn cũ", dangDung: false },
  ],
  coSo: [{ id: "cs1", nhan: "CS1 · Nguyễn Hữu Thọ" }],
  toChuc: [{ id: "org-1", ten: "Trường Lê Quý Đôn" }],
};

const BANG = (p: Partial<React.ComponentProps<typeof BangDoiTac>> = {}) => (
  <BangDoiTac dong={[dong()]} tong={1} trang={1} kichThuoc={25} hrefTrang={(t) => `/x?trang=${t}`} phamViLead="TAT_CA" coTheGhi coTheLink={false} linkDangDung={{}} tuyChon={TUY_CHON} {...p} />
);

// ═══ [ADU-01] bảng ═══════════════════════════════════════════════════════════════════════════════════
describe("[ADU-01] BangDoiTac — nút ghi theo quyền, cột nói thật", () => {
  it("coTheGhi=false ⇒ KHÔNG Sửa / Đổi trạng thái / cột Thao tác; coTheGhi=true ⇒ THẤY (đối chứng dương)", () => {
    render(BANG({ coTheGhi: false, tuyChon: null }));
    expect(screen.queryByRole("button", { name: /Sửa đối tác/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Đổi trạng thái/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Thao tác" })).toBeNull();
    cleanup();
    render(BANG({ coTheGhi: true }));
    expect(screen.getByRole("button", { name: "Sửa đối tác Chị An" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Đổi trạng thái: đối tác Chị An" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Thao tác" })).toBeTruthy();
  });

  it("đối tác ĐÃ KẾT THÚC không có nút nào (hồ sơ đóng); các dòng khác vẫn có (đối chứng dương); KHÔNG BAO GIỜ có nút xoá", () => {
    render(BANG({ dong: [dong({ id: "a", ten: "Đang chạy" }), dong({ id: "b", ten: "Đã đóng", trangThai: "ENDED" })], tong: 2 }));
    expect(screen.getByRole("button", { name: "Sửa đối tác Đang chạy" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sửa đối tác Đã đóng" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Đổi trạng thái: đối tác Đã đóng" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Xoá|Xóa/ })).toBeNull();
  });

  it("cột: đủ tám cột thật; KHÔNG cột Link / Referral / Hoa hồng (chưa tồn tại — AFF-P1/P2)", () => {
    render(BANG());
    const ten = screen.getAllByRole("columnheader").map((c) => (c.textContent ?? "").replace(/\*/g, "").trim());
    expect(ten).toEqual(expect.arrayContaining(["Đối tác", "Loại", "Nhãn", "Trạng thái", "Chương trình", "Lead", "Đã chốt", "Mã giới thiệu"]));
    for (const cam of [/^Link$/, /Referral/i, /Hoa hồng/i]) expect(ten.filter((t) => cam.test(t)), String(cam)).toEqual([]);
  });

  it("hiển thị đúng số: chương trình · lead · đã chốt; loại ngừng có nhãn «đã ngừng»; chưa có loại nói «Chưa có loại»", () => {
    render(
      BANG({
        dong: [
          dong({ id: "a", ten: "A", soChuongTrinh: 2, soLead: 7, soLeadDaChot: 3 }),
          dong({ id: "b", ten: "B", loai: { id: "x", ma: "CU", ten: "Loại cũ", dangDung: false, canDuyet: true } }),
          dong({ id: "c", ten: "C", loai: null }),
        ],
        tong: 3,
      }),
    );
    const hangA = screen.getByText("A").closest("tr")!;
    expect(within(hangA).getByText("7")).toBeTruthy();
    expect(within(hangA).getByText("3")).toBeTruthy();
    expect(screen.getByText("Loại cũ (đã ngừng)")).toBeTruthy();
    expect(screen.getByText("Chưa có loại")).toBeTruthy();
  });

  it("phạm vi lead GIỚI HẠN ⇒ tiêu đề có dấu * và dòng chú thích «bị cắt»; TẤT CẢ ⇒ không (đối chứng)", () => {
    render(BANG({ phamViLead: "GIOI_HAN" }));
    expect(screen.getByRole("columnheader", { name: "Lead*" })).toBeTruthy();
    expect(screen.getByText(/lead của cơ sở khác không nằm trong con số này/)).toBeTruthy();
    cleanup();
    render(BANG({ phamViLead: "TAT_CA" }));
    expect(screen.getByRole("columnheader", { name: "Lead" })).toBeTruthy();
    expect(screen.queryByText(/lead của cơ sở khác không nằm trong con số này/)).toBeNull();
  });

  it("mã đã có lead hiện ổ khoá; chưa có thì không (đối chứng)", () => {
    render(BANG({ dong: [dong({ maDaKhoa: true })] }));
    expect(screen.getByLabelText("Mã đã khoá")).toBeTruthy();
    cleanup();
    render(BANG({ dong: [dong({ maDaKhoa: false })] }));
    expect(screen.queryByLabelText("Mã đã khoá")).toBeNull();
  });

  const URL_CUOI = "https://quatang.edu.vn/khoa-robot?aff=K8F29XQ47M&cmp=TET_2027";
  const LINK_CUA = (id: string) => ({ [id]: { id: "l1", urlCuoi: URL_CUOI, campaign: "Tết 2027", website: "Quà tặng" } });

  it("nút «Link» CHỈ cho đối tác ĐANG HOẠT ĐỘNG (link của đối tác khác trạng thái không gắn lead) và người xem có quyền link", () => {
    const ds = (["ACTIVE", "PENDING", "SUSPENDED", "ENDED", "DRAFT"] as const).map((t) => dong({ id: t, ten: `DT ${t}`, trangThai: t }));
    const linkDangDung = Object.assign({}, ...ds.map((d) => LINK_CUA(d.id)));
    render(BANG({ dong: ds, tong: 5, coTheGhi: false, tuyChon: null, coTheLink: true, linkDangDung }));
    expect(screen.getByRole("button", { name: "Sao chép link giới thiệu của DT ACTIVE" })).toBeTruthy();
    for (const t of ["PENDING", "SUSPENDED", "ENDED", "DRAFT"]) expect(screen.queryByRole("button", { name: `Sao chép link giới thiệu của DT ${t}` }), t).toBeNull();
  });

  it("KHÔNG có quyền link ⇒ KHÔNG nút nào (kể cả khi dữ liệu có link — tầng đọc đã che, bảng cũng không vẽ); ĐỐI CHỨNG DƯƠNG: có quyền ⇒ thấy", () => {
    render(BANG({ coTheLink: false, linkDangDung: LINK_CUA("dt-1") }));
    expect(screen.queryByRole("button", { name: /Sao chép link giới thiệu/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Tạo link giới thiệu/ })).toBeNull();
    cleanup();
    render(BANG({ coTheLink: true, linkDangDung: LINK_CUA("dt-1") }));
    expect(screen.getByRole("button", { name: "Sao chép link giới thiệu của Chị An" })).toBeTruthy();
  });

  it("đã có link ⇒ nút SAO CHÉP; chưa có link nhưng có chương trình ⇒ nút DẪN sang tab tạo (đúng đối tác); chưa tham gia chương trình nào ⇒ KHÔNG nút (tab đó cũng không phát được)", () => {
    render(BANG({ dong: [dong({ id: "a", ten: "Có link", ma: "COLINK" }), dong({ id: "b", ten: "Chưa link", ma: "CHUALINK", soChuongTrinh: 1 }), dong({ id: "c", ten: "Không chương trình", ma: "KHONGCT", soChuongTrinh: 0 })], tong: 3, coTheLink: true, linkDangDung: LINK_CUA("a") }));
    expect(screen.getByRole("button", { name: "Sao chép link giới thiệu của Có link" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Tạo link giới thiệu cho Có link" })).toBeNull();
    const tao = screen.getByRole("link", { name: "Tạo link giới thiệu cho Chưa link" });
    expect(tao.getAttribute("href")).toBe("/nguon-hoa-hong/link?doitac=CHUALINK");
    expect(screen.queryByRole("button", { name: "Sao chép link giới thiệu của Chưa link" })).toBeNull();
    // đối tác chưa tham gia chương trình nào: không nút «Link» nào (nút Sửa / Đổi trạng thái vẫn có — đối chứng dương)
    expect(screen.queryByRole("button", { name: "Sao chép link giới thiệu của Không chương trình" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Tạo link giới thiệu cho Không chương trình" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sửa đối tác Không chương trình" })).toBeTruthy();
  });

  it("thanh trang chỉ khi > 1 trang", () => {
    render(BANG({ tong: 26, trang: 1 }));
    expect(screen.getByRole("navigation", { name: "Điều hướng trang" })).toBeTruthy();
    expect(screen.getByText("1–25")).toBeTruthy();
    cleanup();
    render(BANG({ tong: 1 }));
    expect(screen.queryByRole("navigation", { name: "Điều hướng trang" })).toBeNull();
  });
});

// ═══ [ADU-02] sao chép link ═════════════════════════════════════════════════════════════════════════
describe("[ADU-02] SaoChepLink", () => {
  const URL_CUOI = "https://quatang.edu.vn/khoa-robot?aff=K8F29XQ47M&cmp=TET_2027";
  it("sao chép ĐÚNG URL CUỐI được truyền vào (không tự dựng gì, không có tên miền cứng) và báo thành công", async () => {
    const ghi = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: ghi }, configurable: true });
    render(<SaoChepLink tenDoiTac="Chị An" urlCuoi={URL_CUOI} hrefTao={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Sao chép link giới thiệu của Chị An" }));
    await waitFor(() => expect(ghi).toHaveBeenCalledWith(URL_CUOI));
    await waitFor(() => expect(TOAST.success).toHaveBeenCalledWith(expect.stringContaining(URL_CUOI)));
    expect(ghi).not.toHaveBeenCalledWith(expect.stringContaining("?ref="));
  });
  it("clipboard bị chặn ⇒ báo lỗi KÈM link để chép tay", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("chặn"))) }, configurable: true });
    render(<SaoChepLink tenDoiTac="Chị An" urlCuoi={URL_CUOI} hrefTao={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Sao chép link giới thiệu của Chị An" }));
    await waitFor(() => expect(TOAST.error).toHaveBeenCalledWith(expect.stringContaining(URL_CUOI)));
  });
  it("chưa có link ⇒ KHÔNG nút sao chép, thay bằng liên kết sang tab tạo; có link thì URL cuối thắng (đối chứng); không gì để làm ⇒ không vẽ gì", () => {
    const { container, unmount } = render(<SaoChepLink tenDoiTac="Chị An" urlCuoi={null} hrefTao="/nguon-hoa-hong/link?doitac=CHIAN" />);
    expect(screen.queryByRole("button", { name: /Sao chép/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Tạo link giới thiệu cho Chị An" }).getAttribute("href")).toBe("/nguon-hoa-hong/link?doitac=CHIAN");
    unmount();
    render(<SaoChepLink tenDoiTac="Chị An" urlCuoi={URL_CUOI} hrefTao="/nguon-hoa-hong/link?doitac=CHIAN" />);
    expect(screen.getByRole("button", { name: "Sao chép link giới thiệu của Chị An" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Tạo link/ })).toBeNull();
    cleanup();
    const trong = render(<SaoChepLink tenDoiTac="Chị An" urlCuoi={null} hrefTao={null} />);
    expect(trong.container.innerHTML).toBe("");
    expect(container).toBeTruthy();
  });
});

// ═══ [ADU-03] Sheet TẠO ═════════════════════════════════════════════════════════════════════════════
const OK_TAO: KetQuaTaoDoiTac = { ok: true, id: "moi", ma: "CHIAN", trangThai: "ACTIVE", capNhatLuc: MOC };
const NV: NguoiDaChon = { loai: "NHAN_SU", employeeId: "e-77", ten: "Lê Thị Liên", ma: "SR.NV.02", vai: "SALE" };

function dungTao(p: { tuyChon?: TuyChonDoiTac; coTheTaoLink?: boolean; tao?: (i: { vao: Record<string, unknown> }) => Promise<KetQuaTaoDoiTac> } = {}) {
  const tao = vi.fn(p.tao ?? (async () => OK_TAO));
  const tim = vi.fn<HamTim>(async () => ({ ok: true, ketQua: [NV] }));
  render(
    <DoiTacSheet tuyChon={p.tuyChon ?? TUY_CHON} coTheTaoLink={p.coTheTaoLink ?? false} tao={tao} tim={tim} triggerAriaLabel="Tạo đối tác">
      Tạo đối tác
    </DoiTacSheet>,
  );
  return { tao, tim };
}
const mo = (ten = "Tạo đối tác") => fireEvent.click(screen.getByRole("button", { name: ten }));
const go = (nhan: RegExp | string, v: string) => fireEvent.change(screen.getByLabelText(nhan), { target: { value: v } });
const luu = (ten = "Tạo đối tác") => fireEvent.click(screen.getAllByRole("button", { name: ten }).at(-1)!);

describe("[ADU-03] Sheet TẠO", () => {
  it("loại: chỉ liệt kê loại ĐANG DÙNG (loại đã ngừng không chọn mới được); nhãn ngừng không liệt kê", () => {
    dungTao();
    mo();
    const chon = screen.getByLabelText(/Loại đối tác/) as HTMLSelectElement;
    const ten = [...chon.options].map((o) => o.textContent);
    expect(ten).toEqual(expect.arrayContaining(["— Chọn loại —", "Phụ huynh", "KOL"]));
    expect(ten.join("|")).not.toContain("Loại cũ");
    expect(screen.getByLabelText("Giáo viên")).toBeTruthy(); // đối chứng dương
    expect(screen.queryByLabelText(/Nhãn cũ/)).toBeNull();
  });

  it("gõ tên ⇒ tự gợi ý mã + cho thấy mã SẼ LƯU; KHÔNG còn «link mẫu» ?ref= — thay bằng câu hướng dẫn tạo link ở tab Link / QR / Mã; gõ tay vào ô mã thì thôi gợi ý", () => {
    dungTao();
    mo();
    go(/Họ tên/, "Chị An");
    expect((screen.getByLabelText(/Mã giới thiệu/) as HTMLInputElement).value).toBe("CHIAN");
    expect(screen.queryByText(/Link mẫu/)).toBeNull();
    expect(document.body.textContent).not.toContain("?ref=CHIAN");
    expect(document.body.textContent).not.toContain("satarobo.vn");
    expect(document.querySelector("[data-huong-dan-link]")?.textContent).toContain(HUONG_DAN_MA_TAO_LINK);
    expect(screen.queryByRole("link", { name: "Mở tab Link / QR / Mã" })).toBeNull(); // không quyền phát link ⇒ chỉ có chữ, không có đường dẫn
    go(/Mã giới thiệu/, "an-nguyen");
    expect(screen.getByText("ANNGUYEN")).toBeTruthy(); // mã sẽ lưu đã chuẩn hoá
    go(/Họ tên/, "Chị Bình");
    expect((screen.getByLabelText(/Mã giới thiệu/) as HTMLInputElement).value, "người dùng đã tự gõ mã ⇒ không bị ghi đè").toBe("AN-NGUYEN");
  });

  it("mã quá dài ⇒ câu lỗi sống ngay dưới ô (không đợi bấm Lưu)", () => {
    dungTao();
    mo();
    go(/Mã giới thiệu/, "A".repeat(40));
    expect(screen.getByText(/tối đa 32 ký tự/)).toBeTruthy();
  });

  it("bấm Tạo khi trống ⇒ lỗi CẠNH ô (aria-invalid + role=alert), `tao` KHÔNG được gọi", async () => {
    const { tao } = dungTao();
    mo();
    luu();
    expect(await screen.findByText("Tên tối thiểu 2 ký tự.")).toBeTruthy();
    expect(screen.getByText("Chọn loại đối tác.")).toBeTruthy();
    expect(screen.getByLabelText(/Họ tên/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Loại đối tác/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2);
    expect(tao).not.toHaveBeenCalled();
  });

  it("không có loại nào đang dùng ⇒ nói rõ + đường tới mục Loại + KHÔNG cho tạo", () => {
    const { tao } = dungTao({ tuyChon: { ...TUY_CHON, loai: [{ id: "x", ma: "CU", ten: "Loại cũ", dangDung: false, canDuyet: true }] } });
    mo();
    expect(screen.getByText(/Chưa có loại đối tác nào đang hoạt động/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Loại đối tác" }).getAttribute("href")).toBe("/nguon-hoa-hong/affiliate?xem=loai");
    expect((screen.getAllByRole("button", { name: "Tạo đối tác" }).at(-1) as HTMLButtonElement).disabled).toBe(true);
    expect(tao).not.toHaveBeenCalled();
  });

  it("hint theo loại: loại cần duyệt ⇒ «Chờ duyệt»; không cần ⇒ «hoạt động ngay»", () => {
    dungTao();
    mo();
    go(/Loại đối tác/, "loai-kol");
    expect(screen.getByText(/Chờ duyệt/)).toBeTruthy();
    go(/Loại đối tác/, "loai-ph");
    expect(screen.getByText(/hoạt động ngay/)).toBeTruthy();
  });

  it("nhãn tỉ lệ nói thẳng «không dùng để tính tiền»", () => {
    dungTao();
    mo();
    expect(screen.getByText(/Không dùng để tính tiền/)).toBeTruthy();
    expect(screen.getByLabelText(/Tỉ lệ tham chiếu/)).toBeTruthy();
  });

  it("lưu hợp lệ ⇒ gọi `tao` ĐÚNG MỘT lần với payload chuẩn; xong ⇒ toast + refresh + Sheet đóng", async () => {
    // Cấy: gửi `loaiId` thay `typeId` · gửi `name` chưa trim · quên `tagIds` ⇒ đỏ.
    const { tao } = dungTao();
    mo();
    go(/Họ tên/, "Chị An");
    go(/Loại đối tác/, "loai-ph");
    fireEvent.click(screen.getByLabelText("Giáo viên"));
    go(/Điện thoại/, "0905 123 456");
    go(/Tỉ lệ tham chiếu/, "12,5");
    luu();
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    expect(tao).toHaveBeenCalledWith({
      vao: {
        partyKind: "PERSON",
        name: "Chị An",
        typeId: "loai-ph",
        tagIds: ["nhan-gv"],
        code: "CHIAN",
        phone: "0905 123 456",
        email: "",
        note: "",
        centerId: null,
        commissionPercent: 12.5,
        employeeId: null,
        parentPartyId: null,
      },
    });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
    expect(TOAST.success).toHaveBeenCalledWith(expect.stringContaining("Chị An"));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Tạo đối tác" })).toBeNull());
  });

  it("chọn nhân viên rồi đổi sang TỔ CHỨC ⇒ ô nhân viên + tổ chức cha biến mất VÀ payload gửi null (giá trị cũ không đi theo ngầm)", async () => {
    const { tao } = dungTao();
    mo();
    go(/Họ tên/, "Trường Lê Quý Đôn");
    go(/Loại đối tác/, "loai-ph");
    go(/Thuộc tổ chức/, "org-1");
    fireEvent.change(screen.getByRole("combobox", { name: /Nhân viên liên kết/ }), { target: { value: "Liên" } });
    fireEvent.click(await screen.findByRole("option", { name: /Lê Thị Liên/ }));
    expect(screen.getByText("Lê Thị Liên")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Tổ chức"));
    expect(screen.queryByLabelText(/Thuộc tổ chức/)).toBeNull();
    expect(screen.queryByText("Nhân viên liên kết")).toBeNull();
    luu();
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    const vao = tao.mock.calls[0]![0].vao;
    expect(vao).toMatchObject({ partyKind: "ORGANIZATION", employeeId: null, parentPartyId: null });
  });

  it("chọn nhân viên (cá nhân) ⇒ payload mang employeeId; hàm tìm nhận loại NHAN_SU", async () => {
    const { tao, tim } = dungTao();
    mo();
    go(/Họ tên/, "Cô Lan");
    go(/Loại đối tác/, "loai-ph");
    fireEvent.change(screen.getByRole("combobox", { name: /Nhân viên liên kết/ }), { target: { value: "Liên" } });
    fireEvent.click(await screen.findByRole("option", { name: /Lê Thị Liên/ }));
    expect(tim).toHaveBeenCalledWith("NHAN_SU", "Liên");
    luu();
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    expect(tao.mock.calls[0]![0].vao).toMatchObject({ employeeId: "e-77" });
  });

  it("lỗi máy chủ map về ĐÚNG ô: «mã đã có» nằm cạnh ô mã (aria-invalid, role=alert), Sheet vẫn mở, không refresh", async () => {
    const { tao } = dungTao({ tao: async () => ({ ok: false, loi: "Mã «CHIAN» đã có.", truong: "code" }) });
    mo();
    go(/Họ tên/, "Chị An");
    go(/Loại đối tác/, "loai-ph");
    luu();
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    const loi = await screen.findByText("Mã «CHIAN» đã có.");
    expect(loi.getAttribute("role")).toBe("alert");
    expect(screen.getByLabelText(/Mã giới thiệu/).getAttribute("aria-invalid")).toBe("true");
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    expect(TOAST.success).not.toHaveBeenCalled();
    expect(screen.getByRole("form", { name: "Tạo đối tác" })).toBeTruthy();
  });

  it("lỗi không thuộc ô nào ⇒ banner KHÔNG nút; «vừa đổi» ⇒ banner CÓ nút «Tải lại»; mạng hỏng ⇒ banner, nút Lưu không treo", async () => {
    const r1 = dungTao({ tao: async () => ({ ok: false, loi: "Không có quyền quản lý đối tác Affiliate (affiliates:manage).", truong: "quyen" }) });
    mo();
    go(/Họ tên/, "Chị An");
    go(/Loại đối tác/, "loai-ph");
    luu();
    await waitFor(() => expect(r1.tao).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("alert")).textContent).toContain("affiliates:manage");
    expect(screen.queryByRole("button", { name: "Tải lại" })).toBeNull();
    cleanup();
    vi.clearAllMocks();

    const r2 = dungTao({ tao: async () => ({ ok: false, loi: "Đối tác vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" }) });
    mo();
    go(/Họ tên/, "Chị An");
    go(/Loại đối tác/, "loai-ph");
    luu();
    await waitFor(() => expect(r2.tao).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Tải lại" })).toBeTruthy();
    cleanup();
    vi.clearAllMocks();

    const r3 = dungTao({
      tao: async () => {
        throw new Error("mạng");
      },
    });
    mo();
    go(/Họ tên/, "Chị An");
    go(/Loại đối tác/, "loai-ph");
    luu();
    await waitFor(() => expect(r3.tao).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Không lưu được lúc này/)).toBeTruthy();
    await waitFor(() => expect((screen.getAllByRole("button", { name: "Tạo đối tác" }).at(-1) as HTMLButtonElement).disabled).toBe(false));
  });

  it("Ctrl+Enter ở ô nhiều dòng cũng lưu (bàn phím)", async () => {
    const { tao } = dungTao();
    mo();
    go(/Họ tên/, "Chị An");
    go(/Loại đối tác/, "loai-ph");
    fireEvent.keyDown(screen.getByLabelText(/Ghi chú/), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
  });

  it("mỗi lần mở là một lần làm mới: bản nháp dở và lỗi của lượt trước không sống sang lượt sau", async () => {
    dungTao();
    mo();
    go(/Họ tên/, "Dở dang");
    fireEvent.click(screen.getAllByRole("button", { name: "Huỷ" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("form", { name: "Tạo đối tác" })).toBeNull());
    mo();
    expect((screen.getByLabelText(/Họ tên/) as HTMLInputElement).value).toBe("");
  });
});

// ═══ [ADU-04] Sheet SỬA ═════════════════════════════════════════════════════════════════════════════
const OK_SUA: KetQuaSuaDoiTac = { ok: true, doi: true, truongDoi: ["name"], capNhatLuc: MOC };

/** Liên hệ THẬT (người quản lý nhận bản không che — chỉ họ mở được Sheet sửa); bản che `090xxxx456` không qua nổi kiểm SĐT. */
const LIEN_HE_THAT = { dienThoai: "0905123456", email: "an@example.com" } as const;

function dungSua(d0: DongDoiTac, sua = vi.fn(async (_i: { id: string; updatedAtDaThay: string; vao: Record<string, unknown>; lyDo: string | null }) => OK_SUA)) {
  const d = { ...d0, ...LIEN_HE_THAT };
  render(
    <DoiTacSheet dong={d} tuyChon={TUY_CHON} coTheTaoLink={false} sua={sua} tim={vi.fn<HamTim>(async () => ({ ok: true, ketQua: [] }))} triggerAriaLabel={`Sửa đối tác ${d.ten}`}>
      Sửa
    </DoiTacSheet>,
  );
  return sua;
}

describe("[ADU-04] Sheet SỬA", () => {
  it("điền sẵn từ dòng; gửi ĐÚNG id + mốc khoá lạc quan của dòng; không đổi mã ⇒ KHÔNG có ô lý do", async () => {
    const sua = dungSua(dong({ nhan: [{ id: "nhan-gv", ma: "GV", ten: "Giáo viên", dangDung: true }], dienThoai: "0905123456", email: "an@example.com", tiLeThamChieu: 7 }));
    mo("Sửa đối tác Chị An");
    expect((screen.getByLabelText(/Họ tên/) as HTMLInputElement).value).toBe("Chị An");
    expect((screen.getByLabelText(/Loại đối tác/) as HTMLSelectElement).value).toBe("loai-ph");
    expect((screen.getByLabelText("Giáo viên") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText(/Lý do đổi mã/)).toBeNull();
    luu("Lưu thay đổi");
    await waitFor(() => expect(sua).toHaveBeenCalledTimes(1));
    expect(sua.mock.calls[0]![0]).toMatchObject({ id: "dt-1", updatedAtDaThay: MOC, lyDo: null });
    expect(sua.mock.calls[0]![0].vao).toMatchObject({ code: "CHIAN", tagIds: ["nhan-gv"], commissionPercent: 7 });
  });

  it("sửa chữ tên KHÔNG tự đổi mã (mã đã có không bao giờ bị gợi ý ghi đè)", () => {
    dungSua(dong());
    mo("Sửa đối tác Chị An");
    go(/Họ tên/, "Chị An Nguyễn");
    expect((screen.getByLabelText(/Mã giới thiệu/) as HTMLInputElement).value).toBe("CHIAN");
  });

  it("mã đã có lead ⇒ ô mã KHOÁ + nói vì sao; chưa có ⇒ gõ được (đối chứng dương)", () => {
    dungSua(dong({ maDaKhoa: true }));
    mo("Sửa đối tác Chị An");
    expect((screen.getByLabelText(/Mã giới thiệu/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/đã có lead nên không đổi được/)).toBeTruthy();
    cleanup();
    dungSua(dong({ maDaKhoa: false }));
    mo("Sửa đối tác Chị An");
    expect((screen.getByLabelText(/Mã giới thiệu/) as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText(/đã có lead nên không đổi được/)).toBeNull();
  });

  it("ĐỔI mã ⇒ xuất hiện ô lý do; thiếu lý do ⇒ lỗi cạnh ô, KHÔNG gọi máy chủ; đủ lý do ⇒ gửi lý do đã trim", async () => {
    const sua = dungSua(dong());
    mo("Sửa đối tác Chị An");
    go(/Mã giới thiệu/, "CHIAN2");
    const lyDo = screen.getByLabelText(/Lý do đổi mã/);
    luu("Lưu thay đổi");
    expect(await screen.findByText(/Đổi mã giới thiệu cần lý do từ 10 ký tự/)).toBeTruthy();
    expect(lyDo.getAttribute("aria-invalid")).toBe("true");
    expect(sua).not.toHaveBeenCalled();
    fireEvent.change(lyDo, { target: { value: "  In lại tờ rơi theo mã mới  " } });
    luu("Lưu thay đổi");
    await waitFor(() => expect(sua).toHaveBeenCalledTimes(1));
    expect(sua.mock.calls[0]![0].lyDo).toBe("In lại tờ rơi theo mã mới");
    expect(sua.mock.calls[0]![0].vao).toMatchObject({ code: "CHIAN2" });
  });

  it("đối tác ở trạng thái NHÁP đổi mã không đòi lý do (đối chứng với ca trên)", () => {
    dungSua(dong({ trangThai: "DRAFT" }));
    mo("Sửa đối tác Chị An");
    go(/Mã giới thiệu/, "CHIAN2");
    expect(screen.queryByLabelText(/Lý do đổi mã/)).toBeNull();
  });

  it("loại ĐÃ NGỪNG mà đối tác đang giữ vẫn hiện (kèm «đã ngừng») để lưu không lặng lẽ đổi loại; nhãn ngừng đang giữ: tick sẵn và gỡ được", async () => {
    const sua = dungSua(
      dong({
        loai: { id: "loai-cu", ma: "CU", ten: "Loại cũ", dangDung: false, canDuyet: true },
        nhan: [{ id: "nhan-cu", ma: "CU", ten: "Nhãn cũ", dangDung: false }],
      }),
    );
    mo("Sửa đối tác Chị An");
    const chon = screen.getByLabelText(/Loại đối tác/) as HTMLSelectElement;
    expect(chon.value).toBe("loai-cu");
    expect([...chon.options].map((o) => o.textContent)).toContain("Loại cũ (đã ngừng)");
    const nhanCu = screen.getByLabelText(/Nhãn cũ/) as HTMLInputElement;
    expect(nhanCu.checked).toBe(true);
    expect(nhanCu.disabled).toBe(false); // đang giữ ⇒ gỡ được
    fireEvent.click(nhanCu);
    luu("Lưu thay đổi");
    await waitFor(() => expect(sua).toHaveBeenCalledTimes(1));
    expect(sua.mock.calls[0]![0].vao).toMatchObject({ typeId: "loai-cu", tagIds: [] });
  });

  it("nhãn ngừng mà đối tác KHÔNG giữ thì không liệt kê (không chọn mới được)", () => {
    dungSua(dong({ nhan: [] }));
    mo("Sửa đối tác Chị An");
    expect(screen.queryByLabelText(/Nhãn cũ/)).toBeNull();
  });

  it("tổ chức: ô «Thuộc tổ chức» và «Nhân viên liên kết» không có; cá nhân thì có (đối chứng)", () => {
    dungSua(dong({ kieu: "ORGANIZATION", ten: "Trường" }));
    mo("Sửa đối tác Trường");
    expect(screen.queryByLabelText(/Thuộc tổ chức/)).toBeNull();
    cleanup();
    dungSua(dong({ kieu: "PERSON" }));
    mo("Sửa đối tác Chị An");
    expect(screen.getByLabelText(/Thuộc tổ chức/)).toBeTruthy();
  });

  it("tổ chức cha ĐÃ KẾT THÚC vẫn hiện để không lặng lẽ mất; nhân viên đã gắn hiện tên và nút Đổi", () => {
    dungSua(dong({ toChuc: { id: "org-cu", ten: "Trường cũ" }, nhanVien: { id: "e-9", ten: "Phạm Văn B", ma: "NV09" } }));
    mo("Sửa đối tác Chị An");
    const chon = screen.getByLabelText(/Thuộc tổ chức/) as HTMLSelectElement;
    expect(chon.value).toBe("org-cu");
    expect([...chon.options].map((o) => o.textContent)).toContain("Trường cũ (đã kết thúc)");
    expect(screen.getByText("Phạm Văn B")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Đổi nhân viên liên kết/ })).toBeTruthy();
  });
});

// ═══ [ADU-05] đổi trạng thái ════════════════════════════════════════════════════════════════════════
const dt = (p: Partial<DoiTacDeDoiTrangThai> = {}): DoiTacDeDoiTrangThai => ({ id: "dt-1", ten: "Chị An", trangThai: "ACTIVE", loaiCanDuyet: false, capNhatLuc: MOC, ...p });
const OK_DOI = (den: "ACTIVE" | "SUSPENDED"): KetQuaDoiTrangThaiDoiTac => ({ ok: true, den, capNhatLuc: MOC });
const NUT = "Đổi trạng thái: đối tác Chị An";

describe("[ADU-05] NutDoiTrangThaiDoiTac", () => {
  it("ĐÃ KẾT THÚC ⇒ KHÔNG vẽ nút (không phải nút xám); mọi trạng thái còn lại CÓ nút (đối chứng dương)", () => {
    const { container } = render(<NutDoiTrangThaiDoiTac doiTac={dt({ trangThai: "ENDED" })} />);
    expect(container.innerHTML).toBe("");
    cleanup();
    for (const t of ["DRAFT", "PENDING", "ACTIVE", "SUSPENDED"] as const) {
      render(<NutDoiTrangThaiDoiTac doiTac={dt({ trangThai: t })} />);
      expect(screen.getByRole("button", { name: NUT }), t).toBeTruthy();
      cleanup();
    }
  });

  it("danh sách chuyển LẤY TỪ bảng: PENDING ⇒ Duyệt · Từ chối; ACTIVE ⇒ Tạm dừng · Kết thúc; SUSPENDED ⇒ Kích hoạt lại · Kết thúc", () => {
    const nhan = (t: DoiTacDeDoiTrangThai["trangThai"]) => {
      render(<NutDoiTrangThaiDoiTac doiTac={dt({ trangThai: t })} />);
      fireEvent.click(screen.getByRole("button", { name: NUT }));
      const ds = screen.getAllByRole("radio").map((r) => (r.closest("label")!.querySelector("span span")?.textContent ?? "").trim());
      cleanup();
      return ds;
    };
    expect(nhan("PENDING")).toEqual(["Duyệt", "Từ chối"]);
    expect(nhan("ACTIVE")).toEqual(["Tạm dừng", "Kết thúc"]);
    expect(nhan("SUSPENDED")).toEqual(["Kích hoạt lại", "Kết thúc"]);
  });

  it("NHÁP: «Kích hoạt» chỉ khi loại KHÔNG cần duyệt; loại cần duyệt hoặc chưa có loại ⇒ chỉ «Gửi duyệt»", () => {
    const co = (loaiCanDuyet: boolean | null) => {
      render(<NutDoiTrangThaiDoiTac doiTac={dt({ trangThai: "DRAFT", loaiCanDuyet })} />);
      fireEvent.click(screen.getByRole("button", { name: NUT }));
      const ds = screen.getAllByRole("radio").map((r) => (r.closest("label")!.querySelector("span span")?.textContent ?? "").trim());
      cleanup();
      return ds;
    };
    expect(co(false)).toContain("Kích hoạt");
    expect(co(true)).not.toContain("Kích hoạt");
    expect(co(null)).not.toContain("Kích hoạt");
  });

  it("Duyệt: không đòi lý do; gọi `doi` ĐÚNG một lần với id · mốc khoá lạc quan · trạng thái đích · lý do null; xong ⇒ toast + refresh", async () => {
    const doi = vi.fn(async () => OK_DOI("ACTIVE"));
    render(<NutDoiTrangThaiDoiTac doiTac={dt({ trangThai: "PENDING" })} doi={doi} />);
    fireEvent.click(screen.getByRole("button", { name: NUT }));
    fireEvent.click(screen.getByRole("radio", { name: /Duyệt/ }));
    expect(screen.getByText("Lý do (tuỳ chọn)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    await waitFor(() => expect(doi).toHaveBeenCalledTimes(1));
    expect(doi).toHaveBeenCalledWith({ id: "dt-1", updatedAtDaThay: MOC, den: "ACTIVE", lyDo: null });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
    expect(TOAST.success).toHaveBeenCalledWith(expect.stringContaining("Chị An"));
  });

  it("Tạm dừng: đòi lý do ≥ 10 ký tự — thiếu ⇒ lỗi cạnh ô, `doi` KHÔNG được gọi; đủ ⇒ gửi lý do đã trim", async () => {
    const doi = vi.fn(async () => OK_DOI("SUSPENDED"));
    render(<NutDoiTrangThaiDoiTac doiTac={dt()} doi={doi} />);
    fireEvent.click(screen.getByRole("button", { name: NUT }));
    fireEvent.click(screen.getByRole("radio", { name: /Tạm dừng/ }));
    expect(screen.getByText(/Lý do \(tối thiểu 10 ký tự\)/)).toBeTruthy();
    const ly = screen.getByLabelText(/Lý do/);
    fireEvent.click(screen.getByRole("button", { name: "Tạm dừng" }));
    expect(await screen.findByText("Nhập lý do từ 10 ký tự.")).toBeTruthy();
    expect(ly.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(ly, { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạm dừng" }));
    expect(doi).not.toHaveBeenCalled();
    fireEvent.change(ly, { target: { value: "  Đối tác ngưng hợp tác tạm thời  " } });
    fireEvent.click(screen.getByRole("button", { name: "Tạm dừng" }));
    await waitFor(() => expect(doi).toHaveBeenCalledTimes(1));
    expect(doi).toHaveBeenCalledWith({ id: "dt-1", updatedAtDaThay: MOC, den: "SUSPENDED", lyDo: "Đối tác ngưng hợp tác tạm thời" });
  });

  it("chưa chọn đích mà bấm xác nhận ⇒ báo «Chọn trạng thái muốn chuyển sang»; `doi` không gọi", async () => {
    const doi = vi.fn();
    render(<NutDoiTrangThaiDoiTac doiTac={dt()} doi={doi} />);
    fireEvent.click(screen.getByRole("button", { name: NUT }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect(await screen.findByText("Chọn trạng thái muốn chuyển sang.")).toBeTruthy();
    expect(doi).not.toHaveBeenCalled();
  });

  it("máy chủ từ chối: «vừa đổi» ⇒ banner CÓ «Tải lại»; lỗi khác ⇒ banner KHÔNG nút; hộp thoại vẫn mở, không refresh", async () => {
    const doi1 = vi.fn(async (): Promise<KetQuaDoiTrangThaiDoiTac> => ({ ok: false, loi: "Đối tác vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" }));
    render(<NutDoiTrangThaiDoiTac doiTac={dt({ trangThai: "PENDING" })} doi={doi1} />);
    fireEvent.click(screen.getByRole("button", { name: NUT }));
    fireEvent.click(screen.getByRole("radio", { name: /Duyệt/ }));
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    expect(await screen.findByRole("button", { name: "Tải lại" })).toBeTruthy();
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    cleanup();

    const doi2 = vi.fn(async (): Promise<KetQuaDoiTrangThaiDoiTac> => ({ ok: false, loi: "Không có quyền quản lý đối tác Affiliate (affiliates:manage).", truong: "quyen" }));
    render(<NutDoiTrangThaiDoiTac doiTac={dt({ trangThai: "PENDING" })} doi={doi2} />);
    fireEvent.click(screen.getByRole("button", { name: NUT }));
    fireEvent.click(screen.getByRole("radio", { name: /Duyệt/ }));
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    const hop = await screen.findByRole("alert");
    expect(hop.textContent).toContain("affiliates:manage");
    expect(screen.queryByRole("button", { name: "Tải lại" })).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("lỗi `lyDo` từ máy chủ nằm CẠNH ô lý do (không phải banner)", async () => {
    const doi = vi.fn(async (): Promise<KetQuaDoiTrangThaiDoiTac> => ({ ok: false, loi: "Nhập lý do từ 10 ký tự.", truong: "lyDo" }));
    render(<NutDoiTrangThaiDoiTac doiTac={dt({ trangThai: "PENDING" })} doi={doi} />);
    fireEvent.click(screen.getByRole("button", { name: NUT }));
    fireEvent.click(screen.getByRole("radio", { name: /Duyệt/ }));
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    const loi = await screen.findByText("Nhập lý do từ 10 ký tự.");
    expect(loi.id).toMatch(/loi-ly-do$/);
  });
});
