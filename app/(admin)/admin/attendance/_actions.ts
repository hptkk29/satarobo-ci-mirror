"use server";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { docHocVienDaXepCaseO, docSoCaiDiemDanh, dongBoDongSauDiemDanh, giaoDichDiemDanh, xoaDiemDanhVaDongBoSoCai, type BanGhiDiemDanhDaLuu } from "@/lib/hoc-bu/dong-diem-danh";
import { evaluateAbsenceRisk } from "@/lib/risk/service";
import { getExistingAttendanceByStudent, getSessionRosterStudentIds } from "@/lib/attendance/roster";
import { doiHaDaBu, kiemLyDoKhongCanBu, laChonKhongCanBuMoi, laVangDiemDanh, makeupStatusSauKhiLuu } from "@/lib/hoc-bu/giu-da-bu";
import {
  notifyAttendanceForSession,
  notifyTeacherAttendanceEdited,
} from "@/lib/notify/attendance";
import { writeAudit } from "@/lib/audit/audit-log";
import { decideAttendanceWrite } from "@/lib/lms/attendance-edit-policy";
import { canManageSessionClass } from "@/app/(admin)/admin/sessions/[id]/_actions";

type ActionResult = { error?: string; saved?: number };

const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

const MAKEUP_STATUSES = ["NONE", "NEEDS_MAKEUP", "MADE_UP"] as const;

// Luật "vắng ⇒ cần bù; đã bù thì GIỮ" nằm ở MỘT chỗ: `makeupStatusSauKhiLuu` (lib/hoc-bu/giu-da-bu.ts) — 02/10/2026
// chủ dự án chốt "vắng có phép cũng cần học bù" (không còn lựa chọn "Không bù" lúc điểm danh: muốn bỏ thì Huỷ ở
// /admin/hoc-bu, bắt buộc lý do) và T02 (07/10) thêm: MADE_UP không đường lưu nào được hạ.
type MakeupStatus = (typeof MAKEUP_STATUSES)[number];

const recordSchema = z.object({
  studentId: z.string().min(1),
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().optional().nullable(),
  // PHẦN 2 — vắng có cấu trúc.
  makeupStatus: z.enum(MAKEUP_STATUSES).optional(),
  absenceReason: z.string().optional().nullable(),
  // Lý do "Không cần bù" — bắt buộc khi đây là lựa chọn MỚI (kiểm ở `markAttendance`, cùng luật với phía lưới).
  lyDoKhongCanBu: z.string().optional().nullable(),
});

const payloadSchema = z.object({
  sessionId: z.string().min(1),
  records: z.array(recordSchema),
});

async function requireTeacherOrAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const role = session.user.role;
  if (role !== "SUPER_ADMIN" && role !== "CENTER_MANAGER" && role !== "TEACHER") {
    throw new Error("Forbidden");
  }
  return session.user;
}

export async function markAttendance(
  sessionId: string,
  records: Array<{
    studentId: string;
    status: string;
    note?: string | null;
    makeupStatus?: string;
    absenceReason?: string | null;
  }>,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { error: "Chưa đăng nhập" };
  const user = session.user;

  const parsed = payloadSchema.safeParse({ sessionId, records });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const data = parsed.data;

  // Cách ly cơ sở (A0-04): ClassSession ∈ SCOPED_MODELS → đọc qua scopedDb;
  // findUnique trả null nếu buổi ngoài tầm nhìn cơ sở (CSKH CS1 KHÔNG thấy buổi CS2).
  // Attendance CHƯA scoped (SCOPE_EXEMPT chờ backfill) — scope tay qua classSession.class.
  const actor = await resolveActor(user.id);
  const sdb = scopedDb(actor);

  // select thêm centerId top-level: sdb.findUnique lọc hậu kỳ theo passesScope.
  const gateSess = await sdb.classSession.findUnique({
    where: { id: data.sessionId },
    select: {
      date: true,
      centerId: true,
      class: { select: { teacherId: true, assistantId: true, centerId: true } },
    },
  });
  if (!gateSess) return { error: "Buổi học không tồn tại" };

  const centerId = gateSess.class.centerId ?? gateSess.centerId ?? null;

  // Task #16 (Kiệt duyệt 07/07/2026, Phương án A) — phân quyền + cửa sổ hồi tố:
  //  • canManageSessionClass = GV chính/trợ giảng lớp mình (attendance:mark, LMS-1/W1-1),
  //    CENTER_MANAGER cùng cơ sở, SUPER_ADMIN → thao tác KHÔNG giới hạn thời gian
  //    (buổi chưa có bản ghi = ĐÁNH MỚI; buổi đã có = SỬA).
  //  • Còn lại chỉ qua attendance:edit theo cơ sở (CSKH SALES_CSM / Quản lý lớp học
  //    CENTER_CLASS_MANAGER) → chỉ SỬA/hồi tố trong 7 ngày; quá hạn phải nhờ quản lý cơ sở.
  const canManage = await canManageSessionClass(
    { id: user.id, role: user.role, centerId: user.centerId },
    gateSess.class,
  );
  const hasEditPermission = canManage
    ? true
    : await checkPermission("attendance:edit", { centerId });

  // Buổi đã có bản ghi điểm danh (đang SỬA) hay chưa (ĐÁNH MỚI)? — dùng làm snapshot audit.
  const beforeRows = await sdb.attendance.findMany({
    where: { sessionId: data.sessionId },
    select: { studentId: true, status: true, note: true, makeupStatus: true, absenceReason: true },
    orderBy: { studentId: "asc" },
  });

  const decision = decideAttendanceWrite({
    canManage,
    hasEditPermission,
    hasExistingAttendance: beforeRows.length > 0,
    sessionDate: gateSess.date,
  });
  if (!decision.ok) return { error: decision.message };

  // SEC-M02 (mirror teacher path): mỗi studentId PHẢI thuộc ROSTER hợp lệ của buổi
  // (enrolled active trong lớp ∪ học bù SCHEDULED, kể cả liên cơ sở). Attendance là
  // SCOPE_EXEMPT nên scopedDb KHÔNG chặn — thiếu check này là ghi được attendance
  // cho HV cơ sở khác rồi gửi thông báo thật tới phụ huynh.
  const rosterIds = await getSessionRosterStudentIds(actor, data.sessionId);
  if (data.records.some((r) => !rosterIds.has(r.studentId))) {
    return { error: "Có học viên không thuộc danh sách buổi này" };
  }

  // `makeupStatus` HIỆN CÓ của từng học viên — đọc bằng `db` trần (xem ghi chú ở getExistingAttendanceByStudent: đọc qua
  // scopedDb có thể ra RỖNG và bị hiểu là "chưa có gì" ⇒ ghi đè mất dấu đã bù). Quyền + roster đã xác minh ở trên.
  const cuBy = await getExistingAttendanceByStudent(
    data.sessionId,
    data.records.map((r) => r.studentId),
  );
  const makeupTheo = new Map<string, MakeupStatus>();
  const chonKhongCanBu: string[] = [];
  const moiKhongCanBu: (typeof data.records)[number][] = [];
  for (const r of data.records) {
    const cu = cuBy.get(r.studentId)?.makeupStatus as MakeupStatus | undefined;
    // Lưới mở từ trước lúc bù xong gửi lại giá trị cũ ⇒ từ chối cả lô, không lặng lẽ bỏ qua (nút nói dối).
    if (doiHaDaBu({ status: r.status, cu, guiLen: r.makeupStatus })) {
      return { error: "Có học viên đã học bù xong — tải lại trang rồi lưu lại (không đổi lại được ở lưới điểm danh)." };
    }
    // Nút "Không cần bù" của lưới gửi NONE cho buổi vắng — ở ĐÂY (chỉ lưới admin) mới là lựa chọn tường minh; các đường khác không có cờ này.
    const sau = makeupStatusSauKhiLuu({ status: r.status, cu, guiLen: r.makeupStatus, khongCanBu: r.makeupStatus === "NONE" });
    makeupTheo.set(r.studentId, sau);
    if (sau === "NONE" && laVangDiemDanh(r.status)) chonKhongCanBu.push(r.studentId);
    if (laChonKhongCanBuMoi({ status: r.status, cu, sau })) moiKhongCanBu.push(r);
  }
  // [22/10/2026 — chủ dự án siết] "Không cần bù" MỚI = quyết định của cấp quản lý cơ sở (cùng quyền `makeup:waive` với "Huỷ không bù" ở /hoc-bu) VÀ bắt buộc lý do.
  // Gác ở ĐÂY (server) chứ không chỉ ẩn nút: Server Action là endpoint riêng — nút ẩn mà action nhận thì ai gọi thẳng cũng bỏ qua được.
  if (moiKhongCanBu.length > 0) {
    if (!(await checkPermission("makeup:waive"))) {
      return { error: 'Chỉ Quản lý cơ sở / Admin được chọn "Không cần bù" — nhờ quản lý cơ sở, hoặc để "Cần học bù".' };
    }
    for (const r of moiKhongCanBu) {
      const sai = kiemLyDoKhongCanBu(r.lyDoKhongCanBu);
      if (sai) return { error: sai };
    }
  }
  // "Không cần bù" cho bé đã được XẾP vào case bù ⇒ từ chối cả lô, nói tên: dòng đã hẹn với phụ huynh không tự mất sau lưng người xếp.
  const daXepCase = await docHocVienDaXepCaseO(data.sessionId, chonKhongCanBu);
  if (daXepCase.length > 0) {
    return { error: `${daXepCase.join(", ")} đã được xếp vào buổi học bù — gỡ khỏi case ở màn Học bù trước rồi mới chọn "Không cần bù".` };
  }

  // Upsert each — composite unique key sessionId_studentId, trong MỘT giao dịch cùng với DÒNG CẦN BÙ sinh ra từ nó (T05): lỗi giữa
  // chừng rollback trọn lô, và điểm danh "cần bù" không bao giờ commit mà thiếu dòng (TV-08 — bản cũ tạo dòng SAU commit, lỗi bị
  // `console.error` nuốt). Giao dịch KHÔNG qua lọc cơ sở (học bù có thể liên cơ sở): quyền + roster đã kiểm ở trên.
  // Sổ cái quyền học (thu học phí theo phạm vi học): cờ đọc NGOÀI giao dịch; `null` = TẮT ⇒ đường điểm danh y nguyên, không thêm câu truy vấn nào trong giao dịch.
  const soCai = await docSoCaiDiemDanh({ centerId, actor: { id: user.id, name: user.name ?? user.email ?? user.id }, now: new Date() });
  try {
    await giaoDichDiemDanh(async (tx) => {
      const ghi: BanGhiDiemDanhDaLuu[] = [];
      for (const r of data.records) {
        const absent = r.status === "ABSENT" || r.status === "EXCUSED";
        // Có mặt → reset lý do vắng; makeupStatus theo `makeupStatusSauKhiLuu` (giữ MADE_UP).
        const makeupStatus: MakeupStatus = makeupTheo.get(r.studentId)!;
        const absenceReason = absent ? (r.absenceReason?.trim() || null) : null;
        const att = await tx.attendance.upsert({
          where: {
            sessionId_studentId: {
              sessionId: data.sessionId,
              studentId: r.studentId,
            },
          },
          create: {
            sessionId: data.sessionId,
            studentId: r.studentId,
            status: r.status as AttendanceStatus,
            note: r.note ?? null,
            makeupStatus,
            absenceReason,
            // #04 prep: denormalize centerId từ buổi/lớp để Attendance sẵn sàng flip
            // EXEMPT→SCOPED (record mới KHÔNG null → không bị ẩn nhầm sau flip).
            centerId,
          },
          update: {
            status: r.status as AttendanceStatus,
            note: r.note ?? null,
            makeupStatus,
            absenceReason,
          },
          select: { id: true },
        });
        ghi.push({
          studentId: r.studentId,
          attendanceId: att.id,
          status: r.status,
          makeupStatus,
          makeupStatusTruoc: cuBy.get(r.studentId)?.makeupStatus as MakeupStatus | undefined,
          // Lý do vắng đi vào ghi chú của dòng cần bù như trước T05 (`note: r.absenceReason`): GỬI LÊN, không phải giá trị đã chuẩn hoá.
          absenceReason: r.absenceReason ?? null,
          lyDoKhongCanBu: moiKhongCanBu.includes(r) ? (r.lyDoKhongCanBu ?? "").trim() : null,
        });
      }
      // B1 — vắng ⇒ dòng cần bù PENDING gắn buổi này (idempotent); quay lại CÓ MẶT ⇒ thu hồi dòng PENDING còn treo. Luật ở MỘT
      // chỗ: `dongBoDongSauDiemDanh` (site GV dùng chung) — xem ghi chú ở đó về vì sao CHỈ thu hồi khi có mặt.
      await dongBoDongSauDiemDanh(tx, { sessionId: data.sessionId, createdById: user.id, ghi, soCai });
    });
  } catch (err) {
    console.error("[markAttendance]", err);
    return { error: "Lỗi cơ sở dữ liệu — không lưu được điểm danh" };
  }

  // Task #16 — SỬA/hồi tố buổi ĐÃ điểm danh: ghi AuditLog (before/after) + báo GV
  // đứng lớp. "ĐÁNH MỚI" (mode=mark, buổi chưa có bản ghi) KHÔNG audit/notify.
  // Best-effort: lỗi audit/notify KHÔNG ảnh hưởng việc lưu điểm danh.
  if (decision.mode === "edit") {
    try {
      const afterRows = await sdb.attendance.findMany({
        where: { sessionId: data.sessionId },
        select: { studentId: true, status: true, note: true, makeupStatus: true, absenceReason: true },
        orderBy: { studentId: "asc" },
      });
      await writeAudit({
        actor: { id: user.id, name: user.name ?? user.email ?? user.id },
        module: "attendance",
        entityType: "ClassSession",
        entityId: data.sessionId,
        action: "attendance.edited",
        oldValues: { records: beforeRows },
        newValues: { records: afterRows },
        changedFields: ["attendance"],
        orgUnitId: null,
      });
    } catch (err) {
      console.error("[markAttendance] audit error:", err);
    }
    try {
      await notifyTeacherAttendanceEdited({
        sessionId: data.sessionId,
        editedByUserId: user.id,
        editedByName: user.name ?? user.email ?? null,
      });
    } catch (err) {
      console.error("[markAttendance] notify teacher error:", err);
    }
  }

  // B2 — đánh giá rủi ro (nghỉ 2 buổi liên tiếp) cho HV vừa bị đánh vắng.
  try {
    const absent = data.records.filter((r) => r.status === "ABSENT" || r.status === "EXCUSED");
    const sess = absent.length
      ? await sdb.classSession.findUnique({
          where: { id: data.sessionId },
          select: { classId: true, centerId: true }, // centerId cho passesScope hậu kỳ
        })
      : null;
    if (sess) {
      for (const r of absent) await evaluateAbsenceRisk(r.studentId, sess.classId);
    }
  } catch (err) {
    console.error("[markAttendance] risk error:", err);
  }

  // Commit 5 — thông báo điểm danh cho phụ huynh (email ngay; Zalo khi đã cấu hình).
  // Best-effort: lỗi gửi KHÔNG ảnh hưởng việc lưu điểm danh.
  try {
    await notifyAttendanceForSession(data.sessionId);
  } catch (err) {
    console.error("[markAttendance] notify error:", err);
  }

  revalidatePath("/attendance");
  revalidatePath(`/attendance?sessionId=${data.sessionId}`);
  revalidatePath("/hoc-bu");
  return { saved: data.records.length };
}

export async function deleteAttendance(id: string): Promise<ActionResult> {
  let user: Awaited<ReturnType<typeof requireTeacherOrAdmin>>;
  try {
    user = await requireTeacherOrAdmin();
  } catch {
    return { error: "Không có quyền" };
  }

  // Cách ly cơ sở: Attendance chưa scoped — scope tay qua session.class (dưới).
  const sdb = scopedDb(await resolveActor(user.id));

  // LMS-1 / W1-1 — owner-scope: chặn GV xoá điểm danh lớp không thuộc mình.
  const att = await sdb.attendance.findUnique({
    where: { id },
    select: {
      studentId: true,
      sessionId: true,
      session: { select: { class: { select: { teacherId: true, assistantId: true, centerId: true } } } },
    },
  });
  if (!att) return { error: "Không thể xoá bản ghi" };
  const allowed = await canManageSessionClass(
    { id: user.id, role: user.role, centerId: user.centerId },
    att.session.class,
  );
  if (!allowed) return { error: "Không có quyền với buổi của lớp này" };

  // T14: điểm danh gốc của một dòng cần bù không xoá cứng (liên kết SET NULL sẽ cắt dây giữa buổi vắng và buổi bù) — sửa trạng thái thay vì xoá.
  const chan = await kiemPhuThuocHocBu("DIEM_DANH", [id]);
  if (chan) return { error: chan };

  // Sổ cái quyền học: bản ghi "có mặt" mất thì dòng sổ cái của bài phải được huỷ cùng giao dịch. Cờ TẮT (`null`) ⇒ phép xoá cũ nguyên văn.
  const soCai = await docSoCaiDiemDanh({
    centerId: att.session.class.centerId,
    actor: { id: user.id, name: user.name ?? user.email ?? user.id },
    now: new Date(),
  });
  try {
    if (soCai === null) await sdb.attendance.delete({ where: { id } });
    else await xoaDiemDanhVaDongBoSoCai({ attendanceId: id, studentId: att.studentId, sessionId: att.sessionId, soCai });
  } catch {
    return { error: "Không thể xoá bản ghi" };
  }
  revalidatePath("/attendance");
  return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// 21/08 — "Hoàn tất buổi" bấm thẳng từ danh sách buổi của lớp ở màn điểm danh.
//
// 07/09 (D1) — LUẬT ĐÃ DỜI sang `lib/lms/chot-buoi.ts` để site giáo viên dùng CHUNG
// đúng một cổng. Đọc các quyết định có chủ đích (không qua SESSION_LIFECYCLE_V2,
// assignMode gim "DEFER") ở đầu file đó. Ở đây chỉ còn xác thực + revalidate.
import { chotBuoi, type ChotBuoiKetQua } from "@/lib/lms/chot-buoi";
import { kiemPhuThuocHocBu } from "@/lib/hoc-bu/phu-thuoc";
import { getAuditActor } from "@/lib/audit/log";

export type CompleteAttendanceSessionResult = ChotBuoiKetQua;

export async function completeAttendanceSessionAction(
  sessionId: string,
): Promise<CompleteAttendanceSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };

  const { actorId, actorName } = getAuditActor(session);
  const res = await chotBuoi({
    sessionId,
    actorUserId: session.user.id,
    actorId,
    actorName,
    phamVi: "quan-tri",
  });
  if (!res.ok) return res;

  revalidatePath("/attendance");
  if (res.classId) revalidatePath(`/classes/${res.classId}`);
  revalidatePath(`/sessions/${sessionId}`);
  return res;
}
