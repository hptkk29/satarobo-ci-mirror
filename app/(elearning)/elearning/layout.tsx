// app/(elearning)/elearning/layout.tsx — EL-01 PR2: khung khu đào tạo nội bộ
// (e-learning.satarobo.vn). Route group thứ 6 trong cùng app Next.js (QĐ-CDA-01).
//
// GATE BỐN TẦNG, xếp theo thứ tự rẻ → đắt:
//   (1) chưa login                → /login
//   (2) cờ ELEARNING_ENABLED OFF  → về khu hiện tại (staff → admin, PARENT → portal)
//   (3) PARENT-thuần              → portal (đào tạo nội bộ không dành cho phụ huynh)
//   (4) KHÔNG có hồ sơ nhân sự    → trang từ chối có câu chữ rõ (QĐ-CDA-10)
//
// Tầng (1)–(3) trùng với `decideRoute()` ở tầng middleware — cố ý lặp lại
// (defense-in-depth như admin/teacher): middleware chỉ thấy JWT, còn tầng này chạy
// trong RSC nên là chỗ DUY NHẤT chạm được DB.
//
// UI: shadcn thuần — KHÔNG Magic UI / Framer Motion / Recharts (ESLint chặn theo
// khối glob `app/(elearning)/**` thêm ở EL-07).
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasStaffRole } from "@/lib/auth/permissions";
import { isElearningEnabled } from "@/lib/flags";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";

export const dynamic = "force-dynamic";

export const metadata = {
  // Nhãn NGƯỜI DÙNG thấy là "Học tập nội bộ" (AC1) — trùng với mục menu họ vừa bấm.
  // "Đào tạo nội bộ" chỉ còn dùng trong tài liệu/tên job CI: nó trùng tên phòng Đào tạo
  // nên người dùng đọc thành "khu của phòng Đào tạo" thay vì "chỗ tôi học".
  title: "Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function ElearningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // 2-phase: cờ OFF → khu chưa mở. Giữ nguyên hành vi hiện tại của mọi người.
  if (!isElearningEnabled()) {
    redirect(hasStaffRole(session.user) ? "/dashboard" : "/portal");
  }

  // QĐ-7: EMP = mọi vai staff. Chỉ PARENT-thuần bị đẩy về portal.
  if (!hasStaffRole(session.user)) redirect("/portal");

  // ── Gate hồ sơ nhân sự (QĐ-CDA-10) ────────────────────────────────────────
  // Cỗ máy giao bài nhắm vào `Employee`. Trên prod (đo 20/08/2026) có 24 tài khoản
  // staff nhưng chỉ 14 hồ sơ nhân sự — 9 tài khoản chênh ra sẽ KHÔNG BAO GIỜ được
  // giao bài nhưng vẫn vào được khu: một khu trống với người không có việc gì làm ở
  // đó, và một lỗ hổng đếm khi báo cáo tính mẫu số. QĐ-CDA-10 chốt đường (a): chặn
  // ở cổng, không dựng khái niệm "người học không thuộc tổ chức".
  //
  // ⚠️ `bypass: true` là CÓ CHỦ ĐÍCH và an toàn, không phải đường tắt:
  //   • Đây là tra CHÍNH MÌNH, khoá theo quan hệ 1-1 `userAccount.id` (unique) ⇒
  //     truy vấn này về bản chất chỉ trả về đúng dòng của người đang đăng nhập,
  //     không có đường nào lộ chéo cơ sở.
  //   • Nếu đi `scopedDb` thường thì DÍNH BẪY: `Employee` nằm trong `SCOPED_MODELS`
  //     nhưng KHÔNG nằm trong `NULL_IS_GLOBAL_MODELS`, mà trên prod có 10/14 người
  //     mang `centerId = null` (nhân sự Hội sở — thiết kế đúng, xem
  //     `app/(admin)/admin/nhan-su/actions.ts:220-222`). Người bị scope theo cơ sở
  //     tra hồ sơ của chính mình sẽ nhận `null` và **bị chặn khỏi khu học của mình**.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor, { bypass: true });
  const employee = await sdb.employee.findFirst({
    where: {
      userAccount: { id: session.user.id },
      isActive: true,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  // KHÔNG redirect về /login — tài khoản hợp lệ, chỉ thiếu hồ sơ. Redirect sẽ tạo
  // vòng lặp câm: /login thấy đã đăng nhập nên đẩy ngược lại đây.
  if (!employee) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
        <h1 className="text-xl font-semibold">Chưa mở được khu đào tạo</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Tài khoản của bạn chưa được gắn với hồ sơ nhân sự, nên hệ thống chưa biết bạn
          thuộc phòng ban và cơ sở nào để giao bài học.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Vui lòng liên hệ phòng Nhân sự để được bổ sung hồ sơ. Sau khi có hồ sơ, bạn
          đăng nhập lại là vào được.
        </p>
      </main>
    );
  }

  return <>{children}</>;
}
