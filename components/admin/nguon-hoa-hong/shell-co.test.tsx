// @vitest-environment jsdom
/**
 * [NHH-FE-02e] — hai cờ module đi HẾT dây qua `<AdminShell/>` tới `<Sidebar/>` (HÀNH VI, không đếm chuỗi).
 *
 * [SB-FLAG] (components/admin/sidebar-flag-wiring.test.ts) kiểm: Sidebar KHAI prop, Shell KHAI prop, Layout TRUYỀN prop.
 * Nó KHÔNG kiểm khâu Shell CHUYỀN TIẾP prop vào `<Sidebar>` — mắt xích ở giữa. Đợt cấy 08/10 (S04): bỏ
 * `hoaHongEngineEnabled,` khỏi `sidebarProps` của shell ra XANH ở mọi lưới, và hậu quả là mục "Sổ hoa hồng" biến mất
 * với MỌI người dù cờ engine bật — đúng hình dạng lỗi 17/09 ("Zalo CRM") mà [SB-FLAG] sinh ra để chặn.
 *
 * Ca đo trên phần tử thật: bật cờ ở cấp SHELL ⇒ mục hiện trong sidebar; kèm ĐỐI CHỨNG ÂM (cờ kia tắt ⇒ mục kia ẩn)
 * để một sidebar "hiện tất" không qua được.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PAGE_GATES } from "@/lib/auth/page-gates";

vi.mock("next/navigation", () => ({
  usePathname: () => "/leads", // mở nhóm "CRM & Tuyển sinh" — chứa hai mục của module
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/chat/use-chat-unread", () => ({
  useChatUnread: (_id: string, seed: number) => seed,
}));
vi.mock("@/lib/auth/logout-client", () => ({ logoutToGate: vi.fn() }));
vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/admin/role-switcher", () => ({ RoleSwitcher: () => null }));

import { AdminShell } from "../admin-shell";

afterEach(cleanup);

// Quyền đủ cho CẢ HAI mục (đúng PAGE_GATES) — để chỉ có CỜ quyết định hiện/ẩn. `leads:view-all` giữ cho mục "Lead"
// (đường dẫn giả lập `/leads`) hiện ra: nhóm chỉ MỞ khi chứa trang hiện tại, nên thiếu nó thì nhóm đóng và mọi ca
// "không thấy mục" ĐẠT vì lý do sai (đúng bài học luật 11).
const GRANTED = ["leads:view-all", ...PAGE_GATES["/nguon-hoa-hong/nguon"], ...PAGE_GATES["/nguon-hoa-hong/so"]];

function dung(co: { nguonLeadEnabled: boolean; hoaHongEngineEnabled: boolean }) {
  render(
    <AdminShell
      granted={GRANTED}
      anMenu={[]}
      chatUserId=""
      chatUnread={0}
      evalV2Enabled={false}
      scormEnabled={false}
      classGroupEnabled={false}
      zalocrmEnabled={false}
      hoaDonEnabled={false}
      userId="usr_1"
      userName="Kiệt"
      userRole="SUPER_ADMIN"
      roles={["SUPER_ADMIN"]}
      activeRole="SUPER_ADMIN"
      elearningUrl={null}
      {...co}
    >
      <p>nội dung</p>
    </AdminShell>,
  );
}

// Sidebar được vẽ ở CẢ khung desktop lẫn drawer điện thoại ⇒ có thể ≥ 1 liên kết cùng tên.
const soLienKet = (ten: string) => screen.queryAllByRole("link", { name: ten }).length;

describe("[NHH-FE-02e] cờ ở cấp AdminShell tới được Sidebar", () => {
  it("cờ nguồn BẬT, engine TẮT ⇒ có 'Nguồn lead', KHÔNG có 'Sổ hoa hồng'", () => {
    dung({ nguonLeadEnabled: true, hoaHongEngineEnabled: false });
    expect(soLienKet("Nguồn lead")).toBeGreaterThan(0);
    expect(soLienKet("Sổ hoa hồng")).toBe(0);
  });

  it("cờ engine BẬT, nguồn TẮT ⇒ có 'Sổ hoa hồng', KHÔNG có 'Nguồn lead'", () => {
    dung({ nguonLeadEnabled: false, hoaHongEngineEnabled: true });
    expect(soLienKet("Sổ hoa hồng")).toBeGreaterThan(0);
    expect(soLienKet("Nguồn lead")).toBe(0);
  });

  it("cả hai BẬT ⇒ thấy cả hai (đối chứng dương); cả hai TẮT ⇒ không thấy mục nào", () => {
    dung({ nguonLeadEnabled: true, hoaHongEngineEnabled: true });
    expect(soLienKet("Nguồn lead")).toBeGreaterThan(0);
    expect(soLienKet("Sổ hoa hồng")).toBeGreaterThan(0);
    cleanup();
    dung({ nguonLeadEnabled: false, hoaHongEngineEnabled: false });
    expect(soLienKet("Nguồn lead")).toBe(0);
    expect(soLienKet("Sổ hoa hồng")).toBe(0);
  });
});
