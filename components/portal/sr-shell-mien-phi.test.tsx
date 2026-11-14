// @vitest-environment jsdom
/**
 * [MP-*] — gói MIỄN PHÍ của cổng phụ huynh (08/11/2026): «Sức khỏe cả nhà» + «Tủ sách gia đình» hiện theo CỜ RIÊNG, cả khi chưa có bé.
 * Vỏ DỰNG THẬT, đọc phần tử — trừ [MP-W*] ghim dây nối vì layout là server component.
 *   [MP-01] có bé: cả hai mục xuất hiện khi cờ bật; thứ tự DISC → Sức khỏe → Tủ sách
 *   [MP-02] đối chứng ÂM: tắt cờ nào thì mục đó biến mất (cờ kia KHÔNG kéo theo) — mục này không "đạt" chỉ vì cả hai cùng tắt
 *   [MP-03] chưa có bé: menu chỉ còn các mục miễn phí đang bật, không mục học tập nào; logo dẫn tới mục miễn phí ĐẦU TIÊN (không trỏ trang chết)
 *   [MP-04] chưa có bé + mọi cờ tắt: không còn mục nào, logo về /portal
 *   [MP-W1] layout truyền ĐỦ cờ cho cả vỏ v2 lẫn vỏ v1 và tính cờ ở SERVER (cờ ∧ PARENT)
 *   [MP-W2] hai trang + hai route API đi qua cổng chung `phien-mien-phi` với ĐÚNG cờ của chính chúng, không import `@/lib/db` trực tiếp
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/chat/use-chat-unread", () => ({ useChatUnread: (_id: string, n: number) => n }));
vi.mock("@/lib/auth/logout-client", () => ({ logoutToGate: () => undefined }));
vi.mock("@/components/portal/use-set-active-site", () => ({ useSetActiveSite: () => ({ pending: false, switchTo: vi.fn() }) }));
vi.mock("@/components/portal/appearance-provider", () => ({
  usePortalAppearance: () => ({ isDark: false, setTheme: () => undefined, mounted: true }),
}));
vi.mock("@/components/public/dai-link-phap-ly", () => ({ DaiLinkPhapLy: () => null }));

import { SrShell } from "@/components/portal/sr-shell";

afterEach(cleanup);

const CON = [{ id: "c1", name: "Hồ Hữu Huy", initials: "HH", courseName: "Sata3", active: true }];

function dung(o: { coHocTap: boolean; coDisc?: boolean; coTuSach: boolean; coSucKhoe: boolean }) {
  render(
    <SrShell
      soKhuyenMaiMoi={0}
      quyDinhNgay={null}
      userId="u1"
      parentName="Phụ huynh"
      notifCount={0}
      coGioiThieu={false}
      coBaiTap={false}
      coDisc={o.coDisc ?? false}
      coTuSach={o.coTuSach}
      coSucKhoe={o.coSucKhoe}
      coHocTap={o.coHocTap}
      switcherChildren={o.coHocTap ? CON : []}
    >
      <p>nội dung</p>
    </SrShell>,
  );
  return within(screen.getByRole("complementary", { name: "Menu cổng phụ huynh" }));
}
const duongDan = (v: ReturnType<typeof within>): string[] =>
  v
    .queryAllByRole("link")
    .filter((a: HTMLElement) => !(a.getAttribute("aria-label") ?? "").includes("Trang chủ"))
    .map((a: HTMLElement) => a.getAttribute("href") ?? "")
    .filter((h: string) => h === "/portal" || h.startsWith("/portal/"));
const logo = () => screen.getAllByRole("link").find((a: HTMLElement) => (a.getAttribute("aria-label") ?? "").includes("Trang chủ"))?.getAttribute("href");

describe("[MP-01] có bé", () => {
  // 12/11/2026 — ba mục rời (DISC · Sức khỏe · Tủ sách) gộp thành «Quà tặng» + «Khuyến mãi».
  it("mọi cờ bật ⇒ chỉ thấy «Quà tặng» rồi «Khuyến mãi»; KHÔNG còn ba mục rời", () => {
    const menu = dung({ coHocTap: true, coDisc: true, coTuSach: true, coSucKhoe: true });
    const d = duongDan(menu);
    expect(d).toContain("/portal/qua-tang");
    expect(d).toContain("/portal/khuyen-mai");
    expect(d.indexOf("/portal/qua-tang")).toBeLessThan(d.indexOf("/portal/khuyen-mai"));
    for (const roi of ["/portal/disc", "/portal/suc-khoe", "/portal/tu-sach"]) expect(d, roi).not.toContain(roi);
  });
});

describe("[MP-02] đối chứng ÂM — từng cờ riêng lẻ", () => {
  it("chỉ MỘT cờ bật vẫn đủ mở hộp quà; tắt hết ⇒ hộp quà biến mất", () => {
    let d = duongDan(dung({ coHocTap: true, coTuSach: false, coSucKhoe: true }));
    expect(d).toContain("/portal/qua-tang");
    cleanup();
    d = duongDan(dung({ coHocTap: true, coTuSach: true, coSucKhoe: false }));
    expect(d).toContain("/portal/qua-tang");
    cleanup();
    d = duongDan(dung({ coHocTap: true, coDisc: true, coTuSach: false, coSucKhoe: false }));
    expect(d).toContain("/portal/qua-tang");
    cleanup();
    d = duongDan(dung({ coHocTap: true, coTuSach: false, coSucKhoe: false }));
    expect(d).not.toContain("/portal/qua-tang");
    expect(d).not.toContain("/portal/khuyen-mai");
  });
});

describe("[MP-03] chưa có bé", () => {
  it("chỉ còn «Quà tặng» + «Khuyến mãi»; logo dẫn tới «Quà tặng»", () => {
    const menu = dung({ coHocTap: false, coDisc: false, coTuSach: true, coSucKhoe: true });
    expect(duongDan(menu)).toEqual(["/portal/qua-tang", "/portal/khuyen-mai"]);
    expect(logo()).toBe("/portal/qua-tang");
  });
  it("chỉ Tủ sách bật ⇒ vẫn là hộp quà (một quà bên trong), không mục rời", () => {
    const menu = dung({ coHocTap: false, coTuSach: true, coSucKhoe: false });
    expect(duongDan(menu)).toEqual(["/portal/qua-tang", "/portal/khuyen-mai"]);
    expect(logo()).toBe("/portal/qua-tang");
  });
});

describe("[MP-04] chưa có bé + mọi cờ tắt", () => {
  it("không còn mục nào; logo về /portal", () => {
    const menu = dung({ coHocTap: false, coTuSach: false, coSucKhoe: false });
    expect(duongDan(menu)).toEqual([]);
    expect(logo()).toBe("/portal");
  });
});

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[MP-W1] dây nối layout → vỏ", () => {
  const layout = doc("app/(portal)/portal/layout.tsx");
  it("cờ tính ở SERVER = cờ ∧ PARENT; mỗi vỏ nhận đủ hai cờ", () => {
    expect(dem(layout, /const coTuSach = isTuSachEnabled\(\) && session\.user\.role === "PARENT";/g)).toBe(1);
    expect(dem(layout, /const coSucKhoe = isSucKhoeEnabled\(\) && session\.user\.role === "PARENT";/g)).toBe(1);
    expect(dem(layout, /coTuSach=\{coTuSach\}/g)).toBe(2); // PortalV2Shell + PortalNav
    expect(dem(layout, /coSucKhoe=\{coSucKhoe\}/g)).toBe(2);
    // Đoạn đầu URL được xem khi chưa có bé CHỈ vào mảng khi cờ bật.
    // 12/11/2026: thêm «qua-tang» + «khuyen-mai» khi hộp quà mở (≥ 1 cờ bật).
    expect(dem(layout, /\[\.\.\.\(coTuSach \? \["tu-sach"\] : \[\]\), \.\.\.\(coSucKhoe \? \["suc-khoe"\] : \[\]\), \.\.\.\(coHopQua \? \["qua-tang", "khuyen-mai"\] : \[\]\)\]/g)).toBe(1);
  });
  it("vỏ v2 truyền xuống SrShell; PortalNav và SrShell khai cờ BẮT BUỘC (luật 11)", () => {
    const v2 = doc("components/portal/v2-shell.tsx");
    expect(dem(v2, /coTuSach=\{coTuSach\}/g)).toBe(1);
    expect(dem(v2, /coSucKhoe=\{coSucKhoe\}/g)).toBe(1);
    for (const f of ["components/portal/v2-shell.tsx", "components/portal/sr-shell.tsx", "app/(portal)/portal/_components/portal-nav.tsx"]) {
      const s = doc(f);
      expect(dem(s, /\bcoTuSach: boolean;/g), `${f}: coTuSach bắt buộc`).toBe(1);
      expect(dem(s, /\bcoSucKhoe: boolean;/g), `${f}: coSucKhoe bắt buộc`).toBe(1);
      expect(dem(s, /\bcoTuSach\?:|\bcoSucKhoe\?:/g), `${f}: không được tuỳ chọn`).toBe(0);
    }
  });
});

describe("[MP-W2] trang + route API", () => {
  const CAC_TRANG: [string, string][] = [
    ["app/(portal)/portal/tu-sach/page.tsx", "isTuSachEnabled"],
    ["app/(portal)/portal/suc-khoe/page.tsx", "isSucKhoeEnabled"],
  ];
  it("trang: cổng chung với ĐÚNG cờ của nó, đứng TRƯỚC mọi việc khác; không import @/lib/db", () => {
    for (const [f, co] of CAC_TRANG) {
      const s = doc(f);
      expect(dem(s, new RegExp(`await yeuCauPhienMienPhi\\(${co}\\(\\)\\)`, "g")), f).toBe(1);
      expect(dem(s, /@\/lib\/db\b/g), `${f}: cổng DB`).toBe(0);
      expect(s, f).toMatch(/export const dynamic = "force-dynamic";/);
    }
  });
  it("route API: cờ TU_SACH_ENABLED đọc TRƯỚC phiên; userId từ phiên", () => {
    for (const f of ["app/api/portal/tu-sach/tai/[so]/route.ts", "app/api/portal/tu-sach/phuong/route.ts"]) {
      const s = doc(f);
      expect(dem(s, /await docPhienMienPhi\(isTuSachEnabled\(\)\)/g), f).toBe(1);
      expect(dem(s, /phien\.userId/g), f).toBeGreaterThan(0);
      expect(dem(s, /@\/lib\/db\b/g), `${f}: cổng DB`).toBe(0);
    }
  });
});
