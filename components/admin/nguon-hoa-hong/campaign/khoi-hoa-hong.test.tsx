// @vitest-environment jsdom
/**
 * [AFH-*] — KhoiHoaHong (mục «Hoa hồng» ở chi tiết campaign, AFF-L1) trên PHẦN TỬ THẬT (jsdom); hàm gọi máy chủ được TIÊM.
 *
 *   [AFH-01] «Chưa chọn» hiện RÕ và KHÁC với hai lựa chọn; «Không có mức riêng» không hứa «0 đồng»
 *   [AFH-02] NÚT = KHOÁ: chỉ bấm được khi `quyen.doiCheDo` ∧ chưa kết thúc (đối chứng dương: có quyền thì bấm được); không quyền ⇒ chỉ đọc, KHÔNG nút
 *   [AFH-03] đổi lựa chọn gọi ĐÚNG (id, mốc khoá lạc quan, đích, lý do) · campaign ACTIVE đòi lý do · KHÔNG tự kích hoạt gì (không có lời gọi nào ngoài `doi`)
 *   [AFH-04] danh sách phiên bản: thiếu quyền xem ⇒ «chưa có quyền» (KHÔNG danh sách rỗng); đối chứng dương: có quyền thì thấy mức tiền
 *   [AFH-05] đường «Soạn chính sách» chỉ khi `soanChinhSach` ∧ không phải «không có mức riêng»; trỏ đúng MÃ campaign; «Sửa nháp» chỉ ở phiên bản NHÁP
 *   [AFH-06] bảng «Cách tính» nói thẳng hold/stacking KHÔNG có trong engine; kiểu «Cố định» tự theo hằng guardrail
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions", () => ({ datCheDoThuongAction: vi.fn() }));

import type { CheDoThuong, TrangThaiCampaign } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { trangThaiCacKieuTinh, type PhienBanCuaCampaignView, type QuyenHoaHongCampaign } from "@/lib/affiliate/hoa-hong-campaign-dau-vao";
import { KhoiHoaHong } from "./khoi-hoa-hong";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOC = "2026-10-13T02:00:00.123Z";
const QUYEN_DU: QuyenHoaHongCampaign = { doiCheDo: true, xemChinhSach: true, soanChinhSach: true };
const PB = (p: Partial<PhienBanCuaCampaignView> = {}): PhienBanCuaCampaignView => ({
  versionId: "v1",
  policyId: "p1",
  policyCode: "AFF-TET_2027",
  versionNo: 1,
  khoa: "NHAP",
  nhan: "Nháp",
  tone: "muted",
  tuNgay: "2026-10-31T17:00:00.000Z",
  denNgay: null,
  mucTien: [{ loaiGd: "Khách hàng mới", vai: "Cộng tác viên / đối tác", mucTien: "3%" }],
  coVanBan: false,
  capNhatLuc: MOC,
  ...p,
});

type Cau = { trangThai?: TrangThaiCampaign; che?: CheDoThuong | null; pb?: PhienBanCuaCampaignView[] | null; quyen?: Partial<QuyenHoaHongCampaign>; doi?: ReturnType<typeof vi.fn> };
function dung(c: Cau = {}) {
  const doi = c.doi ?? vi.fn(async () => ({ ok: true as const, doi: true, updatedAt: MOC }));
  const r = render(
    <KhoiHoaHong
      campaignId="c1"
      maCampaign="TET_2027"
      capNhatLuc={MOC}
      trangThai={c.trangThai ?? "DRAFT"}
      cheDoThuong={c.che === undefined ? null : c.che}
      phienBan={c.pb === undefined ? [] : c.pb}
      quyen={{ ...QUYEN_DU, ...c.quyen }}
      tran="9%"
      hrefTran="/cau-hinh-van-hanh?tab=khach-hang"
      doi={doi as never}
    />,
  );
  return { doi, ...r };
}
const radio = (ten: RegExp) => screen.getAllByRole("radio").find((r) => ten.test(r.textContent ?? ""))!;

describe("[AFH-01] chưa chọn ≠ không thưởng", () => {
  it("null ⇒ dải «Chưa chọn» và KHÔNG ô nào được đánh dấu; NONE ⇒ ô «Không có mức riêng» được chọn, không có dải", () => {
    const { unmount } = dung({ che: null });
    expect(screen.getByRole("status").textContent).toContain("Chưa chọn");
    expect(screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    unmount();
    dung({ che: "NONE" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(radio(/Không có mức riêng/).getAttribute("aria-checked")).toBe("true");
    expect(radio(/Có thưởng/).getAttribute("aria-checked")).toBe("false");
  });
  it("«Không có mức riêng» nói thẳng chính sách chung vẫn có thể trả — không hứa «0 đồng»", () => {
    dung({ che: "NONE" });
    const o = radio(/Không có mức riêng/);
    expect(o.textContent).toMatch(/KHÔNG phải «đối tác không nhận gì»/);
    expect(o.textContent).toMatch(/chính sách chung/);
  });
});

describe("[AFH-02] nút = khoá", () => {
  it("có quyền + chưa kết thúc ⇒ ô CHƯA chọn là nút bấm được; ô đang chọn thì không", () => {
    dung({ che: "NONE" });
    expect(radio(/Có thưởng/).tagName).toBe("BUTTON");
    expect(radio(/Không có mức riêng/).tagName).toBe("DIV");
  });
  it("không có `doiCheDo` ⇒ KHÔNG nút nào, có câu nêu khoá; campaign ENDED ⇒ không nút, có câu nói kết thúc", () => {
    const a = dung({ che: "NONE", quyen: { doiCheDo: false } });
    expect(a.container.querySelectorAll("button[role=radio]")).toHaveLength(0);
    expect(screen.getByText(/affiliate_campaigns:manage/)).toBeTruthy();
    a.unmount();
    const b = dung({ che: "NONE", trangThai: "ENDED" });
    expect(b.container.querySelectorAll("button[role=radio]")).toHaveLength(0);
    expect(screen.getByText(/đã kết thúc — không đổi lựa chọn/)).toBeTruthy();
  });
});

describe("[AFH-03] đổi lựa chọn", () => {
  it("campaign nháp: bấm «Có thưởng» → xác nhận → gọi ĐÚNG (id, mốc, đích, lý do null) → làm mới + toast; không lời gọi nào khác", async () => {
    const { doi } = dung({ che: null });
    fireEvent.click(radio(/Có thưởng/));
    const hop = await screen.findByRole("dialog");
    fireEvent.click(within(hop).getByRole("button", { name: "Chọn" }));
    await waitFor(() => expect(doi).toHaveBeenCalledTimes(1));
    expect(doi).toHaveBeenCalledWith({ id: "c1", updatedAtDaThay: MOC, den: "POLICY", lyDo: null });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
    expect(TOAST.success).toHaveBeenCalled();
  });
  it("campaign ĐANG CHẠY đòi lý do: bỏ trống ⇒ lỗi cạnh ô, không gọi máy chủ; đủ dài ⇒ gọi với lý do đã cắt khoảng trắng", async () => {
    const { doi } = dung({ che: "POLICY", trangThai: "ACTIVE" });
    fireEvent.click(radio(/Không có mức riêng/));
    const hop = await screen.findByRole("dialog");
    fireEvent.click(within(hop).getByRole("button", { name: "Chọn" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/10 ký tự/);
    expect(doi).not.toHaveBeenCalled();
    fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: "  Đổi chính sách quý 4  " } });
    fireEvent.click(within(hop).getByRole("button", { name: "Chọn" }));
    await waitFor(() => expect(doi).toHaveBeenCalledWith({ id: "c1", updatedAtDaThay: MOC, den: "NONE", lyDo: "Đổi chính sách quý 4" }));
  });
  it("máy chủ từ chối (còn chính sách đang áp) ⇒ câu lỗi hiện trong hộp thoại, hộp thoại KHÔNG tự đóng", async () => {
    const doi = vi.fn(async () => ({ ok: false as const, loi: "Không chọn được: campaign còn 1 chính sách đang hiệu lực.", truong: "cheDoThuong" }));
    dung({ che: "POLICY", doi });
    fireEvent.click(radio(/Không có mức riêng/));
    const hop = await screen.findByRole("dialog");
    fireEvent.click(within(hop).getByRole("button", { name: "Chọn" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/còn 1 chính sách/);
    expect(screen.queryByRole("dialog")).toBeTruthy();
  });
});

describe("[AFH-04] quyền xem chính sách", () => {
  it("phienBan = null (thiếu commission_policies:view) ⇒ câu «chưa có quyền», KHÔNG phải «chưa có chính sách»", () => {
    dung({ pb: null, quyen: { xemChinhSach: false, soanChinhSach: false } });
    expect(screen.getByText(/chưa có quyền xem chính sách hoa hồng/)).toBeTruthy();
    expect(screen.queryByText(/Chưa có chính sách riêng nào/)).toBeNull();
    expect(screen.queryByText(/3%/)).toBeNull();
  });
  it("đối chứng dương: có quyền ⇒ thấy mã chính sách, mức tiền, trạng thái; mảng rỗng ⇒ «Chưa có chính sách riêng nào»", () => {
    const a = dung({ pb: [PB()] });
    expect(screen.getByRole("link", { name: "AFF-TET_2027" }).getAttribute("href")).toBe("/nguon-hoa-hong/chinh-sach/p1");
    expect(screen.getByText(/Khách hàng mới · Cộng tác viên/).textContent).toContain("3%");
    expect(screen.getByText("Nháp")).toBeTruthy();
    a.unmount();
    dung({ pb: [] });
    expect(screen.getByText(/Chưa có chính sách riêng nào/)).toBeTruthy();
  });
});

describe("[AFH-05] đường tới trình soạn", () => {
  it("có quyền soạn ∧ chưa «không có mức riêng» ⇒ liên kết trỏ đúng MÃ campaign; nói rõ lưu nháp không kích hoạt", () => {
    dung({ che: "POLICY" });
    expect(screen.getByRole("link", { name: /Soạn chính sách cho campaign này/ }).getAttribute("href")).toBe("/nguon-hoa-hong/chinh-sach/moi?campaign=TET_2027");
    expect(screen.getByText(/Lưu nháp không kích hoạt gì/)).toBeTruthy();
  });
  it("KHÔNG vẽ liên kết khi: thiếu quyền soạn (đối chứng: có quyền thì có) · «không có mức riêng» (nói vì sao) · đã kết thúc · đã có nháp (mở nháp thay vì đẻ thêm)", () => {
    const a = dung({ che: "POLICY", quyen: { soanChinhSach: false } });
    expect(screen.queryByRole("link", { name: /Soạn chính sách cho campaign này/ })).toBeNull();
    a.unmount();
    const b = dung({ che: "NONE" });
    expect(screen.queryByRole("link", { name: /Soạn chính sách cho campaign này/ })).toBeNull();
    expect(screen.getByText(/Chọn «Có thưởng theo chính sách riêng của campaign» để soạn/)).toBeTruthy();
    b.unmount();
    const c = dung({ che: "POLICY", trangThai: "ENDED" });
    expect(screen.queryByRole("link", { name: /Soạn chính sách cho campaign này/ })).toBeNull();
    c.unmount();
    dung({ che: "POLICY", pb: [PB()] });
    expect(screen.queryByRole("link", { name: /Soạn chính sách cho campaign này/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Sửa nháp" }).getAttribute("href")).toBe("/nguon-hoa-hong/chinh-sach/p1/soan?v=v1");
  });
  it("«Sửa nháp» chỉ ở phiên bản NHÁP: bản đang áp không có nút sửa", () => {
    dung({ che: "POLICY", pb: [PB({ khoa: "DANG_AP_DUNG", nhan: "Đang áp dụng", tone: "success", versionId: "v2" })] });
    expect(screen.queryByRole("link", { name: "Sửa nháp" })).toBeNull();
    expect(screen.getByRole("link", { name: /Soạn chính sách cho campaign này/ })).toBeTruthy();
  });
});

describe("[AFH-06] cách tính nói thật", () => {
  it("hold và stacking có nhãn «không có trong engine»; trường có thật thì không có nhãn đó", () => {
    dung({});
    const dt = screen.getByText(/Số ngày giữ \(hold\)/);
    expect(dt.textContent).toContain("không có trong engine");
    expect(screen.getByText(/Cách cộng dồn \(stacking\)/).textContent).toContain("không có trong engine");
    expect(screen.getByText("Kiểu tính · giá trị").textContent).not.toContain("không có trong engine");
  });
  it("mỗi kiểu tính in đúng trạng thái suy từ hằng guardrail (không gõ cứng)", () => {
    dung({});
    const ds = within(screen.getByLabelText("Kiểu tính")).getAllByRole("listitem");
    const tt = trangThaiCacKieuTinh();
    expect(ds.map((l) => l.textContent)).toEqual(tt.map((k) => `${k.nhan} — ${k.ghiChu}`));
  });
  it("[FX-UI03] (AFF-L2b) «Cố định» DÙNG ĐƯỢC và nói ĐÚNG cách engine tính — chữ gõ thẳng (không suy từ hằng) để đỏ nếu engine hay hằng đổi mà chữ không đổi theo", () => {
    dung({});
    const muc = within(screen.getByLabelText("Kiểu tính")).getAllByRole("listitem").map((l) => l.textContent ?? "");
    const fx = muc.find((t) => t.startsWith("Cố định (số tiền)"))!;
    expect(fx).toContain("Dùng được");
    expect(fx).toContain("Cố định: trả một lần cho mỗi lần mua, tại khoản thu đầu tiên đủ điều kiện");
    expect(fx).not.toContain("Chưa kích hoạt được");
    expect(muc.find((t) => t.startsWith("Phần trăm"))).not.toContain("một lần cho mỗi lần mua"); // đối chứng: câu ấy chỉ của kiểu cố định
  });
  it("trần: có quyền nâng ⇒ liên kết tới Cấu hình vận hành; không ⇒ chữ, không liên kết", () => {
    const a = dung({});
    expect(screen.getByRole("link", { name: /Nâng trần/ }).getAttribute("href")).toBe("/cau-hinh-van-hanh?tab=khach-hang");
    a.unmount();
    render(
      <KhoiHoaHong campaignId="c1" maCampaign="TET_2027" capNhatLuc={MOC} trangThai="DRAFT" cheDoThuong={null} phienBan={[]} quyen={QUYEN_DU} tran="9%" hrefTran={null} doi={vi.fn() as never} />,
    );
    expect(screen.queryByRole("link", { name: /Nâng trần/ })).toBeNull();
    expect(screen.getByText(/thao tác của quản trị hệ thống/)).toBeTruthy();
  });
});
