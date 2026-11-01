import "server-only";
import { db } from "@/lib/db";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { vnParts } from "@/lib/time/vn";
import { getStudentSessionsView } from "@/lib/portal/student-sessions";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { getStudentAssignmentTrack } from "@/lib/portal/student-assignments";
import { getStudentExams, getStudentAssignmentResults } from "@/lib/portal/learning";

// Portal v2 — Tổng quan "Cổng học sinh" (student-mode): tiến độ + hành trình + việc cần
// làm + lớp tiếp theo + kỹ năng + kết quả gần đây (giống SataUI).

const DONE_EXAM = new Set(["SUBMITTED", "GRADED"]);

export type JourneyDot = {
  idx: number;
  /** Khoá React — số buổi TRÙNG NHAU khi con học 2 lớp, nên không dùng `idx` làm khoá. */
  id: string;
  status: "done" | "today" | "makeup" | "absent" | "future" | "chua-cham" | "da-huy";
  title: string | null;
  /** Lớp nào — chỉ khác null khi con học nhiều lớp. */
  className: string | null;
};
export type StudentTodo = { id: string; kind: "BÀI TẬP" | "KIỂM TRA"; title: string; meta: string; overdue: boolean; href: string };
export type SkillBar = { label: string; pct: number };
export type ResultRow = { title: string; score: number; total: number };
export type NextClass = { title: string; time: string | null; room: string | null; teacher: string | null; label: string; isToday: boolean };

export type StudentHome = {
  studentName: string;
  courseName: string | null;
  className: string | null;
  teacher: string | null;
  done: number;
  total: number;
  progressPct: number;
  attendanceRate: number;
  pendingCount: number;
  nextLabel: string | null;
  nextIsToday: boolean;
  // Hành trình + 6 ô tổng hợp
  remaining: number;
  present: number;
  absent: number;
  makeupNeed: number;
  makeupDone: number;
  journey: JourneyDot[];
  // Việc cần làm
  todos: StudentTodo[];
  // Lớp học tiếp theo
  nextClass: NextClass | null;
  // Kỹ năng + kết quả
  skills: SkillBar[];
  results: ResultRow[];
  avgScore: number | null;
};

const SKILL_LABEL: Record<string, string> = {
  MECH_ASSEMBLY: "Lắp ráp cơ khí",
  ALGORITHM: "Tư duy logic",
  PROGRAMMING: "Lập trình",
  SENSOR: "Cảm biến",
  MOTOR_CONTROL: "Điều khiển động cơ",
  PROBLEM_SOLVING: "Giải quyết vấn đề",
  TEAMWORK: "Hợp tác nhóm",
  PRESENTATION: "Thuyết trình",
  CREATIVITY: "Sáng tạo",
  COMPETITION_READY: "Sẵn sàng thi đấu",
};
const SKILL_PCT: Record<string, number> = { NEED_SUPPORT: 45, BASIC: 65, GOOD: 82, EXCELLENT: 95 };

/**
 * `dd/MM/yyyy` theo LỊCH VN.
 *
 * 06/09 — bản cũ dùng `getDate()/getMonth()/getFullYear()`, tức giờ của TIẾN TRÌNH.
 * Vercel chạy UTC nên trong khoảng 00:00–07:00 giờ VN mọi mốc lùi một ngày: hạn nộp
 * 07/09 in ra 06/09, và buổi học chiều nay hiện "hôm qua".
 */
function dmy(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const p = vnParts(new Date(t));
  return `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}/${p.year}`;
}

export async function getStudentHome(studentId: string): Promise<StudentHome> {
  const [sched, view, makeup, track, exams, results, skillRows, student, enr] = await Promise.all([
    getStudentSchedule(studentId),
    getStudentSessionsView(studentId),
    getStudentMakeup(studentId),
    getStudentAssignmentTrack(studentId).catch(() => null),
    getStudentExams(studentId).catch(() => []),
    getStudentAssignmentResults(studentId).catch(() => []),
    db.studentSkillAssessment.findMany({ where: { studentId }, orderBy: { assessedAt: "desc" }, select: { skill: true, level: true } }),
    db.student.findUnique({ where: { id: studentId }, select: { name: true } }),
    // 06/09 — LỌC ghi danh còn hiệu lực. Bản cũ lấy ghi danh mới nhất bất kể trạng
    // thái: con rút khỏi lớp B (WITHDREW / xoá mềm) rồi vào lớp A thì cổng học sinh in
    // tên giáo viên của LỚP B đã nghỉ.
    db.enrollment.findFirst({
      where: { studentId, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null },
      orderBy: { enrolledAt: "desc" },
      select: { class: { select: { teacher: { select: { name: true } } } } },
    }),
  ]);

  const total = view.total;
  const done = view.done;
  const remaining = Math.max(0, total - done);
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Hành trình: trạng thái từng buổi.
  //
  // ⚠️ Thứ tự nhánh có ý nghĩa. Buổi ĐÃ HUỶ phải xét TRƯỚC `s.today`: buổi huỷ rơi trúng
  // hôm nay mà để nhánh "today" thắng thì portal khẳng định "hôm nay có buổi" ở đúng lớp
  // vừa báo nghỉ.
  const journey: JourneyDot[] = view.sessions.map((s) => {
    let status: JourneyDot["status"];
    if (s.attendance === "CANCELLED") status = "da-huy";
    else if (s.attendance === "UNMARKED") status = "chua-cham";
    else if (s.today) status = "today";
    else if (s.attendance === "MAKEUP") status = "makeup";
    else if (s.attendance === "ABSENT" || s.attendance === "EXCUSED") status = "absent";
    else if (s.past) status = "done";
    else status = "future";
    return { idx: s.order, id: s.id, status, title: s.title, className: s.className };
  });

  // Việc cần làm: bài tập chưa nộp + bài kiểm tra chưa làm.
  const todos: StudentTodo[] = [];
  for (const it of track?.items ?? []) {
    if (it.assignment && !it.assignment.done) {
      todos.push({
        id: it.assignment.id,
        kind: "BÀI TẬP",
        title: it.assignment.title,
        // Bài KHÔNG đặt hạn thì đừng bịa ra dòng "Hạn —"; nói đúng những gì có.
        meta: it.assignment.nhanHan
          ? `Buổi ${it.order} · Hạn ${it.assignment.nhanHan}`
          : `Buổi ${it.order}`,
        overdue: it.assignment.overdue,
        href: `/portal/bai-tap/${it.assignment.id}`,
      });
    }
  }
  for (const e of exams) {
    if (!DONE_EXAM.has(e.attemptStatus ?? "")) {
      todos.push({
        id: e.id,
        kind: "KIỂM TRA",
        title: e.title,
        meta: `${e.durationMinutes} phút${e.closeAt ? ` · Hạn ${dmy(e.closeAt)}` : ""}`,
        overdue: false,
        href: `/portal/bai-thi/${e.id}`,
      });
    }
  }
  todos.sort((a, b) => Number(b.overdue) - Number(a.overdue));

  // Lớp học tiếp theo.
  const n = sched?.next ?? null;
  // `homNay` do server tính theo lịch VN (lib/portal/buoi-hoc.ts). Bản cũ so
  // `toDateString()` — theo TZ tiến trình, tức UTC trên Vercel.
  const nextIsTodayClass = n?.homNay ?? false;
  const nextClass: NextClass | null = n
    ? {
        title: n.title,
        time: n.time || null,
        room: n.room,
        teacher: n.teacher,
        label: nextIsTodayClass ? "Hôm nay" : n.nhanNgay || dmy(n.dateISO),
        isToday: nextIsTodayClass,
      }
    : null;

  // Kỹ năng: mức mới nhất mỗi kỹ năng → %.
  const seenSkill = new Set<string>();
  const skills: SkillBar[] = [];
  for (const r of skillRows) {
    if (seenSkill.has(r.skill)) continue;
    seenSkill.add(r.skill);
    skills.push({ label: SKILL_LABEL[r.skill] ?? r.skill, pct: SKILL_PCT[r.level] ?? 60 });
  }

  // Kết quả gần đây (bài đã chấm điểm).
  const graded = results.filter((r) => r.score != null && r.totalPoints > 0).slice(0, 4);
  const resultRows: ResultRow[] = graded.map((r) => ({ title: r.title, score: r.score as number, total: r.totalPoints }));
  const avgScore = graded.length
    ? Math.round((graded.reduce((s, r) => s + ((r.score as number) / r.totalPoints) * 10, 0) / graded.length) * 10) / 10
    : null;

  // Buổi tiếp theo: KHÔNG được chọn buổi đã huỷ. `!s.past` đúng với mọi buổi huỷ (kể cả
  // buổi huỷ trong quá khứ — `daDienRa` của buổi huỷ luôn false), nên bản cũ trỏ phụ
  // huynh tới một NGÀY ĐÃ QUA, chọi với thẻ "Lớp học tiếp theo" ngay bên dưới.
  const next = view.sessions.find((s) => !s.past && s.attendance !== "CANCELLED");
  const nextIsToday = next?.today ?? false;
  const nextLabel = next ? (next.today ? "Hôm nay" : dmy(next.date)) : null;

  return {
    studentName: student?.name ?? sched?.studentName ?? "học sinh",
    courseName: sched?.courseName ?? null,
    className: sched?.className ?? null,
    teacher: enr?.class?.teacher?.name ?? null,
    done,
    total,
    progressPct,
    attendanceRate: sched?.rate ?? 0,
    pendingCount: todos.length,
    nextLabel,
    nextIsToday,
    remaining,
    present: view.present,
    absent: view.absent,
    makeupNeed: makeup.needCount,
    makeupDone: makeup.doneCount,
    journey,
    todos,
    nextClass,
    skills,
    results: resultRows,
    avgScore,
  };
}
