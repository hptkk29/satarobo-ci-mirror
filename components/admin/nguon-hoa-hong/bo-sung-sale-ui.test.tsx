// @vitest-environment jsdom
/**
 * [BSS-UI-*] — NÚT + SHEET «BỔ SUNG SALE PHỤ TRÁCH PHỤ HUYNH» trên PHẦN TỬ THẬT (jsdom); hàm gọi máy chủ được TIÊM.
 *
 *   [BSS-UI-01] khối Nguồn của lead: nút CHỈ khi `boSungSale.kieu === "DUOC"`; mỗi kiểu còn lại nói đúng điều của nó và KHÔNG có nút (đối chứng dương ngay trong ca)
 *   [BSS-UI-02] Sheet: nhãn «Sale phụ trách phụ huynh» (không phải «Nhân sự giới thiệu»); thiếu người / thiếu lý do ⇒ lỗi CẠNH ô và KHÔNG gọi máy chủ
 *   [BSS-UI-03] lưu hợp lệ ⇒ gọi `bo` ĐÚNG một lần với employeeId đã chọn · lý do đã trim · mốc khoá lạc quan của màn hình; xong ⇒ toast + đóng + refresh
 *   [BSS-UI-04] máy chủ từ chối: lỗi ô map về đúng ô; «vừa bị đổi» có nút «Tải lại»; lỗi khác là banner KHÔNG nút; Sheet vẫn mở
 *   [BSS-UI-05] lead đã có khoản thu ⇒ cảnh báo hệ quả bằng SỐ; chưa thu ⇒ không cảnh báo
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
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/leads/nguon-actions", () => ({
  moGanNguonAction: vi.fn(),
  doiNguonLeadAction: vi.fn(),
  timNguoiGioiThieuAction: vi.fn(),
  boSungSalePhuHuynhAction: vi.fn(),
}));

import type { NguoiDaChon } from "@/lib/nguon/chon-nguon";
import type { ChoGanNguon } from "@/lib/nguon/doc-gan-nguon";
import type { NutBoSungSale } from "@/lib/nguon/bo-sung-sale";
import type { KetQuaDoiNguonAction } from "@/lib/nguon/ket-qua-action";
import { BoSungSaleSheet } from "./bo-sung-sale-sheet";
import { KhoiNguonLead } from "./khoi-nguon-lead";
import type { HamTim } from "./referrer-picker";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOC = "2026-10-05T03:00:00.000Z";
const SALE: NguoiDaChon = { loai: "NHAN_SU", employeeId: "e-sale-77", ten: "Lê Thị Liên", ma: "SR.NV.02 · CS1", vai: "SALE" };
const LY_DO = "Hồ sơ ghi danh của bé anh do chị Liên chốt";

const du = (boSungSale: NutBoSungSale, p: Partial<ChoGanNguon> = {}): ChoGanNguon => ({
  leadId: "lead-1",
  tenLead: "Ngô Mai My",
  coSo: { code: "CS1", name: "Trụ sở chính" },
  duongVao: "qua-tang",
  nguon: {
    groupId: "g1",
    groupCode: "PARENT_REFERRAL",
    groupName: "Nguồn từ phụ huynh giới thiệu",
    giaiTrinh: null,
    nguoi: { loai: "PHU_HUYNH", ten: "Nguyễn Thị Mận", ma: "HV01", moTa: "phụ huynh của bé An" },
    thieuNguoi: false,
    khoa: false,
    canhBao: [],
    xemTay: ["THIEU_SALE_PH"],
    vanDe: [],
    cachXacDinh: "PARENT_REFERRAL",
    luat: "PH_GIOI_THIEU",
    ngayGhiCong: "2026-09-29T03:00:00.000Z",
    hanGhiCong: "2026-12-28T16:59:59.999Z",
    conHanGhiCong: true,
    nhanGoc: null,
    capNhatLuc: MOC,
  },
  danhMuc: [],
  quyen: { ok: true },
  boSungSale,
  thucThu: null,
  ...p,
});

const NUT = "Bổ sung Sale phụ trách phụ huynh của lead này";

// ═══ [BSS-UI-01] khối Nguồn ═════════════════════════════════════════════════════════════════════════════
describe("[BSS-UI-01] KhoiNguonLead — nút «Bổ sung Sale phụ trách» vẽ THEO quyết định của máy chủ", () => {
  it("DUOC ⇒ CÓ nút (đối chứng dương); mỗi kiểu còn lại ⇒ KHÔNG nút và nói đúng điều của nó", () => {
    render(<KhoiNguonLead coTheMoLead du={du({ kieu: "DUOC" })} />);
    expect(screen.getByRole("button", { name: NUT })).toBeTruthy();
    expect(screen.getByText(/Chưa xác định Sale phụ trách phụ huynh giới thiệu/)).toBeTruthy();
    cleanup();

    render(<KhoiNguonLead coTheMoLead du={du({ kieu: "KHONG_CAN" })} />);
    expect(screen.queryByRole("button", { name: NUT })).toBeNull();
    expect(screen.queryByText(/Chưa xác định Sale phụ trách/)).toBeNull();
    cleanup();

    // THIEU_QUYEN: nút «Đổi nguồn» cũng không có (quyen.ok=false) ⇒ không nút nào; khoá còn thiếu vẫn được nêu bởi dòng quyền sẵn có
    render(
      <KhoiNguonLead
        coTheMoLead
        du={du(
          { kieu: "THIEU_QUYEN", thieu: ["sources:override-after-payment"], loi: "x" },
          { quyen: { ok: false, loi: "x", thieu: ["sources:override-after-payment"], maChan: "DOI_SAU_TT" } },
        )}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Chưa xác định Sale phụ trách phụ huynh giới thiệu/)).toBeTruthy();
    expect(screen.getByText("sources:override-after-payment")).toBeTruthy();
  });

  it("NGUON_NGUNG ⇒ KHÔNG nút; người có sources:manage thấy đường «Mở nguồn để bật lại» tới ĐÚNG nguồn, người không có thì được dặn xin khoá (không có đường dẫn)", () => {
    const ngung = (coTheMoLai: boolean): NutBoSungSale => ({ kieu: "NGUON_NGUNG", maNguon: "PARENT_REFERRAL", tenNguon: "Nguồn từ phụ huynh giới thiệu", lyDo: "TRANG_THAI", coTheMoLai });
    render(<KhoiNguonLead coTheMoLead du={du(ngung(true))} />);
    expect(screen.queryByRole("button", { name: NUT })).toBeNull();
    expect(screen.getByText(/đang ngừng hoặc chưa kích hoạt nên chưa bổ sung được/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mở nguồn để bật lại" }).getAttribute("href")).toBe("/nguon-hoa-hong/nguon/PARENT_REFERRAL");
    cleanup();
    render(<KhoiNguonLead coTheMoLead du={du(ngung(false))} />);
    expect(screen.queryByRole("button", { name: NUT })).toBeNull();
    expect(screen.queryByRole("link", { name: "Mở nguồn để bật lại" })).toBeNull();
    expect(screen.getByText("sources:manage")).toBeTruthy();
  });
});

// ═══ Sheet ══════════════════════════════════════════════════════════════════════════════════════════════
function dung(over: { bo?: (i: Parameters<NonNullable<React.ComponentProps<typeof BoSungSaleSheet>["bo"]>>[0]) => Promise<KetQuaDoiNguonAction>; soKhoanThu?: number | null } = {}) {
  const bo = vi.fn(over.bo ?? (async () => ({ ok: true as const, canDieuChinh: false })));
  const tim = vi.fn<HamTim>(async () => ({ ok: true, ketQua: [SALE] }));
  render(
    <BoSungSaleSheet leadId="lead-1" tenLead="Ngô Mai My" tenPhuHuynh="Nguyễn Thị Mận" soKhoanThu={over.soKhoanThu ?? null} capNhatLuc={MOC} bo={bo} tim={tim} triggerAriaLabel={NUT}>
      Bổ sung Sale phụ trách
    </BoSungSaleSheet>,
  );
  return { bo, tim };
}
const mo = () => fireEvent.click(screen.getByRole("button", { name: NUT }));
const chonSale = async () => {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Liên" } });
  fireEvent.click(await screen.findByRole("option", { name: /Lê Thị Liên/ }));
};
const nhapLyDo = (v: string) => fireEvent.change(screen.getByLabelText(/Lý do bổ sung/), { target: { value: v } });
const luu = () => fireEvent.click(screen.getByRole("button", { name: "Lưu Sale phụ trách" }));

describe("[BSS-UI-02] Sheet — nhãn đúng nghĩa; thiếu người / thiếu lý do ⇒ lỗi cạnh ô, KHÔNG gọi máy chủ", () => {
  it("ô tìm gọi là «Sale phụ trách phụ huynh», KHÔNG phải «Nhân sự giới thiệu»; tên phụ huynh giới thiệu được nêu", () => {
    dung();
    mo();
    expect(screen.getByLabelText("Sale phụ trách phụ huynh")).toBeTruthy();
    expect(screen.queryByText("Nhân sự giới thiệu")).toBeNull();
    expect(screen.getByText("Nguyễn Thị Mận")).toBeTruthy();
  });

  it("bấm Lưu khi trống ⇒ cả hai lỗi, ô lỗi có aria-invalid, `bo` KHÔNG được gọi; chọn người + lý do 9 ký tự ⇒ vẫn chặn ở lý do", async () => {
    const { bo } = dung();
    mo();
    luu();
    expect(await screen.findByText("Chọn nhân sự đang phụ trách phụ huynh này.")).toBeTruthy();
    expect(screen.getByText(/Lý do phải từ 10 ký tự/)).toBeTruthy();
    expect(screen.getByRole("combobox").getAttribute("aria-invalid")).toBe("true");
    expect(bo).not.toHaveBeenCalled();
    await chonSale();
    nhapLyDo("ngắn quá!"); // 9 ký tự
    luu();
    expect(screen.getByText(/Lý do phải từ 10 ký tự/)).toBeTruthy();
    expect(bo).not.toHaveBeenCalled();
  });
});

describe("[BSS-UI-03] lưu hợp lệ", () => {
  it("gọi `bo` ĐÚNG MỘT lần với employeeId đã chọn · lý do đã trim · mốc khoá lạc quan; xong ⇒ toast, refresh, Sheet đóng", async () => {
    // Cấy: gửi `nguoi.ma` thay `employeeId` · bỏ `.trim()` · bỏ `expectedUpdatedAt` ⇒ đỏ.
    const { bo } = dung();
    mo();
    await chonSale();
    nhapLyDo(`  ${LY_DO}  `);
    luu();
    await waitFor(() => expect(bo).toHaveBeenCalledTimes(1));
    expect(bo).toHaveBeenCalledWith({ leadId: "lead-1", saleEmployeeId: "e-sale-77", lyDo: LY_DO, expectedUpdatedAt: MOC });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
    expect(TOAST.success).toHaveBeenCalledWith(expect.stringContaining("Lê Thị Liên"));
    expect(TOAST.info).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("form", { name: "Bổ sung Sale phụ trách phụ huynh" })).toBeNull());
  });

  it("máy chủ báo canDieuChinh (lead đã có thu) ⇒ thêm toast thông tin", async () => {
    dung({ bo: async () => ({ ok: true, canDieuChinh: true }) });
    mo();
    await chonSale();
    nhapLyDo(LY_DO);
    luu();
    await waitFor(() => expect(TOAST.info).toHaveBeenCalledTimes(1));
  });
});

describe("[BSS-UI-04] máy chủ từ chối", () => {
  async function guiVaTuChoi(ketQua: KetQuaDoiNguonAction) {
    const r = dung({ bo: async () => ketQua });
    mo();
    await chonSale();
    nhapLyDo(LY_DO);
    luu();
    await waitFor(() => expect(r.bo).toHaveBeenCalledTimes(1));
    return r;
  }

  it("lỗi `thamChieu` (vd TU_CLAIM) nằm CẠNH ô chọn người; Sheet vẫn mở; không refresh, không toast thành công", async () => {
    await guiVaTuChoi({ ok: false, error: "Người phụ trách lead này không thể đồng thời là người hưởng hoa hồng giới thiệu.", field: "thamChieu" });
    expect(await screen.findByText(/không thể đồng thời là người hưởng/)).toBeTruthy();
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    expect(TOAST.success).not.toHaveBeenCalled();
    // findBy (không getBy): sau lỗi máy chủ nút còn nhãn «Đang ghi...» cho tới khi transition lắng — tải máy cao thì khẳng định đứng trước lúc đó (đỏ giả).
    expect(await screen.findByRole("button", { name: "Lưu Sale phụ trách" })).toBeTruthy();
  });

  it("lỗi `lyDo` nằm cạnh ô lý do", async () => {
    await guiVaTuChoi({ ok: false, error: "Lý do đổi nguồn phải từ 10 ký tự.", field: "lyDo" });
    expect((await screen.findByText("Lý do đổi nguồn phải từ 10 ký tự.")).id).toBe("bs-ly-do-loi");
  });

  it("«vừa bị đổi» ⇒ banner CÓ nút «Tải lại»; lỗi khác (quyền) ⇒ banner KHÔNG nút (đối chứng)", async () => {
    await guiVaTuChoi({ ok: false, error: "Nguồn của lead vừa được người khác thay đổi — hãy tải lại rồi thử lại.", field: "nguonVuaDoi" });
    expect(await screen.findByRole("button", { name: "Tải lại" })).toBeTruthy();
    cleanup();
    vi.clearAllMocks();
    await guiVaTuChoi({ ok: false, error: "Bạn không có quyền đổi nguồn lead.", field: "quyen" });
    expect((await screen.findByRole("alert", {})).textContent).toContain("Bạn không có quyền đổi nguồn lead.");
    expect(screen.queryByRole("button", { name: "Tải lại" })).toBeNull();
  });

  it("máy chủ ném lỗi mạng ⇒ banner «Không lưu được lúc này», không treo nút Lưu", async () => {
    const r = dung({
      bo: async () => {
        throw new Error("net");
      },
    });
    mo();
    await chonSale();
    nhapLyDo(LY_DO);
    luu();
    expect(await screen.findByText(/Không lưu được lúc này/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Lưu Sale phụ trách" }) as HTMLButtonElement).disabled).toBe(false));
    expect(r.bo).toHaveBeenCalledTimes(1);
  });
});

describe("[BSS-UI-05] hệ quả với khoản thu", () => {
  it("đã có thu ⇒ cảnh báo kèm SỐ khoản; chưa thu ⇒ không cảnh báo", () => {
    dung({ soKhoanThu: 3 });
    mo();
    const canhBao = screen.getByText(/Lead đã có/).closest("p")!;
    expect(canhBao.textContent).toMatch(/Lead đã có 3 khoản thu/);
    expect(canhBao.textContent).toMatch(/không bị sửa/);
    cleanup();
    dung({ soKhoanThu: null });
    mo();
    expect(screen.queryByText(/khoản thu/)).toBeNull();
  });
});

describe("[W4-BSS-01] câu nói hoa hồng đang chờ ở ĐÚNG chỗ (tab Sổ), không phải «hàng chờ nguồn»", () => {
  it("DUOC ⇒ nói tab «Sổ hoa hồng»; không còn câu «hàng chờ nguồn» (hold THIEU_SALE_PHU_HUYNH sống ở tab Sổ)", () => {
    render(<KhoiNguonLead coTheMoLead du={du({ kieu: "DUOC" })} />);
    expect(screen.getByText(/đang chờ ở tab «Sổ hoa hồng»/)).toBeTruthy();
    expect(screen.queryByText(/hàng chờ nguồn/)).toBeNull();
  });
});
