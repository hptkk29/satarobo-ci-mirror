/**
 * FIX 07/08 — "HỌC VIÊN MA TRONG LỚP". Postgres LOCAL (.env.test).
 *
 * Sự cố: chủ dự án xoá học viên ở /admin/students, nhưng lớp học VẪN còn tên học viên đó
 * (trang Học sinh của lớp, tab Học viên site GV, bảng điểm danh). Nguyên nhân:
 * `deleteStudent` chỉ soft-delete bảng Student, không đụng Enrollment — mà mọi màn
 * "học viên của lớp" đọc TỪ Enrollment → student.
 *
 * Test service-level (mẫu report-card-media-fixes.spec): gọi thẳng lib — Server Action
 * cần auth() nên không dựng HTTP; `removeStudentFromClasses` chính là thứ deleteStudent
 * gọi trong transaction, còn `buildSessionAttendanceRows` là roster thật của điểm danh.
 *
 * Phủ:
 *  X1 — cascade đổi status sang WITHDREW và KHÔNG đụng deletedAt (giữ nguyên sổ sách),
 *       có EnrollmentAuditLog để truy vết.
 *  X2 — sau cascade, roster buổi học KHÔNG còn học viên đó.
 *  X3 — PENDING (chờ xếp lớp) đi CANCELLED, không phải WITHDREW.
 *  X4 — idempotent: gọi lần 2 không đổi gì; ghi danh đã kết thúc trước đó không bị đụng.
 *  X5 — hàng rào 2: dữ liệu HỎNG SẴN (Student.deletedAt set nhưng enrollment còn
 *       STUDYING — đúng ca "Quân" trước bản vá) vẫn bị roster loại.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { buildActor } from "../../../lib/auth/actor";
import { buildSessionAttendanceRows } from "../../../lib/attendance/roster";
import { removeStudentFromClasses } from "../../../lib/students/remove-from-classes";
import type { Prisma } from "@prisma/client";

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${seq++}`;

/** Actor tối thiểu — roster đọc lớp qua db trần, actor chỉ dùng cho nhánh học bù. */
const plainActor = () =>
  buildActor({ userId: `u-${uniq()}`, rows: [], orgNodes: [], assignedClassIds: [] });

async function seedClassWithStudent(opts?: {
  studentName?: string;
  status?: Prisma.EnrollmentCreateInput["status"];
}) {
  const code = `CS-${uniq()}`;
  const center = await db.center.create({
    data: { code, name: `Cơ sở ${code}`, slug: `cs-${code.toLowerCase()}`, address: "x" },
  });
  const course = await db.course.create({
    data: { name: `Sata ${uniq()}`, slug: `sata-${uniq()}`, price: 4_000_000 },
  });
  const cls = await db.class.create({
    data: { name: `Lớp ${uniq()}`, courseId: course.id, centerId: center.id },
  });
  const student = await db.student.create({
    data: { name: opts?.studentName ?? `HV ${uniq()}`, centerId: center.id },
  });
  // Enrollment ∈ SCOPED_MODELS — luôn set centerId khi create (bất biến FL3-02).
  const enr = await db.enrollment.create({
    data: {
      studentId: student.id,
      classId: cls.id,
      courseId: course.id,
      status: opts?.status ?? "STUDYING",
      centerId: center.id,
      finalPrice: 4_000_000,
    },
  });
  const session = await db.classSession.create({
    data: { classId: cls.id, date: new Date("2026-08-01"), centerId: center.id },
  });
  return { center, course, cls, student, enr, session };
}

/** Chạy đúng thứ tự deleteStudent làm: soft-delete Student + gỡ khỏi lớp, 1 transaction. */
async function deleteStudentLikeAction(studentId: string, centerId: string | null) {
  return db.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.student.update({ where: { id: studentId }, data: { deletedAt: new Date() } });
    return removeStudentFromClasses({
      tx,
      studentId,
      actorId: null,
      actorName: "test",
      reason: "Xoá học viên khỏi hệ thống",
      orgUnitId: centerId,
    });
  });
}

test.describe("[FIX-0708] Xoá học viên phải gỡ khỏi lớp", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[X1] cascade đổi status → WITHDREW, KHÔNG đụng deletedAt, có audit", async () => {
    const { student, enr, center } = await seedClassWithStudent();

    const removed = await deleteStudentLikeAction(student.id, center.id);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ fromStatus: "STUDYING", toStatus: "WITHDREW" });

    const after = await db.enrollment.findUnique({
      where: { id: enr.id },
      select: { status: true, deletedAt: true, finalPrice: true },
    });
    expect(after?.status).toBe("WITHDREW");
    // Sổ sách: deletedAt là soft-delete TÀI CHÍNH (lib/finance/debt.ts lọc deletedAt,
    // không lọc status) — cascade tuyệt đối không được set, nếu không công nợ tụt.
    expect(after?.deletedAt).toBeNull();
    expect(after?.finalPrice).toBe(4_000_000);

    const audit = await db.enrollmentAuditLog.findMany({ where: { enrollmentId: enr.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ fromStatus: "STUDYING", toStatus: "WITHDREW" });
  });

  test("[X2] sau cascade, roster buổi học không còn học viên đó", async () => {
    const { student, session, center } = await seedClassWithStudent({ studentName: "HV Quân" });
    const actor = plainActor();

    const before = await buildSessionAttendanceRows(actor, session.id);
    expect(before.rows.map((r) => r.studentId)).toContain(student.id);

    await deleteStudentLikeAction(student.id, center.id);

    const after = await buildSessionAttendanceRows(actor, session.id);
    expect(after.rows.map((r) => r.studentId)).not.toContain(student.id);
    expect(after.rows).toHaveLength(0);
  });

  test("[X3] ghi danh PENDING đi CANCELLED (khớp state machine), không phải WITHDREW", async () => {
    const { student, enr, center } = await seedClassWithStudent({ status: "PENDING" });

    const removed = await deleteStudentLikeAction(student.id, center.id);
    expect(removed[0]).toMatchObject({ fromStatus: "PENDING", toStatus: "CANCELLED" });

    const after = await db.enrollment.findUnique({
      where: { id: enr.id },
      select: { status: true },
    });
    expect(after?.status).toBe("CANCELLED");
  });

  test("[X4] idempotent — gọi lần 2 không đổi gì; ghi danh đã kết thúc không bị đụng", async () => {
    const { student, course, center, enr } = await seedClassWithStudent();
    // Ghi danh cũ đã COMPLETED ở LỚP KHÁC (unique một phần (studentId, classId) WHERE
    // deletedAt IS NULL nên không thể 2 ghi danh sống cùng lớp) — lịch sử học, tuyệt đối
    // không được ghi đè.
    const oldClass = await db.class.create({
      data: { name: `Lớp cũ ${uniq()}`, courseId: course.id, centerId: center.id },
    });
    const done = await db.enrollment.create({
      data: {
        studentId: student.id,
        classId: oldClass.id,
        courseId: course.id,
        status: "COMPLETED",
        centerId: center.id,
      },
    });

    const first = await deleteStudentLikeAction(student.id, center.id);
    expect(first.map((r) => r.id)).toEqual([enr.id]);

    const second = await db.$transaction(async (txRaw) =>
      removeStudentFromClasses({
        tx: txRaw as unknown as Prisma.TransactionClient,
        studentId: student.id,
        actorId: null,
        actorName: "test",
        reason: "chạy lại",
        orgUnitId: center.id,
      }),
    );
    expect(second).toHaveLength(0);

    const keep = await db.enrollment.findUnique({
      where: { id: done.id },
      select: { status: true },
    });
    expect(keep?.status).toBe("COMPLETED");
    // Không đẻ thêm audit ở lần chạy 2.
    expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: enr.id } })).toBe(1);
  });

  test("[X5] hàng rào 2 — dữ liệu hỏng sẵn (HV xoá mềm, ghi danh còn STUDYING) vẫn bị roster loại", async () => {
    const { student, session } = await seedClassWithStudent({ studentName: "HV Quân cũ" });
    // Mô phỏng đúng ca trước bản vá: chỉ Student.deletedAt, enrollment nguyên trạng.
    await db.student.update({ where: { id: student.id }, data: { deletedAt: new Date() } });

    const rows = await db.enrollment.findMany({
      where: { studentId: student.id },
      select: { status: true },
    });
    expect(rows[0]?.status).toBe("STUDYING"); // dữ liệu vẫn "hỏng" đúng như prod

    const roster = await buildSessionAttendanceRows(plainActor(), session.id);
    expect(roster.rows.map((r) => r.studentId)).not.toContain(student.id);
  });
});
