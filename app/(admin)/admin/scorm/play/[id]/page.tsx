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
import { after } from "next/server";
import { lamNongGoi } from "@/lib/scorm/dem-dia";
import { signScormTicket } from "@/lib/scorm/ticket";
import { dongHoSsr } from "@/lib/scorm/do-thoi-gian";
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
  // Đồng hồ dựng trang (chỉ đo, không đổi hành vi): kết quả đi ra `data-scorm-ssr` để tách thời gian máy chủ khỏi thời gian trình duyệt. Trang GV làm y hệt.
  const dongHo = dongHoSsr();

  // 24/10/2026 — trang này chỉ hiện được sau khi CÁC lượt đi–về tới DB xong, nên các câu KHÔNG cần nhau chạy song song:
  // (params · searchParams · auth) rồi (gói · buổi · danh tính · tiến độ giảng · headers). Chỉ giữ NỐI ĐUÔI những chỗ có phụ thuộc thật:
  // actor cần phiên; cổng quyền cần gói + buổi; "GV có dạy lớp dùng bài này" cần bài của gói (nay lấy cùng câu tra gói).
  // Trang GV app/(teacher)/teacher/scorm/play/[id]/page.tsx làm y hệt — sửa THÀNH CẶP.
  const [{ id }, { sessionId: rawSessionId }, session] = await Promise.all([params, searchParams, auth()]);
  const sessionId = rawSessionId?.trim() || null;
  dongHo.moc("auth");

  if (!session?.user) notFound(); // layout admin đã redirect /login
  const actor = await resolveActor(session.user.id);
  dongHo.moc("actor");
  // SCORM/ClassSession/User không center-scoped → scopedDb pass-through (rule R6-F1).
  const sdb = scopedDb(actor);

  // Buổi học (nếu mở theo lớp) → xác GV phân công. Không có buổi → chỉ training:manage qua được.
  const taiBuoi = sessionId
    ? sdb.classSession.findUnique({
        where: { id: sessionId },
        select: {
          actualTeacherId: true,
          substituteTeacherId: true,
          class: { select: { teacherId: true, assistantId: true } },
        },
      })
    : Promise.resolve(null);

  const [pkg, cs, u, attempt, hdrs] = await Promise.all([
    sdb.scormPackage.findUnique({
      where: { id },
      select: {
        id: true,
        kind: true,
        name: true,
        lessonId: true,
        launchUrl: true,
        status: true,
        storagePrefix: true,
        // Bài của gói — để cổng "GV dạy lớp dùng bài này" khỏi tra thêm một lượt nối đuôi.
        lesson: { select: { curriculumId: true, curriculum: { select: { courseId: true } } } },
      },
    }),
    taiBuoi,
    // Danh tính cho watermark (employeeCode + tên).
    sdb.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        employee: { select: { employeeCode: true, fullName: true } },
      },
    }),
    // Tiến độ giảng của GV (resume) — theo (gói, GV, buổi). KHÔNG đụng HV/học bạ. Chỉ SCORM dùng; mã gói = tham số trang (đúng `pkg.id` khi
    // gói tồn tại — nếu không thì ra null và cổng bên dưới đã từ chối).
    sdb.scormAttempt.findFirst({
      where: { packageId: id, userId: session.user.id, classSessionId: sessionId },
      select: {
        completion: true,
        lessonLocation: true,
        suspendData: true,
        scoreRaw: true,
        lastAccessedAt: true,
      },
    }),
    headers(),
  ]);
  dongHo.moc("batch");
  if (!pkg || !pkg.launchUrl) notFound();

  let classSession: ScormClassSession = {};
  if (cs) classSession = cs;

  // Quyền mở: (a) qua buổi cụ thể (canOpenScorm), HOẶC (b) GV được phân công 1 lớp DÙNG
  // buổi này (xem slide mọi buổi lớp mình, không cần ClassSession riêng), HOẶC (c) Đào tạo.
  let canView = canOpenScorm(actor, classSession);
  if (!canView) {
    const lessonInfo = pkg.lesson;
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

  dongHo.moc("gate");

  // Ghi nhật ký mở (truy vết — không chặn dạy học). Chạy NỀN: không `await` trước khi render, và lỗi ghi KHÔNG làm hỏng việc mở bài
  // (chỉ log) — nhưng truy vết vẫn còn: lượt ghi được bắt đầu NGAY ở đây, `after()` giữ tiến trình sống tới khi nó xong.
  const ip = ipKhachHang(hdrs); // luật IP dùng chung — bản cũ lấy phần tử ĐẦU của XFF (khách viết)
  const ghiNhatKy = sdb.scormAccessLog
    .create({
      data: {
        packageId: pkg.id,
        classSessionId: sessionId,
        userId: session.user.id,
        ip,
      },
    })
    .catch((e: unknown) => {
      console.error("[scorm] không ghi được ScormAccessLog", { packageId: pkg.id, sessionId }, e);
    });
  after(() => ghiNhatKy);

  // Vé mở (10 phút) — asset resolver xác quyền từng request; viewer gia hạn chủ động qua /api/scorm/gia-han.
  // LÀM NÓNG đệm đĩa: tải cả gói về VPS ở nền, song song với việc trình duyệt dựng trang — lúc iframe xin tệp thì phần lớn đã nằm
  // trên đĩa (mỗi tệp lấy từ R2 mất ~270ms, gói thật có ~400–570 tệp). Sau khi đã trả phản hồi; không bao giờ ném.
  after(() => void lamNongGoi(pkg.storagePrefix));
  // Prefix R2 ký kèm vé: asset resolver khỏi tra DB mỗi tệp (gói thật ~400–570 tệp).
  const ticket = signScormTicket(
    { packageId: pkg.id, sessionId, userId: session.user.id, prefix: pkg.storagePrefix },
    600,
  );

  const name = u?.employee?.fullName ?? u?.name ?? session.user.email ?? "";
  const employeeCode = u?.employee?.employeeCode ?? "";

  // Giáo án PDF: render slider pdf.js (không có runtime/tiến độ SCORM). Chung khung SlideStage.
  if (pkg.kind === "PDF") {
    return (
      <PdfSlidePlayer
        packageId={pkg.id}
        launchTicket={ticket}
        launchUrl={pkg.launchUrl}
        packageName={pkg.name}
        name={name}
        employeeCode={employeeCode}
      />
    );
  }

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
      ssrTiming={dongHo.chot()}
    />
  );
}
