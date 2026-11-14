import "server-only";
import { db } from "@/lib/db";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import {
  assignmentWindow,
  realDueAt,
  type AssignmentWindowInput,
} from "@/lib/lms/assignment-window";
import { napBuoiCuaLop } from "@/lib/portal/buoi-hoc";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { vnParts } from "@/lib/time/vn";

// Portal v2 — Cổng học sinh "Bài tập": lộ trình từng buổi + trạng thái bài tập của con.
//
// 06/09 — lộ trình đi theo BUỔI HỌC, không theo bài giáo trình. Bản cũ lọc
// `lessonId: { not: null }` rồi khử trùng theo `lesson.id` và xếp theo `Lesson.order`:
// lớp chưa ghim giáo trình ra lộ trình RỖNG, còn lớp có buổi bù thì mất đúng buổi bù
// (buổi bù mang cùng lessonId với buổi đã huỷ — xem lib/portal/buoi-hoc.ts).

const ACTIVE = GHI_DANH_DANG_HOC; // lib/portal/trang-thai-ghi-danh.ts
const DONE = new Set(["SUBMITTED", "GRADED"]);

export type TrackAssignment = {
  id: string;
  title: string;
  /** Hạn nộp THẬT (đã lọc sentinel 1970) — null = bài không đặt hạn, PH thấy ô trống. */
  dueAt: string | null;
  done: boolean;
  /**
   * "Hết đường nộp" — cổng nộp bài sẽ chặn nếu PH bấm vào (site GV 25/08). Đang trong
   * cửa nộp bù GV mở thì KHÔNG phải `closed`: bài vẫn nộp được, gắn cờ chỉ làm PH tưởng
   * đã mất bài.
   */
  closed: boolean;
  /**
   * `closed` VÌ QUÁ HẠN — tức có hạn nộp thật và hạn đó đã trôi qua.
   *
   * Tách khỏi `closed` vì truy vấn lấy cả `status = CLOSED`: bài admin đóng tay mà chưa
   * từng đặt hạn cũng đóng, nhưng dán "Quá hạn" cho nó là báo PH lỡ một cái hạn KHÔNG
   * HỀ TỒN TẠI — mà ô "Hạn" ngay cạnh thì đang để trống.
   */
  overdue: boolean;
  /** `12/09/2026` theo lịch VN, tính sẵn ở server; `""` khi bài không đặt hạn. */
  nhanHan: string;
};
export type TrackItem = {
  key: string;
  /** Buổi thứ mấy của lớp — khớp site giáo viên/admin. */
  order: number;
  /** Tên bài TRẦN. */
  title: string;
  /** Nhãn đầy đủ `Buổi 5 - HP2 - Họa Sĩ Robot`. */
  nhan: string;
  /** `dd/MM/yyyy` theo lịch VN, tính sẵn ở server. */
  nhanNgay: string;
  sessionDate: string | null;
  taught: boolean;
  assignment: TrackAssignment | null;
};
export type AssignmentTrack = {
  courseName: string | null;
  className: string | null;
  teacher: string | null;
  done: number;
  total: number;
  progressPct: number;
  items: TrackItem[];
  /**
   * Bài giáo viên giao mà KHÔNG gắn buổi nào (`classSessionId` và `lessonId` đều rỗng).
   *
   * Trước 06/09 nhóm này bị nuốt hoàn toàn: lộ trình chỉ dựng từ buổi, bài nào không
   * móc được vào buổi thì không có chỗ nào hiện. Đo trên DB làm việc — 176/176 bài rơi
   * vào đây, tức toàn bộ bài tập vô hình với học viên.
   */
  ngoaiLoTrinh: TrackAssignment[];
};

export async function getStudentAssignmentTrack(studentId: string): Promise<AssignmentTrack> {
  const [enrollments, sched, enrTeacher] = await Promise.all([
    db.enrollment.findMany({
      where: { studentId, status: { in: [...ACTIVE] }, deletedAt: null },
      select: { classId: true },
    }),
    getStudentSchedule(studentId),
    // 06/09 — LỌC ghi danh còn hiệu lực. Bản cũ lấy ghi danh mới nhất bất kể trạng thái:
    // con rút khỏi lớp B (WITHDREW / xoá mềm) rồi vào lớp A thì trang Bài tập in tên
    // giáo viên của LỚP B đã nghỉ. Cùng lỗi với `lib/portal/student-home.ts`.
    db.enrollment.findFirst({
      where: { studentId, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null },
      orderBy: { enrolledAt: "desc" },
      select: { class: { select: { teacher: { select: { name: true } } } } },
    }),
  ]);
  const classIds = enrollments.map((e) => e.classId);

  const now = new Date();
  const items: TrackItem[] = [];
  /** Bài giáo viên giao mà KHÔNG gắn buổi nào — vẫn phải hiện, đừng nuốt. */
  const ngoaiLoTrinh: TrackAssignment[] = [];
  if (classIds.length > 0) {
    const [buoiList, assignments] = await Promise.all([
      // TOÀN BỘ buổi (kể cả buổi chưa gắn giáo án và buổi đã huỷ) — điều kiện để
      // `buildSessionNumberMap` đánh đúng số buổi. Buổi huỷ lọc bỏ lúc dựng danh sách.
      napBuoiCuaLop(classIds, now),
      // ⚠️ KHÔNG lọc `lessonId: { not: null }` (06/09). Đo trên DB làm việc:
      // **176/176 bài tập có `lessonId = NULL`** — `templateToAssignmentData` chỉ chép
      // `lessonId` khi ĐỀ MẪU có gắn bài giáo trình, mà ô đó không bắt buộc; bài admin
      // tạo thẳng ở /admin/assignments cũng thường bỏ trống. Lọc như cũ là xoá SẠCH bài
      // tập khỏi cổng học viên, câm lặng.
      db.assignment.findMany({
        where: { classId: { in: classIds }, status: { in: ["PUBLISHED", "CLOSED"] } },
        select: {
          id: true,
          lessonId: true,
          // Site GV 18/08 — bài giao gắn thẳng một buổi. Đây là đường nối CHÍNH XÁC
          // nhất, ưu tiên hơn `lessonId`.
          classSessionId: true,
          title: true,
          dueAt: true,
          // Cần cho assignmentWindow — thiếu 2 cột này thì cổng PH và màn GV nói khác nhau.
          status: true,
          lateUntil: true,
          submissions: { where: { studentId }, select: { status: true }, take: 1 },
        },
        orderBy: { assignedAt: "asc" },
      }),
    ]);

    type BaiRow = (typeof assignments)[number];
    // Ba đường nối bài ↔ buổi, theo thứ tự chắc chắn giảm dần.
    const theoBuoi = new Map<string, BaiRow>();
    const theoBai = new Map<string, BaiRow>();
    const khongGanBuoi: BaiRow[] = [];
    for (const a of assignments) {
      if (a.classSessionId) {
        if (!theoBuoi.has(a.classSessionId)) theoBuoi.set(a.classSessionId, a);
      } else if (a.lessonId) {
        if (!theoBai.has(a.lessonId)) theoBai.set(a.lessonId, a);
      } else {
        khongGanBuoi.push(a);
      }
    }

    // Bài giáo trình của TỪNG buổi — nạp riêng để truy vấn buổi không phải lọc
    // `lessonId != null` (chính cái lọc làm lộ trình rỗng ở lớp chưa ghim giáo trình).
    const lessonCuaBuoi = new Map(
      (
        await db.classSession.findMany({
          where: { classId: { in: classIds } },
          select: { id: true, lessonId: true },
        })
      ).map((r) => [r.id, r.lessonId]),
    );

    for (const b of buoiList) {
      if (b.daHuy) continue; // buổi huỷ không có bài tập để làm
      const lessonId = lessonCuaBuoi.get(b.id) ?? null;
      const a = theoBuoi.get(b.id) ?? (lessonId ? theoBai.get(lessonId) : undefined);
      const assignment = a ? dungBaiTap(a, now) : null;
      items.push({
        // Khoá theo BUỔI, không theo bài: hai buổi cùng bài (buổi bù) là hai dòng khác nhau.
        key: b.id,
        // 08/09 — số LỘ TRÌNH. `student-home.ts:140` in `Buổi ${it.order}` cạnh tên bài.
        order: b.soBuoiLoTrinh ?? b.soBuoi,
        title: b.tieuDe || "Buổi học",
        nhan: b.nhanDayDu || "Buổi học",
        nhanNgay: b.nhanNgay,
        sessionDate: b.ngayISO,
        taught: b.daDienRa,
        assignment,
      });
    }
    for (const a of khongGanBuoi) ngoaiLoTrinh.push(dungBaiTap(a, now));
  }

  return {
    courseName: sched?.courseName ?? null,
    className: sched?.className ?? null,
    teacher: enrTeacher?.class?.teacher?.name ?? null,
    done: sched?.done ?? 0,
    total: sched?.total ?? items.length,
    progressPct: sched?.total ? Math.round(((sched?.done ?? 0) / sched.total) * 100) : 0,
    items,
    ngoaiLoTrinh,
  };
}

/** `dd/MM/yyyy` theo lịch VN — Server Component chạy UTC trên Vercel, đừng format ở đó. */
function nhanNgayVn(d: Date): string {
  const p = vnParts(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}/${p.year}`;
}

/** Một dòng bài tập cho cổng học viên — cùng luật cửa nộp với site giáo viên. */
function dungBaiTap(
  a: AssignmentWindowInput & {
    id: string;
    title: string;
    submissions: { status: string }[];
  },
  now: Date,
): TrackAssignment {
  const done = DONE.has(a.submissions[0]?.status ?? "");
  // Cùng hàm mà cổng nộp bài (portal/bai-tap/actions) và màn GV dùng: cờ của PH phải
  // tắt đúng lúc bài lại nộp được, không thì PH thấy đỏ mà vẫn nộp được (hoặc ngược
  // lại — thấy bình thường mà nộp bị chặn).
  const closed = !done && !assignmentWindow(a, now).acceptsSubmission;
  // Hạn THẬT, không phải `a.dueAt` thô: bài seed để epoch 1970 mà in ra thì PH đọc
  // "Hạn 01/01/1970" và cờ dưới đây cũng sẽ nói bài quá hạn 56 năm.
  const due = realDueAt(a.dueAt);
  const overdue = closed && due != null && now.getTime() > due.getTime();
  return {
    id: a.id,
    title: a.title,
    dueAt: due?.toISOString() ?? null,
    nhanHan: due ? nhanNgayVn(due) : "",
    done,
    closed,
    overdue,
  };
}
