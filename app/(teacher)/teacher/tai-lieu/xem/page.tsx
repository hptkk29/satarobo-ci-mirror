// app/(teacher)/teacher/tai-lieu/xem/page.tsx — trình xem tài liệu buổi học
// (parity site GV 18/08, port từ satarobo-ui-giaovien materials/xem/pdf).
//
// Mở từ bảng buổi học (?d=<documentId>, tab mới). Server tra Document + guard:
// tài liệu phải gắn buổi thuộc khung CT của KHOÁ GV ĐANG DẠY (fail-closed khi
// thiếu lesson/curriculum) — không nhận URL file từ client. SCORM có trình chiếu
// watermark riêng (/teacher/scorm/play) — trang này chỉ phục vụ Document.
import { FileWarning } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { DocViewer } from "../_components/doc-viewer";

export const metadata = { title: "Xem tài liệu | Giáo viên Sata Robo" };

const DOC_TYPE_LABEL: Record<string, string> = {
  PDF: "PDF",
  IMAGE: "Ảnh",
  VIDEO: "Video",
  SLIDE: "Slide",
  WORKSHEET: "Phiếu bài tập",
  AUDIO: "Âm thanh",
  OTHER: "Tài liệu",
};

/** Dung lượng file dễ đọc (fileSize là byte). */
function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default async function DocumentViewerPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate

  const { d } = await searchParams;
  const docId = d?.trim() || null;

  if (!(await checkPermission("teaching-materials:view-own-class"))) {
    return <NotFound />;
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));

  const doc = docId
    ? await sdb.document.findUnique({
        where: { id: docId },
        select: {
          id: true,
          title: true,
          fileUrl: true,
          fileName: true,
          fileSize: true,
          type: true,
          lesson: {
            select: {
              order: true,
              title: true,
              curriculum: {
                select: { courseId: true, course: { select: { name: true } } },
              },
            },
          },
        },
      })
    : null;

  // Guard sở hữu: tài liệu phải thuộc buổi của khoá GV đang dạy (fail-closed).
  const docCourseId = doc?.lesson?.curriculum?.courseId ?? null;
  if (!doc || !docCourseId) return <NotFound />;

  const classIds = [...actor.assignedClassIds];
  const owns = classIds.length
    ? await sdb.class.findFirst({
        where: { id: { in: classIds }, courseId: docCourseId, deletedAt: null },
        select: { id: true },
      })
    : null;
  if (!owns) return <NotFound />;

  return (
    <DocViewer
      title={doc.title}
      typeLabel={DOC_TYPE_LABEL[doc.type] ?? doc.type}
      isHomework={doc.type === "WORKSHEET"}
      fileUrl={doc.fileUrl}
      fileName={doc.fileName}
      sizeLabel={doc.fileSize ? fmtSize(doc.fileSize) : null}
      lessonLabel={
        doc.lesson ? `Buổi ${doc.lesson.order}: ${doc.lesson.title}` : null
      }
      courseName={doc.lesson?.curriculum?.course?.name ?? null}
    />
  );
}

function NotFound() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950 p-6 text-center font-bold text-white">
      <FileWarning className="h-14 w-14 text-red-500" aria-hidden />
      <h1 className="mt-4 text-xl font-bold">Không tìm thấy tài liệu</h1>
      <p className="mt-2 max-w-md text-sm text-slate-400">
        Đường dẫn không hợp lệ hoặc tài liệu đã bị gỡ bỏ. Hãy quay lại thư viện
        và mở lại tài liệu.
      </p>
    </div>
  );
}
