// @vitest-environment jsdom
/**
 * `<AdminShell/>` — điều hướng admin PHẢI với tới được từ điện thoại.
 *
 * ── VÌ SAO BỘ NÀY RA ĐỜI ─────────────────────────────────────────────────────────────────
 * Trước 13/09/2026, `app/(admin)/admin/layout.tsx` bọc `<Sidebar>` trong
 * `hidden md:flex` và topbar KHÔNG có nút mở nào ⇒ dưới 768px **toàn bộ 234 trang admin
 * không điều hướng được từ điện thoại**. Lối đi duy nhất còn lại là 4 mục trong dropdown
 * avatar. Chủ dự án phát hiện khi mở web app từ màn hình chính iPhone để bật Web Push.
 *
 * Đây là lớp lỗi "affordance IM LẶNG" (luật 12 của repo, bản mở rộng): không ném lỗi, không
 * làm test nào đỏ, console sạch — chỉ người dùng cầm điện thoại mới biết. Cách duy nhất canh
 * được là một ca khẳng định HÀNH VI: bấm nút thì menu phải hiện ra.
 *
 * Cố ý KHÔNG canh bằng cách grep `className` tìm chuỗi `md:hidden` — luật 11 xếp test grep
 * mã nguồn là loại mong manh nhất, và ở đây hành vi kiểm được thật.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// Badge chat mở kênh realtime — không dựng trong test khung.
vi.mock("@/components/chat/use-chat-unread", () => ({
  useChatUnread: (_id: string, seed: number) => seed,
}));
vi.mock("@/lib/auth/logout-client", () => ({ logoutToGate: vi.fn() }));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("@/components/admin/role-switcher", () => ({ RoleSwitcher: () => null }));

import { AdminShell } from "./admin-shell";

/** `granted` rộng để sidebar có mục mà vẽ — nội dung menu do bộ khác canh. */
const GRANTED = ["leads:view-all", "students:view-all", "classes:view-all"];

function dung(ghiDe: Record<string, unknown> = {}) {
  return render(
    <AdminShell
      granted={GRANTED}
      anMenu={[]}
      chatUserId=""
      chatUnread={0}
      evalV2Enabled={false}
      scormEnabled={false}
      zalocrmEnabled={false}
      hoaDonEnabled={false}
      classGroupEnabled={false}
      userId="usr_1"
      userName="Kiệt"
      userRole="SUPER_ADMIN"
      roles={["SUPER_ADMIN"]}
      activeRole="SUPER_ADMIN"
      elearningUrl={null}
      {...ghiDe}
    >
      <p>nội dung trang</p>
    </AdminShell>,
  );
}

/** Nút mở menu — thứ mà bản cũ KHÔNG có. */
const nutMoMenu = () => screen.queryByRole("button", { name: "Mở menu điều hướng" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("[ADMIN-NAV-T01] điều hướng phải với tới được trên điện thoại", () => {
  it("CÓ nút mở menu — đây là thứ bản trước 13/09 thiếu hoàn toàn", () => {
    dung();
    expect(nutMoMenu()).not.toBeNull();
  });

  it("chưa bấm ⇒ drawer đóng (không nhận sự kiện chạm, không che trang)", () => {
    const { container } = dung();
    const lop = container.querySelector('[aria-hidden="true"].fixed');
    expect(lop).not.toBeNull();
    expect(lop!.className).toContain("pointer-events-none");
  });

  it("bấm nút ⇒ drawer MỞ và nhận được chạm", () => {
    const { container } = dung();
    fireEvent.click(nutMoMenu()!);
    const lop = container.querySelector('[aria-hidden="false"].fixed');
    expect(lop).not.toBeNull();
    expect(lop!.className).toContain("pointer-events-auto");
  });

  it("drawer mở ⇒ CÓ mục menu thật để bấm (không phải một tấm rỗng)", () => {
    // Ca này canh đúng thứ ảnh chụp của chủ dự án làm nghi ngờ ở site public: drawer mở ra
    // mà không có mục nào. Ở đây khẳng định có ÍT NHẤT một liên kết điều hướng thật.
    dung();
    fireEvent.click(nutMoMenu()!);
    const lienKet = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(lienKet).toContain("/dashboard");
    expect(lienKet.length).toBeGreaterThan(3);
  });

  it("bấm một mục ⇒ drawer TỰ ĐÓNG", () => {
    // Thiếu vế này thì bấm xong drawer vẫn che kín trang vừa mở: người dùng phải chạm ra
    // ngoài một lần nữa mới thấy nội dung, và họ sẽ tưởng nút không ăn.
    const { container } = dung();
    fireEvent.click(nutMoMenu()!);
    expect(container.querySelector('[aria-hidden="false"].fixed')).not.toBeNull();

    // Neo vào mục "Dashboard" — mục DUY NHẤT không có `perm` nên luôn hiện, và nó nằm ngoài
    // mọi nhóm có thể thu gọn. Neo vào `/leads` thì ca này đỏ vì nhóm "CRM & Tuyển sinh"
    // mặc định đang gập, tức nó đo trạng thái gập chứ không đo dây `onNavigate`.
    // Lấy phần tử CUỐI: `/dashboard` xuất hiện hai lần (logo, rồi mục menu).
    const muc = screen.getAllByRole("link").filter((a) => a.getAttribute("href") === "/dashboard");
    expect(muc.length, "sidebar phải có liên kết /dashboard").toBeGreaterThan(0);
    fireEvent.click(muc[muc.length - 1]!);
    expect(container.querySelector('[aria-hidden="false"].fixed')).toBeNull();
  });

  it("phím Escape ⇒ drawer đóng", () => {
    const { container } = dung();
    fireEvent.click(nutMoMenu()!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector('[aria-hidden="false"].fixed')).toBeNull();
  });

  it("bấm nền mờ ⇒ drawer đóng", () => {
    const { container } = dung();
    fireEvent.click(nutMoMenu()!);
    const nen = container.querySelector(".absolute.inset-0");
    expect(nen).not.toBeNull();
    fireEvent.click(nen!);
    expect(container.querySelector('[aria-hidden="false"].fixed')).toBeNull();
  });

  it("nút 'Đóng menu' trong drawer cũng đóng", () => {
    const { container } = dung();
    fireEvent.click(nutMoMenu()!);
    fireEvent.click(screen.getByRole("button", { name: "Đóng menu" }));
    expect(container.querySelector('[aria-hidden="false"].fixed')).toBeNull();
  });

  it("nội dung trang vẫn render bình thường", () => {
    dung();
    expect(screen.getByText("nội dung trang")).toBeTruthy();
  });
});
