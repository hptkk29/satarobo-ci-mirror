// @vitest-environment jsdom
/**
 * [MTV-*] — «Bài tập & bài thi» tạm ẩn (03/11/2026): vỏ Cổng phụ huynh + Cổng học sinh DỰNG THẬT, đọc phần tử.
 *   [MTV-01] vỏ phụ huynh: ẩn ⇒ không còn mục / liên kết bài tập; hiện ⇒ có (đối chứng dương)
 *   [MTV-02] vỏ học sinh: ẩn ⇒ menu bên + thanh tab không còn «Bài tập», thanh tab còn 4 ô; hiện ⇒ 5 ô
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
vi.mock("@/components/chat/use-chat-unread", () => ({ useChatUnread: (_id: string, n: number) => n }));
vi.mock("@/lib/auth/logout-client", () => ({ logoutToGate: () => undefined }));
vi.mock("@/components/portal/use-set-active-site", () => ({ useSetActiveSite: () => ({ pending: false, switchTo: () => undefined }) }));
vi.mock("@/components/portal/appearance-provider", () => ({
  usePortalAppearance: () => ({ isDark: false, setTheme: () => undefined, mounted: true }),
}));
vi.mock("@/components/public/dai-link-phap-ly", () => ({ DaiLinkPhapLy: () => null }));

import { SrShell } from "@/components/portal/sr-shell";
import { HvShell } from "@/components/portal/hv-shell";

afterEach(cleanup);

const hrefs = (c: HTMLElement) => [...c.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");

describe("[MTV-01] vỏ phụ huynh", () => {
  const dung = (coBaiTap: boolean) =>
    render(
      <SrShell soKhuyenMaiMoi={0} quyDinhNgay={null} userId="u1" parentName="Phụ huynh" notifCount={0} coGioiThieu={false} coTuSach={false} coSucKhoe={false} coHocTap coBaiTap={coBaiTap}>
        <p>nội dung</p>
      </SrShell>,
    );
  it("ẩn ⇒ không có mục «Bài tập & bài thi» và không liên kết nào tới /portal/bai-tap", () => {
    const { container } = dung(false);
    expect(screen.queryByText("Bài tập & bài thi")).toBeNull();
    expect(hrefs(container).some((h) => h.startsWith("/portal/bai-tap") || h.startsWith("/portal/bai-thi"))).toBe(false);
    // đối chứng: các mục khác vẫn còn
    expect(hrefs(container)).toContain("/portal/nhan-xet");
  });
  it("hiện ⇒ có mục (đối chứng dương)", () => {
    const { container } = dung(true);
    expect(hrefs(container)).toContain("/portal/bai-tap");
    expect(screen.getAllByText("Bài tập & bài thi").length).toBeGreaterThan(0);
  });
});

describe("[MTV-02] vỏ học sinh", () => {
  const dung = (coBaiTap: boolean) =>
    render(
      <HvShell ten="Nguyễn An" tat="NA" anhUrl={null} phu="Sata 3" coin={0} mauAv={0} tinMoi={0} baiTap={coBaiTap ? 2 : 0} danhGia={0} coBaiTap={coBaiTap}>
        <p>nội dung</p>
      </HvShell>,
    );
  it("ẩn ⇒ menu bên + thanh tab không còn bài tập; thanh tab còn 4 ô", () => {
    const { container } = dung(false);
    expect(hrefs(container).some((h) => h.includes("/bai-tap") || h.includes("/bai-thi"))).toBe(false);
    const tab = within(screen.getByRole("navigation", { name: "Điều hướng cổng học sinh" }));
    expect(tab.getAllByRole("link")).toHaveLength(4);
    expect(screen.queryByText("Bài tập & bài thi")).toBeNull();
    expect(hrefs(container)).toContain("/portal/hoc-sinh/lich"); // đối chứng
  });
  it("hiện ⇒ thanh tab 5 ô và có mục Bài tập (đối chứng dương)", () => {
    const { container } = dung(true);
    const tab = within(screen.getByRole("navigation", { name: "Điều hướng cổng học sinh" }));
    expect(tab.getAllByRole("link")).toHaveLength(5);
    expect(hrefs(container)).toContain("/portal/hoc-sinh/bai-tap");
  });
});
