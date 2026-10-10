"use server";

import { auth } from "@/lib/auth";
import { checkPermission, assertPermission } from "@/lib/auth/check-permission";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import type { EnrollmentStatus } from "@prisma/client";
import { z } from "zod";
import { canTransition } from "@/lib/enrollments/status";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { crossCenterError } from "@/lib/enrollment-flow";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import { chuyenLopTrongTx, ChuyenLopError } from "@/lib/enrollments/chuyen-lop";
import {
  cauChanGhiDanhCu,
  GhiDanhCuDaDoiError,
  goGhiDanhCuDaKetThuc,
  SELECT_GHI_DANH_CU,
  whereGhiDanhCu,
  xetGhiDanhCu,
  type GhiDanhCu,
} from "@/lib/enrollments/ghi-danh-cu-trong-lop";
import { ghiTuongTacLeadBoQuaLoi, layNguCanhGhiDanh } from "@/lib/lead/tuong-tac/ghi";

type Sdb = ReturnType<typeof scopedDb>;

// Cách ly cơ sở (chống IDOR ghi): Enrollment + ClassSession NAY ∈ SCOPED_MODELS
// (FL3-02 — centerId đã denormalize + backfill 100%) nên READ tự lọc theo cơ sở.
// WRITE vẫn không tự scope → mọi mutation theo enrollmentId/classId từ client phải
// xác minh lớp thuộc tầm nhìn cơ sở của actor (helper class.centerId bên dưới).
async function classCenterInScope(
  sdb: Sdb,
  actor: Actor,
  classId: string,
): Promise<boolean> {
  const cls = await sdb.class.findUnique({ where: { id: classId }, select: { centerId: true } });
  return !!cls && passesScope("Class", cls, actor);
}

type ActionResult = { error?: string };
type WorkflowResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * FIX-C4 — Lỗi nghiệp vụ mang MÃ để FE map message (CLASS_FULL → "Lớp đã đầy").
 * Throw bên trong transaction để rollback; catch ở ngoài trả `{ ok:false, error: code }`.
 */
class EnrollmentWorkflowError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "EnrollmentWorkflowError";
  }
}

/**
 * FIX-C4 — Chạy transaction mức Serializable + retry khi gặp xung đột ghi
 * (Prisma P2034 / Postgres 40001). Dùng cho check-and-write sĩ số lớp: count +
 * create/update trong CÙNG tx, re-check trong tx → chống TOCTOU bán vượt sĩ số.
 */
async function runSerializable<T>(
  sdb: Sdb,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      // Cast tx: client extension không structurally-assignable vào
      // Prisma.TransactionClient (tiền lệ students/classes) — runtime không đổi.
      return await sdb.$transaction(
        async (tx) => fn(tx as unknown as Prisma.TransactionClient),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30_000,
          maxWait: 10_000,
        },
      );
    } catch (err) {
      const isConflict =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2034";
      if (isConflict && attempt < 2) continue;
      throw err;
    }
  }
}

// Statuses that count toward a class's capacity.
const CAPACITY_COUNT_STATUSES = ["PENDING", "CONFIRMED", "STUDYING", "ACTIVE"] as const;
const TERMINAL_STATUSES = ["COMPLETED", "WITHDREW", "TRANSFERRED", "CANCELLED"] as const;
const ALL_NEW_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "STUDYING",
  "PAUSED",
  "COMPLETED",
  "WITHDREW",
] as const;

// Legacy CRUD schema kept for back-compat with existing tuition/paidAt rows.
const LEGACY_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "STUDYING",
  "PAUSED",
  "COMPLETED",
  "WITHDREW",
  "TRANSFERRED",
  "ACTIVE",
  "CANCELLED",
] as const;

const enrollmentSchema = z.object({
  studentId: z.string().trim().min(1, "Học viên không được để trống"),
  classId: z.string().trim().min(1, "Lớp học không được để trống"),
  status: z.enum(LEGACY_STATUSES),
  tuition: z.number().int().nonnegative().nullable(),
  paidAt: z.date().nullable(),
  startDate: z.date().nullable(),
  endDate: z.date().nullable(),
});

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseDate(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * FIX 7 — Kiểm tra khoá tiên quyết. Trả lỗi nghiệp vụ thân thiện nếu học viên
 * chưa hoàn thành (Enrollment status COMPLETED) các khoá yêu cầu trước.
 * Khoá không có tiên quyết → luôn ok.
 */
export async function checkPrerequisites(
  studentId: string,
  courseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("enrollments:edit");
  } catch {
    return { ok: false, error: "Không có quyền" };
  }
  const sdb = scopedDb(await resolveActor(session.user.id));
  try {
    const prereqs = await sdb.coursePrerequisite.findMany({
      where: { courseId },
      select: { requiredCourse: { select: { id: true, name: true } } },
    });
    if (prereqs.length === 0) return { ok: true };

    const requiredIds = prereqs.map((p) => p.requiredCourse.id);
    // Enrollment ∈ SCOPED_MODELS: lịch sử hoàn thành ở cơ sở NGOÀI tầm nhìn actor
    // không được tính (HO/SUPER không ảnh hưởng). Scope query-level = task #04 §3.
    const completed = await sdb.enrollment.findMany({
      where: { studentId, courseId: { in: requiredIds }, status: "COMPLETED" },
      select: { courseId: true },
    });
    const done = new Set(completed.map((c) => c.courseId));
    const missing = prereqs
      .filter((p) => !done.has(p.requiredCourse.id))
      .map((p) => p.requiredCourse.name);

    if (missing.length > 0) {
      return {
        ok: false,
        error: `Học viên cần hoàn thành ${missing.join(", ")} trước khi đăng ký khoá này.`,
      };
    }
    return { ok: true };
  } catch {
    // Lỗi tra cứu tiên quyết → không chặn cứng (fail-open) nhưng log.
    console.error("[checkPrerequisites] lookup error for course", courseId);
    return { ok: true };
  }
}

async function requireSalesOrAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("enrollments:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

function readForm(formData: FormData) {
  const statusRaw =
    emptyToUndefined(formData.get("status")) ?? "PENDING";
  return {
    studentId: emptyToUndefined(formData.get("studentId")) ?? "",
    classId: emptyToUndefined(formData.get("classId")) ?? "",
    status: statusRaw as (typeof LEGACY_STATUSES)[number],
    tuition: parseInteger(formData.get("tuition")),
    paidAt: parseDate(formData.get("paidAt")),
    startDate: parseDate(formData.get("startDate")),
    endDate: parseDate(formData.get("endDate")),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Legacy CRUD actions (kept for back-compat with older form flows).
// ────────────────────────────────────────────────────────────────────────────

export async function createEnrollment(formData: FormData): Promise<ActionResult> {
  const session = await requireSalesOrAdmin();

  const parsed = enrollmentSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const e = parsed.data;

  // Cách ly cơ sở: lớp ghi danh phải thuộc tầm nhìn cơ sở của actor.
  const uid = session.user.id;
  if (!uid) return { error: "Phiên không hợp lệ" };
  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);
  if (!(await classCenterInScope(sdb, actor, e.classId))) {
    return { error: "Lớp học không tồn tại" };
  }

  let classRow: { courseId: string; centerId: string | null } | null;
  let existing: { id: string } | null;
  let studentRow: { centerId: string | null } | null;
  try {
    [classRow, existing, studentRow] = await Promise.all([
      sdb.class.findUnique({ where: { id: e.classId }, select: { courseId: true, centerId: true } }),
      sdb.enrollment.findFirst({
        where: { studentId: e.studentId, classId: e.classId },
        select: { id: true },
      }),
      sdb.student.findFirst({
        where: { id: e.studentId, deletedAt: null },
        select: { centerId: true },
      }),
    ]);
  } catch {
    return { error: "Lỗi cơ sở dữ liệu khi kiểm tra lớp/đăng ký" };
  }
  if (!classRow) return { error: "Lớp học không tồn tại" };
  if (existing) return { error: "Học viên này đã đăng ký lớp này rồi" };
  if (!studentRow) return { error: "Không tìm thấy học viên" };
  // QA 21/07 (B1) — legacy action vẫn là endpoint exposed: áp cùng guard cơ sở
  // như enrollStudent (rule §15.1(2) lib/lms/assign).
  const xErr = crossCenterError(classRow.centerId, studentRow.centerId);
  if (xErr) return { error: xErr };
  // QA 21/07 (B2 đợt 2) — cùng guard "đang học lớp khác" như enrollStudent.
  const liveElsewhere = await sdb.enrollment.findFirst({
    where: {
      studentId: e.studentId,
      classId: { not: e.classId },
      status: { in: ["STUDYING", "ACTIVE"] },
      class: { deletedAt: null },
    },
    select: { class: { select: { name: true } } },
  });
  if (liveElsewhere) {
    return {
      error: `Học viên đang học lớp "${liveElsewhere.class?.name ?? "khác"}" — hoàn thành hoặc rút khỏi lớp đó trước khi ghi danh lớp mới.`,
    };
  }

  const data: Prisma.EnrollmentCreateInput = {
    student: { connect: { id: e.studentId } },
    class: { connect: { id: e.classId } },
    course: { connect: { id: classRow.courseId } },
    // FL3-02 — centerId denormalized từ class (scopedDb cách ly cơ sở). Bắt buộc set khi create.
    centerId: classRow.centerId,
    status: e.status,
    tuition: e.tuition,
    paidAt: e.paidAt,
    startDate: e.startDate,
    endDate: e.endDate,
  };

  try {
    // US-03 chat — HV vào lớp → PH vào nhóm lớp trong CÙNG transaction (BR-12).
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await tx.enrollment.create({ data });
      await syncConversationMembership(tx, e.classId);
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch {
    return { error: "Lỗi cơ sở dữ liệu — không tạo được đăng ký" };
  }

  revalidatePath("/enrollments");
  redirect("/enrollments");
}

export async function updateEnrollment(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSalesOrAdmin();

  const parsed = enrollmentSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const e = parsed.data;
  const uid = session.user.id;
  if (!uid) return { error: "Phiên không hợp lệ" };
  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);

  const existing = await sdb.enrollment.findUnique({
    where: { id },
    // ⚠️ Enrollment ∈ SCOPED_MODELS: findUnique lọc hậu kỳ theo record.centerId
    // → select PHẢI kèm centerId (thiếu → passesScope fail → ẩn nhầm record hợp lệ).
    select: {
      centerId: true,
      studentId: true,
      classId: true,
      class: { select: { centerId: true } },
    },
  });
  if (!existing) return { error: "Đăng ký không tồn tại" };

  // Cách ly cơ sở: lớp HIỆN TẠI + lớp ĐÍCH (nếu đổi) đều phải trong tầm nhìn actor.
  if (!passesScope("Class", { centerId: existing.class?.centerId ?? null }, actor)) {
    return { error: "Đăng ký không tồn tại" };
  }
  if (e.classId !== existing.classId && !(await classCenterInScope(sdb, actor, e.classId))) {
    return { error: "Lớp học không tồn tại" };
  }

  if (existing.studentId !== e.studentId || existing.classId !== e.classId) {
    const dup = await sdb.enrollment.findFirst({
      where: {
        studentId: e.studentId,
        classId: e.classId,
        id: { not: id },
        deletedAt: null, // FIX-C3
      },
      select: { id: true },
    });
    if (dup) return { error: "Học viên này đã đăng ký lớp này rồi" };
  }

  const classRow = await sdb.class
    .findUnique({ where: { id: e.classId }, select: { courseId: true, centerId: true } })
    .catch(() => null);
  if (!classRow) return { error: "Lớp học không tồn tại" };

  const data: Prisma.EnrollmentUpdateInput = {
    student: { connect: { id: e.studentId } },
    class: { connect: { id: e.classId } },
    course: { connect: { id: classRow.courseId } },
    // FL3-02 — đồng bộ centerId theo lớp mới khi đổi lớp.
    centerId: classRow.centerId,
    status: e.status,
    tuition: e.tuition,
    paidAt: e.paidAt,
    startDate: e.startDate,
    endDate: e.endDate,
  };

  try {
    // US-03 chat — update trần có thể đổi lớp/học viên/trạng thái → sync CẢ lớp cũ
    // lẫn lớp mới trong cùng transaction.
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await tx.enrollment.update({ where: { id }, data });
      await syncConversationMembership(tx, e.classId);
      if (existing.classId !== e.classId) {
        await syncConversationMembership(tx, existing.classId);
      }
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch {
    return { error: "Lỗi cơ sở dữ liệu — không cập nhật được" };
  }

  revalidatePath("/enrollments");
  revalidatePath(`/enrollments/${id}/edit`);
  redirect("/enrollments");
}

export async function deleteEnrollment(id: string): Promise<ActionResult> {
  const session = await requireSalesOrAdmin();
  // Cách ly cơ sở: chỉ xoá đăng ký thuộc lớp trong tầm nhìn actor (chống IDOR).
  const uid = session.user.id;
  if (!uid) return { error: "Phiên không hợp lệ" };
  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);
  const existing = await sdb.enrollment.findUnique({
    where: { id },
    // ⚠️ select kèm centerId — findUnique trên model scoped lọc hậu kỳ theo field này.
    select: { centerId: true, class: { select: { centerId: true } } },
  });
  if (!existing || !passesScope("Class", { centerId: existing.class?.centerId ?? null }, actor)) {
    return { error: "Đăng ký không tồn tại" };
  }
  try {
    // FIX-C3 — soft-delete (giữ vết tài chính); read filter deletedAt: null sẽ ẩn.
    // US-03 chat — HV rời lớp (xoá mềm ghi danh) → sync membership cùng transaction.
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      const row = await tx.enrollment.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: { classId: true },
      });
      await syncConversationMembership(tx, row.classId);
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch {
    return { error: "Không thể xoá đăng ký này" };
  }
  revalidatePath("/enrollments");
  return {};
}

/**
 * Xoá đăng ký — dùng cho nút "Xóa" trên bảng danh sách admin.
 * FIX-C3 — soft-delete (set `deletedAt`), nhưng CHỈ khi chưa phát sinh
 * dữ liệu nghiệp vụ (payments / orderItems / receipts / reserves). Nếu đã có →
 * chặn và yêu cầu "hủy đăng ký" thay vì xóa.
 */
export async function deleteEnrollmentAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("enrollments:delete");
  } catch {
    return { ok: false, error: "Không có quyền" };
  }

  const uid = session.user.id;
  if (!uid) return { ok: false, error: "Phiên không hợp lệ" };
  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);

  const enrollment = await sdb.enrollment.findUnique({
    where: { id },
    // ⚠️ select kèm centerId — findUnique trên model scoped lọc hậu kỳ theo field này.
    select: {
      id: true,
      centerId: true,
      studentId: true,
      classId: true,
      status: true,
      class: { select: { centerId: true } },
      _count: {
        select: {
          payments: true,
          orderItems: true,
          receipts: true,
          reserves: true,
        },
      },
    },
  });
  if (!enrollment) return { ok: false, error: "Đăng ký không tồn tại" };

  // Cách ly cơ sở: chỉ xoá đăng ký thuộc lớp trong tầm nhìn actor (chống IDOR).
  if (!passesScope("Class", { centerId: enrollment.class?.centerId ?? null }, actor)) {
    return { ok: false, error: "Đăng ký không tồn tại" };
  }

  const c = enrollment._count;
  if (c.payments + c.orderItems + c.receipts + c.reserves > 0) {
    return {
      ok: false,
      error:
        "Không thể xóa: đăng ký đã phát sinh dữ liệu nghiệp vụ (thanh toán/biên lai). Hãy hủy đăng ký thay vì xóa.",
    };
  }

  const { actorId, actorName } = getAuditActor(session);

  // ĐỌC TRƯỚC khi xoá. Soft-delete không làm mất dòng nên đọc sau vẫn ra, nhưng chuỗi tra
  // đi qua `student`/`class`/`leadChild` — đọc trước là không phụ thuộc vào việc lượt xoá
  // có kéo theo quan hệ nào hay không.
  const nguCanh = await layNguCanhGhiDanh(id);

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      // FIX-C3 — soft-delete thay hard delete (guard _count ở trên vẫn giữ).
      await tx.enrollment.update({ where: { id }, data: { deletedAt: new Date() } });
      // US-03 chat — HV rời lớp → sync membership nhóm lớp cùng transaction.
      await syncConversationMembership(tx, enrollment.classId);
      // P3 (additive): ghi AuditLog hợp nhất cho viewer chung (atomic với soft-delete).
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "enrollment",
        entityType: "Enrollment",
        entityId: id,
        action: "DELETE",
        oldValues: {
          studentId: enrollment.studentId,
          classId: enrollment.classId,
          status: enrollment.status,
        },
        orgUnitId: enrollment.class?.centerId ?? null,
        tx,
      });
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch {
    return { ok: false, error: "Không thể xoá đăng ký này" };
  }

  if (nguCanh) {
    await ghiTuongTacLeadBoQuaLoi({
      leadId: nguCanh.leadId,
      actorId,
      actorName,
      moc: new Date(),
      sk: {
        viec: "ghi-danh.go",
        tenCon: nguCanh.tenCon,
        tenLop: nguCanh.tenLop,
        lyDo: null,
      },
    });
  }

  revalidatePath("/enrollments");
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// D5 workflow: enrollStudent / changeEnrollmentStatus / transferEnrollment
// ────────────────────────────────────────────────────────────────────────────

const EnrollStudentSchema = z.object({
  studentId: z.string().trim().min(1, "Chọn học viên"),
  classId: z.string().trim().min(1, "Chọn lớp"),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  // BGĐ 31/07 — TÁI TỤC: id ghi danh KHOÁ TRƯỚC của cùng HV (optional).
  renewedFromEnrollmentId: z.string().trim().optional().or(z.literal("")),
});

export async function enrollStudent(
  input: z.infer<typeof EnrollStudentSchema>,
): Promise<WorkflowResult<{ enrollmentId: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("enrollments:create"))) {
    return { ok: false, error: "Không có quyền đăng ký HS" };
  }

  const parsed = EnrollStudentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const { studentId, classId } = parsed.data;
  const notes = parsed.data.notes && parsed.data.notes !== "" ? parsed.data.notes : null;
  const renewedFromEnrollmentId =
    parsed.data.renewedFromEnrollmentId && parsed.data.renewedFromEnrollmentId !== ""
      ? parsed.data.renewedFromEnrollmentId
      : null;

  // Cách ly cơ sở: lớp ghi danh phải thuộc tầm nhìn cơ sở của actor.
  const uid = session.user.id;
  if (!uid) return { ok: false, error: "Phiên không hợp lệ" };
  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);
  if (!(await classCenterInScope(sdb, actor, classId))) {
    return { ok: false, error: "Không tìm thấy lớp" };
  }

  // Pre-create validation queries — bọc try/catch để lỗi DB (vd Prisma Client
  // stale sau migration, mất kết nối) trả về thông báo thân thiện thay vì văng
  // 500 không bắt được.
  let cls: {
    id: string;
    courseId: string;
    centerId: string | null;
    maxStudents: number;
    status: string;
    _count: { enrollments: number };
  } | null;
  let existing: GhiDanhCu | null;
  let student: { id: string; centerId: string | null } | null;
  try {
    [cls, existing, student] = await Promise.all([
      sdb.class.findFirst({
        where: { id: classId, deletedAt: null },
        select: {
          id: true,
          courseId: true,
          centerId: true,
          maxStudents: true,
          status: true,
          _count: {
            select: {
              enrollments: {
                // FIX-C3 (B2a) — nested _count KHÔNG được soft-delete hook → tự lọc.
                where: {
                  status: { in: [...CAPACITY_COUNT_STATUSES] },
                  deletedAt: null,
                },
              },
            },
          },
        },
      }),
      // FIX-C3 (B2b) — không còn compound unique studentId_classId; chỉ mục duy nhất từng
      // phần (`… WHERE deletedAt IS NULL`) nên chỉ dòng chưa xoá mềm mới chiếm chỗ.
      // 09/10/2026 — kèm số dữ liệu nghiệp vụ để `xetGhiDanhCu` quyết định dòng "Đã huỷ /
      // Đã rút" có được tự gỡ không (lib/enrollments/ghi-danh-cu-trong-lop.ts).
      sdb.enrollment.findFirst({
        where: whereGhiDanhCu(studentId, classId),
        select: SELECT_GHI_DANH_CU,
      }),
      sdb.student.findFirst({
        where: { id: studentId, deletedAt: null },
        select: { id: true, centerId: true },
      }),
    ]);
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu khi kiểm tra dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  if (!cls) return { ok: false, error: "Không tìm thấy lớp" };
  if (cls.status === "CANCELLED" || cls.status === "COMPLETED") {
    return {
      ok: false,
      error: `Lớp đang ở trạng thái ${cls.status}, không thể đăng ký mới`,
    };
  }
  if (cls._count.enrollments >= cls.maxStudents) {
    return {
      ok: false,
      error: `Lớp đã đủ HS (${cls.maxStudents} chỗ). Hãy chọn lớp khác.`,
    };
  }
  // 09/10/2026 — trước đây MỌI dòng cũ đều chặn, kể cả "Đã huỷ" (gỡ khỏi lớp rồi xếp lại ⇒
  // "Học viên đã có trong lớp này (trạng thái: CANCELLED)"). Nay dòng đã huỷ/rút mà sạch được
  // tự gỡ trong transaction bên dưới; dòng còn sống hoặc đã dính tiền vẫn chặn.
  const ghiDanhCu = xetGhiDanhCu(existing);
  const cauChanCu = cauChanGhiDanhCu(ghiDanhCu);
  if (cauChanCu) return { ok: false, error: cauChanCu };
  if (!student) return { ok: false, error: "Không tìm thấy học viên" };

  // QA 21/07 (B1) — mirror rule §15.1(2) của luồng gán chuẩn (lib/lms/assign):
  // học viên phải CÙNG CƠ SỞ với lớp. Trước đây /enrollments/new là "cửa sau"
  // cho HS CS2 vào lớp CS1 (đổi trạng thái sau đó fail im lặng vì cross-center).
  const crossErr = crossCenterError(cls.centerId, student.centerId);
  if (crossErr) return { ok: false, error: crossErr };

  // QA 21/07 (B2, siết đợt 2 theo QĐ user) — chặn khi HS đang có BẤT KỲ ghi danh
  // còn học (STUDYING/ACTIVE) ở lớp khác, KHÔNG chỉ cùng khoá (đợt 1 chỉ chặn
  // cùng khoá → HS đang học lớp khoá khác vẫn lọt). Lớp cũ đã xoá mềm không tính
  // (tránh khoá vĩnh viễn HS vì rác test). Cùng khoá → gợi ý Chuyển lớp.
  const liveElsewhere = await sdb.enrollment.findFirst({
    where: {
      studentId,
      classId: { not: classId },
      status: { in: ["STUDYING", "ACTIVE"] },
      class: { deletedAt: null },
    },
    select: { courseId: true, class: { select: { name: true } } },
  });
  if (liveElsewhere) {
    const clsName = liveElsewhere.class?.name ?? "khác";
    return {
      ok: false,
      error:
        liveElsewhere.courseId === cls.courseId
          ? `Học viên đang học khoá này ở lớp "${clsName}" — dùng chức năng Chuyển lớp thay vì tạo ghi danh mới.`
          : `Học viên đang học lớp "${clsName}" — hoàn thành hoặc rút khỏi lớp đó trước khi ghi danh lớp mới.`,
    };
  }

  // FIX 7 — kiểm tra khoá tiên quyết: khoá của lớp có yêu cầu khoá trước không,
  // và học viên đã hoàn thành (Enrollment COMPLETED) chưa.
  const prereq = await checkPrerequisites(studentId, cls.courseId);
  if (!prereq.ok) return prereq;

  // BGĐ 31/07 — TÁI TỤC: khoá trước phải là ghi danh CỦA CHÍNH học viên này
  // (chống gắn nhầm/IDOR). scopedDb tự lọc theo cơ sở.
  if (renewedFromEnrollmentId) {
    const prev = await sdb.enrollment.findFirst({
      where: { id: renewedFromEnrollmentId, studentId },
      select: { id: true },
    });
    if (!prev) {
      return { ok: false, error: "Ghi danh khoá trước không hợp lệ (không thuộc học viên này)" };
    }
  }

  const { actorId, actorName } = getAuditActor(session);

  // FIX-C4 — re-check sĩ số + create trong CÙNG tx (Serializable) chống TOCTOU.
  // (Pre-check phía trên chỉ để UX; tx này mới là chốt chặn quyết định.)
  try {
    const enrollmentId = await runSerializable(sdb, async (tx) => {
      const activeCount = await tx.enrollment.count({
        where: {
          classId,
          status: { in: [...CAPACITY_COUNT_STATUSES] },
          deletedAt: null, // FIX-C3 (B2a) — không đếm enrollment đã xóa mềm
        },
      });
      if (activeCount >= cls!.maxStudents) {
        throw new EnrollmentWorkflowError("CLASS_FULL");
      }
      // Dòng cũ "Đã huỷ / Đã rút" sạch ⇒ xoá mềm TRƯỚC khi tạo dòng mới (giải phóng chỉ mục
      // duy nhất). Phép ghi có điều kiện — dòng vừa bị gắn tiền ⇒ ném ⇒ rollback cả lượt.
      if (ghiDanhCu.loai === "GO_DUOC") {
        await goGhiDanhCuDaKetThuc(tx, ghiDanhCu.id, new Date());
        await writeAudit({
          actor: { id: actorId, name: actorName },
          module: "enrollment",
          entityType: "Enrollment",
          entityId: ghiDanhCu.id,
          action: "DELETE",
          oldValues: { studentId, classId, status: ghiDanhCu.status },
          newValues: { lyDo: "Tự gỡ ghi danh đã kết thúc để xếp lại vào cùng lớp" },
          orgUnitId: cls!.centerId,
          tx,
        });
      }
      const created = await tx.enrollment.create({
        data: {
          student: { connect: { id: studentId } },
          class: { connect: { id: classId } },
          course: { connect: { id: cls!.courseId } },
          centerId: cls!.centerId, // FL3-02 — denormalize từ class cho scopedDb
          status: "PENDING",
          notes,
          // BGĐ 31/07 — liên kết tái tục (đã verify thuộc cùng HV ở trên).
          ...(renewedFromEnrollmentId
            ? { renewedFrom: { connect: { id: renewedFromEnrollmentId } } }
            : {}),
        },
        select: { id: true },
      });
      // P3 (additive): ghi AuditLog hợp nhất cho viewer chung (atomic với create).
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "enrollment",
        entityType: "Enrollment",
        entityId: created.id,
        action: "CREATE",
        newValues: {
          studentId,
          classId,
          courseId: cls!.courseId,
          status: "PENDING",
          ...(renewedFromEnrollmentId ? { renewedFromEnrollmentId } : {}),
        },
        orgUnitId: cls!.centerId,
        tx,
      });
      // US-03 chat — ghi danh mới (PENDING chưa "thuộc lớp" → sync no-op, nhưng giữ
      // điểm gọi để mọi đường tạo enrollment đều đi qua service).
      await syncConversationMembership(tx, classId);
      return created.id;
    });

    // Dòng lịch sử trên hồ sơ lead — SAU transaction, cửa BỎ QUA LỖI (đường này chạm
    // tiền: ghi danh là gốc của công nợ). `layNguCanhGhiDanh` trả null cho học viên chưa
    // từng đi qua convert, và null là câu trả lời ĐÚNG: không có lead nào để kể.
    const nguCanh = await layNguCanhGhiDanh(enrollmentId);
    if (nguCanh) {
      await ghiTuongTacLeadBoQuaLoi({
        leadId: nguCanh.leadId,
        actorId,
        actorName,
        moc: new Date(),
        sk: { viec: "ghi-danh.them", tenCon: nguCanh.tenCon, tenLop: nguCanh.tenLop },
      });
    }

    revalidatePath("/enrollments");
    revalidatePath(`/classes/${classId}/edit`);
    return { ok: true, data: { enrollmentId } };
  } catch (err) {
    if (err instanceof ChuyenLopError) {
      // Câu của `chuyenLopTrongTx` đã viết cho người dùng đọc — chở thẳng ra, đừng bọc
      // thêm "Transfer thất bại:" vào trước.
      return { ok: false, error: err.message };
    }
    if (err instanceof EnrollmentWorkflowError || err instanceof GhiDanhCuDaDoiError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

const ChangeStatusSchema = z.object({
  enrollmentId: z.string(),
  newStatus: z.enum(ALL_NEW_STATUSES),
  reason: z.string().min(5, "Lý do phải có ít nhất 5 ký tự"),
});

export async function changeEnrollmentStatus(
  input: z.infer<typeof ChangeStatusSchema>,
): Promise<WorkflowResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("enrollments:edit"))) {
    return { ok: false, error: "Không có quyền đổi trạng thái" };
  }

  const parsed = ChangeStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const uid = session.user.id;
  if (!uid) return { ok: false, error: "Phiên không hợp lệ" };
  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);

  const enrollment = await sdb.enrollment.findUnique({
    where: { id: data.enrollmentId },
    // ⚠️ select kèm centerId — findUnique trên model scoped lọc hậu kỳ theo field này.
    select: {
      id: true,
      centerId: true,
      status: true,
      classId: true,
      class: { select: { centerId: true } },
    },
  });
  if (!enrollment) return { ok: false, error: "Không tìm thấy enrollment" };

  // Cách ly cơ sở: enrollment phải thuộc lớp trong tầm nhìn actor (chống IDOR ghi).
  if (!passesScope("Class", { centerId: enrollment.class?.centerId ?? null }, actor)) {
    return { ok: false, error: "Không tìm thấy enrollment" };
  }

  if (enrollment.status === data.newStatus) {
    return { ok: false, error: "Trạng thái không thay đổi" };
  }
  if (enrollment.status === "TRANSFERRED") {
    return {
      ok: false,
      error: "Không thể đổi trạng thái cho enrollment đã chuyển lớp",
    };
  }

  // FIX-H4 — chặn nhảy trạng thái phi lý theo state machine (vd CANCELLED→ACTIVE,
  // COMPLETED→PENDING). Mã lỗi INVALID_TRANSITION để FE map message.
  if (
    !canTransition(
      enrollment.status as EnrollmentStatus,
      data.newStatus as EnrollmentStatus,
    )
  ) {
    return { ok: false, error: "INVALID_TRANSITION" };
  }

  // Capacity check needed only when moving INTO a capacity-counted state from a
  // non-counted one (e.g. PAUSED/COMPLETED → CONFIRMED).
  const needsCapacityCheck =
    CAPACITY_COUNT_STATUSES.includes(
      data.newStatus as (typeof CAPACITY_COUNT_STATUSES)[number],
    ) &&
    !CAPACITY_COUNT_STATUSES.includes(
      enrollment.status as (typeof CAPACITY_COUNT_STATUSES)[number],
    );

  const timestamps: Prisma.EnrollmentUpdateInput = {};
  if (data.newStatus === "CONFIRMED") timestamps.confirmedAt = new Date();
  if (data.newStatus === "STUDYING") timestamps.startedAt = new Date();
  if (data.newStatus === "COMPLETED" || data.newStatus === "WITHDREW") {
    timestamps.endedAt = new Date();
  }

  const { actorId, actorName } = getAuditActor(session);

  // FIX-C4 — re-check sĩ số + update + audit trong CÙNG tx (Serializable).
  try {
    await runSerializable(sdb, async (tx) => {
      if (needsCapacityCheck) {
        const cls = await tx.class.findUnique({
          where: { id: enrollment.classId },
          select: { maxStudents: true },
        });
        const activeCount = await tx.enrollment.count({
          where: {
            classId: enrollment.classId,
            status: { in: [...CAPACITY_COUNT_STATUSES] },
            deletedAt: null, // FIX-C3 (B2a)
          },
        });
        if (cls && activeCount >= cls.maxStudents) {
          throw new EnrollmentWorkflowError("CLASS_FULL");
        }
      }
      await tx.enrollment.update({
        where: { id: data.enrollmentId },
        data: { status: data.newStatus, ...timestamps },
      });
      await tx.enrollmentAuditLog.create({
        data: {
          enrollmentId: data.enrollmentId,
          fromStatus: enrollment.status,
          toStatus: data.newStatus,
          changedByUserId: session.user.id ?? null,
          changedByName:
            session.user.name ?? session.user.email ?? session.user.id,
          reason: data.reason,
        },
      });
      // P3 (additive): cũng ghi vào AuditLog hợp nhất cho viewer chung.
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "enrollment",
        entityType: "Enrollment",
        entityId: data.enrollmentId,
        action: "STATUS_CHANGE",
        oldValues: { status: enrollment.status },
        newValues: { status: data.newStatus },
        reason: data.reason,
        orgUnitId: enrollment.class?.centerId ?? null,
        tx,
      });
      // US-03 chat — đổi trạng thái ghi danh (WITHDREW/COMPLETED/CANCELLED ⇒ PH rời
      // nhóm; CONFIRMED từ PENDING ⇒ PH vào nhóm) — cùng transaction.
      await syncConversationMembership(tx, enrollment.classId);
    });
  } catch (err) {
    if (err instanceof EnrollmentWorkflowError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  {
    const nguCanh = await layNguCanhGhiDanh(data.enrollmentId);
    if (nguCanh) {
      await ghiTuongTacLeadBoQuaLoi({
        leadId: nguCanh.leadId,
        ...getAuditActor(session),
        moc: new Date(),
        sk: {
          viec: "ghi-danh.doi-trang-thai",
          tenCon: nguCanh.tenCon,
          tenLop: nguCanh.tenLop,
          tu: enrollment.status as EnrollmentStatus,
          den: data.newStatus as EnrollmentStatus,
        },
      });
    }
  }

  revalidatePath("/enrollments");
  revalidatePath(`/enrollments/${data.enrollmentId}/edit`);
  revalidatePath(`/classes/${enrollment.classId}/edit`);
  return { ok: true };
}

const TransferSchema = z.object({
  enrollmentId: z.string(),
  targetClassId: z.string().min(1, "Chọn lớp đích"),
  reason: z.string().min(5, "Lý do phải có ít nhất 5 ký tự"),
});

export async function transferEnrollment(
  input: z.infer<typeof TransferSchema>,
): Promise<WorkflowResult<{ newEnrollmentId: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("enrollments:transfer"))) {
    return { ok: false, error: "Không có quyền chuyển lớp" };
  }

  const parsed = TransferSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const uid = session.user.id;
  if (!uid) return { ok: false, error: "Phiên không hợp lệ" };
  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);

  const oldEnrollment = await sdb.enrollment.findUnique({
    where: { id: data.enrollmentId },
    // ⚠️ select kèm centerId — findUnique trên model scoped lọc hậu kỳ theo field này.
    select: {
      id: true,
      centerId: true,
      status: true,
      studentId: true,
      classId: true,
      class: { select: { centerId: true } },
    },
  });
  if (!oldEnrollment) return { ok: false, error: "Không tìm thấy enrollment cũ" };

  // Cách ly cơ sở: lớp NGUỒN + lớp ĐÍCH đều phải trong tầm nhìn actor (chống IDOR).
  if (!passesScope("Class", { centerId: oldEnrollment.class?.centerId ?? null }, actor)) {
    return { ok: false, error: "Không tìm thấy enrollment cũ" };
  }
  if (!(await classCenterInScope(sdb, actor, data.targetClassId))) {
    return { ok: false, error: "Không tìm thấy lớp đích" };
  }

  if (oldEnrollment.classId === data.targetClassId) {
    return { ok: false, error: "Lớp đích trùng lớp hiện tại" };
  }
  if (
    TERMINAL_STATUSES.includes(
      oldEnrollment.status as (typeof TERMINAL_STATUSES)[number],
    )
  ) {
    return {
      ok: false,
      error: `Không thể chuyển enrollment đang ${oldEnrollment.status}`,
    };
  }

  const targetClass = await sdb.class.findFirst({
    where: { id: data.targetClassId, deletedAt: null },
    select: {
      id: true,
      // Tên lớp ĐÍCH cho dòng lịch sử ("Chuyển An từ lớp A sang lớp B").
      name: true,
      courseId: true,
      centerId: true,
      maxStudents: true,
      status: true,
      _count: {
        select: {
          enrollments: {
            where: { status: { in: [...CAPACITY_COUNT_STATUSES] } },
          },
        },
      },
    },
  });
  if (!targetClass) return { ok: false, error: "Không tìm thấy lớp đích" };
  if (targetClass.status === "CANCELLED" || targetClass.status === "COMPLETED") {
    return { ok: false, error: `Lớp đích đang ${targetClass.status}` };
  }
  if (targetClass._count.enrollments >= targetClass.maxStudents) {
    return {
      ok: false,
      error: `Lớp đích đã đủ HS (${targetClass.maxStudents} chỗ)`,
    };
  }

  // FIX-C3 (B2b) — findFirst thay findUnique (compound unique đã bỏ); base
  // soft-delete hook tự lọc deletedAt:null → chỉ thấy enrollment CÒN SỐNG ở lớp đích.
  const existing = await sdb.enrollment.findFirst({
    where: {
      studentId: oldEnrollment.studentId,
      classId: data.targetClassId,
    },
    select: { status: true },
  });
  if (existing) {
    return {
      ok: false,
      error: `HS đã có enrollment ở lớp đích (status: ${existing.status})`,
    };
  }

  const { actorId, actorName } = getAuditActor(session);

  try {
    // ⚠️ Thân phép chuyển lớp ĐÃ DỜI sang `lib/enrollments/chuyen-lop.ts` [F4 · 22/09/2026].
    //
    // Lý do: F4 ("đổi khoá / đổi lớp") cần ĐÚNG phép này nhưng phải chạy TRONG transaction
    // tiền (`ghiTienChoDon`), vì `confirmPayment` từ chối khoản chưa gắn ghi danh — tiền
    // chuyển sang dòng mới mà dòng ấy chưa có ghi danh là khoản KHÔNG BAO GIỜ xuất được
    // phiếu thu. Chép luật sang chỗ thứ hai thì có ngày hai bản lệch nhau; tách ra thì chỉ
    // còn một chỗ để vá.
    //
    // Vẫn `runSerializable`: kiểm sĩ số lớp đích chống TOCTOU nằm bên trong hàm được tách.
    const newId = await runSerializable(sdb, async (tx) => {
      const kq = await chuyenLopTrongTx(tx as unknown as Prisma.TransactionClient, {
        oldEnrollmentId: oldEnrollment.id,
        targetClassId: data.targetClassId,
        reason: data.reason,
        actor: { id: actorId, name: actorName },
      });
      return kq.newEnrollmentId;
    });

    // Đọc ngữ cảnh từ ghi danh CŨ: nó mang `leadChildId` (nếu có), còn ghi danh mới thì
    // không — `tx.enrollment.create` ở trên không set cột đó, và CỐ Ý không set (xem
    // `layNguCanhGhiDanh`). Lớp MỚI lấy từ `targetClass`, đã đọc sẵn ở trên.
    const nguCanh = await layNguCanhGhiDanh(oldEnrollment.id);
    if (nguCanh) {
      await ghiTuongTacLeadBoQuaLoi({
        leadId: nguCanh.leadId,
        actorId,
        actorName,
        moc: new Date(),
        sk: {
          viec: "ghi-danh.chuyen-lop",
          tenCon: nguCanh.tenCon,
          lopCu: nguCanh.tenLop,
          lopMoi: targetClass.name,
        },
      });
    }

    revalidatePath("/enrollments");
    revalidatePath(`/classes/${oldEnrollment.classId}/edit`);
    revalidatePath(`/classes/${data.targetClassId}/edit`);
    revalidatePath(`/enrollments/${oldEnrollment.id}/edit`);
    return { ok: true, data: { newEnrollmentId: newId } };
  } catch (err) {
    if (err instanceof EnrollmentWorkflowError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: `Transfer thất bại: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}
