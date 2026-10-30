// @vitest-environment jsdom
// [AIK-UI] Logic HIỂN THỊ của Cấu hình + Trung tâm kết nối AI (lát K). Trọng tâm: KHÔNG BAO GIỜ có badge xanh khi thiếu bằng chứng; khoá chỉ hiện một lần;
// nút nguy hiểm đòi lý do; nút không có quyền thì vắng mặt (không phải bấm rồi mới từ chối); nút nào hiện là nút làm thật.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, hanhDong } = vi.hoisted(() => {
  const ten = [
    "taoAgentAction", "taoLaiKhoaAction", "datHoatDongAgentAction", "datContractStatusAction", "themPageAction", "goPageAction", "datTrangThaiPageAction", "datCoSoNhanAction",
    "luuCoSoXuatBanAction", "goCoSoXuatBanAction", "xuatBanCatalogAction", "xuatBanLaiAction", "doiChinhSachAction", "voHieuHoaAgentTestTrenProdAction",
    "phatHanhThamDoAction", "ghiLanChayAction", "xuLySuCoAction",
  ];
  const hanhDong: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const t of ten) hanhDong[t] = vi.fn(async () => ({ ok: true }));
  return { refresh: vi.fn(), hanhDong };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("../cau-hinh/_actions", () => hanhDong);
vi.mock("../ket-noi/_actions", () => hanhDong);

import type { AgentKetNoiView } from "@/lib/ai-lead/dich-vu/ket-noi";
import type { CauHinhView } from "@/lib/ai-lead/dich-vu/cau-hinh";
import { HASH_HOP_DONG_HIEN_HANH, tinhTrangKetNoi, type DauVaoTinhTrang, type KetQuaTinhTrang, type LanChay } from "@/lib/ai-lead/dich-vu/ket-noi-thuan";
import { HopKhoa } from "./hop-khoa";
import { NhanDon, NhanTang, NhanTong, CHU_NHAN } from "./nhan-trang-thai";
import { NutLyDo } from "./nut-ly-do";
import { TheAgent } from "../ket-noi/_components/the-agent";
import { DanhSachSuCo } from "../ket-noi/_components/danh-sach-su-co";
import { LichSuChay } from "../ket-noi/_components/lich-su-chay";
import { ChinhSach } from "../cau-hinh/_components/chinh-sach";
import { CoSoCatalog } from "../cau-hinh/_components/co-so-catalog";
import { AgentVaKhoa } from "../cau-hinh/_components/agent-va-khoa";

const NOW = Date.parse("2026-11-08T03:00:00.000Z");
const PAGES = ["104500000000777"];
const KHOA = "ab".repeat(32);
const XANH = /bg-state-success-soft/;

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  // Mỗi ca tự dựng clipboard của mình — KHÔNG mượn bản ca trước để lại (luật 18: mỗi ca phải xanh khi chạy một mình / thứ tự xáo trộn).
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
});

function run(level: LanChay["level"], status: LanChay["status"], o: Partial<LanChay> = {}): LanChay {
  return {
    id: `r-${level}-${status}`,
    agentId: level === "L1" ? null : "agent1",
    level,
    status,
    kind: ({ L1: "CONTRACT", L2: "PROBE", L3: "E2E", L4: "PILOT" } as const)[level],
    createdAt: new Date(NOW - 10 * 60_000),
    buildSha: level === "L1" ? null : "abc1234",
    contractHash: HASH_HOP_DONG_HIEN_HANH,
    correlationId: null,
    evidence: { environment: "TEST", pageIds: PAGES },
    ...o,
  };
}

function ketQua(lanChay: LanChay[], o: Partial<DauVaoTinhTrang["agent"]> = {}): KetQuaTinhTrang {
  return tinhTrangKetNoi({
    now: NOW,
    nguongMatKetNoiMs: 180_000,
    nguongNgatKetNoiMs: 24 * 3_600_000,
    ttlKiemChungMs: 7 * 24 * 3_600_000,
    hashHopDongHienHanh: HASH_HOP_DONG_HIEN_HANH,
    congProd: { allowed: true, thieu: [] },
    agent: { active: true, environment: "TEST", moiTruongHopLe: true, contractStatus: "COMPATIBLE", lastHeartbeatAt: new Date(NOW - 30_000), lastBuildSha: "abc1234", lastContractHash: HASH_HOP_DONG_HIEN_HANH, ...o },
    pageIdsHienTai: PAGES,
    lanChay,
    suCoMo: { tong: 0, nghiemTrongNhat: null },
  });
}

function view(lanChay: LanChay[], o: Partial<AgentKetNoiView> = {}): AgentKetNoiView {
  const tongHop = ketQua(lanChay);
  return {
    agent: { id: "agent1", name: "AI Messenger TEST", environment: "TEST", active: true, contractStatus: "COMPATIBLE", secretVersion: 1, lastAgentVersion: "1.2.3", lastBuildSha: "abc1234", lastContractHash: HASH_HOP_DONG_HIEN_HANH, lastHeartbeatAt: new Date(NOW - 30_000) },
    tongHop,
    pages: [{ pageId: PAGES[0]!, state: "ENABLED", routingCenterId: null, webhook: { trangThai: "CHUA_TUNG", lanCuoi: null, tuoiMs: null }, tinhTrang: tongHop, cuocMoiHomNay: 0, luuLuongBatThuong: false }],
    catalog: { daThay: 1, moiNhat: 2, tre: true },
    luuLuong24h: { tong: 10, loi: 1 },
    tuChoi: null,
    hoSo: { cho: 2, dangXuLy: 1, quaHan: 0, quaTuoi: 0 },
    suCoMo: { tong: 0, nghiemTrongNhat: null },
    thamDo: { dangMo: null, ackGanNhat: null },
    chayGanDay: [],
    ...o,
  };
}

const the = (v: AgentKetNoiView, quyen = { quanLy: true, page: true }) => render(<TheAgent v={v} bayGio={new Date(NOW)} quyen={quyen} />);
const soXanh = (c: HTMLElement) => c.querySelectorAll('[data-xanh="true"]').length;
const coLopXanh = (c: HTMLElement) => [...c.querySelectorAll("*")].some((e) => XANH.test(e.getAttribute("class") ?? ""));

describe("[AIK-UI-NHAN] nhãn: xanh chỉ từ cờ bằng chứng", () => {
  it("[AIK-UI-NHAN-01] mười nhãn × xanh=false ⇒ KHÔNG BAO GIỜ lớp xanh (kể cả nhãn tên CONNECTED)", () => {
    for (const nhan of Object.keys(CHU_NHAN) as (keyof typeof CHU_NHAN)[]) {
      const { container } = render(<NhanTong ketQua={{ nhan, xanh: false }} />);
      expect(coLopXanh(container), nhan).toBe(false);
      expect(container.querySelector('[data-xanh="true"]'), nhan).toBeNull();
      cleanup();
    }
  });
  it("[AIK-UI-NHAN-02] đối chứng dương: xanh=true ⇒ có lớp xanh + data-xanh", () => {
    const { container } = render(<NhanTong ketQua={{ nhan: "CONNECTED", xanh: true }} />);
    expect(coLopXanh(container)).toBe(true);
    expect(soXanh(container)).toBe(1);
  });
  it("[AIK-UI-NHAN-03] tầng: muc=DAT nhưng dat=false (dữ liệu mâu thuẫn) ⇒ vẫn KHÔNG xanh; NhanDon cấm tone success", () => {
    const { container } = render(
      <>
        <NhanTang tang={{ muc: "DAT", dat: false }} />
        <NhanTang tang={{ muc: "CHI_GIA_LAP", dat: false }} />
        <NhanDon tone="success">Bật</NhanDon>
      </>,
    );
    expect(coLopXanh(container)).toBe(false);
  });
  it("[AIK-UI-NHAN-04] nhãn luôn có CHỮ (không chỉ màu)", () => {
    const { container } = render(<NhanTong ketQua={{ nhan: "STALE", xanh: false }} />);
    expect(container.textContent).toBe("Mất nhịp");
  });
});

describe("[AIK-UI-THE] thẻ Agent không bao giờ xanh khi thiếu bằng chứng", () => {
  it("[AIK-UI-THE-01] nhịp sống tươi, KHÔNG có lần chạy nào ⇒ không xanh; L2/L3 hiện 'Chờ đội Agent'", () => {
    const { container } = the(view([]));
    expect(soXanh(container)).toBe(0);
    expect(coLopXanh(container)).toBe(false);
    expect(within(container.querySelector('[data-tang="L2"]') as HTMLElement).getByText("Chờ đội Agent")).toBeInTheDocument();
    expect(within(container.querySelector('[data-tang="L3"]') as HTMLElement).getByText("Chờ đội Agent")).toBeInTheDocument();
    expect(screen.getAllByText("Chưa xác minh").length).toBeGreaterThanOrEqual(1);
  });
  it("[AIK-UI-THE-02] chỉ có MOCK_ONLY ở mọi tầng ⇒ không xanh, nói rõ 'giả lập — không tính là đạt'", () => {
    const { container } = the(view([run("L1", "MOCK_ONLY"), run("L2", "MOCK_ONLY"), run("L3", "MOCK_ONLY")]));
    expect(soXanh(container)).toBe(0);
    expect(coLopXanh(container)).toBe(false);
    expect(screen.getAllByText(/giả lập \(MOCK_ONLY\) — không tính là đạt/).length).toBeGreaterThanOrEqual(3);
  });
  it("[AIK-UI-THE-03] đối chứng dương: L2 PASS còn hạn ⇒ ĐÚNG hai chỗ xanh (nhãn tổng + tầng L2), không tầng khác", () => {
    const { container } = the(view([run("L2", "PASS")]));
    expect(soXanh(container)).toBe(3); // tổng hợp thẻ + Page tổng hợp theo Page + tầng L2
    expect(container.querySelector('[data-tang="L2"] [data-xanh="true"]')).not.toBeNull();
    for (const t of ["L1", "L3", "L4"]) expect(container.querySelector(`[data-tang="${t}"] [data-xanh="true"]`), t).toBeNull();
    expect(container.querySelector('header [data-nhan="CONNECTED"][data-xanh="true"]')).not.toBeNull();
  });
  it("[AIK-UI-THE-04] PASS hết hạn (đổi build) ⇒ không xanh và nói lý do hết hạn", () => {
    const v = view([run("L2", "PASS", { buildSha: "cu00000" })]);
    const { container } = the(v);
    expect(soXanh(container)).toBe(0);
    expect(within(container.querySelector('[data-tang="L2"]') as HTMLElement).getByText("Hết hạn")).toBeInTheDocument();
    expect(container.querySelector('[data-tang="L2"]')!.textContent).toMatch(/build/i);
  });
  it("[AIK-UI-THE-05] webhook là LỜI KHAI: có chú thích Admin không xác minh; chưa từng ⇒ nói chưa từng, không suy PASS", () => {
    const { container } = the(view([run("L2", "PASS")]));
    expect(container.textContent).toMatch(/lời khai của Agent, Admin không xác minh được/);
    expect(container.textContent).toMatch(/chưa từng nhận sự kiện Meta/);
    expect(container.querySelector('[data-tang="L3"] [data-xanh="true"]')).toBeNull();
  });
  it("[AIK-UI-THE-06] mỗi ô trạng thái nêu NGUỒN; ô 'Yêu cầu 24 giờ' nói rõ chỉ đếm yêu cầu đã qua xác thực", () => {
    const { container } = the(view([]));
    const o = container.querySelectorAll("[data-o]");
    expect(o.length).toBeGreaterThanOrEqual(8);
    for (const e of o) expect(e.textContent, e.getAttribute("data-o") ?? "").toMatch(/Nguồn:/);
    expect(container.textContent).toMatch(/chỉ đếm yêu cầu đã qua xác thực/);
  });
  it("[AIK-UI-THE-06b] KHÔNG in «0 lỗi» khi máy chủ không đo được lỗi từ chối: 0 dòng lỗi ⇒ «lỗi từ chối: chưa đo»; có dòng lỗi thật ⇒ in số", () => {
    const a = the(view([], { luuLuong24h: { tong: 10, loi: 0 } }));
    expect(a.container.textContent).toMatch(/10 yêu cầu đã xử lý · lỗi từ chối: chưa đo/);
    expect(a.container.textContent).not.toMatch(/(^|[^\d])0 lỗi/);
    a.unmount();
    const b = the(view([], { luuLuong24h: { tong: 10, loi: 3 } }));
    expect(b.container.textContent).toMatch(/10 yêu cầu · 3 lỗi/);
  });
  it("[AIK-UI-THE-06c] bộ đếm từ chối BẬT: in số thật + 3 mã nhiều nhất, kể cả 0 (đã đo, không có); nguồn nói rõ là bộ đếm gộp", () => {
    const a = the(view([], { luuLuong24h: { tong: 10, loi: 0 }, tuChoi: { tong: 12, theoMa: [{ ma: "CLOCK_SKEW", n: 7 }, { ma: "RATE_LIMITED", n: 4 }, { ma: "PAYLOAD_INVALID", n: 1 }] } }));
    expect(a.container.textContent).toMatch(/10 yêu cầu đã xử lý \(24 giờ\) · 12 bị từ chối ở bước xác thực \(hôm nay \+ hôm qua\) — CLOCK_SKEW ×7, RATE_LIMITED ×4, PAYLOAD_INVALID ×1/);
    expect(a.container.textContent).not.toMatch(/lỗi từ chối: chưa đo/);
    a.unmount();
    const b = the(view([], { luuLuong24h: { tong: 10, loi: 0 }, tuChoi: { tong: 0, theoMa: [] } }));
    expect(b.container.textContent).toMatch(/10 yêu cầu đã xử lý \(24 giờ\) · 0 bị từ chối ở bước xác thực \(hôm nay \+ hôm qua\)/);
    b.unmount();
    // BẬT bộ đếm KHÔNG được làm biến mất lỗi khi xử lý (khác loại với từ chối): hai con số cùng hiện
    const c = the(view([], { luuLuong24h: { tong: 10, loi: 3 }, tuChoi: { tong: 2, theoMa: [{ ma: "RATE_LIMITED", n: 2 }] } }));
    expect(c.container.textContent).toMatch(/10 yêu cầu đã xử lý \(24 giờ\) · 3 lỗi khi xử lý · 2 bị từ chối ở bước xác thực/);
  });
  it("[AIK-UI-THE-08] chỉ báo giám sát: Page vượt ngưỡng cuộc trò chuyện mới ⇒ cảnh báo (chỉ cảnh báo, không chặn); hàng chờ ứ ⇒ đếm «ứ trong hàng chờ quá ngưỡng tuổi»; bình thường ⇒ không có chữ cảnh báo", () => {
    const base = view([]);
    const binhThuong = the({ ...base, pages: base.pages.map((p) => ({ ...p, cuocMoiHomNay: 7, luuLuongBatThuong: false })) });
    const dong = binhThuong.container.querySelector("[data-cuoc-moi]")!;
    expect(dong.textContent).toBe("Cuộc trò chuyện mới hôm nay: 7");
    expect(dong.getAttribute("data-bat-thuong")).toBeNull();
    expect(binhThuong.container.textContent).not.toMatch(/ứ trong hàng chờ/);
    binhThuong.unmount();
    const bat = the({ ...base, pages: base.pages.map((p) => ({ ...p, cuocMoiHomNay: 900, luuLuongBatThuong: true })), hoSo: { cho: 5, dangXuLy: 0, quaHan: 0, quaTuoi: 3 } });
    const d2 = bat.container.querySelector("[data-cuoc-moi]")!;
    expect(d2.getAttribute("data-bat-thuong")).toBe("co");
    expect(d2.textContent).toMatch(/900 — vượt ngưỡng cảnh báo hằng ngày.*Chỉ cảnh báo, không chặn/);
    expect(bat.container.textContent).toMatch(/5 chờ · 0 đang xử lý · 0 quá hạn SLA · 3 ứ trong hàng chờ quá ngưỡng tuổi/);
  });
  it("[AIK-UI-THE-07] hash lạ ⇒ cảnh báo hiện ra, nhãn Suy giảm, không xanh dù có L2 PASS", () => {
    const lac = "0".repeat(64);
    const tongHop = tinhTrangKetNoi({
      now: NOW, nguongMatKetNoiMs: 180_000, nguongNgatKetNoiMs: 86_400_000, ttlKiemChungMs: 604_800_000, hashHopDongHienHanh: HASH_HOP_DONG_HIEN_HANH, congProd: { allowed: true, thieu: [] },
      agent: { active: true, environment: "TEST", moiTruongHopLe: true, contractStatus: "COMPATIBLE", lastHeartbeatAt: new Date(NOW - 1000), lastBuildSha: "abc1234", lastContractHash: lac },
      pageIdsHienTai: PAGES, lanChay: [run("L2", "PASS", { contractHash: lac })], suCoMo: { tong: 0, nghiemTrongNhat: null },
    });
    const { container } = the(view([], { tongHop }));
    expect(screen.getByRole("list", { name: "Cảnh báo" })).toBeInTheDocument();
    // Nhãn TỔNG (đầu thẻ + từng Page) là Suy giảm và KHÔNG xanh. Tầng L2 vẫn có thể 'đạt' (bằng chứng PASS còn hạn với hash Agent khai) —
    // nhưng mọi chỗ xanh phải nằm trong khối tầng, không bao giờ ở nhãn tổng.
    expect(container.querySelector('header [data-nhan="DEGRADED"][data-xanh="false"]')).not.toBeNull();
    for (const e of container.querySelectorAll('[data-xanh="true"]')) expect(e.closest("[data-tang]")).not.toBeNull();
    expect(container.querySelector('[data-page] [data-xanh="true"]')).toBeNull();
  });
});

describe("[AIK-UI-QUYEN] nút chỉ có khi có quyền, và nút nào hiện thì làm thật", () => {
  it("[AIK-UI-QUYEN-01] không có quyền quản lý ⇒ KHÔNG có nút Kiểm tra kết nối / Tắt Agent; xem được trạng thái", () => {
    the(view([]), { quanLy: false, page: false });
    expect(screen.queryByRole("button", { name: "Kiểm tra kết nối" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tắt Agent" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tạm dừng Page/ })).toBeNull();
    expect(screen.getByText("AI Messenger TEST")).toBeInTheDocument();
  });
  it("[AIK-UI-QUYEN-02] 'Kiểm tra kết nối' gọi hành động thật; KHÔNG có nút ghi L2 tay (L2 chỉ do heartbeat ghi khi Agent ack)", async () => {
    the(view([]));
    expect(screen.queryByRole("button", { name: /Ghi nhận L2/ })).toBeNull();
    expect(screen.getByText(/không có nút ghi tay/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kiểm tra kết nối" }));
    });
    expect(hanhDong.phatHanhThamDoAction).toHaveBeenCalledWith({ agentId: "agent1" });
  });
  it("[AIK-UI-QUYEN-03] đang có thăm dò mở ⇒ khoá 'Kiểm tra kết nối' kèm lời giải thích", () => {
    the(view([], { thamDo: { dangMo: { probeId: "prb_abcdefghijkl", expiresAt: new Date(NOW + 300_000) }, ackGanNhat: new Date(NOW - 60_000) } }));
    expect(screen.getByRole("button", { name: "Kiểm tra kết nối" })).toBeDisabled();
    expect(screen.getByText(/chưa phát thêm được/)).toBeInTheDocument();
  });
  it("[AIK-UI-QUYEN-04] Page PAUSED ⇒ nút 'Bật lại Page'; Page ENABLED ⇒ 'Tạm dừng Page'", () => {
    const v = view([]);
    v.pages[0] = { ...v.pages[0]!, state: "PAUSED", tinhTrang: ketQuaPaused() };
    the(v);
    expect(screen.getByRole("button", { name: "Bật lại Page" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tạm dừng Page" })).toBeNull();
    expect(screen.getAllByText("Tạm dừng").length).toBeGreaterThan(0);
  });
});

function ketQuaPaused(): KetQuaTinhTrang {
  return tinhTrangKetNoi({
    now: NOW, nguongMatKetNoiMs: 180_000, nguongNgatKetNoiMs: 86_400_000, ttlKiemChungMs: 604_800_000, hashHopDongHienHanh: HASH_HOP_DONG_HIEN_HANH, congProd: { allowed: true, thieu: [] },
    agent: { active: true, environment: "TEST", moiTruongHopLe: true, contractStatus: "COMPATIBLE", lastHeartbeatAt: new Date(NOW - 1000), lastBuildSha: "abc1234", lastContractHash: HASH_HOP_DONG_HIEN_HANH },
    pageIdsHienTai: PAGES, page: { pageId: PAGES[0]!, state: "PAUSED" }, lanChay: [], suCoMo: { tong: 0, nghiemTrongNhat: null },
  });
}

describe("[AIK-UI-KHOA] hộp khoá: MỘT lần", () => {
  const cauHinh = { agentId: "cm0abcdefghijklmnopqrstuv", name: "AI", environment: "TEST" as const, secretVersion: 1, agentSecret: KHOA, baseUrl: "https://admin.satarobo.vn/api/ai-lead-agent/v1" };
  function Cha({ onDong }: { onDong?: () => void }) {
    const [c, datC] = useState<typeof cauHinh | null>(cauHinh);
    return <HopKhoa cauHinh={c} tieuDe="Khoá của Agent" onDong={() => (datC(null), onDong?.())} />;
  }
  const chepVao = vi.fn(async () => undefined);
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: chepVao }, configurable: true });
    chepVao.mockClear();
  });

  it("[AIK-UI-KHOA-01] khoá hiện đúng một lần và BIẾN KHỎI DOM sau khi đóng", async () => {
    render(<Cha />);
    expect(document.body.textContent).toContain(KHOA);
    const dong = screen.getByRole("button", { name: "Đóng" });
    fireEvent.click(dong); // nhịp 1: chưa chép ⇒ chỉ cảnh báo
    expect(document.body.textContent).toContain(KHOA);
    expect(screen.getByRole("alert")).toHaveTextContent(/chưa chép khoá/);
    fireEvent.click(screen.getByRole("button", { name: /Bấm lần nữa — đóng và mất khoá/ }));
    await waitFor(() => expect(document.body.textContent).not.toContain(KHOA));
  });

  it("[AIK-UI-KHOA-02] đã bấm 'Chép' khoá ⇒ đóng MỘT nhịp; clipboard nhận đúng khoá", async () => {
    const onDong = vi.fn();
    render(<Cha onDong={onDong} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Chép Khoá (agentSecret)" }));
    });
    expect(chepVao).toHaveBeenCalledWith(KHOA);
    fireEvent.click(screen.getByRole("button", { name: "Đã chép — đóng" }));
    expect(onDong).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.body.textContent).not.toContain(KHOA));
  });

  it("[AIK-UI-KHOA-03] phím Esc KHÔNG đóng hộp (mất khoá chỉ vì một phím quen tay)", () => {
    render(<Cha />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.body.textContent).toContain(KHOA);
  });

  it("[AIK-UI-KHOA-04] khoá KHÔNG nằm trong thuộc tính nào (aria-label, title, href, data-*) — chỉ trong nội dung chữ", () => {
    render(<Cha />);
    for (const e of document.body.querySelectorAll("*")) {
      for (const a of e.getAttributeNames()) expect(e.getAttribute(a) ?? "", `${e.tagName}[${a}]`).not.toContain(KHOA);
    }
  });

  it("[AIK-UI-KHOA-05] cauHinh=null ⇒ không render khoá nào", () => {
    render(<HopKhoa cauHinh={null} tieuDe="" onDong={() => undefined} />);
    expect(document.body.textContent).not.toContain(KHOA);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("[AIK-UI-LYDO] nút nguy hiểm đòi lý do", () => {
  const mo = (chay = vi.fn(async () => ({ ok: true }) as const)) => {
    render(<NutLyDo nhan="Tắt Agent" tieuDe="Tắt?" moTa="Hậu quả" nhanXacNhan="Xác nhận tắt" chay={chay} />);
    fireEvent.click(screen.getByRole("button", { name: "Tắt Agent" }));
    return chay;
  };
  const nhap = (v: string) => fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: v } });

  it("[AIK-UI-LYDO-01] bước 1 chỉ MỞ hộp, chưa thực thi gì; xác nhận bị khoá khi chưa có lý do và nói còn thiếu bao nhiêu", () => {
    const chay = mo();
    expect(chay).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Xác nhận tắt" })).toBeDisabled();
    expect(screen.getByText(/Cần ít nhất 10 ký tự \(đang có 0\)/)).toBeInTheDocument();
  });
  it("[AIK-UI-LYDO-02] lý do toàn khoảng trắng hoặc < 10 ký tự ⇒ vẫn khoá; đủ 10 ⇒ mở", () => {
    mo();
    nhap("          ");
    expect(screen.getByRole("button", { name: "Xác nhận tắt" })).toBeDisabled();
    nhap("ngắn quá");
    expect(screen.getByRole("button", { name: "Xác nhận tắt" })).toBeDisabled();
    nhap("  đủ mười ký tự  ");
    expect(screen.getByRole("button", { name: "Xác nhận tắt" })).toBeEnabled();
  });
  it("[AIK-UI-LYDO-03] xác nhận gọi hành động với lý do ĐÃ CẮT khoảng trắng, rồi làm mới trang và đóng hộp", async () => {
    const chay = mo();
    nhap("  Nghi lộ khoá trong log  ");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận tắt" }));
    });
    expect(chay).toHaveBeenCalledWith("Nghi lộ khoá trong log");
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("[AIK-UI-LYDO-04] máy chủ từ chối ⇒ hộp GIỮ NGUYÊN và hiện lỗi (không đóng như thể đã làm)", async () => {
    const chay = mo(vi.fn(async () => ({ ok: false, error: "Không có quyền" }) as never));
    nhap("Lý do đủ dài rồi");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận tắt" }));
    });
    expect(chay).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Không có quyền");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled(); // thất bại vẫn làm mới (version có thể đã đổi); hộp thoại GIỮ NGUYÊN
  });
  it("[AIK-UI-LYDO-05] ô nhập thêm không hợp lệ (kiemThem) cũng khoá xác nhận và nói lý do", () => {
    render(<NutLyDo nhan="Đặt" tieuDe="t" moTa="m" nhanXacNhan="OK" kiemThem={() => "Chọn trạng thái khác"} chay={async () => ({ ok: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Đặt" }));
    nhap("Lý do đủ dài rồi");
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
    expect(screen.getByText("Chọn trạng thái khác")).toBeInTheDocument();
  });
  it("[AIK-UI-LYDO-06] nút có thể bị vô hiệu từ ngoài (disabled) — không mở được hộp", () => {
    render(<NutLyDo nhan="Xuất bản" tieuDe="t" moTa="m" nhanXacNhan="OK" disabled chay={async () => ({ ok: true })} />);
    expect(screen.getByRole("button", { name: "Xuất bản" })).toBeDisabled();
  });
});

describe("[AIK-UI-SUCO] nhật ký sự cố", () => {
  const sc = (o: Partial<Parameters<typeof DanhSachSuCo>[0]["rows"][number]> = {}) => ({
    id: "inc1", agentId: "agent1", agentName: "AI Messenger TEST", pageId: "104500000000777", category: "WEBHOOK_FAILURE", detailCode: "WEBHOOK_TIMEOUT",
    severity: "HIGH" as const, count: 3, state: "OPEN" as const, firstSeenAt: new Date(NOW - 3_600_000), lastSeenAt: new Date(NOW), assigneeId: null, assigneeName: null, lastCorrelationId: null, ...o,
  });
  it("[AIK-UI-SUCO-01] rỗng ⇒ trạng thái rỗng có hướng dẫn, không bảng trống", () => {
    render(<DanhSachSuCo rows={[]} nguoiXuLy={[]} duocXuLy />);
    expect(screen.getByText("Không có sự cố nào khớp bộ lọc")).toBeInTheDocument();
  });
  it("[AIK-UI-SUCO-02] OPEN: Nhận · Giao · Đóng; RESOLVED: chỉ Mở lại", () => {
    const { unmount } = render(<DanhSachSuCo rows={[sc()]} nguoiXuLy={[{ id: "u2", name: "Nguyễn Văn A" }]} duocXuLy />);
    expect(screen.getByRole("button", { name: "Nhận" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Giao" })).toBeDisabled(); // chưa chọn người
    expect(screen.getByRole("button", { name: "Đóng sự cố" })).toBeInTheDocument();
    unmount();
    render(<DanhSachSuCo rows={[sc({ state: "RESOLVED" })]} nguoiXuLy={[]} duocXuLy />);
    expect(screen.getByRole("button", { name: "Mở lại" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nhận" })).toBeNull();
  });
  it("[AIK-UI-SUCO-03] 'Nhận' gọi hành động ACK; 'Giao' gửi người đã chọn", async () => {
    render(<DanhSachSuCo rows={[sc()]} nguoiXuLy={[{ id: "u2", name: "Nguyễn Văn A" }]} duocXuLy />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Nhận" }));
    });
    expect(hanhDong.xuLySuCoAction).toHaveBeenCalledWith({ id: "inc1", hanhDong: "ACK" });
    fireEvent.change(screen.getByLabelText("Giao cho"), { target: { value: "u2" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Giao" }));
    });
    expect(hanhDong.xuLySuCoAction).toHaveBeenCalledWith({ id: "inc1", hanhDong: "GIAO", assigneeId: "u2" });
  });
  it("[AIK-UI-SUCO-04] không có quyền xử lý ⇒ không nút hành động nào; vẫn thấy nội dung + mức độ bằng chữ", () => {
    render(<DanhSachSuCo rows={[sc()]} nguoiXuLy={[]} duocXuLy={false} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Cao")).toBeInTheDocument();
    expect(screen.getByText("WEBHOOK_TIMEOUT")).toBeInTheDocument();
  });
  it("[AIK-UI-SUCO-05] đóng sự cố đòi lý do (qua hộp lý do)", async () => {
    render(<DanhSachSuCo rows={[sc()]} nguoiXuLy={[]} duocXuLy />);
    fireEvent.click(screen.getByRole("button", { name: "Đóng sự cố" }));
    expect(screen.getAllByRole("button", { name: "Đóng sự cố" }).find((b) => (b as HTMLButtonElement).disabled)).toBeDefined();
  });
});

describe("[AIK-UI-BANGCHUNG] lịch sử lần chạy", () => {
  it("[AIK-UI-BANGCHUNG-01] MOCK_ONLY gắn 'CHỈ GIẢ LẬP'; PASS lịch sử KHÔNG bao giờ xanh", () => {
    const rows = [
      { id: "a", level: "L3" as const, status: "MOCK_ONLY" as const, kind: "E2E" as const, createdAt: new Date(NOW), correlationId: null, mock: true, nguon: "THU_CONG" as const },
      { id: "b", level: "L2" as const, status: "PASS" as const, kind: "PROBE" as const, createdAt: new Date(NOW), correlationId: null, mock: false, nguon: "HE_THONG" as const },
    ];
    const { container } = render(<LichSuChay rows={rows} />);
    expect(screen.getByText("CHỈ GIẢ LẬP")).toBeInTheDocument();
    expect(container.querySelector('[data-run="a"]')!.getAttribute("data-mock")).toBe("true");
    expect(coLopXanh(container)).toBe(false);
  });
  it("[AIK-UI-BANGCHUNG-03] mỗi lần chạy nói rõ NGUỒN: L2 «Hệ thống đo»; L3/L4 «Người ghi tay — Admin không quan sát được» (không để người ghi tay trông như số đo)", () => {
    const rows = [
      { id: "a", level: "L3" as const, status: "PASS" as const, kind: "E2E" as const, createdAt: new Date(NOW), correlationId: null, mock: false, nguon: "THU_CONG" as const },
      { id: "b", level: "L2" as const, status: "PASS" as const, kind: "PROBE" as const, createdAt: new Date(NOW), correlationId: null, mock: false, nguon: "HE_THONG" as const },
    ];
    const { container } = render(<LichSuChay rows={rows} />);
    expect(container.querySelector('[data-run="a"]')!.getAttribute("data-nguon")).toBe("THU_CONG");
    expect(container.querySelector('[data-run="a"]')!.textContent).toMatch(/Người ghi tay.*Người ghi tay — Admin không quan sát được\./); // nhãn ngắn + câu đầy đủ ở dòng riêng (wrap được ở 280 px)
    expect(container.querySelector('[data-run="a"] .basis-full')).not.toBeNull();
    expect(container.querySelector('[data-run="b"] .basis-full')).toBeNull();
    expect(container.querySelector('[data-run="b"]')!.textContent).toMatch(/Hệ thống đo/);
  });
  it("[AIK-UI-BANGCHUNG-02] rỗng ⇒ trạng thái rỗng có hướng dẫn", () => {
    render(<LichSuChay rows={[]} />);
    expect(screen.getByText("Chưa có lần kiểm chứng nào")).toBeInTheDocument();
  });
});

describe("[AIK-UI-CHINHSACH] cổng PROD", () => {
  const cs = (o: Partial<CauHinhView["chinhSach"]> = {}): CauHinhView["chinhSach"] => ({
    prodEnabled: false, consentPolicyStatus: "PENDING_LEGAL", congProd: { allowed: false, reason: "PROD_CHUA_BAT_VA_CHINH_SACH_CHUA_DUYET", thieu: ["ai.prodEnabled", "ai.consentPolicyStatus"] }, ...o,
  });
  it("[AIK-UI-CHINHSACH-01] cổng đóng: nói ĐÓNG + khoá còn thiếu; có quyền ⇒ có nút đổi", () => {
    render(<ChinhSach chinhSach={cs()} coQuyenChinhSach />);
    expect(screen.getByText("Đang ĐÓNG")).toBeInTheDocument();
    expect(screen.getByText(/ai\.prodEnabled, ai\.consentPolicyStatus/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bật cho phép PROD" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đổi trạng thái chính sách…" })).toBeInTheDocument();
  });
  it("[AIK-UI-CHINHSACH-02] không có quyền chính sách ⇒ KHÔNG nút nào, có câu nêu quyền cần xin", () => {
    render(<ChinhSach chinhSach={cs()} coQuyenChinhSach={false} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/ai-leads:policy/)).toBeInTheDocument();
  });
  it("[AIK-UI-CHINHSACH-03] cổng mở không bao giờ vẽ là 'ĐÓNG'; khi mở nút đổi trạng thái đảo chiều", () => {
    render(<ChinhSach chinhSach={cs({ prodEnabled: true, consentPolicyStatus: "APPROVED", congProd: { allowed: true, reason: "OK", thieu: [] } })} coQuyenChinhSach />);
    expect(screen.getByText("Đang MỞ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tắt cho phép PROD" })).toBeInTheDocument();
  });
});

describe("[AIK-UI-CATALOG] xuất bản catalog", () => {
  const vw = (o: Partial<CauHinhView> = {}): CauHinhView => ({
    masterKeyOk: true, agents: [{ id: "agent1", name: "A", environment: "TEST", secretVersion: 1, active: true, contractStatus: "COMPATIBLE", lastHeartbeatAt: null, createdAt: new Date(NOW), moiTruongHopLe: true, pages: [{ pageId: "104500000000777", state: "ENABLED", routingCenterId: null, note: null, nguon: { san: true, groupCode: "MARKETING_HO" } }] }],
    xuatBan: [], coSoChon: [{ id: "c1", code: "CS1", name: "Cơ sở 1" }], lichSu: [], hienHanh: null, hienHanhToanVen: null,
    xemTruoc: { thayDoi: [], payload: { pages: [] }, loi: null }, chinhSach: { prodEnabled: false, consentPolicyStatus: "PENDING_LEGAL", congProd: { allowed: false, reason: "PROD_CHUA_BAT", thieu: [] } }, ...o,
  });
  it("[AIK-UI-CATALOG-TV] bản hiện hành KHÔNG toàn vẹn + nội dung không đổi ⇒ nút Xuất bản BẬT (đường phục hồi) và nói rõ vì sao; toàn vẹn + không đổi ⇒ vẫn KHOÁ; version kế tiếp theo bản MỚI NHẤT kể cả khi nội dung nó không đọc được", () => {
    const snap = { version: 4, publishedAt: new Date(NOW), publishedByName: null, etag: "v4-xxx", soPage: 0, soCoSo: 0 };
    const hong = render(<CoSoCatalog view={vw({ lichSu: [snap], hienHanh: null, hienHanhToanVen: { ok: false, ly: "PAYLOAD_SAI_HOP_DONG" } })} duocSua />);
    expect(screen.getByRole("button", { name: "Xuất bản catalog" })).toBeEnabled();
    expect(screen.queryByText(/Không có thay đổi nào so với bản hiện hành/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Xuất bản catalog" }));
    expect(screen.getByText(/Bản hiện hành KHÔNG toàn vẹn nên Agent đang nhận 503/)).toBeInTheDocument();
    expect(screen.getByText(/Tạo version v5 bất biến/)).toBeInTheDocument();
    hong.unmount();
    render(<CoSoCatalog view={vw({ lichSu: [snap], hienHanhToanVen: { ok: true } })} duocSua />);
    expect(screen.getByRole("button", { name: "Xuất bản catalog" })).toBeDisabled();
  });
  it("[AIK-UI-CATALOG-01] không có thay đổi ⇒ nút Xuất bản KHOÁ kèm lý do bằng chữ", () => {
    render(<CoSoCatalog view={vw()} duocSua />);
    expect(screen.getByRole("button", { name: "Xuất bản catalog" })).toBeDisabled();
    expect(screen.getAllByText(/Không có thay đổi nào so với bản hiện hành/).length).toBeGreaterThan(0);
  });
  it("[AIK-UI-CATALOG-02] có lỗi dựng payload ⇒ hiện lỗi (role=alert) và khoá xuất bản", () => {
    render(<CoSoCatalog view={vw({ xemTruoc: { thayDoi: [], payload: null, loi: 'Cơ sở "X" đã ngừng hoạt động' } })} duocSua />);
    expect(screen.getByRole("alert")).toHaveTextContent('Cơ sở "X" đã ngừng hoạt động');
    expect(screen.getByRole("button", { name: "Xuất bản catalog" })).toBeDisabled();
  });
  it("[AIK-UI-CATALOG-03] có thay đổi ⇒ liệt kê diff và mở nút; không có quyền ⇒ không có nút nào để ghi", () => {
    const co = vw({ xemTruoc: { thayDoi: [{ loai: "THEM_PAGE", pageId: "104500000000777" }], payload: { pages: [] }, loi: null } });
    const { unmount } = render(<CoSoCatalog view={co} duocSua />);
    expect(screen.getByText("Thêm Page 104500000000777")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xuất bản catalog" })).toBeEnabled();
    unmount();
    render(<CoSoCatalog view={co} duocSua={false} />);
    expect(screen.queryByRole("button", { name: "Xuất bản catalog" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Thêm cơ sở/ })).toBeNull();
  });
  it("[AIK-UI-CATALOG-04] lịch sử: bản hiện hành KHÔNG có nút xuất bản lại; bản cũ có", () => {
    const ls = [1, 2].map((n) => ({ version: 3 - n, publishedAt: new Date(NOW), publishedByName: "QT", etag: `v${3 - n}-abc`, soPage: 1, soCoSo: 1 }));
    render(<CoSoCatalog view={vw({ lichSu: ls, hienHanh: { version: 2, payload: { pages: [] } } })} duocSua />);
    expect(screen.getAllByRole("button", { name: "Xuất bản lại bản này" })).toHaveLength(1);
    expect(screen.getByText("Hiện hành")).toBeInTheDocument();
  });
});

describe("[AIK-UI-AGENT] Agent & khoá", () => {
  const ag = (o = {}) => ({ id: "agent1", name: "AI Messenger", environment: "TEST" as const, secretVersion: 3, active: true, contractStatus: "COMPATIBLE" as const, lastHeartbeatAt: null, createdAt: new Date(NOW), moiTruongHopLe: true, pages: [], ...o });
  it("[AIK-UI-AGENT-01] thiếu khoá gốc ⇒ cảnh báo rõ + nút Tạo Agent khoá + nút Tạo lại khoá khoá", () => {
    render(<AgentVaKhoa agents={[ag()]} masterKeyOk={false} congProdMo={false} coQuyenQuanLy testDuocChay />);
    expect(screen.getAllByText(/AI_LEAD_AGENT_MASTER_KEY/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Tạo Agent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tạo lại khoá" })).toBeDisabled();
  });
  it("[AIK-UI-AGENT-02] chọn PROD khi cổng đóng ⇒ VẪN tạo được, kèm câu nói rõ Agent sẽ ra đời ở trạng thái TẮT", () => {
    render(<AgentVaKhoa agents={[]} masterKeyOk congProdMo={false} coQuyenQuanLy testDuocChay />);
    fireEvent.change(screen.getByLabelText("Tên Agent"), { target: { value: "AI Messenger" } });
    expect(screen.getByRole("button", { name: "Tạo Agent" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Môi trường"), { target: { value: "PROD" } });
    expect(screen.getByRole("button", { name: "Tạo Agent" })).toBeEnabled();
    expect(screen.getByText(/Agent sẽ được tạo ở trạng thái/)).toBeInTheDocument();
  });
  it("[AIK-UI-AGENT-03] tạo Agent thành công ⇒ hộp khoá hiện khoá MỘT lần; danh sách KHÔNG chứa khoá sau khi đóng", async () => {
    hanhDong.taoAgentAction!.mockResolvedValueOnce({ ok: true, agentId: "cm0abcdefghijklmnopqrstuv", name: "AI Messenger", environment: "TEST", secretVersion: 1, agentSecret: KHOA, baseUrl: "" });
    render(<AgentVaKhoa agents={[]} masterKeyOk congProdMo coQuyenQuanLy testDuocChay />);
    fireEvent.change(screen.getByLabelText("Tên Agent"), { target: { value: "AI Messenger" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tạo Agent" }));
    });
    expect(document.body.textContent).toContain(KHOA);
    fireEvent.click(screen.getByRole("button", { name: "Chép Khoá (agentSecret)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Đã chép — đóng" }));
    await waitFor(() => expect(document.body.textContent).not.toContain(KHOA));
  });
  it("[AIK-UI-AGENT-04] không có quyền quản lý ⇒ không form tạo, không nút nguy hiểm; có chú thích quyền", () => {
    render(<AgentVaKhoa agents={[ag()]} masterKeyOk congProdMo coQuyenQuanLy={false} testDuocChay />);
    expect(screen.queryByRole("button", { name: "Tạo Agent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tạo lại khoá" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tắt Agent/ })).toBeNull();
    expect(screen.getByText(/ai-integration:manage/)).toBeInTheDocument();
  });
  it("[AIK-UI-AGENT-05] Agent đã tắt ⇒ hiện nhãn ĐÃ TẮT và nút 'Bật lại Agent' (không còn nút tắt)", () => {
    render(<AgentVaKhoa agents={[ag({ active: false })]} masterKeyOk congProdMo coQuyenQuanLy testDuocChay />);
    expect(screen.getByText("ĐÃ TẮT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bật lại Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tắt Agent/ })).toBeNull();
  });

  // FIX-03
  it("[AIK-UI-AGENT-06] hệ thống PROD (testDuocChay=false): ô Môi trường KHÔNG có TEST, mặc định PROD, có câu giải thích", () => {
    render(<AgentVaKhoa agents={[]} masterKeyOk congProdMo coQuyenQuanLy testDuocChay={false} />);
    const o = screen.getByLabelText("Môi trường") as HTMLSelectElement;
    expect([...o.options].map((x) => x.value)).toEqual(["PROD"]);
    expect(o.value).toBe("PROD");
    expect(screen.getByText(/không tạo được Agent TEST/)).toBeInTheDocument();
  });
  it("[AIK-UI-AGENT-06b] đối chứng dương: máy chủ TEST ⇒ có cả TEST và PROD, mặc định TEST, không câu giải thích", () => {
    render(<AgentVaKhoa agents={[]} masterKeyOk congProdMo coQuyenQuanLy testDuocChay />);
    const o = screen.getByLabelText("Môi trường") as HTMLSelectElement;
    expect([...o.options].map((x) => x.value)).toEqual(["TEST", "PROD"]);
    expect(o.value).toBe("TEST");
    expect(screen.queryByText(/không tạo được Agent TEST/)).toBeNull();
  });
  it("[AIK-UI-AGENT-07] Agent TEST trên PROD (đang bật): cảnh báo + nhãn KHÔNG HỢP LỆ + nút dọn; KHÔNG hứa 'Bật lại'; dọn gọi action với lý do", async () => {
    render(<AgentVaKhoa agents={[ag({ moiTruongHopLe: false })]} masterKeyOk congProdMo coQuyenQuanLy testDuocChay={false} />);
    expect(screen.getByText(/1 Agent TEST đang nằm trên hệ thống PROD/)).toBeInTheDocument();
    expect(screen.getByText("KHÔNG HỢP LỆ TRÊN PROD")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vô hiệu hoá Agent TEST trên PROD" }));
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "Dọn Agent TEST trên PROD theo FIX-03" } });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Vô hiệu hoá" }).at(-1)!);
    });
    expect(hanhDong.voHieuHoaAgentTestTrenProdAction).toHaveBeenCalledWith({ lyDo: "Dọn Agent TEST trên PROD theo FIX-03" });
  });
  it("[AIK-UI-AGENT-08] Agent TEST trên PROD đã TẮT: có cảnh báo nhưng không nút dọn (không còn gì để tắt) và không nút 'Bật lại'; nói rõ lý do", () => {
    render(<AgentVaKhoa agents={[ag({ moiTruongHopLe: false, active: false })]} masterKeyOk congProdMo coQuyenQuanLy testDuocChay={false} />);
    expect(screen.getByText(/1 Agent TEST đang nằm trên hệ thống PROD/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vô hiệu hoá Agent TEST trên PROD" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bật lại Agent" })).toBeNull();
    expect(screen.getByText(/Không bật lại được/)).toBeInTheDocument();
  });
  it("[AIK-UI-AGENT-09] người chỉ-xem thấy cảnh báo nhưng KHÔNG có nút dọn; Agent hợp lệ ⇒ không cảnh báo", () => {
    render(<AgentVaKhoa agents={[ag({ moiTruongHopLe: false })]} masterKeyOk congProdMo coQuyenQuanLy={false} testDuocChay={false} />);
    expect(screen.getByText(/1 Agent TEST đang nằm trên hệ thống PROD/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vô hiệu hoá Agent TEST trên PROD" })).toBeNull();
    cleanup();
    render(<AgentVaKhoa agents={[ag()]} masterKeyOk congProdMo coQuyenQuanLy testDuocChay />);
    expect(screen.queryByText(/đang nằm trên hệ thống PROD/)).toBeNull();
  });
});

describe("[AIK-UI-LYDO-QA3] nút mở hộp lý do có nhãn DÀI không được ép khung rộng hơn màn 280px", () => {
  it("nút mặc định cho xuống dòng (whitespace-normal), cao tự do (h-auto) và không vượt khung (max-w-full) — đo 28/10: «Vô hiệu hoá Agent TEST trên PROD» làm thẻ tràn 297px > 248px", () => {
    render(<NutLyDo nhan="Vô hiệu hoá Agent TEST trên PROD" tieuDe="t" moTa="m" nhanXacNhan="OK" chay={async () => ({ ok: true })} />);
    const cls = screen.getByRole("button", { name: "Vô hiệu hoá Agent TEST trên PROD" }).className.split(/\s+/);
    for (const c of ["whitespace-normal", "h-auto", "max-w-full", "min-h-11"]) expect(cls).toContain(c);
    expect(cls).not.toContain("whitespace-nowrap");
  });
});
