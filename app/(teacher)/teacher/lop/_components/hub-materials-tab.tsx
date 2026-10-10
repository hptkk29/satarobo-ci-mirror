// hub-materials-tab.tsx — Tab "Tài liệu học phần" của Class Hub.
//
// Bài giảng theo khung chương trình ACTIVE của KHOÁ lớp này: tài liệu (Document, mở
// tab mới) + SCORM (viewer site GV mở NGAY TẠI TRANG từ 24/08, watermark #14 — gate
// ở /teacher/scorm/play). Chỉ
// XEM/trình chiếu, không chỉnh sửa. Tài liệu là teaching-materials (không PII HV/PH —
// câu 46 an toàn). SCORM sessionId lấy từ buổi của CHÍNH lớp này. Xem toàn kho →
// /teacher/tai-lieu?courseId=… (đầy đủ bộ lọc + mọi lớp cùng khoá).
import Link from "next/link";
import { BookOpen, ExternalLink, FileText, Play } from "lucide-react";
import type { Actor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { isScormEnabled } from "@/lib/flags";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "../../_components/ui/empty-state";

const DOC_TYPE_LABEL: Record<string, string> = {
  PDF: "PDF",
  IMAGE: "Ảnh",
  VIDEO: "Video",
  SLIDE: "Slide",
  WORKSHEET: "Phiếu bài tập",
  AUDIO: "Âm thanh",
  OTHER: "Khác",
};

type LessonView = {
  id: string;
  order: number;
  title: string;
  objectives: string[];
  scorm: { id: string; name: string; sessionId: string | null } | null;
  documents: {
    id: string;
    title: string;
    fileUrl: string;
    typeLabel: string;
  }[];
};

export async function HubMaterialsTab({
  actor,
  classId,
}: {
  actor: Actor;
  classId: string;
}) {
  const sdb = scopedDb(actorGiangDay(actor));

  // Chỗ quay về khi GV bấm "Đóng" trong màn trình chiếu — nơi mở phải tự khai vì nút
  // "Đóng" cần đích XÁC ĐỊNH (vào thẳng bằng URL / F5 thì Back không trỏ về đây nữa).
  // URL của Class Hub do page.tsx quy ước: `?classId=…&tab=<tab>`.
  const backParam = encodeURIComponent(
    `/teacher/lop?classId=${classId}&tab=tai-lieu`,
  );

  const cls = await sdb.class.findUnique({
    where: { id: classId },
    select: { courseId: true },
  });
  const courseId = cls?.courseId ?? null;

  const curriculum = courseId
    ? await sdb.curriculum.findFirst({
        where: { courseId, status: "ACTIVE" },
        orderBy: { version: "desc" },
        select: {
          name: true,
          lessons: {
            where: { archivedAt: null },
            orderBy: { order: "asc" },
            select: { id: true, order: true, title: true, objectives: true },
          },
        },
      })
    : null;

  const lessons = curriculum?.lessons ?? [];
  const lessonIds = lessons.map((l) => l.id);
  const scormOn = isScormEnabled();

  let lessonViews: LessonView[] = [];
  if (lessonIds.length > 0) {
    const [docs, scormPkgs, sessions] = await Promise.all([
      sdb.document.findMany({
        where: { lessonId: { in: lessonIds } },
        orderBy: { title: "asc" },
        select: {
          id: true,
          title: true,
          fileUrl: true,
          type: true,
          lessonId: true,
        },
      }),
      scormOn
        ? sdb.scormPackage.findMany({
            where: {
              lessonId: { in: lessonIds },
              isActiveForLesson: true,
              status: "PUBLISHED",
            },
            select: { id: true, name: true, lessonId: true },
          })
        : Promise.resolve(
            [] as { id: string; name: string; lessonId: string }[],
          ),
      scormOn
        ? sdb.classSession.findMany({
            where: { classId, lessonId: { in: lessonIds } },
            orderBy: { date: "desc" },
            select: { id: true, lessonId: true },
          })
        : Promise.resolve([] as { id: string; lessonId: string | null }[]),
    ]);

    const docsByLesson = new Map<string, LessonView["documents"]>();
    for (const d of docs) {
      if (!d.lessonId) continue;
      const arr = docsByLesson.get(d.lessonId) ?? [];
      arr.push({
        id: d.id,
        title: d.title,
        fileUrl: d.fileUrl,
        typeLabel: DOC_TYPE_LABEL[d.type] ?? d.type,
      });
      docsByLesson.set(d.lessonId, arr);
    }
    const scormByLesson = new Map(scormPkgs.map((p) => [p.lessonId, p]));
    const sessionByLesson = new Map<string, string>();
    for (const s of sessions) {
      if (s.lessonId && !sessionByLesson.has(s.lessonId))
        sessionByLesson.set(s.lessonId, s.id);
    }

    lessonViews = lessons.map((l) => {
      const pkg = scormByLesson.get(l.id) ?? null;
      return {
        id: l.id,
        order: l.order,
        title: l.title,
        objectives: l.objectives,
        scorm: pkg
          ? {
              id: pkg.id,
              name: pkg.name,
              sessionId: sessionByLesson.get(l.id) ?? null,
            }
          : null,
        documents: docsByLesson.get(l.id) ?? [],
      };
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-primary-soft p-4">
        <div className="min-w-0">
          <div className="text-xs font-bold tracking-wider text-primary-ink uppercase">
            Khung chương trình
          </div>
          <div className="mt-1 flex items-center gap-2 text-base font-bold text-foreground">
            <BookOpen
              className="h-5 w-5 shrink-0 text-primary-ink"
              aria-hidden
            />
            {curriculum?.name ?? "Chưa gán khung chương trình"}
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {lessonViews.length} buổi
          </div>
        </div>
        {courseId && (
          <Link
            href={`/teacher/tai-lieu?courseId=${courseId}`}
            className="shrink-0 text-xs font-semibold text-primary-ink outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
          >
            Mở trong Thư viện tài liệu →
          </Link>
        )}
      </div>

      {!scormOn && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Bài giảng tương tác (SCORM) đang tắt trên hệ thống — phần trình chiếu
          tạm ẩn. Tài liệu đính kèm vẫn xem được.
        </p>
      )}

      {lessonViews.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={
            curriculum?.name
              ? "Khung chương trình chưa có buổi học nào."
              : "Khoá chưa gán khung chương trình — liên hệ Đào tạo."
          }
        />
      ) : (
        <ul className="space-y-3">
          {lessonViews.map((l) => (
            <li key={l.id} className="t-card relative overflow-hidden p-4">
              <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
              <div className="space-y-3 pl-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-ink">
                        {l.order}
                      </span>
                      <h3 className="text-base font-semibold text-foreground">
                        {l.title}
                      </h3>
                    </div>
                    {l.objectives.length > 0 && (
                      <p className="mt-0.5 line-clamp-2 pl-8 text-xs text-muted-foreground">
                        {l.objectives.join(" · ")}
                      </p>
                    )}
                  </div>

                  {scormOn && l.scorm && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        variant="outline"
                        className="border-primary-soft bg-primary-soft text-primary-ink dark:border-primary"
                      >
                        Bài giảng SCORM
                      </Badge>
                      {/* Mở NGAY TẠI TRANG (không tab mới) — chốt 24/08. Viewer phủ kín
                          khung nhìn nên nó tự là "màn trình chiếu"; đẻ tab mới mỗi lần mở
                          làm GV phải dọn tab giữa buổi dạy. Đi qua next/link để điều hướng
                          phía client, và nhờ ở cùng tab nên nút "Đóng" lẫn Back của trình
                          duyệt đều đưa về đúng chỗ. */}
                      <Link
                        href={
                          l.scorm.sessionId
                            ? `/teacher/scorm/play/${l.scorm.id}?sessionId=${l.scorm.sessionId}&from=${backParam}`
                            : `/teacher/scorm/play/${l.scorm.id}?from=${backParam}`
                        }
                        title={l.scorm.name}
                        className="inline-flex items-center gap-1 rounded-md border border-primary-soft px-2.5 py-1.5 text-xs font-medium text-primary-ink hover:bg-primary-soft-hover dark:border-primary"
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden /> Mở trình
                        chiếu
                      </Link>
                    </div>
                  )}
                </div>

                {l.documents.length > 0 ? (
                  <ul className="space-y-1.5 pl-8">
                    {l.documents.map((d) => (
                      <li key={d.id}>
                        <a
                          href={d.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group inline-flex max-w-full items-center gap-2 text-sm text-foreground hover:text-primary-ink-hover"
                        >
                          <FileText
                            className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary-ink-hover"
                            aria-hidden
                          />
                          <span className="truncate font-medium">
                            {d.title}
                          </span>
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px]"
                          >
                            {d.typeLabel}
                          </Badge>
                          <ExternalLink
                            className="h-3 w-3 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pl-8 text-xs text-muted-foreground">
                    {scormOn && l.scorm
                      ? "Không có tài liệu đính kèm khác."
                      : "Buổi này chưa có tài liệu."}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
