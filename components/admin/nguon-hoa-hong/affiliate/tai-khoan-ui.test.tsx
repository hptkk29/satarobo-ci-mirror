// @vitest-environment jsdom
/**
 * [ATU-*] — KHỐI «TÀI KHOẢN TRUY CẬP CỔNG» · GHI DANH CAMPAIGN · CHECKLIST ONBOARDING trên PHẦN TỬ THẬT (jsdom); hàm gọi máy chủ được TIÊM.
 *
 *   [ATU-01] nút GHI chỉ khi `coTheGhi` (đối chứng dương cùng ca); đối tác ĐÃ KẾT THÚC không có nút «Liên kết»; thao tác bị chặn hiện CÂU LÝ DO
 *   [ATU-02] mỗi dòng nói THẬT tài khoản có vào được cổng không (chưa liên kết học viên ⇒ nói rõ; tạm ngừng ⇒ kèm lý do)
 *   [ATU-03] hộp thoại LIÊN KẾT: tìm tối thiểu 3 ký tự; kết quả đã che; vai mặc định theo việc đã có người đại diện hay chưa; gọi ĐÚNG tham số; lỗi máy chủ hiện trong hộp thoại
 *   [ATU-04] GỠ · TẠM NGỪNG đòi lý do ≥ 10 ký tự (chặn ở trình duyệt, máy chủ vẫn quyết); MỞ LẠI · ĐẶT ĐẠI DIỆN không đòi; gửi ĐÚNG mốc khoá lạc quan; «vừa đổi» ⇒ Tải lại
 *   [ATU-05] GHI DANH: nút chỉ khi `affiliate_memberships:manage`; chặn kèm lý do của cổng; lỗi máy chủ hiện cạnh campaign; xem trước nguồn thiếu cấu hình hiện «Cần xem tay» + lý do
 *   [ATU-06] CHECKLIST: nhãn trạng thái bước; lý do chưa sẵn sàng là câu của cổng; chương trình sẵn sàng liệt kê website
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương "ca kia THẤY X" (CLAUDE.md luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/affiliate/[id]/_actions", () => ({
  lienKetUserAction: vi.fn(),
  goLienKetAction: vi.fn(),
  tamNgungCongAction: vi.fn(),
  moLaiCongAction: vi.fn(),
  doiDaiDienAction: vi.fn(),
  timUserAction: vi.fn(),
}));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions", () => ({
  themMembershipAction: vi.fn(),
  doiTrangThaiMembershipAction: vi.fn(),
  suaMembershipAction: vi.fn(),
}));

import type { UngVienGhiDanh } from "@/lib/affiliate/doc-ho-so-doi-tac";
import type { DongTruyCap, UserUngVien } from "@/lib/affiliate/tai-khoan-truy-cap";
import { thaoTacKhaDung } from "@/lib/affiliate/tai-khoan-truy-cap-dau-vao";
import { cacBuocOnboarding, type KetQuaSanSangPhatLink } from "@/lib/affiliate/onboarding-doi-tac";
import { GhiDanhCampaign } from "./ghi-danh-campaign";
import { KhoiOnboarding } from "./khoi-onboarding";
import { KhoiTaiKhoanTruyCap, type HanhDongTruyCap } from "./khoi-tai-khoan-truy-cap";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOC = "2026-10-13T02:00:00.123Z";
const LY_DO = "Lý do đủ dài để qua cổng";
const OK = { ok: true } as const;

function dongTK(p: Partial<DongTruyCap> & { doiTacKetThuc?: boolean } = {}): DongTruyCap {
  const { doiTacKetThuc = false, ...rest } = p;
  const base: DongTruyCap = {
    id: "tk-1",
    userId: "u-1",
    ten: "Chị Lan",
    email: "la*@example.com",
    dienThoai: "090xxxx456",
    vai: "MEMBER",
    trangThai: "ACTIVE",
    lyDo: null,
    lienKetLuc: MOC,
    soHocVien: 1,
    vaoDuocCong: true,
    lyDoKhongVao: null,
    capNhatLuc: MOC,
    thaoTac: [],
    ...rest,
  };
  return { ...base, thaoTac: rest.thaoTac ?? thaoTacKhaDung({ role: base.vai, status: base.trangThai, doiTacKetThuc }) };
}

function hanhDong(p: Partial<HanhDongTruyCap> = {}): HanhDongTruyCap {
  return {
    tim: vi.fn(async () => ({ ok: true as const, ketQua: [] })),
    lienKet: vi.fn(async () => ({ ok: true as const, id: "tk-moi" })),
    go: vi.fn(async () => OK),
    tamNgung: vi.fn(async () => OK),
    moLai: vi.fn(async () => OK),
    doiDaiDien: vi.fn(async () => OK),
    ...p,
  };
}

const UNG_VIEN: UserUngVien[] = [
  { userId: "u-9", ten: "Anh Bảo", email: "ba*@example.com", dienThoai: "091xxxx999", soHocVien: 2, vaoDuocCong: true, lyDoKhongVao: null },
  { userId: "u-8", ten: "Chị Cúc", email: null, dienThoai: "092xxxx888", soHocVien: 0, vaoDuocCong: false, lyDoKhongVao: "Chưa liên kết học viên nào — liên kết xong vẫn chưa vào được cổng phụ huynh." },
];

describe("[ATU-01] nút GHI chỉ khi coTheGhi; đối tác đã kết thúc; thao tác bị chặn", () => {
  it("coTheGhi=true thấy «Liên kết tài khoản» và nút từng dòng; coTheGhi=false KHÔNG thấy nút nào nhưng vẫn thấy danh sách", () => {
    const { unmount } = render(<KhoiTaiKhoanTruyCap partyId="p-1" doiTacKetThuc={false} dong={[dongTK()]} coTheGhi hanhDong={hanhDong()} />);
    expect(screen.getByRole("button", { name: "Liên kết tài khoản" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tạm ngừng cổng: Chị Lan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gỡ liên kết: Chị Lan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Đặt làm người đại diện: Chị Lan" })).toBeTruthy();
    unmount();

    render(<KhoiTaiKhoanTruyCap partyId="p-1" doiTacKetThuc={false} dong={[dongTK()]} coTheGhi={false} hanhDong={hanhDong()} />);
    expect(screen.getByText("Chị Lan")).toBeTruthy(); // vẫn thấy danh sách
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("đối tác ĐÃ KẾT THÚC: không có nút «Liên kết»; «Tạm ngừng» bị chặn bằng CÂU LÝ DO, vẫn gỡ được", () => {
    render(<KhoiTaiKhoanTruyCap partyId="p-1" doiTacKetThuc dong={[dongTK({ doiTacKetThuc: true })]} coTheGhi hanhDong={hanhDong()} />);
    expect(screen.queryByRole("button", { name: "Liên kết tài khoản" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tạm ngừng cổng: Chị Lan" })).toBeNull();
    expect(screen.getByText(/Tạm ngừng cổng: Đối tác đã kết thúc\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gỡ liên kết: Chị Lan" })).toBeTruthy(); // đối chứng dương
  });

  it("người đại diện không có nút «Đặt làm người đại diện»; dòng ĐÃ GỠ không hiện trong danh sách chính mà nằm ở dòng «Đã gỡ trước đây»", () => {
    render(
      <KhoiTaiKhoanTruyCap
        partyId="p-1"
        doiTacKetThuc={false}
        dong={[dongTK({ id: "a", ten: "Đại diện", vai: "REPRESENTATIVE" }), dongTK({ id: "b", userId: "u-2", ten: "Đã gỡ", trangThai: "REVOKED", thaoTac: [], vaoDuocCong: false, lyDoKhongVao: "Đã gỡ liên kết." })]}
        coTheGhi
        hanhDong={hanhDong()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Đặt làm người đại diện: Đại diện" })).toBeNull();
    expect(screen.getByRole("button", { name: "Gỡ liên kết: Đại diện" })).toBeTruthy(); // đối chứng dương
    expect(within(screen.getByRole("list", { name: "Tài khoản truy cập cổng" })).queryByText("Đã gỡ")).toBeNull();
    expect(document.querySelector("[data-da-go]")!.textContent).toContain("Đã gỡ");
  });

  it("chưa có tài khoản nào: nói thẳng đối tác chưa xem được gì ở cổng, và chỉ người có quyền mới thấy lời mời liên kết", () => {
    const { unmount } = render(<KhoiTaiKhoanTruyCap partyId="p-1" doiTacKetThuc={false} dong={[]} coTheGhi hanhDong={hanhDong()} />);
    expect(document.querySelector("[data-rong='tai-khoan']")!.textContent).toContain("Bấm «Liên kết tài khoản»");
    unmount();
    render(<KhoiTaiKhoanTruyCap partyId="p-1" doiTacKetThuc={false} dong={[]} coTheGhi={false} hanhDong={hanhDong()} />);
    expect(document.querySelector("[data-rong='tai-khoan']")!.textContent).not.toContain("Bấm «Liên kết tài khoản»");
  });
});

describe("[ATU-02] mỗi dòng nói THẬT tài khoản có vào được cổng không", () => {
  it("vào được ⇒ nêu số học viên; chưa liên kết học viên ⇒ nói rõ vì sao chưa vào được; tạm ngừng ⇒ kèm lý do", () => {
    render(
      <KhoiTaiKhoanTruyCap
        partyId="p-1"
        doiTacKetThuc={false}
        dong={[
          dongTK({ id: "a", ten: "Có con", soHocVien: 2 }),
          dongTK({ id: "b", userId: "u-2", ten: "Chưa có con", soHocVien: 0, vaoDuocCong: false, lyDoKhongVao: "Chưa liên kết học viên nào — cổng phụ huynh chưa mở cho tài khoản này." }),
          dongTK({ id: "c", userId: "u-3", ten: "Bị ngừng", trangThai: "SUSPENDED", lyDo: "Đối tác tạm ngưng hợp tác", vaoDuocCong: false, lyDoKhongVao: "Cổng đang tạm ngừng." }),
        ]}
        coTheGhi={false}
        hanhDong={hanhDong()}
      />,
    );
    const the = (id: string) => document.querySelector(`[data-tai-khoan='${id}']`) as HTMLElement;
    expect(within(the("a")).getByText(/Vào được cổng · 2 học viên liên kết/)).toBeTruthy();
    expect(the("a").querySelector("[data-cong='mo']")).not.toBeNull();
    expect(the("b").querySelector("[data-cong='dong']")!.textContent).toContain("Chưa liên kết học viên nào");
    expect(the("b").textContent).not.toContain("Vào được cổng");
    expect(the("c").querySelector("[data-cong='dong']")!.textContent).toBe("Cổng đang tạm ngừng.");
    expect(the("c").textContent).toContain("Lý do tạm ngừng: Đối tác tạm ngưng hợp tác");
  });

  it("email / SĐT hiển thị đúng như tầng đọc đưa xuống (đã che) — khối không tự dựng lại bản thật", () => {
    render(<KhoiTaiKhoanTruyCap partyId="p-1" doiTacKetThuc={false} dong={[dongTK()]} coTheGhi={false} hanhDong={hanhDong()} />);
    expect(screen.getByText(/la\*@example\.com · 090xxxx456/)).toBeTruthy();
  });
});

describe("[ATU-03] hộp thoại LIÊN KẾT", () => {
  async function moHop(h: HanhDongTruyCap, dong: DongTruyCap[] = []) {
    render(<KhoiTaiKhoanTruyCap partyId="p-1" doiTacKetThuc={false} dong={dong} coTheGhi hanhDong={h} />);
    fireEvent.click(screen.getByRole("button", { name: "Liên kết tài khoản" }));
    return screen.findByRole("dialog");
  }
  const go = (hop: HTMLElement, q: string) => {
    fireEvent.change(within(hop).getByLabelText(/Tìm tài khoản [(]tên/), { target: { value: q } });
    fireEvent.submit(within(hop).getByRole("search"));
  };

  it("gõ dưới 3 ký tự ⇒ báo lỗi và KHÔNG gọi máy chủ; từ 3 ký tự ⇒ gọi ĐÚNG {partyId, q}", async () => {
    const h = hanhDong({ tim: vi.fn(async () => ({ ok: true as const, ketQua: UNG_VIEN })) });
    const hop = await moHop(h);
    go(hop, "an");
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/ít nhất 3 ký tự/);
    expect(h.tim).not.toHaveBeenCalled();
    go(hop, "  bao ");
    await waitFor(() => expect(h.tim).toHaveBeenCalledWith({ partyId: "p-1", q: "  bao " }));
    expect(await within(hop).findByText("Anh Bảo")).toBeTruthy();
  });

  it("kết quả hiện liên hệ ĐÃ CHE và nói THẬT tài khoản chưa có học viên thì chưa vào được cổng", async () => {
    const h = hanhDong({ tim: vi.fn(async () => ({ ok: true as const, ketQua: UNG_VIEN })) });
    const hop = await moHop(h);
    go(hop, "abc");
    expect(await within(hop).findByText(/ba\*@example\.com · 091xxxx999/)).toBeTruthy();
    expect(within(hop).getByText(/Chưa liên kết học viên nào — liên kết xong vẫn chưa vào được cổng phụ huynh/)).toBeTruthy();
    // đối chứng dương: ứng viên có học viên KHÔNG kèm cảnh báo đó
    const bao = document.querySelector("[data-ung-vien='u-9']") as HTMLElement;
    expect(bao.textContent).not.toContain("Chưa liên kết học viên");
  });

  it("không có kết quả ⇒ câu giải thích (không im lặng)", async () => {
    const hop = await moHop(hanhDong());
    go(hop, "zzz");
    expect(await within(hop).findByText(/Không có tài khoản phụ huynh nào khớp/)).toBeTruthy();
  });

  it("vai mặc định: chưa có người đại diện ⇒ «Người đại diện»; đã có ⇒ «Thành viên» và lựa chọn đại diện bị KHOÁ kèm chỉ dẫn", async () => {
    let hop = await moHop(hanhDong());
    expect((within(hop).getByLabelText("Vai của tài khoản") as HTMLSelectElement).value).toBe("REPRESENTATIVE");
    cleanup();
    hop = await moHop(hanhDong(), [dongTK({ vai: "REPRESENTATIVE" })]);
    const chon = within(hop).getByLabelText("Vai của tài khoản") as HTMLSelectElement;
    expect(chon.value).toBe("MEMBER");
    expect((within(hop).getByRole("option", { name: /Người đại diện/ }) as HTMLOptionElement).disabled).toBe(true);
  });

  it("bấm «Liên kết» gọi ĐÚNG {partyId, userId, vai}; thành công ⇒ toast + làm mới trang", async () => {
    const h = hanhDong({ tim: vi.fn(async () => ({ ok: true as const, ketQua: UNG_VIEN })) });
    const hop = await moHop(h);
    fireEvent.change(within(hop).getByLabelText("Vai của tài khoản"), { target: { value: "MEMBER" } });
    go(hop, "bao");
    fireEvent.click(await within(hop).findByRole("button", { name: "Liên kết Anh Bảo" }));
    await waitFor(() => expect(h.lienKet).toHaveBeenCalledWith({ partyId: "p-1", userId: "u-9", vai: "MEMBER" }));
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
    expect(TOAST.success).toHaveBeenCalled();
  });

  it("lỗi máy chủ hiện TRONG hộp thoại, hộp thoại không đóng, không làm mới trang", async () => {
    const h = hanhDong({
      tim: vi.fn(async () => ({ ok: true as const, ketQua: UNG_VIEN })),
      lienKet: vi.fn(async () => ({ ok: false as const, loi: "Đối tác đã kết thúc — không liên kết thêm tài khoản.", truong: "partyId" })),
    });
    const hop = await moHop(h);
    go(hop, "bao");
    fireEvent.click(await within(hop).findByRole("button", { name: "Liên kết Anh Bảo" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/đã kết thúc/);
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});

describe("[ATU-04] gỡ · tạm ngừng · mở lại · đặt đại diện", () => {
  const dong = (p: Partial<DongTruyCap> = {}) => dongTK({ id: "tk-7", ...p });
  const dung = (h: HanhDongTruyCap, d: DongTruyCap) => render(<KhoiTaiKhoanTruyCap partyId="p-1" doiTacKetThuc={false} dong={[d]} coTheGhi hanhDong={h} />);

  it("GỠ: lý do ngắn bị chặn ở trình duyệt (không gọi máy chủ); đủ lý do ⇒ gọi ĐÚNG {id, mốc khoá lạc quan, lý do đã trim}", async () => {
    const h = hanhDong();
    dung(h, dong());
    fireEvent.click(screen.getByRole("button", { name: "Gỡ liên kết: Chị Lan" }));
    const hop = await screen.findByRole("dialog");
    fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: "ngắn" } });
    fireEvent.click(within(hop).getByRole("button", { name: "Gỡ liên kết" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/10 ký tự/);
    expect(h.go).not.toHaveBeenCalled();
    fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: `  ${LY_DO}  ` } });
    fireEvent.click(within(hop).getByRole("button", { name: "Gỡ liên kết" }));
    await waitFor(() => expect(h.go).toHaveBeenCalledWith({ id: "tk-7", updatedAtDaThay: MOC, lyDo: LY_DO }));
    expect(h.tamNgung).not.toHaveBeenCalled(); // đúng hàm, không nhầm sang tạm ngừng
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
  });

  it("TẠM NGỪNG gọi hàm tạm ngừng (không phải gỡ) với cùng mốc + lý do", async () => {
    const h = hanhDong();
    dung(h, dong());
    fireEvent.click(screen.getByRole("button", { name: "Tạm ngừng cổng: Chị Lan" }));
    const hop = await screen.findByRole("dialog");
    fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(within(hop).getByRole("button", { name: "Tạm ngừng cổng" }));
    await waitFor(() => expect(h.tamNgung).toHaveBeenCalledWith({ id: "tk-7", updatedAtDaThay: MOC, lyDo: LY_DO }));
    expect(h.go).not.toHaveBeenCalled();
  });

  it("MỞ LẠI cổng không đòi lý do; ĐẶT ĐẠI DIỆN gửi {partyId, id, mốc}", async () => {
    const h = hanhDong();
    const { unmount } = dung(h, dong({ trangThai: "SUSPENDED", lyDo: LY_DO, vaoDuocCong: false, lyDoKhongVao: "Cổng đang tạm ngừng." }));
    fireEvent.click(screen.getByRole("button", { name: "Mở lại cổng: Chị Lan" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Mở lại cổng" }));
    await waitFor(() => expect(h.moLai).toHaveBeenCalledWith({ id: "tk-7", updatedAtDaThay: MOC, lyDo: null }));
    unmount();

    dung(h, dong());
    fireEvent.click(screen.getByRole("button", { name: "Đặt làm người đại diện: Chị Lan" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Đặt làm người đại diện" }));
    await waitFor(() => expect(h.doiDaiDien).toHaveBeenCalledWith({ partyId: "p-1", id: "tk-7", updatedAtDaThay: MOC }));
  });

  it("«vừa được người khác thay đổi» ⇒ banner + «Tải lại» (đóng hộp thoại và làm mới)", async () => {
    const h = hanhDong({ go: vi.fn(async () => ({ ok: false as const, loi: "Liên kết vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" })) });
    dung(h, dong());
    fireEvent.click(screen.getByRole("button", { name: "Gỡ liên kết: Chị Lan" }));
    const hop = await screen.findByRole("dialog");
    fireEvent.change(within(hop).getByLabelText(/Lý do/), { target: { value: LY_DO } });
    fireEvent.click(within(hop).getByRole("button", { name: "Gỡ liên kết" }));
    expect((await within(hop).findByRole("alert")).textContent).toMatch(/vừa được người khác/);
    fireEvent.click(within(hop).getByRole("button", { name: "Tải lại" }));
    expect(ROUTER.refresh).toHaveBeenCalled();
  });
});

describe("[ATU-05] GHI DANH campaign", () => {
  const UV = (p: Partial<UngVienGhiDanh> = {}): UngVienGhiDanh => ({
    campaignId: "c-1",
    ma: "TET_2027",
    ten: "Giới thiệu Tết",
    trangThai: "ACTIVE",
    nguon: { loai: "NGUON", nguon: { id: "n1", code: "GT", ten: "Giới thiệu", status: "ACTIVE" }, sourceGroupId: "n1", tu: "MAC_DINH_CAMPAIGN", canhBao: null },
    lyDoChan: null,
    ...p,
  });

  it("nút «Ghi danh» chỉ khi coTheGhi (affiliate_memberships:manage) VÀ cổng không chặn; có xem trước nguồn", () => {
    const { unmount } = render(<GhiDanhCampaign partyId="p-1" ungVien={[UV()]} conNua={false} coTheGhi them={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Ghi danh vào Giới thiệu Tết" })).toBeTruthy();
    expect(screen.getByText(/Nguồn mặc định của campaign/)).toBeTruthy();
    unmount();

    render(<GhiDanhCampaign partyId="p-1" ungVien={[UV()]} conNua={false} coTheGhi={false} them={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/affiliate_memberships:manage/)).toBeTruthy(); // nói THẬT vì sao không có nút
  });

  it("cổng chặn (đối tác chưa hoạt động) ⇒ KHÔNG nút, hiện câu của cổng; vẫn xem được nguồn", () => {
    render(<GhiDanhCampaign partyId="p-1" ungVien={[UV({ lyDoChan: "Chỉ đối tác đang hoạt động mới thêm vào campaign được." })]} conNua={false} coTheGhi them={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Ghi danh vào/ })).toBeNull();
    expect(document.querySelector("[data-chan]")!.textContent).toContain("Chỉ đối tác đang hoạt động");
  });

  it("thiếu cấu hình nguồn ⇒ «Cần xem tay» kèm LÝ DO (không «không rõ»); vẫn ghi danh được", () => {
    render(<GhiDanhCampaign partyId="p-1" ungVien={[UV({ nguon: { loai: "XEM_TAY", lyDo: "Chưa cấu hình nguồn cho loại/nhãn của đối tác này trong campaign." } })]} conNua={false} coTheGhi them={vi.fn()} />);
    expect(document.querySelector("[data-nguon='xem-tay']")!.textContent).toContain("Cần xem tay");
    expect(document.querySelector("[data-nguon='xem-tay']")!.textContent).toContain("Chưa cấu hình nguồn");
    expect(screen.getByRole("button", { name: "Ghi danh vào Giới thiệu Tết" })).toBeTruthy();
  });

  it("bấm «Ghi danh» gọi ĐÚNG {campaignId, vao:{partyId,…}}; thành công ⇒ toast nói «chờ duyệt» + làm mới; lỗi ⇒ hiện cạnh campaign", async () => {
    const them = vi.fn(async () => ({ ok: true as const, id: "m-1", viec: "TAO" as const }));
    const { unmount } = render(<GhiDanhCampaign partyId="p-1" ungVien={[UV()]} conNua={false} coTheGhi them={them} />);
    fireEvent.click(screen.getByRole("button", { name: "Ghi danh vào Giới thiệu Tết" }));
    await waitFor(() => expect(them).toHaveBeenCalledWith({ campaignId: "c-1", vao: { partyId: "p-1", groupLabel: "", effectiveFrom: null, effectiveTo: null } }));
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
    expect(String(TOAST.success.mock.calls[0]![0])).toContain("chờ duyệt");
    unmount();
    vi.clearAllMocks();

    const loi = vi.fn(async () => ({ ok: false as const, loi: "Campaign đã kết thúc — không nhận thành viên mới.", truong: "campaign" }));
    render(<GhiDanhCampaign partyId="p-1" ungVien={[UV()]} conNua={false} coTheGhi them={loi} />);
    fireEvent.click(screen.getByRole("button", { name: "Ghi danh vào Giới thiệu Tết" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/đã kết thúc/);
    expect(ROUTER.refresh).not.toHaveBeenCalled();
  });

  it("danh sách rỗng ⇒ câu giải thích", () => {
    render(<GhiDanhCampaign partyId="p-1" ungVien={[]} conNua={false} coTheGhi them={vi.fn()} />);
    expect(document.querySelector("[data-rong='ghi-danh']")).not.toBeNull();
  });
});

describe("[ATU-06] CHECKLIST onboarding", () => {
  const buoc = cacBuocOnboarding({
    doiTac: { status: "PENDING", coLoai: true },
    thanhVien: { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, ENDED: 0 },
    soChuongTrinhThieuNguon: 0,
    soTaiKhoanHoatDong: 0,
    sanSangPhatLink: false,
  });
  const sanSang: KetQuaSanSangPhatLink = {
    sanSang: true,
    theoChuongTrinh: [
      { membershipId: "m1", campaignMa: "TET", campaignTen: "Tết", sanSang: true, websiteDungDuoc: ["Web A", "Web B"], lyDo: [] },
      { membershipId: "m2", campaignMa: "HE", campaignTen: "Hè", sanSang: false, websiteDungDuoc: [], lyDo: ["Campaign không ở trạng thái đang chạy.", "Website đang tắt theo dõi giới thiệu."] },
    ],
  };

  it("mỗi bước mang trạng thái; ghi danh bị CHẶN khi đối tác chưa duyệt", () => {
    render(<KhoiOnboarding buoc={buoc} sanSang={{ sanSang: false, theoChuongTrinh: [] }} />);
    const b = (ma: string) => document.querySelector(`[data-buoc='${ma}']`) as HTMLElement;
    expect(b("HO_SO").getAttribute("data-trang-thai")).toBe("XONG"); // đối chứng dương
    expect(b("KICH_HOAT").getAttribute("data-trang-thai")).toBe("CHUA");
    expect(b("GHI_DANH").getAttribute("data-trang-thai")).toBe("CHAN");
    expect(b("GHI_DANH").textContent).toContain("đang hoạt động");
    expect(b("TAI_KHOAN").getAttribute("data-trang-thai")).toBe("TUY_CHON");
  });

  it("từng campaign: sẵn sàng ⇒ liệt kê website; chưa ⇒ MỌI lý do là câu của cổng", () => {
    render(<KhoiOnboarding buoc={buoc} sanSang={sanSang} />);
    const tet = document.querySelector("[data-san-sang='co']") as HTMLElement;
    expect(tet.textContent).toContain("Đủ điều kiện phát link");
    expect(tet.textContent).toContain("Web A, Web B");
    const he = document.querySelector("[data-san-sang='chua']") as HTMLElement;
    expect(he.textContent).toContain("Chưa đủ điều kiện");
    expect(he.textContent).toContain("Campaign không ở trạng thái đang chạy.");
    expect(he.textContent).toContain("Website đang tắt theo dõi giới thiệu.");
    expect(he.textContent).not.toContain("Web A");
  });
});
