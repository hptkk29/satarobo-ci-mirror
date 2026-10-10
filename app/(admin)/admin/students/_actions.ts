"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { requestOtp, issueOfflineOtp } from "@/lib/otp/service";
import { describeOtpSendError } from "@/lib/otp/messages";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EnrollmentStatus, Prisma } from "@prisma/client";
import { hasRole, type Action } from "@/lib/auth/permissions";
import {
  canViewLeadPii,
  checkPermission,
  checkPermissionDetail,
} from "@/lib/auth/check-permission";
import { centerIdForOrgUnit } from "@/lib/org/org-service";
import { rejectHeadOffice } from "@/lib/enrollment-flow";
import {
  studentCreateSchema,
  studentUpdateSchema,
  PHONE_MASK_RE,
  PHONE_MASK_MSG,
} from "@/lib/validators/student";
import {
  logStudentAudit,
  getAuditActor,
  logUserAudit,
} from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { sendEmailForTrigger } from "@/lib/email/trigger";
import { genStudentCode } from "@/lib/codegen";
import { canTransition } from "@/lib/enrollments/status";
import {
  removeStudentFromClasses,
  REMOVABLE_ENROLLMENT_STATUSES,
  type RemovedEnrollment,
} from "@/lib/students/remove-from-classes";
import { nghiHocHan, type GhiDanhBoQuaHoanTien } from "@/lib/students/withdraw";
import { apDungDoiHanBaoLuu } from "@/lib/finance/bao-luu-tien";
import { STUDYING_ENROLLMENT_STATUSES } from "@/lib/enrollment-status";
import {
  syncConversationMembership,
  CHAT_MEMBER_ENROLLMENT_STATUSES,
} from "@/lib/chat/sync-membership";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { formatDateVN } from "@/lib/format/date";
import { canonicalPhone, phoneVariants } from "@/lib/phone";
import { phoneSearchTerm } from "@/lib/phone";
import { ghiHoSoHocVien, SNAPSHOT_HO_SO } from "@/lib/students/ghi-ho-so";
import { quyetDinhMaHocVien } from "./_lib/ma-hoc-vien";
// 25/09/2026 — đọc form tách ra file thuần (file này là 'use server', không test được).
// Luật "vắng ⇒ không đụng · rỗng ⇒ xoá" + lọc khoá sau parse: xem đầu doc-form.ts.
import { docFormHocVien, chiGiuKhoaCoMat, uuTienTheoCoSoMoi } from "./_lib/doc-form";
import { laUrlAnhHocVien } from "@/lib/students/anh-dai-dien-url";
import { getR2PublicUrl } from "@/lib/storage/r2-client";

type ActionResult = { error?: string };

/** Sentinel để huỷ $transaction phục học khi transition enrollment phi lý. */
const INVALID_RESUME_TRANSITION = "__INVALID_RESUME_TRANSITION__";

// Cách ly cơ sở (chống IDOR ghi): Student ∈ SCOPED_MODELS. Mọi mutation theo
// studentId từ client phải xác minh HV thuộc tầm nhìn cơ sở của actor.
// GHI đối xứng với ĐỌC (vá 24/07): scope per-model qua passesScope — role HO không
// có quyền students:* (Toại TRAINING@HO) không được tạo/chuyển HV cơ sở khác.
function actorCanUseCenter(actor: Actor, centerId: string | null): boolean {
  return passesScope("Student", { centerId }, actor);
}

/** Trả về true nếu HV `studentId` nằm trong tầm nhìn cơ sở của user. */
async function studentInScope(
  userId: string | undefined,
  studentId: string,
): Promise<boolean> {
  if (!userId) return false;
  const actor = await resolveActor(userId);
  // Vá 24/07: bỏ bypass isHoLevel trần — scoped read đã per-model (role HO có quyền
  // students: → ALL vẫn qua; role HO khác chức năng, vd TRAINING, → theo scope).
  if (actor.isSuperAdmin) return true;
  const sdb = scopedDb(actor);
  const s = await sdb.student.findUnique({ where: { id: studentId }, select: { centerId: true } });
  return !!s && passesScope("Student", s, actor);
}

/**
 * NỢ-2 (US-03 write-path, 09/08): actor có đang bị DENY cấp trường che
 * `parentPhone` không (grant nhóm, key as-built `students:view-all` — cùng key
 * màn edit dùng để mask prefill)? Actor bị che thấy form prefill "090xxxx678";
 * nếu để chuỗi đó đi tiếp vào payload ghi thì số thật trong DB bị phá.
 */
async function isParentPhoneMasked(): Promise<boolean> {
  const { fieldMask } = await checkPermissionDetail("students:view-all");
  return fieldMask.includes("parentPhone");
}

async function requireStudentWrite(action: "create" | "update" | "delete") {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const actionMap: Record<typeof action, Action> = {
    create: "students:create",
    update: "students:edit",
    delete: "students:delete",
  };

  if (!(await checkPermission(actionMap[action]))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

// 26/09/2026 — ảnh chụp dời sang `lib/students/ghi-ho-so.ts` (thêm đủ ô chung với lead để
// đồng bộ hai chiều đọc được "trước khi sửa").
const STUDENT_SNAPSHOT_SELECT = SNAPSHOT_HO_SO;

function toData(parsed: ReturnType<typeof studentCreateSchema.parse>): Prisma.StudentCreateInput {
  const {
    preferredCenterId,
    centerId,
    ...rest
  } = parsed;

  return {
    ...rest,
    preferredCenter: preferredCenterId
      ? { connect: { id: preferredCenterId } }
      : undefined,
    center: centerId ? { connect: { id: centerId } } : undefined,
  };
}

function toUpdateData(
  parsed: Partial<ReturnType<typeof studentCreateSchema.parse>>,
): Prisma.StudentUpdateInput {
  const {
    preferredCenterId,
    centerId,
    ...rest
  } = parsed;

  const data: Prisma.StudentUpdateInput = { ...rest };

  if (preferredCenterId !== undefined) {
    data.preferredCenter = preferredCenterId
      ? { connect: { id: preferredCenterId } }
      : { disconnect: true };
  }
  if (centerId !== undefined) {
    data.center = centerId ? { connect: { id: centerId } } : { disconnect: true };
  }

  return data;
}

/**
 * Chủ dự án chốt 04/08: HỌC VIÊN KHÔNG THUỘC HỘI SỞ. HO là cơ quan đầu não, không
 * phải nơi dạy học. Chặn ở server chứ không chỉ giấu khỏi dropdown — form vẫn có
 * thể bị POST thẳng, và học viên nằm ở HO thì kéo theo lớp/điểm danh/học phí sai.
 */
async function rejectHeadOfficeOrgUnit(
  orgUnitId: string | null | undefined,
  resolvedCenterId: string | null | undefined,
): Promise<string | null> {
  return rejectHeadOffice("học viên", { orgUnitId, centerId: resolvedCenterId });
}

export async function createStudent(formData: FormData): Promise<ActionResult> {
  const session = await requireStudentWrite("create");

  const raw = docFormHocVien(formData, "create");
  const parsed = studentCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const { actorId, actorName } = getAuditActor(session);
  const data = parsed.data;

  // 26/09/2026 — mã học viên chỉ Quản trị tối cao đặt tay (`students:change-code`); vai khác
  // để hệ thống tự sinh theo mã cơ sở. Luật: `_lib/ma-hoc-vien.ts`.
  const ma = quyetDinhMaHocVien({
    cheDo: "tao",
    maGui: data.studentCode,
    maHienTai: null,
    duocDoiMa: await checkPermission("students:change-code"),
  });
  if (!ma.ok) return { error: ma.loi };
  data.studentCode = ma.ma ?? null;

  // Ảnh đại diện đến từ ô ẩn của form — client sửa được. Chỉ nhận URL do route upload của
  // hệ thống sinh ra (luật chung với action đổi ảnh — lib/students/anh-dai-dien-url.ts).
  if (data.avatarUrl) {
    let goc: string | null;
    try {
      goc = getR2PublicUrl();
    } catch {
      goc = null;
    }
    if (!goc || !laUrlAnhHocVien(data.avatarUrl, goc)) {
      return { error: "Ảnh đại diện không hợp lệ — hãy tải ảnh lên bằng nút chọn ảnh." };
    }
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // #15 — CCCD PH là PII: chỉ actor có payments:view-pii (kế toán/admin) mới ghi được.
  // Vai khác không thấy ô nhập → chặn set qua formData thủ công (không lộ PII không kiểm soát).
  if (!(await checkPermission("payments:view-pii"))) {
    data.parentNationalId = null;
  }

  // PR-C dual-write: OrgUnit là nguồn chính; suy centerId/preferredCenterId (HO→null).
  data.centerId = await centerIdForOrgUnit(data.orgUnitId ?? null);
  data.preferredCenterId = await centerIdForOrgUnit(data.preferredOrgUnitId ?? null);
  const hoErr = await rejectHeadOfficeOrgUnit(data.orgUnitId ?? null, data.centerId ?? null);
  if (hoErr) return { error: hoErr };

  // Cách ly cơ sở: center-level chỉ tạo HV cho cơ sở trong tầm nhìn.
  if (!actorCanUseCenter(actor, data.centerId ?? null)) {
    return { error: "Không có quyền tạo học viên cho cơ sở này" };
  }

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      // Phase T0.2 — tự sinh studentCode nếu admin để trống (giữ mã cũ nếu có).
      if (!data.studentCode && data.centerId) {
        const center = await tx.center.findUnique({
          where: { id: data.centerId },
          select: { code: true },
        });
        if (center?.code) {
          data.studentCode = await genStudentCode(center.code, tx);
        }
      }

      const created = await tx.student.create({
        data: toData(data),
        select: { id: true, ...STUDENT_SNAPSHOT_SELECT },
      });

      const { id: _id, ...newValues } = created;
      void _id;

      await logStudentAudit({
        studentId: created.id,
        action: "CREATE",
        actorId,
        actorName,
        newValues,
        tx,
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "Mã học viên đã tồn tại" };
    }
    return { error: "Lỗi cơ sở dữ liệu — không tạo được học viên" };
  }

  revalidatePath("/students");
  redirect("/students");
}

export async function updateStudent(id: string, formData: FormData): Promise<ActionResult> {
  const session = await requireStudentWrite("update");

  const raw = docFormHocVien(formData, "update");
  // Ảnh đại diện KHÔNG đi đường này: form sửa không gửi nó, đổi ảnh có action riêng có cổng
  // URL (`datAnhDaiDienHocVien`). Nhận khoá này ở đây là để một POST tay đi vòng qua cổng đó.
  delete raw.avatarUrl;
  // NỢ-2 — actor bị DENY cấp trường parentPhone: form prefill là chuỗi MASK, bấm
  // lưu sẽ ghi chuỗi mask đè số thật. BỎ field khỏi payload TRƯỚC validate (validator
  // giờ từ chối chuỗi mask) → giữ nguyên giá trị DB hiện có, các field khác vẫn lưu.
  // Actor KHÔNG bị mask: không đổi hành vi.
  if (await isParentPhoneMasked()) {
    delete raw.parentPhone;
  }
  const parsed = studentUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const before = await sdb.student.findUnique({
    where: { id },
    select: STUDENT_SNAPSHOT_SELECT,
  });
  if (!before) return { error: "Không tìm thấy học viên" };

  // Cách ly cơ sở: HV hiện tại phải thuộc tầm nhìn actor (chống sửa HV cơ sở khác).
  if (!actorCanUseCenter(actor, before.centerId)) {
    return { error: "Không tìm thấy học viên" };
  }

  const { actorId, actorName } = getAuditActor(session);
  // 25/09/2026 — CHỈ những khoá form thật sự gửi. zod 4 áp `.default()` kể cả qua
  // `.partial()` (status → ACTIVE, allergies → []), nên dùng thẳng `parsed.data` là mỗi
  // lượt sửa không gửi hai ô đó lặng lẽ mở lại HV bảo lưu và xoá sạch dị ứng.
  const data = chiGiuKhoaCoMat(parsed.data, raw);

  // 26/09/2026 — mã học viên chỉ Quản trị tối cao sửa được (`students:change-code`).
  if (data.studentCode !== undefined) {
    const ma = quyetDinhMaHocVien({
      cheDo: "sua",
      maGui: data.studentCode,
      maHienTai: before.studentCode,
      duocDoiMa: await checkPermission("students:change-code"),
    });
    if (!ma.ok) return { error: ma.loi };
    if (ma.ma === undefined) delete data.studentCode;
    else data.studentCode = ma.ma;
  }

  // BUG 21/08 (nguyên nhân 2) — ô "Trạng thái" của form cho chọn thẳng "Nghỉ học".
  // Đường này chỉ ghi `Student.status` và KHÔNG đụng `Enrollment` ⇒ học viên hiện
  // "Nghỉ học" ở /students nhưng VẪN nằm trong lớp ở mọi màn roster (roster đọc từ
  // Enrollment, không đọc Student.status). Không tự ý cascade ở đây: cho nghỉ học là
  // sự kiện có LÝ DO bắt buộc + gỡ khỏi lớp + yêu cầu hoàn tiền + email báo phụ huynh —
  // tất cả nằm ở `withdrawStudentAction`. Chặn tại chỗ và chỉ đúng nút phải bấm.
  if (data.status === "INACTIVE" && before.status !== "INACTIVE") {
    return {
      error:
        'Không đặt "Nghỉ học" từ ô Trạng thái. Dùng nút "Nghỉ học hẳn" ở đầu trang hồ ' +
        "sơ — nút đó mới gỡ học viên khỏi lớp, ghi lý do và tạo yêu cầu hoàn tiền.",
    };
  }

  // #15 — CCCD PH là PII: chỉ actor có payments:view-pii mới sửa. Vai khác GIỮ NGUYÊN
  // giá trị cũ → bỏ field khỏi payload update (không ghi đè null/rỗng, không lộ PII qua form).
  if (!(await checkPermission("payments:view-pii"))) {
    delete data.parentNationalId;
  }

  // PR-C dual-write: nếu đổi đơn vị → suy centerId/preferredCenterId (HO→null).
  if (data.orgUnitId !== undefined) {
    data.centerId = await centerIdForOrgUnit(data.orgUnitId ?? null);
  }
  if (data.preferredOrgUnitId !== undefined) {
    data.preferredCenterId = await centerIdForOrgUnit(data.preferredOrgUnitId ?? null);
  }
  // Đổi cơ sở mà "cơ sở ưu tiên" chỉ là bản sao của cơ sở cũ ⇒ dời theo (form đã bỏ ô ưu
  // tiên — D3 — nên không còn chỗ nào khác sửa được cột này; xem `uuTienTheoCoSoMoi`).
  if (data.orgUnitId !== undefined && raw.preferredOrgUnitId === undefined) {
    const uuTienCu = await sdb.student.findUnique({
      where: { id },
      select: { preferredCenterId: true },
    });
    const doi = uuTienTheoCoSoMoi({
      truoc: { centerId: before.centerId, preferredCenterId: uuTienCu?.preferredCenterId ?? null },
      centerIdMoi: data.centerId,
      orgUnitIdMoi: data.orgUnitId,
      formGuiUuTien: false,
    });
    if (doi) {
      data.preferredCenterId = doi.preferredCenterId;
      data.preferredOrgUnitId = doi.preferredOrgUnitId;
    }
  }
  // Đổi cơ sở → cơ sở đích cũng phải trong tầm nhìn actor.
  if (data.centerId !== undefined) {
    if (!actorCanUseCenter(actor, data.centerId ?? null)) {
      return { error: "Không có quyền chuyển học viên sang cơ sở này" };
    }
  }

  // Lead / anh chị em bị đổi theo — gom lại để revalidate SAU transaction.
  let syncedLeadIds: string[];
  let syncedStudentIds: string[];
  try {
    // 26/09/2026 — lượt ghi + nhật ký + mọi bản sao đổi theo (tên con ở CRM 08/08; phụ huynh,
    // địa chỉ, ngày sinh/giới tính/trường/lớp của con ở phiếu lead nguồn + anh chị em — chủ
    // dự án 26/09: "đổi 1 nơi thì các nơi khác phải đổi hết") đi CHUNG một transaction.
    // Chạy ở lib trên client KHÔNG scope: phiếu lead / anh chị em ở cơ sở khác vẫn phải đổi
    // theo — xem đầu `lib/students/ghi-ho-so.ts`. Quyền + cơ sở đã kiểm ở trên.
    const res = await ghiHoSoHocVien({
      studentId: id,
      data: toUpdateData(data),
      truoc: before,
      actor: { id: actorId, name: actorName },
    });
    syncedLeadIds = res.leadIds;
    syncedStudentIds = res.studentIds;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "Mã học viên đã tồn tại" };
    }
    return { error: "Học viên không tồn tại hoặc lỗi cơ sở dữ liệu" };
  }

  revalidatePath("/students");
  revalidatePath(`/students/${id}/edit`);
  for (const sid of syncedStudentIds) revalidatePath(`/students/${sid}/edit`);
  if (syncedLeadIds.length > 0) {
    revalidatePath("/leads");
    for (const leadId of syncedLeadIds) revalidatePath(`/leads/${leadId}`);
    // Màn Lớp Trial đọc LeadChild.fullName.
    // GĐ6 — gỡ luôn `revalidatePath("/hoc-thu")`: route đó KHÔNG TỒN TẠI, là rác của
    // một lần đổi tên trước. revalidatePath sai đường là no-op câm, không lỗi build,
    // không lỗi chạy — nên nó nằm đây bao lâu cũng không ai phát hiện.
    revalidatePath("/lop-trial");
    revalidatePath("/lop-trial/lich-hen");
  }
  redirect("/students");
}

export async function deleteStudent(id: string): Promise<ActionResult> {
  const session = await requireStudentWrite("delete");

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const before = await sdb.student.findUnique({
    where: { id },
    select: STUDENT_SNAPSHOT_SELECT,
  });
  if (!before) return { error: "Không thể xoá học viên này" };
  // Cách ly cơ sở: chỉ xoá HV trong tầm nhìn actor (chống IDOR xoá liên cơ sở).
  if (!actorCanUseCenter(actor, before.centerId)) {
    return { error: "Không thể xoá học viên này" };
  }
  if (before.status !== "INACTIVE") {
    return { error: "Chỉ xóa được học viên đã nghỉ học" };
  }

  const { actorId, actorName } = getAuditActor(session);

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      // Soft delete — Student has deletedAt
      await tx.student.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      // Sự cố 07/08/2026: trước đây dừng ở đây → ghi danh vẫn "sống", nên HV đã xoá
      // vẫn nằm trong lớp ở /admin/classes/<id>/students, tab Học viên site GV, bảng
      // điểm danh… (mọi màn đó đọc từ Enrollment chứ không từ Student). Gỡ khỏi lớp
      // trong CÙNG transaction. Đổi status, KHÔNG set Enrollment.deletedAt — xem lý do
      // (sổ sách) trong lib/students/remove-from-classes.ts.
      // KHÔNG tạo yêu cầu hoàn tiền ở đây: đó là việc của luồng "Nghỉ học"
      // (withdrawStudentAction); xoá bản ghi là thao tác dọn dữ liệu, không phải sự kiện
      // học viên rời lớp.
      await removeStudentFromClasses({
        tx,
        studentId: id,
        actorId,
        actorName,
        reason: "Xoá học viên khỏi hệ thống",
        orgUnitId: before.centerId,
      });

      // 21/08 — DẤU VẾT "đã từng học ở cơ sở nào". Xoá học viên là xoá MỀM, nhưng
      // `Student.deletedAt` không nói được em học ở đâu, từ bao giờ tới bao giờ; còn
      // `StudentCenterHistory` trước nay CHỈ được ghi khi duyệt chuyển cơ sở
      // (`lib/transfer/service.ts:208`) nên học viên chưa từng chuyển thì không có dòng nào.
      // Chốt sổ tại đây để sau này sale cơ sở KHÁC tra ra khách cũ
      // (`lib/students/prior-history.ts`) — đúng yêu cầu "vẫn lưu giữ lead đã từng học tại cơ sở đó".
      if (before.centerId) {
        const openRows = await tx.studentCenterHistory.count({
          where: { studentId: id, toDate: null },
        });
        if (openRows === 0) {
          await tx.studentCenterHistory.create({
            data: {
              studentId: id,
              // StudentCenterHistory ∈ SCOPED_MODELS ⇒ create BẮT BUỘC có centerId,
              // quên là dòng vô hình với chính cơ sở đó.
              centerId: before.centerId,
              reason: "Chốt sổ khi xoá học viên khỏi hệ thống",
            },
          });
        }
        await tx.studentCenterHistory.updateMany({
          where: { studentId: id, toDate: null },
          data: { toDate: new Date() },
        });
      }

      await logStudentAudit({
        studentId: id,
        action: "DELETE",
        actorId,
        actorName,
        oldValues: before,
        tx,
      });

      // P3 (additive): also write to unified AuditLog.
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "students",
        entityType: "Student",
        entityId: id,
        action: "DELETE",
        oldValues: before,
        orgUnitId: before.centerId,
        tx,
      });
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch {
    return { error: "Không thể xoá học viên này" };
  }
  revalidatePath("/students");
  // Roster lớp + danh sách ghi danh vừa đổi theo → phải làm mới, nếu không admin vẫn
  // thấy HV cũ trong lớp cho tới lần build lại (đúng triệu chứng đã báo 07/08).
  revalidatePath("/classes");
  revalidatePath("/enrollments");
  return {};
}

// ═══════════════════════════════════════════════════════════════════
// Phase 5.9 — Lifecycle actions: reserve / resume / withdraw / reactivate
// All actions are atomic via db.$transaction. Student status changes go
// through logStudentAudit (Sprint 5.4); enrollment status changes go
// through the existing EnrollmentAuditLog table.
// Permission gate: students:edit (state mutations are an edit operation).
// ═══════════════════════════════════════════════════════════════════

async function requireStudentLifecycle() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("students:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

// ─── RESERVE STUDENT ────────────────────────────────────────────────
export async function reserveStudentAction(input: {
  studentId: string;
  enrollmentId?: string | null;
  reason: string;
  expectedEndAt?: string | null;
}) {
  const session = await requireStudentLifecycle();

  if (!input.reason?.trim()) {
    return { ok: false as const, error: "Vui lòng nhập lý do bảo lưu" };
  }
  if (input.reason.length > 1000) {
    return { ok: false as const, error: "Lý do quá dài (max 1000 ký tự)" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const student = await sdb.student.findFirst({
    where: { id: input.studentId, deletedAt: null },
    select: { id: true, status: true, name: true, centerId: true },
  });
  if (!student) {
    return { ok: false as const, error: "Không tìm thấy học viên" };
  }
  // Cách ly cơ sở: HV phải thuộc tầm nhìn actor.
  if (!(await studentInScope(session.user.id, input.studentId))) {
    return { ok: false as const, error: "Không tìm thấy học viên" };
  }

  const existing = await sdb.studentReserve.findFirst({
    where: { studentId: input.studentId, isActive: true },
    select: { id: true, startedAt: true },
  });
  if (existing) {
    return {
      ok: false as const,
      error: `Học viên đã đang bảo lưu (từ ${formatDateVN(existing.startedAt)})`,
    };
  }

  // 21/08 — trước đây chốt cứng `!== "STUDYING"`. `Enrollment.status` mặc định của schema
  // LÀ `ACTIVE` và convert lead không truyền status ⇒ đa số học viên thật KHÔNG bảo lưu
  // được, báo lỗi "Chỉ có thể bảo lưu lớp đang STUDYING" dù em đang học bình thường.
  // State machine vốn đã cho `ACTIVE → PAUSED` (lib/enrollments/status.ts:23).
  let singleEnrollmentStatus: EnrollmentStatus | null = null;
  if (input.enrollmentId) {
    const enr = await sdb.enrollment.findFirst({
      where: { id: input.enrollmentId, studentId: input.studentId },
      select: { id: true, status: true },
    });
    if (!enr) {
      return {
        ok: false as const,
        error: "Đăng ký không tồn tại hoặc không thuộc học viên này",
      };
    }
    if (!STUDYING_ENROLLMENT_STATUSES.includes(enr.status)) {
      return {
        ok: false as const,
        error: "Chỉ bảo lưu được ghi danh đang học",
      };
    }
    singleEnrollmentStatus = enr.status;
  }

  const { actorId, actorName } = getAuditActor(session);

  // F2 — cần `id` của lượt bảo lưu vừa tạo để áp phần TIỀN sau khi commit. Trước bản này
  // `create` không `select` gì và transaction không trả gì.
  const reserveIdVuaTao = await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    const luot = await tx.studentReserve.create({
      data: {
        studentId: input.studentId,
        enrollmentId: input.enrollmentId ?? null,
        reason: input.reason.trim(),
        expectedEndAt: input.expectedEndAt
          ? new Date(input.expectedEndAt)
          : null,
        createdByUserId: actorId,
        createdByName: actorName,
        isActive: true,
      },
      select: { id: true },
    });

    if (student.status === "ACTIVE") {
      await tx.student.update({
        where: { id: input.studentId },
        data: { status: "PAUSED" },
      });

      await logStudentAudit({
        studentId: input.studentId,
        action: "UPDATE",
        actorId,
        actorName,
        oldValues: { status: student.status },
        newValues: { status: "PAUSED" },
        changedFields: ["status"],
        reason: `Bảo lưu: ${input.reason.trim()}`,
        tx,
      });

      // P3 (additive): also write to unified AuditLog.
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "students",
        entityType: "Student",
        entityId: input.studentId,
        action: "STATUS_CHANGE",
        oldValues: { status: student.status },
        newValues: { status: "PAUSED" },
        changedFields: ["status"],
        reason: `Bảo lưu: ${input.reason.trim()}`,
        orgUnitId: student.centerId,
        tx,
      });
    }

    const enrollmentsToPause =
      input.enrollmentId && singleEnrollmentStatus
        // Dùng status THẬT vừa đọc, không chốt "STUDYING": ghi sai `fromStatus` là làm
        // hỏng lịch sử ghi danh (bản cũ luôn ghi STUDYING kể cả khi thực tế là ACTIVE).
        ? [{ id: input.enrollmentId, status: singleEnrollmentStatus }]
        : await tx.enrollment.findMany({
            where: {
              studentId: input.studentId,
              status: { in: STUDYING_ENROLLMENT_STATUSES },
            },
            select: { id: true, status: true },
          });

    for (const enr of enrollmentsToPause) {
      await tx.enrollment.update({
        where: { id: enr.id },
        data: { status: "PAUSED" },
      });

      await tx.enrollmentAuditLog.create({
        data: {
          enrollmentId: enr.id,
          fromStatus: enr.status,
          toStatus: "PAUSED",
          changedByUserId: actorId,
          changedByName: actorName,
          reason: input.reason.trim(),
        },
      });

      // P3 (additive): also write to unified AuditLog.
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "students",
        entityType: "Enrollment",
        entityId: enr.id,
        action: "STATUS_CHANGE",
        oldValues: { status: enr.status },
        newValues: { status: "PAUSED" },
        changedFields: ["status"],
        reason: input.reason.trim(),
        orgUnitId: student.centerId,
        tx,
      });
    }

    return luot.id;
  });

  // ── F2 · US-18 AC2 — phần TIỀN của lượt bảo lưu ────────────────────────────
  //
  // Dời hạn các đợt CHƯA TỚI HẠN của con. Chạy SAU khi bảo lưu đã commit, KHÔNG nằm trong
  // transaction trên: mọi phép ghi lên sổ tiền của đơn phải đi qua `ghiTienChoDon` (khoá
  // advisory theo `orderId`), và một lượt bảo lưu có thể chạm NHIỀU đơn — lồng nhiều khoá
  // đơn vào transaction học vụ là mời deadlock.
  //
  // ⚠️ Hỏng ở đây KHÔNG được làm hỏng lượt bảo lưu: bé đã bảo lưu là việc học vụ đã xong.
  // Hỏng thì hạn giữ nguyên, và con VẪN KHÔNG bị báo quá hạn (phép tha đọc `StudentReserve`
  // chứ không đọc kết quả hàm này — xem `locDotCuaConDangBaoLuu`). Nên nó trả về một CẢNH
  // BÁO cho người bấm, không ném; và `apDungDoiHanBaoLuu` an toàn khi gọi lại.
  let canhBaoTien: string | undefined;
  if (reserveIdVuaTao) {
    try {
      const tien = await apDungDoiHanBaoLuu({
        reserveId: reserveIdVuaTao,
        actor: { id: actorId, name: actorName },
      });
      if (!tien.ok) canhBaoTien = `Chưa dời được hạn đợt thu: ${tien.error}`;
      else if (tien.soDotDaDoi > 0) {
        for (const orderId of tien.donDaCham) revalidatePath(`/orders/${orderId}`);
      }
    } catch (err) {
      console.error("[bao-luu] dời hạn đợt thất bại:", err);
      canhBaoTien = "Đã bảo lưu, nhưng CHƯA dời được hạn các đợt thu — nhờ kế toán kiểm lại.";
    }
  }

  revalidatePath("/students");
  revalidatePath(`/students/${input.studentId}/edit`);

  const studentForEmail = await sdb.student.findUnique({
    where: { id: input.studentId },
    select: { name: true, parentName: true, parentEmail: true },
  });
  if (studentForEmail) {
    sendEmailForTrigger({
      trigger: "RESERVATION_NOTICE",
      recipient: {
        email: studentForEmail.parentEmail,
        name: studentForEmail.parentName,
      },
      vars: {
        student_name: studentForEmail.name,
        parent_name: studentForEmail.parentName ?? "Quý phụ huynh",
        started_at: new Date(),
        expected_end_at: input.expectedEndAt
          ? new Date(input.expectedEndAt)
          : null,
        reason: input.reason.trim(),
      },
      context: { type: "Student", id: input.studentId },
      triggerType: "SYSTEM",
      actor: { userId: actorId, name: actorName },
    }).catch((err) => {
      console.error("[email] RESERVATION_NOTICE trigger error:", err);
    });
  }

  // `canhBaoTien` CHỈ có khi phần tiền hỏng. Người bấm phải thấy nó — bảo lưu xong mà hạn
  // chưa dời là một việc còn phải làm, và một `{ ok: true }` trơn nói ngược điều đó.
  return { ok: true as const, canhBaoTien };
}

// ─── RESUME RESERVE ─────────────────────────────────────────────────
export async function resumeStudentReserveAction(input: {
  reserveId: string;
  endReason?: string | null;
}) {
  const session = await requireStudentLifecycle();
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const reserve = await sdb.studentReserve.findUnique({
    where: { id: input.reserveId },
    select: {
      id: true,
      studentId: true,
      enrollmentId: true,
      isActive: true,
      student: { select: { status: true, centerId: true } },
    },
  });
  if (!reserve) {
    return { ok: false as const, error: "Không tìm thấy đợt bảo lưu" };
  }
  // Cách ly cơ sở: HV của đợt bảo lưu phải thuộc tầm nhìn actor.
  if (!(await studentInScope(session.user.id, reserve.studentId))) {
    return { ok: false as const, error: "Không tìm thấy đợt bảo lưu" };
  }
  if (!reserve.isActive) {
    return { ok: false as const, error: "Đợt bảo lưu đã kết thúc" };
  }

  if (input.endReason && input.endReason.length > 1000) {
    return { ok: false as const, error: "Ghi chú quá dài" };
  }

  const { actorId, actorName } = getAuditActor(session);
  const now = new Date();

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.studentReserve.update({
      where: { id: input.reserveId },
      data: {
        isActive: false,
        endedAt: now,
        endReason: input.endReason?.trim() || null,
        endedByUserId: actorId,
        endedByName: actorName,
      },
    });

    const otherActive = await tx.studentReserve.findFirst({
      where: {
        studentId: reserve.studentId,
        isActive: true,
        NOT: { id: input.reserveId },
      },
      select: { id: true },
    });

    if (!otherActive && reserve.student.status === "PAUSED") {
      await tx.student.update({
        where: { id: reserve.studentId },
        data: { status: "ACTIVE" },
      });

      await logStudentAudit({
        studentId: reserve.studentId,
        action: "UPDATE",
        actorId,
        actorName,
        oldValues: { status: "PAUSED" },
        newValues: { status: "ACTIVE" },
        changedFields: ["status"],
        reason: `Kết thúc bảo lưu${input.endReason ? `: ${input.endReason.trim()}` : ""}`,
        tx,
      });

      // P3 (additive): also write to unified AuditLog.
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "students",
        entityType: "Student",
        entityId: reserve.studentId,
        action: "STATUS_CHANGE",
        oldValues: { status: "PAUSED" },
        newValues: { status: "ACTIVE" },
        changedFields: ["status"],
        reason: `Kết thúc bảo lưu${input.endReason ? `: ${input.endReason.trim()}` : ""}`,
        orgUnitId: reserve.student.centerId,
        tx,
      });
    }

    const enrollmentsToResume = reserve.enrollmentId
      ? await tx.enrollment.findMany({
          where: { id: reserve.enrollmentId },
          select: { id: true, status: true },
        })
      : await tx.enrollment.findMany({
          where: { studentId: reserve.studentId, status: "PAUSED" },
          select: { id: true, status: true },
        });

    for (const enr of enrollmentsToResume) {
      // Guard state machine chuẩn: chỉ phục học khi enrollment được phép →STUDYING
      // (PAUSED hợp lệ). Không hợp lệ → huỷ tx, trả lỗi VI.
      if (!canTransition(enr.status, "STUDYING")) {
        throw new Error(INVALID_RESUME_TRANSITION);
      }

      await tx.enrollment.update({
        where: { id: enr.id },
        data: { status: "STUDYING" },
      });

      await tx.enrollmentAuditLog.create({
        data: {
          enrollmentId: enr.id,
          fromStatus: enr.status,
          toStatus: "STUDYING",
          changedByUserId: actorId,
          changedByName: actorName,
          reason: `Kết thúc bảo lưu${input.endReason ? `: ${input.endReason.trim()}` : ""}`,
        },
      });

      // P3 (additive): also write to unified AuditLog.
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "students",
        entityType: "Enrollment",
        entityId: enr.id,
        action: "STATUS_CHANGE",
        oldValues: { status: "PAUSED" },
        newValues: { status: "STUDYING" },
        changedFields: ["status"],
        reason: `Kết thúc bảo lưu${input.endReason ? `: ${input.endReason.trim()}` : ""}`,
        orgUnitId: reserve.student.centerId,
        tx,
      });
    }
    });
  } catch (err) {
    if (err instanceof Error && err.message === INVALID_RESUME_TRANSITION) {
      return { ok: false as const, error: "Không thể chuyển trạng thái này" };
    }
    throw err;
  }

  revalidatePath("/students");
  revalidatePath(`/students/${reserve.studentId}/edit`);
  return { ok: true as const };
}

// ─── WITHDRAW STUDENT (nghỉ học hẳn) ─────────────────────────────────
export async function withdrawStudentAction(input: {
  studentId: string;
  reason: string;
}) {
  const session = await requireStudentLifecycle();

  if (!input.reason?.trim()) {
    return { ok: false as const, error: "Vui lòng nhập lý do nghỉ học" };
  }
  if (input.reason.length > 1000) {
    return { ok: false as const, error: "Lý do quá dài" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const student = await sdb.student.findFirst({
    where: { id: input.studentId, deletedAt: null },
    select: { id: true, status: true, centerId: true },
  });
  if (!student) {
    return { ok: false as const, error: "Không tìm thấy học viên" };
  }
  // Cách ly cơ sở: HV phải thuộc tầm nhìn actor.
  if (!(await studentInScope(session.user.id, input.studentId))) {
    return { ok: false as const, error: "Không tìm thấy học viên" };
  }
  if (student.status === "INACTIVE") {
    return { ok: false as const, error: "Học viên đã nghỉ học rồi" };
  }

  const { actorId, actorName } = getAuditActor(session);
  let removedEnrollments: RemovedEnrollment[] = [];
  // PHIÊN D — ghi danh đã quyết toán qua "Dừng học" thì KHÔNG sinh đề xuất hoàn lần hai.
  // Phải trả lên màn: "không có đề xuất hoàn" mà im lặng thì ba tháng sau không ai phân
  // biệt được nó với một lượt bỏ sót.
  let boQuaHoanTien: GhiDanhBoQuaHoanTien[] = [];

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.studentReserve.updateMany({
      where: { studentId: input.studentId, isActive: true },
      data: {
        isActive: false,
        endedAt: new Date(),
        endReason: "Học viên nghỉ học",
        endedByUserId: actorId,
        endedByName: actorName,
      },
    });

    await tx.student.update({
      where: { id: input.studentId },
      data: { status: "INACTIVE" },
    });

    await logStudentAudit({
      studentId: input.studentId,
      action: "UPDATE",
      actorId,
      actorName,
      oldValues: { status: student.status },
      newValues: { status: "INACTIVE" },
      changedFields: ["status"],
      reason: `Nghỉ học: ${input.reason.trim()}`,
      tx,
    });

    // P3 (additive): also write to unified AuditLog.
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "students",
      entityType: "Student",
      entityId: input.studentId,
      action: "STATUS_CHANGE",
      oldValues: { status: student.status },
      newValues: { status: "INACTIVE" },
      changedFields: ["status"],
      reason: `Nghỉ học: ${input.reason.trim()}`,
      orgUnitId: student.centerId,
      tx,
    });

    // BUG 21/08 — khối này TRƯỚC ĐÂY tự liệt kê status ["PENDING","CONFIRMED",
    // "STUDYING","PAUSED"] ngay tại chỗ và BỎ SÓT `ACTIVE` (mặc định của schema, và là
    // thứ convert lead sinh ra) ⇒ bấm "Nghỉ học hẳn" xong em đó vẫn nằm nguyên trong lớp
    // và cũng không có yêu cầu hoàn tiền. Toàn bộ cascade nay nằm ở
    // `lib/students/withdraw.ts`, dùng chung `REMOVABLE_ENROLLMENT_STATUSES` với
    // `deleteStudent`, và có test hồi quy riêng — đừng chép danh sách status về lại đây.
    // (sync nhóm chat nằm trong removeStudentFromClasses, cùng transaction.)
    const kqNghi = await nghiHocHan({
      tx,
      studentId: input.studentId,
      actorId,
      actorName,
      reason: `Học viên nghỉ học: ${input.reason.trim()}`,
      orgUnitId: student.centerId,
    });
    removedEnrollments = kqNghi.daGo;
    boQuaHoanTien = kqNghi.boQuaHoanTien;
  }, { timeout: 30_000, maxWait: 10_000 });

  revalidatePath("/students");
  revalidatePath(`/students/${input.studentId}/edit`);
  // Roster lớp + danh sách ghi danh vừa đổi theo. Trước 21/08 các path này thiếu ⇒ kể cả
  // khi DB đã đúng, màn lớp nào KHÔNG force-dynamic vẫn phát bản cũ (còn tên HV đã nghỉ).
  //
  // ⚠️ TIỀN TỐ `/admin`: URL sạch `admin.satarobo.vn/classes/…` chỉ là vỏ — proxy rewrite
  // NỘI BỘ sang `/admin` + pathname (`lib/auth/route-policy.ts:622`), nên route Next thật
  // là `/admin/classes/…`. Các dòng `revalidatePath("/students")` cũ trong repo không khớp
  // route nào (vô hại vì các màn đó đều `force-dynamic`) — đừng chép theo.
  revalidatePath("/admin/enrollments");
  revalidatePath("/admin/classes");
  for (const classId of new Set(removedEnrollments.map((e) => e.classId))) {
    revalidatePath(`/admin/classes/${classId}`);
    revalidatePath(`/admin/classes/${classId}/students`);
  }

  const studentForEmail = await sdb.student.findUnique({
    where: { id: input.studentId },
    select: { name: true, parentName: true, parentEmail: true },
  });
  if (studentForEmail) {
    sendEmailForTrigger({
      trigger: "WITHDRAWAL_NOTICE",
      recipient: {
        email: studentForEmail.parentEmail,
        name: studentForEmail.parentName,
      },
      vars: {
        student_name: studentForEmail.name,
        parent_name: studentForEmail.parentName ?? "Quý phụ huynh",
        withdrawn_at: new Date(),
        reason: input.reason.trim(),
      },
      context: { type: "Student", id: input.studentId },
      triggerType: "SYSTEM",
      actor: { userId: actorId, name: actorName },
    }).catch((err) => {
      console.error("[email] WITHDRAWAL_NOTICE trigger error:", err);
    });
  }

  return { ok: true as const, boQuaHoanTien };
}

// ═══════════════════════════════════════════════════════════════════
// Phase T2.2 — Cấp tài khoản phụ huynh (PARENT) cho học viên (portal site con).
// Tạo/dùng lại User role PARENT + link student.parentUserId. Tự link các anh
// chị em cùng parentPhone (chưa có parent) để 1 phụ huynh quản nhiều con.
// ═══════════════════════════════════════════════════════════════════

const parentAccountSchema = z.object({
  studentId: z.string().min(1),
  // AUTH-SĐT P5 — SĐT là định danh (bắt buộc), email hạ xuống tuỳ chọn. Bỏ trống
  // SĐT thì lấy `Student.parentPhone` làm mặc định (xử lý dưới thân hàm).
  // NỢ-2: chuỗi mask không phải SĐT — chặn ghi làm khoá đăng nhập của phụ huynh.
  phone: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || !PHONE_MASK_RE.test(v), PHONE_MASK_MSG),
  email: z
    .string()
    .trim()
    .email("Email không hợp lệ")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.toLowerCase() : null)),
  name: z.string().trim().max(120).optional(),
});

// P0-2: cấp tài khoản phụ huynh = PENDING_ACTIVATION + gửi OTP kích hoạt (KHÔNG
// đặt mật khẩu tạm). Phụ huynh tự đặt mật khẩu khi kích hoạt (flow A1).
// AUTH-SĐT P5: khoá đăng nhập = SĐT, mã kích hoạt đi Zalo ZNS.
export async function createParentAccount(input: {
  studentId: string;
  phone?: string;
  email?: string;
  name?: string;
}): Promise<{ ok: boolean; linkedCount?: number; pendingActivation?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("students:edit"))) {
    return { ok: false, error: "Không có quyền cấp tài khoản phụ huynh" };
  }

  // NỢ-2 — actor bị che parentPhone: ô SĐT màn này prefill chuỗi MASK; không được
  // tin bất kỳ SĐT nào actor gửi lên (họ không thấy số thật để kiểm). Bỏ qua ô
  // nhập, dùng thẳng SĐT trên hồ sơ học viên (server đọc từ DB, không qua client).
  const phoneHidden = await isParentPhoneMasked();

  const parsed = parentAccountSchema.safeParse(
    phoneHidden ? { ...input, phone: undefined } : input,
  );
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { studentId, email } = parsed.data;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const student = await sdb.student.findFirst({
    where: { id: studentId, deletedAt: null },
    select: { id: true, parentUserId: true, parentName: true, parentPhone: true },
  });
  if (!student) return { ok: false, error: "Không tìm thấy học viên" };

  // Định danh = SĐT ô nhập, không có thì lấy SĐT phụ huynh trên hồ sơ học viên.
  // (Actor bị che parentPhone: parsed.data.phone đã bị bỏ ở trên → luôn dùng hồ sơ.)
  const phone = canonicalPhone(parsed.data.phone || student.parentPhone);
  if (!phone) {
    return {
      ok: false,
      error: phoneHidden
        ? "Bạn không có quyền xem SĐT phụ huynh nên hệ thống chỉ dùng được SĐT trên hồ sơ học viên — nhưng hồ sơ chưa có SĐT di động hợp lệ. Nhờ người có quyền cập nhật SĐT phụ huynh trước khi cấp tài khoản."
        : "Cần số điện thoại di động hợp lệ của phụ huynh — đây là tài khoản đăng nhập và là nơi nhận mã kích hoạt.",
    };
  }
  // Cách ly cơ sở: chỉ cấp tài khoản PH cho HV trong tầm nhìn actor.
  if (!(await studentInScope(session.user.id, studentId))) {
    return { ok: false, error: "Không tìm thấy học viên" };
  }
  if (student.parentUserId) {
    return { ok: false, error: "Học viên đã có tài khoản phụ huynh" };
  }

  // Định danh đã dùng? Tra SĐT TRƯỚC (khoá chính sau P5), rồi mới tới email.
  const existingUser =
    (await sdb.user.findUnique({ where: { phone }, select: { id: true, role: true } })) ??
    (email ? await sdb.user.findUnique({ where: { email }, select: { id: true, role: true } }) : null);
  if (existingUser && existingUser.role !== "PARENT") {
    return { ok: false, error: "Số điện thoại/email đã dùng cho tài khoản nhân viên khác" };
  }

  const parentName = parsed.data.name?.trim() || student.parentName || "Phụ huynh";

  try {
    const result = await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      let parentUserId = existingUser?.id;
      let isNewPending = false;
      if (!parentUserId) {
        // Tài khoản mới: PENDING_ACTIVATION, KHÔNG mật khẩu — kích hoạt qua OTP.
        const created = await tx.user.create({
          data: {
            name: parentName,
            // P5 — SĐT là khoá đăng nhập; email chỉ ghi khi có.
            phone,
            email,
            role: "PARENT",
            roles: ["PARENT"],
            isActive: true,
            accountStatus: "PENDING_ACTIVATION",
            tokenVersion: 0,
          },
          select: { id: true },
        });
        parentUserId = created.id;
        isNewPending = true;
      }

      // Link student hiện tại + anh chị em cùng SĐT phụ huynh (chưa có parent).
      // P5 — so khớp qua `phoneVariants`: hồ sơ cũ còn lưu `0905…` trong khi hồ sơ
      // mới đã canonical `84905…`, so khớp đúng-bằng sẽ bỏ sót đúng những anh chị
      // em cần gộp (cùng lỗi mà P1 đã vá ở findConvertDuplicates).
      const siblingPhones = phoneVariants(student.parentPhone);
      const siblingFilter: Prisma.StudentWhereInput = siblingPhones.length
        ? {
            deletedAt: null,
            parentUserId: null,
            OR: [{ id: studentId }, { parentPhone: { in: siblingPhones } }],
          }
        : { id: studentId };

      // US-03 chat — cần danh sách HV bị link để sync nhóm lớp → lấy id trước khi update.
      const linkTargets = await tx.student.findMany({
        where: siblingFilter,
        select: { id: true },
      });
      const res = await tx.student.updateMany({
        where: { id: { in: linkTargets.map((s) => s.id) } },
        data: { parentUserId },
      });

      // US-03 chat — gắn tài khoản PH cho HV → PH vào nhóm các lớp con đang học, cùng tx.
      const activeClasses = await tx.enrollment.findMany({
        where: {
          studentId: { in: linkTargets.map((s) => s.id) },
          deletedAt: null,
          status: { in: CHAT_MEMBER_ENROLLMENT_STATUSES },
        },
        select: { classId: true },
      });
      for (const classId of new Set(activeClasses.map((e) => e.classId))) {
        await syncConversationMembership(tx, classId);
      }

      return { linkedCount: res.count, isNewPending };
    }, { timeout: 30_000, maxWait: 10_000 });

    // Tài khoản mới PENDING_ACTIVATION → gửi OTP kích hoạt (ngoài transaction).
    // P5 — target là SĐT ⇒ `getOtpProviderFor` chọn Zalo ZNS; email chỉ còn là
    // đường dự phòng do chính tầng OTP lo (P4), không phải việc của chỗ này.
    if (result.isNewPending) {
      await requestOtp({ target: phone, purpose: "ACTIVATION" }).catch(() => {});
    }

    revalidatePath(`/students/${studentId}/edit`);
    return { ok: true, linkedCount: result.linkedCount, pendingActivation: result.isNewPending };
  } catch {
    return { ok: false, error: "Lỗi tạo tài khoản phụ huynh" };
  }
}

// P0-2: gửi LẠI mã kích hoạt cho phụ huynh đang chờ kích hoạt.
export async function resendParentActivationOtp(
  studentId: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("students:edit"))) return { ok: false, error: "Không có quyền" };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const student = await sdb.student.findFirst({
    where: { id: studentId, deletedAt: null },
    select: { parentUser: { select: { phone: true, email: true, accountStatus: true } } },
  });
  const parent = student?.parentUser;
  if (!parent) return { ok: false, error: "Học viên chưa có tài khoản phụ huynh" };
  if (parent.accountStatus !== "PENDING_ACTIVATION") {
    return { ok: false, error: "Tài khoản đã kích hoạt — không cần gửi lại mã" };
  }
  // P5 — ưu tiên SĐT (ZNS), lùi về email cho hồ sơ cũ chưa có `User.phone`.
  const target = parent.phone ?? parent.email;
  if (!target) {
    return {
      ok: false,
      error: "Tài khoản phụ huynh chưa có số điện thoại lẫn email — cập nhật hồ sơ trước.",
    };
  }

  const res = await requestOtp({ target, purpose: "ACTIVATION" });
  if (!res.ok) {
    // QA 21/07 (#3) — kênh email lỗi (vd dev thiếu API key) nhưng OTP ĐÃ tạo và
    // verify được → báo thành công kèm chú thích thay vì toast đỏ gây hiểu nhầm
    // (thống nhất với luồng cấp tài khoản lần đầu). Mã xem ở /email-logs.
    if (res.deliveryFailed) {
      // P6-D — nói RÕ vì sao và nên làm gì. "Không gửi được" chung chung khiến
      // nhân viên bấm gửi lại nhiều lần trong khi ba nhóm lỗi dưới đây KHÔNG tự
      // hết: số chưa có Zalo / phụ huynh tắt nhận tin OA / chạm giới hạn nhận.
      const advice = describeOtpSendError(res.error);
      return {
        ok: true,
        warning: advice.permanent
          ? `Đã tạo mã nhưng KHÔNG gửi được và gửi lại cũng vô ích: ${advice.message} Dùng nút "Cấp mã tại quầy".`
          : `Đã tạo mã kích hoạt mới nhưng chưa gửi được. ${advice.message}`,
      };
    }
    return { ok: false, error: res.error ?? "Không gửi được mã (thử lại sau ít phút)" };
  }
  return { ok: true };
}

// ─── ĐA CON: thêm/bỏ liên kết con cho 1 phụ huynh (commit 3) ─────────
// 1 phụ huynh (User PARENT) quản lý nhiều con qua Student.parentUserId.

/** Tìm học viên CHƯA gắn phụ huynh để liên kết thêm vào 1 phụ huynh. */
export async function searchLinkableStudents(
  query: string,
): Promise<{ ok: boolean; items?: { id: string; name: string; studentCode: string | null }[]; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("students:edit"))) return { ok: false, error: "Không có quyền" };

  const q = query.trim();
  // SĐT lưu 2 dạng (0… cũ / 84… mới) — tìm theo phần lõi để không sót.
  const qPhone = phoneSearchTerm(q) ?? q;
  if (q.length < 1) return { ok: true, items: [] };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // NỢ #11 (search-oracle): chỉ cho tìm theo SĐT khi actor thấy được SĐT thật —
  // cùng gate với trang danh sách HV (canViewPii VÀ không bị DENY cấp trường TS-02).
  // Thiếu quyền mà vẫn filter theo SĐT = dò được số qua kết quả trả về.
  const canSearchPhone = (await canViewLeadPii()) && !(await isParentPhoneMasked());

  // CENTER_MANAGER (không super) chỉ thấy HV cơ sở mình.
  const centerScope =
    hasRole(session.user, "CENTER_MANAGER") && !hasRole(session.user, "SUPER_ADMIN")
      ? session.user.centerId
      : null;

  const items = await sdb.student.findMany({
    where: {
      deletedAt: null,
      parentUserId: null,
      ...(centerScope ? { centerId: centerScope } : {}),
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { studentCode: { contains: q, mode: "insensitive" } },
        ...(canSearchPhone ? [{ parentPhone: { contains: qPhone } }] : []),
      ],
    },
    orderBy: { name: "asc" },
    take: 10,
    select: { id: true, name: true, studentCode: true },
  });
  return { ok: true, items };
}

/** Gắn 1 học viên (đang chưa có phụ huynh) vào phụ huynh của studentId hiện tại. */
export async function addChildToParent(input: {
  parentUserId: string;
  childStudentId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("students:edit"))) return { ok: false, error: "Không có quyền" };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [parent, child] = await Promise.all([
    sdb.user.findFirst({ where: { id: input.parentUserId, role: "PARENT", deletedAt: null }, select: { id: true } }),
    sdb.student.findFirst({
      where: { id: input.childStudentId, deletedAt: null },
      select: { id: true, parentUserId: true },
    }),
  ]);
  if (!parent) return { ok: false, error: "Không tìm thấy tài khoản phụ huynh" };
  if (!child) return { ok: false, error: "Không tìm thấy học viên" };
  // Cách ly cơ sở: chỉ gắn con là HV trong tầm nhìn actor.
  if (!(await studentInScope(session.user.id, child.id))) {
    return { ok: false, error: "Không tìm thấy học viên" };
  }
  if (child.parentUserId && child.parentUserId !== input.parentUserId) {
    return { ok: false, error: "Học viên đã thuộc phụ huynh khác — gỡ liên kết cũ trước" };
  }

  // US-03 chat — thêm con cho PH → PH vào nhóm các lớp con đang học, cùng transaction.
  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.student.update({ where: { id: child.id }, data: { parentUserId: input.parentUserId } });
    const activeClasses = await tx.enrollment.findMany({
      where: {
        studentId: child.id,
        deletedAt: null,
        status: { in: CHAT_MEMBER_ENROLLMENT_STATUSES },
      },
      select: { classId: true },
    });
    for (const classId of new Set(activeClasses.map((e) => e.classId))) {
      await syncConversationMembership(tx, classId);
    }
  }, { timeout: 30_000, maxWait: 10_000 });
  revalidatePath(`/students/${child.id}/edit`);
  return { ok: true };
}

/** Gỡ liên kết 1 con khỏi phụ huynh (không xoá học viên). */
export async function unlinkChildFromParent(
  childStudentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("students:edit"))) return { ok: false, error: "Không có quyền" };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Cách ly cơ sở: chỉ gỡ liên kết HV trong tầm nhìn actor (chống IDOR ghi).
  if (!(await studentInScope(session.user.id, childStudentId))) {
    return { ok: false, error: "Không tìm thấy học viên" };
  }

  // US-03 chat — gỡ liên kết con → PH rời nhóm lớp của con đó (nếu không còn con khác
  // trong lớp), cùng transaction.
  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    const activeClasses = await tx.enrollment.findMany({
      where: {
        studentId: childStudentId,
        deletedAt: null,
        status: { in: CHAT_MEMBER_ENROLLMENT_STATUSES },
      },
      select: { classId: true },
    });
    await tx.student.update({ where: { id: childStudentId }, data: { parentUserId: null } });
    for (const classId of new Set(activeClasses.map((e) => e.classId))) {
      await syncConversationMembership(tx, classId);
    }
  }, { timeout: 30_000, maxWait: 10_000 });
  revalidatePath(`/students/${childStudentId}/edit`);
  return { ok: true };
}

// ─── REACTIVATE STUDENT (INACTIVE/PAUSED → ACTIVE) ───────────────────
// Note: KHÔNG auto-create enrollment. Admin phải tạo Enrollment mới qua flow Enrollment
// riêng — phục hồi tự động là đoán mò (lớp cũ có thể đã đầy, đã kết thúc, hoặc em cần
// lớp khác hẳn), và ghi danh cũ đã mang trạng thái kết thúc + đã có yêu cầu hoàn tiền.
//
// 21/08 — NHƯNG KHÔNG ĐƯỢC IM LẶNG. Cho nghỉ học đã gỡ em khỏi mọi lớp; bấm "Kích hoạt
// lại" chỉ đưa `Student.status` về ACTIVE ⇒ em thành học viên "đang học mà không có lớp
// nào", biến mất khỏi mọi roster cho tới khi ai đó nhớ ra phải tạo ghi danh mới. Nay trả
// `liveClassCount` để UI nói thẳng ra việc còn phải làm.
export async function reactivateStudentAction(input: {
  studentId: string;
  note?: string | null;
}) {
  const session = await requireStudentLifecycle();
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const student = await sdb.student.findFirst({
    where: { id: input.studentId, deletedAt: null },
    select: { id: true, status: true, centerId: true },
  });
  if (!student) {
    return { ok: false as const, error: "Không tìm thấy học viên" };
  }
  // Cách ly cơ sở: HV phải thuộc tầm nhìn actor.
  if (!(await studentInScope(session.user.id, input.studentId))) {
    return { ok: false as const, error: "Không tìm thấy học viên" };
  }
  if (student.status === "ACTIVE") {
    return { ok: false as const, error: "Học viên đã đang ACTIVE" };
  }

  const { actorId, actorName } = getAuditActor(session);

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.student.update({
      where: { id: input.studentId },
      data: { status: "ACTIVE" },
    });

    await logStudentAudit({
      studentId: input.studentId,
      action: "UPDATE",
      actorId,
      actorName,
      oldValues: { status: student.status },
      newValues: { status: "ACTIVE" },
      changedFields: ["status"],
      reason: `Kích hoạt lại${input.note ? `: ${input.note.trim()}` : ""}`,
      tx,
    });

    // P3 (additive): also write to unified AuditLog.
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "students",
      entityType: "Student",
      entityId: input.studentId,
      action: "STATUS_CHANGE",
      oldValues: { status: student.status },
      newValues: { status: "ACTIVE" },
      changedFields: ["status"],
      reason: `Kích hoạt lại${input.note ? `: ${input.note.trim()}` : ""}`,
      orgUnitId: student.centerId,
      tx,
    });
  });

  revalidatePath("/students");
  revalidatePath(`/students/${input.studentId}/edit`);

  // Đếm SAU transaction: chỉ để báo cho người dùng, không phải điều kiện nghiệp vụ.
  const liveClassCount = await sdb.enrollment.count({
    where: {
      studentId: input.studentId,
      status: { in: REMOVABLE_ENROLLMENT_STATUSES },
      deletedAt: null,
    },
  });
  return { ok: true as const, liveClassCount };
}

/**
 * AUTH-SĐT P6 — CẤP MÃ KÍCH HOẠT TẠM tại quầy (break-glass khi ZNS chết).
 *
 * Thay cho câu hướng dẫn cũ "xem mã trong Email logs" — sau P5 mã đi Zalo nên
 * Email logs không còn gì để xem, và nhân viên mất hẳn đường xử lý khi phụ huynh
 * đứng ngay trước mặt mà không nhận được tin.
 *
 * Mã trả về ở dạng CHỮ để nhân viên đọc cho phụ huynh. Vì thế đường này:
 *   · đòi quyền `students:edit` + cách ly cơ sở như mọi thao tác trên học viên;
 *   · BẮT BUỘC nhập lý do, và ghi AuditLog kèm lý do đó — cấp mã tay là hành vi
 *     phải truy được người làm, không phải tiện ích thầm lặng.
 */
export async function issueOfflineActivationCode(input: {
  studentId: string;
  reason: string;
}): Promise<{ ok: boolean; code?: string; expiresAt?: string; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("students:edit"))) return { ok: false, error: "Không có quyền" };

  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) {
    return { ok: false, error: "Nhập lý do cấp mã tay (tối thiểu 10 ký tự) — bắt buộc để đối soát." };
  }

  if (!(await studentInScope(session.user.id, input.studentId))) {
    return { ok: false, error: "Không tìm thấy học viên" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const student = await sdb.student.findFirst({
    where: { id: input.studentId, deletedAt: null },
    select: { parentUser: { select: { id: true, phone: true, email: true, accountStatus: true } } },
  });
  const parent = student?.parentUser;
  if (!parent) return { ok: false, error: "Học viên chưa có tài khoản phụ huynh" };
  if (parent.accountStatus !== "PENDING_ACTIVATION") {
    return { ok: false, error: "Tài khoản đã kích hoạt — dùng Quên mật khẩu nếu cần." };
  }
  const target = parent.phone ?? parent.email;
  if (!target) return { ok: false, error: "Tài khoản phụ huynh chưa có SĐT lẫn email." };

  const res = await issueOfflineOtp({ target, purpose: "ACTIVATION", userId: parent.id });
  if (!res.ok) return { ok: false, error: res.error };

  const { actorId, actorName } = getAuditActor(session);
  await logUserAudit({
    userId: parent.id,
    action: "UPDATE",
    actorId,
    actorName,
    changedFields: ["otpActivationOffline"],
    // Lý do vào audit chứ KHÔNG phải mã — mã nằm trong audit là mã bị lộ.
    reason: `Cấp mã kích hoạt TAY tại quầy: ${reason}`,
  }).catch(() => {});

  return { ok: true, code: res.code, expiresAt: res.expiresAt.toISOString() };
}
