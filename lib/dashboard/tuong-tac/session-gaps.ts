// lib/dashboard/tuong-tac/session-gaps.ts — E-01 "Buổi học & đánh giá còn thiếu".
//
// MỘT lần quét trả về CẢ con số lẫn danh sách. Đó không phải tối ưu, đó là ràng buộc
// nghiệp vụ (AC E-01-3): "con số của tôi phải khớp thứ tôi thấy khi bấm vào". Hai đường
// đi riêng thì sớm muộn lệch, và lệch ở đây không ai nhìn ra bằng mắt.
//
// ┌─ VÌ SAO KHÔNG DÙNG LẠI `sessionIncomplete` (lib/pending-tasks.ts:235) ────────────┐
// │ Bốn lỗi đo được ngày 24/08, cả bốn đều là hỏng CÂM (ra số, không ra lỗi):        │
// │  1. ĐO SAI VIỆC — nó đếm `status != "COMPLETED"` (:241), tức "chưa ai bấm nút     │
// │     Hoàn tất buổi". Buổi đủ ba việc mà quên bấm vẫn bị đếm là nợ; buổi đã bấm     │
// │     mà chưa ai nhận xét thì biến mất. Spec E-01 hỏi "chưa điểm danh / chưa        │
// │     đánh giá" — hai câu hỏi khác hẳn.                                            │
// │  2. KHÔNG CÓ KHOẢNG NGÀY — cứng `date < startOfToday` (:240) ⇒ đổi bộ lọc ngày    │
// │     trên dashboard thì con số đứng im.                                           │
// │  3. TRẦN 50 — `take: 50` (:245) rồi `count: rows.length` (:254) ⇒ cơ sở nợ 200    │
// │     buổi vẫn hiện đúng "50", mãi mãi.                                            │
// │  4. ĐƠN TRỊ CƠ SỞ — `centerScope = user.centerId` (:114) ⇒ QLCS giữ 2 cơ sở       │
// │     chỉ thấy 1, mâu thuẫn trực tiếp với bộ lọc phạm vi A-02.                      │
// │ File này KHÔNG sửa `sessionIncomplete`: nó đang phục vụ thẻ việc-cần-làm của      │
// │ dashboard quản lý với ngữ nghĩa riêng ("buổi quá ngày chưa chốt"). Sửa nó là      │
// │ đổi một màn khác đang chạy — việc của ticket khác.                               │
// └──────────────────────────────────────────────────────────────────────────────────┘
//
// ĐỊNH NGHĨA "còn thiếu" KHÔNG viết lại ở đây. Ba việc sau buổi (điểm danh đủ lớp ·
// nhận xét đủ em đi học · ảnh đủ em đi học) và sáu bậc thời gian đều lấy nguyên của
// `lib/lms/attendance-queue` — cùng nguồn với màn /admin/attendance, nên bấm từ con số
// sang danh sách không đổi luật giữa đường.
//
// Cột "giáo viên phụ trách" đi qua `lib/lms/session-teacher` (OQ-5), KHÔNG tự `??` tại chỗ.
import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import {
  ATTENDANCE_QUEUE_LABEL,
  attendedStudentIds,
  photoCoveredCount,
  resolveAttendanceQueuePhase,
  sessionWorkState,
  sortAttendanceQueue,
  type AttendanceQueuePhase,
  type SessionWorkInput,
} from "@/lib/lms/attendance-queue";
import {
  buildSessionMediaCoverage,
  buildSessionNumberMap,
  SESSION_MEDIA_SELECT,
  type SessionMediaCoverage,
} from "@/lib/lms/session-order";
import { deriveSessionTitle } from "@/lib/lms/session-project-name";
import {
  resolveSessionTeacher,
  type SessionTeacherSource,
} from "@/lib/lms/session-teacher";
import type { ScopeFilters } from "@/lib/reports/scope-filters";

/**
 * Trần AN TOÀN của một lượt quét, tính theo SỐ BUỔI.
 *
 * Khác hẳn `take: 50` của bản cũ ở hai điểm, và cả hai đều quan trọng:
 *  • nó cao hơn quy mô thật vài bậc (một cơ sở ~20 lớp × ~12 buổi/tháng ≈ 240 buổi/tháng),
 *    nên đường chạy thật không bao giờ chạm;
 *  • chạm trần thì hàm BÁO RA (`truncated: true`) chứ không lặng lẽ trả số cụt.
 * Phải có trần vì con số này KHÔNG đếm được bằng `count()`: "còn thiếu việc" xét theo
 * TỪNG HỌC VIÊN, nên buộc phải nạp roster/điểm danh/nhận xét/ảnh của từng buổi.
 */
export const SESSION_GAP_SCAN_MAX = 5_000;

/** Số dòng mặc định mỗi trang của danh sách đích. */
export const SESSION_GAP_PAGE_SIZE = 50;

/** Trần số dòng/trang — chặn `?pageSize=100000` biến trang thành một lượt tải nặng. */
export const SESSION_GAP_PAGE_SIZE_MAX = 200;

/**
 * Bậc được bày ra DANH SÁCH ĐÍCH — đúng ba thứ spec E-01 đòi: "buổi chưa điểm danh,
 * chưa đánh giá, buổi sắp tới". Buổi đã xong / đã huỷ / lớp không còn học viên vẫn được
 * ĐẾM (để tổng có nghĩa) nhưng không chiếm chỗ trong danh sách việc phải làm.
 */
export const SESSION_GAP_LIST_PHASES: AttendanceQueuePhase[] = [
  "PENDING",
  "TODAY",
  "UPCOMING",
];

// ─── Kiểu ───────────────────────────────────────────────────────────────────────────

/** Buổi học đã nạp thô từ DB — đúng phần `buildSessionGapRows` cần. */
export type SessionGapScanRow = {
  id: string;
  classId: string;
  centerId: string | null;
  date: Date;
  /** `ClassSession.status` dạng chuỗi để phần thuần không phải import @prisma/client. */
  status: string;
  topic: string | null;
  substituteTeacherId: string | null;
  actualTeacherId: string | null;
  plan: { customTitle: string | null } | null;
  lesson: { title: string | null } | null;
  class: { name: string; classCode: string | null; teacherId: string | null } | null;
};

/** Một dòng của danh sách đích. */
export type SessionGapRow = {
  id: string;
  classId: string;
  centerId: string | null;
  className: string;
  classCode: string;
  /** Buổi thứ mấy của lớp (null = không tra được). */
  number: number | null;
  /** Tiêu đề buổi từ giáo trình lớp; rỗng = lớp chưa ghim giáo trình. */
  title: string;
  date: Date;
  phase: AttendanceQueuePhase;
  phaseLabel: string;
  attendanceDone: boolean;
  feedbackDone: boolean;
  photoDone: boolean;
  /** Sĩ số lớp (học viên còn hiệu lực). */
  roster: number;
  /** Học viên CỦA LỚP đã được chấm (không cộng học viên học bù, kẻo > sĩ số). */
  marked: number;
  /** Người thực sự đi học buổi này (PRESENT/LATE). */
  attended: number;
  /** Bao nhiêu em đi học đã có ảnh — chỉ để hiển thị "Ảnh 7/9". */
  photoCovered: number;
  teacherId: string | null;
  /** Rỗng khi lớp chưa phân công, hoặc tài khoản GV không tra được tên. */
  teacherName: string;
  teacherSource: SessionTeacherSource;
};

/**
 * Bảng đếm của E-01.
 *
 * ⚠️ Ba chip `missing*` chỉ đếm TRONG nhóm `PENDING` (buổi ĐÃ tới giờ mà còn nợ việc).
 * Không giới hạn như vậy thì mỗi buổi tương lai đã xếp lịch đều "thiếu cả ba" và con số
 * phồng theo lịch chứ không theo việc — đúng loại số vô nghĩa mà E-01 sinh ra để thay.
 */
export type SessionGapCounts = {
  /** Buổi đã tới giờ mà còn thiếu ≥1 trong ba việc. Đây là CON SỐ CHÍNH của thẻ E-01. */
  pending: number;
  /** Trong nhóm trên: chưa điểm danh đủ lớp. */
  missingAttendance: number;
  /** Trong nhóm trên: chưa nhận xét đủ học viên đi học. */
  missingFeedback: number;
  /** Trong nhóm trên: chưa đủ ảnh/video cho học viên đi học. */
  missingMedia: number;
  /** Buổi chưa tới giờ trong khoảng (hôm nay + từ mai trở đi). */
  upcoming: number;
  /** Buổi đã đủ ba việc. */
  done: number;
  /** Buổi của lớp không còn học viên đang học — không còn việc để làm. */
  noRoster: number;
  /** Buổi đã huỷ. */
  cancelled: number;
  /** Tổng buổi đã xét trong khoảng (mẫu số của mọi tỷ lệ). */
  scanned: number;
};

export type SessionGapCenterCounts = {
  centerId: string;
  centerName: string;
  counts: SessionGapCounts;
};

export type SessionGapReport = {
  counts: SessionGapCounts;
  /** OQ-4: `null` khi bộ lọc đang GỘP; mảng theo đúng thứ tự `filters.centerIds` khi TÁCH. */
  byCenter: SessionGapCenterCounts[] | null;
  /** Lượt quét chạm trần an toàn ⇒ con số là "ít nhất chừng này", không phải con số đủ. */
  truncated: boolean;
};

export type SessionGapList = SessionGapReport & {
  /** Dòng của TRANG hiện tại. */
  rows: SessionGapRow[];
  /** Tổng dòng khớp bộ lọc bậc (TRƯỚC khi cắt trang) — không bao giờ bị trần trang chặn. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

// ─── Phần THUẦN ─────────────────────────────────────────────────────────────────────

export function emptySessionGapCounts(): SessionGapCounts {
  return {
    pending: 0,
    missingAttendance: 0,
    missingFeedback: 0,
    missingMedia: 0,
    upcoming: 0,
    done: 0,
    noRoster: 0,
    cancelled: 0,
    scanned: 0,
  };
}

/** Đếm theo bậc. Xem ghi chú của `SessionGapCounts` về việc `missing*` chỉ tính PENDING. */
export function tallySessionGaps(rows: SessionGapRow[]): SessionGapCounts {
  const c = emptySessionGapCounts();
  for (const r of rows) {
    c.scanned += 1;
    switch (r.phase) {
      case "PENDING":
        c.pending += 1;
        if (!r.attendanceDone) c.missingAttendance += 1;
        if (!r.feedbackDone) c.missingFeedback += 1;
        if (!r.photoDone) c.missingMedia += 1;
        break;
      case "TODAY":
      case "UPCOMING":
        c.upcoming += 1;
        break;
      case "DONE":
        c.done += 1;
        break;
      case "NO_ROSTER":
        c.noRoster += 1;
        break;
      case "CANCELLED":
        c.cancelled += 1;
        break;
    }
  }
  return c;
}

/**
 * Tách bảng đếm theo cơ sở.
 *
 * Giữ NGUYÊN thứ tự `centerIds` của bộ lọc và giữ cả cơ sở 0 buổi: cột biến mất khi về 0
 * làm người đọc tưởng cơ sở đó "đã xong", trong khi sự thật có thể là chưa xếp buổi nào.
 * Buổi `centerId = null` (dữ liệu chưa backfill) không thuộc cơ sở nào nên không vào cột
 * nào — nó vẫn nằm trong tổng gộp.
 */
export function splitSessionGapsByCenter(
  rows: SessionGapRow[],
  centerIds: string[],
  centerNames: Record<string, string>,
): SessionGapCenterCounts[] {
  const byId = new Map<string, SessionGapRow[]>(centerIds.map((id) => [id, []]));
  for (const r of rows) {
    if (!r.centerId) continue;
    byId.get(r.centerId)?.push(r);
  }
  return centerIds.map((id) => ({
    centerId: id,
    centerName: centerNames[id] ?? id,
    counts: tallySessionGaps(byId.get(id) ?? []),
  }));
}

const NO_MEDIA: SessionMediaCoverage = { classWide: false, tagged: new Set<string>() };
const EMPTY_ROSTER: ReadonlySet<string> = new Set<string>();

/**
 * Ráp dữ liệu thô thành dòng danh sách, đã XẾP THỨ TỰ (việc còn nợ lên trước).
 *
 * THUẦN — không DB, nên mọi ca lệch đếm test được mà không cần Postgres.
 */
export function buildSessionGapRows(input: {
  sessions: SessionGapScanRow[];
  /** sessionId → buổi thứ mấy. Phải dựng từ TOÀN BỘ buổi của lớp, không từ cửa sổ ngày. */
  numberOf: Map<string, number>;
  /** classId → học viên đang học. */
  rosterOf: Map<string, ReadonlySet<string>>;
  /** sessionId → bản ghi điểm danh (kể cả học viên học bù). */
  attendanceOf: Map<string, { studentId: string; status: string }[]>;
  /** sessionId → học viên đã có phiếu nhận xét. */
  feedbackOf: Map<string, string[]>;
  /** sessionId → độ phủ ảnh (buildSessionMediaCoverage). */
  mediaOf: Map<string, SessionMediaCoverage>;
  /** userId → tên giáo viên. */
  teacherNameOf: Map<string, string>;
  now: Date;
}): SessionGapRow[] {
  const built = input.sessions.map((s) => {
    const roster = input.rosterOf.get(s.classId) ?? EMPTY_ROSTER;
    const attendance = input.attendanceOf.get(s.id) ?? [];
    const cover = input.mediaOf.get(s.id) ?? NO_MEDIA;
    const workInput: SessionWorkInput = {
      rosterStudentIds: roster,
      attendanceRows: attendance,
      feedbackStudentIds: input.feedbackOf.get(s.id) ?? [],
      media: { taggedStudentIds: cover.tagged, hasClassWide: cover.classWide },
    };
    const work = sessionWorkState(workInput);
    const phase = resolveAttendanceQueuePhase({
      date: s.date,
      cancelled: s.status === "CANCELLED",
      rosterEmpty: roster.size === 0,
      work,
      now: input.now,
    });
    const teacher = resolveSessionTeacher({
      substituteTeacherId: s.substituteTeacherId,
      actualTeacherId: s.actualTeacherId,
      classTeacherId: s.class?.teacherId ?? null,
    });
    const row: SessionGapRow = {
      id: s.id,
      classId: s.classId,
      centerId: s.centerId,
      className: s.class?.name ?? "",
      classCode: s.class?.classCode ?? "",
      number: input.numberOf.get(s.id) ?? null,
      title: deriveSessionTitle({
        planTitle: s.plan?.customTitle,
        lessonTitle: s.lesson?.title,
        topic: s.topic,
      }),
      date: s.date,
      phase,
      phaseLabel: ATTENDANCE_QUEUE_LABEL[phase],
      attendanceDone: work.attendanceDone,
      feedbackDone: work.feedbackDone,
      photoDone: work.photoDone,
      roster: roster.size,
      // "điểm danh x/y" chỉ đếm học viên CỦA LỚP đã chấm — học viên học bù không cộng
      // vào tử số, nếu không x > y ở đúng những lớp có người học bù.
      marked: attendance.filter((a) => roster.has(a.studentId)).length,
      attended: attendedStudentIds(attendance).size,
      photoCovered: photoCoveredCount(workInput),
      teacherId: teacher.teacherId,
      teacherName: teacher.teacherId
        ? (input.teacherNameOf.get(teacher.teacherId) ?? "")
        : "",
      teacherSource: teacher.source,
    };
    return row;
  });

  // Thứ tự dùng chung với màn /admin/attendance — bấm từ con số sang danh sách không
  // được đổi luật xếp giữa đường.
  return sortAttendanceQueue(built, (r) => ({
    phase: r.phase,
    number: r.number,
    time: r.date.getTime(),
  }));
}

/**
 * Cắt trang ở tầng hiển thị.
 *
 * Trang vượt biên bị KẸP về trang cuối chứ không trả bảng trắng: `?page=99` gõ tay (hoặc
 * còn sót trong đường dẫn sau khi bộ lọc thu hẹp) mà trả rỗng thì người dùng đọc thành
 * "hết việc rồi" — đúng loại hiểu nhầm nguy hiểm nhất của màn này.
 */
export function paginateSessionGaps<T>(
  rows: T[],
  page: number,
  pageSize: number,
): { rows: T[]; page: number; pageSize: number; pageCount: number; total: number } {
  const size = Math.min(
    Math.max(1, Math.trunc(Number.isFinite(pageSize) ? pageSize : SESSION_GAP_PAGE_SIZE)),
    SESSION_GAP_PAGE_SIZE_MAX,
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const wanted = Number.isFinite(page) ? Math.trunc(page) : 1;
  const current = Math.min(Math.max(1, wanted), pageCount);
  const start = (current - 1) * size;
  return {
    rows: rows.slice(start, start + size),
    page: current,
    pageSize: size,
    pageCount,
    total: rows.length,
  };
}

// ─── Phần DB ────────────────────────────────────────────────────────────────────────

export type SessionGapOptions = {
  page?: number;
  pageSize?: number;
  /** Bậc được bày ra danh sách. Mặc định `SESSION_GAP_LIST_PHASES`. */
  phases?: AttendanceQueuePhase[];
  /** Chỉ để test bơm mốc thời gian — đường chạy thật đừng truyền. */
  now?: Date;
};

/**
 * Một lượt quét — nguồn của CẢ con số lẫn danh sách (AC E-01-3).
 *
 * Cách ly cơ sở HAI LỚP: đọc qua `scopedDb(actor)` (ClassSession ∈ SCOPED_MODELS) VÀ tự
 * lọc `centerId IN filters.centerIds` — danh sách này đã là giao của "cơ sở actor được
 * xem" × "cơ sở actor chọn" do `resolveScopeFilters` cắt sẵn. Hai lớp vì lớp thứ hai còn
 * lo phần `scopedDb` không lo: HO/SUPER_ADMIN bypass scope, nên nếu chỉ dựa `scopedDb`
 * thì họ CHỌN một cơ sở mà vẫn ra số của toàn hệ thống.
 *
 * ⚠️ Buổi `centerId = NULL` bị LOẠI. Với `ClassSession`, NULL nghĩa là "chưa backfill"
 * chứ không phải "toàn hệ thống" (xem `BACKFILL_SPECS`, `lib/org/center-bridge.ts`), và
 * prod đã xác nhận 0 dòng NULL. Fail-closed: thà thiếu một dòng hỏng còn hơn để buổi của
 * cơ sở khác lọt vào bảng số của quản lý cơ sở.
 *
 * 8 truy vấn CỐ ĐỊNH, không N+1 theo số buổi (khuôn `getChatPilotStats`).
 */
async function scanSessionGaps(
  actor: Actor,
  filters: ScopeFilters,
  now: Date,
): Promise<{ rows: SessionGapRow[]; truncated: boolean; centerNames: Record<string, string> }> {
  const sdb = scopedDb(actor);

  // (1) Buổi trong cửa sổ ngày × phạm vi cơ sở.
  const scanned = (await sdb.classSession.findMany({
    where: {
      centerId: { in: filters.centerIds },
      date: { gte: filters.dateFrom, lte: filters.dateTo },
      class: { deletedAt: null },
    },
    select: {
      id: true,
      classId: true,
      centerId: true,
      date: true,
      status: true,
      topic: true,
      substituteTeacherId: true,
      actualTeacherId: true,
      plan: { select: { customTitle: true } },
      lesson: { select: { title: true } },
      // `include`/`select` lồng KHÔNG được `scopedDb` tự lọc (giới hạn của Prisma client
      // extension) — ở đây an toàn vì cổng scope đã nằm ở `centerId` của chính buổi.
      class: { select: { name: true, classCode: true, teacherId: true } },
    },
    orderBy: { date: "asc" },
    take: SESSION_GAP_SCAN_MAX + 1,
  })) as SessionGapScanRow[];

  const truncated = scanned.length > SESSION_GAP_SCAN_MAX;
  const sessions = truncated ? scanned.slice(0, SESSION_GAP_SCAN_MAX) : scanned;
  if (sessions.length === 0) {
    return { rows: [], truncated: false, centerNames: {} };
  }

  const sessionIds = sessions.map((s) => s.id);
  const classIds = [...new Set(sessions.map((s) => s.classId))];
  const teacherIds = [
    ...new Set(
      sessions
        .flatMap((s) => [s.substituteTeacherId, s.actualTeacherId, s.class?.teacherId])
        .filter((x): x is string => !!x),
    ),
  ];

  const [allClassSessions, rosterRows, attendanceRows, feedbackRows, mediaRows, teachers] =
    await Promise.all([
      // (2) Đánh số buổi phải tính trên TOÀN BỘ buổi của lớp — dựng từ cửa sổ đã lọc là
      // ra số sai (xem cảnh báo ở `buildSessionNumberMap`). Select cực hẹp, không kèm
      // điều kiện ngày.
      sdb.classSession.findMany({
        where: { classId: { in: classIds } },
        select: { id: true, classId: true, date: true },
      }),
      // (3) Sĩ số — CÙNG bộ lọc với `buildSessionAttendanceRows`; hai nơi đếm sĩ số khác
      // nhau thì dòng nào cũng "thiếu 1 em" và không buổi nào xong được.
      sdb.enrollment.findMany({
        where: {
          classId: { in: classIds },
          status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
          deletedAt: null,
          student: { deletedAt: null },
        },
        select: { classId: true, studentId: true },
      }),
      // (4)(5) Nạp theo studentId, KHÔNG groupBy đếm số: học viên học bù làm tổng phồng,
      // còn 9 phiếu viết cho 9 em KHÁC vẫn thoả "9 >= 9".
      sdb.attendance.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { sessionId: true, studentId: true, status: true },
      }),
      sdb.studentSessionFeedback.findMany({
        where: { classSessionId: { in: sessionIds } },
        select: { classSessionId: true, studentId: true },
      }),
      // (6) Ảnh nạp TỪNG DÒNG kèm thẻ học viên. Ảnh BỊ TỪ CHỐI không tính — buổi đó vẫn
      // còn nợ ảnh.
      sdb.classSessionMedia.findMany({
        where: { classSessionId: { in: sessionIds }, status: { not: "REJECTED" } },
        select: SESSION_MEDIA_SELECT,
      }),
      // (7) Tên giáo viên. `User` ∈ SCOPE_EXEMPT (identity đọc toàn cục) — id đã bị giới
      // hạn bởi tập buổi ở trên, không phải một lượt liệt kê nhân sự.
      teacherIds.length
        ? sdb.user.findMany({
            where: { id: { in: teacherIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string | null }[]),
    ]);

  // (8) Tên cơ sở — chỉ cần khi tách cột. `Center` ∈ SCOPE_EXEMPT nên PHẢI tự giới hạn
  // theo `filters.centerIds` (đã kiểm quyền), nếu không quản lý CS1 đọc được tên CS2.
  const centerNames: Record<string, string> = {};
  if (filters.groupByCenter && filters.centerIds.length > 0) {
    const centers = (await sdb.center.findMany({
      where: { id: { in: filters.centerIds } },
      select: { id: true, name: true },
    })) as { id: string; name: string | null }[];
    for (const c of centers) centerNames[c.id] = c.name ?? c.id;
  }

  const rosterOf = new Map<string, Set<string>>();
  for (const r of rosterRows as { classId: string; studentId: string }[]) {
    const set = rosterOf.get(r.classId) ?? new Set<string>();
    set.add(r.studentId);
    rosterOf.set(r.classId, set);
  }
  const attendanceOf = new Map<string, { studentId: string; status: string }[]>();
  for (const a of attendanceRows as {
    sessionId: string;
    studentId: string;
    status: string;
  }[]) {
    const list = attendanceOf.get(a.sessionId) ?? [];
    list.push({ studentId: a.studentId, status: a.status });
    attendanceOf.set(a.sessionId, list);
  }
  const feedbackOf = new Map<string, string[]>();
  for (const f of feedbackRows as { classSessionId: string; studentId: string }[]) {
    const list = feedbackOf.get(f.classSessionId) ?? [];
    list.push(f.studentId);
    feedbackOf.set(f.classSessionId, list);
  }
  const teacherNameOf = new Map<string, string>();
  for (const u of teachers as { id: string; name: string | null }[]) {
    teacherNameOf.set(u.id, u.name ?? "");
  }

  const rows = buildSessionGapRows({
    sessions,
    numberOf: buildSessionNumberMap(
      allClassSessions as { id: string; classId: string; date: Date }[],
    ),
    rosterOf,
    attendanceOf,
    feedbackOf,
    mediaOf: buildSessionMediaCoverage(
      mediaRows as Parameters<typeof buildSessionMediaCoverage>[0],
    ),
    teacherNameOf,
    now,
  });

  return { rows, truncated, centerNames };
}

/** Phạm vi rỗng ⇒ 0, và KHÔNG chạm DB (thiếu mệnh đề cơ sở là quét toàn hệ thống). */
function emptyReport(): SessionGapReport {
  return { counts: emptySessionGapCounts(), byCenter: null, truncated: false };
}

/**
 * E-01 — con số "Buổi học & đánh giá còn thiếu" trong khoảng ngày đang lọc.
 *
 * `filters` là bộ lọc phạm vi dùng chung A-02 (`resolveScopeFilters`): `centerIds` đã
 * kiểm quyền, khoảng ngày đã chuẩn hoá theo giờ VN, `groupByCenter` theo công tắc "Tách
 * theo cơ sở".
 *
 * ⚠️ Hàm này KHÔNG tự kiểm quyền — nó nhận `Actor` đã dựng sau `auth()`. Chỗ gọi (trang
 * / Server Action) vẫn phải gác cửa vào bằng `checkPermission` như mọi màn khác.
 */
export async function countSessionGaps(
  actor: Actor,
  filters: ScopeFilters,
  opts: { now?: Date } = {},
): Promise<SessionGapReport> {
  if (filters.centerIds.length === 0) return emptyReport();
  const { rows, truncated, centerNames } = await scanSessionGaps(
    actor,
    filters,
    opts.now ?? new Date(),
  );
  return {
    counts: tallySessionGaps(rows),
    byCenter: filters.groupByCenter
      ? splitSessionGapsByCenter(rows, filters.centerIds, centerNames)
      : null,
    truncated,
  };
}

/**
 * E-01 — danh sách đích: buổi chưa điểm danh · chưa đánh giá · buổi sắp tới · giáo viên
 * phụ trách.
 *
 * Trả kèm CẢ bảng đếm, lấy từ cùng một lượt quét — đó là cách duy nhất bảo đảm "con số
 * khớp danh sách" mà không phải nhớ giữ hai truy vấn đồng bộ.
 *
 * Phân trang cắt ở tầng hiển thị vì lượt quét vốn đã phải đọc trọn khoảng (trạng thái
 * "còn thiếu" xét theo từng học viên, không có mệnh đề SQL nào tính hộ). Đổi lại `total`
 * là con số THẬT, không phải "50" như bản cũ.
 */
export async function listSessionGaps(
  actor: Actor,
  filters: ScopeFilters,
  opts: SessionGapOptions = {},
): Promise<SessionGapList> {
  if (filters.centerIds.length === 0) {
    return {
      ...emptyReport(),
      rows: [],
      total: 0,
      page: 1,
      pageSize: SESSION_GAP_PAGE_SIZE,
      pageCount: 1,
    };
  }

  const { rows, truncated, centerNames } = await scanSessionGaps(
    actor,
    filters,
    opts.now ?? new Date(),
  );
  const phases = new Set(opts.phases ?? SESSION_GAP_LIST_PHASES);
  const visible = rows.filter((r) => phases.has(r.phase));
  const page = paginateSessionGaps(
    visible,
    opts.page ?? 1,
    opts.pageSize ?? SESSION_GAP_PAGE_SIZE,
  );

  return {
    counts: tallySessionGaps(rows),
    byCenter: filters.groupByCenter
      ? splitSessionGapsByCenter(rows, filters.centerIds, centerNames)
      : null,
    truncated,
    ...page,
  };
}
