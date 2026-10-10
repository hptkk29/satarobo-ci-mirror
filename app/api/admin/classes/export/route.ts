import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { EnrollmentStatus, SessionStatus } from "@prisma/client";
import { requireLiveSession } from "@/lib/auth/live-session";
import {
  canViewLeadPii,
  checkPermission,
  checkPermissionDetail,
} from "@/lib/auth/check-permission";
import { chanXuatVai } from "@/lib/export/chan-xuat";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { exportWatermark } from "@/lib/export/watermark";
import { maskPhone } from "@/lib/utils";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { buildSessionNumberMap } from "@/lib/lms/session-order";
import {
  CLASS_STATUS_LABEL,
  buildClassOrderBy,
  buildClassWhere,
  matchesFill,
  parseClassListFilters,
} from "@/lib/classes/list-filter";
import { parseClassExportOptions } from "@/lib/classes/class-export-options";
import {
  buildClassExportWorkbook,
  type ExportClassRow,
  type ExportRosterRow,
  type ExportSessionRow,
} from "@/lib/classes/class-export";

const ENROLLMENT_LABEL: Record<EnrollmentStatus, string> = {
  ACTIVE: "Đang học",
  STUDYING: "Đang học",
  CONFIRMED: "Đã xếp lớp",
  PENDING: "Chờ xác nhận",
  PAUSED: "Bảo lưu",
  COMPLETED: "Hoàn thành",
  WITHDREW: "Nghỉ học",
  TRANSFERRED: "Chuyển lớp",
  CANCELLED: "Huỷ",
};

const SESSION_LABEL: Record<SessionStatus, string> = {
  SCHEDULED: "Chưa dạy",
  IN_PROGRESS: "Đang dạy",
  COMPLETED: "Đã dạy",
  CANCELLED: "Huỷ",
};

/** Trần số lớp một lần xuất — chặn một cú bấm kéo cả DB (lớp × học viên × buổi). */
const MAX_CLASSES = 1000;

export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Cùng cổng với màn danh sách `/classes` — ai xem được danh sách thì xuất được đúng
  // những lớp mình đang thấy (scopedDb cắt theo cơ sở; view-own ép về lớp của chính họ).
  const hasViewAll = await checkPermission("classes:view-all");
  const hasViewOwn = await checkPermission("classes:view-own");
  const hasFeedback = await checkPermission("session-feedback:view-all");
  if (!hasViewAll && !hasViewOwn && !hasFeedback) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Cổng VAI (chốt 27/09/2026) — Cấu hình vận hành → Quyền xuất dữ liệu. `chanXuatVai` vì
  // cổng đọc ở đây PHỨC HỢP (ba quyền, một trong ba là đủ) nên danh mục khai `quyenGoc: null`
  // và route giữ phép kiểm ngay trên.
  const chan = await chanXuatVai("lop-hoc", session);
  if (chan) return chan;

  const sp = req.nextUrl.searchParams;
  const parsed = parseClassExportOptions(sp);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Tuỳ chọn không hợp lệ" },
      { status: 400 },
    );
  }
  const options = parsed.data;
  const filters = parseClassListFilters(Object.fromEntries(sp));

  // Liên hệ phụ huynh — ba điều kiện, thiếu một là KHÔNG có cột:
  //   · người dùng tự chọn kèm;
  //   · có quyền xem danh sách học viên (GV chỉ-lớp-mình không có — canViewParentContact
  //     vốn chặn TEACHER);
  //   · SĐT hiện đầy đủ hay che: cùng luật màn /students (quyền PII và không bị DENY cấp
  //     trường) — ở đây thiếu PII thì CHE chứ không bỏ cột.
  const wantsRoster = options.sheets.includes("hocvien");
  const includeParentContact =
    wantsRoster &&
    options.parentContact &&
    (await checkPermission("students:view-all"));
  let phoneFull = false;
  if (includeParentContact) {
    const { fieldMask } = await checkPermissionDetail("students:view-all");
    phoneFull = (await canViewLeadPii()) && !fieldMask.includes("parentPhone");
  }

  const actor = await resolveActor(session.user.id);
  const where = buildClassWhere(filters, {
    forceTeacherId: !hasViewAll && hasViewOwn ? session.user.id : null,
  });
  const wantsSessions = options.sheets.includes("buoi");

  const rows = await scopedDb(actor).class.findMany({
    where,
    orderBy: buildClassOrderBy(filters.sort),
    take: MAX_CLASSES + 1,
    select: {
      id: true,
      classCode: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      scheduleDays: true,
      startTime: true,
      endTime: true,
      maxStudents: true,
      notes: true,
      course: { select: { name: true } },
      center: { select: { name: true } },
      room: { select: { code: true } },
      teacher: { select: { name: true } },
      assistant: { select: { name: true } },
      scheduleSlots: {
        select: { weekday: true, startTime: true, endTime: true },
      },
      _count: {
        select: {
          enrollments: {
            where: {
              status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
              deletedAt: null,
            },
          },
        },
      },
      sessions: {
        select: {
          id: true,
          date: true,
          status: true,
          topic: true,
          rosterSize: true,
          room: { select: { code: true } },
        },
        orderBy: { date: "asc" },
      },
      // Luôn khai `enrollments` (khai có điều kiện làm Prisma mất kiểu); không cần sheet
      // học viên thì `take: 0` — không tải dòng nào.
      enrollments: {
        ...(wantsRoster ? {} : { take: 0 }),
        where: {
          deletedAt: null,
          ...(options.rosterScope === "dang-hoc"
            ? { status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } }
            : {}),
          student: { deletedAt: null },
        },
        orderBy: { student: { name: "asc" } },
        select: {
          status: true,
          enrolledAt: true,
          sale: { select: { name: true } },
          student: {
            select: {
              studentCode: true,
              name: true,
              dateOfBirth: true,
              parentName: includeParentContact,
              parentPhone: includeParentContact,
            },
          },
        },
      },
    },
  });

  if (rows.length > MAX_CLASSES) {
    return NextResponse.json(
      { error: `Quá ${MAX_CLASSES} lớp — hãy lọc hẹp lại rồi xuất.` },
      { status: 400 },
    );
  }

  const visible = rows.filter((c) =>
    matchesFill(c._count.enrollments, c.maxStudents, filters.fill),
  );

  const classes: ExportClassRow[] = visible.map((c) => ({
    id: c.id,
    classCode: c.classCode,
    name: c.name,
    course: c.course?.name ?? null,
    center: c.center?.name ?? null,
    room: c.room?.code ?? null,
    scheduleDays: c.scheduleDays ?? [],
    startTime: c.startTime,
    endTime: c.endTime,
    slots: c.scheduleSlots,
    teacher: c.teacher?.name ?? null,
    assistant: c.assistant?.name ?? null,
    enrolled: c._count.enrollments,
    maxStudents: c.maxStudents,
    startDate: c.startDate,
    endDate: c.endDate,
    statusLabel: CLASS_STATUS_LABEL[c.status] ?? c.status,
    sessionsDone: c.sessions.filter((s) => s.status === "COMPLETED").length,
    sessionsTotal: c.sessions.filter((s) => s.status !== "CANCELLED").length,
    notes: c.notes,
  }));

  const roster: ExportRosterRow[] = wantsRoster
    ? visible.flatMap((c) =>
        c.enrollments.map((e) => {
          const phone = e.student.parentPhone ?? null;
          return {
            classId: c.id,
            studentCode: e.student.studentCode,
            studentName: e.student.name,
            dateOfBirth: e.student.dateOfBirth,
            statusLabel: ENROLLMENT_LABEL[e.status] ?? e.status,
            enrolledAt: e.enrolledAt,
            sale: e.sale?.name ?? null,
            parentName: e.student.parentName ?? null,
            parentPhone: phone && !phoneFull ? maskPhone(phone) : phone,
          };
        }),
      )
    : [];

  const now = new Date();
  const sessions: ExportSessionRow[] = wantsSessions
    ? visible.flatMap((c) => {
        // Đánh số trên ĐỦ buổi của lớp rồi mới lọc — lọc trước thì "Buổi 1" của phần
        // sắp tới là buổi thứ 9 thật (buildSessionNumberMap cần đủ buổi).
        const num = buildSessionNumberMap(
          c.sessions
            .filter((s) => s.status !== "CANCELLED")
            .map((s) => ({ id: s.id, classId: c.id, date: s.date })),
        );
        return c.sessions
          .filter((s) =>
            options.sessionScope === "da-day"
              ? s.status === "COMPLETED"
              : options.sessionScope === "sap-toi"
                ? s.status !== "COMPLETED" &&
                  s.status !== "CANCELLED" &&
                  s.date >= now
                : true,
          )
          .map((s) => ({
            classId: c.id,
            index: num.get(s.id) ?? 0,
            date: s.date,
            statusLabel: SESSION_LABEL[s.status] ?? s.status,
            topic: s.topic,
            room: s.room?.code ?? null,
            rosterSize: s.rosterSize,
          }));
      })
    : [];

  const { actorId, actorName } = getAuditActor(session);
  const watermark = exportWatermark(actorName, actorId, classes.length, now);
  const wb = buildClassExportWorkbook({
    options,
    classes,
    roster,
    sessions,
    includeParentContact,
    watermark,
  });
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "classes",
    entityType: "Class",
    entityId: "export",
    action: "EXPORT",
    newValues: {
      classes: classes.length,
      students: roster.length,
      sessions: sessions.length,
      sheets: options.sheets,
      filters: Object.fromEntries(sp),
      parentContact: includeParentContact
        ? phoneFull
          ? "full"
          : "masked"
        : "none",
    },
  });

  const date = now.toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="lop-hoc-${date}.xlsx"`,
    },
  });
}
