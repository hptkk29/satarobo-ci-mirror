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
import { after } from "next/server";
import { isScormEnabled } from "@/lib/flags";
import { lamNongGoi } from "@/lib/scorm/dem-dia";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "../../_components/ui/empty-state";
import { safeAssemblyManualUrl } from "@/lib/lms/assembly-manual";
import { LapRap3dLink, type LapRap3dView } from "./lap-rap-3d-link";

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
  // Tài liệu lắp ráp 3D do Đào tạo gắn (ĐỘC LẬP với SCORM); null = bài không có ⇒ không hiện nút.
  assemblyManual: LapRap3dView | null;
  documents: {
    id: string;
    title: string;
    fileUrl: string;
    typeLabel: string;
  }[];
};

/**
 * Thu hẹp tab vào MỘT buổi — dùng khi tab được NHÚNG ở màn "Dạy thay" (11/10/2026): người dạy thay chỉ cần
 * tài liệu của ĐÚNG bài mình dạy, không phải cả khung chương trình của khoá. Cùng nguồn `Document` / `ScormPackage`.
 */
export type PhamViBuoiTaiLieu = {
  /** Buổi được giao dạy thay — cấp `?sessionId=` cho trình chiếu SCORM (cổng SCORM kiểm theo buổi này). */
  sessionId: string;
  /** Bài của buổi; null = buổi chưa gắn bài ⇒ không có gì để hiện. */
  lessonId: string | null;
  /** Nơi quay về khi bấm "Đóng" ở màn trình chiếu (phải là `/teacher/…`). */
  quayVe: string;
};

export async function HubMaterialsTab({
  actor,
  classId,
  phamVi,
  courseIdDaBiet,
}: {
  actor: Actor;
  classId: string;
  phamVi?: PhamViBuoiTaiLieu;
  /**
   * Khoá của lớp nếu NƠI GỌI đã biết (Class Hub đã đọc lớp để vẽ tiêu đề trang, và câu đọc đó chính là phép chứng minh lớp
   * thuộc phạm vi). Có thì bỏ một lượt đi-về DB; không có (màn Dạy thay) thì tự tra như cũ, vẫn qua `scopedDb`.
   */
  courseIdDaBiet?: string;
}) {
  const sdb = scopedDb(actorGiangDay(actor));

  // Chỗ quay về khi GV bấm "Đóng" trong màn trình chiếu — nơi mở phải tự khai vì nút
  // "Đóng" cần đích XÁC ĐỊNH (vào thẳng bằng URL / F5 thì Back không trỏ về đây nữa).
  // URL của Class Hub do page.tsx quy ước: `?classId=…&tab=<tab>`.
  const backParam = encodeURIComponent(
    phamVi?.quayVe ?? `/teacher/lop?classId=${classId}&tab=tai-lieu`,
  );

  const courseId =
    courseIdDaBiet ??
    (
      await sdb.class.findUnique({
        where: { id: classId },
        select: { courseId: true },
      })
    )?.courseId ??
    null;

  const scormOn = isScormEnabled();

  // ── MỘT tầng đi-về, không phải ba ───────────────────────────────────────────────────────────────────────
  // Bản cũ: lớp → khung (+bài, Prisma tách thêm một câu) → RỒI mới tài liệu/SCORM/buổi theo `lessonId IN (…)`: bốn lượt
  // NỐI ĐUÔI cho dữ liệu mà ba câu sau hoàn toàn có thể hỏi cùng lúc với khung. Nay ba câu đó lọc theo QUAN HỆ ("bài thuộc
  // khung ACTIVE của khoá") thay vì theo danh sách id, nên chạy song song với câu khung; kết quả vẫn được nối vào đúng các
  // bài của khung đã chọn ở dưới (`docsByLesson`/`scormByLesson`/`sessionByLesson` chỉ tra theo `lessonId` của bài ĐÃ chọn)
  // ⇒ đầu ra không đổi, kể cả khi khoá có hai khung ACTIVE (dòng thừa của khung kia không bao giờ được tra tới).
  // Dạy thay: bài đã biết sẵn (`phamVi.lessonId`) nên lọc thẳng theo nó.
  const baiCuaKhung = { archivedAt: null, curriculum: { courseId: courseId ?? "", status: "ACTIVE" as const } };
  const locBai = phamVi
    ? phamVi.lessonId
      ? { lessonId: phamVi.lessonId }
      : null
    : courseId
      ? { lesson: baiCuaKhung }
      : null;

  const [curriculum, docs, scormPkgs, sessions] = await Promise.all([
    courseId
      ? sdb.curriculum.findFirst({
          where: { courseId, status: "ACTIVE" },
          orderBy: { version: "desc" },
          select: {
            name: true,
            lessons: {
              where: { archivedAt: null },
              orderBy: { order: "asc" },
              select: {
                id: true,
                order: true,
                title: true,
                objectives: true,
                assemblyManualUrl: true,
                assemblyManualSetName: true,
                assemblyManualModelName: true,
              },
            },
          },
        })
      : Promise.resolve(null),
    locBai
      ? sdb.document.findMany({
          where: locBai,
          orderBy: { title: "asc" },
          select: {
            id: true,
            title: true,
            fileUrl: true,
            type: true,
            lessonId: true,
          },
        })
      : Promise.resolve([]),
    scormOn && locBai
      ? sdb.scormPackage.findMany({
          where: { ...locBai, isActiveForLesson: true, status: "PUBLISHED" },
          select: { id: true, name: true, lessonId: true, storagePrefix: true },
        })
      : Promise.resolve(
          [] as { id: string; name: string; lessonId: string; storagePrefix: string }[],
        ),
    scormOn
      ? phamVi
        ? // Cổng SCORM của người dạy thay kiểm theo ĐÚNG buổi được giao — đưa đúng buổi đó, không đoán buổi khác của lớp.
          Promise.resolve([{ id: phamVi.sessionId, lessonId: phamVi.lessonId }])
        : locBai
          ? sdb.classSession.findMany({
              where: { classId, ...locBai },
              orderBy: { date: "desc" },
              select: { id: true, lessonId: true },
            })
          : Promise.resolve([] as { id: string; lessonId: string | null }[])
      : Promise.resolve([] as { id: string; lessonId: string | null }[]),
  ]);

  const lessons = (curriculum?.lessons ?? []).filter(
    (l) => !phamVi || l.id === phamVi.lessonId,
  );
  const lessonIds = lessons.map((l) => l.id);

  let lessonViews: LessonView[] = [];
  if (lessonIds.length > 0) {
    // Màn Dạy thay (một buổi, một bài): giáo viên thường mở tab này TRƯỚC giờ dạy ⇒ làm nóng đệm đĩa của gói ngay (tải cả gói về VPS ở nền),
    // lúc bấm "Mở trình chiếu" thì tệp đã nằm trên đĩa. Hub đầy đủ (cả khoá) thì KHÔNG làm nóng hàng chục gói.
    if (phamVi) {
      for (const p of scormPkgs) after(() => void lamNongGoi(p.storagePrefix));
    }

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
      // Kiểm lại URL trước khi đưa vào view — chuỗi không qua validator thì không bao giờ thành href; đưa vào
      // view đúng bản CHUẨN HOÁ (không phải chuỗi thô trong DB).
      const lapRapUrl = safeAssemblyManualUrl(l.assemblyManualUrl);
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
        assemblyManual: lapRapUrl
          ? {
              url: lapRapUrl,
              setName: l.assemblyManualSetName,
              modelName: l.assemblyManualModelName,
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
            {phamVi ? "Bài của buổi này" : `${lessonViews.length} buổi`}
          </div>
        </div>
        {courseId && !phamVi && (
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
              ? phamVi
                ? "Buổi này chưa gắn bài trong giáo trình — báo Đào tạo hoặc quản lý cơ sở gắn bài."
                : "Khung chương trình chưa có buổi học nào."
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

                  {((scormOn && l.scorm) || l.assemblyManual) && (
                    <div className="flex flex-wrap items-center gap-2">
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
                              duyệt đều đưa về đúng chỗ.
                              `prefetch={false}`: lớp có SCORM ở nhiều bài thì mỗi nút thấy được trong khung nhìn sẽ
                              kéo một lượt dựng layout phía máy chủ (hàng chục truy vấn) mà giáo viên có thể không bao
                              giờ bấm. Đo TEST 25/10: lớp có 3 nút ⇒ mở tab phát thêm 3 request `/scorm/play/…` (RSC
                              11 so với 8); thân trang play không chạy ở prefetch (0 dòng ScormAccessLog) nên không
                              tốn vé/đệm, chỉ tốn layout. */}
                          <Link
                            prefetch={false}
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
                      {/* "Lắp ráp 3D" đứng NGOÀI cổng SCORM: bài không có SCORM (hay cờ SCORM tắt)
                          vẫn hiện nút khi Đào tạo đã gắn đường dẫn. */}
                      <LapRap3dLink manual={l.assemblyManual} />
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
                    {(scormOn && l.scorm) || l.assemblyManual
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
