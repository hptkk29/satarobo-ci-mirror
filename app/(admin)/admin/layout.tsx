import { auth } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { elearningEntryUrl } from "@/lib/elearning/entry";
import { scopedDb } from "@/lib/db-scope";
import { hasStaffRole } from "@/lib/auth/permissions";
import {
  ACTIVE_ROLE_COOKIE,
  activeRoleOptions,
  menuActorForRole,
  menuUserForRole,
  resolveActiveRoleFrom,
} from "@/lib/auth/active-role";
import { grantedMenuActions } from "@/lib/auth/menu-permissions";
import { menuAnTheoVai, vaiDangDungChoMenu } from "@/lib/auth/menu-gon";
import { napAnMenuCuaVai } from "@/lib/auth/menu-gon-db";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { countChatUnreadForUser } from "@/lib/chat/unread";
import {
  isClassGroupEnabled,
  isEvalV2Enabled,
  isRbacV2Enabled,
  isScormEnabled,
  isZalocrmEnabled,
} from "@/lib/flags";
import { AdminShell } from "@/components/admin/admin-shell";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { laEngineHoaHongBat } from "@/lib/hoa-hong/feature";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";
import { ServiceWorkerRegister } from "@/components/push/service-worker-register";

// Default title cho MỌI trang admin chưa tự khai metadata (86/199 trang) → không rơi về
// title public "Sata Robo – Trung tâm…". Trang tự khai `title: "X | Admin"` giữ nguyên
// (không set template ở đây để tránh nhân đôi "| Admin").
export const metadata = {
  title: { default: "Quản trị" },
  // Web Push Đợt 2 — phát ra `<link rel="manifest" href="/manifest.json">`, điều kiện để nhân
  // viên iPhone "Thêm vào màn hình chính" (iOS chỉ giao push cho web app đã cài).
  //
  // ⚠️ TRỎ FILE TĨNH `public/manifest.json`, CỐ Ý KHÔNG dùng `app/manifest.ts`: file quy ước
  // của Next phát ra đường `/manifest.webmanifest`, mà `isInfraPath` (`lib/auth/route-policy.ts`)
  // chỉ mở đúng chuỗi `/manifest.json`. Đường `.webmanifest` không được matcher của `proxy.ts`
  // loại (matcher chỉ loại `.js`/`.css`/ảnh), nên nó rơi vào luật host×role và hỏng câm với một
  // request nặc danh — đúng thứ trình duyệt dùng để lấy manifest.
  manifest: "/manifest.json",
};

// Màu thanh trạng thái khi chạy dạng ứng dụng đã cài. Lấy đúng `--primary` của app
// (cam #F97316, `app/globals.css:196`).
export const viewport = {
  themeColor: "#f97316",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Defense-in-depth (tầng layout): chỉ chặn user KHÔNG có vai trò nhân viên
  // nào (PARENT-only). Đa vai trò (3B): có ≥1 staff role → được vào admin.
  if (!hasStaffRole(session.user)) {
    redirect("/portal");
  }

  // Phase 5.3.0 — Real-time invalidation: check user vẫn active + tokenVersion
  // match. Nếu admin disable user / soft-delete / bump tokenVersion → logout
  // ngay request kế tiếp. 1 DB query / request /admin/* acceptable cho admin
  // panel (~10 users).
  // User là SCOPE_EXEMPT → sdb pass-through, hành vi y nguyên (kể cả deletedAt
  // filter tự đọc field trần bên dưới). resolveActor được React.cache — page con
  // gọi checkPermission dùng chung 1 lần resolve/request.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // EL-01 — null khi cờ OFF hoặc tài khoản không có hồ sơ nhân sự ⇒ ẩn mục menu.
  const elearningUrl = await elearningEntryUrl(session.user.id);
  const dbUser = await sdb.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, tokenVersion: true, deletedAt: true, mustChangePassword: true },
  });

  if (!dbUser || dbUser.deletedAt) {
    redirect("/dang-xuat?reason=session-invalidated");
  }
  if (!dbUser.isActive) {
    redirect("/dang-xuat?reason=session-disabled");
  }
  if (dbUser.tokenVersion !== session.user.tokenVersion) {
    redirect("/dang-xuat?reason=session-invalidated");
  }
  // BGĐ 31/07 — MK do admin cấp/reset: chặn toàn bộ admin cho tới khi đổi MK.
  // Trang /doi-mat-khau nằm ở app/(auth) (ngoài layout này) → không loop.
  if (dbUser.mustChangePassword) {
    redirect("/doi-mat-khau");
  }

  // #13 (câu 11) — vai trò đang dùng, chỉ lọc MENU. Quyền không đổi: resolveActor vẫn
  // union mọi UserOrgRole. Cookie do client set → resolveActiveRoleFrom kiểm chứng sở hữu.
  // Cờ OFF → chọn theo vai legacy; cờ ON → theo RoleDef code (hai bộ mã chỉ trùng 5/9).
  const flagOn = isRbacV2Enabled();
  const jar = await cookies();
  const roleOptions = activeRoleOptions(session.user, actor, flagOn);
  const activeRole = resolveActiveRoleFrom(roleOptions, jar.get(ACTIVE_ROLE_COOKIE)?.value);
  const menuUser = menuUserForRole(
    { role: session.user.role, roles: session.user.roles, grants: session.user.grants },
    activeRole,
  );

  // Menu hỏi ĐÚNG hàm quyết định mà cổng trang dùng (evaluatePermission + cờ). Trước
  // 10/07 sidebar tự gọi can() v1 ⇒ bật cờ là menu và cổng nói hai câu chuyện khác nhau.
  const menuActor = menuActorForRole(actor, activeRole);
  const granted = grantedMenuActions({
    sessionUser: menuUser,
    actor: menuActor,
    flagOn,
  });

  // Badge "Tin nhắn" — CHỈ truy vấn khi mục đó thực sự hiện trên menu, để người không dùng
  // chat không gánh câu SQL ở MỌI trang admin. Số ban đầu do server đưa xuống (sidebar
  // không fetch lúc mount); hỏng thì badge = 0 chứ không làm chết layout.
  const canSeeChat = PAGE_GATES["/tin-nhan"].some((p) => granted.includes(p));
  const chatUnread = canSeeChat
    ? await countChatUnreadForUser(session.user.id).catch(() => 0)
    : 0;
  // Cùng cổng đó phải áp cho CẢ phía client, không riêng câu SQL: `useChatUnread` bỏ qua
  // khi `userId` rỗng, nên truyền rỗng là kế toán/nhân sự (không thấy mục Tin nhắn) không
  // mở kết nối Realtime và không gọi `/api/chat/realtime-token` trên mọi trang admin —
  // toàn bộ chi phí đó chỉ để nuôi một badge không bao giờ hiện.
  const chatUserId = canSeeChat ? session.user.id : "";
  // Cờ màn Hoá đơn điện tử nằm trong DB (setting, cache 300s) chứ không phải env. Đọc hỏng thì
  // coi như TẮT — một mục menu thiếu tốt hơn cả khung admin sập.
  // Menu gọn theo vai (`lib/auth/menu-gon.ts`) — CHỈ gọn menu, không đổi quyền. Theo VAI ĐANG
  // DÙNG (cùng actor đã thu hẹp của bộ chọn vai). Đọc hỏng ⇒ không ẩn gì: menu đủ tốt hơn khung sập.
  // Hai câu chạy CÙNG LÚC — không nối đuôi thêm một nhịp cho mọi trang admin.
  const vaiMenu = vaiDangDungChoMenu(menuActor, flagOn);
  // Hai cờ module "Nguồn lead & Chính sách hoa hồng" (nguon.enabled · hoaHong.engineBat) đứng TRONG chính
  // `Promise.all` này — KHÔNG một `await` nối đuôi (mọi trang admin chịu nhịp layout; bài học [DST-01]).
  // Đọc hỏng ⇒ TẮT: một mục menu thiếu tốt hơn cả khung admin sập.
  const [hoaDonEnabled, nguonLeadEnabled, hoaHongEngineEnabled, anMenuCuaVai] = await Promise.all([
    laHoaDonBat().catch(() => false),
    laQuanLyNguonBat().catch(() => false),
    laEngineHoaHongBat().catch(() => false),
    napAnMenuCuaVai(vaiMenu).catch(() => new Map<string, string[]>()),
  ]);
  const anMenu = menuAnTheoVai({ vai: vaiMenu, anMenuCuaVai });

  return (
    <>
      {/*
        Khung + trạng thái "drawer đang mở" nằm ở `AdminShell` (client): layout này là Server
        Component (nó `auth()`, `resolveActor`, đọc DB) nên không giữ được `useState`.

        Trước 13/09/2026 khối này tự dựng khung tại chỗ với `<div className="hidden md:flex">`
        bọc sidebar và KHÔNG có nút mở nào ⇒ dưới 768px cả 234 trang admin không điều hướng
        được từ điện thoại. Đừng dựng lại khung ở đây.
      */}
      <AdminShell
        granted={granted}
        anMenu={anMenu}
        chatUserId={chatUserId}
        chatUnread={chatUnread}
        evalV2Enabled={isEvalV2Enabled()}
        scormEnabled={isScormEnabled()}
        classGroupEnabled={isClassGroupEnabled()}
        zalocrmEnabled={isZalocrmEnabled()}
        hoaDonEnabled={hoaDonEnabled}
        nguonLeadEnabled={nguonLeadEnabled}
        hoaHongEngineEnabled={hoaHongEngineEnabled}
        userId={session.user.id}
        userName={session.user.name}
        userRole={activeRole ?? session.user.role}
        roles={roleOptions}
        activeRole={activeRole}
        elearningUrl={elearningUrl}
      >
        {children}
      </AdminShell>

      {/* KHÔNG gắn <Toaster> ở đây — layout gốc (app/layout.tsx) đã có MỘT bản cho mọi site.
          Gắn thêm là mỗi toast hiện ĐÔI (26/09/2026). */}
      {/* Web Push Đợt 2 — cài service worker, KHÔNG xin quyền (đó là Đợt 3, chỉ trong user gesture). */}
      <ServiceWorkerRegister nguoiDung={session.user.id} />
    </>
  );
}
