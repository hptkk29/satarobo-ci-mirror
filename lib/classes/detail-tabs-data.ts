import "server-only";
import { db } from "@/lib/db";
import { resolveMediaUrl } from "@/lib/storage/signed-url";

// Data cho tab Ảnh + Học bù của trang chi tiết lớp (FL-R2 W4 R2-CLASS-6/7). Lọc
// theo classId — caller PHẢI đã xác minh lớp thuộc tầm nhìn actor (scopedDb) nên
// mọi bản ghi trả về đều trong scope; dùng db trần ở lib (ngoài lệnh cấm admin).

export type ClassMediaItem = {
  id: string;
  fileUrl: string;
  caption: string | null;
  status: string;
  className: string;
  uploadedByName: string | null;
  /** Ai đưa ảnh lên — MediaClient dùng để cho xoá ảnh CỦA MÌNH khỏi kho. */
  uploadedById: string | null;
  tagNames: string[];
  takenAt: string | null;
  hasSession: boolean;
  createdAt: string;
};

/** Ảnh lớp (ClassSessionMedia) của 1 lớp + resolve tên HS gắn thẻ + signed URL. */
export async function loadClassMediaItems(
  classId: string,
  className: string,
): Promise<ClassMediaItem[]> {
  // DRAFT (kho GV) fetch RIÊNG — cùng lỗi đã vá ở app/(admin)/admin/media/page.tsx
  // (review 02/08): vài lô upload 40 ảnh là DRAFT chiếm trọn cửa sổ 100 row, đẩy
  // PENDING khỏi hàng duyệt của tab "Ảnh lớp" trong /admin/classes/[id].
  const [mainRows, draftRows] = await Promise.all([
    db.classSessionMedia.findMany({
      where: { classId, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { tags: { select: { studentId: true } } },
    }),
    db.classSessionMedia.findMany({
      where: { classId, status: "DRAFT" },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { tags: { select: { studentId: true } } },
    }),
  ]);
  const rows = [...mainRows, ...draftRows];
  if (rows.length === 0) return [];

  const studentIds = [...new Set(rows.flatMap((r) => r.tags.map((t) => t.studentId)))];
  const students = studentIds.length
    ? await db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(students.map((s) => [s.id, s.name]));
  const urls = await Promise.all(rows.map((m) => resolveMediaUrl(m.fileUrl)));

  return rows.map((m, i) => ({
    id: m.id,
    fileUrl: urls[i] ?? m.fileUrl,
    caption: m.caption,
    status: m.status,
    className,
    uploadedByName: m.uploadedByName,
    uploadedById: m.uploadedById,
    tagNames: m.tags.map((t) => nameById.get(t.studentId) ?? "?"),
    takenAt: m.takenAt?.toISOString() ?? null,
    hasSession: m.classSessionId != null,
    createdAt: m.createdAt.toISOString(),
  }));
}

export type ClassScormSession = {
  sessionId: string;
  date: string;
  topic: string | null;
  lessonTitle: string | null;
  scorm: { id: string; name: string } | null;
};

/**
 * Buổi của lớp + gói SCORM đang dùng (active+PUBLISHED) của bài tương ứng — để GV
 * mở/present (R2-CLASS-5). Mở thực tế qua /admin/scorm/play/[id]?sessionId=… (route
 * đó tự gate canOpenScorm + cấp vé). ScormPackage không center-scoped (global).
 */
export async function loadClassScormSessions(classId: string): Promise<ClassScormSession[]> {
  const sessions = await db.classSession.findMany({
    where: { classId, status: { not: "CANCELLED" } },
    orderBy: { date: "asc" },
    select: {
      id: true,
      date: true,
      topic: true,
      lessonId: true,
      lesson: { select: { title: true } },
    },
  });
  const lessonIds = [...new Set(sessions.map((s) => s.lessonId).filter((x): x is string => !!x))];
  const pkgs = lessonIds.length
    ? await db.scormPackage.findMany({
        where: { lessonId: { in: lessonIds }, isActiveForLesson: true, status: "PUBLISHED" },
        select: { id: true, name: true, lessonId: true },
      })
    : [];
  const pkgByLesson = new Map(pkgs.map((p) => [p.lessonId, { id: p.id, name: p.name }]));

  return sessions.map((s) => ({
    sessionId: s.id,
    date: s.date.toISOString(),
    topic: s.topic,
    lessonTitle: s.lesson?.title ?? null,
    scorm: s.lessonId ? pkgByLesson.get(s.lessonId) ?? null : null,
  }));
}
