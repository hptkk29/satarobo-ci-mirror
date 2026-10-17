import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { CurriculumForm } from "../../_components/curriculum-form";
import { LessonList, type LessonRow } from "../../_components/lesson-list";
import { CurriculumSessionsForm } from "../../_components/curriculum-sessions-form";
import { HocPhanForm } from "../../_components/hoc-phan-form";
import { tomTatHocPhan } from "@/lib/lms/chia-hoc-phan";
import { CurriculumMergeForm } from "../../_components/curriculum-merge-form";
import {
  LessonChangeRequests,
  type ChangeRequestRow,
} from "../../_components/lesson-change-requests";
import { type LessonResourceRow, type AssignmentRow } from "../../_components/lesson-resources";
import { TrinhSuaGiaoTrinh } from "../../_components/trinh-sua-giao-trinh";
import { KhoaTienQuyet } from "../../_components/khoa-tien-quyet";
import { checkPermission } from "@/lib/auth/check-permission";
import { isScormEnabled } from "@/lib/flags";
import { isScormProcessingStale, SCORM_STALE_ERROR } from "@/lib/scorm/stale";
import { formatDateVN } from "@/lib/format/date";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sửa chương trình | Admin" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

type Tab = "noi-dung" | "thiet-lap" | "de-xuat";

export default async function EditCurriculumPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("curriculum:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = sp.tab === "thiet-lap" ? "thiet-lap" : sp.tab === "de-xuat" ? "de-xuat" : "noi-dung";

  // Nhóm 01 L1 — Curriculum/Lesson/Course = giáo trình dùng chung toàn hệ thống
  // (câu 74a), scopedDb pass-through. Assignment (qua Class scoped) lọc tay bên dưới.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [curriculum, courses, changeRequests] = await Promise.all([
    sdb.curriculum.findUnique({
      where: { id },
      include: {
        course: { select: { name: true } },
        lessons: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            curriculumId: true,
            order: true,
            title: true,
            moduleCode: true,
            description: true,
            content: true,
            duration: true,
            objectives: true,
            materials: true,
            notes: true,
            teacherGuide: true,
            expectedOutput: true,
            homeworkDefault: true,
            assessmentCriteria: true,
            status: true,
            version: true,
            archivedAt: true,
          },
        },
      },
    }),
    sdb.course.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    sdb.lessonChangeRequest.findMany({
      where: { lesson: { curriculumId: id } },
      orderBy: { createdAt: "desc" },
      include: { lesson: { select: { order: true, title: true } } },
    }),
  ]);

  if (!curriculum) notFound();

  // Tên người gửi đề xuất (requestedById = User.id, không có relation trực tiếp).
  const requesterIds = [...new Set(changeRequests.map((r) => r.requestedById))];
  const requesters = requesterIds.length
    ? await sdb.user.findMany({
        where: { id: { in: requesterIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const requesterName = new Map(
    requesters.map((u) => [u.id, u.name ?? u.email ?? "Người dùng"]),
  );

  // Số đề xuất OPEN theo từng buổi.
  const openByLesson = new Map<string, number>();
  for (const r of changeRequests) {
    if (r.status === "OPEN") {
      const cur = openByLesson.get(r.lessonId) ?? 0;
      openByLesson.set(r.lessonId, cur + 1);
    }
  }

  // FL W0-NAV-2 (QĐ-T3b): tách quyền — unlock buổi LOCKED vẫn dùng training:manage,
  // còn DUYỆT đề xuất chỉnh bài dùng lesson-change:approve (CM cũng duyệt được).
  const canUnlock = await checkPermission("training:manage");
  const canApproveChange = await checkPermission("lesson-change:approve");
  const canAuthor = await checkPermission("questions:author");

  // FL1-02 (US-LMS-1) — học liệu SCORM + bài tập theo buổi.
  const scormEnabled = isScormEnabled();
  const lessonIds = curriculum.lessons.map((l) => l.id);
  // Loại B — Assignment không auto-scope (không ∈ SCOPED_MODELS); cách ly tay qua
  // class.centerId ∈ visibleCenterIds, HO/SUPER bypass (pattern parent-feedback).
  const isGlobal = actor.isSuperAdmin || actor.isHoLevel;
  const [scormPackages, lessonAssignments, lienKet] = await Promise.all([
    scormEnabled
      ? sdb.scormPackage.findMany({
          where: { lessonId: { in: lessonIds } },
          orderBy: [{ lessonId: "asc" }, { version: "desc" }],
          select: {
            id: true,
            lessonId: true,
            name: true,
            version: true,
            status: true,
            isActiveForLesson: true,
            error: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    // Bài tập đã gắn buổi của giáo trình + bài tập trống (chưa gắn buổi) cùng khoá.
    sdb.assignment.findMany({
      where: {
        OR: [
          { lessonId: { in: lessonIds } },
          { lessonId: null, class: { courseId: curriculum.courseId } },
        ],
        ...(isGlobal
          ? {}
          : { class: { centerId: { in: actor.visibleCenterIds } } }),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        lessonId: true,
        class: { select: { name: true } },
      },
    }),
    // LIÊN KẾT DỮ LIỆU — mọi thứ đang trỏ vào giáo trình / bài của nó. In ra để người sửa thấy
    // TRƯỚC mình đang động vào gì (chủ dự án 29/09: "liên kết tới toàn bộ các phần liên quan…
    // đừng bỏ sót, mất data là lỗi nặng"). Màn này KHÔNG xoá/tạo lại bài nào, nên mọi liên kết
    // theo `lessonId` dưới đây đứng nguyên; đổi TỔNG số buổi đi qua khối "Số buổi" (có xem trước).
    Promise.all([
      sdb.class.count({ where: { curriculumId: id, deletedAt: null } }),
      sdb.classSession.count({ where: { lessonId: { in: lessonIds } } }),
      sdb.assignmentTemplate.count({ where: { lessonId: { in: lessonIds } } }),
      sdb.exam.count({ where: { lessonId: { in: lessonIds } } }),
      sdb.makeupNeed.count({ where: { missedLessonId: { in: lessonIds } } }),
      sdb.makeupCase.count({ where: { OR: [{ lessonId: { in: lessonIds } }, { lessons: { some: { lessonId: { in: lessonIds } } } }] } }),
      sdb.courseModuleMakeupQuota.count({ where: { courseId: curriculum.courseId } }),
    ]),
  ]);

  const scormByLesson = new Map<string, typeof scormPackages>();
  for (const p of scormPackages) {
    const arr = scormByLesson.get(p.lessonId) ?? [];
    arr.push(p);
    scormByLesson.set(p.lessonId, arr);
  }
  const assignmentsByLesson = new Map<string, AssignmentRow[]>();
  const availableAssignments: AssignmentRow[] = [];
  for (const a of lessonAssignments) {
    const row: AssignmentRow = {
      id: a.id,
      title: a.title,
      kind: a.kind,
      status: a.status,
      className: a.class.name,
    };
    if (a.lessonId) {
      const arr = assignmentsByLesson.get(a.lessonId) ?? [];
      arr.push(row);
      assignmentsByLesson.set(a.lessonId, arr);
    } else {
      availableAssignments.push(row);
    }
  }

  const lessons: LessonRow[] = curriculum.lessons.map((l) => ({
    id: l.id,
    curriculumId: l.curriculumId,
    order: l.order,
    title: l.title,
    description: l.description,
    content: l.content,
    duration: l.duration,
    objectives: l.objectives,
    materials: l.materials,
    notes: l.notes,
    teacherGuide: l.teacherGuide,
    expectedOutput: l.expectedOutput,
    homeworkDefault: l.homeworkDefault,
    assessmentCriteria: l.assessmentCriteria,
    status: l.status,
    version: l.version,
    archivedAt: l.archivedAt ? l.archivedAt.toISOString() : null,
    openChangeRequests: openByLesson.get(l.id) ?? 0,
  }));

  const activeLessons = lessons.filter((l) => !l.archivedAt);
  const expectedVersions: Record<string, number> = {};
  for (const l of activeLessons) expectedVersions[l.id] = l.version;

  const lessonResourceRows: LessonResourceRow[] = activeLessons.map((l) => ({
    lessonId: l.id,
    order: l.order,
    title: l.title,
    // QA 20/07 — bản UPLOADING/PROCESSING kẹt >15 phút hiển thị như bản LỖI (nút
    // "Dọn") thay vì "Đang xử lý…" vĩnh viễn.
    scorm: (scormByLesson.get(l.id) ?? []).map((p) =>
      isScormProcessingStale(p.status, p.createdAt)
        ? { id: p.id, name: p.name, version: p.version, status: "FAILED", isActiveForLesson: p.isActiveForLesson, error: SCORM_STALE_ERROR }
        : { id: p.id, name: p.name, version: p.version, status: p.status, isActiveForLesson: p.isActiveForLesson, error: p.error },
    ),
    assignments: assignmentsByLesson.get(l.id) ?? [],
  }));

  const changeRequestRows: ChangeRequestRow[] = changeRequests.map((r) => ({
    id: r.id,
    lessonOrder: r.lesson.order,
    lessonTitle: r.lesson.title,
    requestedByName: requesterName.get(r.requestedById) ?? "Người dùng",
    content: r.content,
    status: r.status,
    response: r.response,
    createdAt: formatDateVN(r.createdAt),
  }));

  const hocPhan = tomTatHocPhan(
    curriculum.lessons.filter((l) => !l.archivedAt).map((l) => ({ order: l.order, moduleCode: l.moduleCode })),
  );
  const moduleCodeTheoBai: Record<string, string | null> = Object.fromEntries(
    curriculum.lessons.map((l) => [l.id, l.moduleCode]),
  );
  const taiNguyenTheoBai: Record<string, LessonResourceRow> = Object.fromEntries(
    lessonResourceRows.map((r) => [r.lessonId, r]),
  );
  const soGiaoAn = lessonResourceRows.filter((r) =>
    r.scorm.some((p) => p.isActiveForLesson && p.status === "PUBLISHED"),
  ).length;
  const soBaiTap = lessonResourceRows.reduce((s, r) => s + r.assignments.length, 0);
  const deXuatMo = changeRequestRows.filter((r) => r.status === "OPEN").length;
  const [soLop, soBuoiLop, soMauBaiTap, soDe, soCanBu, soCaseBu, soCauHinhLuot] = lienKet;

  const TABS: { k: Tab; nhan: string; dem?: number }[] = [
    { k: "noi-dung", nhan: "Nội dung buổi" },
    { k: "thiet-lap", nhan: "Thiết lập" },
    { k: "de-xuat", nhan: "Đề xuất chỉnh bài", dem: deXuatMo },
  ];

  return (
    <div className="mx-auto w-full max-w-[120rem] space-y-5">
      {/* ── Đầu trang ── */}
      <header className="space-y-3">
        <Link
          href="/curriculums"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden /> Danh sách giáo trình
        </Link>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {curriculum.name} <span className="font-normal text-muted-foreground">v{curriculum.version}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Khoá học <strong className="font-semibold text-foreground">{curriculum.course.name}</strong>
              {curriculum.isActive ? " · đang dùng" : " · không dùng"}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Buổi", String(activeLessons.length)],
              ["Học phần", hocPhan.length ? String(hocPhan.length) : "Chưa chia"],
              ["Giáo án SCORM", `${soGiaoAn}/${activeLessons.length}`],
              ["Lớp đang dùng", String(soLop)],
            ].map(([nhan, so]) => (
              <div key={nhan} className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
                <dt className="truncate text-xs text-muted-foreground">{nhan}</dt>
                <dd className="text-base font-semibold tabular-nums text-foreground">{so}</dd>
              </div>
            ))}
          </dl>
        </div>
        <nav aria-label="Giáo trình" className="flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map((x) => (
            <Link
              key={x.k}
              href={x.k === "noi-dung" ? "?" : `?tab=${x.k}`}
              scroll={false}
              aria-current={tab === x.k ? "page" : undefined}
              className={
                "-mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors " +
                (tab === x.k
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {x.nhan}
              {x.dem ? (
                <span className="rounded-full bg-state-warning-soft px-1.5 text-xs tabular-nums text-state-warning-ink">
                  {x.dem}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "noi-dung" && (
        <TrinhSuaGiaoTrinh
          curriculumId={curriculum.id}
          lessons={activeLessons}
          moduleCodeTheoBai={moduleCodeTheoBai}
          taiNguyenTheoBai={taiNguyenTheoBai}
          availableAssignments={availableAssignments}
          scormEnabled={scormEnabled}
          canActivateScorm={canUnlock}
        />
      )}

      {tab === "thiet-lap" && (
        <div className="grid gap-5 2xl:grid-cols-2">
          <div className="min-w-0 space-y-5">
            <CurriculumForm
              courses={courses}
              curriculum={{
                id: curriculum.id,
                courseId: curriculum.courseId,
                name: curriculum.name,
                description: curriculum.description,
                isActive: curriculum.isActive,
                status: curriculum.status,
              }}
            />
            <HocPhanForm curriculumId={curriculum.id} soBai={activeLessons.length} hienTai={hocPhan} />
            <CurriculumSessionsForm
              curriculumId={curriculum.id}
              currentCount={activeLessons.length}
              expectedVersions={expectedVersions}
            />
            {/* Khoá gộp (Combo = Sata 1 + Sata 2): nạp nội dung bài từ giáo trình khác,
                ghi đè tại chỗ nên lớp đang chạy không mất liên kết buổi. */}
            <CurriculumMergeForm curriculumId={curriculum.id} currentCount={activeLessons.length} />
            {/* 01/10/2026 — màn /course-prerequisites gộp vào đây (chủ dự án). */}
            <KhoaTienQuyet userId={session.user.id} courseId={curriculum.courseId} />
          </div>
          <div className="min-w-0 space-y-5">
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
              <h2 className="text-base font-semibold text-foreground">Liên kết dữ liệu</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Những gì đang trỏ vào các buổi của giáo trình. Sửa nội dung buổi và chia học phần KHÔNG xoá buổi
                nào nên các liên kết này giữ nguyên; đổi tổng số buổi thì xem trước ở khối “Số buổi”.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  ["Lớp đang dùng", soLop],
                  ["Buổi học của lớp", soBuoiLop],
                  ["Giáo án SCORM", soGiaoAn],
                  ["Bài tập đã gắn", soBaiTap],
                  ["Mẫu bài tập", soMauBaiTap],
                  ["Đề kiểm tra", soDe],
                  ["Buổi cần bù", soCanBu],
                  ["Case dạy bù", soCaseBu],
                  ["Cấu hình lượt bù", soCauHinhLuot],
                ].map(([nhan, so]) => (
                  <div key={String(nhan)} className="rounded-lg border border-border px-3 py-2">
                    <dt className="truncate text-xs text-muted-foreground">{nhan}</dt>
                    <dd className="text-base font-semibold tabular-nums text-foreground">{so}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <LessonList
              curriculumId={curriculum.id}
              initialLessons={lessons}
              canManageTraining={canUnlock}
              canAuthor={canAuthor}
              moNganBuoi
            />
            {/* Nút Sửa / Giáo án ở danh sách trên mở CÙNG ngăn chỉnh buổi của tab Nội dung
                (nội dung + giáo án SCORM + bài tập) — không còn hộp thoại chỉ có nội dung. */}
            <TrinhSuaGiaoTrinh
              chiNgan
              curriculumId={curriculum.id}
              lessons={activeLessons}
              moduleCodeTheoBai={moduleCodeTheoBai}
              taiNguyenTheoBai={taiNguyenTheoBai}
              availableAssignments={availableAssignments}
              scormEnabled={scormEnabled}
              canActivateScorm={canUnlock}
            />
          </div>
        </div>
      )}

      {tab === "de-xuat" && <LessonChangeRequests requests={changeRequestRows} canHandle={canApproveChange} />}
    </div>
  );
}
