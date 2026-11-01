// @vitest-environment jsdom
/**
 * [AFU-*] — Các khối GHI của trang chi tiết campaign Affiliate trên PHẦN TỬ THẬT (jsdom); hàm gọi máy chủ được TIÊM.
 *
 *   [AFU-01] NutDoiTrangThaiCampaign: nút theo bảng chuyển; điều kiện thiếu ⇒ hộp thoại chỉ đọc; lý do khi tạm dừng / kết thúc; gọi ĐÚNG tham số; «vừa đổi» ⇒ Tải lại
 *   [AFU-02] KhoiQuyTac: quyền & trạng thái quyết định nút (luật 12) · kiểm đầu vào · gọi ĐÚNG · KHÔNG có ô chọn chính sách
 *   [AFU-03] KhoiWebsite: website bật cuối cùng của campaign ĐANG CHẠY không có nút Gỡ · website tắt không gắn mới được
 *   [AFU-04] NutMembership: nút theo bảng chuyển; thao tác bị chặn ⇒ câu lý do thay nút; sửa nhãn / hiệu lực
 *   [AFU-05] ThemMembership: đối tác đã ở trong campaign không chọn được; ENDED ⇒ «mở lại»; kiểm đầu vào
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương "ca kia THẤY X" (CLAUDE.md luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions", () => ({
  taoCampaignAction: vi.fn(),
  suaCampaignAction: vi.fn(),
  doiTrangThaiCampaignAction: vi.fn(),
  themQuyTacAction: vi.fn(),
  xoaQuyTacAction: vi.fn(),
  ganWebsiteAction: vi.fn(),
  goWebsiteAction: vi.fn(),
  themMembershipAction: vi.fn(),
  doiTrangThaiMembershipAction: vi.fn(),
  suaMembershipAction: vi.fn(),
}));

import type { ChanKichHoat, DoiTacChonView, DongMembershipView, QuyTacView, TrangThaiCampaign, WebsiteGanView, WebsiteView } from "@/lib/affiliate/ghi-campaign-dau-vao";
import type { KetQuaThemMembership, TrangThaiMembership } from "@/lib/affiliate/ghi-membership-dau-vao";
import { KhoiQuyTac } from "./khoi-quy-tac";
import type { DatTrangDich } from "./chon-trang-dich";
import { KhoiWebsite } from "./khoi-website";
import { NutDoiTrangThaiCampaign } from "./nut-doi-trang-thai-campaign";
import { NutMembership } from "./nut-membership";
import { ThemMembership } from "./them-membership";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LY_DO = "Lý do đủ dài để qua cổng";
const MOC = "2026-10-13T02:00:00.123Z";
const OK = { ok: true } as const;

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe("[AFU-01] NutDoiTrangThaiCampaign", () => {
  const camp = (status: TrangThaiCampaign) => ({ id: "c1", name: "Tết 2027", status, capNhatLuc: MOC });
  const GOC = "/nguon-hoa-hong/campaign/TET_2027";
  const dung = (status: TrangThaiCampaign, chan: ChanKichHoat[] = [], doi = vi.fn(async () => ({ ok: true as const, tu: status, den: "PAUSED" as const, updatedAt: MOC }))) => {
    const r = render(<NutDoiTrangThaiCampaign campaign={camp(status)} chanKichHoat={chan} goc={GOC} doi={doi} />);
    return { doi, ...r };
  };
  const ten = (name: string) => screen.getByRole("button", { name });

  it("nút lấy từ bảng chuyển: DRAFT {Kích hoạt, Huỷ nháp} · ACTIVE {Tạm dừng, Kết thúc} · PAUSED {Chạy lại, Kết thúc} · ENDED không nút nào", () => {
    for (const [status, nhan, khong] of [
      ["DRAFT", ["Kích hoạt", "Huỷ nháp"], ["Tạm dừng", "Chạy lại"]],
      ["ACTIVE", ["Tạm dừng", "Kết thúc"], ["Kích hoạt", "Chạy lại"]],
      ["PAUSED", ["Chạy lại", "Kết thúc"], ["Kích hoạt", "Tạm dừng"]],
    ] as const) {
      const { unmount } = dung(status);
      for (const n of nhan) expect(ten(n), `${status}: ${n}`).toBeTruthy();
      for (const n of khong) expect(screen.queryByRole("button", { name: n }), `${status}: không ${n}`).toBeNull();
      unmount();
    }
    const ended = dung("ENDED");
    expect(ended.container.querySelectorAll("button")).toHaveLength(0);
  });

  it("điều kiện kích hoạt còn thiếu ⇒ hộp thoại CHỈ ĐỌC: liệt kê TẤT CẢ điều kiện, mỗi cái có đường «Sửa» tới đúng mục, KHÔNG có nút xác nhận, không gọi máy chủ", async () => {
    const { doi } = dung("DRAFT", [
      { ma: "WEBSITE", thongBao: "Chưa gắn website nào — gắn ít nhất một website.", muc: "website" },
      { ma: "NGUON_KHONG_DUNG", thongBao: "Nguồn «Đối tác» đang ở trạng thái «Tạm ngừng».", muc: "quy-tac" },
      { ma: "THUONG_CHUA_CHON", thongBao: "Chưa chọn thưởng.", muc: "hoa-hong" },
      { ma: "HIEU_LUC", thongBao: "Hết hiệu lực.", muc: "thong-tin" },
    ]);
    fireEvent.click(ten("Kích hoạt"));
    const hop = await screen.findByRole("dialog");
    expect(within(hop).getByText(/Chưa gắn website nào/)).toBeTruthy();
    expect(within(hop).getByText(/Tạm ngừng/)).toBeTruthy();
    expect(within(hop).getAllByRole("listitem")).toHaveLength(4);
    expect(within(hop).getAllByRole("link", { name: "Sửa" }).map((a) => a.getAttribute("href"))).toEqual([`${GOC}#website`, `${GOC}#quy-tac`, `${GOC}#hoa-hong`, `${GOC}/sua`]);
    expect(within(hop).queryByRole("button", { name: "Kích hoạt" })).toBeNull();
    expect(within(hop).getByRole("button", { name: "Đóng" })).toBeTruthy();
    expect(doi).not.toHaveBeenCalled();
  });

  it("đối chứng dương: không điều kiện thiếu ⇒ có nút xác nhận, gọi ĐÚNG (id, mốc khoá lạc quan, đích, lý do null) rồi làm mới + toast", async () => {
    const { doi } = dung("DRAFT", []);
    fireEvent.click(ten("Kích hoạt"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Kích hoạt" }));
    await waitFor(() => expect(doi).toHaveBeenCalledTimes(1));
    expect(doi).toHaveBeenCalledWith({ id: "c1", updatedAtDaThay: MOC, den: "ACTIVE", lyDo: null });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
    expect(TOAST.success).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("điều kiện thiếu chỉ chặn đường ĐI TỚI ACTIVE: campaign đang chạy vẫn tạm dừng được dù danh sách thiếu không rỗng", async () => {
    const { doi } = dung("ACTIVE", [{ ma: "WEBSITE", thongBao: "Một điều kiện nào đó", muc: "website" }]);
    fireEvent.click(ten("Tạm dừng"));
    const hop = await screen.findByRole("dialog");
    expect(within(hop).getByRole("button", { name: "Tạm dừng" })).toBeTruthy();
    fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(within(hop).getByRole("button", { name: "Tạm dừng" }));
    await waitFor(() => expect(doi).toHaveBeenCalledWith({ id: "c1", updatedAtDaThay: MOC, den: "PAUSED", lyDo: LY_DO }));
  });

  it("tạm dừng / kết thúc: lý do BẮT BUỘC — bỏ trống hoặc ngắn ⇒ lỗi cạnh ô (role=alert, aria-invalid), KHÔNG gọi máy chủ", async () => {
    const { doi } = dung("ACTIVE");
    fireEvent.click(ten("Kết thúc"));
    const hop = await screen.findByRole("dialog");
    fireEvent.click(within(hop).getByRole("button", { name: "Kết thúc" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/10 ký tự/);
    expect(within(hop).getByLabelText(/Lý do/).getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: "ngắn" } });
    fireEvent.click(within(hop).getByRole("button", { name: "Kết thúc" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/10 ký tự/);
    expect(doi).not.toHaveBeenCalled();
    fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: `  ${LY_DO}  ` } });
    fireEvent.click(within(hop).getByRole("button", { name: "Kết thúc" }));
    await waitFor(() => expect(doi).toHaveBeenCalledWith({ id: "c1", updatedAtDaThay: MOC, den: "ENDED", lyDo: LY_DO }));
  });

  it("«vừa được người khác đổi» ⇒ banner + nút «Tải lại»; bấm Tải lại làm mới trang; hộp thoại KHÔNG tự đóng khi lỗi", async () => {
    const doi = vi.fn(async () => ({ ok: false as const, loi: "Campaign vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" }));
    dung("DRAFT", [], doi as never);
    fireEvent.click(ten("Kích hoạt"));
    const hop = await screen.findByRole("dialog");
    fireEvent.click(within(hop).getByRole("button", { name: "Kích hoạt" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/vừa được người khác/);
    fireEvent.click(within(hop).getByRole("button", { name: "Tải lại" }));
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it("máy chủ trả DANH SÁCH điều kiện chặn (dữ liệu trang đã cũ) ⇒ banner liệt kê từng cái", async () => {
    const doi = vi.fn(async () => ({
      ok: false as const,
      loi: "x",
      truong: "kichHoat",
      lyDoChan: [
        { ma: "WEBSITE", thongBao: "Chưa gắn website nào", muc: "website" as const },
        { ma: "HIEU_LUC", thongBao: "Hết hiệu lực", muc: "thong-tin" as const },
      ],
    }));
    dung("DRAFT", [], doi as never);
    fireEvent.click(ten("Kích hoạt"));
    const hop = await screen.findByRole("dialog");
    fireEvent.click(within(hop).getByRole("button", { name: "Kích hoạt" }));
    const banner = await within(hop).findByRole("alert");
    expect(within(banner).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["Chưa gắn website nào Sửa", "Hết hiệu lực Sửa"]);
    expect(within(banner).getAllByRole("link", { name: "Sửa" }).map((a) => a.getAttribute("href"))).toEqual([`${GOC}#website`, `${GOC}/sua`]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe("[AFU-02] KhoiQuyTac", () => {
  const NGUON_OK = { id: "s1", code: "DOI_TAC", ten: "Giới thiệu bởi đối tác", moTa: null };
  const NGUON_KHAC = { id: "s2", code: "SU_KIEN", ten: "Sự kiện", moTa: null };
  const LOAI = [{ id: "t1", code: "SCHOOL", ten: "Trường học" }];
  const NHAN = [{ id: "g1", code: "KOL", ten: "KOL" }];
  const RULE: QuyTacView = {
    id: "r1",
    typeId: "t1",
    tagId: null,
    loai: { code: "SCHOOL", ten: "Trường học" },
    nhan: null,
    nguon: { id: "s1", code: "DOI_TAC", ten: "Giới thiệu bởi đối tác", status: "ACTIVE", chonDuoc: true },
  };
  const dung = (p: { trangThai?: TrangThaiCampaign; coTheGhi?: boolean; quyTac?: QuyTacView[]; loai?: typeof LOAI; nhan?: typeof NHAN } = {}) => {
    const them = vi.fn(async () => OK);
    const xoa = vi.fn(async () => OK);
    render(
      <KhoiQuyTac campaignId="c1" trangThai={p.trangThai ?? "DRAFT"} quyTac={p.quyTac ?? [RULE]} loai={p.loai ?? LOAI} nhan={p.nhan ?? NHAN} nguon={[NGUON_OK, NGUON_KHAC]} coTheGhi={p.coTheGhi ?? true} them={them} xoa={xoa} />,
    );
    return { them, xoa };
  };

  it("NÚT THEO QUYỀN: thiếu `manage` ⇒ KHÔNG form thêm, KHÔNG nút Xoá, KHÔNG cột Thao tác; vẫn thấy quy tắc. Đối chứng dương: có quyền ⇒ thấy cả ba", () => {
    dung({ coTheGhi: false });
    expect(screen.getByText("Trường học")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Thêm quy tắc quy nguồn" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Xoá quy tắc/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Thao tác" })).toBeNull();
    cleanup();
    dung({ coTheGhi: true });
    expect(screen.getByRole("form", { name: "Thêm quy tắc quy nguồn" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Xoá quy tắc/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Thao tác" })).toBeTruthy();
  });

  it("NÚT THEO TRẠNG THÁI: ĐANG CHẠY / ĐÃ KẾT THÚC ⇒ không form, không Xoá, có câu nói VÌ SAO; DRAFT và PAUSED thì có", () => {
    dung({ trangThai: "ACTIVE" });
    expect(screen.queryByRole("form", { name: "Thêm quy tắc quy nguồn" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Xoá quy tắc/ })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/tạm dừng campaign trước/);
    cleanup();
    dung({ trangThai: "ENDED" });
    expect(screen.queryByRole("form", { name: "Thêm quy tắc quy nguồn" })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/đã kết thúc/);
    cleanup();
    for (const t of ["DRAFT", "PAUSED"] as const) {
      dung({ trangThai: t });
      expect(screen.getByRole("form", { name: "Thêm quy tắc quy nguồn" }), t).toBeTruthy();
      cleanup();
    }
  });

  it("KHÔNG có ô chọn chính sách hoa hồng (cột policyId để trống tới P2)", () => {
    dung();
    expect(screen.queryByLabelText(/chính sách/i)).toBeNull();
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("chưa có quy tắc ⇒ nói khách sẽ nhận nguồn mặc định; quy tắc trỏ nguồn đã hỏng ⇒ cảnh báo ngay trên dòng", () => {
    dung({ quyTac: [] });
    expect(screen.getByText(/Chưa có quy tắc nào/).textContent).toMatch(/Cần xem tay/);
    cleanup();
    dung({ quyTac: [{ ...RULE, nguon: { ...RULE.nguon, status: "INACTIVE", chonDuoc: false } }] });
    expect(screen.getByText(/Nguồn này hiện «Tạm ngừng»/)).toBeTruthy();
  });

  it("ô «Gán nguồn» CHỈ có nguồn được truyền vào (chọn được); không loại, không nhãn ⇒ lỗi cạnh ô, KHÔNG gọi máy chủ", async () => {
    const { them } = dung();
    const nguon = screen.getByLabelText("Gán nguồn") as HTMLSelectElement;
    expect([...nguon.options].map((o) => o.textContent)).toEqual(["— Chọn nguồn —", "Giới thiệu bởi đối tác", "Sự kiện"]);
    fireEvent.change(nguon, { target: { value: "s1" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm quy tắc" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/loại đối tác, nhãn đối tác, hoặc cả hai/);
    expect(them).not.toHaveBeenCalled();
  });

  it("thiếu nguồn ⇒ lỗi; đủ ⇒ gọi ĐÚNG (campaignId, typeId/tagId/sourceGroupId, lý do null ở DRAFT), toast + làm mới + xoá ô", async () => {
    const { them } = dung();
    fireEvent.change(screen.getByLabelText("Loại đối tác"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm quy tắc" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Chọn nguồn/);
    expect(them).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Gán nguồn"), { target: { value: "s2" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm quy tắc" }));
    await waitFor(() => expect(them).toHaveBeenCalledWith({ campaignId: "c1", vao: { typeId: "t1", tagId: null, sourceGroupId: "s2" }, lyDo: null }));
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
    expect(TOAST.success).toHaveBeenCalled();
    expect((screen.getByLabelText("Loại đối tác") as HTMLSelectElement).value).toBe("");
  });

  it("PAUSED: ô lý do XUẤT HIỆN và BẮT BUỘC; DRAFT không có ô lý do", async () => {
    dung({ trangThai: "DRAFT" });
    expect(screen.queryByLabelText(/Lý do/)).toBeNull();
    cleanup();
    const { them } = dung({ trangThai: "PAUSED" });
    fireEvent.change(screen.getByLabelText("Nhãn đối tác"), { target: { value: "g1" } });
    fireEvent.change(screen.getByLabelText("Gán nguồn"), { target: { value: "s1" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm quy tắc" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/10 ký tự/);
    expect(them).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm quy tắc" }));
    await waitFor(() => expect(them).toHaveBeenCalledWith({ campaignId: "c1", vao: { typeId: null, tagId: "g1", sourceGroupId: "s1" }, lyDo: LY_DO }));
  });

  it("lỗi máy chủ «đã có quy tắc cho cặp này» hiện ở form, ô KHÔNG bị xoá", async () => {
    const them = vi.fn(async () => ({ ok: false as const, loi: "Đã có quy tắc cho cặp này — xoá quy tắc cũ.", truong: "typeId" }));
    render(<KhoiQuyTac campaignId="c1" trangThai="DRAFT" quyTac={[]} loai={LOAI} nhan={NHAN} nguon={[NGUON_OK]} coTheGhi them={them} />);
    fireEvent.change(screen.getByLabelText("Loại đối tác"), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText("Gán nguồn"), { target: { value: "s1" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm quy tắc" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Đã có quy tắc/);
    expect((screen.getByLabelText("Loại đối tác") as HTMLSelectElement).value).toBe("t1");
  });

  it("xoá quy tắc: hộp thoại xác nhận → gọi ĐÚNG (campaignId, ruleId); PAUSED đòi lý do", async () => {
    const { xoa } = dung();
    fireEvent.click(screen.getByRole("button", { name: /Xoá quy tắc/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Xoá quy tắc" }));
    await waitFor(() => expect(xoa).toHaveBeenCalledWith({ campaignId: "c1", ruleId: "r1", lyDo: null }));
    cleanup();
    const p = dung({ trangThai: "PAUSED" });
    fireEvent.click(screen.getByRole("button", { name: /Xoá quy tắc/ }));
    const hop = await screen.findByRole("dialog");
    fireEvent.click(within(hop).getByRole("button", { name: "Xoá quy tắc" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/10 ký tự/);
    expect(p.xoa).not.toHaveBeenCalled();
  });

  it("chưa có loại lẫn nhãn nào ⇒ form nói thẳng thay vì ba ô rỗng", () => {
    dung({ loai: [], nhan: [], quyTac: [] });
    expect(screen.queryByRole("button", { name: "Thêm quy tắc" })).toBeNull();
    expect(screen.getByRole("form", { name: "Thêm quy tắc quy nguồn" }).textContent).toMatch(/Chưa có loại hay nhãn/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe("[AFU-03] KhoiWebsite", () => {
  const W = (id: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE", rieng: Partial<WebsiteGanView> = {}): WebsiteGanView => ({
    id,
    code: id.toUpperCase(),
    ten: `Web ${id}`,
    baseUrl: `https://${id}.example.test`,
    status,
    trangDich: [],
    trangDaChon: [],
    ...rieng,
  });
  const dung = (p: { trangThai?: TrangThaiCampaign; coTheGhi?: boolean; daGan?: WebsiteGanView[]; tatCa?: WebsiteView[]; datTrang?: DatTrangDich } = {}) => {
    const gan = vi.fn(async () => OK);
    const go = vi.fn(async () => OK);
    const daGan = p.daGan ?? [W("a")];
    render(<KhoiWebsite campaignId="c1" trangThai={p.trangThai ?? "DRAFT"} daGan={daGan} tatCa={p.tatCa ?? [...daGan, W("b"), W("c", "INACTIVE")]} coTheGhi={p.coTheGhi ?? true} gan={gan} go={go} datTrang={p.datTrang} />);
    return { gan, go };
  };
  const TD = (id: string, host: string, pathPattern: string, rieng: Partial<WebsiteGanView["trangDich"][number]> = {}) => ({ id, host, pathPattern, label: null, isActive: true, trackingEnabled: true, ...rieng });

  it("[AFFL6-UI-01] cột «Trang đích được dùng» nói thật: không chọn = mọi trang đang bật (đếm đúng); có chọn = N trang đã chọn", () => {
    dung({ daGan: [W("a", "ACTIVE", { trangDich: [TD("t1", "a.example.test", "/x"), TD("t2", "a.example.test", "/y", { isActive: false })] }), W("b", "ACTIVE", { trangDich: [TD("t3", "b.example.test", "/z")], trangDaChon: ["t3"] })] });
    const cells = [...document.querySelectorAll("[data-trang-dich-campaign]")].map((c) => c.textContent);
    expect(cells).toEqual(["Mọi trang đích đang bật (1)", "1 trang đã chọn"]);
  });

  it("[AFFL6-UI-02] nút «Trang đích» CHỈ khi có quyền ghi (đối chứng dương) và campaign chưa kết thúc", () => {
    dung({ coTheGhi: false });
    expect(screen.queryByRole("button", { name: /Chọn trang đích của website/ })).toBeNull();
    cleanup();
    dung({ trangThai: "ENDED" });
    expect(screen.queryByRole("button", { name: /Chọn trang đích của website/ })).toBeNull();
    cleanup();
    dung({});
    expect(screen.getByRole("button", { name: "Chọn trang đích của website Web a" })).toBeTruthy();
  });

  it("[AFFL6-UI-03] chọn trang → gửi ĐÚNG (campaignId, siteId, ids, xacNhan=false); máy chủ báo số link bị ảnh hưởng ⇒ hỏi lại, «Vẫn thu hẹp» mới gửi xacNhan=true", async () => {
    const datTrang = vi
      .fn<DatTrangDich>()
      .mockResolvedValueOnce({ ok: false, loi: "x", truong: "xacNhan", canXacNhan: true, soLinkAnhHuong: 3 })
      .mockResolvedValueOnce({ ok: true, soLinkAnhHuong: 3 });
    dung({ datTrang, daGan: [W("a", "ACTIVE", { trangDich: [TD("t1", "a.example.test", "/x"), TD("t2", "covua.a.example.test", "/giai-dau/*"), TD("t3", "a.example.test", "/tat", { isActive: false })] })] });
    fireEvent.click(screen.getByRole("button", { name: "Chọn trang đích của website Web a" }));
    const sheet = await screen.findByRole("dialog");
    // trang đang tắt: không chọn mới được (đối chứng: trang bật chọn được)
    expect((within(sheet).getByLabelText(/a\.example\.test\/tat/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByLabelText(/covua\.a\.example\.test\/giai-dau/));
    fireEvent.click(within(sheet).getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(datTrang).toHaveBeenCalledTimes(1));
    expect(datTrang).toHaveBeenLastCalledWith({ campaignId: "c1", siteId: "a", landingPageIds: ["t2"], xacNhan: false, lyDo: null });
    expect((await within(sheet).findByRole("alert")).textContent).toContain("3");
    // «Vẫn thu hẹp» KHÓA tới khi có lý do ≥ 10 ký tự (nhật ký kiểm toán không chỉ có câu mặc định); đối chứng dương: đủ lý do thì gửi
    const nut = within(sheet).getByRole("button", { name: "Vẫn thu hẹp" }) as HTMLButtonElement;
    expect(nut.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText(/Lý do thu hẹp/), { target: { value: "ngắn" } });
    expect(nut.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText(/Lý do thu hẹp/), { target: { value: "Chuyển sang trang đích mới của chiến dịch" } });
    expect(nut.disabled).toBe(false);
    fireEvent.click(nut);
    await waitFor(() => expect(datTrang).toHaveBeenCalledTimes(2));
    expect(datTrang).toHaveBeenLastCalledWith({ campaignId: "c1", siteId: "a", landingPageIds: ["t2"], xacNhan: true, lyDo: "Chuyển sang trang đích mới của chiến dịch" });
  });

  it("NÚT THEO QUYỀN: thiếu `manage` ⇒ không form gắn, không nút Gỡ; có quyền ⇒ thấy cả hai (đối chứng dương)", () => {
    dung({ coTheGhi: false });
    expect(screen.getByText("Web a")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Gắn website vào campaign" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Gỡ website/ })).toBeNull();
    cleanup();
    dung({ coTheGhi: true });
    expect(screen.getByRole("form", { name: "Gắn website vào campaign" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gỡ website Web a/ })).toBeTruthy();
  });

  it("ĐANG CHẠY: website bật CUỐI CÙNG không có nút Gỡ (nói vì sao); còn website bật khác thì mỗi cái có nút Gỡ", () => {
    dung({ trangThai: "ACTIVE", daGan: [W("a")] });
    expect(screen.queryByRole("button", { name: /Gỡ website/ })).toBeNull();
    expect(screen.getByText(/Website bật cuối cùng/)).toBeTruthy();
    cleanup();
    dung({ trangThai: "ACTIVE", daGan: [W("a"), W("b")] });
    expect(screen.getAllByRole("button", { name: /Gỡ website/ })).toHaveLength(2);
  });

  it("ĐANG CHẠY với một website bật + một website TẮT: gỡ cái tắt được, gỡ cái bật cuối cùng thì không", () => {
    dung({ trangThai: "ACTIVE", daGan: [W("a"), W("c", "INACTIVE")] });
    expect(screen.queryByRole("button", { name: "Gỡ website Web a khỏi campaign" })).toBeNull();
    expect(screen.getByRole("button", { name: "Gỡ website Web c khỏi campaign" })).toBeTruthy();
    expect(screen.getByText("Đang tắt")).toBeTruthy();
  });

  it("ĐÃ KẾT THÚC: không form, không nút Gỡ", () => {
    dung({ trangThai: "ENDED" });
    expect(screen.queryByRole("form", { name: "Gắn website vào campaign" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Gỡ website/ })).toBeNull();
  });

  it("ô gắn: website đã gắn KHÔNG có trong danh sách; website tắt có mặt nhưng `disabled` kèm «đang tắt»; không chọn mà bấm ⇒ nhắc, không gọi", async () => {
    const { gan } = dung();
    const o = screen.getByLabelText("Gắn thêm website") as HTMLSelectElement;
    expect([...o.options].map((x) => x.textContent)).toEqual(["— Chọn website —", "Web b", "Web c (đang tắt — bật lại ở tab Website)"]);
    expect(o.options[2]!.disabled).toBe(true);
    expect(o.options[1]!.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Gắn website" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Chọn website muốn gắn.");
    expect(gan).not.toHaveBeenCalled();
  });

  it("gắn: gọi ĐÚNG (campaignId, siteId) rồi toast + làm mới; lỗi máy chủ hiện cạnh ô", async () => {
    const { gan } = dung();
    fireEvent.change(screen.getByLabelText("Gắn thêm website"), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Gắn website" }));
    await waitFor(() => expect(gan).toHaveBeenCalledWith({ campaignId: "c1", siteId: "b" }));
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
    cleanup();
    const gan2 = vi.fn(async () => ({ ok: false as const, loi: "Website đang tắt — bật lại ở tab Website.", truong: "siteId" }));
    render(<KhoiWebsite campaignId="c1" trangThai="DRAFT" daGan={[]} tatCa={[W("b")]} coTheGhi gan={gan2} />);
    fireEvent.change(screen.getByLabelText("Gắn thêm website"), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Gắn website" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/đang tắt/);
  });

  it("gỡ: hộp thoại xác nhận → gọi ĐÚNG (campaignId, siteId, lý do null)", async () => {
    const { go } = dung({ daGan: [W("a"), W("b")] });
    fireEvent.click(screen.getByRole("button", { name: "Gỡ website Web a khỏi campaign" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Gỡ website" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith({ campaignId: "c1", siteId: "a", lyDo: null }));
  });

  it("chưa gắn website nào ⇒ nói campaign cần ít nhất một website bật mới kích hoạt được", () => {
    dung({ daGan: [] });
    expect(screen.getByText(/ít nhất một website đang bật/)).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe("[AFU-04] NutMembership", () => {
  const dong = (status: TrangThaiMembership, p: Partial<DongMembershipView> = {}): DongMembershipView => ({
    id: "m1",
    doiTac: { id: "p1", code: "DT_A", ten: "Đối tác A", kind: "PERSON", loai: "Trường học", status: "ACTIVE" },
    status,
    groupLabel: "Nhóm A",
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    effectiveTo: null,
    approvedAt: null,
    capNhatLuc: MOC,
    ...p,
  });
  const dung = (d: DongMembershipView, campaignStatus: TrangThaiCampaign = "ACTIVE") => {
    const doi = vi.fn(async () => ({ ok: true as const, tu: d.status, den: "ACTIVE" as const, updatedAt: MOC }));
    const sua = vi.fn(async () => ({ ok: true as const, doi: true, updatedAt: MOC }));
    const r = render(<NutMembership dong={d} campaignStatus={campaignStatus} doi={doi} sua={sua} />);
    return { doi, sua, ...r };
  };
  const nut = (n: string) => screen.queryByRole("button", { name: new RegExp(`^${n}:`) });

  it("nút theo bảng chuyển: PENDING {Duyệt, Từ chối} · ACTIVE {Tạm ngừng, Kết thúc} · SUSPENDED {Cho tham gia lại, Kết thúc}; luôn có «Sửa"+"»", () => {
    for (const [status, co, khong] of [
      ["PENDING", ["Duyệt", "Từ chối"], ["Tạm ngừng", "Kết thúc", "Cho tham gia lại"]],
      ["ACTIVE", ["Tạm ngừng", "Kết thúc"], ["Duyệt", "Từ chối", "Cho tham gia lại"]],
      ["SUSPENDED", ["Cho tham gia lại", "Kết thúc"], ["Duyệt", "Tạm ngừng"]],
    ] as const) {
      const { unmount } = dung(dong(status));
      for (const n of co) expect(nut(n), `${status}: ${n}`).toBeTruthy();
      for (const n of khong) expect(nut(n), `${status}: không ${n}`).toBeNull();
      expect(screen.getByRole("button", { name: /^Sửa thành viên/ })).toBeTruthy();
      unmount();
    }
  });

  it("dòng ĐÃ KẾT THÚC: không nút nào, nói muốn quay lại thì thêm lại đối tác", () => {
    const { container } = dung(dong("ENDED"));
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).toMatch(/thêm lại đối tác/);
  });

  it("DUYỆT bị chặn thì KHÔNG có nút, có câu lý do: campaign đã kết thúc; đối tác không còn hoạt động. Đối chứng dương: campaign đang chạy + đối tác hoạt động ⇒ có nút Duyệt", () => {
    dung(dong("PENDING"), "ENDED");
    expect(nut("Duyệt")).toBeNull();
    expect(screen.getByText(/Campaign đã kết thúc — không duyệt thêm thành viên/)).toBeTruthy();
    expect(nut("Từ chối"), "rút lui vẫn được").toBeTruthy();
    cleanup();
    dung(dong("SUSPENDED", { doiTac: { id: "p1", code: "DT_A", ten: "Đối tác A", kind: "PERSON", loai: null, status: "SUSPENDED" } }));
    expect(nut("Cho tham gia lại")).toBeNull();
    expect(screen.getByText(/không còn hoạt động/)).toBeTruthy();
    cleanup();
    dung(dong("PENDING"), "ACTIVE");
    expect(nut("Duyệt")).toBeTruthy();
  });

  it("Duyệt: không đòi lý do, gọi ĐÚNG (id, mốc khoá lạc quan, đích ACTIVE, lý do null)", async () => {
    const { doi } = dung(dong("PENDING"));
    fireEvent.click(nut("Duyệt")!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Duyệt" }));
    await waitFor(() => expect(doi).toHaveBeenCalledWith({ id: "m1", updatedAtDaThay: MOC, den: "ACTIVE", lyDo: null }));
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
  });

  it("Tạm ngừng: lý do BẮT BUỘC (ngắn ⇒ lỗi, không gọi); đủ ⇒ gọi với đích SUSPENDED", async () => {
    const { doi } = dung(dong("ACTIVE"));
    fireEvent.click(nut("Tạm ngừng")!);
    const hop = await screen.findByRole("dialog");
    fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: "ngắn" } });
    fireEvent.click(within(hop).getByRole("button", { name: "Tạm ngừng" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/10 ký tự/);
    expect(doi).not.toHaveBeenCalled();
    fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(within(hop).getByRole("button", { name: "Tạm ngừng" }));
    await waitFor(() => expect(doi).toHaveBeenCalledWith({ id: "m1", updatedAtDaThay: MOC, den: "SUSPENDED", lyDo: LY_DO }));
  });

  it("Sửa: chưa đổi gì ⇒ Lưu khoá; đổi nhãn ⇒ gọi chỉ với `groupLabel`; ngày bắt đầu chỉ sửa được khi còn PENDING", async () => {
    const { sua } = dung(dong("ACTIVE"));
    fireEvent.click(screen.getByRole("button", { name: /^Sửa thành viên/ }));
    const hop = await screen.findByRole("dialog");
    const luu = within(hop).getByRole("button", { name: "Lưu" }) as HTMLButtonElement;
    expect(luu.disabled).toBe(true);
    expect((within(hop).getByLabelText("Hiệu lực từ ngày") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(hop).getByLabelText("Nhãn nhóm"), { target: { value: "Nhóm B" } });
    expect(luu.disabled).toBe(false);
    fireEvent.click(luu);
    await waitFor(() => expect(sua).toHaveBeenCalledWith({ id: "m1", updatedAtDaThay: MOC, vao: { groupLabel: "Nhóm B" }, lyDo: null }));
    cleanup();
    dung(dong("PENDING"));
    fireEvent.click(screen.getByRole("button", { name: /^Sửa thành viên/ }));
    expect((within(await screen.findByRole("dialog")).getByLabelText("Hiệu lực từ ngày") as HTMLInputElement).disabled).toBe(false);
  });

  it("Sửa hạn trên dòng ĐANG THAM GIA đòi lý do; hạn không sau ngày bắt đầu ⇒ lỗi cạnh ô, không gọi", async () => {
    const { sua } = dung(dong("ACTIVE"));
    fireEvent.click(screen.getByRole("button", { name: /^Sửa thành viên/ }));
    const hop = await screen.findByRole("dialog");
    fireEvent.change(within(hop).getByLabelText("Hết hiệu lực vào ngày"), { target: { value: "2027-01-01" } });
    expect(within(hop).getByLabelText(/Lý do/)).toBeTruthy();
    fireEvent.click(within(hop).getByRole("button", { name: "Lưu" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/lý do/i);
    expect(sua).not.toHaveBeenCalled();
    fireEvent.change(within(hop).getByLabelText("Hết hiệu lực vào ngày"), { target: { value: "2026-09-01" } });
    fireEvent.click(within(hop).getByRole("button", { name: "Lưu" }));
    expect((await within(hop).findAllByRole("alert")).map((a) => a.textContent).join(" ")).toMatch(/SAU ngày bắt đầu/);
    expect(sua).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe("[AFU-05] ThemMembership", () => {
  const D = (id: string, trongCampaign: DoiTacChonView["trongCampaign"] = null): DoiTacChonView => ({ id, code: `DT_${id.toUpperCase()}`, ten: `Đối tác ${id}`, kind: "PERSON", loai: "Trường học", trongCampaign });
  const dung = (doiTac: DoiTacChonView[], them = vi.fn(async (): Promise<KetQuaThemMembership> => ({ ok: true, id: "m1", viec: "TAO" }))) => {
    render(<ThemMembership campaignId="c1" doiTac={doiTac} conNua={false} them={them} />);
    return { them };
  };

  it("đối tác ĐÃ Ở TRONG campaign không chọn được (disabled, kèm trạng thái); đối tác ENDED chọn được và nói «sẽ mở lại dòng cũ»; đối tác mới chọn được", () => {
    dung([D("a"), D("b", "ACTIVE"), D("c", "PENDING"), D("d", "SUSPENDED"), D("e", "ENDED")]);
    const o = screen.getByLabelText("Đối tác") as HTMLSelectElement;
    const theo = (t: string) => [...o.options].find((x) => x.textContent?.includes(t))!;
    expect(theo("Đối tác a").disabled).toBe(false);
    expect(theo("Đối tác b").disabled).toBe(true);
    expect(theo("Đối tác b").textContent).toMatch(/đang tham gia/);
    expect(theo("Đối tác c").disabled).toBe(true);
    expect(theo("Đối tác d").disabled).toBe(true);
    expect(theo("Đối tác e").disabled).toBe(false);
    expect(theo("Đối tác e").textContent).toMatch(/sẽ mở lại dòng cũ/);
  });

  it("không chọn đối tác ⇒ lỗi cạnh ô, KHÔNG gọi; ô chọn chỉ chứa tên · mã · loại (không SĐT / email)", async () => {
    const { them } = dung([D("a")]);
    fireEvent.click(screen.getByRole("button", { name: "Thêm đối tác" }));
    const loi = await screen.findByRole("alert");
    expect(loi.textContent).toBe("Chọn đối tác.");
    expect(screen.getByLabelText("Đối tác").getAttribute("aria-invalid")).toBe("true");
    expect(them).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/@|\b0\d{9}\b/);
  });

  it("đủ ⇒ gọi ĐÚNG (campaignId, partyId, nhãn, ngày VN→ISO) rồi toast «chờ duyệt», làm mới, xoá ô", async () => {
    const { them } = dung([D("a")]);
    fireEvent.change(screen.getByLabelText("Đối tác"), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText("Nhãn nhóm (tuỳ chọn)"), { target: { value: "Nhóm A" } });
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm đối tác" }));
    await waitFor(() => expect(them).toHaveBeenCalledWith({ campaignId: "c1", vao: { partyId: "a", groupLabel: "Nhóm A", effectiveFrom: "2026-10-19T17:00:00.000Z", effectiveTo: null } }));
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
    expect(String(TOAST.success.mock.calls[0]?.[0])).toMatch(/chờ duyệt/);
    expect((screen.getByLabelText("Đối tác") as HTMLSelectElement).value).toBe("");
  });

  it("kết thúc không sau bắt đầu ⇒ lỗi cạnh ô ngày, không gọi; mở lại dòng cũ ⇒ toast nói «mở lại»", async () => {
    const { them } = dung([D("a")]);
    fireEvent.change(screen.getByLabelText("Đối tác"), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("Đến ngày"), { target: { value: "2026-10-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm đối tác" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/SAU ngày bắt đầu/);
    expect(them).not.toHaveBeenCalled();
    cleanup();
    const mo = vi.fn(async (): Promise<KetQuaThemMembership> => ({ ok: true, id: "m9", viec: "MO_LAI" }));
    dung([D("e", "ENDED")], mo);
    fireEvent.change(screen.getByLabelText("Đối tác"), { target: { value: "e" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm đối tác" }));
    await waitFor(() => expect(mo).toHaveBeenCalled());
    expect(String(TOAST.success.mock.calls.at(-1)?.[0])).toMatch(/Đã mở lại/);
  });

  it("lỗi máy chủ «đã ở trong campaign» hiện ở ô đối tác; chưa có đối tác hoạt động nào ⇒ ô và nút khoá, nói thẳng", async () => {
    const them = vi.fn(async () => ({ ok: false as const, loi: "Đối tác này đã ở trong campaign.", truong: "partyId" }));
    dung([D("a")], them as never);
    fireEvent.change(screen.getByLabelText("Đối tác"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm đối tác" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/đã ở trong campaign/);
    cleanup();
    dung([]);
    expect((screen.getByLabelText("Đối tác") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Thêm đối tác" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("— Chưa có đối tác nào đang hoạt động —")).toBeTruthy();
  });
});
