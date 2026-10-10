import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import {
  buildAssignableWhere,
  CAPACITY_COUNT_STATUSES,
} from "@/lib/lms/assign";
import { getAssignableSales } from "@/lib/sales/assignable";
import { AssignStudents } from "./_components/assign-students";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

// Nhãn khớp màn /enrollments (trước đây STUDYING ghi "Đã xếp lớp" gây hiểu nhầm
// với nút "Chuyển sang Đang học").
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Chờ xếp",
  CONFIRMED: "Đã xếp",
  STUDYING: "Đang học",
  ACTIVE: "Đang học (legacy)",
  PAUSED: "Bảo lưu",
};

export default async function ClassStudentsPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Cổng ĐỌC — cùng bộ với trang chi tiết lớp. Trước 04/09 chỗ này đòi
  // `classes:edit`, nên Sale và Quản lý lớp học (chỉ có `classes:view-all`) bị đá về
  // /dashboard dù họ cần xem danh sách em trong lớp.
  const [canAssign, hasViewAll, hasViewOwn, hasFeedbackView] = await Promise.all([
    checkPermission("classes:edit"),
    checkPermission("classes:view-all"),
    checkPermission("classes:view-own"),
    checkPermission("session-feedback:view-all"),
  ]);
  if (!canAssign && !hasViewAll && !hasViewOwn && !hasFeedbackView) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const cls = await sdb.class.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      courseId: true,
      centerId: true,
      maxStudents: true,
      status: true,
    },
  });
  if (!cls || !passesScope("Class", { centerId: cls.centerId }, actor)) notFound();

  const [current, assignable] = await Promise.all([
    sdb.enrollment.findMany({
      // student.deletedAt: hàng rào 2 cho dữ liệu hỏng trước 07/08 (HV xoá mềm nhưng
      // ghi danh còn sống) — đây chính là màn "Học sinh lớp" đã hiện HV ma.
      where: {
        classId: cls.id,
        status: { in: [...CAPACITY_COUNT_STATUSES, "PAUSED"] },
        student: { deletedAt: null },
      },
      orderBy: { enrolledAt: "asc" },
      select: {
        id: true,
        status: true,
        saleId: true, // T3.2 — sale phụ trách hiển thị/sửa ngay trong lớp
        studentId: true,
        // 21/08 — `student.status` quyết định nút nào hiện sau khi gỡ khỏi lớp:
        // còn đang học → "chờ xếp lớp lại"; đã Nghỉ học → mở thêm nút "Nghỉ hẳn".
        student: { select: { name: true, studentCode: true, status: true } },
      },
    }),
    // Chỉ nạp khi được gán. Người CHỈ XEM không cần — và không nên thấy — danh sách
    // em ngoài lớp kèm nút thêm.
    canAssign
      ? sdb.enrollment.findMany({
          where: buildAssignableWhere(cls),
          orderBy: { enrolledAt: "asc" },
          select: {
            id: true,
            status: true,
            student: { select: { name: true, studentCode: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const activeCount = current.filter((e) =>
    (CAPACITY_COUNT_STATUSES as readonly string[]).includes(e.status),
  ).length;

  // T3.2 — picker sale LỌC THEO CƠ SỞ CỦA LỚP (không gán chéo CS1↔CS2); luôn kèm
  // sale đang gán để <select> không tự rớt giá trị khi họ đổi vai/chuyển cơ sở.
  const sales = await getAssignableSales({
    centerIds: cls.centerId ? [cls.centerId] : [],
    includeIds: current.map((e) => e.saleId),
  });
  const saleOptions = sales.map((s) => ({ id: s.id, name: s.name ?? "(chưa đặt tên)" }));

  const currentRows = current.map((e) => ({
    id: e.id,
    status: e.status,
    statusLabel: STATUS_LABEL[e.status] ?? e.status,
    name: e.student?.name ?? "(không tên)",
    studentCode: e.student?.studentCode ?? null,
    saleId: e.saleId,
    studentId: e.studentId,
    studentStatus: e.student?.status ?? "ACTIVE",
  }));
  const assignableRows = assignable.map((e) => ({
    id: e.id,
    status: e.status,
    statusLabel: STATUS_LABEL[e.status] ?? e.status,
    name: e.student?.name ?? "(không tên)",
    studentCode: e.student?.studentCode ?? null,
  }));

  // SUPER_ADMIN/CENTER_MANAGER mới được override sức chứa (classes:create).
  const canOverride = await checkPermission("classes:create", { centerId: cls.centerId });

  // 21/08 — ba thao tác trên từng dòng học viên, ba quyền khác nhau. Gác Ở SERVER để ẩn
  // nút thay vì để server action ném lỗi sau khi người dùng đã gõ xong lý do.
  const [canTransfer, canRemove, canDeleteStudent] = await Promise.all([
    checkPermission("enrollments:transfer", { centerId: cls.centerId }),
    checkPermission("enrollments:cancel", { centerId: cls.centerId }),
    checkPermission("students:delete", { centerId: cls.centerId }),
  ]);

  // Lớp đích cho nút "Chuyển lớp". Siết CÙNG KHOÁ (khác khoá = đổi mức phí — luật
  // R6-E2 ở `lib/transfer/service.ts:176`) và CÙNG CƠ SỞ với lớp nguồn: `transferEnrollment`
  // KHÔNG cập nhật `Student.centerId`/`StudentCenterHistory`, nên chuyển chéo cơ sở bằng
  // đường này sẽ để học viên mang cơ sở cũ. Chuyển cơ sở đi màn /chuyen-lop (có duyệt).
  const targetClassesRaw = canTransfer
    ? await sdb.class.findMany({
        where: {
          deletedAt: null,
          id: { not: cls.id },
          courseId: cls.courseId,
          centerId: cls.centerId,
          status: { in: ["PLANNED", "RECRUITING", "PENDING_APPROVAL", "ACTIVE"] },
        },
        orderBy: [{ startDate: "desc" }, { name: "asc" }],
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
                where: {
                  status: { in: [...CAPACITY_COUNT_STATUSES] },
                  deletedAt: null,
                  student: { deletedAt: null },
                },
              },
            },
          },
        },
      })
    : [];
  const targetClasses = targetClassesRaw.map((c) => ({
    id: c.id,
    name: c.name,
    classCode: c.classCode,
    status: c.status,
    maxStudents: c.maxStudents,
    enrolledCount: c._count.enrollments,
    centerName: c.center?.name ?? null,
  }));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-black text-foreground">
          Học sinh lớp:{" "}
          <span className="font-bold text-primary">{cls.name}</span>
        </h1>
        {/* Người CHỈ XEM không vào được /edit — trả họ về trang lớp. */}
        <Link
          href={canAssign ? `/classes/${cls.id}/edit` : `/classes/${cls.id}`}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" /> {canAssign ? "Về sửa lớp" : "Về lớp"}
        </Link>
      </div>

      <AssignStudents
        classId={cls.id}
        maxStudents={cls.maxStudents}
        activeCount={activeCount}
        current={currentRows}
        assignable={assignableRows}
        canOverride={canOverride}
        sales={saleOptions}
        canTransfer={canTransfer}
        canRemove={canRemove}
        canDeleteStudent={canDeleteStudent}
        canAssign={canAssign}
        targetClasses={targetClasses}
      />
    </div>
  );
}
