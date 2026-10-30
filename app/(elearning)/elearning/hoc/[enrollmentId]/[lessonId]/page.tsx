import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import { checkContentAccess } from "@/lib/elearning/content-gate";
import { getPolicyAcceptance } from "@/lib/elearning/policy-acceptance";
import { demoteH1 } from "@/lib/elearning/reading";
import { ReadingTracker } from "../../_components/reading-tracker";
import { VideoPlayer } from "../../_components/video-player";
import { kyVeMedia } from "@/lib/elearning/media-ticket";
import { TOC_DO_TOI_DA } from "@/lib/elearning/video-heartbeat-contract";
import { nenNopBai } from "@/lib/elearning/task-view";
import { TaskSubmitter } from "../../_components/task-submitter";
import { vaySaoChuaMo } from "@/lib/elearning/lesson-kind";
import { ExamRunner } from "../../_components/exam-runner";
import { nenLamBai } from "@/lib/elearning/exam-view";

/**
 * EL-04 — TRANG ĐỌC MỘT BÀI.
 *
 * ⚠️ Trang này KHÔNG trả một byte nội dung nào trước khi qua đủ chuỗi cổng ở
 * server. Lọc ở client là trang trí: nội dung đã nằm trong HTML thì mở DevTools
 * là đọc được, không cần lý do, không để lại dòng audit nào.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Học bài | Sata Robo",
  robots: { index: false, follow: false },
};

/** Màn từ chối dùng chung — cùng một hình dạng cho mọi lý do. */
function TuChoi({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg border border-border px-4 py-2 text-sm"
      >
        Về trang chủ khu đào tạo
      </Link>
    </div>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ enrollmentId: string; lessonId: string }>;
}) {
  const { enrollmentId, lessonId } = await params;
  const session = await auth();
  // Layout của khu đã gác đăng nhập; đây là lớp thứ hai, cố ý không tin lớp trên.
  if (!session?.user?.id) {
    return <TuChoi title="Chưa đăng nhập" detail="Đăng nhập rồi mở lại trang này." />;
  }
  const actor = await resolveActor(session.user.id);
  // Đi qua `scopedDb`, không `@/lib/db` trần — ESLint chặn ở route group này, và
  // chặn đúng: `TrnEnrollment` và `TrnCourse` đều ∈ SCOPED_MODELS nên đọc trần là
  // bỏ qua cách ly cơ sở. `TrnLessonProgress` không có cột đơn vị nên đi qua
  // nguyên vẹn — cách ly của nó đến từ `enrollmentId` đã lọc ở trên.
  const db = scopedDb(actor);

  // ── Sở hữu: khoá theo CHÍNH userId, không tin id trên URL ──────────────────
  const enrollment = await db.trnEnrollment.findFirst({
    where: { id: enrollmentId, userId: session.user.id },
    select: {
      id: true,
      courseId: true,
      status: true,
      // Hai cột của lượt giao quyết định cách trình phát cư xử. Đọc ở đây thay vì
      // để trình phát tự đoán: đoán mặc định "cho tua" là vô hiệu hoá cơ chế cho
      // mọi lượt giao mà không ai thấy.
      assignment: { select: { blockSeek: true, maxPlaybackRate: true } },
    },
  });
  // "Không tồn tại" và "không phải của mình" trả CÙNG một màn: phân biệt là nói
  // cho người dò biết id nào có thật.
  if (!enrollment || enrollment.status === "REVOKED") {
    return (
      <TuChoi
        title="Không tìm thấy bài học"
        detail="Lượt học này không tồn tại hoặc không thuộc về bạn."
      />
    );
  }

  // ── Bài phải thuộc khoá của lượt này ──────────────────────────────────────
  const lesson = await db.trnLesson.findFirst({
    where: {
      id: lessonId,
      deletedAt: null,
      module: { courseId: enrollment.courseId },
    },
    select: {
      id: true,
      title: true,
      kind: true,
      contentMd: true,
      minReadSeconds: true,
      videoKey: true,
      examId: true,
      // ⚠️ Thiếu trường này thì nhánh `TASK` đọc `undefined` và mọi bài tập rơi
      // vào nhánh "chưa gắn khung" — im lặng, cho cả những bài đã gắn.
      rubricId: true,
      captionKey: true,
      durationSec: true,
      module: { select: { title: true, course: { select: { title: true } } } },
    },
  });
  if (!lesson) {
    return (
      <TuChoi
        title="Không tìm thấy bài học"
        detail="Lượt học này không tồn tại hoặc không thuộc về bạn."
      />
    );
  }

  // ── Cổng nội dung ─────────────────────────────────────────────────────────
  const course = await db.trnCourse.findUnique({
    where: { id: enrollment.courseId },
    select: {
      id: true,
      visibility: true,
      selfEnrollEnabled: true,
      securityLevel: true,
      versions: { where: { status: "PUBLISHED" }, select: { id: true }, take: 1 },
    },
  });
  const tuChoi =
    course == null
      ? { code: "NOT_FOUND", message: "Không tìm thấy khoá học" }
      : checkContentAccess({
          actor,
          course: {
            id: course.id,
            visibility: course.visibility,
            selfEnrollEnabled: course.selfEnrollEnabled,
            securityLevel: course.securityLevel,
            hasPublishedVersion: course.versions.length > 0,
          },
          hasEnrollment: true,
        });
  if (tuChoi) {
    return <TuChoi title="Chưa mở được bài này" detail={tuChoi.message} />;
  }

  // ── Chính sách: chưa xác nhận thì KHÔNG hiện nội dung ─────────────────────
  // Cổng đường GHI đã có ở service, nhưng nếu vẫn hiện nội dung ở đây thì người
  // chưa đồng ý vẫn đọc được — chỉ là không được ghi nhận. Đó là thu nửa vời:
  // họ mất công đọc mà hệ thống coi như chưa học.
  const policy = await getPolicyAcceptance(session.user.id);
  if (!policy.accepted) {
    return (
      <TuChoi
        title="Cần xác nhận trước khi bắt đầu"
        detail="Vào mục Dữ liệu của tôi để xem hệ thống ghi nhận những gì trong lúc bạn học, rồi xác nhận."
      />
    );
  }

  // ── Bài VIDEO (EL-11) ─────────────────────────────────────────────────────
  if (lesson.kind === "VIDEO") {
    if (!lesson.videoKey || !lesson.durationSec) {
      // Bài khai là video mà chưa có tệp: nói thẳng thay vì hiện khung phát rỗng
      // rồi để người học tưởng máy mình hỏng.
      return (
        <TuChoi
          title="Bài này chưa có video"
          detail="Người soạn chưa tải tệp lên. Báo với Đào tạo để họ hoàn thiện bài."
        />
      );
    }

    const tienDo = await db.trnLessonProgress.findUnique({
      where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id } },
      select: { coveredSec: true, maxPositionSec: true },
    });

    // ⚠️ Vé phát ký ở ĐÂY và chỉ ở đây. Đây là chỗ duy nhất đã đi qua trọn chuỗi
    // cổng (sở hữu → chính sách → cổng nội dung), nên nó là chỗ duy nhất đủ tư
    // cách nói "người này được xem bài này". Ký ở một API riêng nghĩa là dựng lại
    // cả chuỗi cổng đó lần thứ hai, và bản thứ hai sẽ lệch.
    const ve = kyVeMedia({ lessonId: lesson.id, userId: session.user.id });

    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <nav className="mb-2 text-xs text-muted-foreground">
          {lesson.module.course.title} · {lesson.module.title}
        </nav>
        <h1 className="text-2xl font-bold">{lesson.title}</h1>

        <div className="mt-6">
          <VideoPlayer
            enrollmentId={enrollment.id}
            lessonId={lesson.id}
            videoKey={lesson.videoKey}
            captionKey={lesson.captionKey}
            ve={ve}
            // Nhãn hình mờ mang ĐỊNH DANH người xem. Mục đích không phải chặn quay
            // màn hình — không cơ chế web nào chặn được — mà là làm bản quay lộ ra
            // ai đã quay.
            nhanMo={`${session.user.name ?? ""} · ${session.user.email ?? ""}`}
            durationSec={lesson.durationSec}
            coveredSecBanDau={tienDo?.coveredSec ?? 0}
            maxPositionSecBanDau={tienDo?.maxPositionSec ?? 0}
            chanTua={enrollment.assignment?.blockSeek ?? true}
            tocDoToiDa={enrollment.assignment?.maxPlaybackRate ?? TOC_DO_TOI_DA}
          />
        </div>
      </div>
    );
  }

  // ── Bài KIỂM TRA (EL-14d) ─────────────────────────────────────────────────
  if (lesson.kind === "QUIZ") {
    if (!lesson.examId) {
      return (
        <TuChoi
          title="Bài kiểm tra chưa có đề"
          detail="Người soạn chưa gắn đề cho bài này. Báo với Đào tạo để họ hoàn thiện."
        />
      );
    }
    const nen = await nenLamBai({
      db,
      userId: session.user.id,
      enrollmentId: enrollment.id,
      examId: lesson.examId,
    });
    if (!nen) {
      return (
        <TuChoi
          title="Chưa mở được bài kiểm tra"
          detail="Đề chưa được kích hoạt. Báo với Đào tạo."
        />
      );
    }

    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <nav className="mb-2 text-xs text-muted-foreground">
          {lesson.module.course.title} · {lesson.module.title}
        </nav>
        <h1 className="mb-4 text-2xl font-bold">{lesson.title}</h1>
        <ExamRunner
          enrollmentId={enrollment.id}
          lessonId={lesson.id}
          tenDe={nen.tenDe}
          durationMin={nen.durationMin}
          passScore={nen.passScore}
          maxScore={nen.maxScore}
          soLuotConLai={nen.soLuotConLai}
          luotDangLam={nen.luotDangLam}
          ketQuaGanNhat={nen.ketQuaGanNhat}
        />
      </div>
    );
  }

  if (lesson.kind === "LIVE_SESSION") {
    // Buổi trực tiếp KHÔNG có gì để người học bấm: điểm danh do giảng viên tick
    // (`lib/elearning/equivalence.ts`). Nói rõ, thay vì để họ tưởng bài hỏng.
    return (
      <TuChoi
        title="Buổi học trực tiếp"
        detail="Bài này ghi nhận bằng điểm danh của giảng viên, không có nội dung để xem ở đây."
      />
    );
  }

  if (lesson.kind === "TASK") {
    if (!lesson.rubricId) {
      return (
        <TuChoi
          title="Bài tập chưa có khung chấm"
          detail="Người soạn chưa gắn khung chấm cho bài này. Báo với Đào tạo để họ hoàn thiện."
        />
      );
    }
    const nen = await nenNopBai({
      db,
      userId: session.user.id,
      lessonId: lesson.id,
      rubricId: lesson.rubricId,
    });
    if (!nen) {
      return (
        <TuChoi
          title="Chưa mở được bài tập"
          detail="Không đọc được khung chấm của bài này. Báo với Đào tạo."
        />
      );
    }

    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <nav className="mb-2 text-xs text-muted-foreground">
          {lesson.module.course.title} · {lesson.module.title}
        </nav>
        <h1 className="mb-4 text-2xl font-bold">{lesson.title}</h1>
        {lesson.contentMd ? (
          <p className="mb-4 whitespace-pre-wrap rounded-md border p-3 text-sm">
            {lesson.contentMd}
          </p>
        ) : null}
        <TaskSubmitter
          enrollmentId={enrollment.id}
          lessonId={lesson.id}
          nen={nen}
        />
      </div>
    );
  }

  if (lesson.kind !== "READ") {
    // Nói RÕ loại nào và chờ ticket nào — câu chung chung làm người học tưởng máy
    // mình hỏng và đi báo sai chỗ.
    return <TuChoi title="Loại bài này chưa mở" detail={vaySaoChuaMo(lesson.kind)} />;
  }

  const progress = await db.trnLessonProgress.findUnique({
    where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id } },
    select: { readSeconds: true, scrollMaxPct: true, verifiedAt: true },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <nav className="mb-2 text-xs text-muted-foreground">
        {lesson.module.course.title} · {lesson.module.title}
      </nav>
      {/* `<h1>` của trang là TÊN BÀI. Vì thế nội dung bên dưới hạ `#` xuống `##`
          — vừa giữ đúng thứ bậc tiêu đề cho trình đọc màn hình, vừa tránh bị
          `h1: () => null` của renderer chung nuốt mất. */}
      <h1 className="text-2xl font-bold">{lesson.title}</h1>

      <div className="mt-6">
        <MarkdownRenderer content={demoteH1(lesson.contentMd ?? "")} />
      </div>

      <ReadingTracker
        enrollmentId={enrollment.id}
        lessonId={lesson.id}
        readSecondsBanDau={progress?.readSeconds ?? 0}
        scrollMaxPctBanDau={progress?.scrollMaxPct ?? 0}
        minReadSeconds={lesson.minReadSeconds}
        daXong={progress?.verifiedAt != null}
      />
    </div>
  );
}
