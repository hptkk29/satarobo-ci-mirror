// app/(admin)/admin/attendance/page.tsx — MÀN "Điểm danh" của admin.
//
// BA CẤP, một trang, phân biệt bằng query string (chốt 21/08):
//
//   /attendance                     → cấp 1: DANH SÁCH LỚP (kèm ô lọc cơ sở)
//   /attendance?classId=<id>        → cấp 2: DANH SÁCH BUỔI của lớp đó
//   /attendance?sessionId=<id>      → cấp 3: BẢNG ĐIỂM DANH của buổi
//
// Vì sao không tách thành 3 route: `?sessionId=` là đích của thông báo
// (lib/notify/attendance.ts) và của nút ở /admin/sessions — đổi đường dẫn là gãy hết
// link cũ đang nằm trong hộp thông báo của người dùng.
//
// Cấp 1 bày lớp nào thì tuỳ vai (chủ dự án chốt 21/08):
//   • giáo viên          → chỉ lớp ĐANG DẠY;
//   • sale / quản lý / đào tạo → thêm lớp CHƯA KHAI GIẢNG (đang tuyển sinh, chờ duyệt);
//   • admin              → tất cả, kể cả lớp đã kết thúc và lớp huỷ.
// Phân tầng đọc theo QUYỀN (`classes:view-all`) chứ không so tên vai — thêm vai mới
// không phải sửa file này.
//
// Cấp 2 chấm ba việc sau buổi (điểm danh đủ lớp + nhận xét + ảnh/video) và cho bấm
// "Hoàn tất buổi" khi đủ cả ba. Định nghĩa "đủ" nằm ở lib/lms/attendance-queue,
// KHÔNG viết lại ở đây.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import type { ClassStatus, Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getCenterOptions } from "@/lib/org/center-options";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { FEEDBACK_ATTENDED_STATUSES } from "@/lib/lms/session-feedback-roster";
import {
  buildSessionMediaCoverage,
  buildSessionNumberMap,
  SESSION_MEDIA_SELECT,
} from "@/lib/lms/session-order";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";
import {
  photoCoveredCount,
  resolveAttendanceQueuePhase,
  sessionWorkState,
  sortAttendanceQueue,
  type SessionWorkInput,
} from "@/lib/lms/attendance-queue";
import { AttendanceGrid } from "./_components/attendance-grid";
import {
  AttendanceList,
  type AttendanceListRow,
} from "./_components/attendance-list";
import {
  AttendanceClassList,
  type AttendanceClassRow,
} from "./_components/attendance-class-list";
import {
  buildSessionAttendanceRows,
  type AttendanceRosterRow,
} from "@/lib/attendance/roster";
import { vnEndOfDay } from "@/lib/time/vn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Điểm danh | Admin" };

interface SearchParams {
  searchParams: Promise<{ sessionId?: string; classId?: string; centerId?: string }>;
}

const TZ = "Asia/Ho_Chi_Minh";

const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: TZ,
});
const clockFmt = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});

function formatDateTime(d: Date): string {
  return `${dayFmt.format(d)} · ${clockFmt.format(d)}`;
}

/** Trạng thái điểm danh tính là "đi học" — dùng chung hằng số với site GV. */
const ATTENDED_STATUSES = new Set<string>(FEEDBACK_ATTENDED_STATUSES);

/** Lớp chưa nạp được sĩ số: một Set rỗng dùng chung, khỏi cấp phát mỗi dòng. */
const EMPTY_ROSTER: ReadonlySet<string> = new Set<string>();

/** Lớp "đang dạy" — mức thấp nhất, ai vào màn này cũng thấy. */
const TEACHING_STATUSES: ClassStatus[] = ["ACTIVE"];
/** Chưa khai giảng: đang lên kế hoạch / tuyển sinh / chờ quản lý duyệt. */
const UPCOMING_STATUSES: ClassStatus[] = ["PLANNED", "RECRUITING", "PENDING_APPROVAL"];
/** Đã đóng — chỉ admin cần nhìn lại. */
const CLOSED_STATUSES: ClassStatus[] = ["COMPLETED", "CANCELLED"];

export default async function AttendanceAdminPage({ searchParams }: SearchParams) {
  const sp = await searchParams;
  const sessionId = sp.sessionId?.trim();
  const classFilter = sp.classId?.trim();
  const centerFilter = sp.centerId?.trim();

  // LMS-1 / W1-1 — owner-scope: GV chỉ thấy lớp mình dạy/trợ giảng; CENTER_MANAGER
  // theo cơ sở; SUPER_ADMIN toàn bộ (cùng quy tắc canManageSessionClass).
  const gateUser = (await auth())?.user;
  if (!gateUser) redirect("/login");
  const NONE: Prisma.ClassWhereInput = { id: "__none__" };
  // Cách ly cơ sở (A0-04): Class/ClassSession ∈ SCOPED_MODELS → đọc qua scopedDb.
  const actor = await resolveActor(gateUser.id);
  const sdb = scopedDb(actor);

  // Ai được sửa điểm danh thì phải VÀO ĐƯỢC màn này. Trước 03/08 selector dựng
  // bằng hasRole v1 tĩnh (SA/CM/GV, còn lại NONE) nên CSKH bị chặn trắng, trong khi
  // chính markAttendance cho họ sửa hồi tố 7 ngày qua attendance:edit (Task #16) —
  // họ phải đi vòng qua hub lớp. Nay hỏi đúng quyền, và hỏi THEO TỪNG CƠ SỞ vì
  // `attendance:edit` là scope CENTER (R1: action non-GLOBAL cấm gọi trần).
  const editableCenterIds = (
    await Promise.all(
      actor.visibleCenterIds.map(async (centerId) =>
        (await checkPermission("attendance:edit", { centerId })) ? centerId : null,
      ),
    )
  ).filter((id): id is string => id !== null);

  const classScope: Prisma.ClassWhereInput = actor.isSuperAdmin
    ? {}
    : editableCenterIds.length > 0
      ? { centerId: { in: editableCenterIds } }
      : hasRole(gateUser, "TEACHER")
        ? { OR: [{ teacherId: gateUser.id }, { assistantId: gateUser.id }] }
        : NONE;

  // ── Cấp 3: đang mở MỘT buổi → chỉ dựng bảng điểm danh ─────────────────────
  if (sessionId) {
    // 19/08 — DÙNG CHUNG buildSessionAttendanceRows với trang chi tiết lớp và site GV.
    //
    // Trước đây trang này tự dựng roster bằng một truy vấn chép tay gần y hệt helper,
    // nhưng THIẾU hai bộ lọc xoá mềm (`enrollment.deletedAt`, `student.deletedAt`). Hệ
    // quả không phải chỉ là "hiện thừa vài dòng": khi lưu, markAttendance đối chiếu với
    // getSessionRosterStudentIds — vốn đi qua helper ĐÚNG — nên mọi bản ghi của học viên
    // đã xoá đều bị từ chối, và vì $transaction là trọn lô nên CẢ LỚP không lưu được với
    // thông báo "Có học viên không thuộc danh sách buổi này". Một roster, một sự thật.
    //
    // Helper KHÔNG tự kiểm cách ly cơ sở (xem docstring của nó) — cổng scope giữ nguyên
    // ở truy vấn dưới đây.
    const gate = await sdb.classSession.findFirst({
      where: { id: sessionId, class: { deletedAt: null, ...classScope } },
      select: { id: true, classId: true },
    });
    let selected: { id: string; date: Date; topic: string | null; className: string } | null =
      null;
    let rows: AttendanceRosterRow[] = [];
    if (gate) {
      const roster = await buildSessionAttendanceRows(actor, sessionId);
      if (roster.session) {
        selected = roster.session;
        rows = roster.rows;
      }
    }

    // Quay lại đúng danh sách buổi của lớp — không văng về danh sách lớp.
    const backClassId = classFilter || gate?.classId || "";
    const backHref = backClassId ? `/attendance?classId=${backClassId}` : "/attendance";
    return (
      <div>
        <Link
          href={backHref}
          className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {backClassId ? "Các buổi của lớp" : "Danh sách lớp"}
        </Link>

        {!selected ? (
          <div className="rounded-xl border-2 border-dashed border-border bg-muted p-12 text-center">
            <ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">
              Không mở được buổi học này — buổi không tồn tại hoặc không thuộc phạm vi
              của bạn.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-primary-soft p-5">
              <div className="text-xs font-bold tracking-wider text-primary uppercase">
                Buổi học đang điểm danh
              </div>
              <div className="mt-1 text-2xl font-black text-foreground">
                {selected.className}
              </div>
              <div className="mt-1 text-sm text-foreground">
                {formatDateTime(selected.date)}
                {selected.topic && <> · 📚 {selected.topic}</>}
              </div>
            </div>

            {/* key = buổi: đổi ?sessionId= là điều hướng client, React giữ nguyên instance
                cũ ⇒ state (chỉ khởi tạo 1 lần) còn của buổi trước. Có key thì lưới nạp lại. */}
            <AttendanceGrid key={selected.id} sessionId={selected.id} rows={rows} />
          </div>
        )}
      </div>
    );
  }

  // ── Cấp 2: danh sách buổi của MỘT lớp ─────────────────────────────────────
  if (classFilter) {
    const cls = await sdb.class.findFirst({
      where: { id: classFilter, deletedAt: null, ...classScope },
      select: {
        id: true,
        name: true,
        classCode: true,
        startTime: true,
        endTime: true,
        center: { select: { name: true } },
        course: { select: { name: true } },
      },
    });
    if (!cls) {
      return (
        <div>
          <BackToClasses />
          <div className="rounded-xl border-2 border-dashed border-border bg-muted p-12 text-center">
            <ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">
              Không mở được lớp này — lớp không tồn tại hoặc không thuộc phạm vi của bạn.
            </p>
          </div>
        </div>
      );
    }

    // Cả lớp một lượt: số buổi tính trên TOÀN BỘ buổi (buildSessionNumberMap đòi vậy,
    // và ở đây "toàn bộ" cũng chính là danh sách đang bày).
    const sessions = await sdb.classSession.findMany({
      where: { classId: cls.id },
      orderBy: { date: "asc" },
      select: {
        id: true,
        classId: true,
        date: true,
        topic: true,
        status: true,
        // Nhãn buổi lấy từ GIÁO TRÌNH của lớp: kế hoạch buổi ghim cho lớp này trước,
        // rồi mới tới tên bài của giáo án gốc (deriveSessionLabel).
        // `moduleCode` = học phần (HP1…) — thiếu nó thì nhãn rụng mất mảnh giữa.
        plan: { select: { customTitle: true, order: true } },
        lesson: { select: { title: true, order: true, moduleCode: true } },
      },
    });
    const numberOf = buildSessionNumberMap(sessions);
    const ids = sessions.map((s) => s.id);

    // Ba việc sau buổi, nạp gộp một lượt.
    //
    // ⚠️ Điểm danh + nhận xét nạp theo studentId, KHÔNG dùng groupBy đếm số. Hai chỗ dễ
    // sai nếu chỉ so con số:
    //   • học viên HỌC BÙ từ lớp khác cũng sinh bản ghi Attendance ⇒ tổng phồng lên và
    //     buổi chấm thiếu người vẫn được coi là "điểm danh đủ" rồi rơi xuống đáy bảng;
    //   • 9 phiếu nhận xét viết cho 9 em KHÁC vẫn thoả "9 >= 9".
    // Quyết định thuộc về `attendanceCoversRoster` / `summarizeSessionFeedback` (xem
    // lib/lms/attendance-queue) — ở đây chỉ nạp nguyên liệu.
    const [rosterRows, attendanceRows, feedbackRows, mediaRows] = await Promise.all([
      sdb.enrollment.findMany({
        // Cùng bộ lọc với buildSessionAttendanceRows — hai nơi đếm sĩ số khác nhau
        // thì dòng nào cũng "thiếu 1 em" và không buổi nào xong được.
        where: {
          classId: cls.id,
          status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
          deletedAt: null,
          student: { deletedAt: null },
        },
        select: { studentId: true },
      }),
      ids.length
        ? sdb.attendance.findMany({
            where: { sessionId: { in: ids } },
            select: { sessionId: true, studentId: true, status: true },
          })
        : [],
      ids.length
        ? sdb.studentSessionFeedback.findMany({
            where: { classSessionId: { in: ids } },
            select: { classSessionId: true, studentId: true },
          })
        : [],
      // ⚠️ Ảnh nạp TỪNG DÒNG kèm thẻ học viên, KHÔNG groupBy/distinct theo buổi: luật là
      // mọi em đi học phải có ảnh, mà gộp lại thì mất sạch `tags.studentId` và buổi nào
      // cũng bị báo thiếu. Ảnh BỊ TỪ CHỐI không tính — buổi đó vẫn còn nợ ảnh.
      ids.length
        ? sdb.classSessionMedia.findMany({
            where: { classSessionId: { in: ids }, status: { not: "REJECTED" } },
            select: SESSION_MEDIA_SELECT,
          })
        : [],
    ]);

    const roster: ReadonlySet<string> = rosterRows.length
      ? new Set(rosterRows.map((r) => r.studentId))
      : EMPTY_ROSTER;
    const attendanceOf = new Map<string, { studentId: string; status: string }[]>();
    for (const a of attendanceRows) {
      const list = attendanceOf.get(a.sessionId) ?? [];
      list.push({ studentId: a.studentId, status: a.status });
      attendanceOf.set(a.sessionId, list);
    }
    const feedbackOf = new Map<string, string[]>();
    for (const f of feedbackRows) {
      const list = feedbackOf.get(f.classSessionId) ?? [];
      list.push(f.studentId);
      feedbackOf.set(f.classSessionId, list);
    }
    const mediaOf = buildSessionMediaCoverage(mediaRows);
    const NO_MEDIA = { classWide: false, tagged: new Set<string>() };

    const classTime =
      cls.startTime && cls.endTime ? `${cls.startTime} - ${cls.endTime}` : "";
    const now = new Date();
    const enriched = sessions.map((s) => {
      const att = attendanceOf.get(s.id) ?? [];
      const cover = mediaOf.get(s.id) ?? NO_MEDIA;
      const workInput: SessionWorkInput = {
        rosterStudentIds: roster,
        attendanceRows: att,
        feedbackStudentIds: feedbackOf.get(s.id) ?? [],
        media: { taggedStudentIds: cover.tagged, hasClassWide: cover.classWide },
      };
      const work = sessionWorkState(workInput);
      // Số bày ra bảng: "điểm danh x/y" đếm HỌC VIÊN CỦA LỚP đã được chấm (không cộng
      // học viên học bù, kẻo x > y); "có mặt" đếm mọi người thực sự đi học buổi đó.
      const marked = att.filter((a) => roster.has(a.studentId)).length;
      const attended = att.filter((a) => ATTENDED_STATUSES.has(a.status)).length;
      const row: AttendanceListRow = {
        id: s.id,
        classId: s.classId,
        number: numberOf.get(s.id) ?? null,
        // 26/08 — MỘT nhãn thay cho cặp cột "Buổi" + "Tiêu đề buổi", khớp site giáo viên.
        // Cặp cột cũ in "Buổi 1" ở cột trái rồi lại in tên bài vốn đã mở đầu bằng
        // "Buổi 1 — …" ở cột phải ⇒ đọc ra hai lần số buổi, trông như dữ liệu hỏng.
        sessionLabel:
          deriveSessionLabel({
            sessionNumber: numberOf.get(s.id) ?? null,
            planTitle: s.plan?.customTitle,
            planOrder: s.plan?.order,
            lessonTitle: s.lesson?.title,
            lessonOrder: s.lesson?.order,
            moduleCode: s.lesson?.moduleCode,
            topic: s.topic,
          }) || "Buổi học",
        dateLabel: dayFmt.format(s.date),
        timeLabel: classTime || clockFmt.format(s.date),
        phase: resolveAttendanceQueuePhase({
          date: s.date,
          cancelled: s.status === "CANCELLED",
          rosterEmpty: roster.size === 0,
          work,
          now,
        }),
        completed: s.status === "COMPLETED",
        roster: roster.size,
        marked,
        attended,
        attendanceDone: work.attendanceDone,
        feedbackDone: work.feedbackDone,
        photoDone: work.photoDone,
        photoCovered: photoCoveredCount(workInput),
      };
      return { row, time: s.date.getTime() };
    });

    // Thứ tự bậc + số buổi + ngày — tính Ở SERVER, client chỉ lọc chứ không xếp lại.
    const rows: AttendanceListRow[] = sortAttendanceQueue(enriched, (e) => ({
      phase: e.row.phase,
      number: e.row.number,
      time: e.time,
    })).map((e) => e.row);

    const canComplete = await checkPermission("sessions:edit");
    // 04/09/2026 — NÚT "NHẬN XÉT" phải theo quyền (chủ dự án chốt).
    //
    // Trang đích `/sessions/[id]` cho vào khi `canManageSessionClass` (SUPER_ADMIN /
    // quản lý ĐÚNG cơ sở / GV được phân lớp) HOẶC có `session-feedback:view-all`.
    // Sale và Quản lý lớp học không thoả vế nào ⇒ server ĐÃ redirect họ ra. Nhưng nút
    // vẫn hiện, nên họ bấm vào rồi bị đá về — một ngõ cụt, và trông như hệ thống lỗi.
    //
    // Cặp quyền dưới đây khớp đúng nhóm được vào: GV và quản lý cơ sở đều có CẢ HAI
    // (seed-roles), SUPER_ADMIN đi đường bypass. Cố ý KHÔNG gác bằng
    // `canManageSessionClass`: hàm đó xét theo VAI + lớp cụ thể, dùng ở đây sẽ chặt
    // hơn server và giấu nút khỏi chính giáo viên đứng lớp.
    const canFeedback =
      (await checkPermission("sessions:edit")) ||
      (await checkPermission("session-feedback:view-all"));

    return (
      <div>
        <BackToClasses />
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-black text-foreground sm:text-3xl">
            <ClipboardCheck className="h-7 w-7 shrink-0 text-primary" />
            {cls.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[cls.classCode, cls.course?.name, cls.center?.name, classTime]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border bg-muted p-12 text-center">
            <ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">Lớp này chưa có buổi học nào.</p>
            <p className="mt-2 text-sm">
              <Link
                href={`/classes/${cls.id}`}
                className="text-primary hover:underline"
              >
                Mở trang lớp để xếp lịch buổi →
              </Link>
            </p>
          </div>
        ) : (
          <AttendanceList
            rows={rows}
            classId={cls.id}
            className={cls.name}
            canComplete={canComplete}
            canFeedback={canFeedback}
          />
        )}
      </div>
    );
  }

  // ── Cấp 1: danh sách lớp ──────────────────────────────────────────────────
  //
  // Ai thấy lớp ở trạng thái nào — chốt 21/08. Đọc theo QUYỀN, không so tên vai:
  // thêm một vai mới (vd "Đào tạo vùng") chỉ cần cấp `classes:view-all` là xong.
  const [canViewAllClasses, canViewOwnClasses] = await Promise.all([
    checkPermission("classes:view-all"),
    checkPermission("classes:view-own"),
  ]);
  const visibleStatuses = actor.isSuperAdmin
    ? [...TEACHING_STATUSES, ...UPCOMING_STATUSES, ...CLOSED_STATUSES]
    : canViewAllClasses
      ? [...TEACHING_STATUSES, ...UPCOMING_STATUSES]
      : [...TEACHING_STATUSES];

  // Ô lọc cơ sở chỉ có nghĩa khi người dùng nhìn thấy TỪ HAI cơ sở trở lên —
  // đúng nhóm chủ dự án nêu (admin, đào tạo, hội sở). Suy từ cây tổ chức chứ không
  // liệt kê tên vai: mở cơ sở mới là thêm dữ liệu, không sửa code.
  const seesManyCenters = actor.isSuperAdmin || actor.isHoLevel || actor.visibleCenterIds.length > 1;
  // Danh sách cơ sở đi qua helper chung: bản tự viết cũ vẫn bày Hội sở (không dạy
  // học, chọn ra 0 lớp) và các dòng Center mồ côi của bộ test. Helper đã bỏ hai thứ
  // đó + cơ sở đã tắt, và vẫn cắt theo tầm nhìn actor như đoạn cũ.
  const centers = seesManyCenters ? await getCenterOptions(actor) : [];

  // Chỉ có quyền xem lớp CỦA MÌNH (giáo viên) → chặn thêm theo GV chính/trợ giảng.
  // Cùng luật với /admin/classes: chỉ siết khi có view-own mà KHÔNG có view-all — ai
  // không có quyền nào thì `classScope` ở trên đã lo, đừng chặn chồng thành màn trắng.
  // Dùng `AND` chứ đừng nhét `OR` thẳng vào object: `classScope` của giáo viên cũng là
  // một `OR`, gán đè lên nhau là mất luôn cổng scope.
  const ownClassOnly = !canViewAllClasses && canViewOwnClasses;
  const classes = await sdb.class.findMany({
    where: {
      deletedAt: null,
      ...classScope,
      status: { in: visibleStatuses },
      ...(centerFilter ? { centerId: centerFilter } : {}),
      ...(ownClassOnly
        ? {
            AND: [
              {
                OR: [{ teacherId: gateUser.id }, { assistantId: gateUser.id }],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      classCode: true,
      status: true,
      startTime: true,
      endTime: true,
      center: { select: { id: true, name: true } },
      course: { select: { name: true } },
      teacher: { select: { name: true } },
      _count: {
        select: {
          enrollments: {
            where: {
              status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
              deletedAt: null,
              student: { deletedAt: null },
            },
          },
        },
      },
    },
    take: 300,
  });

  // Tiến độ buổi ở cấp này đọc bằng `ClassSession.status` — RẺ (2 groupBy), và từ
  // 21/08 nó có nghĩa thật vì nút "Hoàn tất buổi" ở cấp 2 chính là thứ đặt COMPLETED.
  // Ba điều kiện chi tiết chỉ tính khi đã mở vào một lớp.
  const classIds = classes.map((c) => c.id);
  const todayEnd = vnEndOfDay(new Date());
  const [totalGroups, doneGroups, heldGroups] = classIds.length
    ? await Promise.all([
        sdb.classSession.groupBy({
          by: ["classId"],
          where: { classId: { in: classIds }, status: { not: "CANCELLED" } },
          _count: { _all: true },
        }),
        sdb.classSession.groupBy({
          by: ["classId"],
          where: { classId: { in: classIds }, status: "COMPLETED" },
          _count: { _all: true },
        }),
        sdb.classSession.groupBy({
          by: ["classId"],
          where: {
            classId: { in: classIds },
            status: { not: "CANCELLED" },
            date: { lte: todayEnd },
          },
          _count: { _all: true },
        }),
      ])
    : [[], [], []];
  const totalOf = new Map(totalGroups.map((g) => [g.classId, g._count._all]));
  const doneOf = new Map(doneGroups.map((g) => [g.classId, g._count._all]));
  const heldOf = new Map(heldGroups.map((g) => [g.classId, g._count._all]));

  const classRows: AttendanceClassRow[] = classes
    .map((c) => {
      const held = heldOf.get(c.id) ?? 0;
      const done = doneOf.get(c.id) ?? 0;
      return {
        id: c.id,
        name: c.name,
        classCode: c.classCode ?? "",
        status: c.status,
        centerName: c.center?.name ?? "",
        courseName: c.course?.name ?? "",
        teacherName: c.teacher?.name ?? "",
        timeLabel: c.startTime && c.endTime ? `${c.startTime} - ${c.endTime}` : "",
        roster: c._count.enrollments,
        totalSessions: totalOf.get(c.id) ?? 0,
        heldSessions: held,
        doneSessions: done,
        pendingSessions: Math.max(0, held - done),
      };
    })
    // Lớp còn nợ nhiều buổi nhất lên trước — mở màn ra là thấy chỗ phải xử lý.
    .sort(
      (a, b) =>
        b.pendingSessions - a.pendingSessions || a.name.localeCompare(b.name, "vi"),
    );

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-3xl font-black text-foreground">
          <ClipboardCheck className="h-7 w-7 text-primary" />
          Điểm danh
        </h1>
        <p className="mt-1 text-muted-foreground">
          Chọn lớp để mở danh sách buổi. Một buổi chỉ tính là hoàn tất khi đã điểm danh
          đủ lớp, nhận xét đủ học viên đi học và có ảnh/video trong kho.
        </p>
      </div>

      {classRows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border bg-muted p-12 text-center">
          <ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">
            Chưa có lớp nào trong phạm vi của bạn.
          </p>
        </div>
      ) : (
        <AttendanceClassList
          rows={classRows}
          centers={centers}
          centerId={centerFilter ?? ""}
        />
      )}
    </div>
  );
}

function BackToClasses() {
  return (
    <Link
      href="/attendance"
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Danh sách lớp
    </Link>
  );
}
