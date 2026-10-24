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
  usePathname: () => "/leads", // mở nhóm "CRM & Tuyển sinh" — chứa mục của module
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

// MỘT mục «Nguồn Lead & Hoa hồng» (12/10/2026) hiện ⇔ người xem mở được ÍT NHẤT MỘT tab (quyền ∧ cờ từng tab). Để chứng minh MỖI cờ tự đi hết dây
// (không "cờ này cứu cờ kia"), cấp quyền của ĐÚNG MỘT tab rồi bật/tắt từng cờ: chỉ cờ của tab đó quyết định hiện/ẩn.
// `leads:view-all` giữ cho mục "Lead" (đường dẫn giả lập `/leads`) hiện ra: nhóm chỉ MỞ khi chứa trang hiện tại, nên thiếu nó thì nhóm đóng
// và mọi ca "không thấy mục" ĐẠT vì lý do sai (đúng bài học luật 11).
const CHI_TAB_NGUON = ["leads:view-all", ...PAGE_GATES["/nguon-hoa-hong/nguon"]];
const CHI_TAB_SO = ["leads:view-all", ...PAGE_GATES["/nguon-hoa-hong/so"]];

function dung(granted: string[], co: { nguonLeadEnabled: boolean; hoaHongEngineEnabled: boolean }) {
  render(
    <AdminShell
      granted={granted}
      anMenu={[]}
      chatUserId=""
      chatUnread={0}
      evalV2Enabled={false}
      scormEnabled={false}
      classGroupEnabled={false}
      zalocrmEnabled={false}
      hoaDonEnabled={false}
      baoLuuEnabled={false}
      userId="usr_1"
      userName="Kiệt"
      userRole="SUPER_ADMIN"
      roles={["SUPER_ADMIN"]}
      activeRole="SUPER_ADMIN"
      elearningUrl={null}
      affiliateEnabled={false}
      {...co}
    >
      <p>nội dung</p>
    </AdminShell>,
  );
}

const MUC = "Nguồn Lead & Hoa hồng";
// Sidebar được vẽ ở CẢ khung desktop lẫn drawer điện thoại ⇒ có thể ≥ 1 liên kết cùng tên.
const soLienKet = () => screen.queryAllByRole("link", { name: MUC }).length;

describe("[NHH-FE-02e] cờ ở cấp AdminShell tới được Sidebar", () => {
  it("quyền CHỈ của tab Nguồn: hiện ⇔ cờ NGUỒN bật (cờ engine bật một mình KHÔNG cứu)", () => {
    dung(CHI_TAB_NGUON, { nguonLeadEnabled: true, hoaHongEngineEnabled: false });
    expect(soLienKet()).toBeGreaterThan(0);
    cleanup();
    dung(CHI_TAB_NGUON, { nguonLeadEnabled: false, hoaHongEngineEnabled: true });
    expect(soLienKet()).toBe(0);
  });

  it("quyền CHỈ của tab Sổ: hiện ⇔ cờ ENGINE bật (cờ nguồn bật một mình KHÔNG cứu)", () => {
    dung(CHI_TAB_SO, { nguonLeadEnabled: false, hoaHongEngineEnabled: true });
    expect(soLienKet()).toBeGreaterThan(0);
    cleanup();
    dung(CHI_TAB_SO, { nguonLeadEnabled: true, hoaHongEngineEnabled: false });
    expect(soLienKet()).toBe(0);
  });

  it("cả hai BẬT ⇒ thấy với cả hai kiểu quyền (đối chứng dương); cả hai TẮT ⇒ không thấy với ai", () => {
    for (const g of [CHI_TAB_NGUON, CHI_TAB_SO]) {
      cleanup();
      dung(g, { nguonLeadEnabled: true, hoaHongEngineEnabled: true });
      expect(soLienKet()).toBeGreaterThan(0);
      cleanup();
      dung(g, { nguonLeadEnabled: false, hoaHongEngineEnabled: false });
      expect(soLienKet()).toBe(0);
    }
  });
});
