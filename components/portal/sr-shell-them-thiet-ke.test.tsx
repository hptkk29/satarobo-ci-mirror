// @vitest-environment jsdom
/**
 * [THM-*] — màn «Thêm» của điện thoại theo artifact M-Them.dc.html (12/11/2026).
 *   [THM-01] thứ tự: thẻ con → hai ô Quà tặng + Khuyến mãi → hotline → «Cho con vào Cổng học sinh» → nhóm mục
 *   [THM-02] nhãn «N MỚI» chỉ khi có khuyến mãi mới; số lấy từ props (không bịa)
 *   [THM-03] Quà tặng / Khuyến mãi KHÔNG lặp thành dòng trong danh sách nhóm (đã là hai ô)
 *   [THM-04] thẻ Cổng học sinh dùng STICKER Sata Robo (không emoji 🤖)
 *   [THM-05] dòng «Đã đồng ý Quy định» chỉ khi có ngày; trỏ /portal/quy-dinh (đối chứng âm: null ⇒ không có)
 *   [THM-06] không có quà nào (mọi cờ tắt) ⇒ không có hai ô; Đăng xuất + đổi giao diện vẫn còn
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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
  { id: "c1", name: "Phạm Bảo Châu", initials: "BC", courseName: "Sata3", active: true },
  { id: "c2", name: "Hồ Hữu Huy", initials: "HH", courseName: "Sata4", active: false },
];

function moThem(o: { moi?: number; quyDinhNgay?: string | null; coDisc?: boolean } = {}) {
  render(
    <SrShell
      userId="u1"
      parentName="Phụ huynh"
      notifCount={0}
      coGioiThieu={false}
      coDisc={o.coDisc ?? true}
      coTuSach={false}
      coSucKhoe={false}
      coBaiTap={false}
      coHocTap
      soKhuyenMaiMoi={o.moi ?? 0}
      quyDinhNgay={o.quyDinhNgay ?? null}
      switcherChildren={CON}
    >
      <p>nội dung</p>
    </SrShell>,
  );
  fireEvent.click(screen.getAllByRole("button", { name: /^Thêm$/ })[0]!);
  return within(screen.getByRole("dialog"));
}

const truoc = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("[THM-01] thứ tự các khối", () => {
  it("thẻ con → Quà tặng → Khuyến mãi → hotline → Cổng học sinh → nhóm «CON CỦA TÔI»", () => {
    const d = moThem({ moi: 2 });
    const the = d.getByRole("button", { name: /Phạm Bảo Châu/ });
    const qua = d.getByRole("link", { name: /^Quà tặng/ });
    const km = d.getByRole("link", { name: /^Khuyến mãi/ });
    const hot = d.getByRole("link", { name: /Hotline/ });
    const cong = d.getByRole("button", { name: /vào Cổng học sinh/i });
    const nhom = d.getByRole("heading", { name: "CON CỦA TÔI" });
    expect(truoc(the, qua)).toBe(true);
    expect(truoc(qua, km)).toBe(true);
    expect(truoc(km, hot)).toBe(true);
    expect(truoc(hot, cong)).toBe(true);
    expect(truoc(cong, nhom)).toBe(true);
    expect(qua.getAttribute("href")).toBe("/portal/qua-tang");
    expect(km.getAttribute("href")).toBe("/portal/khuyen-mai");
  });
  it("nhóm thứ ba tên «TRUNG TÂM & TÀI KHOẢN»", () => {
    const d = moThem();
    expect(d.getByRole("heading", { name: "TRUNG TÂM & TÀI KHOẢN" })).toBeTruthy();
  });
});

describe("[THM-02] nhãn «N MỚI»", () => {
  it("có 2 khuyến mãi mới ⇒ «2 MỚI» + aria-label nói rõ", () => {
    const d = moThem({ moi: 2 });
    expect(d.getByText("2 MỚI")).toBeTruthy();
    expect(d.getByRole("link", { name: "Khuyến mãi: 2 chương trình mới" })).toBeTruthy();
  });
  it("không có khuyến mãi mới ⇒ không có nhãn (đối chứng âm)", () => {
    const d = moThem({ moi: 0 });
    expect(d.queryByText(/MỚI$/)).toBeNull();
  });
});

describe("[THM-03] không lặp trong danh sách nhóm", () => {
  it("mỗi đường dẫn /portal/qua-tang và /portal/khuyen-mai chỉ có ĐÚNG MỘT lối trong màn", () => {
    const d = moThem({ moi: 1 });
    const hrefs = d.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.filter((h) => h === "/portal/qua-tang")).toHaveLength(1);
    expect(hrefs.filter((h) => h === "/portal/khuyen-mai")).toHaveLength(1);
  });
});

describe("[THM-04] sticker Sata Robo ở thẻ Cổng học sinh", () => {
  it("có ảnh sticker may-tinh trong thẻ và KHÔNG có emoji robot", () => {
    const d = moThem();
    const the = d.getByRole("button", { name: /vào Cổng học sinh/i });
    const img = the.querySelector("img");
    expect(img?.getAttribute("src") ?? "").toContain("may-tinh");
    expect(the.textContent).not.toContain("🤖");
  });
});

describe("[THM-05] dòng Quy định đào tạo", () => {
  it("có ngày đồng ý ⇒ hiện dòng, trỏ /portal/quy-dinh", () => {
    const d = moThem({ quyDinhNgay: "12/11/2026" });
    const a = d.getByRole("link", { name: /Đã đồng ý Quy định đào tạo học viên ngày 12\/11\/2026/ });
    expect(a.getAttribute("href")).toBe("/portal/quy-dinh");
    expect(a.textContent).toContain("12/11/2026");
  });
  it("chưa có mốc ⇒ không có dòng (đối chứng âm)", () => {
    const d = moThem({ quyDinhNgay: null });
    expect(d.queryByText(/Đã đồng ý Quy định đào tạo/)).toBeNull();
  });
});

describe("[THM-06] không có quà nào", () => {
  it("mọi cờ tắt ⇒ không có hai ô, nhưng Đăng xuất và đổi giao diện vẫn còn", () => {
    const d = moThem({ coDisc: false });
    expect(d.queryByRole("link", { name: /^Quà tặng/ })).toBeNull();
    expect(d.queryByRole("link", { name: /^Khuyến mãi/ })).toBeNull();
    expect(d.getByRole("button", { name: /Đăng xuất/ })).toBeTruthy();
    expect(d.getByRole("button", { name: /Giao diện tối/ })).toBeTruthy();
  });
});

describe("[THM-07] thẻ con xuống dòng như cũ, KHÔNG lướt ngang (chủ dự án 12/11)", () => {
  it("nhóm «Chọn con» là flex-wrap, không có vùng cuộn ngang; hai thẻ vẫn bấm được", () => {
    const d = moThem();
    const nhom = d.getByRole("group", { name: "Chọn con" });
    expect(nhom.className).toMatch(/flex-wrap/);
    expect(nhom.className).not.toMatch(/overflow-x-auto|snap-x/);
    expect(d.getByRole("button", { name: /Hồ Hữu Huy/ })).toBeTruthy();
  });
});

describe("[THM-08] đang ở «Thêm» bấm tab «Tổng quan» phải về được Tổng quan", () => {
  it("đường dẫn hiện tại ĐÃ là /portal (pathname không đổi) mà màn «Thêm» vẫn đóng lại", () => {
    moThem();
    expect(screen.getByRole("dialog")).toBeTruthy();
    const thanhTab = within(screen.getByRole("navigation", { name: "Điều hướng chính" }));
    fireEvent.click(thanhTab.getByRole("link", { name: /Tổng quan/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
