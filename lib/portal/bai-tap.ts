import "server-only";
import { db } from "@/lib/db";
import { getParentHomeworkSummary, getStudentExams } from "@/lib/portal/learning";
import { getStudentSessionsView } from "@/lib/portal/student-sessions";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { trangThaiBai, thiKeTiep, tomTatBai, type BaiThi, type BaiVe } from "@/lib/portal/bai-tap-thuan";
import { tenDayDu } from "@/lib/portal/tong-quan-thuan";

// Cổng phụ huynh — dữ liệu màn "Bài tập & bài thi" (artifact Bai-tap.dc.html).
// Gộp hai nguồn bài: Assignment (bài giao cho lớp, có lời nhận xét) và HomeworkAssignment (bài kiểm tra giao về nhà — điểm chỉ
// hiện khi setting `homework.showScoreToParent` bật). Không đọc nội dung câu hỏi.

export type BaiTapData = {
  studentName: string;
  tenKhoa: string | null;
  bai: BaiVe[];
  tomTat: ReturnType<typeof tomTatBai>;
  thi: BaiThi[];
  thiKeTiep: BaiThi | null;
};

export async function getBaiTap(studentId: string, now: Date = new Date()): Promise<BaiTapData> {
  const [hw, thiRows, view, sched, lop] = await Promise.all([
    getParentHomeworkSummary(studentId),
    getStudentExams(studentId),
    getStudentSessionsView(studentId, now),
    getStudentSchedule(studentId, now),
    db.enrollment.findMany({
      where: { studentId, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null },
      select: { classId: true },
    }),
  ]);
  const classIds = lop.map((e) => e.classId);
  const buoiOrder = new Map(view.sessions.map((s) => [s.id, s.order]));

  const assignments = classIds.length
    ? await db.assignment.findMany({
        where: { classId: { in: classIds }, status: { in: ["PUBLISHED", "CLOSED"] } },
        select: {
          id: true,
          title: true,
          kind: true,
          dueAt: true,
          totalPoints: true,
          classSessionId: true,
          submissions: { where: { studentId }, select: { status: true, score: true, feedback: true, submittedAt: true }, take: 1 },
        },
        orderBy: { assignedAt: "desc" },
      })
    : [];

  const baiLop: BaiVe[] = assignments.map((a) => {
    const sub = a.submissions[0];
    const status = sub?.status ?? "NOT_SUBMITTED";
    const trangThai = trangThaiBai({ status, dueISO: a.dueAt?.toISOString() ?? null, now });
    const order = a.classSessionId ? buoiOrder.get(a.classSessionId) : undefined;
    return {
      id: `a:${a.id}`,
      tieuDe: a.title,
      nhanPhu: order ? `Buổi ${order}` : a.kind === "HOMEWORK" ? "Bài về nhà" : "Bài trên lớp",
      trangThai,
      hanISO: a.dueAt?.toISOString() ?? null,
      nopISO: sub?.submittedAt?.toISOString() ?? null,
      diem: trangThai === "da-cham" && sub?.score != null ? { diem: sub.score, toiDa: a.totalPoints } : null,
      loiThay: sub?.feedback?.trim() || null,
    };
  });

  const baiThiVeNha: BaiVe[] = hw.items.map((h) => ({
    id: `h:${h.id}`,
    tieuDe: h.examTitle,
    nhanPhu: "Bài kiểm tra về nhà",
    trangThai: trangThaiBai({ status: h.status, dueISO: h.dueAt, now }),
    hanISO: h.dueAt,
    nopISO: null,
    diem: h.summaryScore != null && h.totalPoints ? { diem: h.summaryScore, toiDa: h.totalPoints } : null,
    loiThay: null,
  }));

  const bai = [...baiLop, ...baiThiVeNha];
  const thi: BaiThi[] = thiRows.map((e) => ({
    id: e.id,
    tieuDe: e.title,
    moISO: e.openAt,
    dongISO: e.closeAt,
    phut: e.durationMinutes,
    daThi: e.attemptStatus === "SUBMITTED" || e.attemptStatus === "GRADED" || e.attemptStatus === "REVIEWED",
    diem: hw.showScore ? e.totalScore : null,
  }));

  return {
    studentName: tenDayDu(sched?.studentName),
    tenKhoa: view.courseName,
    bai,
    tomTat: tomTatBai(bai),
    thi,
    thiKeTiep: thiKeTiep(thi, now),
  };
}
