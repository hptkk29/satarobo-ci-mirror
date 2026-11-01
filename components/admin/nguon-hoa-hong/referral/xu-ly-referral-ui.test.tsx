// @vitest-environment jsdom
/**
 * [XLU-*] — PANEL XỬ LÝ + SHEET KHAI TAY + LỊCH SỬ trên PHẦN TỬ THẬT (jsdom); hàm gọi máy chủ được TIÊM (AFF-L3b).
 *
 *   [XLU-01] panel: KHÔNG quyền ⇒ không vẽ gì; có quyền ⇒ nút theo bảng trạng thái; trạng thái cuối ⇒ không nút, nói «đã chốt»
 *   [XLU-02] panel: lý do < 10 ký tự ⇒ lỗi CẠNH ô và KHÔNG gọi máy chủ; CẢ NĂM hành động đòi ghi chú bằng chứng
 *   [XLU-03] panel: payload gửi đúng (id · hành động · mốc updatedAt đã thấy · lý do đã trim · ghi chú) và KHÔNG có khoá lạ
 *   [XLU-04] panel: lỗi máy chủ «vừa được xử lý» hiện lên đầu form; thành công đóng form + refresh
 *   [XLU-05] panel: ghi chú chứa SĐT bị chặn ngay ở trình duyệt (cùng bộ kiểm với máy chủ)
 *   [XLU-06] sheet khai tay: KHÔNG có ô tiền / tỉ lệ / nguồn; payload đúng bốn lựa chọn + lý do + ghi chú, không khoá lạ
 *   [XLU-07] lịch sử: rỗng nói thật; có dòng thì hiện ai · lúc nào · trạng thái từ→đến · lý do · bằng chứng
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương "ca kia THẤY X" (CLAUDE.md luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/referral/_actions", () => ({
  xuLyReferralAction: vi.fn(),
  khaiTayReferralAction: vi.fn(),
  timPhieuKhaiTayAction: vi.fn(),
}));

import type { DongLichSu, LuaChonKhaiTay } from "@/lib/affiliate/doc-xu-ly-referral";
import type { KetQuaKhaiTay, KetQuaXuLyReferral } from "@/lib/affiliate/ghi-referral-xu-ly";
import { LichSuXuLy } from "./lich-su-xu-ly";
import { KhaiTaySheet } from "./khai-tay-sheet";
import { XuLyReferralPanel } from "./xu-ly-referral-panel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOC = "2026-10-13T03:00:00.000Z";
const OK_XL: KetQuaXuLyReferral = { ok: true, den: "VALID", nhanhGhiNguon: "TAO_MOI", tuDuyet: false };

function panel(p: Partial<React.ComponentProps<typeof XuLyReferralPanel>> = {}) {
  const gui = vi.fn(async () => OK_XL);
  const r = render(<XuLyReferralPanel id="ref-1" trangThai="MANUAL_REVIEW" capNhatLuc={MOC} coQuyen dangChoBangChung={false} gui={gui} {...p} />);
  return { gui, ...r };
}
const nut = (ten: string) => screen.getByRole("button", { name: ten });
const hoi = (ten: string) => screen.queryByRole("button", { name: ten });

const LY_DO = "Khách xác nhận đối tác giới thiệu";
const GHI_CHU = "Biên nhận sự kiện BN-0042 do cán bộ Lan ký";

describe("[XLU-01] nút vẽ theo quyền và trạng thái", () => {
  it("KHÔNG quyền ⇒ không vẽ gì (không nút xám); CÓ quyền ⇒ đủ năm nút (đối chứng dương)", () => {
    const a = panel({ coQuyen: false });
    expect(a.container.innerHTML).toBe("");
    cleanup();
    panel();
    for (const t of ["Duyệt", "Từ chối", "Đánh dấu tranh chấp", "Xin bằng chứng", "Bổ sung bằng chứng"]) expect(nut(t)).toBeTruthy();
  });

  it("DISPUTED ⇒ không còn «Đánh dấu tranh chấp», các nút còn lại vẫn có", () => {
    panel({ trangThai: "DISPUTED" });
    expect(hoi("Đánh dấu tranh chấp")).toBeNull();
    for (const t of ["Duyệt", "Từ chối", "Xin bằng chứng", "Bổ sung bằng chứng"]) expect(nut(t)).toBeTruthy();
  });

  it("trạng thái CUỐI (VALID · REJECTED · REJECTED_DUPLICATE) ⇒ không nút nào và nói «đã được chốt» + chỉ đường Đổi nguồn", () => {
    for (const t of ["VALID", "REJECTED", "REJECTED_DUPLICATE"] as const) {
      cleanup();
      panel({ trangThai: t });
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      expect(screen.getByTestId("referral-da-chot").textContent).toContain("đã được chốt");
      expect(screen.getByTestId("referral-da-chot").textContent).toContain("Đổi nguồn");
    }
  });

  it("đang chờ bằng chứng ⇒ có dòng trạng thái; không chờ ⇒ không có", () => {
    panel({ dangChoBangChung: true });
    expect(screen.getByRole("status").textContent).toContain("chờ bằng chứng");
    cleanup();
    panel({ dangChoBangChung: false });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("[XLU-02] nhập liệu chặn ngay trong form", () => {
  it("lý do ngắn ⇒ lỗi CẠNH ô, aria-invalid, KHÔNG gọi máy chủ", async () => {
    const { gui } = panel();
    fireEvent.click(nut("Duyệt"));
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "ngắn" } });
    fireEvent.change(screen.getByLabelText("Ghi chú bằng chứng"), { target: { value: GHI_CHU } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    expect(screen.getByLabelText("Lý do").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert").some((e) => /từ 10 ký tự/.test(e.textContent ?? ""))).toBe(true);
    expect(gui).not.toHaveBeenCalled();
  });

  it("CẢ NĂM hành động đều có ô ghi chú bằng chứng; «Xin bằng chứng» thiếu ghi chú thì bị chặn, đủ thì gửi", () => {
    for (const t of ["Duyệt", "Từ chối", "Đánh dấu tranh chấp", "Xin bằng chứng", "Bổ sung bằng chứng"]) {
      cleanup();
      panel();
      fireEvent.click(nut(t));
      expect(screen.queryByLabelText("Ghi chú bằng chứng"), t).not.toBeNull();
    }
    cleanup();
    const { gui } = panel();
    fireEvent.click(nut("Xin bằng chứng"));
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "Cần biên nhận gốc của sự kiện" } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    expect(gui).not.toHaveBeenCalled(); // thiếu ghi chú
    expect(screen.getByLabelText("Ghi chú bằng chứng").getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(screen.getByLabelText("Ghi chú bằng chứng"), { target: { value: "Đã đối chiếu biên nhận, chưa thấy chữ ký" } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    expect(gui).toHaveBeenCalledTimes(1);
  });

  it("thiếu ghi chú ở hành động đòi ghi chú ⇒ lỗi cạnh ô ghi chú, không gọi máy chủ", () => {
    const { gui } = panel();
    fireEvent.click(nut("Từ chối"));
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    expect(screen.getByLabelText("Ghi chú bằng chứng").getAttribute("aria-invalid")).toBe("true");
    expect(gui).not.toHaveBeenCalled();
  });
});

describe("[XLU-03] payload", () => {
  it("gửi ĐÚNG năm khoá: id · hanhDong · updatedAtDaThay (mốc lúc dựng trang) · lyDo đã trim · ghiChu", async () => {
    const { gui } = panel({ capNhatLuc: "2026-10-13T04:05:06.789Z" });
    fireEvent.click(nut("Duyệt"));
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: `   ${LY_DO}   ` } });
    fireEvent.change(screen.getByLabelText("Ghi chú bằng chứng"), { target: { value: GHI_CHU } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận: duyệt/ }));
    await waitFor(() => expect(gui).toHaveBeenCalledTimes(1));
    expect(gui).toHaveBeenCalledWith({ id: "ref-1", hanhDong: "DUYET", updatedAtDaThay: "2026-10-13T04:05:06.789Z", lyDo: LY_DO, ghiChu: GHI_CHU });
    expect(Object.keys((gui.mock.calls[0] as unknown[])[0] as object).sort()).toEqual(["ghiChu", "hanhDong", "id", "lyDo", "updatedAtDaThay"]);
  });

  it("không có khoá tiền / tỉ lệ / nguồn / trạng thái trong form", () => {
    panel();
    fireEvent.click(nut("Duyệt"));
    const form = document.querySelector("form")!;
    const ten = [...form.querySelectorAll("input,select,textarea")].map((e) => `${e.getAttribute("name") ?? ""}${e.id}`.toLowerCase());
    expect(ten.join(" ")).not.toMatch(/tien|rate|ti-le|tile|nguon|status|trangthai|amount|commission/);
    expect(form.querySelectorAll("textarea").length).toBe(2);
  });
});

describe("[XLU-04] kết quả máy chủ", () => {
  it("«vừa được xử lý» ⇒ hiện lên đầu form, form còn mở, không refresh", async () => {
    const gui = vi.fn(async (): Promise<KetQuaXuLyReferral> => ({ ok: false, loi: "Lượt này vừa được người khác xử lý hoặc thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" }));
    panel({ gui });
    fireEvent.click(nut("Từ chối"));
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: LY_DO } });
    fireEvent.change(screen.getByLabelText("Ghi chú bằng chứng"), { target: { value: GHI_CHU } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((e) => /vừa được người khác xử lý/.test(e.textContent ?? ""))).toBe(true));
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    expect(document.querySelector("form")).not.toBeNull();
  });

  it("lỗi theo ô (lyDo) từ máy chủ ⇒ gắn đúng ô; thành công ⇒ toast + đóng form + refresh", async () => {
    const gui = vi
      .fn<(i: unknown) => Promise<KetQuaXuLyReferral>>()
      .mockResolvedValueOnce({ ok: false, loi: "Lý do không được chứa số điện thoại hoặc email của khách.", truong: "lyDo" })
      .mockResolvedValueOnce(OK_XL);
    panel({ gui });
    fireEvent.click(nut("Duyệt"));
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: LY_DO } });
    fireEvent.change(screen.getByLabelText("Ghi chú bằng chứng"), { target: { value: GHI_CHU } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    await waitFor(() => expect(screen.getByLabelText("Lý do").getAttribute("aria-invalid")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
    expect(TOAST.success).toHaveBeenCalledTimes(1);
    expect(document.querySelector("form")).toBeNull();
  });
});

describe("[XLU-05] PII", () => {
  it("ghi chú chứa SĐT khách bị chặn ở trình duyệt, không gọi máy chủ; mã biên nhận thì qua (đối chứng dương)", async () => {
    const { gui } = panel();
    fireEvent.click(nut("Duyệt"));
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: LY_DO } });
    fireEvent.change(screen.getByLabelText("Ghi chú bằng chứng"), { target: { value: "Khách gọi từ số 0907 111 222 xác nhận" } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    expect(gui).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").some((e) => /số điện thoại hoặc email/.test(e.textContent ?? ""))).toBe(true);
    fireEvent.change(screen.getByLabelText("Ghi chú bằng chứng"), { target: { value: GHI_CHU } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    await waitFor(() => expect(gui).toHaveBeenCalledTimes(1));
  });
});

const LUA_CHON: LuaChonKhaiTay[] = [{ partyId: "p-1", campaignId: "c-1", doiTac: "Chị An", maDoiTac: "AN01", campaign: "Thu 2026", maCampaign: "THU26" }];

describe("[XLU-06] sheet khai tay", () => {
  async function moSheet(khai = vi.fn(async (): Promise<KetQuaKhaiTay> => ({ ok: true, id: "ref-moi" }))) {
    const tim = vi.fn(async () => ({ ok: true as const, phieu: [{ id: "lead000000000000000001", maRutGon: "000001", ten: "Ng*** Thị A", sdt: "090***222" }] }));
    render(<KhaiTaySheet luaChon={LUA_CHON} khai={khai} tim={tim} />);
    fireEvent.click(screen.getByRole("button", { name: "Khai tay referral" }));
    return { khai, tim };
  }

  it("KHÔNG có ô tiền / tỉ lệ / nguồn: chỉ cặp đối tác·campaign, cách đến, phiếu khách, lý do, ghi chú", async () => {
    await moSheet();
    const dlg = await screen.findByRole("dialog");
    const ten = [...dlg.querySelectorAll("input,select,textarea")].map((e) => `${e.getAttribute("name") ?? ""} ${e.id} ${e.getAttribute("placeholder") ?? ""}`.toLowerCase()).join(" | ");
    expect(ten).not.toMatch(/tiền|tien|tỉ lệ|ti le|rate|hoa hồng|commission|amount/);
    expect(dlg.querySelectorAll("select").length).toBe(1);
    expect(dlg.querySelectorAll("textarea").length).toBe(2);
    expect(dlg.querySelectorAll('input[type="radio"]').length).toBe(2);
    expect(dlg.textContent).toContain("không nhập tay");
  });

  it("điền đủ ⇒ gửi ĐÚNG sáu khoá, không khoá lạ; phiếu hiện đã che", async () => {
    const { khai, tim } = await moSheet();
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Đối tác · Campaign"), { target: { value: "p-1|c-1" } });
    fireEvent.change(within(dlg).getByPlaceholderText(/Mã phiếu/), { target: { value: "000001" } });
    fireEvent.click(within(dlg).getByRole("button", { name: /Tìm/ }));
    await waitFor(() => expect(tim).toHaveBeenCalledWith({ q: "000001" }));
    const ketQua = await within(dlg).findByRole("button", { name: /#000001/ });
    expect(ketQua.textContent).toContain("Ng*** Thị A");
    expect(ketQua.textContent).not.toContain("Nguyễn");
    fireEvent.click(ketQua);
    fireEvent.change(within(dlg).getByLabelText("Lý do"), { target: { value: LY_DO } });
    fireEvent.change(within(dlg).getByLabelText("Ghi chú bằng chứng"), { target: { value: GHI_CHU } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Ghi lượt khai tay" }));
    await waitFor(() => expect(khai).toHaveBeenCalledTimes(1));
    const gui = (khai.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(gui).toEqual({ partyId: "p-1", campaignId: "c-1", leadId: "lead000000000000000001", method: "OFFLINE", lyDo: LY_DO, ghiChu: GHI_CHU });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
  });

  it("thiếu phiếu khách / cặp ⇒ lỗi cạnh ô, không gọi máy chủ", async () => {
    const { khai } = await moSheet();
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Ghi lượt khai tay" }));
    expect(khai).not.toHaveBeenCalled();
    expect(within(dlg).getAllByRole("alert").length).toBeGreaterThanOrEqual(2);
  });
});

const dong = (p: Partial<DongLichSu> = {}): DongLichSu => ({
  id: "e1",
  luc: MOC,
  loai: "DUYET",
  tu: "MANUAL_REVIEW",
  den: "VALID",
  nguoi: "Lê Thị Quản Lý",
  lyDo: LY_DO,
  ghiChu: GHI_CHU,
  lyDoTruoc: null,
  ghiNguon: "TAO_MOI",
  tuDuyet: false,
  ...p,
});

describe("[XLU-07] lịch sử xử lý", () => {
  it("rỗng ⇒ nói thật «chưa có thao tác»; có dòng ⇒ hiện ai · trạng thái từ→đến · lý do · bằng chứng · nhánh ghi nguồn", () => {
    const a = render(<LichSuXuLy dong={[]} />);
    expect(a.container.textContent).toContain("Chưa có thao tác xử lý tay");
    expect(screen.queryByRole("list")).toBeNull();
    cleanup();
    render(<LichSuXuLy dong={[dong(), dong({ id: "e2", loai: "XIN_BANG_CHUNG", tu: "MANUAL_REVIEW", den: "MANUAL_REVIEW", ghiChu: null, ghiNguon: null, tuDuyet: true })]} />);
    const ds = screen.getByRole("list", { name: "Lịch sử xử lý" });
    expect(within(ds).getAllByRole("listitem")).toHaveLength(2);
    const t = ds.textContent ?? "";
    expect(t).toContain("Lê Thị Quản Lý");
    expect(t).toContain("Cần xem tay → Hợp lệ");
    expect(t).toContain(LY_DO);
    expect(t).toContain(GHI_CHU);
    expect(t).toContain("Đã ghi nguồn vào hồ sơ khách");
    expect(t).toContain("tự duyệt");
    // dòng «xin» không đổi trạng thái ⇒ không in mũi tên
    expect(within(within(ds).getAllByRole("listitem")[1]!).queryByText(/→/)).toBeNull();
  });
});
