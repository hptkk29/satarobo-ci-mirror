import "server-only";
import { db } from "@/lib/db";
import { computeHomeworkDueAt } from "@/lib/lms/assignment";
import { LoiHocBu } from "@/lib/hoc-bu/case-db";

// TÀI LIỆU + BÀI KIỂM TRA của buổi dạy bù (chủ dự án 29/09/2026: "sẽ dạy với tài liệu học phần
// — file SCORM bài giảng của đúng buổi đó của khoá đó —, nhận xét, điểm danh, gửi bài kiểm tra
// bù nếu có"). Buổi bù = bài `MakeupCase.lessonId` ⇒ tài liệu/đề đều tra theo bài đó.

export type TaiLieuBu = {
  scorm: { id: string; name: string } | null;
  deKiemTra: { id: string; title: string }[];
};

export async function taiLieuCuaCase(c: { lessonId: string; classIds: readonly string[] }): Promise<TaiLieuBu> {
  const [scorm, de] = await Promise.all([
    // Gói ĐANG DÙNG của bài, đã PUBLISHED (GV không mở gói TESTING — cùng luật trang SCORM).
    db.scormPackage.findFirst({
      where: { lessonId: c.lessonId, isActiveForLesson: true, status: "PUBLISHED" },
      select: { id: true, name: true },
    }),
    // Đề PUBLISHED của bài: đề dùng chung (classId null) hoặc đề của lớp gốc của một bé trong case.
    db.exam.findMany({
      where: {
        lessonId: c.lessonId,
        status: "PUBLISHED",
        OR: [{ classId: null }, { classId: { in: [...c.classIds] } }],
      },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
  ]);
  return { scorm, deKiemTra: de };
}

/**
 * Gửi BÀI KIỂM TRA BÙ cho các bé ĐÃ CÓ MẶT ở buổi bù — ghi đúng bảng giao bài của buổi chính
 * (`HomeworkAssignment`, khoá theo buổi VẮNG gốc) + thông báo phụ huynh, như `assignHomeworkForSession`
 * nhưng chỉ cho các bé học bù. Idempotent: unique (buổi, đề, bé) + dedupeKey thông báo.
 */
export async function guiBaiKiemTraBu(p: {
  caseId: string;
  examId: string;
  byUserId: string;
  /** Site GV: chỉ đúng giáo viên của case. Admin (quyền đã kiểm ở action): null. */
  chiGiaoVien: string | null;
  now: Date;
}): Promise<{ soBe: number }> {
  const c = await db.makeupCase.findUnique({
    where: { id: p.caseId },
    select: {
      teacherId: true,
      lessonId: true,
      status: true,
      lessons: { select: { lessonId: true } },
      students: {
        // T07: đề của một bài chỉ gửi cho bé đã HỌC XONG bài đó (mục COMPLETED), không phải mọi bé có mặt.
        where: { result: "COMPLETED" },
        select: {
          lessonId: true,
          makeupNeed: {
            select: {
              studentId: true,
              classId: true,
              missedSessionId: true,
              student: { select: { name: true, centerId: true } },
              class: { select: { name: true, centerId: true } },
            },
          },
        },
      },
    },
  });
  if (!c) throw new LoiHocBu("Không tìm thấy case dạy bù");
  if (p.chiGiaoVien !== null && c.teacherId !== p.chiGiaoVien) throw new LoiHocBu("Bạn không phải giáo viên của buổi bù này");
  if (c.status === "CANCELLED") throw new LoiHocBu("Case đã huỷ");
  const baiCase = c.lessons.length > 0 ? c.lessons.map((l) => l.lessonId) : [c.lessonId];
  const de = await db.exam.findFirst({
    where: {
      id: p.examId,
      lessonId: { in: baiCase },
      status: "PUBLISHED",
      OR: [{ classId: null }, { classId: { in: c.students.map((s) => s.makeupNeed.classId) } }],
    },
    select: { id: true, title: true, defaultDueDays: true, lessonId: true },
  });
  if (!de) throw new LoiHocBu("Đề không thuộc bài của buổi bù hoặc chưa phát hành");
  // Đề của bài X ⇒ chỉ các bé đã học xong bài X.
  const be = c.students.filter((s) => s.lessonId === de.lessonId || (s.lessonId === null && de.lessonId === c.lessonId)).map((s) => s.makeupNeed);
  if (be.length === 0) throw new LoiHocBu("Chưa có bé nào học xong bài này — điểm danh trước khi gửi bài");

  const dueAt = computeHomeworkDueAt({ assignMode: "NOW", now: p.now, defaultDueDays: de.defaultDueDays, customDueAt: null });
  const res = await db.homeworkAssignment.createMany({
    data: be.map((b) => ({
      classSessionId: b.missedSessionId,
      examId: de.id,
      studentId: b.studentId,
      dueAt,
      assignMode: "NOW" as const,
      assignedById: p.byUserId,
    })),
    skipDuplicates: true,
  });
  for (const b of be) {
    const khoa = `homework.assigned:bu:${b.missedSessionId}:${de.id}:${b.studentId}`;
    await db.notification.upsert({
      where: { dedupeKey: khoa },
      create: {
        title: "Bài kiểm tra bù",
        body: `Con ${b.student.name} có bài kiểm tra "${de.title}" của buổi học bù (lớp ${b.class.name}).`,
        audience: "STUDENT",
        studentId: b.studentId,
        classId: b.classId,
        centerId: b.student.centerId ?? b.class.centerId ?? null,
        createdByName: "Hệ thống",
        dedupeKey: khoa,
      },
      update: {},
    });
  }
  return { soBe: res.count };
}
