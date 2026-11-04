// lib/lms/teacher-schedule.ts — #06 (L6): dữ liệu phủ màn "Lịch dạy" site GV
// (buổi Trial + ca làm việc + ngày nghỉ) — port visual từ mock satarobo-ui-giaovien.
//
// Vì sao đọc `db` trần ở đây (app/(teacher)/** bị ESLint chặn import @/lib/db):
// • TrialClassSession ∉ SCOPED_MODELS → scopedDb pass-through, không có auto-scope;
//   WHERE teacherId = chính GV (own-rows) là ranh giới an toàn — chỉ buổi Trial MÌNH
//   dạy, kể cả khi lớp Trial ở cơ sở khác (GV dạy nhiều cơ sở, câu 47).
// • ShiftRegistration ∈ SCOPED_MODELS nhưng đây là CA CỦA CHÍNH MÌNH (unique
//   userId+date); nếu đi qua scopedDb, record centerId null / khác cơ sở sẽ bị ẩn oan
//   dù vẫn là ca của GV. WHERE userId = mình là own-rows, không rò dữ liệu ai khác.
// • Holiday ∈ SCOPED_MODELS và ∉ NULL_IS_GLOBAL_MODELS → scopedDb inject
//   `centerId IN (...)` sẽ ẩn NHẦM ngày nghỉ TOÀN HỆ THỐNG (centerId null). Tự lọc
//   OR-null theo per-model scope của actor (vá 24/07: getModelVisibleCenterIds
//   "Holiday" thay blanket visibleCenterIds — HO-role khác chức năng hết thấy CS2).
//
// ⚠️ Câu 46: các hàm chỉ trả tên lớp/giờ/ngày — KHÔNG đụng học viên/phụ huynh.
// ⚠️ @db.Date: tham số from/to là mốc UTC 00:00 của NGÀY VN, khoảng nửa mở [from, to).
import "server-only";
import type {
  TrialSessionStatus,
  TrialEnrollmentStatus,
  HolidayType,
} from "@prisma/client";
import { db } from "@/lib/db";
import { chonBuoiDaiDien } from "@/lib/lms/trial-representative-session";
import { LOP_CU_WHERE, laLopTheoKhung, thuocCase } from "@/lib/trial/nghia-null";
import { getModelVisibleCenterIds } from "@/lib/db-scope";
import {
  isSettledTrialRow,
  trialRowStatus,
  type TrialRowStatus,
} from "@/lib/lms/trial-row-status";
import type { Actor } from "@/lib/auth/actor";
import { khoaHieuLucCuaBe } from "@/lib/lead/khoa-quan-tam";
import { saleCuaCase } from "@/lib/reports/trial-sale";

/** Buổi Trial GV phụ trách trong [from, to) — bỏ buổi đã hủy. */
export type TeacherTrialSessionRow = {
  id: string;
  date: Date; // @db.Date → UTC 00:00 của ngày
  startTime: string;
  endTime: string;
  status: TrialSessionStatus;
  trialClassName: string;
};

export async function getTeacherTrialSessions(
  teacherId: string,
  from: Date,
  to: Date,
): Promise<TeacherTrialSessionRow[]> {
  const rows = await db.trialClassSession.findMany({
    where: {
      // #5 — ĐỒNG BỘ với getTeacherTrialRoster: buổi GV trực tiếp dạy HOẶC buổi
      // teacherId null thuộc lớp Trial GV là GV chính (trước đây WHERE teacherId
      // thuần → buổi chưa gán GV riêng hiện ở màn Trial nhưng MẤT ở màn Lịch).
      OR: [{ teacherId }, { trialClass: { teacherId } }],
      status: { not: "CANCELLED" },
      date: { gte: from, lt: to },
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      // Nested include không bị auto-scope (giới hạn scopedDb) — ở đây chỉ lấy TÊN lớp
      // Trial của buổi mình dạy, không phải dữ liệu học viên/lead.
      trialClass: { select: { name: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    status: r.status,
    trialClassName: r.trialClass.name,
  }));
}

// Ca làm của GV: từ L5 chấm công v3 đọc ở `lib/cham-cong/my-schedule.getMyAssignments`
// (lưới ShiftAssignment), không còn ShiftRegistration.

/** Ngày nghỉ hiển thị cho GV: TOÀN HỆ THỐNG (centerId null) HOẶC thuộc scope Holiday
 * của actor. Range-overlap với [from, to): holiday [date, endDate ?? date] giao khoảng. */
export type TeacherHolidayRow = {
  name: string;
  date: Date; // @db.Date
  endDate: Date | null; // @db.Date — null = nghỉ 1 ngày
  type: HolidayType;
};

export async function getVisibleHolidays(
  actor: Actor,
  from: Date,
  to: Date,
): Promise<TeacherHolidayRow[]> {
  // Vá 24/07 — per-model scope thay blanket visibleCenterIds: cross-center chỉ khi
  // actor có quyền holidays:/centers: scope ALL. GV thuần không đổi (fallback về
  // visibleCenterIds). Ngày nghỉ TOÀN HỆ THỐNG (centerId null) luôn hiển thị như cũ.
  const scope = getModelVisibleCenterIds("Holiday", actor);
  return db.holiday.findMany({
    where: {
      AND: [
        { date: { lt: to } }, // bắt đầu trước khi khoảng kết thúc
        {
          // kết thúc (endDate, hoặc chính date nếu nghỉ 1 ngày) sau khi khoảng bắt đầu
          OR: [{ endDate: { gte: from } }, { endDate: null, date: { gte: from } }],
        },
        ...(scope === "ALL"
          ? []
          : [{ OR: [{ centerId: null }, { centerId: { in: scope } }] }]),
      ],
    },
    select: { name: true, date: true, endDate: true, type: true },
    orderBy: { date: "asc" },
    take: 50,
  });
}

/* ─────────────────────────── Danh sách Trial (site GV) ───────────────────────────
 * "Danh sách Trial": buổi Trial GV phụ trách + học viên mỗi buổi. Own-rows: buổi mà
 * teacherId = GV HOẶC trialClass.teacherId = GV (GV chính của lớp Trial).
 *
 * ⚠️ Câu 46: CHỈ trả tên HV + năm sinh + khoá quan tâm — TUYỆT ĐỐI KHÔNG đụng
 * lead.parentName/phone/email (khác các trang GV khác đều strip tên PH). Chốt với
 * chủ nhiệm: site GV ẩn hẳn phụ huynh cho lớp Trial. */

export type TrialRosterStudent = {
  enrollmentId: string;
  studentName: string;
  birthYear: number | null;
  courseName: string | null;
  /** ACTIVE/COMPLETED/WITHDRAWN — trạng thái ghi danh trải nghiệm của HV. */
  status: TrialEnrollmentStatus;
  /** Đã có phiếu rubric chưa (→ "Xem phiếu"/"Xuất PDF" thay vì "Nhập phiếu"). */
  evaluated: boolean;
};

export type TrialRosterSlot = {
  sessionId: string;
  trialClassName: string;
  date: Date; // @db.Date → UTC 00:00 của ngày VN
  startTime: string;
  endTime: string;
  status: TrialSessionStatus;
  students: TrialRosterStudent[];
};

/** HV Trial CHƯA xếp buổi (scheduledSessionId null) — kèm tên lớp để GV biết nguồn. */
export type TrialRosterUnassigned = TrialRosterStudent & { trialClassName: string };

/** Khoá cặp (ca, buổi) của một phiếu rubric. Buổi null = phiếu cũ chưa gắn buổi —
 * phải có khoá RIÊNG, không được coi là "đã đánh giá" cho mọi buổi. */
function evalPairKey(enrollmentId: string, sessionId: string | null): string {
  return `${enrollmentId}::${sessionId ?? ""}`;
}

export type TrialRosterResult = {
  slots: TrialRosterSlot[];
  /** #2 — HV lớp Trial của GV nhưng CHƯA gắn buổi: hiển thị riêng để không ai tàng hình. */
  unassigned: TrialRosterUnassigned[];
};

/** Buổi Trial GV phụ trách trong [from, to) + học viên (ghép theo scheduledSessionId)
 * + nhóm "Chưa xếp buổi" (enroll cũ không sessionId — không phụ thuộc khoảng ngày). */
export async function getTeacherTrialRoster(
  teacherId: string,
  from: Date,
  to: Date,
): Promise<TrialRosterResult> {
  const sessions = await db.trialClassSession.findMany({
    where: {
      status: { not: "CANCELLED" },
      date: { gte: from, lt: to },
      // Own-rows: buổi GV trực tiếp dạy, HOẶC là GV chính của lớp, HOẶC được Đào tạo
      // phân công cho MỘT CA cụ thể trong lớp đó (GĐ3).
      //
      // ⚠️ Nhánh thứ ba là bắt buộc: từ GĐ3, Đào tạo phân công theo TỪNG CA qua
      // `TrialEnrollment.gvPhanCongId`, không còn qua giáo viên của lớp. Thiếu nó thì
      // giáo viên được phân công không thấy ca của mình trên site GV, còn giáo viên
      // chính của lớp lại thấy cả ca đã giao cho người khác — ngược ma trận §8.2.
      OR: [
        { teacherId },
        { trialClass: { teacherId } },
        { trialClass: { enrollments: { some: { gvPhanCongId: teacherId } } } },
      ],
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      // 28/08 — dùng để rải ghi danh "học cả lớp" vào từng buổi (xem bySession bên dưới).
      trialClassId: true,
      trialClass: { select: { name: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 200,
  });

  const sessionIds = sessions.map((s) => s.id);

  // HV xếp vào từng buổi (scheduledSessionId). Câu 46: leadChild only — KHÔNG lead.*.
  const enrollments = sessionIds.length
    ? await db.trialEnrollment.findMany({
        where: { scheduledSessionId: { in: sessionIds } },
        select: {
          id: true,
          scheduledSessionId: true,
          status: true,
          trialClass: { select: { name: true } },
          leadChild: {
            select: {
            fullName: true,
            dob: true,
            ageYears: true,
            // 26/09 — khoá hiệu lực = khoá của bé, trống thì khoá của lead
            // (`khoaHieuLucCuaBe`). Thiếu `lead.courseId` ở đây là lỗi biên dịch.
            interestedCourseId: true,
            lead: { select: { courseId: true } },
          },
          },
        },
        orderBy: { leadChild: { fullName: "asc" } },
      })
    : [];

  // #2 — HV ghi danh lớp Trial của GV nhưng scheduledSessionId null (data cũ /
  // enroll trước khi có auto-gán): trước đây `continue` lặng lẽ → GV không hề thấy.
  const unassignedRows = await db.trialEnrollment.findMany({
    where: {
      scheduledSessionId: null,
      // 23/09/2026 — CHỈ lớp slot CŨ. Ở lớp theo khung (mô hình case), NULL là "chưa xếp
      // case" chứ không phải "học cả lớp" (`lib/trial/nghia-null.ts`): màn admin in bé đó
      // ở khối "Chưa xếp case", nên rải bé vào ca của mọi giáo viên là hai màn nói hai
      // nghĩa (luật 12b — site GV đọc theo admin). Đo được trước bản vá: hai giáo viên
      // cùng thấy một bé "chưa xếp" trong ca của mình và cùng nhập phiếu được.
      trialClass: LOP_CU_WHERE,
      status: { in: ["ACTIVE", "COMPLETED"] },
      // GĐ3 — thêm nhánh "được phân công theo ca", cùng lý do như ở truy vấn buổi.
      //
      // 28/08 — thêm nhánh THỨ BA: lớp có BUỔI do người này dạy. Từ khi giáo viên rời
      // khỏi cấp lớp (chọn ở từng buổi), nhánh `trialClass.teacherId` gần như luôn rỗng
      // với lớp mới ⇒ ghi danh "học cả lớp" không nối được về giáo viên nào, và em đó
      // biến mất khỏi lịch dạy dù buổi vẫn là của họ.
      OR: [
        { trialClass: { teacherId, status: { not: "CANCELLED" } } },
        { gvPhanCongId: teacherId, trialClass: { status: { not: "CANCELLED" } } },
        {
          trialClass: {
            status: { not: "CANCELLED" },
            sessions: { some: { teacherId, status: { not: "CANCELLED" } } },
          },
        },
      ],
    },
    select: {
      id: true,
      scheduledSessionId: true,
      status: true,
      // 28/08 — cần id LỚP để rải ghi danh "học cả lớp" vào từng buổi bên dưới.
      trialClassId: true,
      trialClass: { select: { name: true } },
      leadChild: {
        select: {
            fullName: true,
            dob: true,
            ageYears: true,
            // 26/09 — khoá hiệu lực = khoá của bé, trống thì khoá của lead
            // (`khoaHieuLucCuaBe`). Thiếu `lead.courseId` ở đây là lỗi biên dịch.
            interestedCourseId: true,
            lead: { select: { courseId: true } },
          },
      },
    },
    orderBy: { leadChild: { fullName: "asc" } },
    take: 200,
  });

  if (sessions.length === 0 && unassignedRows.length === 0) {
    return { slots: [], unassigned: [] };
  }

  const allEnrollments = [...enrollments, ...unassignedRows];
  const courseIds = [
    ...new Set(
      allEnrollments
        .map((e) => khoaHieuLucCuaBe(e.leadChild))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const courses = courseIds.length
    ? await db.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } })
    : [];
  const courseName = new Map(courses.map((c) => [c.id, c.name]));

  // GĐ4 — phiếu khoá theo cặp (ca, buổi) nên cờ "đã đánh giá" cũng phải theo CẶP.
  //
  // ⚠️ Bản cũ gom theo `trialEnrollmentId` thuần: ca đã chấm buổi 1 rồi dời sang buổi 2
  // vẫn hiện "Đã đánh giá", giáo viên bấm vào thì biểu mẫu trống — vì phiếu đang nằm ở
  // buổi khác. Khoá cặp mới nói đúng "buổi NÀY đã có phiếu chưa".
  const evaluatedPairs = new Set(
    (
      await db.trialRubricEval.findMany({
        where: { trialEnrollmentId: { in: allEnrollments.map((e) => e.id) } },
        select: { trialEnrollmentId: true, trialClassSessionId: true },
      })
    ).map((r) => evalPairKey(r.trialEnrollmentId, r.trialClassSessionId)),
  );

  const nowYear = new Date().getUTCFullYear();
  /** `sessionId` = buổi đang xét (null = nhóm "chưa xếp buổi" → chỉ phiếu cũ chưa gắn buổi). */
  const toStudent = (
    e: (typeof allEnrollments)[number],
    sessionId: string | null,
  ): TrialRosterStudent => ({
    enrollmentId: e.id,
    studentName: e.leadChild.fullName,
    birthYear:
      e.leadChild.dob?.getUTCFullYear() ??
      (e.leadChild.ageYears != null ? nowYear - e.leadChild.ageYears : null),
    courseName: courseName.get(khoaHieuLucCuaBe(e.leadChild) ?? "") ?? null,
    status: e.status,
    evaluated: evaluatedPairs.has(evalPairKey(e.id, sessionId)),
  });

  const bySession = new Map<string, TrialRosterStudent[]>();
  for (const e of enrollments) {
    if (!e.scheduledSessionId) continue;
    const arr = bySession.get(e.scheduledSessionId) ?? [];
    arr.push(toStudent(e, e.scheduledSessionId));
    bySession.set(e.scheduledSessionId, arr);
  }

  // 28/08 — ghi danh KHÔNG gắn buổi nghĩa là học TOÀN BỘ buổi của lớp, nên rải em đó
  // vào MỌI buổi của chính lớp ấy trong khoảng đang xem.
  //
  // ⚠️ Đây là nửa còn lại của việc gỡ auto-gán buổi ở `lib/trial/service.ts`. Thiếu nó
  // thì mọi ghi danh mới rơi hết vào nhóm "Chưa xếp buổi" và không em nào hiện trong
  // buổi giáo viên sắp dạy — đúng lỗi tàng hình mà nếp auto-gán cũ sinh ra để tránh.
  const buoiTheoLop = new Map<string, string[]>();
  for (const ses of sessions) {
    const arr = buoiTheoLop.get(ses.trialClassId) ?? [];
    arr.push(ses.id);
    buoiTheoLop.set(ses.trialClassId, arr);
  }
  const daRai = new Set<string>();
  for (const e of unassignedRows) {
    const ids = buoiTheoLop.get(e.trialClassId);
    if (!ids?.length) continue; // lớp không có buổi nào trong khoảng → để ở nhóm dưới
    daRai.add(e.id);
    for (const sid of ids) {
      const arr = bySession.get(sid) ?? [];
      arr.push(toStudent(e, sid));
      bySession.set(sid, arr);
    }
  }

  return {
    slots: sessions.map((s) => ({
      sessionId: s.id,
      trialClassName: s.trialClass.name,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
      students: bySession.get(s.id) ?? [],
    })),
    // Chỉ còn ghi danh mà lớp KHÔNG có buổi nào trong khoảng đang xem. Em đã được rải
    // vào các buổi ở trên mà vẫn liệt kê lại ở đây là đếm đôi trên cùng một màn.
    unassigned: unassignedRows
      .filter((e) => !daRai.has(e.id))
      .map((e) => ({
        ...toStudent(e, null),
        trialClassName: e.trialClass.name,
      })),
  };
}

/** Props điền phiếu đánh giá 1 buổi Trial (reuse TrialSessionEvalFill). null = không
 * phải buổi của GV (guard own-teacher — khớp gateTrialFill của session-eval-actions). */
export type TeacherTrialEvalProps = {
  trialClassName: string;
  /** Buổi được bấm đặt LÊN ĐẦU để component preselect đúng. */
  evalSessions: { id: string; label: string }[];
  /** studentId = LeadChild.id (khớp evalStudents admin). name = tên HV (câu 46: không PH). */
  evalStudents: { studentId: string; name: string; present: boolean }[];
};

export async function getTeacherTrialEvalProps(
  userId: string,
  sessionId: string,
): Promise<TeacherTrialEvalProps | null> {
  const sess = await db.trialClassSession.findUnique({
    where: { id: sessionId },
    select: {
      teacherId: true,
      trialClass: {
        select: {
          name: true,
          teacherId: true,
          assistantId: true,
          sessions: {
            where: { status: { not: "CANCELLED" } },
            orderBy: { seq: "asc" },
            select: { id: true, seq: true },
          },
          enrollments: {
            orderBy: { leadChild: { fullName: "asc" } },
            select: { id: true, leadChild: { select: { id: true, fullName: true } } },
          },
        },
      },
    },
  });
  if (!sess) return null;

  // Guard own-teacher (khớp gateTrialFill): buổi mình dạy / GV chính / trợ giảng lớp Trial.
  const owned =
    sess.teacherId === userId ||
    sess.trialClass.teacherId === userId ||
    sess.trialClass.assistantId === userId;
  if (!owned) return null;

  const ordered = [
    ...sess.trialClass.sessions.filter((s) => s.id === sessionId),
    ...sess.trialClass.sessions.filter((s) => s.id !== sessionId),
  ];
  return {
    trialClassName: sess.trialClass.name,
    evalSessions: ordered.map((s) => ({ id: s.id, label: `Buổi ${s.seq}` })),
    evalStudents: sess.trialClass.enrollments.map((e) => ({
      studentId: e.leadChild.id,
      name: e.leadChild.fullName,
      present: true,
    })),
  };
}

/* ─────────────── Phiếu đánh giá rubric 1 HV trải nghiệm (form + PDF) ─────────────── */

/** Một buổi của lớp Trial để giáo viên CHỌN chấm (GĐ4 — mỗi buổi một phiếu). */
export type TeacherTrialRubricSession = {
  id: string;
  seq: number;
  /** "Buổi 2 · 05/07 · 09:00-10:30" */
  label: string;
  /** Buổi này đã có phiếu của ĐÚNG ca đang mở chưa. */
  evaluated: boolean;
  /** Buổi đang được xếp cho ca (scheduledSessionId) — mặc định chọn. */
  isScheduled: boolean;
};

export type TeacherTrialRubricContext = {
  enrollmentId: string;
  /** Buổi ĐANG chấm (tham số `sessionId`, mặc định là buổi đang xếp). */
  trialClassSessionId: string | null;
  /** Danh sách buổi của lớp để đổi buổi chấm. */
  sessions: TeacherTrialRubricSession[];
  studentName: string;
  courseName: string | null;
  trialClassName: string;
  /** Phiếu đã lưu (null = chưa đánh giá). scores: criterionId -> points. */
  existing: {
    scores: Record<string, number>;
    totalScore: number;
    rank: string;
    generalComment: string | null;
    orientation: string | null;
    updatedAt: Date;
    evaluatedByName: string | null;
  } | null;
};

// @db.Date là UTC 00:00 của ngày lịch VN → format theo UTC mới ra đúng ngày.
const rubricDateFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

/** Bối cảnh phiếu rubric cho 1 enrollment — null nếu không phải HV trải nghiệm của GV.
 * ⚠️ Câu 46: chỉ tên HV + khoá, KHÔNG lead.parentName/phone/email.
 *
 * `sessionId` (GĐ4): buổi được chấm. Bỏ trống = buổi đang xếp cho ca
 * (`scheduledSessionId`) — giữ nguyên hành vi của link cũ.
 *
 * ⚠️ Vì sao phải có tham số này: `scheduledSessionId` CHỈ đổi khi dời lịch, nên nếu
 * màn chấm luôn bám vào nó thì một ca vĩnh viễn chỉ đẻ được MỘT phiếu — khoá kép
 * (ca, buổi) mà GĐ4 dựng ở DB sẽ không bao giờ có hiệu lực. */
export async function getTeacherTrialRubricContext(
  userId: string,
  enrollmentId: string,
  sessionId?: string,
): Promise<TeacherTrialRubricContext | null> {
  const enr = await db.trialEnrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      scheduledSessionId: true,
      gvPhanCongId: true, // GĐ3 — nhánh sở hữu chính, xem `owned` bên dưới
      leadChild: {
        select: { fullName: true, interestedCourseId: true, lead: { select: { courseId: true } } },
      },
      trialClass: {
        select: {
          name: true,
          teacherId: true,
          assistantId: true,
          // 23/09 — loại lớp, để biết NULL có nghĩa "học cả lớp" hay "chưa xếp case".
          theoKhung: true,
          sessions: {
            orderBy: { seq: "asc" },
            select: {
              id: true,
              seq: true,
              date: true,
              startTime: true,
              endTime: true,
              status: true,
              teacherId: true,
            },
          },
        },
      },
    },
  });
  if (!enr) return null;

  const classSessions = enr.trialClass.sessions;
  // Buổi được chấm. `sessionId` đến từ URL nên PHẢI kiểm nó thuộc đúng lớp của ca này
  // — không có bước này thì đổi một chữ trên thanh địa chỉ là ghi phiếu sang lớp khác.
  // Không khớp → null (fail-closed), KHÔNG âm thầm rơi về buổi đang xếp.
  const scheduled = enr.scheduledSessionId
    ? (classSessions.find((s) => s.id === enr.scheduledSessionId) ?? null)
    : null;
  // `const` (không phải `let`) vì TS không giữ được narrowing của biến `let` bên
  // trong callback của .find()/.filter() phía dưới.
  const target: (typeof classSessions)[number] | null = sessionId
    ? (classSessions.find((s) => s.id === sessionId) ?? null)
    : scheduled;
  if (sessionId && !target) return null;

  // GĐ3 — `gvPhanCongId` (phân công theo TỪNG CA) là nhánh CHÍNH từ nay; ba nhánh cũ
  // giữ làm dự phòng cho lớp chưa được phân công theo ca. Thiếu nhánh đầu thì giáo
  // viên được Đào tạo phân công không mở nổi phiếu đánh giá của chính ca mình dạy.
  //
  // Giữ CẢ giáo viên của buổi đang xếp lẫn của buổi đang chấm: bỏ nhánh "buổi đang xếp"
  // đi là siết hẹp hơn bản trước GĐ4 — người đang chấm được hôm nay sẽ mất quyền.
  // 23/09/2026 — hai nhánh cuối ("GV của buổi đang xếp", "GV của buổi đang chấm") phải
  // nói ĐÚNG về bé này:
  //   · Lớp THEO KHUNG: nhiều case chạy SONG SONG. Buổi đang chấm (`target`, lấy từ URL)
  //     phải là case CỦA CHÍNH bé (`thuocCase`) — thiếu vế này thì GV có case trong lớp
  //     mở và lưu được phiếu cho bé ở case của GV khác chỉ bằng cách sửa URL (đo được
  //     23/09). Bé NULL ở lớp theo khung thì `thuocCase` là false với mọi case.
  //   · Case ĐÃ HUỶ không có buổi học nào: GV của nó không phải người chấm, và form
  //     không được mặc định chấm đúng buổi đã huỷ.
  // Lớp CŨ giữ nguyên hành vi cũ (trừ case đã huỷ): NULL = học cả lớp.
  // Phân công đích danh (`gvPhanCongId`) và GV/trợ giảng cấp lớp vẫn đủ như trước.
  const theoKhung = laLopTheoKhung(enr.trialClass);
  const caseCuaBeDaHuy = scheduled?.status === "CANCELLED";
  const targetHopLe =
    !!target &&
    target.status !== "CANCELLED" &&
    (!theoKhung || thuocCase(enr, target.id, true));
  const owned =
    enr.gvPhanCongId === userId ||
    enr.trialClass.teacherId === userId ||
    enr.trialClass.assistantId === userId ||
    (!caseCuaBeDaHuy && scheduled?.teacherId === userId) ||
    (targetHopLe && target?.teacherId === userId);
  if (!owned) return null;

  const khoaId = khoaHieuLucCuaBe(enr.leadChild);
  const courseName = khoaId
    ? (
        await db.course.findUnique({
          where: { id: khoaId },
          select: { name: true },
        })
      )?.name ?? null
    : null;

  // GĐ4 — phiếu nay khoá theo BUỔI nên một ca có thể có nhiều phiếu. Nạp HẾT phiếu của
  // ca (số buổi/ca rất nhỏ) để vừa lấy phiếu của buổi đang chấm, vừa gắn cờ "đã chấm"
  // lên từng buổi trong ô chọn buổi.
  const evals = await db.trialRubricEval.findMany({
    where: { trialEnrollmentId: enrollmentId },
    orderBy: { updatedAt: "desc" },
    select: {
      trialClassSessionId: true,
      scores: true,
      totalScore: true,
      rank: true,
      generalComment: true,
      orientation: true,
      updatedAt: true,
      evaluatedByName: true,
    },
  });
  // Không có buổi (dữ liệu trước GĐ4) → lấy phiếu mới nhất để màn cũ vẫn đọc được.
  const eval0 = target
    ? (evals.find((e) => e.trialClassSessionId === target.id) ?? null)
    : (evals[0] ?? null);
  const evaluatedSessionIds = new Set(
    evals
      .map((e) => e.trialClassSessionId)
      .filter((id): id is string => id !== null),
  );

  return {
    enrollmentId: enr.id,
    trialClassSessionId: target?.id ?? null,
    sessions: classSessions
      // Buổi đã huỷ không chấm được nữa, trừ khi ĐANG mở đúng buổi đó (link cũ).
      .filter((s) => s.status !== "CANCELLED" || s.id === target?.id)
      .map((s) => ({
        id: s.id,
        seq: s.seq,
        label: `Buổi ${s.seq} · ${rubricDateFmt.format(s.date)} · ${s.startTime}-${s.endTime}`,
        evaluated: evaluatedSessionIds.has(s.id),
        isScheduled: s.id === enr.scheduledSessionId,
      })),
    studentName: enr.leadChild.fullName,
    courseName,
    trialClassName: enr.trialClass.name,
    existing: eval0
      ? {
          // scores lưu JSON → ép về Record<string, number>.
          scores: (eval0.scores as Record<string, number>) ?? {},
          totalScore: eval0.totalScore,
          rank: eval0.rank,
          generalComment: eval0.generalComment,
          orientation: eval0.orientation,
          updatedAt: eval0.updatedAt,
          evaluatedByName: eval0.evaluatedByName,
        }
      : null,
  };
}


/* ─────────────────── Bảng Trial site GV (25/08 — 2 bảng phẳng) ───────────────────
 * Chủ dự án 25/08: màn "Học viên trial" đổi từ lưới thẻ theo ngày sang HAI BẢNG PHẲNG —
 * "Các suất sắp Trial" (hôm nay → hết 7 ngày tới) và "Đã Trial" ở dưới — cùng bộ cột
 * Học viên / Phụ huynh / Khoá học / Đánh giá / Trạng thái.
 *
 * ⚠️ ĐẢO "câu 46". Cho tới 24/08, site GV CỐ Ý giấu hẳn phụ huynh ở màn Trial. Chủ dự
 * án 25/08 yêu cầu cột "Phụ huynh" (ví dụ "Hoàng Văn Sơn") — nên ở đây, và CHỈ ở đây,
 * `lead.parentName` được trả về. SĐT/email phụ huynh vẫn tuyệt đối không đi ra: giáo
 * viên cần biết gọi con ai là con nhà ai, không cần kênh liên hệ trực tiếp (đó là việc
 * của Sale, và `canViewParentContact` vẫn chặn TEACHER ở mọi màn khác).
 */

export type { TrialRowStatus } from "@/lib/lms/trial-row-status";

export type TrialTableRow = {
  enrollmentId: string;
  studentName: string;
  birthYear: number | null;
  /** Tên phụ huynh — xem ghi chú "ĐẢO câu 46" ở trên. KHÔNG kèm SĐT/email. */
  parentName: string | null;
  courseName: string | null;
  /**
   * 26/09 — Sale PHỤ TRÁCH LEAD của bé (`saleCuaCase`), để giáo viên biết trao đổi với
   * ai. `null` = lead chưa ai phụ trách. Cùng định nghĩa với báo cáo trải nghiệm theo Sale.
   */
  saleName: string | null;
  trialClassName: string;
  /** @db.Date → UTC 00:00 của ngày VN. LUÔN có: dòng không suy được buổi thì bị bỏ. */
  date: Date;
  startTime: string;
  endTime: string;
  /**
   * Buổi dòng này trỏ tới — phải chở lên link mở phiếu. Thiếu nó thì
   * `getTeacherTrialRubricContext` mất hai nhánh sở hữu cuối và trả null ⇒ giáo viên bấm
   * vào ra "Buổi Trial không thuộc bạn phụ trách"; mà qua được thì `trialClassSessionId`
   * null cũng bị chặn lúc LƯU.
   */
  sessionId: string;
  /** `scheduledSessionId = null` — em học CẢ LỚP, không chốt riêng buổi nào (chốt 28/08). */
  hocCaLop: boolean;
  status: TrialRowStatus;
  evaluated: boolean;
};

export type TrialTableResult = {
  /** Hôm nay → hết `days` ngày tới, xếp theo ngày tăng dần. Rỗng = không hiện bảng. */
  upcoming: TrialTableRow[];
  /** Buổi đã qua + mọi suất đã có kết cục (nhập học / rớt / rút), mới nhất lên trước. */
  done: TrialTableRow[];
};

// 26/08 (chủ dự án): BỎ khối "Chưa xếp buổi". Bảng Trial chỉ còn học viên ĐÃ ĐƯỢC LÊN
// LỊCH. Ghi danh chưa gắn buổi là việc của quản lý ở /admin/trial-classes — bày ở site
// GV thì giáo viên không làm gì được với nó ngoài việc thấy một dòng không có ngày giờ.

/**
 * Dữ liệu 2 bảng Trial của site GV.
 *
 * `today` là mốc UTC 00:00 của NGÀY VN (trang truyền vào — server tính, client không
 * đụng `new Date()` để khỏi lệch hydrate). `days` = số ngày nhìn tới, mặc định 7.
 *
 * Own-rows BA nhánh, y như `getTeacherTrialRoster`: buổi GV trực tiếp dạy, HOẶC lớp Trial
 * mà GV là GV chính, HOẶC lớp có ca Đào tạo phân công đích danh (`gvPhanCongId`).
 * Không đi qua scopedDb vì `TrialClassSession` ∉ SCOPED_MODELS (xem đầu file).
 *
 * ⚠️ 04/09 — trước bản vá này câu truy vấn buổi chỉ có HAI nhánh đầu, trong khi docblock
 * đã khai "y như getTeacherTrialRoster". Từ GĐ3 Đào tạo phân công theo TỪNG CA, nên giáo
 * viên được phân công trong lớp của người khác thấy 0 buổi ⇒ bảng rỗng KỂ CẢ khi ghi danh
 * đã gắn buổi. Đó là lỗi thứ hai, độc lập với lỗi `scheduledSessionId = null` bên dưới.
 */
export async function getTeacherTrialTable(
  teacherId: string,
  opts: { today: Date; days?: number; historyDays?: number },
): Promise<TrialTableResult> {
  const days = opts.days ?? 7;
  const historyDays = opts.historyDays ?? 90;
  const todayMs = opts.today.getTime();
  const DAY = 24 * 60 * 60 * 1000;
  // Nửa mở [from, to): "hết 7 ngày tiếp theo" = hôm nay + 7 ngày ⇒ chặn trên là +8 ngày.
  const upcomingTo = new Date(todayMs + (days + 1) * DAY);
  const historyFrom = new Date(todayMs - historyDays * DAY);

  const sessions = await db.trialClassSession.findMany({
    where: {
      status: { not: "CANCELLED" },
      date: { gte: historyFrom, lt: upcomingTo },
      OR: [
        { teacherId },
        { trialClass: { teacherId } },
        // Nhánh 3 (GĐ3) kéo về CẢ LỚP, nên bên dưới phải lọc lại theo TỪNG ghi danh —
        // lấy sạch lớp là bày cả ca đã giao cho giáo viên khác.
        { trialClass: { enrollments: { some: { gvPhanCongId: teacherId } } } },
      ],
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      teacherId: true,
      trialClassId: true,
      trialClass: { select: { name: true, teacherId: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 400,
  });

  const sessionIds = sessions.map((s) => s.id);

  // Buổi GV sở hữu TRỰC TIẾP (dạy buổi đó) hoặc qua vai GV chính của lớp. Nhánh 3 cố ý
  // KHÔNG vào đây: nó kéo cả lớp về, dùng nó để suy "lớp của tôi" là bày luôn ca của
  // giáo viên khác trong cùng lớp rồi bấm vào báo "không thuộc bạn phụ trách".
  const buoiThuocGv = sessions.filter(
    (s) => s.teacherId === teacherId || s.trialClass.teacherId === teacherId,
  );
  const idBuoiThuocGv = buoiThuocGv.map((s) => s.id);
  const lopThuocGv = [...new Set(buoiThuocGv.map((s) => s.trialClassId))];
  const moiLop = [...new Set(sessions.map((s) => s.trialClassId))];
  const gomTheoLop = (ds: typeof sessions) => {
    const m = new Map<string, typeof sessions>();
    for (const s of ds) {
      const arr = m.get(s.trialClassId);
      if (arr) arr.push(s);
      else m.set(s.trialClassId, [s]);
    }
    return m;
  };
  const buoiLopCuaGv = gomTheoLop(buoiThuocGv);
  const buoiLopBatKy = gomTheoLop(sessions);

  const enrollmentSelect = {
    id: true,
    scheduledSessionId: true,
    rescheduledFromSessionId: true,
    gvPhanCongId: true,
    status: true,
    trialClassId: true,
    leadChildId: true,
    trialClass: { select: { name: true } },
    leadChild: {
      select: {
        fullName: true,
        dob: true,
        ageYears: true,
        interestedCourseId: true,
        // ĐẢO câu 46 — CHỈ tên phụ huynh, không SĐT/email (xem ghi chú đầu khối).
        // `courseId`: khoá quan tâm cấp lead — nguồn lùi của `khoaHieuLucCuaBe`.
        // 26/09 — `assignedTo`: Sale phụ trách lead, để giáo viên biết trao đổi với ai
        // (`saleCuaCase` — cùng định nghĩa với báo cáo trải nghiệm). Chỉ TÊN nhân viên.
        lead: {
          select: {
            parentName: true,
            courseId: true,
            assignedToId: true,
            assignedTo: { select: { name: true } },
          },
        },
      },
    },
  } as const;

  // Lead đã XOÁ MỀM thì suất trải nghiệm của nó không còn là việc của ai: giáo viên
  // không nhập phiếu cho một hồ sơ đã bị gỡ, mà lead thì đã biến khỏi /admin/leads nên
  // cũng không ai đi đóng sổ hộ được. Lọc ở ĐƯỜNG ĐỌC thay vì trông vào mọi đường ghi
  // nhớ dọn `LeadTrialHistory.outcome` — đường ghi thì còn thêm mãi, đường đọc chỉ có đây.
  const aliveLead = { leadChild: { lead: { deletedAt: null } } } as const;

  // ⚠️ 04/09 — ĐẢO câu "CHỈ ghi danh ĐÃ GẮN BUỔI" (26/08). Chốt 26/08 cấm bày dòng KHÔNG
  // CÓ NGÀY GIỜ, không cấm bày em học cả lớp; mà từ 28/08 gỡ auto-gán buổi thì ghi danh
  // tạo qua giao diện admin LUÔN mang `scheduledSessionId = null`. Lọc `in: [...]` không
  // bao giờ khớp null ⇒ bảng rỗng sạch, giáo viên không có suất nào để nhập phiếu.
  // Nay nhận cả ba diện, rồi suy buổi đại diện; suy không ra thì BỎ dòng (giữ chốt 26/08).
  const all = sessionIds.length
    ? await db.trialEnrollment.findMany({
        where: {
          ...aliveLead,
          OR: [
            // (a) xếp riêng một buổi, và buổi đó là buổi của GV.
            { scheduledSessionId: { in: idBuoiThuocGv } },
            // (b) học CẢ LỚP trong lớp của GV — ca THƯỜNG GẶP NHẤT ở lớp slot cũ: màn
            //     xếp chỗ bên admin không truyền sessionId.
              // 23/09/2026 — CHỈ lớp slot CŨ. Ở lớp theo khung (mô hình case), NULL là "chưa xếp
              // case" chứ không phải "học cả lớp" (`lib/trial/nghia-null.ts`): màn admin in bé đó
              // ở khối "Chưa xếp case", nên rải bé vào ca của mọi giáo viên là hai màn nói hai
              // nghĩa (luật 12b — site GV đọc theo admin). Đo được trước bản vá: hai giáo viên
              // cùng thấy một bé "chưa xếp" trong ca của mình và cùng nhập phiếu được.
            {
              scheduledSessionId: null,
              trialClassId: { in: lopThuocGv },
              trialClass: LOP_CU_WHERE,
            },
            // (c) Đào tạo phân công đích danh GV cho ca này (GĐ3) — lọc THEO CA.
            { gvPhanCongId: teacherId, trialClassId: { in: moiLop } },
          ],
        },
        select: enrollmentSelect,
        orderBy: { leadChild: { fullName: "asc" } },
      })
    : [];
  if (all.length === 0) return { upcoming: [], done: [] };

  const courseIds = [
    ...new Set(
      all.map((e) => khoaHieuLucCuaBe(e.leadChild)).filter((id): id is string => Boolean(id)),
    ),
  ];
  const [courses, evals, histories] = await Promise.all([
    courseIds.length
      ? db.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
    db.trialRubricEval.findMany({
      where: { trialEnrollmentId: { in: all.map((e) => e.id) } },
      select: { trialEnrollmentId: true, trialClassSessionId: true },
    }),
    // Kết cục học thử (ENROLLED / LOST / PENDING) — 1 dòng / con × lớp.
    db.leadTrialHistory.findMany({
      where: {
        leadChildId: { in: [...new Set(all.map((e) => e.leadChildId))] },
        trialClassId: { in: [...new Set(all.map((e) => e.trialClassId))] },
      },
      select: { leadChildId: true, trialClassId: true, outcome: true },
    }),
  ]);

  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  // Khoá CẶP (ca, buổi), không phải theo ca. Ghi danh học cả lớp cần N phiếu; khoá theo
  // ca thì chấm xong buổi 1 là cả ca hoá "đã đánh giá" vĩnh viễn, nút đổi thành "Xem
  // phiếu" và giáo viên không bao giờ được nhắc chấm buổi 2..N. `TrialRubricEval` vốn
  // đã `@@unique([trialEnrollmentId, trialClassSessionId])` — bảng chỉ đang đọc sai.
  const evaluatedPairs = new Set(
    evals.map((r) => evalPairKey(r.trialEnrollmentId, r.trialClassSessionId)),
  );
  const outcomeOf = new Map(
    histories.map((h) => [`${h.leadChildId}:${h.trialClassId}`, h.outcome]),
  );
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const nowYear = new Date(todayMs).getUTCFullYear();

  /** null = không suy được buổi cho ghi danh này ⇒ BỎ dòng (xem ghi chú trong hàm). */
  function toRow(e: (typeof all)[number]): TrialTableRow | null {
    const xepRieng = e.scheduledSessionId
      ? (sessionById.get(e.scheduledSessionId) ?? null)
      : null;
    // Em học CẢ LỚP: suy buổi đại diện từ CHÍNH lịch của giáo viên, nên buổi chọn ra chắc
    // chắn qua được cổng sở hữu của `getTeacherTrialRubricContext`. Riêng ca Đào tạo phân
    // công đích danh thì nhánh `gvPhanCongId` gánh cổng đó, nên buổi nào của lớp cũng được
    // — và phải mở rộng như vậy, vì lớp đó có thể không có buổi nào mang tên giáo viên này.
    const phanCongDichDanh = e.gvPhanCongId === teacherId;
    const ungVien =
      (phanCongDichDanh ? buoiLopBatKy : buoiLopCuaGv).get(e.trialClassId) ?? [];
    const ses = xepRieng ?? chonBuoiDaiDien(ungVien, todayMs);
    // Lớp không có buổi nào trong cửa sổ ⇒ không có ngày giờ để in. Chốt 26/08 cấm bày
    // dòng trống ngày ở site GV, nên BỎ hẳn thay vì in ra một dòng giáo viên không làm gì
    // được. Ca đó là việc của quản lý ở /admin/lop-trial.
    if (!ses) return null;
    const evaluated = evaluatedPairs.has(evalPairKey(e.id, ses.id));
    return {
      enrollmentId: e.id,
      sessionId: ses.id,
      hocCaLop: e.scheduledSessionId === null,
      studentName: e.leadChild.fullName,
      birthYear:
        e.leadChild.dob?.getUTCFullYear() ??
        (e.leadChild.ageYears != null ? nowYear - e.leadChild.ageYears : null),
      parentName: e.leadChild.lead?.parentName?.trim() || null,
      courseName: courseName.get(khoaHieuLucCuaBe(e.leadChild) ?? "") ?? null,
      saleName: saleCuaCase(e.leadChild.lead ?? null).saleName,
      trialClassName: ses.trialClass.name,
      date: ses.date,
      startTime: ses.startTime,
      endTime: ses.endTime,
      evaluated,
      status: trialRowStatus({
        enrollmentStatus: e.status,
        outcome: outcomeOf.get(`${e.leadChildId}:${e.trialClassId}`) ?? null,
        evaluated,
        rescheduled: e.rescheduledFromSessionId != null,
        sessionDate: ses.date,
        sessionStatus: ses.status,
        todayMs,
      }),
    };
  }

  const upcoming: TrialTableRow[] = [];
  const done: TrialTableRow[] = [];
  for (const e of all) {
    const row = toRow(e);
    if (!row) continue;
    // Suất đã có kết cục (nhập học / rớt / rút) rơi xuống bảng dưới dù buổi còn ở tương
    // lai — với giáo viên thì việc đã xong, không còn là "suất sắp Trial".
    const settled = isSettledTrialRow(row.status);
    const inWindow = row.date.getTime() >= todayMs;
    if (inWindow && !settled) upcoming.push(row);
    else done.push(row);
  }

  upcoming.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      a.startTime.localeCompare(b.startTime) ||
      a.studentName.localeCompare(b.studentName, "vi"),
  );
  done.sort(
    (a, b) =>
      b.date.getTime() - a.date.getTime() ||
      b.startTime.localeCompare(a.startTime) ||
      a.studentName.localeCompare(b.studentName, "vi"),
  );

  return { upcoming, done };
}
