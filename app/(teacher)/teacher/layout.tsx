// app/(teacher)/teacher/layout.tsx — L5: khung site giáo viên (giaovien.satarobo.vn).
// Phiếu BGĐ câu 7 (ký 04/07/2026) duyệt "làm riêng cho giáo viên" — đảo Doc 15 §0.
// Gate 3 tầng: (1) chưa login → /login; (2) flag TEACHER_SITE_ENABLED OFF → site
// chưa mở, về khu hiện tại (GV vẫn dùng admin — 2-phase, KHÔNG đá GV khỏi admin);
// (3) login nhưng KHÔNG có role TEACHER → về khu đúng của họ (staff → admin,
// PARENT → portal). UI: shadcn thuần — KHÔNG Magic UI/Framer/Recharts (ESLint chặn).
//
// Giao diện port từ TeachUI: shell sidebar + topbar (thay top-nav ngang), tone
// màu theo token thương hiệu + Sáng/Tối. Token scoped trong ./teacher.css dưới `.teacher-root` →
// admin/portal/public giữ nguyên nhận diện cam+tím.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasRole, hasStaffRole } from "@/lib/auth/permissions";
import { isTeacherSiteEnabled } from "@/lib/flags";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { adminHomeUrl } from "@/lib/auth/hosts";
import { elearningEntryUrl } from "@/lib/elearning/entry";
import { countChatUnreadForUser } from "@/lib/chat/unread";
import { AppShell } from "./_components/app-shell";
import { ServiceWorkerRegister } from "@/components/push/service-worker-register";
import "./teacher.css";

// F2 (Q41) — SSO đa subdomain bật khi env set. Mặc định không → không hiện lối
// "Về trang quản trị" (nhảy host cần shared cookie, không có thì văng login).
const ssoEnabled = Boolean(process.env.AUTH_COOKIE_DOMAIN?.trim());

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Giáo viên | Sata Robo",
  robots: { index: false, follow: false },
  // Web Push Đợt 3 — site GV là host làm việc của GIÁO VIÊN THUẦN: `TEACHER_SITE_ENABLED`
  // mặc định ON (lib/flags.ts) nên `decideRoute` đá họ khỏi admin sang đây. Không khai
  // manifest ở đây thì đúng nhóm người đó không cài được web app ⇒ iPhone của họ không bao
  // giờ nhận được thông báo.
  //
  // ⚠️ Trỏ file tĩnh `/manifest.json` — đường đã nằm trong `isInfraPath`. KHÔNG dùng
  // `app/manifest.ts` (phát ra `/manifest.webmanifest`, không được miễn trừ ⇒ rơi vào luật
  // host×role và hỏng câm với request nặc danh mà trình duyệt dùng để lấy manifest).
  manifest: "/manifest.json",
};

// Cùng màu với site admin: `--primary` thật của app (app/globals.css).
export const viewport = {
  themeColor: "#f97316",
};

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // 2-phase: flag OFF → site GV chưa mở. GV (và mọi staff) tiếp tục làm việc
  // trên admin như hiện tại; PARENT về portal. Bật flag khi L6 đủ tính năng.
  if (!isTeacherSiteEnabled()) {
    redirect(hasStaffRole(session.user) ? "/dashboard" : "/portal");
  }

  // Gate role: site GV chỉ cho user CÓ role TEACHER (kể cả kiêm nhiệm đa vai trò).
  if (!hasRole(session.user, "TEACHER")) {
    redirect(hasStaffRole(session.user) ? "/dashboard" : "/portal");
  }

  // Liveness (defense-in-depth như admin layout): disable user / soft-delete /
  // bump tokenVersion → logout ngay request kế tiếp. User ∈ SCOPE_EXEMPT
  // (identity đọc toàn cục) nên scopedDb không lọc — vẫn đi qua cổng scopedDb
  // theo chuẩn site mới (A0-04, ESLint chặn @/lib/db trần trong app/(teacher)).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));

  // EL-01 — null khi cờ OFF hoặc tài khoản không có hồ sơ nhân sự ⇒ ẩn mục menu.
  const elearningUrl = await elearningEntryUrl(session.user.id);
  const dbUser = await sdb.user.findUnique({
    where: { id: session.user.id },
    select: {
      isActive: true,
      tokenVersion: true,
      deletedAt: true,
      mustChangePassword: true,
    },
  });
  if (!dbUser || dbUser.deletedAt)
    redirect("/dang-xuat?reason=session-invalidated");
  if (!dbUser.isActive) redirect("/dang-xuat?reason=session-disabled");
  if (dbUser.tokenVersion !== session.user.tokenVersion) {
    redirect("/dang-xuat?reason=session-invalidated");
  }
  // BGĐ 31/07 — MK do admin cấp/reset: bắt đổi MK trước khi dùng site GV.
  // /doi-mat-khau ở app/(auth) (ngoài layout này) → không loop.
  if (dbUser.mustChangePassword) {
    redirect("/doi-mat-khau");
  }

  // F3 (Q41) — GV kiêm nhiệm (có thêm vai staff) được lối quay về admin. Chỉ khi SSO
  // bật (mặc định off → undefined → UserMenu không hiện mục này → hành vi hiện tại).
  const adminReturnUrl =
    ssoEnabled && hasStaffRole(session.user) ? adminHomeUrl() : undefined;

  // Badge "Tin nhắn" trên sidebar: SỐ BAN ĐẦU tính ở server (client không fetch lúc mount).
  // Đếm participant-based qua `lib/chat/unread` — cố ý KHÔNG scopedDb (GV dạy chéo cơ sở).
  // Hỏng thì badge = 0, không được làm chết cả site GV.
  const chatUnread = await countChatUnreadForUser(session.user.id).catch(
    () => 0,
  );

  return (
    <>
    <AppShell
      userId={session.user.id}
      userName={session.user.name ?? session.user.email ?? "Giáo viên"}
      adminReturnUrl={adminReturnUrl}
      elearningUrl={elearningUrl}
      chatUnread={chatUnread}
    >
      {children}
    </AppShell>
      {/* Web Push Đợt 3 — cài service worker cho host giáo viên. Anh em của AppShell chứ
          không nằm trong nó: AppShell là client component bọc <main>, nhét vào trong là đẩy
          một component vô hình xuống dưới nội dung không lý do. KHÔNG xin quyền ở đây. */}
      <ServiceWorkerRegister nguoiDung={session.user.id} />
    </>
  );
}
