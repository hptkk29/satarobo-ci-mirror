// @vitest-environment jsdom
/**
 * [SCC-*] — thẻ chọn con ở đầu menu bên của Cổng phụ huynh (04/11/2026): bấm RA NGOÀI vùng thẻ thì danh sách tự đóng.
 *   [SCC-01] bấm thẻ ⇒ mở; bấm ra ngoài (nền trang) ⇒ đóng
 *   [SCC-02] bấm TRONG vùng danh sách (đối chứng âm) ⇒ KHÔNG đóng chỉ vì có sự kiện bấm
 *   [SCC-03] nhấn Escape ⇒ đóng
 *   [SCC-04] bấm lại thẻ ⇒ đóng (hành vi cũ giữ nguyên)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

const CON = [
  { id: "c1", name: "Hồ Hữu Huy", initials: "HH", courseName: "Sata3", active: false },
  { id: "c2", name: "Vũ Diệu Dung", initials: "DD", courseName: "Sata4", active: true },
];

function dung() {
  render(
    <SrShell soKhuyenMaiMoi={0} quyDinhNgay={null} userId="u1" parentName="Phụ huynh" notifCount={0} coGioiThieu={false} coTuSach={false} coSucKhoe={false} coHocTap coBaiTap={false} switcherChildren={CON}>
      <p data-testid="nen">nội dung</p>
    </SrShell>,
  );
  return screen.getAllByRole("button", { name: /bấm để đổi con/ })[0]!;
}

describe("[SCC-01] bấm ra ngoài thì đóng", () => {
  it("mở bằng thẻ, bấm nền trang ⇒ aria-expanded về false và danh sách biến mất", () => {
    const the = dung();
    fireEvent.click(the);
    expect(the.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("button", { name: "Hồ sơ gia đình" }).length).toBeGreaterThan(0);
    fireEvent.pointerDown(screen.getByTestId("nen"));
    expect(the.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("button", { name: "Hồ sơ gia đình" })).toHaveLength(0);
  });
});

describe("[SCC-02] bấm trong vùng danh sách không bị đóng oan", () => {
  it("pointerdown ngay trên danh sách / trên thẻ ⇒ vẫn mở", () => {
    const the = dung();
    fireEvent.click(the);
    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Hồ sơ gia đình" })[0]!);
    expect(the.getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerDown(the);
    expect(the.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("[SCC-03] Escape", () => {
  it("nhấn Escape khi đang mở ⇒ đóng", () => {
    const the = dung();
    fireEvent.click(the);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(the.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("[SCC-04] hành vi cũ", () => {
  it("bấm lại thẻ ⇒ đóng", () => {
    const the = dung();
    fireEvent.click(the);
    fireEvent.click(the);
    expect(the.getAttribute("aria-expanded")).toBe("false");
  });
});
