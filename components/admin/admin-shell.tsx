"use client";

// components/admin/admin-shell.tsx — khung site admin, và là chỗ DUY NHẤT giữ trạng thái
// "drawer đang mở" cho điện thoại.
//
// ── VÌ SAO FILE NÀY RA ĐỜI ────────────────────────────────────────────────────────────────
// Trước 13/09/2026, `app/(admin)/admin/layout.tsx` bọc `<Sidebar>` trong
// `<div className="hidden md:flex md:shrink-0">` và topbar KHÔNG có nút mở nào. Hệ quả đo
// được: dưới 768px sidebar là `display:none` và **không có đường nào mở nó** ⇒ toàn bộ 234
// trang admin không điều hướng được từ điện thoại. Lối đi duy nhất còn lại là 4 mục trong
// dropdown avatar (Hồ sơ cá nhân · Học tập nội bộ · Hướng dẫn · Đăng xuất).
//
// Nó lộ ra đúng lúc Web Push lên prod: push sinh ra để nhân viên nhận lead TRÊN ĐIỆN THOẠI,
// mà bấm vào thông báo xong họ rơi vào một khu không đi đâu được. Đây là lớp lỗi "affordance
// im lặng" — không ném lỗi, không làm test đỏ, console sạch; chỉ người dùng biết.
//
// ── KHUÔN LẤY TỪ SITE GV, KHÔNG TỰ PHÁT MINH ─────────────────────────────────────────────
// `app/(teacher)/teacher/_components/app-shell.tsx` đã giải đúng bài này từ trước: sidebar cố
// định trên desktop, drawer trượt trên mobile, một state, `onNavigate` đóng drawer khi bấm
// mục. Chép khuôn đó để hai site hành xử giống nhau — người dùng không phải học lại.
//
// ── VÌ SAO RENDER `<Sidebar>` HAI LẦN LÀ AN TOÀN (đã đo, đừng "tối ưu") ──────────────────
// `<Sidebar>` gọi `useChatUnread(userId, …)`, và hook đó nghe kênh realtime `user:{id}`.
// Render hai lần nghe thành hai lần — nhưng `components/chat/user-channel.ts` là một HUB
// REFCOUNT: người nghe đầu tiên mở kênh, người cuối cùng rời thì đóng. Chú thích của chính
// hub nói nó tồn tại VÌ site GV render sidebar ở hai nơi. Nên: một kết nối, một topic, hai
// người nghe.
//
// Cái thật sự nhân đôi là lượt `GET /api/chat/unread` mỗi khi có tín hiệu (hai hook, hai lượt
// hỏi lại). Route có rate limit 60/phút/user nên còn rất rộng; chấp nhận có ý thức. Muốn bỏ
// hẳn thì phải tách `SidebarContent` ra khỏi `components/admin/sidebar.tsx` như site GV —
// CỐ Ý KHÔNG làm: **bốn** bộ test đọc tệp đó như VĂN BẢN NGUỒN (`nav-coverage`,
// `menu-permissions`, `page-gates`, `sidebar-an-muc-quan-tri`), và luật 11 của repo xếp test
// grep mã nguồn là loại mong manh nhất. Đổi một dòng ghi thêm trong đường nóng rẻ hơn đổi
// hình dạng một tệp đang có bốn cổng soi văn bản.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";
import { cn } from "@/lib/utils";

/** Khoá localStorage cho trạng thái thu gọn thanh điều hướng. */
const KHOA_THU_GON = "satarobo:sidebar:thu-gon";

export function AdminShell({
  granted,
  anMenu,
  chatUserId,
  chatUnread,
  evalV2Enabled,
  scormEnabled,
  classGroupEnabled,
  zalocrmEnabled,
  hoaDonEnabled,
  userId,
  userName,
  userRole,
  roles,
  activeRole,
  elearningUrl,
  children,
}: {
  granted: string[];
  /** Mục menu ẩn theo vai đang dùng (`lib/auth/menu-gon.ts`) — chỉ gọn menu, không phải quyền. */
  anMenu: readonly string[];
  /** `User.id` cho badge chat — layout truyền rỗng khi người này không thấy mục Tin nhắn. */
  chatUserId: string;
  chatUnread: number;
  evalV2Enabled: boolean;
  scormEnabled: boolean;
  classGroupEnabled: boolean;
  zalocrmEnabled: boolean;
  hoaDonEnabled: boolean;
  userId: string;
  userName?: string | null;
  userRole?: string | null;
  roles: string[];
  activeRole: string | null;
  elearningUrl?: string | null;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Đóng drawer khi đường dẫn đổi. `onNavigate` của `<Sidebar>` đã đóng khi bấm một mục,
  // nhưng đây là lưới cho mọi đường điều hướng KHÁC: bấm chuông, bấm một liên kết trong
  // nội dung trang, hay nút lùi của trình duyệt.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape đóng drawer — bàn phím ngoài cắm vào iPad là ca thật, và nó cũng là hành vi mà
  // người dùng mong đợi ở mọi lớp phủ.
  useEffect(() => {
    if (!drawerOpen) return;
    const nghe = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", nghe);
    return () => document.removeEventListener("keydown", nghe);
  }, [drawerOpen]);

  // Khoá cuộn thân trang khi drawer mở — không khoá thì cuộn trong drawer sẽ "xuyên" xuống
  // trang phía dưới trên iOS. Cùng cách `components/sections/mobile-nav-drawer.tsx` làm.
  useEffect(() => {
    if (!drawerOpen) return;
    const truoc = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = truoc;
    };
  }, [drawerOpen]);

  // ── THU GỌN THANH ĐIỀU HƯỚNG (17/09/2026) ─────────────────────────────────────────────
  //
  // Trạng thái nằm Ở ĐÂY, không nằm trong `Sidebar`: shell dựng `Sidebar` HAI LẦN (thanh cố
  // định + drawer), nên state trong Sidebar là hai bản độc lập — thu gọn bản này, bản kia
  // không biết, và lần mở drawer sau lại đọc localStorage ra một giá trị thứ ba.
  //
  // ⚠️ Nạp từ localStorage trong `useEffect`, KHÔNG trong khởi tạo `useState`: server render
  // không có localStorage nên đọc sớm là lệch hydrate. Đổi lại có một nhịp thanh hiện rộng
  // rồi co lại — đúng nếp mà trạng thái thu gọn TỪNG NHÓM trong `Sidebar` đang dùng.
  const [thuGon, setThuGon] = useState(false);
  useEffect(() => {
    try {
      setThuGon(localStorage.getItem(KHOA_THU_GON) === "1");
    } catch {
      /* ignore */
    }
  }, []);
  function doiThuGon() {
    setThuGon((truoc) => {
      const sau = !truoc;
      try {
        localStorage.setItem(KHOA_THU_GON, sau ? "1" : "0");
      } catch {
        /* ignore */
      }
      return sau;
    });
  }

  const sidebarProps = {
    granted,
    anMenu,
    userId: chatUserId,
    chatUnread,
    evalV2Enabled,
    scormEnabled,
    classGroupEnabled,
    zalocrmEnabled,
    hoaDonEnabled,
  };

  return (
    <div className="admin-scope flex h-screen overflow-hidden bg-muted">
      {/* Thanh cố định — desktop. Giữ nguyên ngưỡng `md` của bản cũ. */}
      <div className="hidden md:flex md:shrink-0">
        <Sidebar {...sidebarProps} thuGon={thuGon} onDoiThuGon={doiThuGon} />
      </div>

      {/* Drawer — điện thoại. `md:hidden` để nó KHÔNG bao giờ chồng lên thanh cố định. */}
      <div
        className={cn(
          "fixed inset-0 z-40 md:hidden",
          drawerOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!drawerOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-slate-900/40 transition-opacity",
            drawerOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-64 shadow-xl transition-transform",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Đóng menu"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          <Sidebar {...sidebarProps} onNavigate={() => setDrawerOpen(false)} />
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* `Topbar.userRole` là `string | undefined`; layout truyền
            `activeRole ?? session.user.role` nên có thể là `null` — ép về `undefined` ở đây
            chứ KHÔNG nới kiểu của Topbar, để nơi khác không vô tình truyền null vào. */}
        <Topbar
          userId={userId}
          userName={userName}
          userRole={userRole ?? undefined}
          roles={roles}
          activeRole={activeRole}
          elearningUrl={elearningUrl}
          onMenuClick={() => setDrawerOpen(true)}
        />
        {/* `p-4` trên điện thoại: `p-6` cố định của bản cũ ăn 48px bề ngang trên màn 375px,
            tức ~13% chiều rộng chỉ để làm lề. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
