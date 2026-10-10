// app/(teacher)/teacher/scorm/play/[id]/page.tsx — #06 (L6): viewer SCORM/PDF trên site GV.
//
// MIRROR trang admin app/(admin)/admin/scorm/play/[id]/page.tsx (R7-12) — GIỮ NGUYÊN
// toàn bộ gate canOpenScorm (GV phân công ∪ training:manage) + ScormAccessLog +
// vé TTL 10p + watermark/blur client (#14, câu 56). Khác biệt:
//   • fail-gate → redirect("/teacher") (home GV) thay vì notFound() của khu admin;
//   • chưa login → return null (layout teacher đã gate login + role TEACHER);
//   • khung chiếu `fit="viewport"` + lối thoát `?from=` — xem ghi chú safeExitHref bên dưới.
// TÁI DÙNG components @/components/admin/{scorm-player,pdf-slide-player,scorm-api}
// (ESLint teacher chỉ chặn magic/motion/charts/@lib/db — KHÔNG chặn components/admin;
// player POST /api/scorm/runtime + tải /api/scorm/asset/* — /api/* pass-through trên
// host giaovien nên chạy y hệt admin).
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ipKhachHang } from "@/lib/security/client-ip";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import {
  canOpenScorm,
  canManageTraining,
  type ScormClassSession,
} from "@/lib/scorm/access";
import { isScormEnabled } from "@/lib/flags";
import { signScormTicket } from "@/lib/scorm/ticket";
import { ScormPlayer } from "@/components/admin/scorm-player";
import { PdfSlidePlayer } from "@/components/admin/pdf-slide-player";
import type { ScormSeed } from "@/components/admin/scorm-api";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Trình chiếu bài giảng | Giáo viên Sata Robo",
};

/** Enum ScormCompletion → cmi.core.lesson_status (SCORM 1.2) cho seed resume. */
const COMPLETION_TO_SCORM: Record<string, string> = {
  NOT_ATTEMPTED: "not attempted",
  INCOMPLETE: "incomplete",
  COMPLETED: "completed",
  PASSED: "passed",
  FAILED: "failed",
  BROWSED: "browsed",
};

/** Nhãn trạng thái giảng (VI) cho badge GV. */
const COMPLETION_VI: Record<string, string> = {
  NOT_ATTEMPTED: "Chưa mở",
  INCOMPLETE: "Đang giảng dở",
  COMPLETED: "Đã hoàn tất",
  PASSED: "Đạt",
  FAILED: "Chưa đạt",
  BROWSED: "Đã xem qua",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sessionId?: string; from?: string }>;
}

// Khác admin ở KHUNG HÌNH: trang này nằm trong AppShell (Topbar + padding của <main>), nên
// khung trình chiếu theo luồng (`fit="inline"`, cao 100dvh−2rem) cộng thêm chiều cao topbar
// ⇒ trang cuộn dọc và slide bị bóp nhỏ. `fit="viewport"` cho khung phủ kín khung nhìn.
// Kèm lối thoát vì khung phủ kín che mất sidebar — GV không còn lối điều hướng nào.
const EXIT_FALLBACK = "/teacher";

/**
 * Chỗ quay về khi bấm "Đóng" — do NƠI MỞ truyền qua `?from=`, để GV về đúng trang
 * vừa rời (vd `/teacher/tai-lieu?courseId=…` giữ nguyên khung chương trình đang xem)
 * thay vì rơi về trang chủ và phải chọn lại khoá từ đầu.
 *
 * Từ 24/08 viewer mở CÙNG TAB, nên Back của trình duyệt cũng quay về được. Vẫn giữ
 * `from` vì nút "Đóng" cần một đích XÁC ĐỊNH: GV mở thẳng bằng URL, bấm F5, hay đi
 * vài nhịp trong viewer thì Back không còn trỏ về trang tài liệu nữa.
 * (Header `Referer` KHÔNG dùng được: nơi mở đi qua next/link — điều hướng phía client
 * không phát request HTML nào để mà có Referer.)
 *
 * `from` là dữ liệu người dùng sửa được trên URL ⇒ phải kiểm, nếu không thành lỗ
 * open-redirect (`?from=https://ke-gian.example` biến nút "Đóng" của chính site GV
 * thành bàn đạp lừa đảo). Luật: chỉ nhận đường dẫn TƯƠNG ĐỐI trong khu /teacher.
 *   • `//host` và `/\host` — trình duyệt hiểu là protocol-relative ⇒ ra ngoài. Chặn.
 *   • `\` — vài trình duyệt quy về `/`. Chặn luôn cho khỏi phải đoán.
 *   • ký tự điều khiển (\n, \r, \t) — dùng để lách bộ lọc. Chặn.
 * Không khớp thì im lặng về `/teacher`, KHÔNG báo lỗi: nút "Đóng" sai đích là phiền,
 * còn chặn cả buổi dạy vì một tham số hỏng thì tệ hơn nhiều.
 */
function safeExitHref(raw: string | undefined): string {
  const v = raw?.trim();
  if (!v || v.length > 512) return EXIT_FALLBACK;
  // "/teacher" trần, hoặc có phân tách rõ ràng phía sau. Chặn "/teacherXYZ" —
  // vẫn cùng origin nên không phải lỗ bảo mật, nhưng là 404 trá hình.
  if (v !== "/teacher" && !/^\/teacher[/?#]/.test(v)) return EXIT_FALLBACK;
  if (v.startsWith("//") || v.includes("\\")) return EXIT_FALLBACK;
  // Ký tự điều khiển (xuống dòng / tab / NUL) là mẹo quen thuộc để lách bộ lọc URL.
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return EXIT_FALLBACK;
  }
  return v;
}

export default async function TeacherScormPlayPage({
  params,
  searchParams,
}: PageProps) {
  // Fail-gate về home GV: "/teacher" chạy đúng cả trên host giaovien (isTeacherPath
  // pass-through) LẪN localhost/preview — cùng quy ước prefix /teacher như nav.
  if (!isScormEnabled()) redirect("/teacher");

  const { id } = await params;
  const { sessionId: rawSessionId, from } = await searchParams;
  const sessionId = rawSessionId?.trim() || null;
  const exitHref = safeExitHref(from);

  const session = await auth();
  if (!session?.user) return null; // layout teacher đã gate login + role TEACHER
  const actor = await resolveActor(session.user.id);
  // SCORM/ClassSession/User không center-scoped → scopedDb pass-through (rule R6-F1).
  const sdb = scopedDb(actorGiangDay(actor));

  const pkg = await sdb.scormPackage.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      name: true,
      lessonId: true,
      launchUrl: true,
      status: true,
      storagePrefix: true,
    },
  });
  if (!pkg || !pkg.launchUrl) redirect("/teacher");

  // Buổi học (nếu mở theo lớp) → xác GV phân công. Không có buổi → chỉ training:manage qua được.
  let classSession: ScormClassSession = {};
  if (sessionId) {
    const cs = await sdb.classSession.findUnique({
      where: { id: sessionId },
      select: {
        actualTeacherId: true,
        class: { select: { teacherId: true, assistantId: true } },
      },
    });
    if (cs) classSession = cs;
  }

  // Quyền mở: (a) qua buổi cụ thể (canOpenScorm), HOẶC (b) GV được phân công 1 lớp DÙNG
  // buổi này (xem slide mọi buổi lớp mình, không cần ClassSession riêng), HOẶC (c) Đào tạo.
  let canView = canOpenScorm(actor, classSession);
  if (!canView) {
    const lessonInfo = await sdb.lesson.findUnique({
      where: { id: pkg.lessonId },
      select: {
        curriculumId: true,
        curriculum: { select: { courseId: true } },
      },
    });
    if (lessonInfo) {
      const teaches = await sdb.class.findFirst({
        where: {
          deletedAt: null,
          AND: [
            {
              OR: [{ teacherId: actor.userId }, { assistantId: actor.userId }],
            },
            {
              OR: [
                { curriculumId: lessonInfo.curriculumId },
                {
                  curriculumId: null,
                  courseId: lessonInfo.curriculum.courseId,
                },
              ],
            },
          ],
        },
        select: { id: true },
      });
      canView = Boolean(teaches);
    }
  }
  // (d) Học bù (29/09/2026): GV của một case dạy bù CHƯA HUỶ dạy đúng bài này. Người dạy bù
  // thường không dạy lớp gốc nên (a)/(b) đều trượt — mà họ phải mở được bài giảng của buổi bù.
  // Hẹp đúng một bài: chỉ bài `MakeupCase.lessonId` của case mình dạy.
  if (!canView) {
    const dayBu = await sdb.makeupCase.findFirst({
      where: { teacherId: actor.userId, lessonId: pkg.lessonId, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    canView = Boolean(dayBu);
  }
  if (!canView) redirect("/teacher");

  // GV chỉ mở gói đã PUBLISHED; người quản lý đào tạo xem thử TESTING/PUBLISHED.
  const canManage = canManageTraining(actor);
  if (pkg.status !== "PUBLISHED" && !canManage) redirect("/teacher");
  if (pkg.status !== "PUBLISHED" && pkg.status !== "TESTING")
    redirect("/teacher");

  // Ghi nhật ký mở (truy vết — không chặn dạy học). GIỮ NGUYÊN như admin (#3).
  const hdrs = await headers();
  const ip = ipKhachHang(hdrs); // luật IP dùng chung — bản cũ lấy phần tử ĐẦU của XFF (khách viết)
  await sdb.scormAccessLog.create({
    data: {
      packageId: pkg.id,
      classSessionId: sessionId,
      userId: session.user.id,
      ip,
    },
  });

  // Vé mở (10 phút) — asset resolver xác quyền từng request.
  const ticket = signScormTicket(
    { packageId: pkg.id, sessionId, userId: session.user.id },
    600,
  );

  // Danh tính cho watermark (employeeCode + tên). Câu 46: chỉ danh tính GV đang
  // đăng nhập — KHÔNG có dữ liệu HV/PH nào trong payload client.
  const u = await sdb.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      employee: { select: { employeeCode: true, fullName: true } },
    },
  });
  const name = u?.employee?.fullName ?? u?.name ?? session.user.email ?? "";
  const employeeCode = u?.employee?.employeeCode ?? "";

  // Giáo án PDF: render slider pdf.js (không có runtime/tiến độ SCORM). Chung khung SlideStage.
  if (pkg.kind === "PDF") {
    return (
      <PdfSlidePlayer
        launchTicket={ticket}
        launchUrl={pkg.launchUrl}
        packageName={pkg.name}
        name={name}
        employeeCode={employeeCode}
        fit="viewport"
        exitHref={exitHref}
      />
    );
  }

  // Tiến độ giảng của GV (resume) — theo (gói, GV, buổi). KHÔNG đụng HV/học bạ.
  const attempt = await sdb.scormAttempt.findFirst({
    where: {
      packageId: pkg.id,
      userId: session.user.id,
      classSessionId: sessionId,
    },
    select: {
      completion: true,
      lessonLocation: true,
      suspendData: true,
      scoreRaw: true,
      lastAccessedAt: true,
    },
  });

  const seed: ScormSeed = {
    lessonStatus: attempt
      ? (COMPLETION_TO_SCORM[attempt.completion] ?? "not attempted")
      : "not attempted",
    lessonLocation: attempt?.lessonLocation ?? "",
    suspendData: attempt?.suspendData ?? "",
    scoreRaw: attempt?.scoreRaw != null ? String(attempt.scoreRaw) : "",
  };
  const statusLabel = attempt
    ? (COMPLETION_VI[attempt.completion] ?? attempt.completion)
    : undefined;
  // `timeZone` là BẮT BUỘC: đây là Server Component, Vercel chạy tiến trình giờ **UTC**
  // (máy dev +07 nên không lộ ra) ⇒ thiếu nó là GV đọc "lần mở gần nhất" lệch 7 tiếng.
  // `lastAccessedAt` là DateTime — mốc thời gian THẬT, khác hẳn cột `@db.Date` (ngày trần,
  // phải giữ `timeZone: "UTC"`). Đừng đổi hai loại này cho nhau: lệch nguyên một ngày.
  // Trang admin app/(admin)/admin/scorm/play/[id]/page.tsx format y hệt — sửa THÀNH CẶP.
  const lastAccessedLabel = attempt
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(attempt.lastAccessedAt)
    : undefined;

  return (
    <ScormPlayer
      launchTicket={ticket}
      launchUrl={pkg.launchUrl}
      packageName={pkg.name}
      name={name}
      employeeCode={employeeCode}
      packageId={pkg.id}
      classSessionId={sessionId}
      seed={seed}
      statusLabel={statusLabel}
      lastAccessedLabel={lastAccessedLabel}
      fit="viewport"
      exitHref={exitHref}
    />
  );
}
