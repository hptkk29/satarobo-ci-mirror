// @vitest-environment jsdom
// [QTP-UI] Công tắc "Tự tạo lead cho Page này" (E2) trong tab Page: nhãn BẬT/TẮT bằng CHỮ, trạng thái HIỆU LỰC lấy từ chính hàm máy chủ dùng,
// nút chỉ hiện với người có `ai-integration:manage`, bật/tắt qua hộp hai bước + lý do. Mỗi ca tự dựng mọi thứ (luật 18).
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, hanhDong } = vi.hoisted(() => {
  const hanhDong: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const t of ["datCoSoNhanAction", "datTrangThaiPageAction", "datTuTaoLeadChoPageAction", "goPageAction", "themPageAction"]) hanhDong[t] = vi.fn(async () => ({ ok: true }));
  return { refresh: vi.fn(), hanhDong };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("../_actions", () => hanhDong);

import type { AgentView, QuyTacTuTaoView } from "@/lib/ai-lead/dich-vu/cau-hinh";
import { PageAgent } from "./page-agent";

const PAGE_ID = "104500000000777";
const AGENT_ID = "cm0abcdefghijklmnopqrstuv";
const NOW = new Date("2026-11-09T03:00:00.000Z");

function agent(o: { state?: "ENABLED" | "PAUSED"; active?: boolean } = {}): AgentView {
  return {
    id: AGENT_ID, name: "AI Messenger", environment: "TEST", secretVersion: 1, active: o.active ?? true, contractStatus: "COMPATIBLE", lastHeartbeatAt: null, createdAt: NOW, moiTruongHopLe: true,
    pages: [{ pageId: PAGE_ID, state: o.state ?? "ENABLED", routingCenterId: null, note: null, nguon: { san: true, groupCode: "MARKETING_HO" } }],
  };
}
function dung(o: { quyTac?: QuyTacTuTaoView | null; duocDat?: boolean; ag?: AgentView; duocSua?: boolean } = {}) {
  return render(
    <PageAgent agents={[o.ag ?? agent()]} coSo={[]} duocSua={o.duocSua ?? true} quyTac={o.quyTac === undefined ? { toanHe: false, batTheo: [] } : o.quyTac} duocDatTuTao={o.duocDat ?? true} />,
  );
}
const khoi = () => screen.getByRole("group", { name: "Tự tạo lead cho Page này" });
const BAT = { toanHe: true, batTheo: [`${AGENT_ID}:${PAGE_ID}`] };

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe("[QTP-UI-05] ô «Mã Page» cho phép chữ (hợp đồng nhận [A-Za-z0-9_-]{5,64}) — không ép bàn phím số", () => {
  it("không khai inputMode=numeric", () => {
    const { container } = dung();
    const o = container.querySelector('input[placeholder^="VD: 1045"]')!;
    expect(o).not.toBeNull();
    expect(o.getAttribute("inputmode")).toBeNull();
  });
});

describe("[MKT-02-UI] sẵn sàng NGUỒN lead theo Page: nói thẳng khi chưa cấu hình (hồ sơ vào Ngoại lệ, khách không mất)", () => {
  const voi = (nguon: AgentView["pages"][number]["nguon"]) => {
    const ag = agent();
    ag.pages[0]!.nguon = nguon;
    return dung({ ag });
  };
  it("sẵn sàng ⇒ nhãn «Nguồn lead: <nhóm>», KHÔNG có khối cảnh báo", () => {
    const { container } = voi({ san: true, groupCode: "MARKETING_HO" });
    expect(container.textContent).toContain("Nguồn lead: MARKETING_HO");
    expect(container.querySelector("[data-nguon-chua-san]")).toBeNull();
  });
  it("Page chưa gán nhóm ⇒ nhãn cảnh báo + giải thích đúng nguyên nhân + nhắc Ngoại lệ và việc của Owner", () => {
    const { container } = voi({ san: false, ma: "PAGE_CHUA_GAN_NGUON" });
    expect(container.textContent).toContain("Nguồn lead CHƯA cấu hình");
    const ghiChu = container.querySelector('[data-nguon-chua-san="PAGE_CHUA_GAN_NGUON"]')!;
    expect(ghiChu.getAttribute("role")).toBe("note");
    expect(ghiChu.textContent).toMatch(/NGUON_CHUA_CAU_HINH/);
    expect(ghiChu.textContent).toMatch(/gán nhóm nguồn/);
    expect(ghiChu.textContent).toMatch(/Owner/);
  });
  it("[MKT-LINK] Page chưa gán nguồn ⇒ có LỐI VÀO module Nguồn (luồng có audit, quyền sources:manage) thay vì tự tạo ánh xạ ở màn AI Lead; mục tiêu bấm ≥ 44 px; sẵn sàng ⇒ không có lối vào", () => {
    const { container } = voi({ san: false, ma: "PAGE_CHUA_GAN_NGUON" });
    const a = container.querySelector("a[data-lien-ket-nguon]")!;
    expect(a.getAttribute("href")).toBe("/nguon-hoa-hong/nguon");
    expect(a.className).toMatch(/min-h-11/);
    expect(container.querySelector('[data-nguon-chua-san]')!.textContent).toMatch(/sources:manage/);
    expect(voi({ san: true, groupCode: "MARKETING_HO" }).container.querySelector("a[data-lien-ket-nguon]")).toBeNull();
  });
  it("module nguồn tắt / lỗi ⇒ nguyên nhân KHÁC (nói cờ nguon.enabled)", () => {
    const { container } = voi({ san: false, ma: "NGUON_TAT_HOAC_LOI" });
    expect(container.querySelector('[data-nguon-chua-san="NGUON_TAT_HOAC_LOI"]')!.textContent).toMatch(/nguon\.enabled/);
  });
});

describe("[QTP-UI-00] KHÔNG đọc được quy tắc ⇒ không được hiện 'TẮT' (khẳng định) và không có nút (review độc lập 28/10)", () => {
  it("quyTac = null ⇒ nhãn 'KHÔNG ĐỌC ĐƯỢC', không nhãn TẮT/BẬT, không nút bật/tắt dù có quyền", () => {
    dung({ quyTac: null, duocDat: true });
    expect(within(khoi()).getByText("KHÔNG ĐỌC ĐƯỢC")).toBeInTheDocument();
    expect(within(khoi()).queryByText("TẮT")).toBeNull();
    expect(within(khoi()).queryByText("BẬT")).toBeNull();
    expect(screen.queryByRole("button", { name: /tự tạo lead/i })).toBeNull();
  });
});

describe("[QTP-UI-01] trạng thái: nhãn có CHỮ và câu hiệu lực nói đúng nguyên nhân", () => {
  it("mặc định (Page tắt, toàn hệ tắt) ⇒ nhãn 'TẮT', nói đang chờ công tắc toàn hệ, KHÔNG nhãn BẬT", () => {
    dung();
    expect(within(khoi()).getByText("TẮT")).toBeInTheDocument();
    expect(within(khoi()).queryByText("BẬT")).toBeNull();
    expect(within(khoi()).getByTestId("tu-tao-hieu-luc")).toHaveTextContent(/chờ công tắc toàn hệ/);
  });
  it("toàn hệ BẬT, Page tắt ⇒ 'TẮT' + 'Page này chưa bật tự tạo lead'", () => {
    dung({ quyTac: { toanHe: true, batTheo: [] } });
    expect(within(khoi()).getByText("TẮT")).toBeInTheDocument();
    expect(within(khoi()).getByTestId("tu-tao-hieu-luc")).toHaveTextContent(/Page này chưa bật/);
  });
  it("Page BẬT nhưng toàn hệ TẮT ⇒ 'BẬT' mà KHÔNG hứa đang hiệu lực: câu nói 'đang chờ công tắc toàn hệ'", () => {
    dung({ quyTac: { toanHe: false, batTheo: BAT.batTheo } });
    expect(within(khoi()).getByText("BẬT")).toBeInTheDocument();
    const c = within(khoi()).getByTestId("tu-tao-hieu-luc");
    expect(c).toHaveTextContent(/chờ công tắc toàn hệ/);
    expect(c).not.toHaveTextContent(/Đang hiệu lực/);
  });
  it("cả hai BẬT, Page ENABLED, Agent active ⇒ 'Đang hiệu lực'", () => {
    dung({ quyTac: BAT });
    expect(within(khoi()).getByTestId("tu-tao-hieu-luc")).toHaveTextContent(/Đang hiệu lực/);
  });
  it("Page BẬT nhưng tạm dừng ⇒ nói 'tạm dừng', không 'Đang hiệu lực'", () => {
    dung({ quyTac: BAT, ag: agent({ state: "PAUSED" }) });
    expect(within(khoi()).getByTestId("tu-tao-hieu-luc")).toHaveTextContent(/tạm dừng/);
    expect(within(khoi()).getByTestId("tu-tao-hieu-luc")).not.toHaveTextContent(/Đang hiệu lực/);
  });
  it("Page BẬT nhưng Agent tắt ⇒ nói 'Agent đang tắt'", () => {
    dung({ quyTac: BAT, ag: agent({ active: false }) });
    expect(within(khoi()).getByTestId("tu-tao-hieu-luc")).toHaveTextContent(/Agent đang tắt/);
  });
  it("nhãn không dùng tông xanh (bật là rủi ro, không phải thành công)", () => {
    const { container } = dung({ quyTac: BAT });
    expect(container.querySelector("[class*='state-success']")).toBeNull();
  });
});

describe("[QTP-UI-02] quyền: chỉ ai-integration:manage có nút; người khác vẫn THẤY trạng thái", () => {
  it("không có quyền ⇒ không có nút bật/tắt tự tạo lead nhưng nhãn và câu hiệu lực vẫn hiện", () => {
    dung({ duocDat: false });
    expect(screen.queryByRole("button", { name: /tự tạo lead/i })).toBeNull();
    expect(within(khoi()).getByText("TẮT")).toBeInTheDocument();
    expect(within(khoi()).getByTestId("tu-tao-hieu-luc")).toBeInTheDocument();
  });
  it("có `duocSua` (ai-leads:configure) nhưng không `duocDatTuTao` ⇒ các nút Page cũ còn, nút tự tạo lead vắng", () => {
    dung({ duocDat: false, duocSua: true });
    expect(screen.getByRole("button", { name: "Tạm dừng Page" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tự tạo lead/i })).toBeNull();
  });
  it("đối chứng dương: có quyền ⇒ Page tắt hiện 'Bật tự tạo lead'; Page bật hiện 'Tắt tự tạo lead'", () => {
    dung();
    expect(screen.getByRole("button", { name: "Bật tự tạo lead" })).toBeInTheDocument();
    cleanup();
    dung({ quyTac: BAT });
    expect(screen.getByRole("button", { name: "Tắt tự tạo lead" })).toBeInTheDocument();
  });
});

describe("[QTP-UI-03] bật / tắt đi qua hộp HAI BƯỚC với lý do bắt buộc", () => {
  const nhap = (v: string) => fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: v } });

  it("bấm 'Bật' chỉ MỞ hộp: nêu cảnh báo (không qua duyệt), chưa gọi action; xác nhận khoá tới khi lý do ≥ 10 ký tự", () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: "Bật tự tạo lead" }));
    expect(hanhDong.datTuTaoLeadChoPageAction).not.toHaveBeenCalled();
    expect(screen.getByText(/không qua duyệt/)).toBeInTheDocument();
    expect(screen.getByText(/tên Facebook \+ SĐT \+ cơ sở/)).toBeInTheDocument();
    const xacNhan = screen.getAllByRole("button", { name: "Bật tự tạo lead" }).at(-1)!;
    expect(xacNhan).toBeDisabled();
    nhap("ngắn quá");
    expect(xacNhan).toBeDisabled();
    nhap("  Thử nghiệm Page thử đợt một  ");
    expect(xacNhan).toBeEnabled();
  });

  it("xác nhận ⇒ gọi action MỘT lần với { agentId, pageId, bat: true, lyDo đã cắt khoảng trắng }, rồi làm mới trang", async () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: "Bật tự tạo lead" }));
    nhap("  Thử nghiệm Page thử đợt một  ");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Bật tự tạo lead" }).at(-1)!);
    });
    expect(hanhDong.datTuTaoLeadChoPageAction).toHaveBeenCalledTimes(1);
    expect(hanhDong.datTuTaoLeadChoPageAction).toHaveBeenCalledWith({ agentId: AGENT_ID, pageId: PAGE_ID, bat: true, lyDo: "Thử nghiệm Page thử đợt một" });
    expect(refresh).toHaveBeenCalled();
  });

  it("'Tắt' gọi action với bat: false; máy chủ từ chối ⇒ hộp giữ nguyên và hiện lỗi (không đóng như thể đã làm)", async () => {
    hanhDong.datTuTaoLeadChoPageAction!.mockResolvedValueOnce({ ok: false, error: "Page đã ở trạng thái đó — tải lại trang rồi thử lại." });
    dung({ quyTac: BAT });
    fireEvent.click(screen.getByRole("button", { name: "Tắt tự tạo lead" }));
    expect(screen.getByText(/quay về hàng chờ nhân viên duyệt/)).toBeInTheDocument();
    nhap("Kết thúc đợt chạy thử");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Tắt tự tạo lead" }).at(-1)!);
    });
    expect(hanhDong.datTuTaoLeadChoPageAction).toHaveBeenCalledWith({ agentId: AGENT_ID, pageId: PAGE_ID, bat: false, lyDo: "Kết thúc đợt chạy thử" });
    expect(screen.getByText(/tải lại trang/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled(); // thất bại vẫn làm mới (version có thể đã đổi); hộp thoại GIỮ NGUYÊN
  });
});

describe("[QTP-UI-04] giữ nguyên các nút/ô Page đã có (không hồi quy)", () => {
  it("Tạm dừng / Gỡ Page / Lưu cơ sở nhận vẫn hiện cho người có quyền cấu hình", () => {
    dung();
    expect(screen.getByRole("button", { name: "Tạm dừng Page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gỡ Page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lưu cơ sở nhận" })).toBeInTheDocument();
  });
});
