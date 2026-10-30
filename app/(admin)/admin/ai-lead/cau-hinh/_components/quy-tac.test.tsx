// @vitest-environment jsdom
// [QTR-UI] Tab "Quy tắc" (Rule Builder): trạng thái rỗng · ràng buộc thu hẹp · SLA + thông báo/leo thang · lịch sử + khôi phục có xem trước. Mỗi ca tự dựng mọi thứ (luật 18).
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, hanhDong } = vi.hoisted(() => {
  const hanhDong: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const t of ["datRangBuocTuTaoAction", "khoiPhucBoQuyTacAction", "luuSlaThongBaoAction", "xemTruocKhoiPhucAction"]) hanhDong[t] = vi.fn(async () => ({ ok: true }));
  return { refresh: vi.fn(), hanhDong };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("../_actions", () => hanhDong);

import type { AgentView, BoQuyTacView } from "@/lib/ai-lead/dich-vu/cau-hinh";
import type { QuyTac } from "@/lib/ai-lead/dich-vu/bo-quy-tac-schema";
import { QuyTac as ManQuyTac } from "./quy-tac";

const AG = "cm0agentaaaaaaaaaaaaaaaa1";
const CS1 = "cm0coso1aaaaaaaaaaaaaaaaa";
const CS2 = "cm0coso2aaaaaaaaaaaaaaaaa";
const PG = "104500000000777";
const NOW = new Date("2026-11-09T03:00:00.000Z");
const LY_DO = "Điều chỉnh theo yêu cầu vận hành";

const agent = (): AgentView => ({
  id: AG, name: "AI Messenger", environment: "TEST", secretVersion: 1, active: true, contractStatus: "COMPATIBLE", lastHeartbeatAt: null, createdAt: NOW, moiTruongHopLe: true,
  pages: [{ pageId: PG, state: "ENABLED", routingCenterId: null, note: null, nguon: { san: true, groupCode: "MARKETING_HO" } }],
});
const COSO = [{ id: CS1, code: "CS1", name: "Cơ sở 1" }, { id: CS2, code: "CS2", name: "Cơ sở 2" }];
const view = (rules: QuyTac[] | null, lichSu: BoQuyTacView["lichSu"] = [], version = 3, phienBanHong: number | null = null): BoQuyTacView => ({
  phienBanHong,
  hienHanh: rules === null ? null : { version, rules, publishedAt: NOW, reason: "Thử nghiệm", savedFromVersion: null },
  lichSu,
});
const dung = (v: BoQuyTacView, duocSua = true) => render(<ManQuyTac view={v} agents={[agent()]} coSo={COSO} duocSua={duocSua} />);
const nhapLyDo = (v: string) => fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: v } });

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe("[QTR-UI-01b] phiên bản mới nhất HỎNG ⇒ báo thẳng, không giả vờ «chưa có phiên bản nào» như không có gì", () => {
  it("hiện cảnh báo role=alert nêu số phiên bản hỏng và hướng khôi phục; bình thường thì không có", () => {
    const a = dung(view(null, [], 3, 7));
    expect(screen.getByRole("alert").textContent).toMatch(/Phiên bản 7 của bộ quy tắc bị hỏng/);
    expect(screen.getByRole("alert").textContent).toMatch(/Khôi phục một phiên bản cũ/);
    a.unmount();
    dung(view([]));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("[QTR-UI-01] trạng thái rỗng nói đúng sự thật", () => {
  it("chưa có phiên bản ⇒ nói rõ đang dùng tham số ai.* và mặc định; không SLA/thông báo/ràng buộc; lịch sử rỗng", () => {
    dung(view(null));
    expect(screen.getByText("Chưa có phiên bản nào")).toBeInTheDocument();
    expect(screen.getAllByText(/tham số ai\.\*/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Chưa Page nào bật tự tạo lead/)).toBeInTheDocument();
    expect(screen.getByText(/Chưa có quy tắc SLA/)).toBeInTheDocument();
    expect(screen.getByText(/Chưa có quy tắc thông báo/)).toBeInTheDocument();
    expect(screen.getByText(/Chưa có phiên bản nào\./)).toBeInTheDocument();
  });
});

describe("[QTR-UI-08] UX Rule Builder: tóm tắt khác biệt trước khi lưu · xoá có HOÀN TÁC · thu gọn trên di động", () => {
  const sla: QuyTac = { kind: "SLA", scope: { type: "PAGE", pageId: PG }, claimMinutes: 20, resolveMinutes: 200 };
  const tb: QuyTac = { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: null, afterMinutes: 0, to: ["CENTER_MANAGER"] };

  it("chưa đổi gì ⇒ không có khối «Chưa lưu»; đổi một số ⇒ hiện «Chưa lưu: 1 thay đổi» (+0 thêm · ~1 sửa · −0 xoá) và mở ra thấy trước ⇒ sau", () => {
    dung(view([sla, tb]));
    expect(document.querySelector("[data-khac-biet]")).toBeNull();
    const s = screen.getByRole("group", { name: "Quy tắc SLA 1" });
    fireEvent.change(within(s).getByLabelText("Hạn nhận (phút)"), { target: { value: "15" } });
    const kb = document.querySelector('[data-khac-biet="ngoai-hop"]')!;
    expect(kb.textContent).toMatch(/Chưa lưu: 1 thay đổi/);
    expect(kb.textContent).toMatch(/\+0 thêm · ~1 sửa · −0 xoá/);
    expect(kb.textContent).toMatch(/nhận trong 20′, xử lý trong 200′ {2}⇒ {2}SLA Page .*nhận trong 15′, xử lý trong 200′/);
  });

  it("HỘP XÁC NHẬN LƯU liệt kê chính các thay đổi ấy (thêm · sửa · xoá) trước khi hỏi lý do", () => {
    dung(view([sla, tb]));
    fireEvent.click(screen.getByRole("button", { name: "+ Thêm quy tắc thông báo" })); // thêm
    fireEvent.click(screen.getByRole("button", { name: "Xoá quy tắc SLA 1" })); // xoá
    fireEvent.click(screen.getByRole("button", { name: "Lưu SLA và thông báo" }));
    const hop = document.querySelector('[data-khac-biet="trong-hop"]')!;
    expect(hop).not.toBeNull();
    expect(hop.textContent).toMatch(/\+ Thêm/);
    expect(hop.textContent).toMatch(/− Xoá.*SLA Page .*nhận trong 20′/);
    expect(screen.getByText("Tạo phiên bản mới của bộ quy tắc, áp dụng ngay cho hồ sơ MỚI và các lượt báo kế tiếp. Máy chủ kiểm lại cơ sở/Page còn hợp lệ.")).toBeInTheDocument();
  });

  it("XOÁ có HOÀN TÁC: dòng bị gỡ khỏi bản nháp, thanh trạng thái hiện; «Hoàn tác» trả ĐÚNG dòng về ĐÚNG vị trí với giá trị cũ và xoá khác biệt", () => {
    const sla2: QuyTac = { kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes: 45, resolveMinutes: 300 };
    dung(view([sla, sla2, tb]));
    fireEvent.click(screen.getByRole("button", { name: "Xoá quy tắc SLA 1" }));
    expect(screen.getAllByRole("group", { name: /Quy tắc SLA/ })).toHaveLength(1);
    const thanh = screen.getByRole("status");
    expect(thanh.getAttribute("data-hoan-tac")).toBe("1");
    expect(thanh.textContent).toMatch(/Đã gỡ 1 quy tắc khỏi bản nháp \(chưa lưu\)/);
    fireEvent.click(within(thanh).getByRole("button", { name: "Hoàn tác" }));
    const dong = screen.getAllByRole("group", { name: /Quy tắc SLA/ });
    expect(dong).toHaveLength(2);
    expect((within(dong[0]!).getByLabelText("Hạn nhận (phút)") as HTMLInputElement).value).toBe("20"); // dòng cũ trở lại ĐẦU danh sách
    expect((within(dong[1]!).getByLabelText("Hạn nhận (phút)") as HTMLInputElement).value).toBe("45");
    expect(document.querySelector("[data-hoan-tac]")).toBeNull(); // hết dòng đã gỡ ⇒ vùng thông báo vẫn có mặt nhưng RỖNG
    expect(screen.getByRole("status").textContent).toBe("");
    expect(document.querySelector("[data-khac-biet]")).toBeNull(); // trở về đúng bản đang áp dụng ⇒ không còn thay đổi
    expect(screen.getByRole("button", { name: "Lưu SLA và thông báo" })).toBeDisabled();
  });

  it("[QTR-UI-10] vùng thông báo hoàn tác LUÔN có mặt (aria-live) và DÍNH đáy khung nhìn; xoá ⇒ tiêu điểm chuyển tới «Hoàn tác»", () => {
    dung(view([sla, tb]));
    const vung = screen.getByRole("status");
    expect(vung.getAttribute("aria-live")).toBe("polite");
    expect(vung.className).toMatch(/\bsticky\b/);
    expect(vung.className).toMatch(/\bbottom-3\b/);
    expect(vung.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Xoá quy tắc SLA 1" }));
    expect(screen.getByRole("status")).toBe(vung); // cùng một phần tử, không gắn mới
    expect(document.activeElement).toBe(within(vung).getByRole("button", { name: "Hoàn tác" }));
  });

  it("[QTR-UI-11] bản nháp ĐÃ ĐẦY (xoá một dòng rồi thêm lại cho đủ 300) ⇒ «Hoàn tác» bị khoá kèm lý do, không khôi phục vượt trần", () => {
    const nhieu: QuyTac[] = Array.from({ length: 300 }, (_, i) => ({ kind: "SLA", scope: { type: "PAGE", pageId: `p${String(i).padStart(5, "0")}` }, claimMinutes: 30, resolveMinutes: 240 }));
    dung(view(nhieu));
    fireEvent.click(screen.getByRole("button", { name: "Xoá quy tắc SLA 1" })); // 299
    fireEvent.click(screen.getByRole("button", { name: "+ Thêm quy tắc SLA" })); // 300 — đầy lại
    const nut = within(screen.getByRole("status")).getByRole("button", { name: "Hoàn tác" });
    expect(nut).toBeDisabled();
    expect(screen.getByRole("status").textContent).toMatch(/đã ĐẦY — gỡ bớt một quy tắc rồi mới hoàn tác được/);
    fireEvent.click(nut);
    expect(screen.getByRole("status").getAttribute("data-hoan-tac")).toBe("1"); // chưa mất gì
    fireEvent.click(screen.getAllByRole("button", { name: /Xoá quy tắc SLA/ })[0]!); // gỡ bớt ⇒ còn 299
    expect(within(screen.getByRole("status")).getAllByRole("button", { name: "Hoàn tác" })[0]).toBeEnabled();
  });

  it("xoá nhiều dòng ⇒ hoàn tác từng dòng theo thứ tự NGƯỢC", () => {
    dung(view([sla, tb]));
    fireEvent.click(screen.getByRole("button", { name: "Xoá quy tắc SLA 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Xoá quy tắc thông báo 1" }));
    expect(screen.getByRole("status").getAttribute("data-hoan-tac")).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    expect(screen.getAllByRole("group", { name: /Quy tắc thông báo/ })).toHaveLength(1); // thông báo (xoá SAU) về trước
    expect(screen.queryAllByRole("group", { name: /Quy tắc SLA/ })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    expect(screen.getAllByRole("group", { name: /Quy tắc SLA/ })).toHaveLength(1);
  });

  it("chỉ-xem ⇒ không nút Xoá, không thanh hoàn tác, không khối khác biệt", () => {
    dung(view([sla, tb]), false);
    expect(screen.queryByRole("button", { name: /Xoá quy tắc/ })).toBeNull();
    expect(document.querySelector("[data-hoan-tac]")).toBeNull();
    expect(document.querySelector("[data-khac-biet]")).toBeNull();
  });

  it("THU GỌN cho di động: «Lịch sử phiên bản» ĐÓNG mặc định, hai khối SLA/thông báo MỞ; mỗi khối có số quy tắc ở tiêu đề để biết khi đã thu gọn", () => {
    dung(view([sla, tb], [{ version: 3, publishedAt: NOW, publishedById: "u", reason: "Thử nghiệm", savedFromVersion: null, soQuyTac: 2 }]));
    const mo = (k: string) => (document.querySelector(`details[data-khoi="${k}"]`) as HTMLDetailsElement).open;
    expect(mo("lich-su")).toBe(false);
    expect(mo("sla")).toBe(true);
    expect(mo("thong-bao")).toBe(true);
    expect(document.querySelector('details[data-khoi="sla"] summary')!.textContent).toMatch(/Hạn SLA.*1 quy tắc/);
    expect(document.querySelector('details[data-khoi="lich-su"] summary')!.textContent).toMatch(/Lịch sử phiên bản.*1 phiên bản gần nhất/);
  });
});

describe("[QTR-UI-09] trần SỐ QUY TẮC của một phiên bản: hiện mức dùng; đầy ⇒ khoá nút Thêm kèm lý do", () => {
  const dem = () => document.querySelector("[data-so-quy-tac]")!;
  it("ít quy tắc ⇒ «Đã dùng X/300», nút Thêm bật, không cảnh báo", () => {
    dung(view([{ kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes: 30, resolveMinutes: 240 }]));
    expect(dem().getAttribute("data-so-quy-tac")).toBe("1");
    expect(dem().textContent).toMatch(/Đã dùng 1\/300 quy tắc/);
    expect(dem().getAttribute("role")).toBeNull();
    expect(screen.getByRole("button", { name: "+ Thêm quy tắc SLA" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "+ Thêm quy tắc thông báo" })).toBeEnabled();
  });
  it("ĐẦY (300) ⇒ role=alert «Đã ĐẦY», cả hai nút Thêm bị khoá; xoá một dòng ⇒ mở lại", () => {
    const nhieu: QuyTac[] = Array.from({ length: 300 }, (_, i) => ({ kind: "SLA", scope: { type: "PAGE", pageId: `p${String(i).padStart(5, "0")}` }, claimMinutes: 30, resolveMinutes: 240 }));
    dung(view(nhieu));
    expect(dem().getAttribute("role")).toBe("alert");
    expect(dem().textContent).toMatch(/Đã dùng 300\/300.*ĐẦY/);
    expect(screen.getByRole("button", { name: "+ Thêm quy tắc SLA" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Thêm quy tắc thông báo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Xoá quy tắc SLA 1" }));
    expect(dem().getAttribute("data-so-quy-tac")).toBe("299");
    expect(screen.getByRole("button", { name: "+ Thêm quy tắc SLA" })).toBeEnabled();
    // Dựng 300 hàng thật: chạy một mình ~1 s nhưng quá 5 s mặc định khi cả bộ chạy song song (hook pre-commit, runner CI ít CPU).
  }, 30_000);
  it("quy tắc ROUTE/AUTO theo Page cũng được tính vào trần (không sửa ở màn này nhưng chiếm chỗ)", () => {
    const route: QuyTac = { kind: "ROUTE_PAGE_TO_CAMPUS", agentId: AG, pageId: PG, centerId: CS1 };
    dung(view([route]));
    expect(dem().getAttribute("data-so-quy-tac")).toBe("1");
  });
});

describe("[QTR-UI-02b] phạm vi cơ sở nói đúng hậu quả (không bắt người dùng nhớ «để trống = mọi cơ sở»)", () => {
  it("không chọn cơ sở ⇒ «KHÔNG giới hạn»; chọn N ⇒ «Chỉ N cơ sở…» và nêu hồ sơ ngoài danh sách chờ nhân viên; tiêu đề không còn ngoặc 'để trống'", async () => {
    const auto: QuyTac = { kind: "AUTO_CREATE", agentId: AG, pageId: PG, enabled: true };
    dung(view([auto]));
    const ghiChu = () => document.querySelector("[data-pham-vi-co-so]")!;
    expect(ghiChu().getAttribute("data-pham-vi-co-so")).toBe("khong-gioi-han");
    expect(ghiChu().textContent).toMatch(/KHÔNG giới hạn/);
    expect(document.body.textContent).not.toMatch(/để trống = mọi cơ sở/);
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Cơ sở 1/ })[0]!);
    expect(ghiChu().getAttribute("data-pham-vi-co-so")).toBe("gioi-han");
    expect(ghiChu().textContent).toMatch(/Chỉ 1 cơ sở.*chờ nhân viên duyệt/);
  });
});

describe("[QTR-UI-02] ràng buộc thu hẹp theo Page", () => {
  const auto: QuyTac = { kind: "AUTO_CREATE", agentId: AG, pageId: PG, enabled: true, requireConsent: true, campusCenterIds: [CS1] };
  it("hiện ràng buộc đang áp dụng; 'Lưu' khoá khi chưa đổi; đổi ⇒ mở hộp lý do ⇒ gửi ĐÚNG payload (agent, page, đồng ý, danh sách cơ sở, lý do đã cắt)", async () => {
    dung(view([auto]));
    const nhom = screen.getByRole("group", { name: `Ràng buộc tự tạo lead của Page ${PG}` });
    const dongY = within(nhom).getByLabelText(/đã đồng ý liên hệ/) as HTMLInputElement;
    expect(dongY.checked).toBe(true);
    expect((within(nhom).getByLabelText(/Cơ sở 1/) as HTMLInputElement).checked).toBe(true);
    expect((within(nhom).getByLabelText(/Cơ sở 2/) as HTMLInputElement).checked).toBe(false);
    expect(within(nhom).getByRole("button", { name: "Lưu ràng buộc" })).toBeDisabled();
    fireEvent.click(within(nhom).getByLabelText(/Cơ sở 2/));
    fireEvent.click(dongY);
    fireEvent.click(within(nhom).getByRole("button", { name: "Lưu ràng buộc" }));
    nhapLyDo(`  ${LY_DO}  `);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Lưu ràng buộc" }).at(-1)!);
    });
    expect(hanhDong.datRangBuocTuTaoAction).toHaveBeenCalledTimes(1);
    expect(hanhDong.datRangBuocTuTaoAction).toHaveBeenCalledWith({ baseVersion: 3, agentId: AG, pageId: PG, requireConsent: false, campusCenterIds: [CS1, CS2], lyDo: LY_DO });
  });
  it("không có quyền sửa ⇒ ô khoá, không nút lưu", () => {
    dung(view([auto]), false);
    const nhom = screen.getByRole("group", { name: `Ràng buộc tự tạo lead của Page ${PG}` });
    expect(within(nhom).queryByRole("button", { name: "Lưu ràng buộc" })).toBeNull();
    expect(within(nhom).getByLabelText(/đã đồng ý liên hệ/)).toBeDisabled();
  });
});

describe("[QTR-UI-03] SLA + thông báo/leo thang", () => {
  const sla: QuyTac = { kind: "SLA", scope: { type: "PAGE", pageId: PG }, claimMinutes: 20, resolveMinutes: 200 };
  const tb: QuyTac = { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: null, afterMinutes: 0, to: ["CENTER_MANAGER"] };
  it("hiện đúng quy tắc hiện hành; 'Lưu' khoá khi chưa đổi", () => {
    dung(view([sla, tb]));
    const s = screen.getByRole("group", { name: "Quy tắc SLA 1" });
    expect((within(s).getByLabelText("Hạn nhận (phút)") as HTMLInputElement).value).toBe("20");
    expect((within(s).getByLabelText("Hạn xử lý (phút)") as HTMLInputElement).value).toBe("200");
    const t = screen.getByRole("group", { name: "Quy tắc thông báo 1" });
    expect((within(t).getByLabelText(/Quản lý cơ sở/) as HTMLInputElement).checked).toBe(true);
    expect((within(t).getByLabelText(/Người cấu hình AI Lead/) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Lưu SLA và thông báo" })).toBeDisabled();
    expect(screen.getByText("Chưa có thay đổi để lưu.")).toBeInTheDocument();
  });
  it("hạn nhận > hạn xử lý ⇒ báo lỗi đúng dòng và KHOÁ nút lưu (không gửi lên máy chủ)", () => {
    dung(view([sla, tb]));
    const s = screen.getByRole("group", { name: "Quy tắc SLA 1" });
    fireEvent.change(within(s).getByLabelText("Hạn nhận (phút)"), { target: { value: "500" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/SLA dòng 1: hạn nhận không được lớn hơn hạn xử lý/);
    expect(screen.getByRole("button", { name: "Lưu SLA và thông báo" })).toBeDisabled();
  });
  it("thêm bậc LEO THANG ⇒ lưu gửi ĐỦ SLA + cả hai bậc thông báo (số phút là số, centerId null = mọi cơ sở) kèm lý do", async () => {
    dung(view([sla, tb]));
    fireEvent.click(screen.getByRole("button", { name: "+ Thêm quy tắc thông báo" }));
    const t2 = screen.getByRole("group", { name: "Quy tắc thông báo 2" });
    fireEvent.change(within(t2).getByLabelText("Báo sau (phút)"), { target: { value: "90" } });
    fireEvent.click(within(t2).getByLabelText(/Người duyệt hồ sơ AI ở Hội sở/)); // mặc định đã tick HO_REVIEWERS ⇒ bỏ
    fireEvent.click(within(t2).getByLabelText(/Người cấu hình AI Lead/));
    fireEvent.click(within(t2).getByLabelText(/Người duyệt hồ sơ AI ở Hội sở/));
    fireEvent.click(screen.getByRole("button", { name: "Lưu SLA và thông báo" }));
    nhapLyDo(LY_DO);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Lưu phiên bản mới" }).at(-1)!);
    });
    expect(hanhDong.luuSlaThongBaoAction).toHaveBeenCalledTimes(1);
    const arg = hanhDong.luuSlaThongBaoAction.mock.calls[0]![0] as { baseVersion: number; rules: unknown[]; lyDo: string };
    expect(arg.baseVersion, "gửi kèm phiên bản màn đang hiển thị (khoá lạc quan)").toBe(3);
    expect(arg.lyDo).toBe(LY_DO);
    expect(arg.rules).toEqual([
      { kind: "SLA", scope: { type: "PAGE", pageId: PG }, claimMinutes: 20, resolveMinutes: 200 },
      { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: null, afterMinutes: 0, to: ["CENTER_MANAGER"] },
      { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: null, afterMinutes: 90, to: ["HO_REVIEWERS", "HO_CONFIGURERS"] },
    ]);
  });
  it("dòng thông báo không chọn nhóm nào ⇒ báo lỗi, khoá lưu; xoá dòng ⇒ biến khỏi payload", () => {
    dung(view([sla, tb]));
    const t = screen.getByRole("group", { name: "Quy tắc thông báo 1" });
    fireEvent.click(within(t).getByLabelText(/Quản lý cơ sở/));
    expect(screen.getByRole("alert")).toHaveTextContent(/chọn ít nhất một nhóm người nhận/);
    expect(screen.getByRole("button", { name: "Lưu SLA và thông báo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Xoá quy tắc thông báo 1" }));
    expect(screen.queryByRole("group", { name: "Quy tắc thông báo 1" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("máy chủ từ chối ⇒ hộp lý do giữ nguyên và HIỆN lỗi (không đóng như thể đã lưu)", async () => {
    hanhDong.luuSlaThongBaoAction!.mockResolvedValueOnce({ ok: false, error: "SLA: Cơ sở đã ngừng hoạt động." });
    dung(view([sla, tb]));
    fireEvent.click(screen.getByRole("button", { name: "+ Thêm quy tắc SLA" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu SLA và thông báo" }));
    nhapLyDo(LY_DO);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Lưu phiên bản mới" }).at(-1)!);
    });
    expect(screen.getByText(/Cơ sở đã ngừng hoạt động/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
  it("chỉ-xem ⇒ không nút thêm/xoá/lưu, ô khoá, có câu nói rõ quyền cần", () => {
    dung(view([sla, tb]), false);
    expect(screen.queryByRole("button", { name: /Thêm quy tắc/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lưu SLA và thông báo" })).toBeNull();
    expect(within(screen.getByRole("group", { name: "Quy tắc SLA 1" })).getByLabelText("Hạn nhận (phút)")).toBeDisabled();
    expect(screen.getAllByText(/ai-leads:configure/).length).toBeGreaterThan(0);
  });
});

describe("[QTR-UI-04] lịch sử + khôi phục có xem trước", () => {
  const ls = [
    { version: 3, publishedAt: NOW, publishedById: "u", reason: "Thử nghiệm", savedFromVersion: null, soQuyTac: 2 },
    { version: 2, publishedAt: NOW, publishedById: "u", reason: "Bật tự tạo", savedFromVersion: null, soQuyTac: 1 },
    { version: 1, publishedAt: NOW, publishedById: "u", reason: "Khởi tạo", savedFromVersion: null, soQuyTac: 0 },
  ];
  it("phiên bản đang áp dụng có nhãn và KHÔNG có nút khôi phục; các bản cũ có nút", () => {
    dung(view([], ls));
    expect(screen.getByText("Đang áp dụng")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Khôi phục phiên bản 3" })).toBeNull();
    expect(screen.getByRole("button", { name: "Khôi phục phiên bản 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Khôi phục phiên bản 1" })).toBeInTheDocument();
  });
  it("mở hộp ⇒ gọi XEM TRƯỚC (không ghi), liệt kê thay đổi; xác nhận khoá tới khi lý do ≥ 10 ký tự; xác nhận ⇒ gọi khôi phục với (version, lý do)", async () => {
    hanhDong.xemTruocKhoiPhucAction!.mockResolvedValueOnce({ ok: true, thayDoi: [{ agentId: AG, pageId: PG, truong: "autoCreate", tu: true, sang: false }] });
    hanhDong.khoiPhucBoQuyTacAction!.mockResolvedValueOnce({ ok: true, version: 4 });
    dung(view([], ls));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Khôi phục phiên bản 2" }));
    });
    expect(hanhDong.xemTruocKhoiPhucAction).toHaveBeenCalledWith({ version: 2 });
    expect(hanhDong.khoiPhucBoQuyTacAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("list", { name: "Thay đổi sẽ áp dụng" })).toBeInTheDocument());
    expect(screen.getByText(/Tự tạo lead: BẬT/)).toBeInTheDocument();
    const xacNhan = screen.getByRole("button", { name: "Khôi phục" });
    expect(xacNhan).toBeDisabled();
    nhapLyDo("ngắn");
    expect(xacNhan).toBeDisabled();
    nhapLyDo(`  ${LY_DO}  `);
    expect(xacNhan).toBeEnabled();
    await act(async () => {
      fireEvent.click(xacNhan);
    });
    expect(hanhDong.khoiPhucBoQuyTacAction).toHaveBeenCalledWith({ version: 2, lyDo: LY_DO });
  });
  it("máy chủ từ chối khôi phục (cơ sở đã ngừng) ⇒ hộp giữ nguyên + hiện lý do; xem trước lỗi ⇒ không cho xác nhận", async () => {
    hanhDong.xemTruocKhoiPhucAction!.mockResolvedValueOnce({ ok: true, thayDoi: [] });
    hanhDong.khoiPhucBoQuyTacAction!.mockResolvedValueOnce({ ok: false, error: "Không khôi phục được vì cấu hình hiện tại không còn khớp: Cơ sở đã ngừng hoạt động." });
    dung(view([], ls));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Khôi phục phiên bản 1" }));
    });
    nhapLyDo(LY_DO);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Khôi phục" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/không còn khớp/);
    cleanup();
    hanhDong.xemTruocKhoiPhucAction!.mockResolvedValueOnce({ ok: false, error: "Phiên bản đó không đọc được." });
    dung(view([], ls));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Khôi phục phiên bản 1" }));
    });
    nhapLyDo(LY_DO);
    expect(screen.getByRole("button", { name: "Khôi phục" })).toBeDisabled();
  });
  it("chỉ-xem ⇒ lịch sử hiện nhưng không có nút khôi phục", () => {
    dung(view([], ls), false);
    expect(screen.queryByRole("button", { name: /Khôi phục phiên bản/ })).toBeNull();
    expect(screen.getByText(/Khởi tạo/)).toBeInTheDocument();
  });
});

describe("[QTR-UI-05] sau khi khôi phục / lưu, biểu mẫu PHẢI nạp lại theo phiên bản mới (router.refresh giữ nguyên state của client)", () => {
  const AUTO: QuyTac = { kind: "AUTO_CREATE", agentId: AG, pageId: PG, enabled: true, requireConsent: true, campusCenterIds: [CS1] };
  const slaCu: QuyTac = { kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes: 30, resolveMinutes: 240 };
  const slaMoi: QuyTac = { kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes: 45, resolveMinutes: 300 };
  const tb: QuyTac = { kind: "NOTIFY", event: "INCIDENT", centerId: null, afterMinutes: 0, to: ["INTEGRATION_VIEWERS"] };
  const manHinh = (v: BoQuyTacView) => <ManQuyTac view={v} agents={[agent()]} coSo={COSO} duocSua />;
  it("phiên bản đổi ⇒ SLA, thông báo và ràng buộc hiện NỘI DUNG MỚI; không có thay đổi chưa lưu (nút Lưu khoá)", () => {
    const { rerender } = render(manHinh(view([AUTO, slaCu], [], 4)));
    expect((within(screen.getByRole("group", { name: "Quy tắc SLA 1" })).getByLabelText("Hạn nhận (phút)") as HTMLInputElement).value).toBe("30");
    // Máy chủ trả bản khôi phục (v5): SLA khác, thêm một quy tắc thông báo, bỏ ràng buộc đồng ý.
    rerender(manHinh(view([{ ...AUTO, requireConsent: false }, slaMoi, tb], [], 5)));
    const s = screen.getByRole("group", { name: "Quy tắc SLA 1" });
    expect((within(s).getByLabelText("Hạn nhận (phút)") as HTMLInputElement).value).toBe("45");
    expect(screen.getByRole("group", { name: "Quy tắc thông báo 1" })).toBeInTheDocument();
    const rb = screen.getByRole("group", { name: `Ràng buộc tự tạo lead của Page ${PG}` });
    expect((within(rb).getByLabelText(/đã đồng ý liên hệ/) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Lưu SLA và thông báo" })).toBeDisabled();
  });
  it("cùng phiên bản (làm mới không đổi gì) ⇒ KHÔNG xoá thứ người dùng đang gõ dở", () => {
    const { rerender } = render(manHinh(view([slaCu], [], 4)));
    const o = within(screen.getByRole("group", { name: "Quy tắc SLA 1" })).getByLabelText("Hạn nhận (phút)") as HTMLInputElement;
    fireEvent.change(o, { target: { value: "55" } });
    rerender(manHinh(view([slaCu], [], 4)));
    expect((within(screen.getByRole("group", { name: "Quy tắc SLA 1" })).getByLabelText("Hạn nhận (phút)") as HTMLInputElement).value).toBe("55");
  });
});

describe("[QTR-UI-06] danh sách quy tắc là danh sách ĐÚNG NGỮ NGHĨA (axe: list + aria-allowed-role)", () => {
  it("mỗi nhóm SLA / thông báo nằm TRONG một <li> (không gán role=group lên chính <li>)", () => {
    dung(view([{ kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes: 30, resolveMinutes: 240 }, { kind: "NOTIFY", event: "INCIDENT", centerId: null, afterMinutes: 0, to: ["INTEGRATION_VIEWERS"] }]));
    for (const ten of ["Quy tắc SLA 1", "Quy tắc thông báo 1"]) {
      const g = screen.getByRole("group", { name: ten });
      expect(g.tagName).toBe("DIV");
      expect(g.parentElement?.tagName).toBe("LI");
      expect(g.parentElement?.parentElement?.tagName).toBe("UL");
    }
  });
});

describe("[QTR-UI-07] lưu MỘT phần không được xoá bản nháp ở phần kia (khoá theo NỘI DUNG của chính phần đó, không theo số phiên bản)", () => {
  const AUTO: QuyTac = { kind: "AUTO_CREATE", agentId: AG, pageId: PG, enabled: true, requireConsent: false, campusCenterIds: [CS1] };
  const sla: QuyTac = { kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes: 30, resolveMinutes: 240 };
  const manHinh = (v: BoQuyTacView) => <ManQuyTac view={v} agents={[agent()]} coSo={COSO} duocSua />;
  const oHanNhan = () => within(screen.getByRole("group", { name: "Quy tắc SLA 1" })).getByLabelText("Hạn nhận (phút)") as HTMLInputElement;
  const oDongY = () => within(screen.getByRole("group", { name: `Ràng buộc tự tạo lead của Page ${PG}` })).getByLabelText(/đã đồng ý liên hệ/) as HTMLInputElement;
  it("ràng buộc vừa lưu (phiên bản tăng, SLA không đổi) ⇒ ô SLA đang gõ dở GIỮ NGUYÊN", () => {
    const { rerender } = render(manHinh(view([AUTO, sla], [], 4)));
    fireEvent.change(oHanNhan(), { target: { value: "55" } });
    rerender(manHinh(view([{ ...AUTO, requireConsent: true }, sla], [], 5)));
    expect(oHanNhan().value).toBe("55");
    expect(oDongY().checked).toBe(true);
  });
  it("SLA vừa lưu (phiên bản tăng, ràng buộc không đổi) ⇒ ô ràng buộc đang tick dở GIỮ NGUYÊN", () => {
    const { rerender } = render(manHinh(view([AUTO, sla], [], 4)));
    fireEvent.click(oDongY());
    rerender(manHinh(view([AUTO, { ...sla, claimMinutes: 45 }], [], 5)));
    expect(oDongY().checked).toBe(true);
    expect(oHanNhan().value).toBe("45");
  });
});

describe("[QTR-UI-08] lý do dài KHÔNG ngắt dòng được (người dùng dán một đường dẫn dài) không làm vùng nội dung cuộn ngang", () => {
  it("dòng «Lưu … — lý do: …» ở thẻ phiên bản đang áp dụng cho phép ngắt giữa chữ (như dòng trong lịch sử)", () => {
    const rules: QuyTac[] = [];
    render(<ManQuyTac view={{ phienBanHong: null, hienHanh: { version: 3, rules, publishedAt: NOW, reason: "x".repeat(300), savedFromVersion: null }, lichSu: [] }} agents={[agent()]} coSo={COSO} duocSua />);
    const p = screen.getByText(/lý do: x{300}/);
    expect(p.className).toContain("[overflow-wrap:anywhere]");
  });
});
