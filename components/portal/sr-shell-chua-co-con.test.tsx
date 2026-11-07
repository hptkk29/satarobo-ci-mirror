// @vitest-environment jsdom
/**
 * [CHC-*] — khách làm DISC nhưng CHƯA đăng ký học (chưa có bé nào gắn tài khoản) vào cổng phụ huynh (05/11/2026):
 * vỏ phụ huynh phải ẨN mọi mục học tập / khoá học / học phí / bé, chỉ còn lối vào DISC. Có bé ⇒ menu đầy đủ trở lại.
 * Vỏ DỰNG THẬT, đọc phần tử (không đọc mã nguồn) — trừ [CHC-05] ghim dây nối vì layout là server component.
 *   [CHC-01] chưa có bé + DISC bật: menu bên chỉ có «Khám phá DISC»; KHÔNG còn mục học tập; không có thẻ chọn con
 *   [CHC-02] đối chứng DƯƠNG: có bé ⇒ đủ mục học tập + thẻ chọn con (để ca trên không đạt vì lý do sai)
 *   [CHC-03] chưa có bé + DISC tắt: không còn mục điều hướng nào, nhưng vẫn có «Đăng xuất»
 *   [CHC-04] thanh tab điện thoại: chỉ DISC + «Thêm», không còn tab «Lịch học» / «Hình ảnh» / «Tin nhắn»
 *   [CHC-06] logo không trỏ vào trang chết: chưa có bé + DISC ⇒ /portal/disc; còn lại ⇒ /portal
 *   [CHC-05] dây nối layout → PortalV2Shell → SrShell cùng truyền `coHocTap` (quên = menu cũ hiện cho khách DISC, câm)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/disc",
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

/** Mọi mục gắn với việc học của một bé — chưa đăng ký thì KHÔNG được thấy ở menu. So theo ĐƯỜNG DẪN (nhãn có thể đổi). */
const MUC_HOC_TAP = [
  "/portal",
  "/portal/ket-qua",
  "/portal/lich",
  "/portal/hinh-anh",
  "/portal/nhan-xet",
  "/portal/yeu-cau",
  "/portal/hoc-phi",
  "/portal/tin-nhan",
  "/portal/thong-bao",
  "/portal/khao-sat",
  "/portal/ho-so",
] as const;

const CON = [{ id: "c1", name: "Hồ Hữu Huy", initials: "HH", courseName: "Sata3", active: true }];

function dung(opts: { coHocTap: boolean; coDisc: boolean }) {
  render(
    <SrShell
      userId="u1"
      parentName="Phụ huynh"
      notifCount={0}
      coGioiThieu={false}
      coBaiTap={false}
      coDisc={opts.coDisc}
      coHocTap={opts.coHocTap}
      switcherChildren={opts.coHocTap ? CON : []}
    >
      <p>nội dung</p>
    </SrShell>,
  );
  return {
    menuBen: within(screen.getByRole("complementary", { name: "Menu cổng phụ huynh" })),
    thanhTab: within(screen.getByRole("navigation", { name: "Điều hướng chính" })),
  };
}

/** Đường dẫn các MỤC điều hướng của cổng trong một vùng (bỏ Logo — có ca riêng [CHC-06] — và số hotline `tel:`). */
function duongDan(vung: ReturnType<typeof within>): string[] {
  return vung
    .queryAllByRole("link")
    .filter((a: HTMLElement) => !(a.getAttribute("aria-label") ?? "").includes("Trang chủ"))
    .map((a: HTMLElement) => a.getAttribute("href") ?? "")
    .filter((h: string) => h === "/portal" || h.startsWith("/portal/"));
}
const coMuc = (vung: ReturnType<typeof within>, href: string) => duongDan(vung).includes(href);

describe("[CHC-01] chưa có bé + DISC bật", () => {
  it("menu bên chỉ còn «Khám phá DISC»; không mục học tập nào; không thẻ chọn con", () => {
    const { menuBen } = dung({ coHocTap: false, coDisc: true });
    expect(coMuc(menuBen, "/portal/disc")).toBe(true);
    for (const href of MUC_HOC_TAP) expect(coMuc(menuBen, href), `không được thấy ${href}`).toBe(false);
    expect(menuBen.queryAllByRole("button", { name: /bấm để đổi con/ })).toHaveLength(0);
    expect(duongDan(menuBen)).toEqual(["/portal/disc"]);
  });
});

describe("[CHC-02] đối chứng dương — có bé", () => {
  it("đủ mục học tập và có thẻ chọn con (ca [CHC-01] không đạt vì lý do sai)", () => {
    const { menuBen } = dung({ coHocTap: true, coDisc: true });
    for (const href of [...MUC_HOC_TAP, "/portal/disc"]) {
      expect(coMuc(menuBen, href), `phải thấy ${href}`).toBe(true);
    }
    expect(menuBen.queryAllByRole("button", { name: /bấm để đổi con/ }).length).toBeGreaterThan(0);
  });
});

describe("[CHC-03] chưa có bé + DISC tắt", () => {
  it("không còn mục điều hướng nào; vẫn đăng xuất được", () => {
    const { menuBen } = dung({ coHocTap: false, coDisc: false });
    expect(duongDan(menuBen)).toHaveLength(0);
    expect(menuBen.getByRole("button", { name: /Đăng xuất/ })).toBeTruthy();
  });
});

describe("[CHC-04] thanh tab điện thoại", () => {
  it("chưa có bé: chỉ DISC + «Thêm»", () => {
    const { thanhTab } = dung({ coHocTap: false, coDisc: true });
    expect(duongDan(thanhTab)).toEqual(["/portal/disc"]);
    for (const href of MUC_HOC_TAP) expect(coMuc(thanhTab, href), `tab không được có ${href}`).toBe(false);
    expect(thanhTab.getByRole("button", { name: "Thêm" })).toBeTruthy();
  });
  it("đối chứng dương: có bé ⇒ thanh tab có tab lịch học", () => {
    const { thanhTab } = dung({ coHocTap: true, coDisc: true });
    expect(coMuc(thanhTab, "/portal/lich")).toBe(true);
  });
});

describe("[CHC-06] logo", () => {
  const logo = (menuBen: ReturnType<typeof within>) => menuBen.getByRole("link", { name: /Trang chủ/ }).getAttribute("href");
  it("chưa có bé + DISC bật ⇒ logo dẫn tới DISC (không phải thông báo «chưa liên kết»)", () => {
    expect(logo(dung({ coHocTap: false, coDisc: true }).menuBen)).toBe("/portal/disc");
  });
  it("đối chứng dương: có bé ⇒ /portal; chưa có bé nhưng DISC tắt ⇒ /portal", () => {
    expect(logo(dung({ coHocTap: true, coDisc: true }).menuBen)).toBe("/portal");
    cleanup();
    expect(logo(dung({ coHocTap: false, coDisc: false }).menuBen)).toBe("/portal");
  });
});

describe("[CHC-05] dây nối coHocTap", () => {
  const doc = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8").replace(/\r\n/g, "\n");
  it("layout tính từ số bé; PortalV2Shell chuyển tiếp xuống SrShell", () => {
    const layout = doc("app/(portal)/portal/layout.tsx");
    expect(layout.match(/coHocTap=\{children_\.length > 0\}/g) ?? []).toHaveLength(1);
    const v2 = doc("components/portal/v2-shell.tsx");
    expect(v2.match(/coHocTap=\{coHocTap\}/g) ?? []).toHaveLength(1);
    expect(v2).toMatch(/\n {2}coHocTap: boolean;/); // bắt buộc, không mặc định (luật 11)
  });
});
