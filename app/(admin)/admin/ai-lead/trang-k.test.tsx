// @vitest-environment jsdom
// [AIK-TRANG] Hai trang Server Component của lát K: cổng đăng nhập + quyền, chọn mục bằng ?tab=, nút nào hiện theo quyền, lỗi đọc dữ liệu hiện ErrorState.
// (Mục "Sự cố"/"Bằng chứng" là component async con — RTL không render được; phần logic của chúng nằm ở ket-noi.ts + DB test.)
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, checkAnyPermission, checkPermission, resolveActor, redirect, docCauHinh, docTrungTamKetNoi } = vi.hoisted(() => ({
  auth: vi.fn(),
  checkAnyPermission: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  docCauHinh: vi.fn(),
  docTrungTamKetNoi: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/auth/check-permission", () => ({ checkAnyPermission: (...a: unknown[]) => checkAnyPermission(...a), checkPermission: (...a: unknown[]) => checkPermission(...a) }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: (...a: unknown[]) => resolveActor(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/ai-lead/dich-vu/cau-hinh", () => ({ docCauHinh: () => docCauHinh(), docQuyTacTuTao: async () => ({ toanHe: false, batTheo: [] }) }));
vi.mock("@/lib/ai-lead/dich-vu/ket-noi", () => ({
  docTrungTamKetNoi: (...a: unknown[]) => docTrungTamKetNoi(...a),
  docSuCo: vi.fn(),
  docNguoiXuLy: vi.fn(),
  docLichSuChay: vi.fn(),
  SO_SU_CO_MOI_TRANG: 25,
}));
vi.mock("./cau-hinh/_actions", () => ({}));
vi.mock("./ket-noi/_actions", () => ({}));

import { tinhTrangKetNoi, HASH_HOP_DONG_HIEN_HANH } from "@/lib/ai-lead/dich-vu/ket-noi-thuan";
import CauHinhAiLeadPage from "./cau-hinh/page";
import KetNoiAiLeadPage from "./ket-noi/page";

const NOW = new Date("2026-11-08T03:00:00.000Z");

function quyen(co: string[]) {
  checkPermission.mockImplementation(async (a: string) => co.includes(a));
}
const viewCauHinh = (o = {}) => ({
  masterKeyOk: true,
  agents: [{ id: "agent1", name: "AI Messenger", environment: "TEST", secretVersion: 1, active: true, contractStatus: "COMPATIBLE", lastHeartbeatAt: null, createdAt: NOW, pages: [] }],
  xuatBan: [], coSoChon: [], lichSu: [], hienHanh: null,
  xemTruoc: { thayDoi: [], payload: { pages: [] }, loi: null },
  chinhSach: { prodEnabled: false, consentPolicyStatus: "PENDING_LEGAL", congProd: { allowed: false, reason: "PROD_CHUA_BAT", thieu: ["ai.prodEnabled"] } },
  ...o,
});
function viewKetNoi(): unknown {
  const tongHop = tinhTrangKetNoi({
    now: NOW.getTime(), nguongMatKetNoiMs: 180_000, nguongNgatKetNoiMs: 86_400_000, ttlKiemChungMs: 604_800_000, hashHopDongHienHanh: HASH_HOP_DONG_HIEN_HANH, congProd: { allowed: true, thieu: [] },
    agent: { active: true, environment: "TEST", moiTruongHopLe: true, contractStatus: "COMPATIBLE", lastHeartbeatAt: new Date(NOW.getTime() - 1000), lastBuildSha: "abc1234", lastContractHash: HASH_HOP_DONG_HIEN_HANH },
    pageIdsHienTai: [], lanChay: [], suCoMo: { tong: 0, nghiemTrongNhat: null },
  });
  return {
    bayGio: NOW, masterKeyOk: true, hashHienHanh: HASH_HOP_DONG_HIEN_HANH, congProd: { allowed: true, thieu: [] }, nguongMatKetNoiMs: 180_000, catalogMoiNhat: null, catalogToanVen: null, thongBaoLoi24h: 0, tuChoiChuaXacThuc: { bat: false, chuaXacThuc: null },
    agents: [{
      agent: { id: "agent1", name: "AI Messenger", environment: "TEST", active: true, contractStatus: "COMPATIBLE", secretVersion: 1, lastAgentVersion: "1.0.0", lastBuildSha: "abc1234", lastContractHash: HASH_HOP_DONG_HIEN_HANH, lastHeartbeatAt: new Date(NOW.getTime() - 1000) },
      tongHop, pages: [], catalog: { daThay: null, moiNhat: null, tre: null }, luuLuong24h: { tong: 0, loi: 0 }, hoSo: { cho: 0, dangXuLy: 0, quaHan: 0 }, suCoMo: { tong: 0, nghiemTrongNhat: null },
      thamDo: { dangMo: null, ackGanNhat: null }, chayGanDay: [],
    }],
  };
}

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "u1" } });
  checkAnyPermission.mockResolvedValue(true);
  resolveActor.mockResolvedValue({ userId: "u1" });
  quyen(["ai-integration:view", "ai-integration:manage", "ai-leads:configure", "ai-leads:policy"]);
  docCauHinh.mockResolvedValue(viewCauHinh());
  docTrungTamKetNoi.mockResolvedValue(viewKetNoi());
});

const sp = (tab?: string) => Promise.resolve(tab ? { tab } : {});

describe("[AIK-TRANG] cổng", () => {
  it("[AIK-TRANG-01] chưa đăng nhập ⇒ về /login, không đọc dữ liệu", async () => {
    auth.mockResolvedValue(null);
    await expect(CauHinhAiLeadPage({ searchParams: sp() })).rejects.toThrow("REDIRECT:/login?callbackUrl=%2Fai-lead%2Fcau-hinh");
    await expect(KetNoiAiLeadPage({ searchParams: sp() })).rejects.toThrow("REDIRECT:/login?callbackUrl=%2Fai-lead%2Fket-noi");
    expect(docCauHinh).not.toHaveBeenCalled();
    expect(docTrungTamKetNoi).not.toHaveBeenCalled();
  });
  it("[AIK-TRANG-02] thiếu quyền vào trang ⇒ về dashboard?error=unauthorized, không đọc dữ liệu; cổng hỏi ĐÚNG khoá của PAGE_GATES", async () => {
    checkAnyPermission.mockResolvedValue(false);
    await expect(CauHinhAiLeadPage({ searchParams: sp() })).rejects.toThrow("REDIRECT:/dashboard?error=unauthorized");
    await expect(KetNoiAiLeadPage({ searchParams: sp() })).rejects.toThrow("REDIRECT:/dashboard?error=unauthorized");
    expect(checkAnyPermission).toHaveBeenNthCalledWith(1, ["ai-leads:configure"]);
    expect(checkAnyPermission).toHaveBeenNthCalledWith(2, ["ai-integration:view"]);
    expect(docCauHinh).not.toHaveBeenCalled();
    expect(docTrungTamKetNoi).not.toHaveBeenCalled();
  });
});

describe("[AIK-TRANG] Cấu hình", () => {
  it("[AIK-TRANG-10] mặc định mở mục 'Agent & khoá' (đủ quyền): có form tạo Agent", async () => {
    render(await CauHinhAiLeadPage({ searchParams: sp() }));
    expect(screen.getByRole("link", { name: "Agent & khoá" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("form", { name: "Tạo Agent mới" })).toBeInTheDocument();
  });
  it("[AIK-TRANG-11] ?tab=chinh-sach mở đúng mục; mục không hợp lệ rơi về mục đầu", async () => {
    render(await CauHinhAiLeadPage({ searchParams: sp("chinh-sach") }));
    expect(screen.getByRole("link", { name: "Chính sách & cổng PROD" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Cổng PROD")).toBeInTheDocument();
    cleanup();
    render(await CauHinhAiLeadPage({ searchParams: sp("khong-co") }));
    expect(screen.getByRole("link", { name: "Agent & khoá" })).toHaveAttribute("aria-current", "page");
  });
  it("[AIK-TRANG-12] người chỉ có ai-leads:configure (không xem kết nối) ⇒ mục 'Agent & khoá' VẮNG, mặc định rơi vào 'Page'", async () => {
    quyen(["ai-leads:configure"]);
    render(await CauHinhAiLeadPage({ searchParams: sp() }));
    expect(screen.queryByRole("link", { name: "Agent & khoá" })).toBeNull();
    expect(screen.getByRole("link", { name: "Page" })).toHaveAttribute("aria-current", "page");
    cleanup();
    render(await CauHinhAiLeadPage({ searchParams: sp("agent") })); // gõ tay ?tab=agent cũng không mở được
    expect(screen.queryByRole("form", { name: "Tạo Agent mới" })).toBeNull();
  });
  it("[AIK-TRANG-13] Marketing (xem kết nối, không quản lý): thấy mục Agent nhưng KHÔNG có form tạo / nút nguy hiểm", async () => {
    quyen(["ai-integration:view", "ai-leads:configure"]);
    render(await CauHinhAiLeadPage({ searchParams: sp("agent") }));
    expect(screen.queryByRole("form", { name: "Tạo Agent mới" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tạo lại khoá" })).toBeNull();
    expect(screen.getByText(/ai-integration:manage/)).toBeInTheDocument();
  });
  it("[AIK-TRANG-14] đọc dữ liệu lỗi ⇒ ErrorState có đường thử lại, trang không sập", async () => {
    docCauHinh.mockRejectedValue(new Error("db sập"));
    render(await CauHinhAiLeadPage({ searchParams: sp() }));
    expect(screen.getByText("Không tải được dữ liệu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tải lại" })).toHaveAttribute("href", expect.stringMatching(/^\?tab=(agent|page)$/)); // câu lỗi nói «tải lại trang» ⇒ phải có nút làm việc đó (điện thoại không có F5 dễ)
  });
  it("[AIK-TRANG-15] mục 'Chính sách': chỉ người có ai-leads:policy thấy nút đổi", async () => {
    quyen(["ai-integration:view", "ai-integration:manage", "ai-leads:configure"]);
    render(await CauHinhAiLeadPage({ searchParams: sp("chinh-sach") }));
    expect(screen.queryByRole("button", { name: "Bật cho phép PROD" })).toBeNull();
    cleanup();
    quyen(["ai-integration:view", "ai-leads:configure", "ai-leads:policy"]);
    render(await CauHinhAiLeadPage({ searchParams: sp("chinh-sach") }));
    expect(screen.getByRole("button", { name: "Bật cho phép PROD" })).toBeInTheDocument();
  });
});

describe("[AIK-TRANG] Trung tâm kết nối", () => {
  it("[AIK-TRANG-20] tổng quan: thẻ Agent + nút ghi nhận lần kiểm chứng (đủ quyền); nhãn KHÔNG xanh khi chưa có bằng chứng", async () => {
    const { container } = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(screen.getByRole("link", { name: "Tổng quan" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("AI Messenger")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ghi nhận lần kiểm chứng…" })).toBeInTheDocument();
    expect(container.querySelector('[data-xanh="true"]')).toBeNull();
  });
  it("[AIK-TRANG-20b] đếm thông báo gửi LỖI 24h: 0 ⇒ nói 0; N>0 ⇒ nêu N và chỉ chỗ tra; không đọc được ⇒ nói không đọc được (KHÔNG in 0)", async () => {
    const dong = (c: HTMLElement) => c.querySelector("[data-thong-bao-loi]")!;
    const a = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(dong(a.container).textContent).toMatch(/24 giờ:\s*0$/);
    a.unmount();
    docTrungTamKetNoi.mockResolvedValue({ ...(viewKetNoi() as Record<string, unknown>), thongBaoLoi24h: 3 });
    const b = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(dong(b.container).textContent).toMatch(/3 lần ghi nhận .* nhân viên có thể chưa nhận được chuông/);
    b.unmount();
    docTrungTamKetNoi.mockResolvedValue({ ...(viewKetNoi() as Record<string, unknown>), thongBaoLoi24h: null });
    const c = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(dong(c.container).textContent).toMatch(/không đọc được số liệu/);
    expect(dong(c.container).textContent).not.toMatch(/:\s*0/);
  });
  it("[AIK-TRANG-20b] dòng «bị từ chối khi chưa xác thực được»: cờ TẮT ⇒ «chưa đo» (không phải 0); BẬT ⇒ số + mã; BẬT mà đọc lỗi ⇒ «không đọc được»", async () => {
    quyen(["ai-integration:view"]);
    const dong = (c: HTMLElement) => c.querySelector("[data-tu-choi-chua-xac-thuc]")!;
    const a = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(dong(a.container).getAttribute("data-tu-choi-chua-xac-thuc")).toBe("chua-do");
    expect(dong(a.container).textContent).toMatch(/chưa đo — bộ đếm đang TẮT/);
    expect(dong(a.container).textContent).not.toMatch(/:\s*0/);
    a.unmount();
    docTrungTamKetNoi.mockResolvedValue({ ...(viewKetNoi() as Record<string, unknown>), tuChoiChuaXacThuc: { bat: true, chuaXacThuc: { tong: 14, theoMa: [{ ma: "BAD_SIGNATURE", n: 12 }, { ma: "BAD_REQUEST", n: 2 }] } } });
    const b = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(dong(b.container).getAttribute("data-tu-choi-chua-xac-thuc")).toBe("14");
    expect(dong(b.container).textContent).toMatch(/14 — BAD_SIGNATURE ×12, BAD_REQUEST ×2/);
    b.unmount();
    docTrungTamKetNoi.mockResolvedValue({ ...(viewKetNoi() as Record<string, unknown>), tuChoiChuaXacThuc: { bat: true, chuaXacThuc: null } });
    const c = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(dong(c.container).getAttribute("data-tu-choi-chua-xac-thuc")).toBe("khong-doc-duoc");
    expect(dong(c.container).textContent).toMatch(/không đọc được số liệu/);
    c.unmount();
    docTrungTamKetNoi.mockResolvedValue({ ...(viewKetNoi() as Record<string, unknown>), tuChoiChuaXacThuc: { bat: true, chuaXacThuc: { tong: 0, theoMa: [] } } });
    const d = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(dong(d.container).textContent).toMatch(/\(hôm nay \+ hôm qua\):\s*0$/);
  });
  it("[AIK-TRANG-20c] snapshot catalog KHÔNG toàn vẹn ⇒ cảnh báo role=alert nêu lý do và hậu quả (Agent nhận 503); toàn vẹn / chưa xuất bản ⇒ không có cảnh báo", async () => {
    quyen(["ai-integration:view"]);
    const co = () => document.querySelector("[data-catalog-toan-ven]");
    const a = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(co()).toBeNull();
    a.unmount();
    docTrungTamKetNoi.mockResolvedValue({ ...(viewKetNoi() as Record<string, unknown>), catalogMoiNhat: 4, catalogToanVen: { ok: true } });
    const b = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(co()).toBeNull();
    b.unmount();
    docTrungTamKetNoi.mockResolvedValue({ ...(viewKetNoi() as Record<string, unknown>), catalogMoiNhat: 4, catalogToanVen: { ok: false, ly: "ETAG_LECH" } });
    const c = render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(co()!.getAttribute("role")).toBe("alert");
    expect(co()!.textContent).toMatch(/v4.*KHÔNG toàn vẹn.*etag không khớp.*503/);
    c.unmount();
    docTrungTamKetNoi.mockResolvedValue({ ...(viewKetNoi() as Record<string, unknown>), catalogMoiNhat: 4, catalogToanVen: { ok: false, ly: "PAYLOAD_SAI_HOP_DONG" } });
    render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(co()!.textContent).toMatch(/không còn đúng hợp đồng/);
  });
  it("[AIK-TRANG-21] chỉ có quyền xem ⇒ thấy trạng thái, KHÔNG có nút hành động nào", async () => {
    quyen(["ai-integration:view"]);
    render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(screen.getByText("AI Messenger")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ghi nhận lần kiểm chứng…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kiểm tra kết nối" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tắt Agent" })).toBeNull();
  });
  it("[AIK-TRANG-22] chưa có Agent ⇒ trạng thái rỗng có đường đi; đọc lỗi ⇒ ErrorState", async () => {
    docTrungTamKetNoi.mockResolvedValue({ ...(viewKetNoi() as object), agents: [] });
    render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(screen.getByText("Chưa có Agent nào")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cấu hình AI Lead" })).toHaveAttribute("href", "/ai-lead/cau-hinh?tab=agent");
    cleanup();
    docTrungTamKetNoi.mockRejectedValue(new Error("db sập"));
    render(await KetNoiAiLeadPage({ searchParams: sp() }));
    expect(screen.getByText("Không tải được dữ liệu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tải lại" })).toHaveAttribute("href", "?tab=tong-quan");
  });
});

describe("[AIK-LOAD] khung chờ của Cấu hình / Kết nối nhìn thấy được và có tên", () => {
  it("[AIK-LOAD-01] khối xương dùng bg-border (nền admin #f5f5f5 = --muted nên bg-muted VÔ HÌNH — đo 28/10/2026) và vùng có role=status + tên", async () => {
    const { default: CauHinhLoading } = await import("./cau-hinh/loading");
    const { default: KetNoiLoading } = await import("./ket-noi/loading");
    for (const [Man, ten] of [[CauHinhLoading, "Đang tải cấu hình…"], [KetNoiLoading, "Đang tải trung tâm kết nối…"]] as const) {
      const { container } = render(<Man />);
      expect(screen.getByRole("status", { name: ten })).toBeInTheDocument();
      expect(container.innerHTML).not.toMatch(/bg-muted/);
      expect(container.querySelectorAll(".bg-border, [class*='bg-border/']").length).toBeGreaterThan(5);
      cleanup();
    }
  });
});
