// @vitest-environment jsdom
/**
 * [SVH-*] — menu «Thêm» của điện thoại (Cổng phụ huynh): nút «Vào Cổng học sinh» nằm NGAY DƯỚI các thẻ con (04/11/2026).
 *   [SVH-01] có nút, đứng sau danh sách thẻ con trong khối «ĐANG XEM», nhắc đúng tên con đang xem
 *   [SVH-02] bấm ⇒ đặt đúng con đang xem rồi đi tới /portal/hoc-sinh/vao (không phải con đầu danh sách); đóng menu khi thành công
 *   [SVH-03] không có con nào ⇒ không có nút (đối chứng âm)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const goi = vi.hoisted(() => ({ switchTo: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal",
  useRouter: () => ({ push: goi.push, refresh: goi.refresh }),
}));
vi.mock("@/components/chat/use-chat-unread", () => ({ useChatUnread: (_id: string, n: number) => n }));
vi.mock("@/lib/auth/logout-client", () => ({ logoutToGate: () => undefined }));
vi.mock("@/components/portal/use-set-active-site", () => ({ useSetActiveSite: () => ({ pending: false, switchTo: goi.switchTo }) }));
vi.mock("@/components/portal/appearance-provider", () => ({
  usePortalAppearance: () => ({ isDark: false, setTheme: () => undefined, mounted: true }),
}));
vi.mock("@/components/public/dai-link-phap-ly", () => ({ DaiLinkPhapLy: () => null }));

import { SrShell } from "@/components/portal/sr-shell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CON = [
  { id: "c1", name: "Hồ Hữu Huy", initials: "HH", courseName: "Sata3", active: false },
  { id: "c2", name: "Ngô Hữu Long", initials: "HL", courseName: "RoboSim", active: false },
  { id: "c3", name: "Vũ Diệu Dung", initials: "DD", courseName: "Sata3", active: true },
];

const moThem = (con: typeof CON) => {
  render(
    <SrShell soKhuyenMaiMoi={0} quyDinhNgay={null} userId="u1" parentName="Phụ huynh" notifCount={0} coGioiThieu={false} coTuSach={false} coSucKhoe={false} coHocTap coBaiTap={false} switcherChildren={con}>
      <p>nội dung</p>
    </SrShell>,
  );
  // nút «Thêm» trên thanh tab dưới
  fireEvent.click(screen.getAllByRole("button", { name: /^Thêm$/ })[0]!);
  return within(screen.getByRole("dialog"));
};

describe("[SVH-01] vị trí + nội dung", () => {
  it("nút nằm sau cả ba thẻ con (thiết kế M-Them: sau hai ô nổi bật + hotline)", () => {
    const dlg = moThem(CON);
    const nut = dlg.getByRole("button", { name: /vào Cổng học sinh/i });
    // Thiết kế M-Them: thẻ không nêu tên con (con đang xem là thẻ aria-pressed ở trên) — chữ cố định.
    expect(nut.textContent).toContain("Cho con vào Cổng học sinh");
    const theCon = dlg.getAllByRole("button", { pressed: undefined }).filter((b) => b.hasAttribute("aria-pressed"));
    expect(theCon).toHaveLength(3);
    // thứ tự trong DOM: mọi thẻ con đứng TRƯỚC nút
    for (const b of theCon) expect(b.compareDocumentPosition(nut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("[SVH-02] bấm nút", () => {
  it("đặt đúng con đang xem (c3, không phải c1) rồi đi tới /portal/hoc-sinh/vao", () => {
    const dlg = moThem(CON);
    fireEvent.click(dlg.getByRole("button", { name: /vào Cổng học sinh/i }));
    expect(goi.switchTo).toHaveBeenCalledTimes(1);
    expect(goi.switchTo.mock.calls[0]![0]).toBe("c3");
    // mô phỏng thành công
    const opts = goi.switchTo.mock.calls[0]![1] as { onSuccess: (r: { push: typeof goi.push; refresh: typeof goi.refresh }) => void };
    act(() => opts.onSuccess({ push: goi.push, refresh: goi.refresh }));
    expect(goi.push).toHaveBeenCalledWith("/portal/hoc-sinh/vao");
    expect(goi.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull(); // menu đã đóng
  });
  it("không con nào đang chọn ⇒ lấy con đầu danh sách", () => {
    const dlg = moThem(CON.map((c) => ({ ...c, active: false })));
    fireEvent.click(dlg.getByRole("button", { name: /vào Cổng học sinh/i }));
    expect(goi.switchTo.mock.calls[0]![0]).toBe("c1");
  });
});

describe("[SVH-03] không có con", () => {
  it("danh sách con rỗng ⇒ không có nút «Vào Cổng học sinh»", () => {
    render(
      <SrShell soKhuyenMaiMoi={0} quyDinhNgay={null} userId="u1" parentName="Phụ huynh" notifCount={0} coGioiThieu={false} coTuSach={false} coSucKhoe={false} coHocTap coBaiTap={false} switcherChildren={[]} activeStudentName="Bé X">
        <p>nội dung</p>
      </SrShell>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Thêm$/ })[0]!);
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: /vào Cổng học sinh/i })).toBeNull();
  });
});
