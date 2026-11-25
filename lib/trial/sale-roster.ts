// lib/trial/sale-roster.ts — Đợt C (kế hoạch Site Sale, 22/08/2026).
//
// Danh sách học viên trải nghiệm cho **site Sale**. Khác bản site giáo viên
// (`lib/lms/teacher-schedule.ts` → `getTeacherTrialRoster`) ở ba điểm:
//
//   1. **Phạm vi theo CƠ SỞ, không theo giáo viên.** Sale chăm khách của cơ sở
//      mình, không phải lớp mình dạy.
//   2. **Có cột Phụ huynh.** Site giáo viên cố ý ẩn (quyết định câu 46); trên
//      site Sale đây là dữ liệu nghiệp vụ chính đáng — nhưng phải qua kiểm
//      quyền `canViewParentContact`, và che ở TẦNG DỮ LIỆU.
//   3. **Có cờ "đã nhập học"** lấy từ `LeadTrialHistory.outcome`, không suy từ
//      trạng thái ghi danh trải nghiệm.
//
// ⚠️ CÁCH LY CƠ SỞ: `TrialClassSession` / `TrialEnrollment` / `TrialRubricEval`
// **KHÔNG** nằm trong `SCOPED_MODELS`, nên `scopedDb` không tự lọc chúng. Vì vậy
// truy vấn đi từ `trialClassV2` (CÓ trong `SCOPED_MODELS`) làm gốc và lấy buổi/
// ghi danh qua quan hệ con — cách duy nhất để cơ sở được ép ở tầng truy vấn.
import type { TrialEnrollmentStatus, TrialSessionStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { maskPhone, maskPersonName } from "@/lib/lead/pii";
import { khoaHieuLucCuaBe } from "@/lib/lead/khoa-quan-tam";

export type SaleTrialStudent = {
  enrollmentId: string;
  studentName: string;
  birthYear: number | null;
  courseName: string | null;
  /** Đã che nếu người xem không có quyền xem liên hệ phụ huynh. */
  parentName: string | null;
  /** Đã che nếu người xem không có quyền xem liên hệ phụ huynh. */
  parentPhone: string | null;
  status: TrialEnrollmentStatus;
  /** Đã có phiếu đánh giá của giáo viên chưa → hiện nút xem / xuất PDF. */
  evaluated: boolean;
  /** Đã chốt khoá chính (`LeadTrialHistory.outcome = ENROLLED`). */
  enrolled: boolean;
};

export type SaleTrialSlot = {
  sessionId: string;
  trialClassName: string;
  /** `@db.Date` → UTC 00:00 của ngày VN; format phải ép `timeZone: "UTC"`. */
  date: Date;
  startTime: string;
  endTime: string;
  status: TrialSessionStatus;
  students: SaleTrialStudent[];
};

export type SaleTrialRoster = {
  slots: SaleTrialSlot[];
  /** Học viên đã vào lớp nhưng chưa gắn buổi — hiện riêng để không ai tàng hình. */
  unassigned: (SaleTrialStudent & { trialClassName: string })[];
};

/**
 * Áp quyền riêng tư lên một dòng học viên. THUẦN — để test được mà không cần DB,
 * và để quy tắc che nằm ở MỘT chỗ thay vì rải trong JSX.
 *
 * Che ở đây (tầng dữ liệu) chứ không ở giao diện: dữ liệu của Server Component
 * đi thẳng vào payload gửi xuống trình duyệt, che ở JSX là số thật vẫn nằm trong
 * payload và mở công cụ nhà phát triển là thấy.
 */
export function buildSaleTrialStudent(
  row: SaleTrialStudent,
  opts: { canViewParentContact: boolean },
): SaleTrialStudent {
  if (opts.canViewParentContact) return row;
  return {
    ...row,
    parentName: row.parentName ? maskPersonName(row.parentName) : null,
    parentPhone: row.parentPhone ? maskPhone(row.parentPhone) : null,
  };
}

/**
 * Buổi trải nghiệm trong [from, to) thuộc các cơ sở actor nhìn thấy + học viên.
 *
 * @param opts.canViewParentContact kết quả `canViewParentContact()` của người
 *        đang xem — tầng gọi truyền vào, hàm này KHÔNG tự đoán quyền.
 */
export async function getSaleTrialRoster(
  actor: Actor,
  from: Date,
  to: Date,
  opts: { canViewParentContact: boolean },
): Promise<SaleTrialRoster> {
  const sdb = scopedDb(actor);

  // Gốc truy vấn là lớp trải nghiệm (model CÓ cách ly cơ sở) — xem chú thích đầu file.
  const classes = await sdb.trialClassV2.findMany({
    where: { status: { not: "CANCELLED" } },
    select: {
      id: true,
      name: true,
      sessions: {
        where: { status: { not: "CANCELLED" }, date: { gte: from, lt: to } },
        select: { id: true, date: true, startTime: true, endTime: true, status: true },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      },
      enrollments: {
        select: {
          id: true,
          scheduledSessionId: true,
          status: true,
          leadChildId: true,
          leadChild: {
            select: {
              fullName: true,
              dob: true,
              ageYears: true,
              interestedCourseId: true,
              // `courseId` — nguồn lùi của `khoaHieuLucCuaBe` (26/09).
              lead: { select: { parentName: true, phone: true, courseId: true } },
            },
          },
        },
        orderBy: { leadChild: { fullName: "asc" } },
      },
      trialHistory: { select: { leadChildId: true, outcome: true } },
    },
    take: 200,
  });

  const allEnrollments = classes.flatMap((c) =>
    c.enrollments.map((e) => ({ ...e, className: c.name, classId: c.id })),
  );
  if (allEnrollments.length === 0 && classes.every((c) => c.sessions.length === 0)) {
    return { slots: [], unassigned: [] };
  }

  // Tên khoá quan tâm (Course là danh mục toàn cục, scopedDb đi thẳng).
  const courseIds = [
    ...new Set(
      allEnrollments
        .map((e) => khoaHieuLucCuaBe(e.leadChild))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const courses = courseIds.length
    ? await sdb.course.findMany({
        where: { id: { in: courseIds } },
        select: { id: true, name: true },
      })
    : [];
  const courseName = new Map(courses.map((c) => [c.id, c.name]));

  const evaluatedSet = new Set(
    (
      await sdb.trialRubricEval.findMany({
        where: { trialEnrollmentId: { in: allEnrollments.map((e) => e.id) } },
        select: { trialEnrollmentId: true },
      })
    ).map((r) => r.trialEnrollmentId),
  );

  // "Đã nhập học" theo cặp (con × lớp) — nguồn đúng, không suy từ trạng thái ghi danh.
  const enrolledSet = new Set(
    classes.flatMap((c) =>
      c.trialHistory
        .filter((h) => h.outcome === "ENROLLED")
        .map((h) => `${h.leadChildId}::${c.id}`),
    ),
  );

  const nowYear = new Date().getUTCFullYear();
  const toStudent = (e: (typeof allEnrollments)[number]): SaleTrialStudent =>
    buildSaleTrialStudent(
      {
        enrollmentId: e.id,
        studentName: e.leadChild.fullName,
        birthYear:
          e.leadChild.dob?.getUTCFullYear() ??
          (e.leadChild.ageYears != null ? nowYear - e.leadChild.ageYears : null),
        courseName: courseName.get(khoaHieuLucCuaBe(e.leadChild) ?? "") ?? null,
        parentName: e.leadChild.lead?.parentName ?? null,
        parentPhone: e.leadChild.lead?.phone ?? null,
        status: e.status,
        evaluated: evaluatedSet.has(e.id),
        enrolled: enrolledSet.has(`${e.leadChildId}::${e.classId}`),
      },
      opts,
    );

  const slots: SaleTrialSlot[] = [];
  for (const c of classes) {
    for (const s of c.sessions) {
      slots.push({
        sessionId: s.id,
        trialClassName: c.name,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status,
        students: allEnrollments
          .filter((e) => e.scheduledSessionId === s.id)
          .map(toStudent),
      });
    }
  }
  slots.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() || a.startTime.localeCompare(b.startTime),
  );

  // 23/09 — bé trỏ vào case ĐÃ HUỶ cũng là "chưa gắn buổi" (lib/trial/nghia-null.ts).
  // Trước đây bé đó biến khỏi CẢ slot (buổi huỷ bị lọc) LẪN nhóm chưa gắn (vì có id).
  const idGhim = [
    ...new Set(allEnrollments.map((e) => e.scheduledSessionId).filter((x): x is string => !!x)),
  ];
  const idHuy = new Set(
    (idGhim.length
      ? await sdb.trialClassSession.findMany({
          where: { id: { in: idGhim }, status: "CANCELLED" },
          select: { id: true },
        })
      : []
    ).map((x) => x.id),
  );
  const unassigned = allEnrollments
    .filter(
      (e) =>
        (!e.scheduledSessionId || idHuy.has(e.scheduledSessionId)) &&
        e.status !== "WITHDRAWN",
    )
    .map((e) => ({ ...toStudent(e), trialClassName: e.className }));

  return { slots, unassigned };
}

/**
 * Ngữ cảnh phiếu đánh giá cho site Sale — cùng hình dạng với bản site giáo viên
 * (`TeacherTrialRubricContext`) nhưng **gác bằng cách ly cơ sở** thay vì own-teacher.
 *
 * Sale không dạy lớp nào, nên guard đúng là "lớp trải nghiệm này có thuộc cơ sở
 * mình nhìn thấy không". Truy vấn đi từ `trialClassV2` (model CÓ cách ly cơ sở)
 * để `scopedDb` ép điều kiện — `TrialEnrollment` không nằm trong `SCOPED_MODELS`
 * nên hỏi thẳng nó là bỏ qua cách ly.
 *
 * `null` = không tồn tại HOẶC ngoài tầm nhìn cơ sở (cố ý không phân biệt hai ca:
 * phân biệt được là dò ra sự tồn tại của dữ liệu cơ sở khác).
 */
export async function getSaleTrialRubricContext(
  actor: Actor,
  enrollmentId: string,
  /**
   * Lấy phiếu của ĐÚNG buổi này. Bỏ trống = phiếu mới nhất (hành vi cũ của site Sale).
   *
   * 27/08 — màn Lớp Trial in phiếu ngay trên dòng điểm danh, mà dòng đó thuộc về một
   * BUỔI cụ thể. Ở đó "mới nhất" là sai: bấm ở buổi 1 mà ra phiếu buổi 2 thì phụ huynh
   * nhận nhầm bản đánh giá, và không có dấu hiệu nào để ai đó nhận ra.
   */
  trialClassSessionId?: string,
): Promise<{
  studentName: string;
  courseName: string | null;
  trialClassName: string;
  existing: {
    scores: unknown;
    totalScore: number;
    rank: string;
    generalComment: string | null;
    orientation: string | null;
    updatedAt: Date;
    evaluatedByName: string | null;
  } | null;
} | null> {
  const sdb = scopedDb(actor);

  const cls = await sdb.trialClassV2.findFirst({
    where: { enrollments: { some: { id: enrollmentId } } },
    select: {
      name: true,
      enrollments: {
        where: { id: enrollmentId },
        select: {
          leadChild: {
            select: { fullName: true, interestedCourseId: true, lead: { select: { courseId: true } } },
          },
        },
      },
    },
  });
  const enr = cls?.enrollments[0];
  if (!cls || !enr) return null;

  const khoaId = khoaHieuLucCuaBe(enr.leadChild);
  const courseName = khoaId
    ? ((
        await sdb.course.findUnique({
          where: { id: khoaId },
          select: { name: true },
        })
      )?.name ?? null)
    : null;

  // ⚠️ `findFirst` chứ không `findUnique`: GĐ4 đổi khoá duy nhất của phiếu từ
  // `trialEnrollmentId` sang cặp (ca, buổi) — một ca nay có NHIỀU phiếu, mỗi buổi
  // một phiếu. Tra theo `trialEnrollmentId` một mình không còn là khoá duy nhất.
  //
  // Lấy phiếu MỚI NHẤT vì Sale in phiếu để chốt với phụ huynh, và cái họ cần là
  // đánh giá gần nhất. Nợ có khai: màn Sale chưa có ô CHỌN buổi như site giáo viên
  // (`?sessionId=`) — thêm được thì nên thêm, nhưng chọn mặc định sai còn tệ hơn
  // không cho chọn, nên bản này chốt "mới nhất" thay vì "buổi đang xếp".
  const existing = await sdb.trialRubricEval.findFirst({
    where: {
      trialEnrollmentId: enrollmentId,
      ...(trialClassSessionId ? { trialClassSessionId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      scores: true,
      totalScore: true,
      rank: true,
      generalComment: true,
      orientation: true,
      updatedAt: true,
      evaluatedByName: true,
    },
  });

  return {
    studentName: enr.leadChild.fullName,
    courseName,
    trialClassName: cls.name,
    existing,
  };
}
