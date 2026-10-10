// hub-reviews-tab.tsx — Tab "Nhận xét" của Class Hub (2 mức inline).
//
//   · List:  buổi 14 ngày gần của lớp + badge "đã nhận xét x/y HV".
//   · Detail (?rvSession=): BẢNG học viên của buổi (Học viên / Điểm danh / Ảnh buổi
//     học / Nhận xét) — mỗi HV đi học mở PHIẾU "Nhận xét buổi học" (Dự án + 4 mục +
//     rubric 9 tiêu chí, StudentEvalDialog) + Xuất PDF. HV vắng: không nhận xét. Chưa
//     điểm danh → hiện toàn roster (banner). Back = ?classId&tab=nhan-xet.
//
// Guard: sessionId phải thuộc ĐÚNG classId (đã ∈ assignedClassIds ở caller) — chống
// IDOR. StudentSessionFeedback/Attendance ∉ SCOPED_MODELS → sdb pass-through SAU guard
// classId. Roster đọc QUA quan hệ class (enrollment dev centerId=null bị scopedDb lọc).
// ⚠️ Câu 46: payload client CHỈ tên HV — không SĐT/email/tên PH.
import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  CalendarX2,
  CircleCheck,
  ClipboardCheck,
  ClipboardPen,
} from "lucide-react";
import type { AttendanceStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import { summarizeSessionFeedback } from "@/lib/lms/session-feedback-roster";
import {
  attendanceCoversRoster,
  buildSessionMediaCoverage,
  buildSessionNumberMap,
  mediaCoversAttendees,
  SESSION_MEDIA_SELECT,
  type SessionMediaRow,
  isSessionSettled,
  sortSessionsForWork,
} from "@/lib/lms/session-order";
import {
  deriveSessionLabel,
  deriveSessionProjectName,
} from "@/lib/lms/session-project-name";
import {
  normalizeEvalNotes,
  normalizeEvalRatings,
} from "@/lib/lms/session-eval-rubric";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "../../_components/ui/empty-state";
import { SESSION_STATUS_LABEL } from "../../_components/ui/session-status-pill";
import { PickSessionPhotoDialog } from "../../anh-lop/_components/pick-session-photo-dialog";
import { StudentEvalDialog } from "./student-eval-dialog";
import { initialsOf } from "@/lib/ui/initials";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

// 21/08 — CÓ `year`. Bảng này trải dài nhiều khoá học nên "T3, 12/08" một mình không
// nói được là năm nay hay năm ngoái; đừng gỡ ra cho gọn.
const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});
/** "YYYY-MM-DD" (giờ VN) — nhãn ngày trong phiếu/PDF (khớp reference). */
const isoFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

const ATTENDED: AttendanceStatus[] = ["PRESENT", "LATE"];

/** studentId của học viên ĐI HỌC (PRESENT/LATE) trong một buổi — em vắng không tính. */
function attendedIdsOf(rows: { studentId: string; status: string }[]): string[] {
  return rows.filter((a) => ATTENDED.includes(a.status as AttendanceStatus)).map((a) => a.studentId);
}

const ATT_BADGE: Record<AttendanceStatus, { label: string; cls: string }> = {
  PRESENT: {
    label: "Có mặt",
    cls: "bg-state-success-soft text-state-success-ink",
  },
  LATE: {
    label: "Đi muộn",
    cls: "bg-state-warning-soft text-state-warning-ink",
  },
  ABSENT: {
    label: "Vắng",
    cls: "bg-state-danger-soft text-state-danger-ink",
  },
  EXCUSED: {
    label: "Có phép",
    cls: "bg-state-info-soft text-state-info-ink",
  },
  ABSENT_EXCUSED: {
    label: "Vắng có phép",
    cls: "bg-state-info-soft text-state-info-ink",
  },
  ABSENT_UNEXCUSED: {
    label: "Vắng",
    cls: "bg-state-danger-soft text-state-danger-ink",
  },
};

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh (UTC+7)
/** Mốc hết hôm nay (giờ VN) dạng ms — buổi ≤ mốc này = đã diễn ra. */
function vnTodayEndMs(now = new Date()): number {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const startUtc =
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) -
    VN_OFFSET_MS;
  return startUtc + 24 * 60 * 60 * 1000;
}

function BackToList({ classId }: { classId: string }) {
  return (
    <Link
      href={`?classId=${classId}&tab=nhan-xet`}
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> Tất cả buổi nhận xét
    </Link>
  );
}

export async function HubReviewsTab({
  actor,
  classId,
  reviewSessionId,
}: {
  actor: Actor;
  classId: string;
  reviewSessionId?: string;
}) {
  const sdb = scopedDb(actorGiangDay(actor));

  // ── Detail: bảng HV của buổi + phiếu nhận xét ────────────────────────────────
  if (reviewSessionId) {
    const sess = await sdb.classSession.findUnique({
      where: { id: reviewSessionId },
      select: {
        id: true,
        classId: true,
        centerId: true, // model scoped — findUnique lọc hậu kỳ theo field này
        date: true,
        topic: true,
        status: true,
        // R5 21/08 — nguồn TÊN DỰ ÁN tự điền. Ưu tiên customTitle của lớp (bản sao
        // per-lớp, sửa được ở tab Chương trình) rồi mới tới tên bài của giáo trình.
        plan: { select: { customTitle: true, order: true } },
        lesson: { select: { order: true, title: true, moduleCode: true } },
        class: { select: { name: true, course: { select: { name: true } } } },
      },
    });
    if (!sess || sess.classId !== classId) {
      return (
        <div>
          <BackToList classId={classId} />
          <EmptyState
            icon={Ban}
            title="Buổi học không thuộc lớp bạn phụ trách."
          />
        </div>
      );
    }

    const [attRows, fbRows, clsRoster, allSessions, mediaOfSession] = await Promise.all([
      sdb.attendance.findMany({
        where: { sessionId: reviewSessionId },
        select: { studentId: true, status: true },
      }),
      sdb.studentSessionFeedback.findMany({
        where: { classSessionId: reviewSessionId },
        select: {
          studentId: true,
          projectName: true,
          notes: true,
          rubric: true,
          comment: true,
        },
      }),
      sdb.class.findUnique({
        where: { id: classId },
        select: {
          enrollments: {
            where: rosterWhere("dang-hoc"),
            select: {
              student: {
                select: {
                  id: true,
                  name: true,
                  studentCode: true,
                  avatarUrl: true,
                },
              },
            },
            orderBy: { student: { name: "asc" } },
          },
        },
      }),
      // R1 — số buổi phải tính trên TOÀN BỘ buổi của lớp (xem lib/lms/session-order).
      // Chỉ id+date nên rẻ; lớp dài nhất cũng vài chục dòng.
      sdb.classSession.findMany({
        where: { classId },
        select: { id: true, date: true },
      }),
      // Ảnh/video của buổi — để biết em nào ĐÃ có, em nào còn thiếu. Luật 21/08: học
      // viên đi học BẮT BUỘC có ảnh/video, nên bảng phải nói được điều đó chứ không chỉ
      // bày ra nút Tải lên.
      //
      // 25/08 — vẫn `not REJECTED` chứ KHÔNG siết còn APPROVED, dù hộp "Chọn ảnh" chỉ
      // mời ảnh đã duyệt. Lý do: từ nay thẻ học viên CHỈ ghi được lên ảnh APPROVED
      // (toggleMediaStudentTagAction chặn các trạng thái khác) ⇒ với dữ liệu mới hai
      // cách lọc cho ra y hệt nhau, còn dữ liệu cũ thì ảnh PENDING có sẵn thẻ vẫn nên
      // tính là "đã có". Siết riêng ở đây sẽ lệch với ba chỗ hỏi CÙNG câu hỏi này
      // (bảng dưới, teacher/nhan-xet/page.tsx, admin attendance) — lệch mới là bug.
      sdb.classSessionMedia.findMany({
        where: { classSessionId: reviewSessionId, status: { not: "REJECTED" } },
        select: SESSION_MEDIA_SELECT,
      }),
    ]);

    const sessionNo = buildSessionNumberMap(allSessions).get(reviewSessionId) ?? null;
    const media = buildSessionMediaCoverage(mediaOfSession).get(reviewSessionId) ?? {
      classWide: false,
      tagged: new Set<string>(),
    };
    /** Em này đã có ảnh/video chưa (ảnh chung cả lớp tính cho mọi em). */
    const hasMedia = (studentId: string) =>
      media.classWide || media.tagged.has(studentId);
    const roster = (clsRoster?.enrollments ?? []).map((e) => e.student);
    const attMap = new Map(attRows.map((a) => [a.studentId, a.status]));
    const attendanceTaken = attRows.length > 0;
    const fbMap = new Map(fbRows.map((f) => [f.studentId, f]));

    const canEval = (studentId: string) =>
      !attendanceTaken ||
      ATTENDED.includes(
        (attMap.get(studentId) ?? "ABSENT") as AttendanceStatus,
      );
    const evaluable = roster.filter((s) => canEval(s.id));
    const reviewed = evaluable.filter((s) => {
      const fb = fbMap.get(s.id);
      return fb && (fb.rubric != null || fb.notes != null);
    }).length;

    const courseName = sess.class.course.name;
    // 25/08 — tiêu đề buổi ở màn chi tiết dùng CÙNG nhãn với bảng
    // ("Buổi 7 - HP1 - Bàn Tay Ma Thuật"), thay vì in `topic` thô (gần như luôn null).
    const sessionLabel =
      deriveSessionLabel({
        sessionNumber: sessionNo,
        planTitle: sess.plan?.customTitle,
        planOrder: sess.plan?.order,
        lessonTitle: sess.lesson?.title,
        lessonOrder: sess.lesson?.order,
        moduleCode: sess.lesson?.moduleCode,
        topic: sess.topic,
      }) || "Buổi học";
    const dateIso = isoFmt.format(sess.date);
    // R5 — tên dự án của buổi, dùng CHUNG cho mọi học viên của buổi này.
    const projectName = deriveSessionProjectName({
      sessionNumber: sessionNo,
      planTitle: sess.plan?.customTitle,
      planOrder: sess.plan?.order,
      lessonTitle: sess.lesson?.title,
      lessonOrder: sess.lesson?.order,
      moduleCode: sess.lesson?.moduleCode,
      topic: sess.topic,
    });

    return (
      <div>
        <BackToList classId={classId} />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              {sessionLabel}
            </h2>
            <p className="text-sm text-muted-foreground">
              {dateIso} · {SESSION_STATUS_LABEL[sess.status] ?? sess.status}
            </p>
          </div>
          <Badge
            variant="outline"
            className="border-primary-soft bg-primary-soft text-primary-ink dark:border-primary"
          >
            Nhận xét {reviewed}/{evaluable.length}
          </Badge>
        </div>

        {!attendanceTaken && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink dark:border-state-warning">
            <span>Buổi chưa điểm danh — đang hiện toàn bộ lớp.</span>
            <Link
              href={`?classId=${classId}&sessionId=${reviewSessionId}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-state-warning-soft bg-card px-2.5 py-1 text-xs font-semibold text-state-warning-ink transition-colors hover:bg-state-warning-soft-hover dark:border-state-warning dark:bg-transparent"
            >
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
              Điểm danh buổi này
            </Link>
          </div>
        )}

        {roster.length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title="Lớp chưa có học viên đang học."
          />
        ) : (
          <div className="t-card overflow-hidden">
            <PhanTrangBang cuonNgang
          khoaGhiNho="gv-lop-nhan-xet-buoi">
              <table className="min-w-[560px] w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <th scope="col" className="px-5 py-3">
                      Học viên
                    </th>
                    <th scope="col" className="px-5 py-3">
                      Điểm danh
                    </th>
                    <th scope="col" className="px-5 py-3">
                      Ảnh buổi học
                    </th>
                    <th scope="col" className="px-5 py-3 text-right">
                      Nhận xét
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((st) => {
                    const status = attMap.get(st.id) as
                      | AttendanceStatus
                      | undefined;
                    const evalOk = canEval(st.id);
                    const fb = fbMap.get(st.id);
                    const done = Boolean(
                      fb && (fb.rubric != null || fb.notes != null),
                    );
                    return (
                      <tr
                        key={st.id}
                        className={cn(
                          "border-b border-border/60 last:border-0",
                          !evalOk && "opacity-60",
                        )}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            {st.avatarUrl ? (
                              <img
                                src={st.avatarUrl}
                                alt={st.name}
                                className="h-10 w-10 shrink-0 rounded-full border border-border object-cover"
                              />
                            ) : (
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-ink">
                                {initialsOf(st.name)}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">
                                {st.name}
                              </p>
                              {st.studentCode && (
                                <p className="truncate text-xs text-muted-foreground">
                                  {st.studentCode}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {status ? (
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                                ATT_BADGE[status].cls,
                              )}
                            >
                              {ATT_BADGE[status].label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {evalOk ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {/* 25/08 — "Tải ảnh" → "Chọn ảnh": ảnh của buổi nay tải
                                  cả loạt ở màn Ảnh lớp và QLCS duyệt từng tấm; ở đây
                                  giáo viên chỉ chọn tấm nào là của em nào (ghi thẻ). */}
                              <PickSessionPhotoDialog
                                classId={classId}
                                classSessionId={reviewSessionId}
                                studentId={st.id}
                                studentName={st.name}
                              />
                              {hasMedia(st.id) ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-state-success-soft px-2 py-0.5 text-xs font-semibold text-state-success-ink">
                                  <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                                  Đã có
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                                  Chưa có
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Vắng — không cần
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {evalOk ? (
                            <StudentEvalDialog
                              sessionId={reviewSessionId}
                              studentId={st.id}
                              studentName={st.name}
                              courseName={courseName}
                              sessionTopic={sessionLabel}
                              sessionDate={dateIso}
                              projectName={projectName}
                              existing={
                                done && fb
                                  ? {
                                      projectName: fb.projectName,
                                      notes: normalizeEvalNotes(fb.notes),
                                      rubric: normalizeEvalRatings(fb.rubric),
                                    }
                                  : null
                              }
                              done={done}
                              pdfHref={`/teacher/nhan-xet/pdf/${reviewSessionId}/${st.id}`}
                            />
                          ) : (
                            <span className="text-xs font-medium text-muted-foreground">
                              Vắng — không nhận xét
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>
        )}
      </div>
    );
  }

  // ── List: MỌI buổi đã diễn ra của lớp (bảng 5 cột + cột Đi học) ──────────────
  const cls = await sdb.class.findUnique({
    where: { id: classId },
    select: {
      startTime: true,
      endTime: true,
      _count: {
        select: {
          enrollments: { where: rosterWhere("dang-hoc") },
        },
      },
      // Danh sách studentId của sĩ số — dùng cho "điểm danh xong chưa"
      // (attendanceCoversRoster).
      //
      // `_count` ngay trên nay dùng CHUNG rosterWhere với chỗ này. Trước đây hai truy
      // vấn cách nhau 9 dòng trong CÙNG file lại lọc khác nhau (`_count` chỉ lọc
      // status, chỗ này lọc đủ ba tầng) ⇒ mẫu số "Đi học X/Y" và mẫu số của
      // attendanceCoversRoster đếm hai tập khác nhau, và một buổi có thể vừa hiện
      // "12/12" vừa không bao giờ được coi là điểm danh xong. Chủ dự án chốt 03/09:
      // đổi cả con số cho khớp, không chỉ đổi chữ.
      enrollments: {
        where: rosterWhere("dang-hoc"),
        select: { studentId: true },
      },
    },
  });
  const rosterCount = cls?._count.enrollments ?? 0;
  const rosterIds = (cls?.enrollments ?? []).map((e) => e.studentId);
  const timeLabel =
    cls?.startTime && cls?.endTime ? `${cls.startTime}-${cls.endTime}` : "";

  const [sessions, allSessions] = await Promise.all([
    sdb.classSession.findMany({
      where: {
        classId,
        status: { not: "CANCELLED" },
        date: { lte: new Date(vnTodayEndMs()) },
      },
      select: {
        id: true,
        date: true,
        topic: true,
        status: true,
        room: { select: { code: true, name: true } },
        // 25/08 — nguồn NHÃN BUỔI "Buổi 1 - HP1 - Bàn Tay Ma Thuật"
        // (lib/lms/session-project-name · deriveSessionLabel).
        plan: { select: { customTitle: true, order: true } },
        lesson: { select: { order: true, title: true, moduleCode: true } },
      },
      // ⚠️ orderBy GIỮ `desc` + `take: 100`: đây là cửa sổ "buổi gần nhất". Đổi sang
      // `asc` là lớp dài bị cắt mất đúng những buổi vừa dạy. Thứ tự HIỂN THỊ do
      // sortSessionsForWork quyết định SAU khi query — xem lib/lms/session-order.
      orderBy: { date: "desc" },
      take: 100,
    }),
    // R1 — số buổi tính trên TOÀN BỘ buổi của lớp, không phải trên cửa sổ 100 dòng trên.
    sdb.classSession.findMany({
      where: { classId },
      select: { id: true, date: true },
    }),
  ]);
  const numberOf = buildSessionNumberMap(allSessions);

  const ids = sessions.map((s) => s.id);
  const [attRows, fbRows, mediaRows] = await Promise.all([
    ids.length
      ? sdb.attendance.findMany({
          where: { sessionId: { in: ids } },
          select: { sessionId: true, studentId: true, status: true },
        })
      : Promise.resolve(
          [] as { sessionId: string; studentId: string; status: string }[],
        ),
    ids.length
      ? sdb.studentSessionFeedback.findMany({
          where: { classSessionId: { in: ids } },
          select: { classSessionId: true, studentId: true },
        })
      : Promise.resolve([] as { classSessionId: string; studentId: string }[]),
    // R2 — tín hiệu thứ ba "đã up ảnh". Tính CẢ DRAFT/PENDING (giáo viên đã làm xong
    // phần việc của mình; duyệt là việc của quản lý), chỉ loại REJECTED. Ảnh không gắn
    // buổi (classSessionId = null) không quy được về buổi nào nên không tính.
    ids.length
      ? sdb.classSessionMedia.findMany({
          where: {
            classSessionId: { in: ids },
            status: { not: "REJECTED" },
          },
          select: SESSION_MEDIA_SELECT,
        })
      : Promise.resolve([] as SessionMediaRow[]),
  ]);
  // Ai đã có ảnh, theo TỪNG buổi (lib/lms/session-order).
  const mediaBy = buildSessionMediaCoverage(mediaRows);
  const attBySession = new Map<
    string,
    { studentId: string; status: string }[]
  >();
  for (const a of attRows) {
    const list = attBySession.get(a.sessionId) ?? [];
    list.push({ studentId: a.studentId, status: a.status });
    attBySession.set(a.sessionId, list);
  }
  const fbBySession = new Map<string, string[]>();
  for (const f of fbRows) {
    const list = fbBySession.get(f.classSessionId) ?? [];
    list.push(f.studentId);
    fbBySession.set(f.classSessionId, list);
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={CalendarX2}
        title="Lớp chưa có buổi học nào đã diễn ra."
      />
    );
  }

  // R1/R2 — gắn số buổi + trạng thái 3 việc rồi xếp: buổi CÒN NỢ VIỆC lên trên (theo
  // thứ tự buổi tăng dần), buổi đã xong cả điểm danh + nhận xét + ảnh xuống dưới.
  // Sort phải làm Ở ĐÂY (server), trước <PhanTrangBang> — component đó phân trang trên
  // mảng đã nhận, sort sau nó thì chỉ đảo được thứ tự trong TỪNG trang.
  const rows = sortSessionsForWork(
    sessions.map((s) => {
      const stat = summarizeSessionFeedback(
        attBySession.get(s.id) ?? [],
        fbBySession.get(s.id) ?? [],
      );
      const markedIds = (attBySession.get(s.id) ?? []).map((a) => a.studentId);
      return {
        s,
        stat,
        no: numberOf.get(s.id) ?? null,
        complete: isSessionSettled({
          cancelled: s.status === "CANCELLED",
          rosterEmpty: rosterIds.length === 0,
          work: {
            attendanceDone: attendanceCoversRoster(markedIds, rosterIds),
            feedbackDone: stat.complete,
            photoDone: mediaCoversAttendees({
              attendedStudentIds: attendedIdsOf(attBySession.get(s.id) ?? []),
              taggedStudentIds: mediaBy.get(s.id)?.tagged ?? [],
              hasClassWide: mediaBy.get(s.id)?.classWide ?? false,
            }),
          },
        }),
      };
    }),
    // 08/09 — SẮP THEO NGÀY, không theo số buổi. Nhãn nay là số LỘ TRÌNH
    // (`soBuoiTheoLoTrinh`), sắp theo nó thì buổi 25/06 mang nhãn "Buổi 43" rơi
    // xuống sau buổi 12/09 "Buổi 19". Xem `lib/lms/session-order.ts`.
    (r) => ({ thoiGian: new Date(r.s.date).getTime(), complete: r.complete }),
  );

  return (
    <div className="t-card overflow-hidden">
      <PhanTrangBang cuonNgang
          khoaGhiNho="gv-lop-nhan-xet-hocvien">
        {/* 820 chứ không phải 720: tách cột Nhận xét thành Tiến độ + Trạng thái là
            thêm một cột, giữ min-w cũ thì các cột text bị bóp lại — đúng lỗi Đ2. */}
        <table className="min-w-[820px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="px-5 py-3">
                Buổi học
              </th>
              <th scope="col" className="px-5 py-3">
                Ngày · Giờ
              </th>
              <th scope="col" className="px-5 py-3">
                Đi học
              </th>
              {/* TÁCH đôi: cột cũ trộn ba loại giá trị khác nghĩa nhau trong một ô —
                  tiến độ ("4/6 HV"), trạng thái hoàn tất ("Đã nhận xét"), và trạng thái
                  CHẶN ("Chưa điểm danh"). Người đọc không sắp xếp hay quét được một cột
                  như thế (QA vòng 1, BUG-030). */}
              <th scope="col" className="px-5 py-3">
                Tiến độ
              </th>
              <th scope="col" className="px-5 py-3">
                Trạng thái
              </th>
              <th scope="col" className="px-5 py-3 text-right">
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, stat, no }) => {
              const roomLabel = s.room?.code ?? s.room?.name ?? null;
              return (
                <tr
                  key={s.id}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-foreground">
                      {deriveSessionLabel({
                        sessionNumber: no,
                        planTitle: s.plan?.customTitle,
                        planOrder: s.plan?.order,
                        lessonTitle: s.lesson?.title,
                        lessonOrder: s.lesson?.order,
                        moduleCode: s.lesson?.moduleCode,
                        topic: s.topic,
                      }) || "Buổi học"}
                    </p>
                    {roomLabel && (
                      <p className="text-xs text-muted-foreground">
                        Phòng {roomLabel}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <p className="text-foreground">{dayFmt.format(s.date)}</p>
                    {timeLabel && (
                      <p className="text-xs text-muted-foreground">
                        {timeLabel}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap font-semibold text-foreground">
                    {stat.attendanceTaken
                      ? `${stat.attended}/${rosterCount}`
                      : "—"}
                  </td>
                  {/* Cột TIẾN ĐỘ: luôn là một tỉ lệ, kể cả khi đã xong — quét dọc cột
                      là thấy ngay còn nợ bao nhiêu em, không phải đọc badge. */}
                  <td className="px-5 py-3.5 whitespace-nowrap font-semibold text-foreground">
                    {stat.attendanceTaken ? (
                      `${stat.reviewed}/${stat.attended} HV`
                    ) : (
                      <span className="font-normal text-muted-foreground">—</span>
                    )}
                  </td>
                  {/* Cột TRẠNG THÁI: chỉ nói buổi đang ở đâu trong quy trình. */}
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    {!stat.attendanceTaken ? (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        Chưa điểm danh
                      </Badge>
                    ) : stat.complete ? (
                      <Badge
                        variant="outline"
                        className="border-state-success-soft bg-state-success-soft text-state-success-ink dark:border-state-success"
                      >
                        Đã nhận xét
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-state-warning-soft bg-state-warning-soft text-state-warning-ink dark:border-state-warning"
                      >
                        Còn thiếu
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <Link
                      href={`?classId=${classId}&tab=nhan-xet&rvSession=${s.id}`}
                      className={
                        stat.complete
                          ? "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                          : "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white outline-none transition-colors hover:bg-primary-darker focus-visible:ring-2 focus-visible:ring-ring"
                      }
                    >
                      <ClipboardPen className="h-3.5 w-3.5" aria-hidden />
                      {stat.complete ? "Xem lại" : "Nhận xét"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}
