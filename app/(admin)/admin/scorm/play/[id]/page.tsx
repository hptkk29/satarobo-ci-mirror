// app/(admin)/admin/scorm/play/[id]/page.tsx — R7-12: màn hình GV mở bài SCORM.
// Server: resolve gói + buổi → gate canOpenScorm (GV phân công ∪ training:manage),
// ghi ScormAccessLog, cấp vé TTL 10p, render player (blur/watermark client).
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ipKhachHang } from "@/lib/security/client-ip";
import { scopedDb } from "@/lib/db-scope";
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
  searchParams: Promise<{ sessionId?: string }>;
}

export default async function ScormPlayPage({ params, searchParams }: PageProps) {
  if (!isScormEnabled()) notFound();

  const { id } = await params;
  const { sessionId: rawSessionId } = await searchParams;
  const sessionId = rawSessionId?.trim() || null;

  const session = await auth();
  if (!session?.user) notFound(); // layout admin đã redirect /login
  const actor = await resolveActor(session.user.id);
  // SCORM/ClassSession/User không center-scoped → scopedDb pass-through (rule R6-F1).
  const sdb = scopedDb(actor);

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
  if (!pkg || !pkg.launchUrl) notFound();

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
      select: { curriculumId: true, curriculum: { select: { courseId: true } } },
    });
    if (lessonInfo) {
      const teaches = await sdb.class.findFirst({
        where: {
          deletedAt: null,
          AND: [
            { OR: [{ teacherId: actor.userId }, { assistantId: actor.userId }] },
            {
              OR: [
                { curriculumId: lessonInfo.curriculumId },
                { curriculumId: null, courseId: lessonInfo.curriculum.courseId },
              ],
            },
          ],
        },
        select: { id: true },
      });
      canView = Boolean(teaches);
    }
  }
  if (!canView) notFound();

  // GV chỉ mở gói đã PUBLISHED; người quản lý đào tạo xem thử TESTING/PUBLISHED.
  const canManage = canManageTraining(actor);
  if (pkg.status !== "PUBLISHED" && !canManage) notFound();
  if (pkg.status !== "PUBLISHED" && pkg.status !== "TESTING") notFound();

  // Ghi nhật ký mở (truy vết — không chặn dạy học).
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

  // Danh tính cho watermark (employeeCode + tên).
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
      />
    );
  }

  // Tiến độ giảng của GV (resume) — theo (gói, GV, buổi). KHÔNG đụng HV/học bạ.
  const attempt = await sdb.scormAttempt.findFirst({
    where: { packageId: pkg.id, userId: session.user.id, classSessionId: sessionId },
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
      ? COMPLETION_TO_SCORM[attempt.completion] ?? "not attempted"
      : "not attempted",
    lessonLocation: attempt?.lessonLocation ?? "",
    suspendData: attempt?.suspendData ?? "",
    scoreRaw: attempt?.scoreRaw != null ? String(attempt.scoreRaw) : "",
  };
  const statusLabel = attempt
    ? COMPLETION_VI[attempt.completion] ?? attempt.completion
    : undefined;
  // `timeZone` là BẮT BUỘC: đây là Server Component, Vercel chạy tiến trình giờ **UTC**
  // (máy dev +07 nên không lộ ra) ⇒ thiếu nó là người dùng đọc "lần mở gần nhất" lệch 7 tiếng.
  // `lastAccessedAt` là DateTime — mốc thời gian THẬT, khác hẳn cột `@db.Date` (ngày trần,
  // phải giữ `timeZone: "UTC"`). Đừng đổi hai loại này cho nhau: lệch nguyên một ngày.
  // Trang GV app/(teacher)/teacher/scorm/play/[id]/page.tsx format y hệt — sửa THÀNH CẶP,
  // vá một bên thôi thì hai màn cùng dữ liệu hiện hai giờ khác nhau.
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
    />
  );
}
