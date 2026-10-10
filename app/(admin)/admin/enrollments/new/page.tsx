import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkPermission, checkPermissionDetail } from "@/lib/auth/check-permission";
import { maskPhone } from "@/lib/utils";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { getNonEnrollableCenterIds, notHeadOfficeWhere } from "@/lib/enrollment-flow";
import { EnrollForm } from "../_components/enroll-form";

export const dynamic = "force-dynamic";

const CAPACITY_COUNT_STATUSES = ["PENDING", "CONFIRMED", "STUDYING", "ACTIVE"];

export default async function NewEnrollmentPage({
  searchParams,
}: {
  // BGĐ 31/07 — TÁI TỤC: nút "Tái tục" ở /students/sap-het-khoa truyền
  // ?studentId=…&renewedFrom=<enrollmentId> để pre-fill form.
  searchParams: Promise<{ studentId?: string; renewedFrom?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("enrollments:create"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const { studentId: prefillStudentId, renewedFrom } = await searchParams;

  // US-03 (TS-02): DENY cấp trường từ grant nhóm — che parentPhone TRƯỚC khi đưa
  // danh sách HV xuống client component (EnrollForm nhận prop = vào RSC payload).
  const { fieldMask } = await checkPermissionDetail("students:view-all");
  const phoneMasked = fieldMask.includes("parentPhone");

  // Cách ly cơ sở: Student + Class ∈ SCOPED_MODELS → sdb auto inject centerId,
  // CENTER_MANAGER@CS1 không thấy/đăng ký HS hay lớp của CS2.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // FL2-05 — Hội sở (OrgUnit type ≠ CENTER) KHÔNG nhận học viên → loại lớp thuộc
  // cơ sở Hội sở khỏi picker đăng ký. Nhận diện qua OrgUnit tree, không hardcode.
  const hoCenterIds = await getNonEnrollableCenterIds();

  const [students, classes] = await Promise.all([
    sdb.student.findMany({
      where: { deletedAt: null, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        parentPhone: true,
        studentCode: true,
      },
      take: 500,
    }),
    sdb.class.findMany({
      where: {
        deletedAt: null,
        status: { in: ["PLANNED", "RECRUITING", "ACTIVE"] },
        ...notHeadOfficeWhere(hoCenterIds),
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        classCode: true,
        status: true,
        maxStudents: true,
        center: { select: { name: true } },
        _count: {
          select: {
            enrollments: {
              where: { status: { in: CAPACITY_COUNT_STATUSES as never[] } },
            },
          },
        },
      },
      take: 200,
    }),
  ]);

  // BGĐ 31/07 — TÁI TỤC: danh sách ghi danh cũ của HV pre-fill (chọn "khoá trước").
  const previousEnrollments = prefillStudentId
    ? await sdb.enrollment.findMany({
        where: { studentId: prefillStudentId },
        orderBy: { enrolledAt: "desc" },
        select: {
          id: true,
          status: true,
          centerId: true, // Enrollment ∈ SCOPED_MODELS — passesScope cần field này
          course: { select: { name: true } },
          class: { select: { name: true } },
        },
        take: 20,
      })
    : [];

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black text-foreground">
        Đăng ký lớp cho học viên
      </h1>
      <EnrollForm
        students={
          phoneMasked
            ? students.map((s) => ({
                ...s,
                parentPhone: s.parentPhone ? maskPhone(s.parentPhone) : s.parentPhone,
              }))
            : students
        }
        initialStudentId={prefillStudentId ?? null}
        initialRenewedFrom={renewedFrom ?? null}
        previousEnrollments={previousEnrollments.map((p) => ({
          id: p.id,
          label: `${p.course.name} — lớp ${p.class.name} (${p.status})`,
        }))}
        classes={classes.map((c) => ({
          id: c.id,
          classCode: c.classCode,
          name: c.name,
          status: c.status,
          maxStudents: c.maxStudents,
          enrolledCount: c._count.enrollments,
          centerName: c.center?.name ?? null,
        }))}
      />
    </div>
  );
}
