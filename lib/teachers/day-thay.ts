import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { rosterWhere } from "@/lib/enrollment-scope";
import { isScormEnabled } from "@/lib/flags";
import {
  groupMarkedBySession,
  groupRosterByClass,
  sessionAttendanceState,
  type SessionAttendanceState,
} from "@/lib/lms/attendance-pending";
import { summarizeSessionFeedback } from "@/lib/lms/session-feedback-roster";
import { laNguoiDayThay } from "@/lib/lms/session-ownership";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";

// MÀN "DẠY THAY" CỦA SITE GIÁO VIÊN (11/10/2026).
//
// Sự cố sinh ra nó: cô Nguyễn Bích Trà được xếp dạy thay buổi 15:45 nhưng KHÔNG có đường nào thấy lớp —
// "Lớp của tôi" và "Tổng quan" chỉ đọc lớp mình PHỤ TRÁCH, "Nhận xét" đã bị bỏ khỏi menu, còn Lịch chỉ là lịch.
// Người dạy thay không có lớp trong `assignedClassIds` (cố ý: tập đó nuôi cả SCORM và RBAC theo lớp), nên mọi màn
// theo lớp đều từ chối họ. Màn này đi theo BUỔI, không theo lớp — cùng hướng với màn Học bù.
//
// ⚠️ "Đồng bộ với admin và giáo viên chính" = ĐỌC CÙNG BẢNG, CÙNG HÀM ĐẾM (luật 12b). Mọi con số ở đây đi qua
// đúng các hàm trang chủ giáo viên chính dùng (`sessionAttendanceState` · `summarizeSessionFeedback` · `rosterWhere`),
// không có phép đếm riêng. Điểm danh / nhận xét người dạy thay lưu ghi vào chính `Attendance` /
// `StudentSessionFeedback` của buổi — admin và giáo viên chính thấy ngay.
//
// ⚠️ Đọc trần qua `db` (như `lib/hoc-bu/case-doc.ts`): người dạy thay không thuộc lớp nên `scopedDb` theo lớp/cơ sở
// sẽ lọc mất đúng buổi họ được giao. An toàn nhờ MỌI câu tra đều khoá theo userId (danh sách) hoặc đi qua
// `docChiTietDayThay` — hàm duy nhất cấp `ChiTietDayThay`, và nó trả null nếu không phải buổi mình dạy thay.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const NGAY_MS = 24 * 60 * 60 * 1000;
/** Số ngày lịch sử hiện ở khối "Đã dạy". */
export const SO_NGAY_DA_DAY = 60;

/** Mốc 00:00 hôm nay theo giờ VN, dạng UTC — để so với `ClassSession.date` (Timestamptz mang giờ thật). */
export function dauNgayVn(now: Date): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - VN_OFFSET_MS);
}

export type DongDayThay = {
  id: string;
  classId: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  lop: string;
  khoa: string;
  /** "Buổi 6 - HP1 - Vũ Công Robot" (rút gọn khi thiếu mảnh). */
  nhanBuoi: string;
  phong: string | null;
  /** Giáo viên phụ trách lớp — người mình dạy thay. null = lớp chưa gán. */
  gvChinh: string | null;
  homNay: boolean;
  daChot: boolean;
  siSo: number;
  daDiemDanh: number;
  diemDanh: SessionAttendanceState;
  coMat: number;
  daNhanXet: number;
  nhanXetDu: boolean;
  /** Bài của buổi có giáo án (tài liệu hoặc SCORM) để mở. */
  coGiaoAn: boolean;
};

/**
 * Buổi mình dạy thay: SẮP DẠY (từ đầu hôm nay, chưa chốt) và ĐÃ DẠY (60 ngày). Chỉ buổi mà `userId` đứng lớp
 * với tư cách người dạy thay (`laNguoiDayThay` — cùng phép với bảng công), bỏ buổi đã huỷ.
 */
export async function docDanhSachDayThay(
  userId: string,
  now: Date,
): Promise<{ sapToi: DongDayThay[]; daDay: DongDayThay[] }> {
  const dau = dauNgayVn(now);
  const tu = new Date(dau.getTime() - SO_NGAY_DA_DAY * NGAY_MS);

  const raw = await db.classSession.findMany({
    where: {
      OR: [{ substituteTeacherId: userId }, { actualTeacherId: userId }],
      status: { not: "CANCELLED" },
      date: { gte: tu },
    },
    select: {
      id: true,
      classId: true,
      date: true,
      topic: true,
      status: true,
      lessonId: true,
      substituteTeacherId: true,
      actualTeacherId: true,
      room: { select: { code: true, name: true } },
      plan: { select: { customTitle: true, order: true, lessonId: true } },
      lesson: { select: { order: true, title: true, moduleCode: true } },
      class: {
        select: {
          name: true,
          startTime: true,
          endTime: true,
          teacherId: true,
          teacher: { select: { name: true } },
          course: { select: { name: true } },
        },
      },
    },
    orderBy: { date: "asc" },
    take: 300,
  });
  const sessions = raw.filter((s) => laNguoiDayThay(userId, s));
  if (sessions.length === 0) return { sapToi: [], daDay: [] };

  const sessionIds = sessions.map((s) => s.id);
  const classIds = [...new Set(sessions.map((s) => s.classId))];
  const lessonIds = [
    ...new Set(sessions.map((s) => s.lessonId ?? s.plan?.lessonId ?? null).filter((x): x is string => !!x)),
  ];

  const [rosters, attRows, fbRows, docs, scorms] = await Promise.all([
    db.class.findMany({
      where: { id: { in: classIds } },
      select: { id: true, enrollments: { where: rosterWhere("dang-hoc"), select: { studentId: true } } },
    }),
    db.attendance.findMany({
      where: { sessionId: { in: sessionIds } },
      select: { sessionId: true, studentId: true, status: true },
    }),
    db.studentSessionFeedback.findMany({
      where: { classSessionId: { in: sessionIds } },
      select: { classSessionId: true, studentId: true },
    }),
    lessonIds.length
      ? db.document.findMany({ where: { lessonId: { in: lessonIds } }, select: { lessonId: true } })
      : Promise.resolve([] as { lessonId: string | null }[]),
    lessonIds.length && isScormEnabled()
      ? db.scormPackage.findMany({
          where: { lessonId: { in: lessonIds }, isActiveForLesson: true, status: "PUBLISHED" },
          select: { lessonId: true },
        })
      : Promise.resolve([] as { lessonId: string | null }[]),
  ]);

  const rosterByClass = groupRosterByClass(rosters);
  const markedBySession = groupMarkedBySession(attRows);
  const fbBySession = new Map<string, string[]>();
  for (const f of fbRows) {
    const list = fbBySession.get(f.classSessionId) ?? [];
    list.push(f.studentId);
    fbBySession.set(f.classSessionId, list);
  }
  const attBySession = new Map<string, { studentId: string; status: string }[]>();
  for (const a of attRows) {
    const list = attBySession.get(a.sessionId) ?? [];
    list.push({ studentId: a.studentId, status: a.status });
    attBySession.set(a.sessionId, list);
  }
  const lessonCoGiaoAn = new Set([...docs, ...scorms].map((x) => x.lessonId).filter((x): x is string => !!x));

  const homNayDau = dau.getTime();
  const homNayCuoi = homNayDau + NGAY_MS;

  const dong = sessions.map((s): DongDayThay => {
    const roster = rosterByClass.get(s.classId) ?? new Set<string>();
    const marked = markedBySession.get(s.id) ?? new Set<string>();
    const fb = summarizeSessionFeedback(attBySession.get(s.id) ?? [], fbBySession.get(s.id) ?? []);
    const lessonId = s.lessonId ?? s.plan?.lessonId ?? null;
    return {
      id: s.id,
      classId: s.classId,
      date: s.date,
      startTime: s.class.startTime,
      endTime: s.class.endTime,
      lop: s.class.name,
      khoa: s.class.course.name,
      nhanBuoi: deriveSessionLabel({
        planTitle: s.plan?.customTitle,
        planOrder: s.plan?.order,
        lessonTitle: s.lesson?.title,
        lessonOrder: s.lesson?.order,
        moduleCode: s.lesson?.moduleCode,
        topic: s.topic,
      }),
      phong: s.room ? (s.room.code ?? s.room.name) : null,
      gvChinh: s.class.teacher?.name ?? null,
      homNay: s.date.getTime() >= homNayDau && s.date.getTime() < homNayCuoi,
      daChot: s.status === "COMPLETED",
      siSo: roster.size,
      daDiemDanh: [...roster].filter((id) => marked.has(id)).length,
      diemDanh: sessionAttendanceState({ markedStudentIds: marked, rosterStudentIds: roster }),
      coMat: fb.attended,
      daNhanXet: fb.reviewed,
      nhanXetDu: fb.complete,
      coGiaoAn: lessonId ? lessonCoGiaoAn.has(lessonId) : false,
    };
  });

  const sapToi = dong.filter((r) => r.date.getTime() >= homNayDau && !r.daChot);
  const daDay = dong.filter((r) => !sapToi.includes(r)).reverse();
  return { sapToi, daDay };
}

/**
 * Số buổi dạy thay SẮP TỚI (từ đầu hôm nay, chưa chốt) — cho dải nhắc ở "Tổng quan". Chỉ ĐẾM, một câu.
 * `NOT class.teacherId = userId`: người đứng lớp mà cũng là GV phụ trách thì đó không phải dạy thay.
 */
export async function demBuoiDayThaySapToi(userId: string, now: Date): Promise<number> {
  return db.classSession.count({
    where: {
      substituteTeacherId: userId,
      status: { notIn: ["CANCELLED", "COMPLETED"] },
      date: { gte: dauNgayVn(now) },
      NOT: { class: { teacherId: userId } },
    },
  });
}

// ── Chi tiết một buổi ────────────────────────────────────────────────────────────────

export type ChiTietDayThay = {
  id: string;
  classId: string;
  courseId: string;
  /** Cơ sở của lớp — để mở rộng phạm vi ĐỌC cho các tab hub nhúng (xem `actorChoBuoiDayThay`). */
  centerId: string | null;
  lessonId: string | null;
  date: Date;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | string;
  startTime: string | null;
  endTime: string | null;
  lop: string;
  khoa: string;
  nhanBuoi: string;
  phong: string | null;
  gvChinh: string | null;
  /** `Class.description` — sổ bàn giao của lớp (tính cách từng bé, lưu ý riêng). Chỉ giáo viên đứng lớp thấy. */
  ghiChuLop: string | null;
  /** Dữ liệu sở hữu thô của buổi — để màn hình hỏi `loiKhongPhaiNguoiDay` bằng CÙNG hàm với server (luật 12). */
  sohuu: { actualTeacherId: string | null; substituteTeacherId: string | null; class: { teacherId: string | null } };
  bai: { tieuDe: string; mucTieu: string[]; baiTapMacDinh: string | null } | null;
};

/**
 * CỔNG DUY NHẤT vào chi tiết một buổi dạy thay: trả null nếu `userId` KHÔNG đứng lớp buổi này với tư cách người
 * dạy thay (buổi của lớp mình, của người khác, đã huỷ, không tồn tại — đều null, không phân biệt, chống dò id).
 * Mọi hàm `doc…DayThay` bên dưới nhận `ChiTietDayThay` làm đầu vào nên không gọi được nếu chưa qua cổng này.
 */
export async function docChiTietDayThay(userId: string, sessionId: string): Promise<ChiTietDayThay | null> {
  const s = await db.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      classId: true,
      date: true,
      topic: true,
      status: true,
      lessonId: true,
      centerId: true,
      substituteTeacherId: true,
      actualTeacherId: true,
      room: { select: { code: true, name: true } },
      plan: { select: { customTitle: true, order: true, lessonId: true } },
      lesson: { select: { order: true, title: true, moduleCode: true, objectives: true, homeworkDefault: true } },
      class: {
        select: {
          name: true,
          startTime: true,
          endTime: true,
          teacherId: true,
          description: true,
          centerId: true,
          courseId: true,
          teacher: { select: { name: true } },
          course: { select: { name: true } },
        },
      },
    },
  });
  if (!s || s.status === "CANCELLED" || !laNguoiDayThay(userId, s)) return null;
  const lessonId = s.lessonId ?? s.plan?.lessonId ?? null;
  return {
    id: s.id,
    classId: s.classId,
    courseId: s.class.courseId,
    centerId: s.class.centerId ?? s.centerId ?? null,
    lessonId,
    date: s.date,
    status: s.status,
    startTime: s.class.startTime,
    endTime: s.class.endTime,
    lop: s.class.name,
    khoa: s.class.course.name,
    nhanBuoi: deriveSessionLabel({
      planTitle: s.plan?.customTitle,
      planOrder: s.plan?.order,
      lessonTitle: s.lesson?.title,
      lessonOrder: s.lesson?.order,
      moduleCode: s.lesson?.moduleCode,
      topic: s.topic,
    }),
    phong: s.room ? (s.room.code ?? s.room.name) : null,
    gvChinh: s.class.teacher?.name ?? null,
    ghiChuLop: s.class.description?.trim() || null,
    sohuu: {
      actualTeacherId: s.actualTeacherId,
      substituteTeacherId: s.substituteTeacherId,
      class: { teacherId: s.class.teacherId },
    },
    bai: s.lesson
      ? {
          tieuDe: s.lesson.title,
          mucTieu: s.lesson.objectives.map((m) => m.trim()).filter(Boolean),
          baiTapMacDinh: s.lesson.homeworkDefault?.trim() || null,
        }
      : null,
  };
}

/** Tiến độ của buổi (điểm danh + nhận xét) — cùng hàm đếm với danh sách và trang chủ giáo viên chính. */
export async function docTienDoDayThay(ct: ChiTietDayThay): Promise<{
  siSo: number;
  daDiemDanh: number;
  diemDanh: SessionAttendanceState;
  coMat: number;
  daNhanXet: number;
  nhanXetDu: boolean;
}> {
  const [lop, att, fb] = await Promise.all([
    db.class.findUnique({
      where: { id: ct.classId },
      select: { enrollments: { where: rosterWhere("dang-hoc"), select: { studentId: true } } },
    }),
    db.attendance.findMany({ where: { sessionId: ct.id }, select: { studentId: true, status: true } }),
    db.studentSessionFeedback.findMany({ where: { classSessionId: ct.id }, select: { studentId: true } }),
  ]);
  const roster = new Set((lop?.enrollments ?? []).map((e) => e.studentId));
  const marked = new Set(att.map((a) => a.studentId));
  const tom = summarizeSessionFeedback(att, fb.map((f) => f.studentId));
  return {
    siSo: roster.size,
    daDiemDanh: [...roster].filter((id) => marked.has(id)).length,
    diemDanh: sessionAttendanceState({ markedStudentIds: marked, rosterStudentIds: roster }),
    coMat: tom.attended,
    daNhanXet: tom.reviewed,
    nhanXetDu: tom.complete,
  };
}

/**
 * Nhận xét GẦN NHẤT của từng bé ở các buổi TRƯỚC của lớp — người dạy thay cần biết bé đang ở đâu mà không phải
 * hỏi lại giáo viên chính. Đọc `StudentSessionFeedback` của chính lớp nên giáo viên chính / admin nhập là thấy.
 */
export async function docNhanXetBuoiTruoc(
  ct: ChiTietDayThay,
  studentIds: readonly string[],
): Promise<Map<string, { comment: string; date: Date }>> {
  const out = new Map<string, { comment: string; date: Date }>();
  if (studentIds.length === 0) return out;
  const rows = await db.studentSessionFeedback.findMany({
    where: {
      studentId: { in: [...studentIds] },
      comment: { not: null },
      classSession: { classId: ct.classId, date: { lt: ct.date }, status: { not: "CANCELLED" } },
    },
    select: { studentId: true, comment: true, classSession: { select: { date: true } } },
    orderBy: { classSession: { date: "desc" } },
    take: studentIds.length * 4,
  });
  for (const r of rows) {
    const c = r.comment?.trim();
    if (c && !out.has(r.studentId)) out.set(r.studentId, { comment: c, date: r.classSession.date });
  }
  return out;
}

/**
 * Actor để ĐỌC các tab hub (Nhận xét / Bài tập & Kiểm tra / Tài liệu) của một buổi dạy thay.
 *
 * Các tab đó là component của Class Hub, đọc qua `scopedDb(actorGiangDay(actor))` — mà người dạy thay không có lớp trong
 * `assignedClassIds`, nên nếu lớp ở cơ sở khác với cơ sở mình thì mọi câu tra ra rỗng. `teachingCenterIds` là chỗ
 * `actorGiangDay` cộng thêm cơ sở dạy (chỉ cho model đào tạo: Class/ClassSession/Attendance/Enrollment/Student…, KHÔNG tiền,
 * KHÔNG lead). Cố ý KHÔNG đụng `assignedClassIds`: tập đó còn nuôi SCORM, học bạ và chat DM (xem chú thích ở
 * `app/(teacher)/teacher/lop/_actions.ts`). Chỉ gọi SAU `docChiTietDayThay` (đã chứng minh buổi là của mình).
 */
export function actorChoBuoiDayThay(actor: Actor, ct: ChiTietDayThay): Actor {
  return moRongCoSoDay(actor, ct.centerId);
}

/** Cộng MỘT cơ sở dạy vào `teachingCenterIds` (xem `actorChoBuoiDayThay`). Không có cơ sở thì trả nguyên actor. */
export function moRongCoSoDay(actor: Actor, centerId: string | null): Actor {
  if (!centerId) return actor;
  return { ...actor, teachingCenterIds: [...new Set([...(actor.teachingCenterIds ?? []), centerId])] };
}
