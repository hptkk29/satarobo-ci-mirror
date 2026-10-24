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
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasStaffRole } from "@/lib/auth/permissions";
import { checkSessionLiveness } from "@/lib/auth/live-session";
import { isElearningEnabled, isElearningEvalLinkEnabled } from "@/lib/flags";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { can } from "@/lib/auth/can";

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

  // Phiên còn SỐNG so với DB (SEC-M11). JWT mặc định sống 30 ngày; tài khoản vừa bị khoá,
  // đổi mật khẩu hoặc thu quyền vẫn đi qua `auth()` cho tới khi JWT hết hạn tự nhiên. Admin,
  // teacher và portal đều chặn ở layout; thiếu ở đây là khu duy nhất cho người đã bị đuổi
  // khỏi hệ thống vẫn đọc được bài, báo cáo và tệp đào tạo nội bộ (kiểm toán 23/10/2026).
  const liveness = await checkSessionLiveness(session.user.id, session.user.tokenVersion);
  if (!liveness.live) redirect(`/dang-xuat?reason=${liveness.reason}`);

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

  // ⚠️ THANH ĐIỀU HƯỚNG — khu này TỪNG KHÔNG CÓ CÁI NÀO.
  //
  // Hệ quả đo được: mọi màn hình đã dựng (chương trình · kho câu hỏi · đề thi ·
  // khung chấm · hai hàng đợi chấm · báo cáo) chỉ tới được bằng cách gõ tay địa chỉ,
  // hoặc qua vài link chéo giữa chính các màn con của chúng. Một module gần đủ mã mà
  // chưa ai đi hết được một vòng nào.
  //
  // ⚠️ Gác theo QUYỀN, không hiện hết cho mọi người: một người học thuần thấy mục
  // "Chấm bài" là thấy một cánh cửa họ mở ra sẽ bị từ chối — và họ sẽ nghĩ mình mất
  // quyền chứ không nghĩ mục đó không dành cho mình.
  const soan = can(actor, "elearning:content:author");
  const cham = can(actor, "elearning:exam:grade");
  const giao = can(actor, "elearning:assignment:create");
  const baoCao = can(actor, "elearning:progress:view-all");
  // F-01 — Quản lý cơ sở chỉ có view-team: một lối vào duy nhất (R1, đã scope theo cơ sở), không thấy R4/R5/R7/Chứng nhận…
  const baoCaoDoi = !baoCao && can(actor, "elearning:progress:view-team");
  const quanLyYeuCau = can(actor, "elearning:requirement:manage");
  const quanLyChuongTrinh = can(actor, "elearning:program:manage");

  const muc: { href: string; nhan: string }[] = [
    { href: "/elearning", nhan: "Khoá của tôi" },
    ...(soan ? [{ href: "/elearning/chuong-trinh", nhan: "Chương trình" }] : []),
    // EL-21 — mức gắn đánh giá. Gác bằng `program:manage` (không mở khoá thứ 18) VÀ cờ riêng
    // `ELEARNING_EVAL_LINK_ENABLED` (mặc định OFF — đặc tả EL-21 mục 7).
    ...(quanLyChuongTrinh && isElearningEvalLinkEnabled()
      ? [{ href: "/elearning/muc-danh-gia", nhan: "Mức đánh giá" }]
      : []),
    // EL-18 — cỗ máy tự động hoá. Hiện cho cả người chỉ xem báo cáo: nhật ký thi hành
    // là chỗ trả lời "vì sao người này được giao khoá đó", và người đọc báo cáo cần
    // tới được nó. Nút bật/tắt bên trong mới gác bằng `program:manage`.
    ...(quanLyChuongTrinh || baoCao
      ? [{ href: "/elearning/tu-dong-hoa", nhan: "Tự động hoá" }]
      : []),
    ...(giao ? [{ href: "/elearning/giao-bai", nhan: "Giao bài" }] : []),
    ...(cham ? [{ href: "/elearning/cham-bai-tap", nhan: "Chấm bài" }] : []),
    // EL-17 — ma trận và yêu cầu. Mục "Yêu cầu" hiện cho CẢ người chỉ xem được: họ
    // cần biết nghĩa vụ nào đang áp cho người của mình, kể cả khi không ra được
    // nghĩa vụ mới. Nút khai bên trong màn mới gác bằng `requirement:manage`.
    ...(baoCao || quanLyYeuCau
      ? [{ href: "/elearning/ma-tran", nhan: "Ma trận" }]
      : []),
    ...(baoCao || quanLyYeuCau
      ? [{ href: "/elearning/yeu-cau", nhan: "Yêu cầu" }]
      : []),
    // EL-16 — dùng CHUNG khoá xem tiến độ toàn hệ với báo cáo: ai xem được ai đã học
    // gì thì cũng xem được ai đã có chứng nhận gì. Nút THU HỒI bên trong màn đó mới
    // gác bằng `certificate:revoke`.
    ...(baoCao ? [{ href: "/elearning/chung-nhan", nhan: "Chứng nhận" }] : []),
    ...(baoCao ? [{ href: "/elearning/bao-cao", nhan: "Báo cáo" }] : []),
    ...(baoCaoDoi ? [{ href: "/elearning/bao-cao", nhan: "Báo cáo đội" }] : []),
    // EL-17 — R4 (theo phòng ban/cơ sở) và R5 (kết quả kiểm tra + phân tích câu hỏi).
    // Hai báo cáo này KHÔNG có lối vào nào khác: không nối vào đây thì chúng chỉ tới
    // được bằng cách gõ tay địa chỉ.
    ...(baoCao ? [{ href: "/elearning/bao-cao-r4", nhan: "Theo phòng ban" }] : []),
    ...(baoCao ? [{ href: "/elearning/bao-cao-r5", nhan: "Kết quả thi" }] : []),
    // EL-20 — R7 hiệu quả đào tạo (Kirkpatrick + ảnh chụp chỉ số).
    ...(baoCao ? [{ href: "/elearning/bao-cao-r7", nhan: "Hiệu quả" }] : []),
  ];

  return (
    <>
      <nav className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-sm">
          {muc.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              {m.nhan}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </>
  );
}
