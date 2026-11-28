// @vitest-environment jsdom
/**
 * [WUI-*] Tab «Website» (AFF-P0b) — trên PHẦN TỬ THẬT (jsdom). Hàm gọi máy chủ được TIÊM (form · Sheet trang đích) hoặc Server Action được mock (bảng · hộp thoại).
 *
 *   [WUI-01] OTenMien: thêm bằng Enter (không gửi form bao quanh), chuẩn hoá, dán nhiều, mục hỏng ⇒ không thêm gì + lỗi cạnh ô kèm mục hỏng, bỏ chip có tên truy cập
 *   [WUI-02] FormWebsite tạo: trống ⇒ lỗi cạnh ô (không gọi máy chủ); payload đúng; lỗi máy chủ đặt cạnh ĐÚNG ô và biến mất khi sửa ô
 *   [WUI-03] FormWebsite sửa: mã chỉ-đọc; Lưu khoá khi chưa đổi gì; chỉ gửi trường ĐỔI; website cũ gốc URL có đường dẫn vẫn sửa được tên; campaign mặc định đã kết thúc hiện đúng; «vừa đổi» ⇒ banner + Tải lại
 *   [WUI-04] ThuUrl: ĐƯỢC PHÉP / KHÔNG ĐƯỢC PHÉP kèm lý do cụ thể; không in lại query; không gọi mạng; sửa ô ⇒ kết quả cũ biến mất
 *   [WUI-05] TrangDichSheet: nút ghi CHỈ khi coTheGhi (kèm ĐỐI CHỨNG DƯƠNG); thêm · sửa tại chỗ · bật/tắt gọi đúng (id, mốc khoá lạc quan); lỗi cạnh ô
 *   [WUI-06] BangWebsite: cột/nút theo quyền (kèm đối chứng dương); Xoá CHỈ ở website trống; ngừng cần lý do ≥ 10 ký tự rồi gọi đúng; bật lại không cần lý do
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương "ca kia THẤY X" (CLAUDE.md luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/website/_actions", () => ({
  taoWebsiteAction: vi.fn(),
  suaWebsiteAction: vi.fn(),
  doiTrangThaiWebsiteAction: vi.fn(),
  xoaWebsiteAction: vi.fn(),
  themTrangDichAction: vi.fn(),
  suaTrangDichAction: vi.fn(),
  batTatTrangDichAction: vi.fn(),
}));

import { doiTrangThaiWebsiteAction, xoaWebsiteAction } from "@/app/(admin)/admin/nguon-hoa-hong/website/_actions";
import type { CampaignChon, DongTrangDich, DongWebsite } from "@/lib/affiliate/doc-website";
import type { SiteDeKiem } from "@/lib/affiliate/website-hop-le";
import { BangWebsite } from "./bang-website";
import { FormWebsite, NutThemWebsite } from "./form-website";
import { OTenMien } from "./o-ten-mien";
import { ThuUrl } from "./thu-url";
import { TrangDichSheet } from "./trang-dich-sheet";
import { useState } from "react";

// Công tắc (Radix Switch) đo kích thước bằng ResizeObserver mà jsdom không có.
class ResizeObserverGia {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverGia;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOC = "2026-10-12T02:00:00.123Z";
const MOC_TRANG = "2026-10-12T03:00:00.456Z";

const trang = (p: Partial<DongTrangDich> = {}): DongTrangDich => ({
  id: "t1",
  host: null,
  hostGiai: "quatang.edu.vn",
  pathPattern: "/khoa-hoc/*",
  label: "Khoá học",
  isActive: true,
  trackingEnabled: true,
  soLinkDangChay: 0,
  capNhatLuc: MOC_TRANG,
  ...p,
});
const web = (p: Partial<DongWebsite> = {}): DongWebsite => ({
  id: "w1",
  code: "QUATANG_EDU",
  name: "Quà tặng Sata",
  baseUrl: "https://quatang.edu.vn",
  allowedDomains: ["quatang.edu.vn"],
  status: "ACTIVE",
  trackingEnabled: true,
  defaultCampaignId: null,
  defaultCampaign: null,
  capNhatLuc: MOC,
  trangDich: [trang()],
  campaigns: [],
  ...p,
});
const CAMPAIGNS: CampaignChon[] = [
  { id: "c1", code: "TET_2027", name: "Tết 2027", status: "ACTIVE" },
  { id: "c2", code: "HE_2027", name: "Hè 2027", status: "DRAFT" },
];

const nhapChu = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });

/**
 * Bấm Enter bằng sự kiện THẬT có thể huỷ. `fireEvent.keyDown` không kích hoạt "gửi biểu mẫu ngầm" của jsdom nên KHÔNG chứng minh được gì về việc ô có chặn Enter hay không —
 * phép cấy "bỏ preventDefault" ra 0 ĐỎ (đo 13/10). Chứng cứ duy nhất là `defaultPrevented` của chính sự kiện.
 */
function nhanEnter(el: HTMLElement): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

// ═══ OTenMien ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("[WUI-01] OTenMien", () => {
  function dung(dau: string[] = []) {
    const onChange = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    function Khung() {
      const [v, setV] = useState<string[]>(dau);
      return (
        <form onSubmit={onSubmit}>
          <label htmlFor="d">Tên miền</label>
          <OTenMien
            id="d"
            value={v}
            onChange={(x) => {
              onChange(x);
              setV(x);
            }}
          />
          <button type="submit">Lưu</button>
        </form>
      );
    }
    render(<Khung />);
    return { onChange, onSubmit };
  }
  const o = () => screen.getByLabelText("Tên miền") as HTMLInputElement;

  it("Enter thêm tên miền (hạ chữ thường) và KHÔNG gửi biểu mẫu bao quanh; ô được xoá sau khi thêm", () => {
    const { onChange, onSubmit } = dung();
    nhapChu(o(), "  QuaTang.EDU.vn ");
    expect(nhanEnter(o()).defaultPrevented).toBe(true); // Enter ở đây là «Thêm», không phải «Lưu biểu mẫu»
    expect(onChange).toHaveBeenLastCalledWith(["quatang.edu.vn"]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(o().value).toBe("");
    expect(within(screen.getByRole("list", { name: "Các tên miền đã khai" })).getByText("quatang.edu.vn")).toBeTruthy();
  });

  it("dán nhiều tên miền (dấu cách · phẩy · chấm phẩy) ⇒ thêm hết, bỏ trùng; nút «Thêm» cũng chạy", () => {
    const { onChange } = dung(["a.vn"]);
    nhapChu(o(), "b.vn, c.vn; A.vn  d.vn");
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(onChange).toHaveBeenLastCalledWith(["a.vn", "b.vn", "c.vn", "d.vn"]);
  });

  it("MỘT mục hỏng ⇒ KHÔNG thêm gì (cả lượt), lỗi cạnh ô nêu chính mục hỏng, aria-invalid; sửa ô ⇒ lỗi biến mất", () => {
    const { onChange } = dung();
    nhapChu(o(), "tot.vn https://xau.vn");
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(onChange).not.toHaveBeenCalled();
    const loi = screen.getByRole("alert");
    expect(loi.textContent).toContain("https://xau.vn");
    expect(o().getAttribute("aria-invalid")).toBe("true");
    nhapChu(o(), "tot.vn");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(o().getAttribute("aria-invalid")).toBeNull();
  });

  it("ô trống + «Thêm» ⇒ lỗi gợi ý; ký tự đại diện / cổng / IP bị từ chối với câu riêng", () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Gõ một tên miền/);
    for (const x of ["*.edu.vn", "a.vn:8443", "127.0.0.1", "[::1]"]) {
      nhapChu(o(), x);
      fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
      expect(screen.getByRole("alert").textContent, x).toContain(x);
    }
  });

  it("bỏ chip bằng nút mang tên truy cập nêu tên miền; trạng thái rỗng có câu hướng dẫn", () => {
    const { onChange } = dung(["a.vn", "b.vn"]);
    fireEvent.click(screen.getByRole("button", { name: "Bỏ tên miền a.vn" }));
    expect(onChange).toHaveBeenLastCalledWith(["b.vn"]);
    fireEvent.click(screen.getByRole("button", { name: "Bỏ tên miền b.vn" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByText(/Chưa có tên miền nào/)).toBeTruthy();
  });

  it("mọi ô vô hiệu khi disabled — nút Thêm và nút Bỏ (đối chứng dương: bật thì bấm được ở ca trên)", () => {
    render(<OTenMien id="d" value={["a.vn"]} onChange={vi.fn()} disabled />);
    expect((screen.getByRole("button", { name: "Thêm" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Bỏ tên miền a.vn" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ═══ FormWebsite ════════════════════════════════════════════════════════════════════════════════════════════
describe("[WUI-02] FormWebsite — tạo", () => {
  const taoOk = { ok: true as const, id: "w9", code: "QUATANG_EDU", updatedAt: MOC };
  function dung(luuTao = vi.fn(async (_v: Record<string, unknown>) => taoOk)) {
    const dong = vi.fn();
    render(<FormWebsite cheDo="tao" campaignChon={CAMPAIGNS} dong={dong} luuTao={luuTao} />);
    return { luuTao, dong };
  }
  const ma = () => screen.getByLabelText("Mã website") as HTMLInputElement;
  const ten = () => screen.getByLabelText("Tên website") as HTMLInputElement;
  const goc = () => screen.getByLabelText("Gốc URL") as HTMLInputElement;
  const mien = () => screen.getByLabelText("Tên miền được phép") as HTMLInputElement;
  const bamTao = () => fireEvent.click(screen.getByRole("button", { name: "Tạo website" }));
  const themMien = (v: string) => {
    nhapChu(mien(), v);
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
  };

  it("bấm Tạo khi trống ⇒ lỗi CẠNH mã · tên · gốc URL/tên miền; KHÔNG gọi máy chủ; ô lỗi đầu tiên (mã) mang aria-invalid", async () => {
    const { luuTao } = dung();
    bamTao();
    await waitFor(() => expect(ma().getAttribute("aria-invalid")).toBe("true"));
    expect(ten().getAttribute("aria-invalid")).toBe("true");
    // Ô TRỐNG ⇒ «Nhập …» (không đọc luật định dạng cho ô chưa gõ gì)
    expect(screen.getByText(/Nhập mã website/)).toBeTruthy();
    expect(screen.getByText("Nhập tên website.")).toBeTruthy();
    expect(screen.getByText(/Khai ít nhất một tên miền/)).toBeTruthy();
    expect(luuTao).not.toHaveBeenCalled();
  });

  it("ô ĐÃ gõ nhưng sai luật ⇒ câu nói luật (mã quá ngắn, tên một ký tự)", async () => {
    const { luuTao } = dung();
    nhapChu(ma(), "ab");
    nhapChu(ten(), "a");
    bamTao();
    await waitFor(() => expect(screen.getByText(/Mã website gồm chữ HOA/)).toBeTruthy());
    expect(screen.getByText(/Tên website tối thiểu/)).toBeTruthy();
    expect(luuTao).not.toHaveBeenCalled();
  });

  it("gốc URL có host NGOÀI danh sách tên miền ⇒ lỗi cạnh gốc URL, không gọi máy chủ; ĐỐI CHỨNG: thêm tên miền đó vào danh sách ⇒ gọi được", async () => {
    const { luuTao } = dung();
    nhapChu(ma(), "quatang edu");
    nhapChu(ten(), "Quà tặng Sata");
    nhapChu(goc(), "https://quatang.edu.vn");
    themMien("khac.vn");
    bamTao();
    await waitFor(() => expect(goc().getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText(/phải nằm trong danh sách tên miền được phép/)).toBeTruthy();
    expect(luuTao).not.toHaveBeenCalled();
    themMien("quatang.edu.vn");
    bamTao();
    await waitFor(() => expect(luuTao).toHaveBeenCalledTimes(1));
  });

  it("tạo thành công: payload ĐÚNG (mã chuẩn hoá, gốc URL bỏ / cuối, tên miền chữ thường, theo dõi bật, campaign null), toast, đóng, tải lại trang", async () => {
    const { luuTao, dong } = dung();
    nhapChu(ma(), "quatang edu");
    nhapChu(ten(), "  Quà tặng Sata ");
    nhapChu(goc(), " https://QuaTang.edu.vn/ ");
    themMien("QuaTang.edu.vn");
    bamTao();
    await waitFor(() => expect(luuTao).toHaveBeenCalledTimes(1));
    expect(luuTao).toHaveBeenCalledWith({
      code: "QUATANG_EDU",
      name: "Quà tặng Sata",
      baseUrl: "https://quatang.edu.vn",
      allowedDomains: ["quatang.edu.vn"],
      trackingEnabled: true,
      defaultCampaignId: null,
    });
    await waitFor(() => expect(dong).toHaveBeenCalled());
    expect(TOAST.success).toHaveBeenCalled();
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it("tắt theo dõi + chọn campaign mặc định ⇒ payload mang đúng hai giá trị đó", async () => {
    const { luuTao } = dung();
    nhapChu(ma(), "QUATANG_EDU");
    nhapChu(ten(), "Quà tặng");
    nhapChu(goc(), "https://quatang.edu.vn");
    themMien("quatang.edu.vn");
    fireEvent.click(screen.getByRole("switch", { name: "Bật theo dõi" }));
    nhapChu(screen.getByLabelText("Campaign mặc định (tuỳ chọn)"), "c2");
    bamTao();
    await waitFor(() => expect(luuTao).toHaveBeenCalled());
    expect(luuTao.mock.calls[0]![0]).toMatchObject({ trackingEnabled: false, defaultCampaignId: "c2" });
  });

  it("lỗi máy chủ đặt CẠNH ĐÚNG ô (mã đã có); sửa ô ⇒ lỗi cũ biến mất (không đứng đó nói dối); biểu mẫu KHÔNG đóng", async () => {
    const luu = vi.fn(async (_v: Record<string, unknown>) => ({ ok: false as const, loi: "Mã «QUATANG_EDU» đã có.", truong: "code" }));
    const { dong } = dung(luu as never);
    nhapChu(ma(), "QUATANG_EDU");
    nhapChu(ten(), "Quà tặng");
    nhapChu(goc(), "https://quatang.edu.vn");
    themMien("quatang.edu.vn");
    bamTao();
    await waitFor(() => expect(screen.getByText("Mã «QUATANG_EDU» đã có.")).toBeTruthy());
    expect(ma().getAttribute("aria-invalid")).toBe("true");
    expect(dong).not.toHaveBeenCalled();
    nhapChu(ma(), "QUATANG_EDU2");
    expect(screen.queryByText("Mã «QUATANG_EDU» đã có.")).toBeNull();
  });

  it("lỗi không gắn ô (thiếu quyền, cờ tắt) ⇒ banner; nút Tạo mở lại để thử lần nữa", async () => {
    const luu = vi.fn(async (_v: Record<string, unknown>) => ({ ok: false as const, loi: "Affiliate chưa được bật.", truong: "quyen" }));
    dung(luu as never);
    nhapChu(ma(), "QUATANG_EDU");
    nhapChu(ten(), "Quà tặng");
    nhapChu(goc(), "https://quatang.edu.vn");
    themMien("quatang.edu.vn");
    bamTao();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Affiliate chưa được bật."));
    expect((screen.getByRole("button", { name: "Tạo website" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("máy chủ ném lỗi ⇒ banner «Không lưu được lúc này», không văng ra ngoài", async () => {
    dung(vi.fn(async () => Promise.reject(new Error("mạng"))) as never);
    nhapChu(ma(), "QUATANG_EDU");
    nhapChu(ten(), "Quà tặng");
    nhapChu(goc(), "https://quatang.edu.vn");
    themMien("quatang.edu.vn");
    bamTao();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Không lưu được lúc này"));
  });

  it("Enter trong ô tên miền chỉ THÊM tên miền, không gửi biểu mẫu (luuTao chưa được gọi)", async () => {
    const { luuTao } = dung();
    nhapChu(ma(), "QUATANG_EDU");
    nhapChu(ten(), "Quà tặng");
    nhapChu(goc(), "https://quatang.edu.vn");
    nhapChu(mien(), "quatang.edu.vn");
    expect(nhanEnter(mien()).defaultPrevented).toBe(true);
    expect(luuTao).not.toHaveBeenCalled();
    expect(within(screen.getByRole("list", { name: "Các tên miền đã khai" })).getByText("quatang.edu.vn")).toBeTruthy();
  });

  it("NutThemWebsite: bấm mới mở Sheet; Huỷ đóng", async () => {
    render(<NutThemWebsite campaignChon={CAMPAIGNS} luuTao={vi.fn()} />);
    expect(screen.queryByLabelText("Mã website")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Thêm website" }));
    expect(await screen.findByLabelText("Mã website")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    await waitFor(() => expect(screen.queryByLabelText("Mã website")).toBeNull());
  });
});

describe("[WUI-03] FormWebsite — sửa", () => {
  const suaOk = { ok: true as const, doi: true, truongDoi: ["name" as const], updatedAt: MOC };
  type LuuSua = (i: { id: string; updatedAtDaThay: string; vao: Record<string, unknown>; lyDo: string | null }) => Promise<typeof suaOk>;
  function dung(w: DongWebsite = web(), luuSua: LuuSua = vi.fn<LuuSua>(async () => suaOk)) {
    const dong = vi.fn();
    render(<FormWebsite cheDo="sua" website={w} campaignChon={CAMPAIGNS} dong={dong} luuSua={luuSua as never} />);
    return { luuSua, dong };
  }
  const bamLuu = () => fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

  it("mã là CHỮ chỉ-đọc kèm câu «không đổi được» — không có ô nhập mã", () => {
    dung();
    expect(screen.queryByLabelText("Mã website")).toBeNull();
    expect(screen.getByText("QUATANG_EDU")).toBeTruthy();
    expect(screen.getByText("Mã không đổi được sau khi tạo.")).toBeTruthy();
  });

  it("Lưu khoá khi chưa đổi gì và NÓI điều đó; đổi tên ⇒ mở; ĐỔI RỒI trả lại nguyên ⇒ khoá lại", () => {
    dung();
    const luu = () => screen.getByRole("button", { name: "Lưu thay đổi" }) as HTMLButtonElement;
    expect(luu().disabled).toBe(true);
    expect(screen.getByText("Chưa có thay đổi nào để lưu.")).toBeTruthy();
    nhapChu(screen.getByLabelText("Tên website"), "Tên khác");
    expect(luu().disabled).toBe(false);
    expect(screen.queryByText("Chưa có thay đổi nào để lưu.")).toBeNull();
    nhapChu(screen.getByLabelText("Tên website"), "Quà tặng Sata");
    expect(luu().disabled).toBe(true);
  });

  it("đổi tên ⇒ payload CHỈ {name}, id + mốc khoá lạc quan của website, ghi chú vào lý do", async () => {
    const { luuSua, dong } = dung();
    nhapChu(screen.getByLabelText("Tên website"), "  Tên mới  ");
    nhapChu(screen.getByLabelText("Ghi chú thay đổi (tuỳ chọn)"), "Đổi theo thương hiệu mới");
    bamLuu();
    await waitFor(() => expect(luuSua).toHaveBeenCalledTimes(1));
    expect(luuSua).toHaveBeenCalledWith({ id: "w1", updatedAtDaThay: MOC, vao: { name: "Tên mới" }, lyDo: "Đổi theo thương hiệu mới" });
    await waitFor(() => expect(dong).toHaveBeenCalled());
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it("đổi tên miền ⇒ payload mang baseUrl + allowedDomains đã chuẩn hoá (và KHÔNG mang name)", async () => {
    const { luuSua } = dung();
    nhapChu(screen.getByLabelText("Tên miền được phép"), "www.quatang.edu.vn");
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    bamLuu();
    await waitFor(() => expect(luuSua).toHaveBeenCalled());
    const vao = (luuSua as ReturnType<typeof vi.fn>).mock.calls[0]![0].vao;
    expect(vao).toEqual({ baseUrl: "https://quatang.edu.vn", allowedDomains: ["quatang.edu.vn", "www.quatang.edu.vn"] });
  });

  it("gỡ tên miền đang là host của gốc URL ⇒ lỗi cạnh ô, không gọi máy chủ", async () => {
    const { luuSua } = dung(web({ allowedDomains: ["quatang.edu.vn", "www.quatang.edu.vn"] }));
    fireEvent.click(screen.getByRole("button", { name: "Bỏ tên miền quatang.edu.vn" }));
    bamLuu();
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(luuSua).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Gốc URL").getAttribute("aria-invalid")).toBe("true");
  });

  it("website CŨ có gốc URL không còn đúng luật (có đường dẫn): đổi TÊN vẫn gửi được và KHÔNG kèm baseUrl", async () => {
    const { luuSua } = dung(web({ baseUrl: "https://quatang.edu.vn/lp" }));
    nhapChu(screen.getByLabelText("Tên website"), "Tên mới");
    bamLuu();
    await waitFor(() => expect(luuSua).toHaveBeenCalled());
    expect((luuSua as ReturnType<typeof vi.fn>).mock.calls[0]![0].vao).toEqual({ name: "Tên mới" });
  });

  it("campaign mặc định ĐÃ KẾT THÚC hiện đúng trong ô chọn (kèm «đã kết thúc»), không lặng lẽ nhảy về «Không chọn»", () => {
    dung(web({ defaultCampaignId: "c9", defaultCampaign: { id: "c9", code: "CU_2025", name: "Cũ 2025", status: "ENDED" } }));
    const sel = screen.getByLabelText("Campaign mặc định (tuỳ chọn)") as HTMLSelectElement;
    expect(sel.value).toBe("c9");
    expect(within(sel).getByText(/Cũ 2025.*đã kết thúc/)).toBeTruthy();
    expect(within(sel).getByText(/Tết 2027/)).toBeTruthy(); // đối chứng: campaign đang chạy vẫn có
  });

  it("đổi campaign mặc định về «Không chọn» ⇒ payload defaultCampaignId = null", async () => {
    const { luuSua } = dung(web({ defaultCampaignId: "c1", defaultCampaign: CAMPAIGNS[0]! }));
    nhapChu(screen.getByLabelText("Campaign mặc định (tuỳ chọn)"), "");
    bamLuu();
    await waitFor(() => expect(luuSua).toHaveBeenCalled());
    expect((luuSua as ReturnType<typeof vi.fn>).mock.calls[0]![0].vao).toEqual({ defaultCampaignId: null });
  });

  it("«vừa được người khác đổi» ⇒ banner + Tải lại (đóng + tải lại trang); form không đóng", async () => {
    const luu = vi.fn(async () => ({ ok: false as const, loi: "Website vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" }));
    const { dong } = dung(web(), luu as never);
    nhapChu(screen.getByLabelText("Tên website"), "Tên mới");
    bamLuu();
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("vừa được người khác thay đổi");
    expect(dong).not.toHaveBeenCalled();
    fireEvent.click(within(banner).getByRole("button", { name: /Tải lại/ }));
    expect(dong).toHaveBeenCalled();
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it("máy chủ trả «không đổi gì» (doi=false) ⇒ toast thông tin, không toast thành công", async () => {
    const luu = vi.fn(async () => ({ ok: true as const, doi: false, truongDoi: [] as never[], updatedAt: MOC }));
    dung(web(), luu as never);
    nhapChu(screen.getByLabelText("Tên website"), "Tên mới");
    bamLuu();
    await waitFor(() => expect(TOAST.info).toHaveBeenCalledWith("Không có gì thay đổi."));
    expect(TOAST.success).not.toHaveBeenCalled();
  });
});

// ═══ ThuUrl ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ "KHÔNG ĐƯỢC PHÉP" CHỨA chuỗi con "ĐƯỢC PHÉP": `toContain("ĐƯỢC PHÉP")` xanh cả khi địa chỉ bị TỪ CHỐI (phép cấy "bỏ cắt khoảng trắng" ra 0 đỏ vì thế). Neo vào ĐẦU kết quả.
const DUOC_PHEP = /^ĐƯỢC PHÉP/;
const KHONG_DUOC_PHEP = /^KHÔNG ĐƯỢC PHÉP/;

describe("[WUI-04] ThuUrl", () => {
  const SITE: SiteDeKiem = { allowedDomains: ["quatang.edu.vn"], status: "ACTIVE", trackingEnabled: true };
  const TRANG = [
    { pathPattern: "/khoa-robotics", isActive: true, host: "quatang.edu.vn", trackingEnabled: true },
    { pathPattern: "/khoa-hoc/*", isActive: true, host: "quatang.edu.vn", trackingEnabled: true },
  ];
  function thu(url: string, site = SITE) {
    render(<ThuUrl site={site} trangDich={TRANG} />);
    nhapChu(screen.getByLabelText("Địa chỉ cần thử"), url);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra" }));
    return screen.getByRole("status");
  }

  it("ĐƯỢC PHÉP: nêu tên miền, đường dẫn, trang đích khớp; địa chỉ có query chứa SĐT/email thì kết quả KHÔNG in lại chúng", () => {
    const kq = thu("https://QUATANG.edu.vn/khoa-hoc/robot-1?sdt=0909123456&email=a@b.c#x");
    expect(kq.textContent).toMatch(DUOC_PHEP);
    expect(kq.textContent).toContain("quatang.edu.vn");
    expect(kq.textContent).toContain("/khoa-hoc/robot-1");
    expect(kq.textContent).toContain("/khoa-hoc/*");
    expect(kq.textContent).not.toMatch(/0909123456|a@b\.c|sdt=|email=/);
  });

  it.each([
    ["userinfo giả mạo", "https://evil.com@quatang.edu.vn/khoa-robotics", "CO_USERINFO", /tên@|giả mạo/],
    ["tên miền con chưa khai", "https://www.quatang.edu.vn/khoa-robotics", "HOST_KHONG_DUOC_PHEP", /không nằm trong danh sách/],
    ["http", "http://quatang.edu.vn/khoa-robotics", "KHONG_PHAI_HTTPS", /https/],
    ["đường dẫn chưa có trang đích", "https://quatang.edu.vn/admin", "KHONG_CO_TRANG_DICH", /chưa có trang đích/],
    ["leo thư mục cha", "https://quatang.edu.vn/khoa-hoc/../admin", "DUONG_DAN_LEO_THANG", /\.\./],
    ["cổng lạ", "https://quatang.edu.vn:8443/khoa-robotics", "CONG_LA", /cổng/],
  ])("KHÔNG ĐƯỢC PHÉP — %s ⇒ lý do cụ thể + mã máy", (_ten, url, ma, re) => {
    const kq = thu(url);
    expect(kq.textContent).toMatch(KHONG_DUOC_PHEP);
    expect(kq.textContent).toContain(ma);
    expect(kq.textContent).toMatch(re);
  });

  it("website ngừng / tắt theo dõi ⇒ nói đúng lý do (URL tự nó hợp lệ)", () => {
    expect(thu("https://quatang.edu.vn/khoa-robotics", { ...SITE, status: "INACTIVE" }).textContent).toContain("SITE_NGUNG");
    cleanup();
    expect(thu("https://quatang.edu.vn/khoa-robotics", { ...SITE, trackingEnabled: false }).textContent).toContain("SITE_TAT_THEO_DOI");
  });

  it("dán kèm khoảng trắng / xuống dòng ở hai đầu vẫn kiểm được (màn hình cắt hai đầu); khoảng trắng GIỮA thì bị từ chối", () => {
    expect(thu("  https://quatang.edu.vn/khoa-robotics  ").textContent).toMatch(DUOC_PHEP);
    cleanup();
    expect(thu("https://quatang.edu.vn/khoa hoc").textContent).toContain("KY_TU_CAM");
  });

  it("Enter chạy phép kiểm và KHÔNG gửi biểu mẫu bao quanh; sửa ô ⇒ kết quả cũ biến mất", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ThuUrl site={SITE} trangDich={TRANG} />
      </form>,
    );
    const o = screen.getByLabelText("Địa chỉ cần thử");
    nhapChu(o, "https://quatang.edu.vn/khoa-robotics");
    expect(nhanEnter(o).defaultPrevented).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(DUOC_PHEP);
    expect(onSubmit).not.toHaveBeenCalled();
    nhapChu(o, "https://quatang.edu.vn/khoa-robotic");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("KHÔNG gọi mạng: địa chỉ dán vào chỉ được kiểm tại chỗ", () => {
    const f = vi.fn();
    const goc = globalThis.fetch;
    globalThis.fetch = f as never;
    try {
      thu("https://quatang.edu.vn/khoa-robotics?sdt=0909123456");
      expect(f).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = goc;
    }
  });

  it("kết quả được TÍNH LẠI theo dữ liệu website HIỆN CÓ: thêm trang đích / ngừng website khi Sheet đang mở thì kết quả đang hiện đổi theo, không cần bấm lại", () => {
    const url = "https://quatang.edu.vn/su-kien/tet";
    const { rerender } = render(<ThuUrl site={SITE} trangDich={TRANG} />);
    nhapChu(screen.getByLabelText("Địa chỉ cần thử"), url);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra" }));
    expect(screen.getByRole("status").textContent).toMatch(KHONG_DUOC_PHEP);
    expect(screen.getByRole("status").textContent).toContain("KHONG_CO_TRANG_DICH");
    // trang đích mới về (router.refresh) ⇒ cùng địa chỉ nay được phép
    rerender(<ThuUrl site={SITE} trangDich={[...TRANG, { pathPattern: "/su-kien/*", isActive: true, host: "quatang.edu.vn", trackingEnabled: true }]} />);
    expect(screen.getByRole("status").textContent).toMatch(DUOC_PHEP);
    // website bị ngừng ⇒ lại không được, với đúng lý do mới
    rerender(<ThuUrl site={{ ...SITE, status: "INACTIVE" }} trangDich={[...TRANG, { pathPattern: "/su-kien/*", isActive: true, host: "quatang.edu.vn", trackingEnabled: true }]} />);
    expect(screen.getByRole("status").textContent).toContain("SITE_NGUNG");
  });

  it("chưa bấm gì ⇒ vùng kết quả rỗng (không nói ĐƯỢC/KHÔNG khi chưa kiểm)", () => {
    render(<ThuUrl site={SITE} trangDich={TRANG} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

// ═══ TrangDichSheet ═════════════════════════════════════════════════════════════════════════════════════════
describe("[WUI-05] TrangDichSheet", () => {
  const ok = { ok: true as const, id: "t9", updatedAt: MOC };
  function dung(p: { coTheGhi: boolean; website?: DongWebsite; them?: ReturnType<typeof vi.fn>; sua?: ReturnType<typeof vi.fn>; batTat?: ReturnType<typeof vi.fn> }) {
    const them = p.them ?? vi.fn(async () => ok);
    const sua = p.sua ?? vi.fn(async () => ok);
    const batTat = p.batTat ?? vi.fn(async (i: { den: boolean }) => ({ ok: true as const, den: i.den, updatedAt: MOC }));
    const dong = vi.fn();
    render(<TrangDichSheet website={p.website ?? web()} coTheGhi={p.coTheGhi} dong={dong} them={them as never} sua={sua as never} batTat={batTat as never} />);
    return { them, sua, batTat, dong };
  }

  it("coTheGhi=false ⇒ KHÔNG form thêm, KHÔNG nút Sửa/Tắt — nhưng vẫn THẤY danh sách và «Thử một địa chỉ»; coTheGhi=true ⇒ THẤY tất cả (đối chứng dương)", () => {
    dung({ coTheGhi: false });
    expect(screen.queryByRole("heading", { name: "Thêm trang đích" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sửa trang đích/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Tắt|Bật) trang đích/ })).toBeNull();
    expect(screen.getByText("/khoa-hoc/*")).toBeTruthy();
    expect(screen.getByLabelText("Địa chỉ cần thử")).toBeTruthy();
    cleanup();
    dung({ coTheGhi: true });
    expect(screen.getByRole("heading", { name: "Thêm trang đích" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sửa trang đích /khoa-hoc/*" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tắt trang đích /khoa-hoc/*" })).toBeTruthy();
  });

  it("[WUI-05b] tổng quan website (AFF-WEB): tên miền · trạng thái theo dõi · campaign đang dùng · số trang đích — người chỉ XEM cũng thấy; tắt theo dõi / chưa gắn campaign nói thẳng", () => {
    dung({
      coTheGhi: false,
      website: web({
        allowedDomains: ["quatang.edu.vn", "covua.quatang.edu.vn"],
        trackingEnabled: true,
        campaigns: [{ id: "c1", code: "TET_2027", name: "Tết 2027", status: "ACTIVE" }, { id: "c2", code: "HE_2027", name: "Hè 2027", status: "PAUSED" }],
        trangDich: [trang({ id: "t1" }), trang({ id: "t2", pathPattern: "/khoa-robot", isActive: false })],
      }),
    });
    const tq = document.querySelector("[data-tong-quan-website]")!;
    expect(tq).not.toBeNull();
    expect(tq.textContent).toContain("quatang.edu.vn");
    expect(tq.textContent).toContain("covua.quatang.edu.vn"); // đủ MỌI tên miền được phép, không chỉ tên đầu
    expect(tq.textContent).toContain("Bật theo dõi");
    expect(tq.textContent).toContain("Tết 2027");
    expect(tq.textContent).toContain("Hè 2027");
    expect(tq.textContent).toContain("1 đang bật / 2 trang");
    expect(tq.textContent).not.toContain("Lượt bấm mới bị chặn");
    cleanup();

    // đối chứng: tắt theo dõi + chưa gắn campaign ⇒ nói thẳng
    dung({ coTheGhi: false, website: web({ trackingEnabled: false, campaigns: [] }) });
    const tq2 = document.querySelector("[data-tong-quan-website]")!;
    expect(tq2.textContent).toContain("Tắt theo dõi");
    expect(tq2.textContent).toContain("Lượt bấm mới bị chặn; lịch sử giữ nguyên.");
    expect(tq2.textContent).toContain("Chưa gắn campaign nào");
  });

  it("danh sách rỗng ⇒ câu nói hệ quả (chưa ai tạo được link) và hướng đi tiếp THEO QUYỀN", () => {
    dung({ coTheGhi: true, website: web({ trangDich: [] }) });
    expect(screen.getByText(/chưa ai tạo được link giới thiệu/)).toBeTruthy();
    expect(screen.getByText(/Thêm đường dẫn đầu tiên/)).toBeTruthy();
    cleanup();
    dung({ coTheGhi: false, website: web({ trangDich: [] }) });
    expect(screen.getByText(/Nhờ người có quyền quản lý website thêm giúp/)).toBeTruthy();
    expect(screen.queryByText(/Thêm đường dẫn đầu tiên/)).toBeNull();
  });

  it("thêm: gọi ĐÚNG (siteId, mẫu đã chuẩn hoá, nhãn); xong thì xoá ô, toast, tải lại", async () => {
    const { them } = dung({ coTheGhi: true });
    nhapChu(screen.getByLabelText("Đường dẫn"), " /khoa-robotics/ ");
    nhapChu(screen.getByLabelText("Nhãn (tuỳ chọn)"), "  Robotics ");
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    await waitFor(() => expect(them).toHaveBeenCalledTimes(1));
    expect(them).toHaveBeenCalledWith({ siteId: "w1", host: null, pathPattern: "/khoa-robotics", label: "Robotics" });
    await waitFor(() => expect((screen.getByLabelText("Đường dẫn") as HTMLInputElement).value).toBe(""));
    expect(TOAST.success).toHaveBeenCalled();
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it.each([["hai gạch chéo", "//evil.com"], ["leo thư mục", "/a/../b"], ["có dấu ?", "/a?x=1"], ["sao ở giữa", "/a/*/b"], ["thiếu / đầu", "khoa"]])(
    "thêm mẫu xấu (%s) ⇒ lỗi cạnh ô đường dẫn, aria-invalid, KHÔNG gọi máy chủ",
    async (_ten, mau) => {
      const { them } = dung({ coTheGhi: true });
      nhapChu(screen.getByLabelText("Đường dẫn"), mau);
      fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
      await waitFor(() => expect(screen.getByLabelText("Đường dẫn").getAttribute("aria-invalid")).toBe("true"));
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
      expect(them).not.toHaveBeenCalled();
    },
  );

  it("máy chủ báo «đã có» ⇒ lỗi đặt cạnh ô đường dẫn (không phải banner); sửa ô ⇒ lỗi biến mất", async () => {
    const them = vi.fn(async () => ({ ok: false as const, loi: "Đường dẫn «/a» đã có ở website này.", truong: "pathPattern" }));
    dung({ coTheGhi: true, them });
    nhapChu(screen.getByLabelText("Đường dẫn"), "/a");
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    await waitFor(() => expect(screen.getByText("Đường dẫn «/a» đã có ở website này.")).toBeTruthy());
    expect(screen.getByLabelText("Đường dẫn").getAttribute("aria-invalid")).toBe("true");
    nhapChu(screen.getByLabelText("Đường dẫn"), "/b");
    expect(screen.queryByText("Đường dẫn «/a» đã có ở website này.")).toBeNull();
  });

  it("tắt / bật: gọi ĐÚNG (id dòng, mốc khoá lạc quan CỦA DÒNG, trạng thái đích); trang đã tắt hiện nút «Bật»", async () => {
    const { batTat } = dung({ coTheGhi: true, website: web({ trangDich: [trang({ id: "ta", pathPattern: "/a", capNhatLuc: "MOC-A" }), trang({ id: "tb", pathPattern: "/b", isActive: false, capNhatLuc: "MOC-B" })] }) });
    fireEvent.click(screen.getByRole("button", { name: "Tắt trang đích /a" }));
    await waitFor(() => expect(batTat).toHaveBeenCalledTimes(1));
    expect(batTat).toHaveBeenLastCalledWith({ id: "ta", updatedAtDaThay: "MOC-A", den: false, lyDo: null });
    // Lượt đầu còn ĐANG CHẠY thì nút khác bị khoá (đúng thiết kế: không gửi hai lệnh song song) — đợi nó xong, nếu không ca này chỉ xanh khi máy đủ nhanh (đỏ trong lượt chạy cả bộ).
    await waitFor(() => expect((screen.getByRole("button", { name: "Bật trang đích /b" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Bật trang đích /b" }));
    await waitFor(() => expect(batTat).toHaveBeenCalledTimes(2));
    expect(batTat).toHaveBeenLastCalledWith({ id: "tb", updatedAtDaThay: "MOC-B", den: true, lyDo: null });
    expect(screen.queryByRole("button", { name: "Bật trang đích /a" })).toBeNull();
  });

  it("sửa tại chỗ: chỉ gửi trường ĐỔI (nhãn ⇒ không kèm pathPattern); không đổi gì thì Lưu chỉ đóng, không gọi máy chủ", async () => {
    const { sua } = dung({ coTheGhi: true });
    fireEvent.click(screen.getByRole("button", { name: "Sửa trang đích /khoa-hoc/*" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(sua).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sửa trang đích /khoa-hoc/*" })).toBeTruthy(); // đã thoát chế độ sửa
    fireEvent.click(screen.getByRole("button", { name: "Sửa trang đích /khoa-hoc/*" }));
    nhapChu(screen.getByLabelText("Nhãn"), "Nhãn mới");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(sua).toHaveBeenCalledTimes(1));
    expect(sua).toHaveBeenCalledWith({ id: "t1", updatedAtDaThay: MOC_TRANG, vao: { label: "Nhãn mới" }, lyDo: null });
  });

  it("sửa tại chỗ: đổi đường dẫn sang mẫu xấu ⇒ lỗi cạnh ô, không gọi; mẫu hợp lệ ⇒ gửi mẫu đã chuẩn hoá", async () => {
    const { sua } = dung({ coTheGhi: true });
    fireEvent.click(screen.getByRole("button", { name: "Sửa trang đích /khoa-hoc/*" }));
    const o = screen.getByLabelText("Đường dẫn đang sửa");
    nhapChu(o, "/a/../b");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(o.getAttribute("aria-invalid")).toBe("true"));
    expect(sua).not.toHaveBeenCalled();
    nhapChu(o, " /khoa-moi/ ");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(sua).toHaveBeenCalled());
    expect(sua).toHaveBeenCalledWith({ id: "t1", updatedAtDaThay: MOC_TRANG, vao: { pathPattern: "/khoa-moi" }, lyDo: null });
  });

  it("«vừa được người khác đổi» ⇒ banner + Tải lại; website đang NGỪNG ⇒ ghi chú nói rõ", async () => {
    const batTat = vi.fn(async () => ({ ok: false as const, loi: "Trang đích vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" }));
    dung({ coTheGhi: true, batTat, website: web({ status: "INACTIVE" }) });
    expect(screen.getByRole("note").textContent).toContain("Website đang ngừng");
    fireEvent.click(screen.getByRole("button", { name: "Tắt trang đích /khoa-hoc/*" }));
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("vừa được người khác thay đổi");
    fireEvent.click(within(banner).getByRole("button", { name: "Tải lại" }));
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it("«Thử một địa chỉ» trong Sheet dùng dữ liệu CỦA website này: trang đã TẮT không được tính", () => {
    dung({ coTheGhi: false, website: web({ trangDich: [trang({ pathPattern: "/a", isActive: false })] }) });
    nhapChu(screen.getByLabelText("Địa chỉ cần thử"), "https://quatang.edu.vn/a");
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra" }));
    expect(screen.getByRole("status").textContent).toContain("KHONG_CO_TRANG_DICH");
  });

  it("tiêu đề danh sách đếm đúng số trang đang bật / tổng", () => {
    dung({ coTheGhi: false, website: web({ trangDich: [trang({ id: "a", pathPattern: "/a" }), trang({ id: "b", pathPattern: "/b", isActive: false }), trang({ id: "c", pathPattern: "/c" })] }) });
    expect(screen.getByRole("heading", { name: "Trang đích (2 đang bật / 3)" })).toBeTruthy();
  });
});

// ═══ BangWebsite ════════════════════════════════════════════════════════════════════════════════════════════
describe("[WUI-06] BangWebsite", () => {
  const W_TRONG = web({ id: "w-trong", code: "TRONG_01", name: "Website trống", trangDich: [], campaigns: [] });
  const W_DUNG = web({
    id: "w-dung",
    code: "DUNG_01",
    name: "Website đang dùng",
    allowedDomains: ["dung.vn", "www.dung.vn"],
    campaigns: [
      { id: "c1", code: "TET_2027", name: "Tết 2027", status: "ACTIVE" },
      { id: "c2", code: "HE_2027", name: "Hè 2027", status: "DRAFT" },
    ],
  });
  const W_NGUNG = web({ id: "w-ngung", code: "NGUNG_01", name: "Website ngừng", status: "INACTIVE", trackingEnabled: false });
  const DONG = [W_TRONG, W_DUNG, W_NGUNG];
  const bang = (coTheGhi: boolean, dong: DongWebsite[] = DONG) => render(<BangWebsite dong={dong} campaignChon={CAMPAIGNS} coTheGhi={coTheGhi} />);

  it("cột + giá trị: tên/mã, tên miền (+N), theo dõi, trạng thái, số trang đích, campaign đang dùng (+N)", () => {
    bang(false);
    const hang = screen.getByRole("button", { name: "Website đang dùng" }).closest("tr")!;
    expect(hang.textContent).toContain("DUNG_01");
    expect(hang.textContent).toContain("dung.vn");
    expect(hang.textContent).toContain("+1 tên miền khác");
    expect(hang.textContent).toContain("Đang hoạt động");
    expect(hang.textContent).toContain("1 đang bật");
    expect(hang.textContent).toContain("Tết 2027");
    expect(hang.textContent).toContain("+1 campaign khác");
    const ngung = screen.getByRole("button", { name: "Website ngừng" }).closest("tr")!;
    expect(ngung.textContent).toContain("Đã ngừng");
    expect(ngung.textContent).toMatch(/Tắt/);
    const trong = screen.getByRole("button", { name: "Website trống" }).closest("tr")!;
    expect(trong.textContent).toContain("Chưa có");
    expect(trong.textContent).toContain("Chưa gắn campaign nào");
  });

  it("coTheGhi=false ⇒ KHÔNG cột Thao tác, KHÔNG nút Sửa/Ngừng/Bật lại/Xoá; coTheGhi=true ⇒ THẤY (đối chứng dương)", () => {
    bang(false);
    expect(screen.queryByRole("columnheader", { name: "Thao tác" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Sửa|Ngừng|Bật lại|Xoá) website/ })).toBeNull();
    cleanup();
    bang(true);
    expect(screen.getByRole("columnheader", { name: "Thao tác" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sửa website Website đang dùng" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ngừng website Website đang dùng" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bật lại website Website ngừng" })).toBeTruthy();
  });

  it("Xoá CHỈ vẽ ở website TRỐNG (không trang đích, không campaign); website đã dùng chỉ ngừng được; website ngừng không có «Ngừng», website hoạt động không có «Bật lại»", () => {
    bang(true);
    expect(screen.getByRole("button", { name: "Xoá website Website trống" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Xoá website Website đang dùng" })).toBeNull(); // có trang đích + campaign
    expect(screen.queryByRole("button", { name: "Xoá website Website ngừng" })).toBeNull(); // có trang đích
    expect(screen.queryByRole("button", { name: "Ngừng website Website ngừng" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bật lại website Website đang dùng" })).toBeNull();
    // chỉ có trang đích HOẶC chỉ có campaign cũng đủ để không xoá
    cleanup();
    bang(true, [web({ id: "x1", name: "Chỉ có trang", trangDich: [trang()], campaigns: [] }), web({ id: "x2", name: "Chỉ có campaign", trangDich: [], campaigns: [{ id: "c1", code: "A", name: "A", status: "ACTIVE" }] })]);
    expect(screen.queryByRole("button", { name: /^Xoá website/ })).toBeNull();
  });

  it("bấm tên website mở Sheet «Trang đích» (kể cả khi không có quyền ghi); Sheet CHỈ XEM không có form thêm", async () => {
    bang(false);
    fireEvent.click(screen.getByRole("button", { name: "Website đang dùng" }));
    expect(await screen.findByRole("heading", { name: "Trang đích — Website đang dùng" })).toBeTruthy();
    expect(screen.getByLabelText("Địa chỉ cần thử")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Thêm trang đích" })).toBeNull();
  });

  it("dòng là vùng bấm THẬT: `<tr>` có cursor-pointer VÀ nút tên mang lớp phủ after:inset-0 (luật 12)", () => {
    bang(true);
    const hang = screen.getByRole("button", { name: "Website đang dùng" }).closest("tr")!;
    expect(hang.className).toMatch(/cursor-pointer/);
    expect(hang.className).toMatch(/\brelative\b/);
    expect(screen.getByRole("button", { name: "Website đang dùng" }).className).toMatch(/after:inset-0/);
  });

  it("ngừng: lý do 9 ký tự ⇒ lỗi cạnh ô, KHÔNG gọi; đủ 10 ⇒ gọi ĐÚNG (id, mốc, INACTIVE, lý do), toast, tải lại; mô tả nêu số campaign đang gắn", async () => {
    vi.mocked(doiTrangThaiWebsiteAction).mockResolvedValue({ ok: true, tu: "ACTIVE", den: "INACTIVE", updatedAt: MOC, campaignDangChay: 1 });
    bang(true);
    fireEvent.click(screen.getByRole("button", { name: "Ngừng website Website đang dùng" }));
    const hop = await screen.findByRole("dialog");
    expect(hop.textContent).toContain("đang gắn 2 campaign (1 đang chạy)");
    nhapChu(within(hop).getByLabelText(/Lý do/), "123456789");
    fireEvent.click(within(hop).getByRole("button", { name: "Ngừng website" }));
    await waitFor(() => expect(within(hop).getByLabelText(/Lý do/).getAttribute("aria-invalid")).toBe("true"));
    expect(doiTrangThaiWebsiteAction).not.toHaveBeenCalled();
    nhapChu(within(hop).getByLabelText(/Lý do/), "  Đối tác dừng chương trình  "); // khoảng trắng hai đầu phải được cắt trước khi gửi
    fireEvent.click(within(hop).getByRole("button", { name: "Ngừng website" }));
    await waitFor(() => expect(doiTrangThaiWebsiteAction).toHaveBeenCalledTimes(1));
    expect(doiTrangThaiWebsiteAction).toHaveBeenCalledWith({ id: "w-dung", updatedAtDaThay: MOC, den: "INACTIVE", lyDo: "Đối tác dừng chương trình" });
    await waitFor(() => expect(TOAST.success).toHaveBeenCalled());
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it("bật lại: KHÔNG cần lý do — bấm là gọi (lý do null); có gõ thì gửi lý do đã cắt", async () => {
    vi.mocked(doiTrangThaiWebsiteAction).mockResolvedValue({ ok: true, tu: "INACTIVE", den: "ACTIVE", updatedAt: MOC, campaignDangChay: 0 });
    bang(true);
    fireEvent.click(screen.getByRole("button", { name: "Bật lại website Website ngừng" }));
    const hop = await screen.findByRole("dialog");
    expect(within(hop).getByLabelText("Lý do (tuỳ chọn)")).toBeTruthy();
    fireEvent.click(within(hop).getByRole("button", { name: "Bật lại" }));
    await waitFor(() => expect(doiTrangThaiWebsiteAction).toHaveBeenCalledTimes(1));
    expect(doiTrangThaiWebsiteAction).toHaveBeenCalledWith({ id: "w-ngung", updatedAtDaThay: MOC, den: "ACTIVE", lyDo: null });
  });

  it("ngừng bị máy chủ từ chối (vừa đổi) ⇒ banner + Tải lại, hộp thoại KHÔNG đóng; lỗi về lý do đặt cạnh ô lý do", async () => {
    vi.mocked(doiTrangThaiWebsiteAction).mockResolvedValueOnce({ ok: false, loi: "Website vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" });
    bang(true);
    fireEvent.click(screen.getByRole("button", { name: "Ngừng website Website đang dùng" }));
    const hop = await screen.findByRole("dialog");
    nhapChu(within(hop).getByLabelText(/Lý do/), "Đối tác dừng chương trình");
    fireEvent.click(within(hop).getByRole("button", { name: "Ngừng website" }));
    await waitFor(() => expect(within(hop).getByText(/vừa được người khác thay đổi/)).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(within(hop).getByRole("button", { name: "Tải lại" })).toBeTruthy();
    expect(TOAST.success).not.toHaveBeenCalled();
    vi.mocked(doiTrangThaiWebsiteAction).mockResolvedValueOnce({ ok: false, loi: "Ngừng website cần ghi lý do (tối thiểu 10 ký tự).", truong: "lyDo" });
    fireEvent.click(within(hop).getByRole("button", { name: "Ngừng website" }));
    await waitFor(() => expect(within(hop).getByLabelText(/Lý do/).getAttribute("aria-invalid")).toBe("true"));
  });

  it("xoá: cần lý do ≥ 10; gọi ĐÚNG (id, mốc, lý do); mô tả nói «không hoàn tác»", async () => {
    vi.mocked(xoaWebsiteAction).mockResolvedValue({ ok: true });
    bang(true);
    fireEvent.click(screen.getByRole("button", { name: "Xoá website Website trống" }));
    const hop = await screen.findByRole("dialog");
    expect(hop.textContent).toContain("không hoàn tác");
    fireEvent.click(within(hop).getByRole("button", { name: "Xoá website" }));
    await waitFor(() => expect(within(hop).getByLabelText(/Lý do/).getAttribute("aria-invalid")).toBe("true"));
    expect(xoaWebsiteAction).not.toHaveBeenCalled();
    nhapChu(within(hop).getByLabelText(/Lý do/), "Tạo nhầm, chưa dùng");
    fireEvent.click(within(hop).getByRole("button", { name: "Xoá website" }));
    await waitFor(() => expect(xoaWebsiteAction).toHaveBeenCalledTimes(1));
    expect(xoaWebsiteAction).toHaveBeenCalledWith({ id: "w-trong", updatedAtDaThay: MOC, lyDo: "Tạo nhầm, chưa dùng" });
  });

  it("Sửa mở Sheet sửa đúng website (mã chỉ-đọc của nó)", async () => {
    bang(true);
    fireEvent.click(screen.getByRole("button", { name: "Sửa website Website đang dùng" }));
    expect(await screen.findByText("DUNG_01", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Mã không đổi được sau khi tạo.")).toBeTruthy();
  });
});
