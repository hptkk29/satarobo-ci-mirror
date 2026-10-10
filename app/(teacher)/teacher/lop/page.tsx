// app/(teacher)/teacher/lop/page.tsx — #06 (L6): "Lớp của tôi" → điểm danh 6 nhãn (câu 50).
//
// 3 mức điều hướng qua searchParams (không cần route động):
//   (a) không tham số   → danh sách lớp GV được phân (assignedClassIds).
//   (b) ?classId=…      → các buổi gần đây của lớp đó (chỉ lớp mình — chống IDOR).
//   (c) ?…&sessionId=…  → roster điểm danh của buổi (buildSessionAttendanceRows).
//
// Cách ly cơ sở + makeup liên cơ sở: đọc qua withMakeupException(actorGiangDay(actor)) để GV dạy bù
// thấy đúng buổi/lớp ở cơ sở khác; quyền sở hữu thật do assignedClassIds / ownership gác.
// ⚠️ Câu 46: roster từ server đã strip studentPhone — client CHỈ nhận tên HV.
import { redirect } from "next/navigation";
import { CalendarX2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, withMakeupException } from "@/lib/db-scope";
import {
  countMissingAttendanceByClass,
  groupMarkedBySession,
  groupRosterByClass,
} from "@/lib/lms/attendance-pending";
import { rosterWhere } from "@/lib/enrollment-scope";
import { isSessionOwnedByTeacher } from "@/lib/lms/session-ownership";
import { buildSessionAttendanceRows } from "@/lib/attendance/roster";
import {
  buildSessionNumberMap,
  nhanSoBuoi,
  soBuoiTheoLoTrinh,
} from "@/lib/lms/session-order";
import { EmptyState } from "../_components/ui/empty-state";
import { PageHeader } from "../_components/ui/page-header";
import { SessionStatusPill } from "../_components/ui/session-status-pill";
import {
  AttendancePanel,
  type AttendancePanelRow,
} from "./_components/attendance-panel";
import {
  ClassList,
  ClassListEmpty,
  ClassStatusPill,
  type ClassRow,
} from "./_components/class-list";
import { HubTabBar, parseHubTab } from "./_components/hub-tab-bar";
import { HubSessionsTab } from "./_components/hub-sessions-tab";
import { HubStudentsTab } from "./_components/hub-students-tab";
import { HubReviewsTab } from "./_components/hub-reviews-tab";
import { HubAssignmentsTab } from "./_components/hub-assignments-tab";
import { HubMaterialsTab } from "./_components/hub-materials-tab";
import { HubGalleryTab } from "./_components/hub-gallery-tab";
import { BackLink } from "../_components/ui/back-link";
import { getSessionBirthdays } from "@/lib/students/birthday";
import { BirthdayBanner } from "./_components/birthday-banner";
import { HelpHint } from "@/components/admin/ui/help-hint";

export const metadata = { title: "Lớp của tôi | Giáo viên Sata Robo" };

// 21/08 — CÓ `year` (đồng bộ với các bảng buổi khác của site GV).
const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh (UTC+7, không DST)

/** Mốc hết ngày hôm nay (giờ VN) dạng UTC — để đếm buổi "đã tới ngày". */
function vnTodayEnd(now = new Date()): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const startUtc =
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) -
    VN_OFFSET_MS;
  return new Date(startUtc + 24 * 60 * 60 * 1000);
}

/** scheduleDays: 0=CN … 6=T7 → nhãn tiếng Việt. */
const DAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** "T7 · 08:00-10:00" từ scheduleDays + giờ lớp. */
function scheduleText(
  days: number[],
  start: string | null,
  end: string | null,
): string {
  const d = days
    .map((x) => DAY_LABELS[x])
    .filter((x): x is string => Boolean(x))
    .join(" ");
  const t = start && end ? `${start}-${end}` : "";
  return [d, t].filter(Boolean).join(" · ");
}

export default async function TeacherClassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    classId?: string;
    sessionId?: string;
    tab?: string;
    // Bộ lọc của danh sách lớp — đọc Ở SERVER để ClassList có giá trị đúng ngay
    // lượt render đầu (xem chú thích đầu use-loc-tren-url.ts).
    q?: string;
    khoa?: string;
    trangThai?: string;
    rvSession?: string; // Nhận xét deep — buổi cần nhận xét
    asgId?: string; // Bài tập deep — bài cần xem chi tiết
    subId?: string; // Bài tập deep — bài nộp cần chấm
  }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate

  const { classId, sessionId, tab, rvSession, asgId, subId, q, khoa, trangThai} =
    await searchParams;
  const actor = await resolveActor(session.user.id);
  const xdb = withMakeupException(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  // ── (c) Roster điểm danh của 1 buổi ──────────────────────────────────────────
  // KHÔNG gate bằng assignedClassIds ở đây: GV DẠY THAY không có lớp trong
  // assignedClassIds (chỉ teacherId/assistantId) — quyền sở hữu thật do
  // isSessionOwnedByTeacher quyết (xét cả substituteTeacherId/actualTeacherId),
  // cùng predicate với saveClassAttendanceAction. Fail → NotYours, không rơi im lặng.
  if (classId && sessionId) {
    const sess = await xdb.classSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        classId: true,
        date: true,
        topic: true,
        status: true,
        substituteTeacherId: true,
        actualTeacherId: true,
        room: { select: { code: true, name: true } },
        // Đợt 1c — nguồn số LỘ TRÌNH. Tiêu đề trang này nói về MỘT buổi cụ thể, nên
        // giáo viên cần biết buổi đó dạy BÀI nào, không phải nó là buổi thứ mấy theo lịch.
        plan: { select: { order: true } },
        lesson: { select: { order: true } },
        class: { select: { name: true, startTime: true, endTime: true } },
      },
    });
    const owned =
      sess &&
      isSessionOwnedByTeacher(
        {
          classId: sess.classId,
          substituteTeacherId: sess.substituteTeacherId,
          actualTeacherId: sess.actualTeacherId,
        },
        { userId: session.user.id, assignedClassIds: actor.assignedClassIds },
      );

    if (!sess || !owned || sess.classId !== classId) {
      return <NotYours />;
    }

    // Sinh nhật tổ chức tại buổi này — đọc SAU khi ownership đã gác ở trên.
    const [{ rows }, birthdays, allSessions] = await Promise.all([
      buildSessionAttendanceRows(actor, sessionId),
      getSessionBirthdays(sessionId),
      // R1 — số buổi tính trên TOÀN BỘ buổi của lớp (lib/lms/session-order).
      xdb.classSession.findMany({
        where: { classId },
        select: { id: true, date: true },
      }),
    ]);
    const sessionNo = buildSessionNumberMap(allSessions).get(sessionId) ?? null;
    // Đợt 1c — LỘ TRÌNH, không phải hạng-theo-ngày. Đây là tiêu đề của MỘT buổi: giáo viên
    // mở trang này để dạy, nên con số phải trả lời "bài nào". `nhanSoBuoi` tự khai
    // "(theo lịch)" ở nấc lùi, nên lớp chưa ghim giáo trình vẫn không nói dối.
    const nhanBuoi = nhanSoBuoi({
      loTrinh: soBuoiTheoLoTrinh({
        planOrder: sess.plan?.order ?? null,
        lessonOrder: sess.lesson?.order ?? null,
      }),
      lich: sessionNo,
    });
    // Câu 46: bỏ studentPhone khỏi payload client — chỉ giữ tên + trạng thái.
    const panelRows: AttendancePanelRow[] = rows.map((r) => ({
      studentId: r.studentId,
      studentName: r.studentName,
      enrollmentStatus: r.enrollmentStatus,
      makeupFromCenter: r.makeupFromCenter ?? null,
      existingStatus: r.existing?.status ?? null,
      existingNote: r.existing?.note ?? null,
      // G-29: thiếu trường này là panel đòi chấm cả em chưa tới lượt mà server không nhận.
      chuaToiLuot: r.chuaToiLuot,
      ketQuaBu: r.ketQuaBu?.nhan ?? null,
    }));

    return (
      <div>
        <BackLink
          className="mb-4"
          href={`?classId=${classId}&tab=diem-danh`}
          label="Điểm danh của lớp"
        />
        <PageHeader
          title={`Điểm danh — ${sess.topic ?? sess.class.name}`}
          subtitle={[
            nhanBuoi === "—" ? null : nhanBuoi,
            dayFmt.format(sess.date),
            sess.class.startTime && sess.class.endTime
              ? `${sess.class.startTime}-${sess.class.endTime}`
              : null,
            sess.room ? `Phòng ${sess.room.code ?? sess.room.name}` : null,
            sess.topic ? sess.class.name : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          actions={<SessionStatusPill status={sess.status} />}
        />
        <BirthdayBanner items={birthdays} />
        <AttendancePanel
          sessionId={sessionId}
          rows={panelRows}
          // Cùng gate với hub-sessions-tab (vnTodayEnd) + server (saveClassAttendanceAction):
          // buổi TƯƠNG LAI không mở điểm danh — chặn ghi trước + notify PH buổi chưa diễn ra.
          editable={
            sess.status !== "CANCELLED" &&
            sess.date.getTime() <= vnTodayEnd().getTime()
          }
        />
      </div>
    );
  }

  // ── (b′) GV DẠY THAY mở hub của lớp KHÔNG phải lớp mình ──────────────────────
  // Hub (b) gác bằng assignedClassIds — dạy thay KHÔNG nằm trong tập đó (xem ghi
  // chú ở nhánh (c)). Trước 03/08 điều kiện sai thì rơi thẳng xuống nhánh (a) và
  // hiện… danh sách lớp: GV bấm "Nhận xét" cho buổi mình dạy thay thì màn nhảy về
  // "Lớp học của tôi", URL vẫn nguyên, không một chữ giải thích — đúng lớp lỗi mà
  // nhánh (c) đã dặn "fail → NotYours, không rơi im lặng".
  //
  // Dạy thay được nhận xét buổi mình dạy: /teacher/nhan-xet vốn đã xét
  // substituteTeacherId/actualTeacherId, nên đưa họ sang đúng đường đó. Các tab còn
  // lại (roster, học bạ, tài liệu, kho ảnh cả lớp) KHÔNG mở cho người chỉ dạy 1 buổi.
  if (classId && !actor.assignedClassIds.has(classId)) {
    const coveredHere = await xdb.classSession.findFirst({
      where: {
        classId,
        OR: [
          { substituteTeacherId: session.user.id },
          { actualTeacherId: session.user.id },
        ],
      },
      select: { id: true },
    });
    if (coveredHere) {
      if (parseHubTab(tab) === "nhan-xet") {
        const sid = rvSession ?? coveredHere.id;
        redirect(`/teacher/nhan-xet?classId=${classId}&sessionId=${sid}`);
      }
      return <NotYours />;
    }
  }

  // ── (b) Class Hub: 1 lớp, 6 tab (Học viên / Điểm danh / Nhận xét / Bài tập /
  //        Tài liệu / Ảnh lớp) qua ?tab=. Header + tab bar do page dựng; nội dung
  //        tab đọc scoped riêng trong từng HubXxxTab (chỉ tab đang mở fetch data).
  if (classId && actor.assignedClassIds.has(classId)) {
    const activeTab = parseHubTab(tab);
    const cls = await xdb.class.findUnique({
      where: { id: classId },
      select: {
        name: true,
        classCode: true,
        status: true,
        scheduleDays: true,
        startTime: true,
        endTime: true,
        // 20/08 — "Mô tả chi tiết đặc thù lớp học": sổ bàn giao nội bộ (tính cách từng HV,
        // lưu ý riêng). Đọc ở đây chính là LÝ DO field đổi vai — đổi giáo viên thì người
        // mới phải thấy ngay, không phải đi hỏi lại. KHÔNG bao giờ đẩy sang portal PH.
        description: true,
        course: { select: { name: true } },
        center: { select: { name: true } },
      },
    });
    if (!cls) return <NotYours />;

    // Badge tab Điểm danh: buổi (60 ngày gần, đã tới hết hôm nay, chưa hủy) chưa có
    // bản ghi điểm danh — cùng tín hiệu "Cần xử lý" ở danh sách lớp.
    const todayEnd = vnTodayEnd();
    const pendFrom = new Date(todayEnd.getTime() - 60 * 24 * 60 * 60 * 1000);
    const pendSessions = await xdb.classSession.findMany({
      where: {
        classId,
        status: { not: "CANCELLED" },
        date: { gte: pendFrom, lte: todayEnd },
      },
      select: { id: true },
    });
    const attendedSet = new Set(
      pendSessions.length
        ? (
            await xdb.attendance.findMany({
              where: { sessionId: { in: pendSessions.map((s) => s.id) } },
              select: { sessionId: true },
            })
          ).map((a) => a.sessionId)
        : [],
    );
    const attendancePending = pendSessions.filter(
      (s) => !attendedSet.has(s.id),
    ).length;

    const timeLabel =
      cls.startTime && cls.endTime ? `${cls.startTime}-${cls.endTime}` : "";
    const subtitle = [
      cls.classCode,
      cls.course.name,
      scheduleText(cls.scheduleDays, cls.startTime, cls.endTime),
      cls.center?.name,
    ]
      .filter(Boolean)
      .join(", ");

    return (
      <div>
        <BackLink className="mb-4" href="?" label="Lớp của tôi" />

        {/* Header lớp — tên + trạng thái + mã/khoá/lịch/cơ sở (khớp reference) */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              {cls.name}
            </h1>
            <ClassStatusPill status={cls.status} />
          </div>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>

        {/* Sổ bàn giao của lớp — đặt TRÊN thanh tab để hiện ở mọi tab: GV nhận lớp mới cần
            đọc trước khi làm bất cứ việc gì, nhét vào một tab là coi như không ai thấy.
            Rỗng thì không render (khối trống chỉ tổ đẩy nội dung xuống). `whitespace-pre-line`
            giữ nguyên xuống dòng vì nhân sự gõ theo kiểu gạch đầu dòng từng học viên. */}
        {cls.description?.trim() && (
          <section className="mb-6 rounded-xl border border-border bg-muted/40 p-4">
            <h2 className="mb-2 flex items-center gap-1 text-sm font-bold text-foreground">
              Mô tả đặc thù lớp học
              <HelpHint label="Ai đọc được mô tả này">
                Ghi chú bàn giao nội bộ — chỉ nhân sự và giáo viên của lớp đọc được,
                KHÔNG hiển thị cho phụ huynh. Cần sửa thì báo quản lý cơ sở.
              </HelpHint>
            </h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {cls.description}
            </p>
          </section>
        )}

        <HubTabBar
          classId={classId}
          active={activeTab}
          attendancePending={attendancePending}
        />

        {activeTab === "hoc-vien" && (
          <HubStudentsTab actor={actor} classId={classId} />
        )}
        {activeTab === "diem-danh" && (
          <HubSessionsTab
            actor={actor}
            classId={classId}
            timeLabel={timeLabel}
          />
        )}
        {activeTab === "nhan-xet" && (
          <HubReviewsTab
            actor={actor}
            classId={classId}
            reviewSessionId={rvSession}
          />
        )}
        {activeTab === "bai-tap" && (
          <HubAssignmentsTab
            actor={actor}
            classId={classId}
            className={cls.name}
            assignmentId={asgId}
            submissionId={subId}
          />
        )}
        {activeTab === "tai-lieu" && (
          <HubMaterialsTab actor={actor} classId={classId} />
        )}
        {activeTab === "anh-lop" && (
          <HubGalleryTab actor={actor} classId={classId} />
        )}
      </div>
    );
  }

  // ── (a) Danh sách lớp được phân ───────────────────────────────────────────────
  const rawClasses = classIds.length
    ? await xdb.class.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          name: true,
          classCode: true,
          status: true,
          scheduleDays: true,
          startTime: true,
          endTime: true,
          maxStudents: true,
          course: { select: { name: true } },
          center: { select: { name: true } },
          _count: {
            select: {
              // Sĩ số = đang học. rosterWhere thêm deletedAt + student.deletedAt vốn
              // thiếu ở đây, nên HV đã gỡ mềm thôi cộng vào sĩ số (QA vòng 1, BUG-012:
              // danh sách lớp 11, trang Học viên 12 cho cùng lớp CS1.09).
              enrollments: { where: rosterWhere("dang-hoc") },
            },
          },
        },
        orderBy: { name: "asc" },
      })
    : [];

  // Cột "Cần xử lý": đếm buổi (60 ngày gần, đã tới hết hôm nay, chưa hủy) CÒN NỢ
  // điểm danh — theo từng lớp. Cùng tín hiệu với dashboard vì cùng gọi một hàm.
  //
  // ⚠️ "Còn nợ" = điểm danh chưa PHỦ ĐỦ sĩ số, KHÔNG phải "chưa có bản ghi nào".
  // Bản cũ chỉ hỏi buổi có tồn tại dòng Attendance nào không, nên:
  //   • buổi chấm thiếu người vẫn báo "Hoàn tất" và giáo viên không có đường nào
  //     biết mình còn nợ (QA vòng 1, BUG-002);
  //   • nguy hiểm hơn và đang chạy trên PROD: duyệt phiếu xin nghỉ của phụ huynh
  //     ghi ĐÚNG MỘT dòng Attendance ⇒ buổi rơi khỏi danh sách việc ngay lập tức,
  //     kèm pill xanh "Có mặt 0/12".
  const todayEnd = vnTodayEnd();
  const pendFrom = new Date(todayEnd.getTime() - 60 * 24 * 60 * 60 * 1000);
  const pendSessions = classIds.length
    ? await xdb.classSession.findMany({
        where: {
          classId: { in: classIds },
          status: { not: "CANCELLED" },
          date: { gte: pendFrom, lte: todayEnd },
        },
        select: { id: true, classId: true },
      })
    : [];
  const [attRows, rosterRows] = await Promise.all([
    pendSessions.length
      ? xdb.attendance.findMany({
          where: { sessionId: { in: pendSessions.map((s) => s.id) } },
          select: { sessionId: true, studentId: true },
        })
      : Promise.resolve([]),
    classIds.length
      ? xdb.class.findMany({
          where: { id: { in: classIds } },
          select: {
            id: true,
            enrollments: {
              where: rosterWhere("dang-hoc"),
              select: { studentId: true },
            },
          },
        })
      : Promise.resolve([]),
  ]);
  const rosterByClass = groupRosterByClass(rosterRows);
  const pendingByClass = countMissingAttendanceByClass({
    sessions: pendSessions,
    markedBySession: groupMarkedBySession(attRows),
    rosterByClass,
  });
  // Lớp có việc điểm danh để làm = có sĩ số VÀ có buổi đã tới ngày trong cửa sổ.
  // Không có việc thì cột để trống, chứ không khoe "Hoàn tất" (BUG-016).
  const classesWithWork = new Set(
    pendSessions
      .filter((s) => (rosterByClass.get(s.classId)?.size ?? 0) > 0)
      .map((s) => s.classId),
  );

  const rows: ClassRow[] = rawClasses.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.classCode,
    center: c.center?.name ?? null,
    course: c.course.name,
    schedule: scheduleText(c.scheduleDays, c.startTime, c.endTime),
    enrolled: c._count.enrollments,
    capacity: c.maxStudents,
    status: c.status,
    pending: pendingByClass.get(c.id) ?? 0,
    hasAttendanceWork: classesWithWork.has(c.id),
  }));

  return (
    <div>
      <PageHeader
        title="Lớp học của tôi"
        subtitle="Các lớp bạn đang phụ trách. Bấm vào một lớp để điểm danh, nhận xét, giao bài và xem học viên."
      />
      {rows.length === 0 ? (
        <ClassListEmpty />
      ) : (
        <ClassList rows={rows} banDauLoc={{ q, khoa, trangThai }} />
      )}
    </div>
  );
}

function NotYours() {
  return (
    <div>
      <BackLink className="mb-4" href="?" label="Lớp của tôi" />
      <EmptyState
        icon={CalendarX2}
        title="Buổi học không thuộc lớp bạn phụ trách."
      />
    </div>
  );
}
