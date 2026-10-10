// app/(teacher)/teacher/lop/_actions.ts — #06 (L6, câu 50): điểm danh 6 nhãn lớp GV.
//
// BẢO MẬT 2 lớp chống IDOR:
//   (1) withMakeupException(actorGiangDay(actor)) nạp buổi — ClassSession ∈ MAKEUP_EXCEPTION_MODELS
//       nên GV dạy bù LIÊN cơ sở nạp được buổi ở cơ sở khác (câu 47);
//   (2) isSessionOwnedByTeacher gác quyền sở hữu thật (lớp mình / dạy thay / thực dạy).
//   (3) checkPermission("attendance:mark") — role có được điểm danh không (CLASS scope v2).
// KHÔNG import @/lib/db trần (ESLint chặn app/(teacher)/**); write đi qua client mở rộng
// (extension chỉ can thiệp READ — upsert đi thẳng). ⚠️ Câu 46: KHÔNG đọc/gửi contact PH.
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AttendanceStatus, type MakeupStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import {
  checkPermission,
  decidePermissionWithGrant,
} from "@/lib/auth/check-permission";
import { actorGiangDay, withMakeupException } from "@/lib/db-scope";
import {
  getExistingAttendanceByStudent,
  getSessionRosterStudentIds,
} from "@/lib/attendance/roster";
import { isSessionOwnedByTeacher } from "@/lib/lms/session-ownership";
import { chotBuoi, type ChotBuoiKetQua } from "@/lib/lms/chot-buoi";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import {
  createMakeupNeed,
  cancelPendingMakeupNeed,
} from "@/lib/makeup/service";
import { notifyAttendanceForSession } from "@/lib/notify/attendance";
import { evaluateAbsenceRisk } from "@/lib/risk/service";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import { completeSession } from "@/lib/lms/session-lifecycle";
import { quyetDinhTuHoanTat } from "@/lib/lms/tu-hoan-tat-buoi";
import { rosterWhere } from "@/lib/enrollment-scope";
import { doiHaDaBu, makeupStatusSauKhiLuu } from "@/lib/hoc-bu/giu-da-bu";
import { vnDateOnly } from "@/lib/time/vn";

const MAKEUP_STATUSES = ["NONE", "NEEDS_MAKEUP", "MADE_UP"] as const;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh (UTC+7, không DST)

/** Mốc hết ngày hôm nay (giờ VN) dạng UTC — buổi có date SAU mốc này là buổi tương lai. */
function vnTodayEnd(now = new Date()): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const startUtc =
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) -
    VN_OFFSET_MS;
  return new Date(startUtc + 24 * 60 * 60 * 1000);
}

const recordSchema = z.object({
  studentId: z.string().min(1),
  // Nhận đủ 6 giá trị enum (forward-compat với 2-phase R7-08); component 6 nhãn của
  // Kiệt gửi 1 trong 4 status markable (PRESENT/LATE/ABSENT_EXCUSED/ABSENT_UNEXCUSED).
  status: z.nativeEnum(AttendanceStatus),
  note: z.string().trim().max(500).optional().nullable(),
  makeupStatus: z.enum(MAKEUP_STATUSES).optional(),
  absenceReason: z.string().trim().max(500).optional().nullable(),
});
const payloadSchema = z.object({
  sessionId: z.string().min(1),
  records: z.array(recordSchema).min(1).max(100),
});

type SaveResult = { ok: true; saved: number } | { ok: false; error: string };

/** PRESENT/LATE = có mặt; còn lại = vắng (được mang makeupStatus/lý do). */
function isAbsent(status: AttendanceStatus): boolean {
  return status !== "PRESENT" && status !== "LATE";
}

export async function saveClassAttendanceAction(
  sessionId: string,
  records: Array<{
    studentId: string;
    status: string;
    note?: string | null;
    makeupStatus?: string;
    absenceReason?: string | null;
  }>,
): Promise<SaveResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = payloadSchema.safeParse({ sessionId, records });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const data = parsed.data;

  const actor = await resolveActor(session.user.id);
  const xdb = withMakeupException(actorGiangDay(actor));

  // (1) Nạp buổi — bypass cơ sở để buổi dạy bù liên cơ sở nạp được; centerId select để
  // denormalize vào Attendance (∈ SCOPED_MODELS sau #04 — record mới không null).
  const sess = await xdb.classSession.findUnique({
    where: { id: data.sessionId },
    select: {
      id: true,
      classId: true,
      centerId: true,
      date: true,
      // `status`: quyết định tự-hoàn-tất ở cuối hàm (xem khối #TU-HOAN-TAT).
      status: true,
      substituteTeacherId: true,
      actualTeacherId: true,
      class: { select: { centerId: true } },
    },
  });
  if (!sess) return { ok: false, error: "Buổi không thuộc bạn" };

  // Server chốt (cùng gate vnTodayEnd với UI /teacher/lop + hub-sessions-tab):
  // KHÔNG cho điểm danh buổi CHƯA diễn ra — chặn ghi attendance trước + gửi
  // thông báo PH cho buổi tương lai.
  if (sess.date.getTime() > vnTodayEnd().getTime()) {
    return {
      ok: false,
      error: "Buổi học chưa diễn ra — không thể điểm danh trước",
    };
  }

  // (2) Quyền sở hữu THẬT — chống GV điểm danh lớp không phân công.
  const owned = isSessionOwnedByTeacher(
    {
      classId: sess.classId,
      substituteTeacherId: sess.substituteTeacherId,
      actualTeacherId: sess.actualTeacherId,
    },
    { userId: session.user.id, assignedClassIds: actor.assignedClassIds },
  );
  if (!owned) return { ok: false, error: "Buổi không thuộc bạn" };

  const centerId = sess.class.centerId ?? sess.centerId ?? null;

  // (3) Role có quyền điểm danh không (CLASS scope — seed TEACHER:attendance:mark[CLASS]).
  //
  // ⚠️ 19/08 — GV DẠY THAY. Bước (2) đã chứng minh buổi thuộc về người này qua
  // `substituteTeacherId`/`actualTeacherId`, nhưng `actor.assignedClassIds` chỉ nạp từ
  // `Class.teacherId/assistantId` (lib/auth/actor.ts:443-446) nên scope CLASS KHÔNG khớp:
  // trên PROD (RBAC_V2_ENABLED=true) GV dạy thay bấm Lưu là ăn "Không có quyền điểm danh
  // lớp này" và điểm danh không bao giờ vào DB — quản lý đọc thành "GV chưa điểm danh".
  // Local/CI chạy v1 nên KHÔNG tái hiện được; đừng tin kết quả thử ở máy.
  //
  // Vá bằng cách đưa ĐÚNG lớp vừa được chứng minh sở hữu vào bản sao actor CHỈ cho lần
  // kiểm này, rồi vẫn đi qua nguyên pipeline quyền (grant mới → v1/v2 → cờ). KHÔNG nới
  // `assignedClassIds` ở lib/auth/actor.ts: tập đó còn nuôi SCORM (lib/auth/lms-scope),
  // học bạ (lib/lms/report-card-core) và chat DM với phụ huynh (lib/chat/dm) — nới ở đó
  // là GV dạy thay 1 buổi tự nhiên có luôn học bạ và hộp chat của cả lớp.
  const target = { classId: sess.classId, centerId };
  const allowed =
    (await checkPermission("attendance:mark", target)) ||
    // Nhánh GV dạy thay: chỉ chạy khi lớp KHÔNG nằm trong assignedClassIds (tức cổng trên
    // vừa trượt đúng vì lý do này). Vẫn là cùng một pipeline quyền, chỉ khác ở chỗ actor
    // được bổ sung đúng lớp mà bước (2) đã chứng minh là của người này.
    (!actor.assignedClassIds.has(sess.classId) &&
      decidePermissionWithGrant({
        sessionUser: session.user,
        actor: {
          ...actor,
          assignedClassIds: new Set([...actor.assignedClassIds, sess.classId]),
        },
        action: "attendance:mark",
        target,
      }));
  if (!allowed) return { ok: false, error: "Không có quyền điểm danh lớp này" };

  // (4) SEC-M02: mỗi studentId từ client PHẢI thuộc ROSTER hợp lệ của buổi (enrolled active
  // trong lớp ∪ học bù SCHEDULED, kể cả liên cơ sở) — chống ghi attendance giả cho HV
  // lớp/cơ sở khác rồi gửi thông báo giả tới phụ huynh. Tái dùng roster hiển thị (không lệch).
  const rosterIds = await getSessionRosterStudentIds(actor, data.sessionId);
  if (data.records.some((r) => !rosterIds.has(r.studentId))) {
    return { ok: false, error: "Có học viên không thuộc danh sách buổi này" };
  }

  // 19/08 — đọc bản ghi ĐANG CÓ trước khi ghi đè.
  //
  // Bản cũ tính lại makeupStatus/absenceReason từ payload rồi ghi thẳng vào nhánh
  // `update`. Panel điểm danh của site GV chỉ gửi {studentId, status, note} — không gửi
  // makeupStatus, không gửi absenceReason — nên MỖI lần GV mở buổi cũ bấm Lưu lại là:
  //   • học viên đã HỌC BÙ XONG (MADE_UP) tụt về NEEDS_MAKEUP ⇒ hiện lại ở /admin/hoc-bu
  //     như chưa bù, và % chuyên cần / học bạ tính theo đó cũng sai;
  //   • lý do phụ huynh xin nghỉ bị xoá trắng.
  //
  // ⚠️ Đọc bằng helper dùng `db` TRẦN, KHÔNG bằng `xdb`: Attendance là model SCOPED và
  // KHÔNG nằm trong danh sách ngoại lệ học bù, nên `xdb` vẫn chèn lọc cơ sở — GV dạy thay
  // ở cơ sở khác sẽ đọc ra rỗng và hai luật giữ dữ liệu bên dưới không bao giờ chạy.
  const existingBy = await getExistingAttendanceByStudent(
    data.sessionId,
    data.records.map((r) => r.studentId),
  );

  // Client đòi hạ một buổi vắng ĐÃ BÙ (tab cũ mở trước lúc bù xong) ⇒ từ chối cả lô, bảo tải lại (T02, HB-05/HB-40).
  const doiHa = data.records.find((r) =>
    doiHaDaBu({ status: r.status, cu: existingBy.get(r.studentId)?.makeupStatus as MakeupStatus | undefined, guiLen: r.makeupStatus }),
  );
  if (doiHa) {
    return { ok: false, error: "Có học viên đã học bù xong — tải lại trang rồi lưu lại (không đổi lại được ở màn điểm danh)." };
  }

  /**
   * Trạng thái bù HIỆU LỰC sau lần lưu này — MỘT chỗ duy nhất: `makeupStatusSauKhiLuu` (lib/hoc-bu/giu-da-bu.ts).
   * MADE_UP do module học bù đặt nên KHÔNG đường lưu điểm danh nào được hạ nó, kể cả khi học viên nay ghi "có mặt".
   * Panel GV chỉ gửi {studentId, status, note}: bản cũ coi "không gửi" là "NONE" và xoá dấu đã bù của cả lớp.
   */
  const plans = data.records.map((r) => {
    const absent = isAbsent(r.status);
    const old = existingBy.get(r.studentId);
    const makeupStatus: MakeupStatus = makeupStatusSauKhiLuu({
      status: r.status,
      cu: old?.makeupStatus as MakeupStatus | undefined,
      guiLen: r.makeupStatus,
    });
    const absenceReason = !absent
      ? null
      : r.absenceReason !== undefined
        ? r.absenceReason?.trim() || null
        : (old?.absenceReason ?? null);
    return { r, makeupStatus, absenceReason };
  });

  // Write — upsert theo khoá composite sessionId_studentId; $transaction để lỗi giữa
  // chừng rollback trọn lô (GV bấm Lưu 1 lần cho cả lớp).
  try {
    await xdb.$transaction(
      plans.map(({ r, makeupStatus, absenceReason }) => {
        return xdb.attendance.upsert({
          where: {
            sessionId_studentId: {
              sessionId: data.sessionId,
              studentId: r.studentId,
            },
          },
          create: {
            sessionId: data.sessionId,
            studentId: r.studentId,
            status: r.status,
            note: r.note ?? null,
            makeupStatus,
            absenceReason,
            centerId,
          },
          update: {
            status: r.status,
            note: r.note ?? null,
            makeupStatus,
            absenceReason,
          },
        });
      }),
    );
  } catch (err) {
    console.error("[saveClassAttendanceAction]", err);
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không lưu được điểm danh" };
  }

  const { actorId, actorName } = getAuditActor(session);

  // Học bù: HV vắng-không-phép (hoặc component đánh NEEDS_MAKEUP) → MakeupNeed PENDING
  // (idempotent trong service — 1 nhu cầu/buổi/HV). câu 47: học bù có thể liên cơ sở.
  // Chiều ngược: sửa vắng → CÓ MẶT (PRESENT/LATE) → thu hồi MakeupNeed PENDING còn
  // treo của (HV, buổi này) — không để nhu cầu bù ma nằm ở /admin/hoc-bu.
  //
  // ⚠️ CHỈ thu hồi khi HV quay lại CÓ MẶT. ĐỪNG mở rộng sang "mọi trạng thái không cần bù"
  // — bản thử 19/08 làm thế và hoá ra huỷ luôn suất bù của HV vắng CÓ PHÉP: nhu cầu bù của
  // họ do phiếu xin nghỉ đã duyệt (/admin/parent-requests) hoặc do quản lý tạo tay sinh ra,
  // trong khi deriveMakeup("ABSENT_EXCUSED") từng = NONE (tới 02/10) ⇒ mỗi lần GV bấm Lưu là xoá mất quyền
  // lợi của học viên. Nhu cầu mồ côi (đổi vắng-không-phép → vắng-có-phép) thà để người ở
  // /admin/hoc-bu quyết định. MADE_UP: không đụng — nhu cầu đã hoàn tất.
  try {
    // Song song CÓ TRẦN — mỗi HV một lượt độc lập; nối đuôi thì GV bấm Lưu phải chờ hết
    // 20 vòng truy vấn mới thấy phản hồi.
    await mapWithConcurrency(
      plans,
      5,
      async ({ r, makeupStatus, absenceReason }) => {
        if (makeupStatus === "NEEDS_MAKEUP") {
          await createMakeupNeed({
            studentId: r.studentId,
            missedSessionId: data.sessionId,
            createdById: actorId,
            note: absenceReason,
            // Chuyển trạng thái THẬT: trước lần lưu này HV chưa ở diện cần bù. Lưu lại một
            // buổi vốn đã NEEDS_MAKEUP thì không dựng dậy nhu cầu mà quản lý vừa huỷ tay.
            reviveCancelled:
              existingBy.get(r.studentId)?.makeupStatus !== "NEEDS_MAKEUP",
          });
        } else if (!isAbsent(r.status)) {
          await cancelPendingMakeupNeed({
            studentId: r.studentId,
            missedSessionId: data.sessionId,
          });
        }
      },
    );
  } catch (err) {
    console.error("[saveClassAttendanceAction] makeup:", err);
  }

  // Rủi ro "vắng 2 buổi liên tiếp" — trước đây CHỈ đường admin gọi, làm điểm danh
  // từ site GV (đường chính) không bao giờ tạo StudentRiskAlert/CareTask. Best-effort:
  // .catch để không chặn luồng lưu.
  try {
    await mapWithConcurrency(
      data.records.filter((r) => isAbsent(r.status)),
      5,
      (r) =>
        evaluateAbsenceRisk(r.studentId, sess.classId).catch((err) =>
          console.error("[saveClassAttendanceAction] risk:", err),
        ),
    );
  } catch (err) {
    console.error("[saveClassAttendanceAction] risk:", err);
  }

  // Audit 1 dòng cho cả buổi (best-effort — không chặn việc lưu).
  try {
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "attendance",
      entityType: "ClassSession",
      entityId: data.sessionId,
      action: "attendance.marked",
      newValues: { count: data.records.length },
    });
  } catch (err) {
    console.error("[saveClassAttendanceAction] audit:", err);
  }

  // #TU-HOAN-TAT (04/09/2026) — ĐIỂM DANH ĐỦ LÀ BUỔI XONG, không còn nút riêng.
  //
  // Chủ dự án: "mở khoá hoàn thành buổi: chỉ cần điểm danh". Cổng của
  // `completeSession` vốn đã không chặn (thiếu điểm danh chỉ cảnh báo) — cái thiếu là
  // KHÔNG AI BẤM. Đo 04/09 trên DB test: 524 buổi đã qua ngày mà chỉ 486 buổi
  // COMPLETED, nên mọi màn đếm theo `status` đọc hụt so với màn đếm theo ngày.
  //
  // Best-effort: điểm danh ĐÃ lưu rồi, đóng buổi hỏng không được biến thành
  // "không lưu được điểm danh" trước mắt giáo viên.
  try {
    // Lấy DANH SÁCH studentId, không phải số đếm (08/09/2026). Học viên HỌC BÙ từ lớp
    // khác cũng sinh dòng `Attendance` cho buổi này, nên đếm thô sẽ bù chỗ cho một em
    // trong sĩ số chưa được đánh dấu — xem `quyetDinhTuHoanTat`.
    const [siSoRows, daDanhDauRows] = await Promise.all([
      xdb.enrollment.findMany({
        where: { classId: sess.classId, ...rosterWhere("dang-hoc") },
        select: { studentId: true },
      }),
      xdb.attendance.findMany({
        where: { sessionId: data.sessionId },
        select: { studentId: true },
      }),
    ]);
    const qd = quyetDinhTuHoanTat({
      trangThaiBuoi: sess.status,
      ngayBuoi: sess.date,
      homNayUtcMs: vnDateOnly(new Date()).getTime(),
      siSoStudentIds: siSoRows.map((r) => r.studentId),
      daDanhDauStudentIds: daDanhDauRows.map((r) => r.studentId),
    });
    if (qd.tuHoanTat) {
      // Đi qua `completeSession` chứ KHÔNG `update({status})` trần: hàm đó còn ghi
      // audit, ghi người/giờ thực dạy và phát `session.taught` (R7-14 nghe để tự giao
      // bài). Bỏ qua chúng là buổi đóng mà bài tập không bao giờ được giao.
      await completeSession({
        sessionId: data.sessionId,
        // Điểm danh vừa lưu xong nên cảnh báo "chưa điểm danh" không thể xảy ra;
        // cờ này chỉ để khỏi phải đi một vòng hỏi-đáp không ai trả lời được.
        confirmNoAttendance: true,
        // DEFER — khớp nút chốt tay (`lib/lms/chot-buoi.ts`). Đóng buổi ở đây là chốt
        // điểm danh, KHÔNG phải giao bài: để "NOW" thì lượt lưu điểm danh im lặng biến
        // thành đường giao bài tập + gửi tin "Bài tập mới" cho phụ huynh. Trước 08/09
        // chỗ này KHÔNG truyền gì và rơi về mặc định "NOW" — xem chú thích ở chữ ký
        // `completeSession`.
        assignMode: "DEFER",
        // ĐÂY là đường tự đóng: không ai bấm nút, cổng nổ trong lượt lưu điểm danh.
        // `actorId` dưới đây là GIÁO VIÊN VỪA LƯU ĐIỂM DANH, không phải người bấm chốt —
        // đó chính là lý do `completedById` không phân biệt được hai đường.
        nguonChot: "TU_DONG",
        actorId,
        actorName,
      });
    }
  } catch (err) {
    // ── HỎNG PHẢI ĐỂ LẠI DẤU (07/09/2026) ────────────────────────────────────────
    //
    // Giữ best-effort: điểm danh ĐÃ lưu rồi, đóng buổi hỏng không được biến thành
    // "không lưu được điểm danh" trước mắt giáo viên.
    //
    // NHƯNG từ chốt 07/09 ("một luật, không hai") đây là ĐƯỜNG ĐÓNG BUỔI CHÍNH, nên
    // nuốt lỗi vào `console.error` là mất hẳn dấu vết: log của Vercel xoay vòng và
    // không ai tra được "tháng này đóng buổi hỏng bao nhiêu lần". Ghi thêm một dòng
    // AuditLog để câu hỏi đó trả lời được bằng SQL.
    //
    // Bản thân việc ghi audit cũng best-effort — hỏng ở đây tuyệt đối không được làm
    // hỏng lượt lưu điểm danh.
    console.error("[saveClassAttendanceAction] tu hoan tat:", err);
    try {
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "attendance",
        entityType: "ClassSession",
        entityId: data.sessionId,
        action: "session.auto-complete.failed",
        newValues: { error: err instanceof Error ? err.message : String(err) },
      });
    } catch (err2) {
      console.error("[saveClassAttendanceAction] audit tu hoan tat:", err2);
    }
  }

  // Thông báo điểm danh cho phụ huynh (email; Zalo khi cấu hình) — best-effort.
  try {
    await notifyAttendanceForSession(data.sessionId);
  } catch (err) {
    console.error("[saveClassAttendanceAction] notify:", err);
  }

  revalidatePath("/lop");
  revalidatePath("/teacher/lop");
  return { ok: true, saved: data.records.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// D1 (07/09/2026) — CHỐT BUỔI từ site giáo viên.
//
// Trước hôm nay chỉ màn admin `/attendance` có nút này, mà `decideRoute` đá giáo
// viên thuần khỏi host admin và `attendance` không nằm trong TEACHER_ROUTE_SEGMENTS
// ⇒ người thực sự dạy buổi không có đường nào bấm. Prod 07/09: 2 COMPLETED / 287
// SCHEDULED trong 4 tháng.
//
// KHÔNG khoét route-policy và KHÔNG nới permission: nút mọc ở trang GV VỐN ĐÃ VÀO
// ĐƯỢC (`/teacher/lop`, tab Điểm danh), và cổng sở hữu của `chotBuoi` vốn đã cho
// phép "GV phụ trách đúng lớp" từ ngày viết ra.
//
// Luật nằm ở `lib/lms/chot-buoi.ts` — dùng CHUNG với admin. Ở đây chỉ còn xác thực
// + revalidate đúng đường của site GV.
export async function chotBuoiAction(
  sessionId: string,
): Promise<ChotBuoiKetQua> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };

  const { actorId, actorName } = getAuditActor(session);
  const res = await chotBuoi({
    sessionId,
    actorUserId: session.user.id,
    actorId,
    actorName,
    phamVi: "giang-day",
  });
  if (!res.ok) return res;

  revalidatePath("/teacher/lop");
  revalidatePath("/teacher/lich");
  revalidatePath("/teacher");
  return res;
}
