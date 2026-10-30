// @vitest-environment jsdom
// [NLG] Giao diện màn «Ngoại lệ»: danh sách (cả dòng bấm tới hồ sơ, nút nổi trên lớp phủ, nhãn có CHỮ), nút nói thật (tối kèm lý do), hộp xác nhận đòi lý do, bốn trạng thái của trang.
// Action giả — cổng thật do `tests/ai-lead/ngoai-le.spec.ts` canh.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bangNutNgoaiLe, type DauVaoNutNgoaiLe } from "@/lib/ai-lead/dich-vu/ngoai-le-thuan";
import type { HangNgoaiLe, KetQuaDanhSachNgoaiLe } from "@/lib/ai-lead/dich-vu/ngoai-le";

const m = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastOk: vi.fn(),
  toastErr: vi.fn(),
  thuLai: vi.fn(),
  danhDau: vi.fn(),
  giao: vi.fn(),
  auth: vi.fn(),
  checkAnyPermission: vi.fn(),
  resolveActor: vi.fn(),
  canViewLeadPii: vi.fn(),
  danhSach: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: vi.fn(), replace: vi.fn() }), redirect: (to: string) => m.redirect(to) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock("sonner", () => ({ toast: { success: m.toastOk, error: m.toastErr } }));
vi.mock("./_actions", () => ({ thuLaiTaoLeadAction: m.thuLai, danhDauDaXuLyAction: m.danhDau, giaoNguoiAction: m.giao }));
vi.mock("@/lib/auth", () => ({ auth: () => m.auth() }));
vi.mock("@/lib/auth/check-permission", () => ({ checkAnyPermission: (...a: unknown[]) => m.checkAnyPermission(...a), canViewLeadPii: () => m.canViewLeadPii() }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: (...a: unknown[]) => m.resolveActor(...a) }));
vi.mock("@/lib/ai-lead/dich-vu/ngoai-le", async (goc) => ({ ...(await goc<typeof import("@/lib/ai-lead/dich-vu/ngoai-le")>()), danhSachNgoaiLe: (...a: unknown[]) => m.danhSach(...a) }));

import { DanhSachNgoaiLe } from "./_components/danh-sach-ngoai-le";
import { BoLocNgoaiLe } from "./_components/bo-loc-ngoai-le";
import { HanhDongNgoaiLe } from "./_components/hanh-dong-ngoai-le";
import { NoiDungNgoaiLe } from "./_components/noi-dung-ngoai-le";
import NgoaiLePage from "./page";

const NUT_GOC: DauVaoNutNgoaiLe = {
  loai: "SYSTEM_EXCEPTION",
  state: "SYSTEM_EXCEPTION",
  coQuyenXuLy: true,
  claimedById: null,
  claimedBoiToi: false,
  claimedTen: null,
  thieu: [],
  thuLaiDuoc: true,
  leadId: null,
  leadDaCoNguoi: null,
  soUngVien: 1,
};

function hang(o: Partial<Omit<HangNgoaiLe, "nut">> & { nut?: Partial<DauVaoNutNgoaiLe> } = {}): HangNgoaiLe {
  const { nut, ...rest } = o;
  const goc: HangNgoaiLe = {
    id: "ATLC_d-abcdef1234",
    loai: "SYSTEM_EXCEPTION",
    state: "SYSTEM_EXCEPTION",
    version: 5,
    fbName: "Nguyễn Thị Lan",
    pageId: "104500000000777",
    centerId: "cs-a",
    centerTen: "Cơ sở A",
    claimedById: null,
    claimedTen: null,
    claimedBoiToi: false,
    mucSla: "KHONG_AP_DUNG",
    nhanTuoi: "Lỗi cách đây",
    tuoiMs: 3 * 3_600_000,
    lyDo: { ma: "INGEST_NEM_LOI", cau: "Hệ thống gặp lỗi khi ghi lead vào CRM.", goiY: "Thường là lỗi tạm thời.", thuLaiDuoc: true },
    thieu: [],
    leadId: null,
    leadDaCoNguoi: null,
    coQuyenXuLy: true,
    ungVien: [{ id: "u2", ten: "Chị Hoa" }],
    nut: bangNutNgoaiLe({ ...NUT_GOC, ...nut }),
    ...rest,
  };
  return goc;
}

const ketQua = (hangs: HangNgoaiLe[]): KetQuaDanhSachNgoaiLe => ({
  hang: hangs,
  tong: hangs.length,
  biCat: false,
  dem: { SYSTEM_EXCEPTION: hangs.filter((h) => h.loai === "SYSTEM_EXCEPTION").length, ASSIGNMENT_PENDING: hangs.filter((h) => h.loai === "ASSIGNMENT_PENDING").length, QUA_HAN_SLA: hangs.filter((h) => h.loai === "QUA_HAN_SLA").length },
  tuyChon: { pages: ["104500000000777"], coSo: [{ id: "cs-a", ten: "Cơ sở A" }] },
});

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.redirect.mockImplementation((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  });
  m.thuLai.mockResolvedValue({ ok: true, data: {} });
  m.danhDau.mockResolvedValue({ ok: true, data: {} });
  m.giao.mockResolvedValue({ ok: true, data: {} });
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.checkAnyPermission.mockResolvedValue(true);
  m.canViewLeadPii.mockResolvedValue(true);
  m.resolveActor.mockResolvedValue({ userId: "u1" });
  m.danhSach.mockResolvedValue(ketQua([hang()]));
});
afterEach(() => cleanup());

describe("[NLG] danh sách", () => {
  it("[NLG-01] cả dòng bấm tới hồ sơ (liên kết phủ dòng, dòng có cursor-pointer VÌ nó bấm được); nhãn loại có CHỮ; lý do bằng tiếng Việt kèm mã tra cứu", () => {
    render(<DanhSachNgoaiLe hang={[hang()]} khoaTrang="{}" />);
    const lk = screen.getByRole("link", { name: "Nguyễn Thị Lan" });
    expect(lk).toHaveAttribute("href", "/ai-lead/ATLC_d-abcdef1234");
    expect(lk.className).toContain("after:inset-0");
    expect(lk.closest("tr")!.className).toContain("cursor-pointer");
    expect(screen.getByText("Lỗi tạo lead")).toBeInTheDocument();
    expect(screen.getByText("Hệ thống gặp lỗi khi ghi lead vào CRM.")).toBeInTheDocument();
    expect(screen.getByText(/mã INGEST_NEM_LOI/)).toBeInTheDocument();
    expect(screen.getByText(/Lỗi cách đây 3 giờ/)).toBeInTheDocument();
    // Nút nổi TRÊN lớp phủ của liên kết dòng — thiếu `z-10` thì bấm nút lại mở hồ sơ (luật 12: lớp phủ nuốt nút).
    for (const ten of ["Thử lại", "Giao người"]) {
      const cls = screen.getByRole("button", { name: ten }).className;
      expect(cls, ten).toContain("relative");
      expect(cls, ten).toContain("z-10");
    }
  });

  it("[NLG-02] một cây DOM cho cả bảng lẫn thẻ: nhãn cột dưới 1536px lấy từ data-nhan; tiêu đề cột còn cho trình đọc màn hình", () => {
    render(<DanhSachNgoaiLe hang={[hang()]} khoaTrang="{}" />);
    expect(document.querySelectorAll("table")).toHaveLength(1);
    expect(document.querySelector('td[data-nhan="Cơ sở"]')).toHaveTextContent("Cơ sở A");
    expect(document.querySelector("thead")!.className).toContain("max-2xl:sr-only");
    expect(document.querySelector("tbody")!.className).toContain("max-2xl:grid");
  });

  it("[NLG-02b] ô «Tuổi» chỉ nowrap ở dạng BẢNG (≥1536px); ở dạng thẻ phải xuống dòng — «Chờ phân công cách đây 39 giờ» + nhãn rộng 218px+ vượt thẻ 248px ở 280px (đo 28/10/2026)", () => {
    render(<DanhSachNgoaiLe hang={[hang()]} khoaTrang="{}" />);
    const o = document.querySelector('td[data-nhan="Tuổi"] > span')!;
    expect(o.className).toContain("whitespace-normal");
    expect(o.className).toContain("2xl:whitespace-nowrap");
  });

  it("[NLG-03] lead chưa có sale: có liên kết «Mở lead để giao sale» (không tự chia) và KHÔNG có nút Thử lại / Giao người", () => {
    const ap = hang({ id: "ATLC_ap", loai: "ASSIGNMENT_PENDING", state: "ASSIGNMENT_PENDING", leadId: "lead-1", leadDaCoNguoi: false, ungVien: [], nut: { loai: "ASSIGNMENT_PENDING", state: "ASSIGNMENT_PENDING", leadId: "lead-1", leadDaCoNguoi: false, soUngVien: 0 } });
    render(<DanhSachNgoaiLe hang={[ap]} khoaTrang="{}" />);
    expect(screen.getByRole("link", { name: "Mở lead để giao sale" })).toHaveAttribute("href", "/leads/lead-1");
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Giao người" })).toBeNull();
    const dd = screen.getByRole("button", { name: "Đánh dấu đã xử lý" });
    expect(dd).toBeDisabled();
    expect(screen.getByText(/Lead chưa có người phụ trách/)).toBeInTheDocument(); // lý do tối bằng CHỮ, không chỉ tooltip
  });

  it("[NLG-03b] lead ĐÃ có sale: dòng KHÔNG còn nói «chưa có sale» / «giao sale», liên kết đổi thành «Xem lead», nút Đánh dấu sáng — mọi thứ cùng một sự thật", () => {
    const ap = hang({
      id: "ATLC_ap2",
      loai: "ASSIGNMENT_PENDING",
      state: "ASSIGNMENT_PENDING",
      leadId: "lead-2",
      leadDaCoNguoi: true,
      lyDo: { ma: null, cau: "Lead đã có sale phụ trách; hồ sơ AI chỉ còn chờ được đóng.", goiY: "Bấm «Đánh dấu đã xử lý» để đóng ngoại lệ này.", thuLaiDuoc: false },
      ungVien: [],
      nut: { loai: "ASSIGNMENT_PENDING", state: "ASSIGNMENT_PENDING", leadId: "lead-2", leadDaCoNguoi: true, soUngVien: 0 },
    });
    render(<DanhSachNgoaiLe hang={[ap]} khoaTrang="{}" />);
    expect(screen.getByRole("link", { name: "Xem lead" })).toHaveAttribute("href", "/leads/lead-2");
    expect(screen.queryByRole("link", { name: "Mở lead để giao sale" })).toBeNull();
    expect(screen.getByRole("button", { name: "Đánh dấu đã xử lý" })).toBeEnabled();
    expect(document.body.textContent).not.toContain("chưa có sale");
    expect(screen.getByText("Chờ đóng hồ sơ")).toBeInTheDocument(); // nhãn loại cũng đổi theo sự thật
  });

  it("[NLG-04] chỉ có quyền xem ⇒ không nút nào, có ghi chú; liên kết mở hồ sơ vẫn còn", () => {
    render(<DanhSachNgoaiLe hang={[hang({ coQuyenXuLy: false, nut: { coQuyenXuLy: false } })]} khoaTrang="{}" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/ai-leads:review/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nguyễn Thị Lan" })).toBeInTheDocument();
  });

  it("[NLG-05] tên bị che theo quyền được in nguyên như server gửi (không tự dựng lại); thiếu tên ⇒ nói thẳng", () => {
    render(<DanhSachNgoaiLe hang={[hang({ fbName: "N***n" }), hang({ id: "ATLC_2", fbName: null })]} khoaTrang="{}" />);
    expect(screen.getByRole("link", { name: "N***n" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "(chưa có tên Facebook)" })).toBeInTheDocument();
  });
});

describe("[NLG] nút hành động", () => {
  function dung(h: HangNgoaiLe) {
    return render(<HanhDongNgoaiLe draftId={h.id} version={h.version} nut={h.nut} ungVien={h.ungVien} tenHoSo={h.fbName ?? "hồ sơ"} />);
  }

  it("[NLG-10] Thử lại: mở hộp xác nhận, nút xác nhận KHOÁ tới khi lý do ≥10 ký tự; gửi đúng draftId + version + lý do đã cắt khoảng trắng; xong thì làm mới trang", async () => {
    dung(hang());
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    const xn = await screen.findByRole("button", { name: "Thử lại tạo lead" });
    expect(xn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "  đã kiểm tra mạng  " } });
    expect(xn).toBeEnabled();
    fireEvent.click(xn);
    await waitFor(() => expect(m.thuLai).toHaveBeenCalledTimes(1));
    expect(m.thuLai).toHaveBeenCalledWith({ draftId: "ATLC_d-abcdef1234", version: 5, lyDo: "đã kiểm tra mạng" });
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
    expect(m.toastOk).toHaveBeenCalled();
  });

  it("[NLG-11] máy chủ từ chối ⇒ hộp GIỮ NGUYÊN và hiện câu lỗi (không đóng như thể đã làm), không làm mới trang", async () => {
    m.thuLai.mockResolvedValue({ ok: false, error: { code: "THIEU_DIEU_KIEN", message: "Số điện thoại chưa hợp lệ. Mở hồ sơ để bổ sung." } });
    dung(hang());
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    fireEvent.change(await screen.findByLabelText(/Lý do/), { target: { value: "Thử lại lần hai nhé" } });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại tạo lead" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Số điện thoại chưa hợp lệ");
    expect(m.refresh).toHaveBeenCalled(); // thất bại vẫn làm mới (version có thể đã đổi); hộp thoại GIỮ NGUYÊN
    // useTransition chưa kịp trả nút về nhãn cũ ngay lúc câu lỗi hiện ⇒ chờ, không đọc ngay (luật 18: không phụ thuộc thứ tự cập nhật).
    await waitFor(() => expect(screen.getByRole("button", { name: "Thử lại tạo lead" })).toBeInTheDocument());
  });

  it("[NLG-12] Thử lại TỐI kèm lý do bằng chữ khi lỗi do dữ liệu / người khác giữ — bấm không gọi action", () => {
    dung(hang({ nut: { thuLaiDuoc: false } }));
    const nut = screen.getByRole("button", { name: "Thử lại" });
    expect(nut).toBeDisabled();
    expect(screen.getByText(/thử lại sẽ lỗi lại/)).toBeInTheDocument();
    fireEvent.click(nut);
    expect(m.thuLai).not.toHaveBeenCalled();
    cleanup();
    dung(hang({ nut: { claimedById: "u9", claimedTen: "Chị Hoa" } }));
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeDisabled();
    expect(screen.getAllByText(/Đang do Chị Hoa xử lý/).length).toBeGreaterThan(0);
  });

  it("[NLG-13] Đánh dấu đã xử lý: lead đã có sale ⇒ sáng, gửi đúng lệnh", async () => {
    const ap = hang({ loai: "ASSIGNMENT_PENDING", state: "ASSIGNMENT_PENDING", leadId: "l1", leadDaCoNguoi: true, nut: { loai: "ASSIGNMENT_PENDING", state: "ASSIGNMENT_PENDING", leadId: "l1", leadDaCoNguoi: true } });
    dung(ap);
    fireEvent.click(screen.getByRole("button", { name: "Đánh dấu đã xử lý" }));
    fireEvent.change(await screen.findByLabelText(/Lý do/), { target: { value: "Sale đã nhận lead rồi" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Đánh dấu đã xử lý" }).at(-1)!);
    await waitFor(() => expect(m.danhDau).toHaveBeenCalledWith({ draftId: "ATLC_d-abcdef1234", version: 5, lyDo: "Sale đã nhận lead rồi" }));
  });

  it("[NLG-14] Giao người: phải chọn người nhận mới bấm được; gửi nguoiNhanId đã chọn; lỗi giữ hộp", async () => {
    m.giao.mockResolvedValueOnce({ ok: false, error: { code: "NGUOI_NHAN_KHONG_HOP_LE", message: "Người này không có quyền xử lý hồ sơ của cơ sở này." } });
    dung(hang());
    fireEvent.click(screen.getByRole("button", { name: "Giao người" }));
    const gui = await screen.findByRole("button", { name: /Giao hồ sơ/ });
    expect(gui).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Người nhận"), { target: { value: "u2" } });
    expect(gui).toBeEnabled();
    fireEvent.click(gui);
    expect(await screen.findByRole("alert")).toHaveTextContent("không có quyền");
    expect(m.giao).toHaveBeenCalledWith({ draftId: "ATLC_d-abcdef1234", version: 5, nguoiNhanId: "u2" });
    m.giao.mockResolvedValueOnce({ ok: true, data: {} });
    // useTransition chưa kịp trả nút về nhãn «Giao hồ sơ» ngay lúc câu lỗi hiện ⇒ chờ (luật 18).
    fireEvent.click(await screen.findByRole("button", { name: /Giao hồ sơ/ }));
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
  });

  it("[NLG-15] Giao người TỐI khi không còn ứng viên, kèm lý do", () => {
    dung(hang({ ungVien: [], nut: { soUngVien: 0 } }));
    expect(screen.getByRole("button", { name: "Giao người" })).toBeDisabled();
    expect(screen.getByText(/Không có quản lý nào khác/)).toBeInTheDocument();
  });
});

describe("[NLG] bộ lọc", () => {
  it("[NLG-20] thẻ loại là liên kết thật kèm số đếm; thẻ đang chọn có aria-current; giữ bộ lọc khác khi đổi loại", () => {
    render(<BoLocNgoaiLe loc={{ loai: "SYSTEM_EXCEPTION", pageId: "p1" }} dem={{ SYSTEM_EXCEPTION: 3, ASSIGNMENT_PENDING: 2, QUA_HAN_SLA: 1 }} pages={["p1"]} coSo={[]} />);
    const nav = screen.getByRole("navigation", { name: "Loại ngoại lệ" });
    expect(within(nav).getByRole("link", { name: /Lỗi tạo lead/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /Tất cả/ })).toHaveTextContent("6");
    expect(within(nav).getByRole("link", { name: /Quá hạn SLA/ })).toHaveAttribute("href", "/ai-lead/ngoai-le?loai=qua-han&page=p1");
    expect(within(nav).getByRole("link", { name: /Tất cả/ })).not.toHaveAttribute("aria-current");
    expect(document.querySelector('input[name="loai"]')).toHaveValue("loi");
  });
});

describe("[NLG] trạng thái của trang", () => {
  const sp = (o: Record<string, string> = {}) => Promise.resolve(o);

  it("[NLG-30] chưa đăng nhập ⇒ về /login, không đọc dữ liệu", async () => {
    m.auth.mockResolvedValue(null);
    await expect(NgoaiLePage({ searchParams: sp() })).rejects.toThrow("REDIRECT:/login?callbackUrl=%2Fai-lead%2Fngoai-le");
    expect(m.danhSach).not.toHaveBeenCalled();
  });

  it("[NLG-31] KHÔNG CÓ QUYỀN ⇒ nói rõ thiếu quyền nào, hỏi ai; cổng hỏi ĐÚNG khoá xem của «Hồ sơ chờ AI»; không đọc dữ liệu", async () => {
    m.checkAnyPermission.mockResolvedValue(false);
    render(await NgoaiLePage({ searchParams: sp() }));
    expect(m.checkAnyPermission).toHaveBeenCalledWith(["ai-leads:view"]);
    expect(screen.getByText(/ai-leads:view/)).toBeInTheDocument();
    expect(m.danhSach).not.toHaveBeenCalled();
  });

  it("[NLG-32] RỖNG: nói vì sao + làm gì tiếp (không lọc vs có lọc)", async () => {
    m.danhSach.mockResolvedValue(ketQua([]));
    render(await NoiDungNgoaiLe({ loc: {}, userId: "u1" }));
    expect(screen.getByText("Không có ngoại lệ nào cần xử lý")).toBeInTheDocument();
    cleanup();
    render(await NoiDungNgoaiLe({ loc: { loai: "QUA_HAN_SLA" }, userId: "u1" }));
    expect(screen.getByText("Không có ngoại lệ nào khớp bộ lọc")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Xoá lọc" })).toHaveAttribute("href", "/ai-lead/ngoai-le");
  });

  it("[NLG-33] LỖI đọc ⇒ ErrorState, trang không sập, KHÔNG in nội dung lỗi (có thể kèm PII)", async () => {
    m.danhSach.mockRejectedValue(new Error("Invalid prisma invocation phone=84905123456"));
    render(await NoiDungNgoaiLe({ loc: {}, userId: "u1" }));
    expect(document.body.textContent).toContain("Không đọc được danh sách ngoại lệ");
    expect(document.body.textContent).not.toContain("84905123456");
    expect(document.body.textContent).not.toContain("prisma");
  });

  it("[NLG-33b] LỖI đọc có nút «Tải lại» thật (liên kết về chính URL + bộ lọc, ≥44px) — chữ «Tải lại trang» một mình là lời hứa suông trên điện thoại", async () => {
    m.danhSach.mockRejectedValue(new Error("x"));
    render(await NoiDungNgoaiLe({ loc: { loai: "SYSTEM_EXCEPTION", pageId: "P1" }, userId: "u1" }));
    const nut = screen.getByRole("link", { name: "Tải lại" });
    expect(nut).toHaveAttribute("href", "/ai-lead/ngoai-le?loai=loi&page=P1");
    expect(nut.className).toContain("min-h-11");
  });

  it("[NLG-34] có dữ liệu: truyền canViewPii thật xuống dịch vụ (không mặc định) và dựng danh sách", async () => {
    m.canViewLeadPii.mockResolvedValue(false);
    render(await NoiDungNgoaiLe({ loc: {}, userId: "u1" }));
    expect(m.danhSach.mock.calls[0]![2]).toBe(false);
    expect(screen.getByRole("link", { name: "Nguyễn Thị Lan" })).toBeInTheDocument();
  });

  it("[NLG-35] bị cắt (>300): nói thẳng «hiện N trong M»", async () => {
    m.danhSach.mockResolvedValue({ ...ketQua([hang()]), tong: 412, biCat: true });
    render(await NoiDungNgoaiLe({ loc: {}, userId: "u1" }));
    expect(screen.getByText(/Hiện 1 ngoại lệ đứng đầu trong 412/)).toBeInTheDocument();
  });
});

describe("[NLG-QA3] ô nhập của bộ lọc ≥16px ở di động", () => {
  it("[NLG-QA3-01] mọi ô nhập/chọn dùng text-base và chỉ thu về text-sm từ sm (iOS không phóng to khi focus)", () => {
    const { container } = render(<BoLocNgoaiLe loc={{}} dem={{ SYSTEM_EXCEPTION: 0, ASSIGNMENT_PENDING: 0, QUA_HAN_SLA: 0 }} pages={["p1"]} coSo={[{ id: "c", ten: "CS" }]} />);
    const o = [...container.querySelectorAll("input:not([type=hidden]):not([type=checkbox]), select")];
    expect(o.length).toBeGreaterThanOrEqual(3);
    for (const e of o) {
      expect(e.className).toContain("text-base");
      expect(e.className).toContain("sm:text-sm");
      expect(e.className.split(/\s+/)).not.toContain("text-sm");
    }
  });
});
