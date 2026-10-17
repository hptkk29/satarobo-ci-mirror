import "server-only";
import { db } from "@/lib/db";
import { demBuoi, napBuoiCuaLop } from "@/lib/portal/buoi-hoc";
import { getStudentAttendanceSummaries, getStudentClasses } from "@/lib/portal/learning";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { vnParts } from "@/lib/time/vn";

// Portal v2 — Cổng học sinh "Buổi học": mục tiêu + điểm danh + bài tập từng buổi.
//
// ─────────────────────────────────────────────────────────────────────────────
// Viết lại 06/09/2026. Bản cũ có bốn khiếm khuyết CHỒNG NHAU, ba cái làm MẤT buổi học:
//
// 1. `where: { lessonId: { not: null } }` — lớp chưa ghim giáo trình thì trang này TRỐNG
//    TRƠN dù lớp đang chạy. `generateClassSessions` gán `lessonIds[i] ?? null` nên buổi
//    vượt quá số bài của giáo trình cũng rơi vào đây, và màn "Thêm buổi" của admin cho
//    phép bỏ trống ô Giáo án.
// 2. `if (!l || seen.has(l.id)) continue` — khử trùng theo bài học, giữ bản ghi ĐẦU theo
//    ngày. Sau một lần huỷ buổi (buổi bù mang y nguyên `lessonId` — lib/classes/adjust.ts)
//    thì bản ghi đầu chính là buổi ĐÃ HUỶ, và buổi bù CÓ THẬT biến mất khỏi danh sách.
// 3. `items.sort((x, y) => x.order - y.order)` với `order = Lesson.order` — không phải số
//    buổi của lớp; xem lib/portal/buoi-hoc.ts.
// 4. `else attendance = "PRESENT"  // past, chưa điểm danh → coi như có mặt (an toàn)` —
//    KHÔNG an toàn: buổi giáo viên quên chấm được đếm là con ĐÃ ĐI HỌC, và `done` phồng
//    lên lệch hẳn con số ở trang chủ phụ huynh. Nay có trạng thái riêng `UNMARKED`.
//
// Mọi con số tổng ở đây (đã học / có mặt / vắng / học bù) nay lấy từ
// `getStudentAttendanceSummaries` — CÙNG nguồn với trang chủ phụ huynh, học bạ và site
// giáo viên — thay vì tự đếm lại một kiểu thứ tư.
// ─────────────────────────────────────────────────────────────────────────────

const DONE = new Set(["SUBMITTED", "GRADED"]);

export type SessionAttendance =
  | "PRESENT"
  | "EXCUSED"
  | "ABSENT"
  | "MAKEUP"
  | "FUTURE"
  /** Buổi đã diễn ra nhưng giáo viên chưa chấm — KHÔNG được coi là có mặt. */
  | "UNMARKED"
  | "CANCELLED";

export type StudentSessionItem = {
  id: string;
  /** Buổi thứ mấy của lớp — khớp site giáo viên/admin. */
  order: number;
  /** Tên bài TRẦN; `Buổi học` khi chưa ghim giáo trình. */
  title: string;
  /** Nhãn đầy đủ `Buổi 5 - HP2 - Họa Sĩ Robot`. */
  nhan: string;
  /** Lớp nào — chỉ khác null khi con học nhiều lớp. */
  className: string | null;
  date: string;
  /** Nhãn ngày tính sẵn theo lịch VN — component đừng format lại. */
  nhanNgay: string;
  past: boolean;
  today: boolean;
  attendance: SessionAttendance;
  objectives: string[];
  assignment: {
    id: string;
    title: string;
    dueAt: string | null;
    /** `Hạn: 12/09/2026` hoặc chuỗi rỗng khi bài không đặt hạn. */
    nhanHan: string;
    done: boolean;
  } | null;
};

export type StudentSessionsView = {
  courseName: string | null;
  className: string | null;
  done: number;
  total: number;
  present: number;
  absent: number;
  makeup: number;
  /**
   * Buổi ĐÃ DIỄN RA mà giáo viên chưa chấm điểm danh.
   *
   * Phải bày ra, không được giấu: thiếu nó thì "Đã diễn ra 10" và "Có mặt 6 · Vắng 1"
   * cộng không khớp, phụ huynh đọc ra "con vắng 3 buổi mà không ai báo".
   */
  chuaCham: number;
  sessions: StudentSessionItem[];
};

export async function getStudentSessionsView(studentId: string): Promise<StudentSessionsView> {
  const [lopDangHoc, sched] = await Promise.all([
    getStudentClasses(studentId),
    getStudentSchedule(studentId),
  ]);
  const classIds = lopDangHoc.map((c) => c.id);
  const empty: StudentSessionsView = {
    courseName: sched?.courseName ?? null,
    className: sched?.className ?? null,
    done: 0,
    total: 0,
    present: 0,
    absent: 0,
    makeup: 0,
    chuaCham: 0,
    sessions: [],
  };
  if (classIds.length === 0) return empty;

  const now = new Date();
  const [buoiList, chiTiet, attendances, makeups, assignments, chuyenCan] = await Promise.all([
    napBuoiCuaLop(classIds, now),
    // Mục tiêu buổi nằm ở Lesson; nạp riêng theo buổi để KHÔNG phải lọc `lessonId != null`
    // ở truy vấn buổi (chính cái lọc đã làm mất buổi ở bản cũ).
    db.classSession.findMany({
      where: { classId: { in: classIds } },
      select: {
        id: true,
        lessonId: true,
        lesson: { select: { objectives: true } },
      },
    }),
    db.attendance.findMany({
      where: { studentId, session: { classId: { in: classIds } } },
      select: { sessionId: true, status: true },
    }),
    db.makeupNeed.findMany({
      where: { studentId, status: "COMPLETED" },
      select: { missedSessionId: true },
    }),
    // ⚠️ KHÔNG lọc `lessonId: { not: null }` (06/09). Đo trên DB làm việc: 176/176 bài
    // tập có `lessonId = NULL` — đề giáo viên tự soạn ở Kho bài tập không có ô chọn bài
    // giáo trình, nên bài vừa giao xong không bao giờ hiện ở khối "Bài tập của buổi".
    db.assignment.findMany({
      where: { classId: { in: classIds }, status: { in: ["PUBLISHED", "CLOSED"] } },
      select: {
        id: true,
        lessonId: true,
        // Đường nối CHÍNH XÁC nhất: giáo viên chọn buổi lúc giao (site GV 18/08).
        classSessionId: true,
        title: true,
        dueAt: true,
        submissions: { where: { studentId }, select: { status: true }, take: 1 },
      },
      orderBy: { assignedAt: "asc" },
    }),
    getStudentAttendanceSummaries(studentId),
  ]);

  const attMap = new Map(attendances.map((a) => [a.sessionId, a.status]));
  const madeUp = new Set(makeups.map((m) => m.missedSessionId));
  const chiTietCua = new Map(chiTiet.map((c) => [c.id, c]));
  const lopCua = new Map(lopDangHoc.map((c) => [c.id, c]));
  const nhieuLop = classIds.length > 1;

  // Hai đường nối bài ↔ buổi. `classSessionId` là đích danh nên thắng; `lessonId` là
  // đường phụ (nhiều buổi cùng một bài — buổi bù — thì cùng trỏ về một bài tập, đúng).
  type BaiRow = (typeof assignments)[number];
  const baiTheoBuoi = new Map<string, BaiRow>();
  const baiTheoLesson = new Map<string, BaiRow>();
  for (const a of assignments) {
    if (a.classSessionId) {
      if (!baiTheoBuoi.has(a.classSessionId)) baiTheoBuoi.set(a.classSessionId, a);
    } else if (a.lessonId && !baiTheoLesson.has(a.lessonId)) {
      baiTheoLesson.set(a.lessonId, a);
    }
  }

  const sessions: StudentSessionItem[] = buoiList.map((b) => {
    const ct = chiTietCua.get(b.id);
    const st = attMap.get(b.id);

    let attendance: SessionAttendance;
    if (b.daHuy) attendance = "CANCELLED";
    else if (madeUp.has(b.id)) attendance = "MAKEUP";
    else if (!b.daDienRa) attendance = "FUTURE";
    else if (st === "PRESENT" || st === "LATE") attendance = "PRESENT";
    else if (st === "EXCUSED" || st === "ABSENT_EXCUSED") attendance = "EXCUSED";
    else if (st === "ABSENT" || st === "ABSENT_UNEXCUSED") attendance = "ABSENT";
    // Buổi đã qua mà không có dòng điểm danh nào: giáo viên chưa chấm. Bản cũ ghi
    // "PRESENT" cho ca này và làm số "đã học" nói dối.
    else attendance = "UNMARKED";

    const a =
      baiTheoBuoi.get(b.id) ?? (ct?.lessonId ? baiTheoLesson.get(ct.lessonId) : undefined);
    const cls = lopCua.get(b.classId);

    return {
      id: b.id,
      order: b.soBuoi,
      title: b.tieuDe || "Buổi học",
      nhan: b.nhanDayDu || "Buổi học",
      className: nhieuLop ? cls?.classCode ?? cls?.name ?? null : null,
      date: b.ngayISO,
      nhanNgay: b.nhanNgay,
      past: b.daDienRa,
      today: b.homNay,
      attendance,
      objectives: ct?.lesson?.objectives ?? [],
      assignment: a
        ? {
            id: a.id,
            title: a.title,
            dueAt: a.dueAt?.toISOString() ?? null,
            // Bài không đặt hạn thì ĐỂ TRỐNG. Bản cũ in `dmy(dueAt ?? "")` →
            // `new Date("")` → phụ huynh đọc ra "Hạn: NaN/NaN/NaN".
            nhanHan: a.dueAt ? nhanNgayVn(a.dueAt) : "",
            done: DONE.has(a.submissions[0]?.status ?? ""),
          }
        : null,
    };
  });

  const dem = demBuoi(buoiList);
  const tong = chuyenCan.reduce(
    (acc, s) => ({
      attended: acc.attended + s.attended,
      absent: acc.absent + s.absent + s.needMakeup,
      madeUp: acc.madeUp + s.madeUp,
    }),
    { attended: 0, absent: 0, madeUp: 0 },
  );

  return {
    courseName: sched?.courseName ?? null,
    className: sched?.className ?? null,
    done: dem.daDienRa,
    total: dem.tong,
    present: tong.attended,
    absent: tong.absent,
    makeup: tong.madeUp,
    chuaCham: sessions.filter((s) => s.attendance === "UNMARKED").length,
    sessions,
  };
}

/** `dd/MM/yyyy` theo lịch VN — không lệ thuộc TZ tiến trình (Vercel chạy UTC). */
function nhanNgayVn(d: Date): string {
  const p = vnParts(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}/${p.year}`;
}
