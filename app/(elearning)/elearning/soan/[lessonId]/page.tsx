import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Khoi, QuayLai, TrangQuanTri, type DoRong } from "../../_components/ui/trang";
import { LessonEditor } from "../_components/lesson-editor";
import { VideoUploader } from "../_components/video-uploader";
import { CueEditor } from "../_components/cue-editor";
import { QuizLessonEditor } from "../_components/quiz-lesson-editor";
import { TaskLessonEditor } from "../_components/task-lesson-editor";
import { AttendancePanel } from "../_components/attendance-panel";
import { cueInlineSchema } from "@/lib/elearning/lesson-cue";

/**
 * EL-04 — TRANG SOẠN MỘT BÀI ĐỌC.
 *
 * Gate ở đây là `elearning:content:author` — KHÁC `elearning:lesson:learn`. Người
 * học không được mở trình soạn, và người soạn không cần lượt ghi danh nào.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Soạn bài | Sata Robo",
  robots: { index: false, follow: false },
};

/** Đầu trang chung của MỌI loại bài: đường về khoá + tiêu đề (một `h1` mỗi trang) + vị trí bài trong khoá. */
function KhungSoan({
  rong = "hep",
  courseId,
  tieuDe,
  viTri,
  children,
}: {
  rong?: DoRong;
  courseId: string;
  tieuDe: string;
  viTri: string;
  children: React.ReactNode;
}) {
  return (
    <TrangQuanTri rong={rong}>
      <div>
        <QuayLai href={`/elearning/soan-khoa/${courseId}`}>Về dàn bài của khoá</QuayLai>
        <PageHeader className="mb-0 mt-1" title={tieuDe} subtitle={viTri} />
      </div>
      {children}
    </TrangQuanTri>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);

  // Gate ở TRANG, không chỉ ở action: để trang mở được rồi mới báo lỗi lúc bấm
  // Lưu là bắt người ta soạn xong mới biết mình không có quyền.
  if (!can(actor, "elearning:content:author")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Soạn bài" />
        <NoPermission permission="elearning:content:author" what="màn soạn bài" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const lesson = await db.trnLesson.findFirst({
    where: { id: lessonId, deletedAt: null },
    select: {
      id: true,
      title: true,
      kind: true,
      contentMd: true,
      videoKey: true,
      examId: true,
      // Thiếu trường này thì nhánh `TASK` đọc `undefined` và ô chọn khung luôn
      // hiện "chưa gắn", kể cả bài đã gắn.
      rubricId: true,
      cues: {
        select: { id: true, atSec: true, blocking: true, inlineJson: true },
        orderBy: { atSec: "asc" },
      },
      _count: { select: { progress: true } },
      durationSec: true,
      module: {
        select: {
          title: true,
          // Cần cho nhánh `LIVE_SESSION`: danh sách người được giao khoá này.
          courseId: true,
          course: { select: { title: true } },
        },
      },
    },
  });

  if (!lesson) {
    return (
      <TrangQuanTri rong="hep">
        <QuayLai href="/elearning/soan-khoa">Danh sách khoá</QuayLai>
        <EmptyState
          title="Không tìm thấy bài học"
          description="Bài không tồn tại, đã bị xoá hoặc không thuộc phạm vi của bạn."
        />
      </TrangQuanTri>
    );
  }
  // EL-10 — bài VIDEO có màn riêng: tải tệp, không có trình soạn Markdown.
  //
  // ⚠️ Mở màn SOẠN cho video KHÔNG có nghĩa là mở màn HỌC — hai chặn RỜI NHAU.
  // (EL-11 đã mở nhánh VIDEO ở trang học, nên nay cả hai đều mở.)
  if (lesson.kind === "VIDEO") {
    return (
      <KhungSoan
        courseId={lesson.module.courseId}
        tieuDe={lesson.title}
        viTri={`${lesson.module.course.title} · ${lesson.module.title} · Bài video`}
      >
        <VideoUploader
          lessonId={lesson.id}
          title={lesson.title}
          videoKeyHienCo={lesson.videoKey}
          durationSecHienCo={lesson.durationSec}
        />

        <Khoi>
          <CueEditor
            lessonId={lesson.id}
            durationSec={lesson.durationSec}
            soNguoiHoc={lesson._count.progress}
            cues={lesson.cues.map((c) => {
              // Đọc nội dung câu hỏi để HIỆN TÊN. Câu hỏng khuôn vẫn phải liệt kê
              // ra được — giấu nó đi là để một bản ghi bẩn nằm mãi mà không ai
              // xoá nổi, vì không ai thấy nó tồn tại.
              const q = cueInlineSchema.safeParse(c.inlineJson);
              return {
                id: c.id,
                atSec: c.atSec,
                blocking: c.blocking,
                cauHoi: q.success ? q.data.question : "(câu hỏi hỏng — nên xoá)",
                loai: q.success ? q.data.type : "?",
              };
            })}
          />
        </Khoi>
      </KhungSoan>
    );
  }

  // ── Bài KIỂM TRA (EL-14d) — gắn đề ────────────────────────────────────────
  if (lesson.kind === "QUIZ") {
    const cacDe = await db.trnExam.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        title: true,
        maxScore: true,
        passScore: true,
        _count: { select: { questions: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return (
      <KhungSoan
        courseId={lesson.module.courseId}
        tieuDe={lesson.title}
        viTri={`${lesson.module.course.title} · ${lesson.module.title} · Bài kiểm tra`}
      >
        <Khoi tieuDe="Đề thi của bài">
          <QuizLessonEditor
            lessonId={lesson.id}
            examIdHienCo={lesson.examId}
            cacDe={cacDe.map((d) => ({
              id: d.id,
              title: d.title,
              soCau: d._count.questions,
              maxScore: d.maxScore,
              passScore: d.passScore,
            }))}
          />
        </Khoi>
      </KhungSoan>
    );
  }

  if (lesson.kind === "TASK") {
    const cacKhung = await db.trnRubric.findMany({
      where: { deletedAt: null, status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        title: true,
        totalPoints: true,
        passPoints: true,
        _count: { select: { criteria: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return (
      <KhungSoan
        courseId={lesson.module.courseId}
        tieuDe={lesson.title}
        viTri={`${lesson.module.course.title} · ${lesson.module.title} · Bài tập`}
      >
        <Khoi tieuDe="Khung chấm của bài">
          <TaskLessonEditor
            lessonId={lesson.id}
            rubricIdHienCo={lesson.rubricId}
            cacKhung={cacKhung.map((k) => ({
              id: k.id,
              code: k.code,
              title: k.title,
              soTieuChi: k._count.criteria,
              totalPoints: k.totalPoints,
              passPoints: k.passPoints,
            }))}
          />
        </Khoi>
      </KhungSoan>
    );
  }

  if (lesson.kind === "LIVE_SESSION") {
    // Danh sách người được giao khoá này + trạng thái điểm danh của từng người.
    const ghiDanh = await db.trnEnrollment.findMany({
      where: { courseId: lesson.module.courseId, status: { not: "REVOKED" } },
      select: { id: true, userId: true },
      take: 300,
    });
    const [nguoi, tienDo] = await Promise.all([
      db.user.findMany({
        where: { id: { in: [...new Set(ghiDanh.map((g) => g.userId))] } },
        select: { id: true, name: true, email: true },
      }),
      db.trnLessonProgress.findMany({
        where: {
          lessonId: lesson.id,
          enrollmentId: { in: ghiDanh.map((g) => g.id) },
        },
        select: { enrollmentId: true, status: true, attendanceMarkedByUserId: true },
      }),
    ]);
    const tenCua = new Map(nguoi.map((u) => [u.id, u.name ?? u.email ?? u.id]));
    const tdCua = new Map(tienDo.map((t) => [t.enrollmentId, t]));
    const tenNguoiTick = new Map(nguoi.map((u) => [u.id, u.name ?? u.email ?? u.id]));

    return (
      <KhungSoan
        courseId={lesson.module.courseId}
        tieuDe={lesson.title}
        viTri={`${lesson.module.course.title} · ${lesson.module.title} · Buổi trực tiếp`}
      >
        <Khoi tieuDe="Điểm danh buổi trực tiếp">
          <AttendancePanel
            lessonId={lesson.id}
            dsHoc={ghiDanh.map((g) => {
              const td = tdCua.get(g.id);
              return {
                enrollmentId: g.id,
                tenNguoiHoc: tenCua.get(g.userId) ?? g.userId,
                daDu: td?.status === "DONE",
                nguoiTick: td?.attendanceMarkedByUserId
                  ? (tenNguoiTick.get(td.attendanceMarkedByUserId) ?? null)
                  : null,
              };
            })}
          />
        </Khoi>
      </KhungSoan>
    );
  }

  if (lesson.kind !== "READ") {
    return (
      <KhungSoan
        courseId={lesson.module.courseId}
        tieuDe={lesson.title}
        viTri={`${lesson.module.course.title} · ${lesson.module.title}`}
      >
        <EmptyState
          title="Loại bài này chưa có trình soạn"
          description={`Trình soạn này chỉ dùng cho bài dạng đọc. Bài hiện tại là ${lesson.kind}.`}
        />
      </KhungSoan>
    );
  }

  return (
    <KhungSoan
      rong="rong"
      courseId={lesson.module.courseId}
      tieuDe="Soạn bài đọc"
      viTri={`${lesson.module.course.title} · ${lesson.module.title}`}
    >
      <LessonEditor
        lessonId={lesson.id}
        titleBanDau={lesson.title}
        contentBanDau={lesson.contentMd ?? ""}
      />
    </KhungSoan>
  );
}
