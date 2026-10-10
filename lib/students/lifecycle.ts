import type { EnrollmentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  ENROLLMENT_ACTIVE_STATUS_LIST,
  STUDYING_ENROLLMENT_STATUSES,
} from "@/lib/enrollment-status";
import { getSetting } from "@/lib/settings/service";

/**
 * Ghi danh đang GIỮ CHỖ trong một lớp (đúng bộ mà roster + sĩ số coi là thuộc lớp).
 * Dùng chung với `@/lib/enrollment-status` để tab vòng đời không lệch khỏi màn lớp.
 */
export const IN_CLASS_ENROLLMENT_STATUSES: EnrollmentStatus[] = [
  ...ENROLLMENT_ACTIVE_STATUS_LIST,
];

// `STUDYING_ENROLLMENT_STATUSES` sống ở `lib/enrollment-status.ts` (file KHÔNG kéo Prisma,
// nên client component dùng chung được); re-export ở đây cho các call-site cũ.
export { STUDYING_ENROLLMENT_STATUSES };

// Default tuning constants — caller async truyền từ SystemSetting "student.*".
export const RENEWAL_WINDOW_DAYS = 90;
export const FREQUENT_ABSENT_THRESHOLD = 3;
export const FREQUENT_ABSENT_WINDOW = 5;

export type LifecycleView =
  | "all"
  | "active"
  | "vua-hoan-thanh"
  | "waiting"
  | "reserved"
  | "frequent-absent"
  | "renewal"
  | "withdrawn";

export const LIFECYCLE_VIEWS: LifecycleView[] = [
  "all",
  "active",
  "vua-hoan-thanh",
  "waiting",
  "reserved",
  "frequent-absent",
  "renewal",
  "withdrawn",
];

export const LIFECYCLE_VIEW_LABEL: Record<LifecycleView, string> = {
  all: "Tất cả",
  active: "Đang học",
  "vua-hoan-thanh": "Hoàn thành khoá",
  waiting: "Chờ xếp lớp",
  reserved: "Bảo lưu",
  "frequent-absent": "Vắng nhiều",
  renewal: "Tái tục",
  withdrawn: "Nghỉ học",
};

export const LIFECYCLE_VIEW_DESCRIPTION: Record<LifecycleView, string> = {
  all: "Tất cả học viên (active)",
  active: "Có ít nhất 1 lớp đang học",
  "vua-hoan-thanh":
    "Đã học xong khoá, chưa đăng ký khoá tiếp — gồm cả hồ sơ được đánh dấu “Hoàn thành” tay",
  waiting: "Chưa ngồi lớp nào: mới tạo hồ sơ, đã đăng ký chờ xếp lớp, hoặc vừa bị gỡ khỏi lớp",
  reserved: "Đang bảo lưu (tạm dừng học)",
  "frequent-absent": `Vắng ≥${FREQUENT_ABSENT_THRESHOLD} buổi trong ${FREQUENT_ABSENT_WINDOW} buổi gần nhất`,
  renewal: `Hoàn thành khoá cũ + đăng ký mới trong ${RENEWAL_WINDOW_DAYS} ngày`,
  withdrawn: "Đã nghỉ học hẳn",
};

/**
 * "VỪA HOÀN THÀNH KHOÁ" — một định nghĩa DUY NHẤT, dùng ở HAI chỗ: tab cùng tên (nhận
 * nhóm này) và tab "Chờ xếp lớp" (loại nhóm này ra). Viết rời hai bản là bảo đảm có
 * ngày chúng lệch nhau, và triệu chứng sẽ là **một em hiện ở cả hai tab** (tổng các tab
 * lớn hơn số học viên, Sale gọi điện hai lần cho cùng một người).
 *
 * KHÔNG kèm `status: "ACTIVE"` ở đây: tab "vua-hoan-thanh" tự thêm, còn tab "waiting"
 * đã có sẵn điều kiện đó — nhét vào mảnh dùng chung là nhánh `NOT` bên waiting hoá ra
 * cũng loại luôn theo `status`, tức loại nhầm.
 *
 * Ba vế, thiếu vế nào cũng sai:
 *   · CÓ ghi danh COMPLETED           — thật sự đã học xong, không phải bị gỡ khỏi lớp;
 *   · KHÔNG còn lớp đang học          — còn lớp thì em vẫn "Đang học";
 *   · KHÔNG có ghi danh chờ xếp lớp   — đã đăng ký khoá tiếp thì việc cần làm là XẾP LỚP,
 *                                       không phải gọi bán; em đó thuộc tab "Chờ xếp lớp".
 */
export const VUA_HOAN_THANH_WHERE: Prisma.StudentWhereInput = {
  AND: [
    { enrollments: { some: { status: "COMPLETED", deletedAt: null } } },
    {
      enrollments: {
        none: { status: { in: STUDYING_ENROLLMENT_STATUSES }, deletedAt: null },
      },
    },
    {
      enrollments: {
        none: { status: { in: ["PENDING", "CONFIRMED"] }, deletedAt: null },
      },
    },
  ],
};

/**
 * Build Prisma where clause for a lifecycle view.
 *
 * NOTE: "frequent-absent" returns a base filter only (ACTIVE students).
 * Caller MUST apply postFilterFrequentlyAbsent() on the returned IDs to
 * refine — the attendance-rate logic isn't expressible in pure SQL where.
 */
export function buildLifecycleWhere(
  view: LifecycleView,
  baseWhere: Prisma.StudentWhereInput = {},
  renewalWindowDays: number = RENEWAL_WINDOW_DAYS,
): Prisma.StudentWhereInput {
  const base: Prisma.StudentWhereInput = { ...baseWhere, deletedAt: null };

  switch (view) {
    case "all":
      return base;

    case "active":
      return {
        AND: [
          base,
          { status: "ACTIVE" },
          {
            enrollments: {
              some: { status: { in: STUDYING_ENROLLMENT_STATUSES }, deletedAt: null },
            },
          },
        ],
      };

    case "vua-hoan-thanh":
      // 22/09 — nguồn thứ TƯ của "không ngồi lớp nào", và là nguồn MỚI: bản vá
      // `completeClassAction` chuyển ghi danh sang COMPLETED khi đóng lớp, nên từ nay
      // có một nhóm học viên "đã học xong, chưa có lớp mới". Trước đó nhóm này không
      // tồn tại (hoàn thành lớp chưa bao giờ đụng tới ghi danh), nên tab "Chờ xếp lớp"
      // không được thiết kế cho họ và cái tên của nó không mô tả đúng họ.
      //
      // 24/09 — NHẬN THÊM NHÁNH (A). Chủ dự án xác nhận đã đánh dấu hoàn thành bằng CẢ
      // HAI đường: đặt tay `Student.status = GRADUATED` ở hồ sơ học viên, VÀ đổi ghi
      // danh sang COMPLETED ở /admin/enrollments. Bản đầu chỉ nhận nhánh sau ⇒ nhóm
      // GRADUATED rơi khỏi MỌI tab vận hành: `active`/`waiting` đòi `ACTIVE`,
      // `reserved` đòi `PAUSED`, `withdrawn` đòi `INACTIVE`. Họ chỉ còn thấy ở "Tất cả"
      // — tức người vận hành làm đúng thao tác mà kết quả là học viên biến mất.
      //
      // Nhánh (A) KHÔNG đòi thêm điều kiện nào: `GRADUATED` là quyết định tường minh
      // của người vận hành, không phải thứ để suy diễn lại. Đòi kèm "phải có ghi danh
      // COMPLETED" là loại đúng những hồ sơ cũ chưa từng có lịch sử ghi danh tử tế —
      // đo trên DB local: 5/16 em GRADUATED không có ghi danh COMPLETED nào.
      return {
        AND: [
          base,
          {
            OR: [
              // (A) đặt tay ở hồ sơ học viên.
              { status: "GRADUATED" },
              // (B) suy từ ghi danh — chỉ xét học viên còn ACTIVE.
              { AND: [{ status: "ACTIVE" }, VUA_HOAN_THANH_WHERE] },
            ],
          },
        ],
      };

    case "waiting":
      // "Chờ xếp lớp" = còn đang học ở trung tâm nhưng KHÔNG ngồi trong lớp nào.
      // Ba nguồn đổ vào tab này:
      //   1. học viên tạo tay, chưa có ghi danh nào;
      //   2. đã ghi danh PENDING/CONFIRMED, chờ giáo vụ xếp lớp;
      //   3. (21/08) vừa bị gỡ khỏi lớp ở /classes/[id]/students — mọi ghi danh đã về
      //      WITHDREW/CANCELLED nhưng học viên VẪN đang học ⇒ chờ xếp lớp lại.
      // Nhánh (1) nằm gọn trong nhánh (3): không có ghi danh nào thì cũng không có
      // ghi danh nào đang giữ chỗ.
      // (4) "vừa hoàn thành khoá" CỐ Ý bị loại — có tab riêng từ 22/09; xem NOT dưới.
      return {
        AND: [
          base,
          { status: "ACTIVE" },
          {
            enrollments: {
              none: { status: { in: STUDYING_ENROLLMENT_STATUSES }, deletedAt: null },
            },
          },
          // Không có vế này thì em vừa xong khoá khớp CẢ hai tab: `COMPLETED` không nằm
          // trong `IN_CLASS_ENROLLMENT_STATUSES` nên nhánh "none in-class" ngay dưới
          // nhận họ vào. Đếm đôi — ca [TTH-09] canh.
          { NOT: VUA_HOAN_THANH_WHERE },
          {
            OR: [
              {
                enrollments: {
                  none: {
                    status: { in: IN_CLASS_ENROLLMENT_STATUSES },
                    deletedAt: null,
                  },
                },
              },
              {
                enrollments: {
                  some: { status: { in: ["PENDING", "CONFIRMED"] }, deletedAt: null },
                },
              },
            ],
          },
        ],
      };

    case "reserved":
      return {
        AND: [
          base,
          {
            OR: [
              { status: "PAUSED" },
              { reserves: { some: { isActive: true } } },
            ],
          },
        ],
      };

    case "withdrawn":
      return { AND: [base, { status: "INACTIVE" }] };

    case "renewal": {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - renewalWindowDays);
      return {
        AND: [
          base,
          { enrollments: { some: { status: "COMPLETED", deletedAt: null } } },
          {
            enrollments: {
              some: {
                enrolledAt: { gte: cutoff },
                // Kèm legacy ACTIVE — ghi danh do convert lead sinh ra mang status này.
                status: { in: ["PENDING", "CONFIRMED", "STUDYING", "ACTIVE"] },
                deletedAt: null,
              },
            },
          },
        ],
      };
    }

    case "frequent-absent":
      // Pre-filter to ACTIVE students; final filter in JS.
      return { AND: [base, { status: "ACTIVE" }] };
  }
}

/**
 * Given a list of student IDs, return the subset that are "frequently absent".
 * Frequently absent = at least FREQUENT_ABSENT_THRESHOLD absences within
 * the latest FREQUENT_ABSENT_WINDOW attendance records.
 */
export async function postFilterFrequentlyAbsent(
  studentIds: string[],
  threshold?: number,
  window?: number,
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();

  // Đợt 3 — đọc động từ SystemSetting (default = hằng số nếu chưa cấu hình).
  const absentThreshold = threshold ?? (await getSetting("student.frequentAbsentThreshold"));
  const absentWindow = window ?? (await getSetting("student.frequentAbsentWindow"));

  // Generous limit to capture enough recent records per student. At the
  // current attendance volume this is single-digit MB at worst.
  const recentAttendance = await db.attendance.findMany({
    where: { studentId: { in: studentIds } },
    orderBy: [{ studentId: "asc" }, { createdAt: "desc" }],
    select: { studentId: true, status: true },
    take: studentIds.length * absentWindow * 3,
  });

  // Group by student, take latest N per student.
  const byStudent = new Map<string, string[]>();
  for (const a of recentAttendance) {
    if (!byStudent.has(a.studentId)) byStudent.set(a.studentId, []);
    const list = byStudent.get(a.studentId)!;
    if (list.length < absentWindow) list.push(a.status);
  }

  const result = new Set<string>();
  for (const [studentId, statuses] of byStudent.entries()) {
    if (statuses.length < absentWindow) continue;
    const absentCount = statuses.filter((s) => s === "ABSENT").length;
    if (absentCount >= absentThreshold) {
      result.add(studentId);
    }
  }
  return result;
}

/** Get the active reserve for a student (if any). */
export async function getActiveReserve(studentId: string) {
  return db.studentReserve.findFirst({
    where: { studentId, isActive: true },
    orderBy: { startedAt: "desc" },
    include: {
      enrollment: { select: { id: true, class: { select: { name: true } } } },
    },
  });
}
