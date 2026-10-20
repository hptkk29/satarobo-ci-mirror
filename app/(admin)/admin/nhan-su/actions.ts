"use server";

import { z } from "zod";
import type { Prisma, Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  hasRole,
  getEmployeeFieldVisibility,
  stripHiddenEmployeeFields,
} from "@/lib/auth/permissions";
import { suyCoSoTuDonVi } from "@/lib/hr/employee-unit";
import { assertPermission } from "@/lib/auth/check-permission";
import { writeAudit } from "@/lib/audit/audit-log";
import { ASSIGNABLE_ROLES } from "@/lib/labels";
import {
  employeeCreateSchema,
  employeeUpdateSchema,
} from "@/lib/validators/employee";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import {
  reconcileUserOrgRoles,
  OrgRoleSyncError,
} from "@/lib/auth/org-role-sync";
import { syncCenterClassConversations } from "@/lib/chat/sync-membership";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { nguoiDangGioiThieuLead, nhanSuDangPhuTrachNguon } from "@/lib/nguon/nguoi-gioi-thieu";
import { keoTaiKhoanTheoHoSo } from "@/lib/hr/sync-employee-unit";
import { canVoHieuTaiKhoan } from "@/lib/hr/nghi-viec";

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type Sdb = ReturnType<typeof scopedDb>;

// Cách ly cơ sở (chống IDOR ghi): Employee ∈ SCOPED_MODELS. NV HO có centerId=null
// (cross-center) → chỉ SUPER_ADMIN/HO thao tác. CENTER_MANAGER chỉ NV cơ sở mình.
// GHI đối xứng với ĐỌC (vá 24/07): scope per-model qua passesScope — NV HO (centerId
// null) đòi scope ALL (role HO có quyền employees:), không còn mở cho mọi role @HO.
function actorCanUseCenter(actor: Actor, centerId: string | null): boolean {
  return passesScope("Employee", { centerId }, actor);
}
/** NV `id` có thuộc tầm nhìn cơ sở actor không (sdb null-filter + passesScope).
 * Vá 24/07: bỏ bypass isHoLevel trần — scoped read + passesScope đã per-model
 * (role HO có quyền employees: → ALL vẫn qua; role HO khác chức năng → theo scope). */
async function employeeInScope(
  userId: string | undefined,
  id: string,
): Promise<boolean> {
  if (!userId) return false;
  const actor = await resolveActor(userId);
  if (actor.isSuperAdmin) return true;
  const sdb = scopedDb(actor);
  const e = await sdb.employee.findUnique({
    where: { id },
    select: { centerId: true },
  });
  return !!e && passesScope("Employee", e, actor);
}

// ─── Nhân viên HO (Hội sở) ──────────────────────────────────────────────
// HO là OrgUnit type=HO (Doc 15 OI-1), KHÔNG phải Center. NV "thuộc HO" khi có
// EmployeeOrgAssignment PRIMARY active tới OrgUnit HO. Bật cờ ⇒ upsert assignment;
// tắt ⇒ EXPIRE assignment. assignment KHÔNG sinh quyền (quyền chỉ từ UserOrgRole).
async function getHoUnitId(sdb: Sdb): Promise<string | null> {
  const ho = await sdb.orgUnit.findFirst({
    where: { type: "HO", deletedAt: null },
    select: { id: true },
  });
  return ho?.id ?? null;
}

async function syncHoAssignment(
  sdb: Sdb,
  actor: { id: string | null; name: string },
  employeeId: string,
  isHO: boolean,
): Promise<void> {
  const hoUnitId = await getHoUnitId(sdb);
  if (!hoUnitId) return; // không có OrgUnit HO → bỏ qua (pre-check đã chặn khi bật)

  if (isHO) {
    const existing = await sdb.employeeOrgAssignment.findFirst({
      where: { employeeId, orgUnitId: hoUnitId, status: "ACTIVE" },
      select: { id: true },
    });
    if (existing) return; // idempotent
    const created = await sdb.employeeOrgAssignment.create({
      data: {
        employeeId,
        orgUnitId: hoUnitId,
        assignmentType: "PRIMARY",
        createdById: actor.id ?? "system",
      },
    });
    await writeAudit({
      actor,
      module: "employees",
      entityType: "EmployeeOrgAssignment",
      entityId: created.id,
      action: "CREATE",
      newValues: { orgUnitId: hoUnitId, assignmentType: "PRIMARY" },
      reason: "HR form: gán Nhân viên HO (Hội sở)",
      orgUnitId: hoUnitId,
    });
  } else {
    const actives = await sdb.employeeOrgAssignment.findMany({
      where: { employeeId, orgUnitId: hoUnitId, status: "ACTIVE" },
      select: { id: true },
    });
    if (actives.length === 0) return;
    await sdb.employeeOrgAssignment.updateMany({
      where: { employeeId, orgUnitId: hoUnitId, status: "ACTIVE" },
      data: { status: "EXPIRED", effectiveTo: new Date() },
    });
    await writeAudit({
      actor,
      module: "employees",
      entityType: "EmployeeOrgAssignment",
      entityId: actives[0]!.id,
      action: "UPDATE",
      newValues: { status: "EXPIRED" },
      reason: "HR form: bỏ Nhân viên HO (Hội sở)",
      orgUnitId: hoUnitId,
    });
  }
}

function revalidateAll() {
  revalidatePath("/nhan-su");
  revalidatePath("/vinh-danh");
  revalidatePath("/vinh-danh/tat-ca");
  revalidatePath("/vinh-danh/spark");
  revalidatePath("/vinh-danh/growth");
  revalidatePath("/vinh-danh/impact");
  revalidatePath("/vinh-danh/grand-champion");
  revalidatePath("/ve-chung-toi");
}

// SEC-M06 — snapshot field cho audit before/after (chỉ primitive để so sánh sạch,
// tránh false-positive khi diff Date). Không gồm PII quá nhạy (nationalId/address/notes).
const EMPLOYEE_AUDIT_SELECT = {
  fullName: true,
  employeeCode: true,
  jobTitle: true,
  department: true,
  status: true,
  centerId: true,
  isActive: true,
  isPublic: true,
  salaryRank: true,
  salaryLevel: true,
  bhxhBase: true,
  contractType: true,
  gender: true,
  managerId: true,
} as const;

function auditActorOf(session: {
  user: { id?: string | null; name?: string | null; email?: string | null };
}) {
  return {
    id: session.user.id ?? null,
    name:
      session.user.name ?? session.user.email ?? session.user.id ?? "Unknown",
  };
}

export async function createEmployeeAction(
  input: unknown,
  isHO = false,
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("employees:create");
  } catch {
    return { ok: false, error: "Không có quyền" };
  }

  const parsed = employeeCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }

  // Cách ly cơ sở (A0-04): Employee ∈ SCOPED_MODELS → đọc/ghi qua scopedDb.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Bật cờ HO nhưng chưa seed OrgUnit HO → chặn sớm, tránh tạo NV "mồ côi" cơ sở.
  if (isHO && !(await getHoUnitId(sdb))) {
    return {
      ok: false,
      error:
        "Chưa có đơn vị Hội sở (HO) trong hệ thống. Liên hệ quản trị để seed OrgUnit trước.",
    };
  }

  // Pre-check trùng (sdb null-filter record ngoài tầm nhìn — unique constraint DB
  // vẫn là chốt chặn cuối, bắt ở try/catch create bên dưới).
  const existing = await sdb.employee.findUnique({
    where: { employeeCode: parsed.data.employeeCode },
  });
  if (existing) {
    return { ok: false, error: "Mã nhân viên đã tồn tại" };
  }

  if (parsed.data.email) {
    const existingEmail = await sdb.employee.findUnique({
      where: { email: parsed.data.email },
    });
    if (existingEmail) {
      return { ok: false, error: "Email đã tồn tại" };
    }
  }

  // SEC-M15: cờ CEO là danh nghĩa đơn nhất toàn hệ thống → chỉ SUPER_ADMIN được đặt.
  const canSetPrivileged = hasRole(session.user, "SUPER_ADMIN");

  // Ensure chỉ 1 CEO
  if (parsed.data.isCEO && canSetPrivileged) {
    await sdb.employee.updateMany({
      where: { isCEO: true },
      data: { isCEO: false },
    });
  }

  // ĐƠN VỊ LÀM VIỆC → CƠ SỞ. Form (PR-C) gửi `orgUnitId`, `centerId` suy ra Ở ĐÂY —
  // phần "suy ra ở server" đó trước đây chưa từng được viết, nên lưu vẫn báo thành công
  // mà `centerId` giữ nguyên giá trị cũ. NV HO → không thuộc cơ sở nào; chỗ làm xác định
  // qua `EmployeeOrgAssignment`.
  const createData = { ...parsed.data };
  const donViTao = await suyCoSoTuDonVi({
    isHO,
    orgUnitId: createData.orgUnitId,
  });
  if (donViTao) createData.centerId = donViTao.centerId;
  // SEC-M15: chống mass-assignment khi CREATE (write path song song với update:265-270).
  // Non-SUPER_ADMIN không được tự đặt cờ CEO; CENTER_MANAGER thuần không được đặt bậc/mức lương.
  if (!canSetPrivileged) createData.isCEO = false;
  // Module chấm công v3 (T-02): cờ miễn tính công cùng luật với isCEO — chỉ SUPER_ADMIN.
  if (!canSetPrivileged) createData.timesheetExempt = false;
  // SEC-H04: strip field ngoài quyền (khớp update + redact-khi-đọc). Bao trùm strip
  // salary CM cũ + chặn set nhóm personal/contact ngoài quyền lúc tạo.
  stripHiddenEmployeeFields(
    createData,
    getEmployeeFieldVisibility(session.user.role),
  );

  // Cách ly cơ sở: chỉ tạo NV cho cơ sở trong tầm nhìn actor (NV HO/centerId=null → super/HO).
  if (!actorCanUseCenter(actor, createData.centerId ?? null)) {
    return { ok: false, error: "Không có quyền tạo nhân sự cho cơ sở này" };
  }

  let created: { id: string };
  try {
    created = await sdb.employee.create({
      data: {
        ...createData,
        createdById: session.user.id,
      },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { ok: false, error: "Mã nhân viên hoặc email đã tồn tại" };
    }
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không tạo được nhân sự" };
  }

  // #10 — NV HO: gán phân công PRIMARY vào OrgUnit Hội sở (khi isHO, orgUnitId rỗng).
  await syncHoAssignment(
    sdb,
    {
      id: session.user.id,
      name:
        session.user.name ?? session.user.email ?? session.user.id ?? "Unknown",
    },
    created.id,
    isHO,
  );

  // SEC-M06: audit tạo nhân sự.
  await writeAudit({
    actor: auditActorOf(session),
    module: "employees",
    entityType: "Employee",
    entityId: created.id,
    action: "CREATE",
    newValues: {
      employeeCode: createData.employeeCode,
      fullName: createData.fullName,
      department: createData.department,
      centerId: createData.centerId ?? null,
    },
    orgUnitId: createData.centerId ?? null,
  });

  revalidateAll();
  return { ok: true, data: { id: created.id } };
}

export async function updateEmployeeAction(
  id: string,
  input: unknown,
  isHO?: boolean,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  // Cách ly cơ sở (A0-04): Employee ∈ SCOPED_MODELS → đọc/ghi qua scopedDb.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Target gate: employees:edit có cả tầng GLOBAL (HO_HR) và CENTER (CENTER_HR) —
  // truyền centerId của NV HIỆN TẠI để v2 đánh giá đúng nhánh CENTER.
  const targetEmployee = await sdb.employee.findUnique({
    where: { id },
    select: { centerId: true },
  });
  if (!targetEmployee) return { ok: false, error: "Không tìm thấy nhân sự" };
  try {
    await assertPermission("employees:edit", {
      centerId: targetEmployee.centerId,
    });
  } catch {
    return { ok: false, error: "Không có quyền" };
  }

  const parsed = employeeUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }

  if (isHO === true && !(await getHoUnitId(sdb))) {
    return {
      ok: false,
      error:
        "Chưa có đơn vị Hội sở (HO) trong hệ thống. Liên hệ quản trị để seed OrgUnit trước.",
    };
  }

  // Cách ly cơ sở: NV HIỆN TẠI + cơ sở ĐÍCH (nếu đổi) đều phải trong tầm nhìn actor.
  if (!(await employeeInScope(session.user.id, id))) {
    return { ok: false, error: "Không tìm thấy nhân sự" };
  }

  // SEC-H04: strip field ngoài quyền (khớp redact-khi-đọc bên page) — chống mất data khi
  // client gửi null do đã redact + chặn set field ngoài quyền. Bao trùm strip salary CM cũ.
  const data = { ...parsed.data };
  stripHiddenEmployeeFields(
    data,
    getEmployeeFieldVisibility(session.user.role),
  );
  // Module chấm công v3 (T-02): cờ miễn tính công chỉ SUPER_ADMIN đặt/gỡ được (khuôn SEC-M15
  // của isCEO). Vai khác gửi lên thì bỏ qua — không đổi giá trị đang có.
  if (
    data.timesheetExempt !== undefined &&
    !hasRole(session.user, "SUPER_ADMIN")
  ) {
    delete data.timesheetExempt;
  }
  // ĐƠN VỊ LÀM VIỆC → CƠ SỞ (xem `lib/hr/employee-unit.ts`). Ba trạng thái của
  // `orgUnitId` tách bạch: undefined = không đụng tới đơn vị ⇒ giữ nguyên cơ sở;
  // null = chủ ý xoá; có giá trị = suy cơ sở từ khoá ngoại của đơn vị.
  const donViSua = await suyCoSoTuDonVi({ isHO, orgUnitId: data.orgUnitId });
  if (donViSua) data.centerId = donViSua.centerId;

  // Đổi cơ sở → cơ sở đích cũng phải trong tầm nhìn actor.
  if (data.centerId !== undefined) {
    if (!actorCanUseCenter(actor, data.centerId ?? null)) {
      return {
        ok: false,
        error: "Không có quyền chuyển nhân sự sang cơ sở này",
      };
    }
  }

  if (data.isCEO) {
    await sdb.employee.updateMany({
      where: { isCEO: true, NOT: { id } },
      data: { isCEO: false },
    });
  }

  // SEC-M06: audit before/after (snapshot primitive để diff sạch).
  const auditBefore = await sdb.employee.findUnique({
    where: { id },
    select: EMPLOYEE_AUDIT_SELECT,
  });
  await sdb.employee.update({ where: { id }, data });
  const auditAfter = await sdb.employee.findUnique({
    where: { id },
    select: EMPLOYEE_AUDIT_SELECT,
  });

  // ── NGHỈ VIỆC ⇒ TÀI KHOẢN CHẾT THEO (08/09/2026) ───────────────────────────
  //
  // Trước bản vá này, đổi `status` sang RESIGNED/TERMINATED chỉ ghi vào `Employee`:
  // tài khoản vẫn đăng nhập được và JWT cũ sống tới hạn. Repo vốn có sẵn cơ chế cắt
  // phiên và dùng đúng ở đổi-vai + cấp-quyền; chỉ nghỉ việc là quên.
  //
  // Bump `tokenVersion` cắt phiên NGAY request kế (`checkSessionLiveness` đối chiếu
  // với DB); `isActive = false` chặn đăng nhập lại.
  //
  // Best-effort có chủ đích: hồ sơ ĐÃ ghi xong: khoá tài khoản hỏng không được biến
  // thành "không sửa được hồ sơ". Nhưng KHÔNG im lặng — ghi AuditLog riêng.
  if (canVoHieuTaiKhoan(auditBefore?.status, auditAfter?.status)) {
    try {
      const tk = await sdb.user.findFirst({
        where: { employeeId: id },
        select: { id: true, isActive: true },
      });
      if (tk?.isActive) {
        const nguoiLam = { id: session.user.id, name: session.user.name ?? "" };
        // BAO-MAT-03 — khoá tài khoản + ghi vết trong MỘT giao dịch: hai bước rời nhau thì một
        // bước ném là tài khoản đã khoá mà không có dấu vết (hoặc ngược lại).
        await sdb.$transaction(async (txRaw) => {
          const tx = txRaw as unknown as Prisma.TransactionClient;
          await tx.user.update({
            where: { id: tk.id },
            data: { isActive: false, tokenVersion: { increment: 1 } },
          });
          await writeAudit({
            tx,
            actor: nguoiLam,
            module: "hr",
            entityType: "User",
            entityId: tk.id,
            action: "DEACTIVATE_ON_OFFBOARD",
            oldValues: { isActive: true },
            newValues: {
              isActive: false,
              employeeId: id,
              employeeStatus: auditAfter?.status,
            },
            reason:
              "Nhân sự chuyển sang trạng thái đã nghỉ — vô hiệu hoá tài khoản và cắt phiên",
          });
        });
      }
    } catch (err) {
      console.error(
        "[nhan-su] không vô hiệu hoá được tài khoản khi nghỉ việc:",
        err,
      );
      // Best-effort có chủ đích (hồ sơ đã ghi xong) nhưng KHÔNG im lặng: để lại dấu cho người
      // rà soát — tài khoản của người đã nghỉ có thể còn sống.
      await writeAudit({
        actor: { id: session.user.id, name: session.user.name ?? "" },
        module: "hr",
        entityType: "Employee",
        entityId: id,
        action: "DEACTIVATE_ON_OFFBOARD_FAILED",
        newValues: { employeeStatus: auditAfter?.status, loi: err instanceof Error ? err.name : "unknown" },
        reason: "Không khoá được tài khoản khi nhân sự nghỉ việc — cần xử lý tay",
      }).catch(() => undefined);
    }
  }

  // ĐƠN VỊ NẰM Ở HAI BẢNG — sửa hồ sơ thì kéo tài khoản theo (xem lib/hr/sync-employee-unit.ts).
  // Đọc LẠI sau khi ghi, không lấy từ `data`: hai cột do hai nguồn điền — `orgUnitId`
  // từ form, `centerId` do `suyCoSoTuDonVi` ở trên — và cơ chế ghi kép trong `lib/db.ts`
  // còn có thể bổ sung. Đọc lại là cách duy nhất biết kết quả cuối cùng.
  //
  // ⚠️ Cổng dưới đây trước đây KHÔNG BAO GIỜ mở: form gửi `orgUnitId` chứ không gửi
  // `centerId`, nên `data.centerId` luôn `undefined` ⇒ tài khoản `User` không bao giờ
  // được kéo theo hồ sơ, và vai cũng không được neo lại đúng đơn vị.
  if (data.centerId !== undefined) {
    const sauKhiGhi = await sdb.employee.findUnique({
      where: { id },
      select: { centerId: true, orgUnitId: true },
    });
    if (sauKhiGhi) {
      await sdb.$transaction(async (tx) => {
        await keoTaiKhoanTheoHoSo(tx as never, {
          employeeId: id,
          donVi: {
            centerId: sauKhiGhi.centerId,
            orgUnitId: sauKhiGhi.orgUnitId,
          },
          actor: auditActorOf(session),
        });
      });
    }
  }
  await writeAudit({
    actor: auditActorOf(session),
    module: "employees",
    entityType: "Employee",
    entityId: id,
    action: "UPDATE",
    oldValues: auditBefore,
    newValues: auditAfter,
    orgUnitId: auditAfter?.centerId ?? auditBefore?.centerId ?? null,
  });

  // #10 — NV HO: đồng bộ phân công PRIMARY vào OrgUnit Hội sở.
  if (isHO !== undefined) {
    await syncHoAssignment(
      sdb,
      {
        id: session.user.id,
        name:
          session.user.name ??
          session.user.email ??
          session.user.id ??
          "Unknown",
      },
      id,
      isHO,
    );
  }

  revalidateAll();
  return { ok: true };
}

export async function deleteEmployeeAction(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    // employees:delete chỉ SUPER_ADMIN (không có tầng CENTER) — không cần target.
    await assertPermission("employees:delete");
  } catch {
    return { ok: false, error: "Không có quyền" };
  }

  // Cách ly cơ sở: chỉ xoá NV trong tầm nhìn actor (chống IDOR).
  if (!(await employeeInScope(session.user.id, id))) {
    return { ok: false, error: "Không tìm thấy nhân sự" };
  }
  const sdb = scopedDb(await resolveActor(session.user.id));

  // Check xem có Honor đang link không
  const honorCount = await sdb.honor.count({ where: { employeeId: id } });
  if (honorCount > 0) {
    return {
      ok: false,
      error: `Không thể xoá: nhân sự này có ${honorCount} honor records. Xoá honors trước.`,
    };
  }

  // PR2 — nhân viên đang là NGƯỜI GIỚI THIỆU của lead (`LeadAttribution.referrerEmployeeId`, FK Restrict): căn cứ hoa hồng, không
  // xoá cứng được. Hỏi TRƯỚC khi xoá để trả lỗi tiếng Việt thay vì P2003 thô; lối ra là chuyển nghỉ việc (giữ hồ sơ).
  // Cả tài khoản của nhân sự này có đang là SALE phụ trách PH của một dòng quy nguồn (`referrerSaleUserId`) không: xoá hồ sơ nhân sự không vướng FK nhưng làm D13 (người nghỉ không nhận hoa hồng)
  // bị vượt qua im lặng — engine đọc `employee: null` là «không phải nhân sự ⇒ luôn hưởng».
  const taiKhoan = await sdb.employee.findUnique({ where: { id }, select: { userAccount: { select: { id: true } } } });
  if (await nguoiDangGioiThieuLead({ employeeId: id, ...(taiKhoan?.userAccount?.id ? { saleUserId: taiKhoan.userAccount.id } : {}) })) {
    return {
      ok: false,
      error:
        "Không thể xoá: nhân sự này đang là người giới thiệu / Sale phụ trách phụ huynh giới thiệu của các lead (nguồn lead). Hãy chuyển trạng thái nghỉ việc thay vì xoá, hoặc đổi nguồn các lead đó trước.",
    };
  }

  // Nguồn động — nhân sự đang là NGƯỜI PHỤ TRÁCH một nguồn lead (`LeadSourceGroup.ownerEmployeeId`, FK Restrict; đầu vào của vai
  // hưởng `SOURCE_OWNER`): xoá cứng sẽ ném RESTRICT thô. Hỏi TRƯỚC để trả lỗi tiếng Việt; lối ra là gán người khác phụ trách nguồn.
  if (await nhanSuDangPhuTrachNguon({ employeeId: id })) {
    return {
      ok: false,
      error:
        "Không thể xoá: nhân sự này đang là người phụ trách nguồn lead. Hãy gán người khác phụ trách nguồn đó trước, hoặc chuyển trạng thái nghỉ việc thay vì xoá.",
    };
  }

  // SEC-M06: snapshot TRƯỚC khi xoá để audit (hard-delete → mất record).
  const auditSnapshot = await sdb.employee.findUnique({
    where: { id },
    select: EMPLOYEE_AUDIT_SELECT,
  });
  await sdb.employee.delete({ where: { id } });
  await writeAudit({
    actor: auditActorOf(session),
    module: "employees",
    entityType: "Employee",
    entityId: id,
    action: "DELETE",
    oldValues: auditSnapshot,
    orgUnitId: auditSnapshot?.centerId ?? null,
  });
  revalidateAll();
  return { ok: true };
}

export async function toggleEmployeeActiveAction(
  id: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const sdb = scopedDb(await resolveActor(session.user.id));
  const emp = await sdb.employee.findUnique({ where: { id } });
  if (!emp) return { ok: false, error: "Không tìm thấy" };
  try {
    await assertPermission("employees:edit", { centerId: emp.centerId });
  } catch {
    return { ok: false, error: "Không có quyền" };
  }

  // Cách ly cơ sở: chỉ bật/tắt NV trong tầm nhìn actor (chống IDOR).
  if (!(await employeeInScope(session.user.id, id))) {
    return { ok: false, error: "Không tìm thấy" };
  }
  await sdb.employee.update({
    where: { id },
    data: { isActive: !emp.isActive },
  });
  // SEC-M06: audit bật/tắt hoạt động.
  await writeAudit({
    actor: auditActorOf(session),
    module: "employees",
    entityType: "Employee",
    entityId: id,
    action: "UPDATE",
    oldValues: { isActive: emp.isActive },
    newValues: { isActive: !emp.isActive },
    changedFields: ["isActive"],
    orgUnitId: emp.centerId,
  });
  revalidateAll();
  return { ok: true };
}

export async function toggleEmployeePublicAction(
  id: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const sdb = scopedDb(await resolveActor(session.user.id));
  const emp = await sdb.employee.findUnique({ where: { id } });
  if (!emp) return { ok: false, error: "Không tìm thấy" };
  try {
    await assertPermission("employees:edit", { centerId: emp.centerId });
  } catch {
    return { ok: false, error: "Không có quyền" };
  }

  // Cách ly cơ sở: chỉ bật/tắt hiển thị NV trong tầm nhìn actor (chống IDOR).
  if (!(await employeeInScope(session.user.id, id))) {
    return { ok: false, error: "Không tìm thấy" };
  }
  await sdb.employee.update({
    where: { id },
    data: { isPublic: !emp.isPublic },
  });
  // SEC-M06: audit bật/tắt hiển thị public.
  await writeAudit({
    actor: auditActorOf(session),
    module: "employees",
    entityType: "Employee",
    entityId: id,
    action: "UPDATE",
    oldValues: { isPublic: emp.isPublic },
    newValues: { isPublic: !emp.isPublic },
    changedFields: ["isPublic"],
    orgUnitId: emp.centerId,
  });
  revalidateAll();
  return { ok: true };
}

// ─── Role change (audit-logged) ─────────────────────────────────────────
// "Role" here = the auth Role on the Employee's linked User account.
// Employees without a linked User account cannot have their role changed
// from this UI (there's nothing to update). SUPER_ADMIN only.

// Vai trò gán được = ASSIGNABLE_ROLES (lib/labels) — loại PARENT (chỉ staff).
// z.enum cần tuple literal nên ép kiểu Role[] -> [Role, ...Role[]] (chỉ thu hẹp,
// runtime vẫn chặn giá trị ngoài danh sách 7 vai trò).
const roleEnum = z.enum(ASSIGNABLE_ROLES as [Role, ...Role[]]);
type ValidRole = z.infer<typeof roleEnum>;

// Đợt 3B — gán NHIỀU vai trò + 1 vai trò chính (primary). PARENT loại khỏi
// ASSIGNABLE_ROLES (chỉ staff) nên không thể trộn PARENT với staff ở đây.
const changeRoleSchema = z
  .object({
    employeeId: z.string().min(1),
    roles: z.array(roleEnum).min(1, "Chọn ít nhất 1 vai trò"),
    primaryRole: roleEnum,
    reason: z.string().trim().min(5, "Lý do phải có ít nhất 5 ký tự").max(500),
  })
  .refine((d) => d.roles.includes(d.primaryRole), {
    message: "Vai trò chính phải nằm trong danh sách vai trò đã chọn",
    path: ["primaryRole"],
  });

export async function changeEmployeeRoleAction(input: {
  employeeId: string;
  roles: ValidRole[];
  primaryRole: ValidRole;
  reason: string;
}): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!hasRole(session.user, "SUPER_ADMIN")) {
    return { ok: false, error: "Chỉ SUPER_ADMIN mới được thay đổi vai trò" };
  }

  const parsed = changeRoleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const roles = [...new Set(parsed.data.roles)] as ValidRole[];
  const primaryRole = parsed.data.primaryRole;

  // SUPER_ADMIN-only (gate ở trên) → sdb bypass scope; select thêm centerId cho passesScope.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const employee = await sdb.employee.findUnique({
    where: { id: parsed.data.employeeId },
    select: {
      id: true,
      fullName: true,
      centerId: true,
      // orgUnitId: đơn vị neo để đồng bộ UserOrgRole (RBAC v2) theo vai trò mới.
      userAccount: {
        select: { id: true, role: true, roles: true, orgUnitId: true },
      },
    },
  });
  if (!employee) return { ok: false, error: "Không tìm thấy nhân viên" };
  if (!employee.userAccount) {
    return {
      ok: false,
      error:
        "Nhân viên chưa có User account — không có vai trò để đổi. Tạo User cho NV này trước.",
    };
  }

  // Chống tự khoá: không được đổi vai trò CHÍNH tài khoản mình.
  if (employee.userAccount.id === session.user.id) {
    return {
      ok: false,
      error: "Không thể tự đổi vai trò của chính mình (tránh tự khoá quyền).",
    };
  }

  // Giữ tham chiếu đã narrow — closure trong $transaction không thấy narrowing ở trên.
  const userAccount = employee.userAccount;
  const fromRole = userAccount.role;
  const sameRoles =
    fromRole === primaryRole &&
    [...userAccount.roles].sort().join(",") === [...roles].sort().join(",");
  if (sameRoles) {
    return { ok: false, error: "Vai trò không thay đổi" };
  }
  // Vai trò hữu hiệu TRƯỚC (roles[] ưu tiên, fallback role chính) — mốc thu hồi vai v2.
  const previousRoles: Role[] =
    userAccount.roles.length > 0 ? userAccount.roles : [fromRole];
  // Đơn vị neo cho RBAC v2: ưu tiên User.orgUnitId; tài khoản cũ chưa gán thì suy từ
  // cơ sở của nhân sự. Vẫn null → reconcile ném lỗi có hướng dẫn (không skip im lặng).
  const anchorOrgUnitId =
    userAccount.orgUnitId ?? (await orgUnitIdForCenter(employee.centerId));
  const changedByName =
    session.user.name ?? session.user.email ?? session.user.id ?? "Unknown";

  try {
    await sdb.$transaction(
      async (txRaw) => {
        const tx = txRaw as unknown as Prisma.TransactionClient;
        await tx.user.update({
          where: { id: userAccount.id },
          // Bump tokenVersion → token cũ vô hiệu ngay request kế (buộc re-login để
          // mang roles mới). role = vai trò chính; roles = union.
          data: { role: primaryRole, roles, tokenVersion: { increment: 1 } },
        });
        await tx.roleAuditLog.create({
          data: {
            employeeId: employee.id,
            fromRole,
            toRole: primaryRole,
            changedByUserId: session.user.id ?? null,
            changedByName,
            reason: `${parsed.data.reason} · vai trò: [${roles.join(", ")}] (chính: ${primaryRole})`,
          },
        });
        // RBAC v2 phải đi CÙNG: đổi vai trò ở v1 mà quên UserOrgRole thì trên prod người
        // ta mất/giữ quyền sai (prod enforce v2). Gán vai mới + thu hồi vai cũ trong 1 tx.
        await reconcileUserOrgRoles({
          tx,
          userId: userAccount.id,
          previous: { roles: previousRoles, orgUnitId: anchorOrgUnitId },
          next: { roles, orgUnitId: anchorOrgUnitId },
          actorId: session.user.id ?? null,
          actorName: changedByName,
          reason: parsed.data.reason,
        });

        // US-03 chat — đổi vai trò có đụng CENTER_MANAGER → đồng bộ nhóm lớp của cơ sở
        // nhân sự trong cùng transaction (F-SYNC "đổi QLCS").
        if (
          previousRoles.includes("CENTER_MANAGER") ||
          roles.includes("CENTER_MANAGER")
        ) {
          await syncCenterClassConversations(tx, employee.centerId);
        }
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (err instanceof OrgRoleSyncError)
      return { ok: false, error: err.message };
    return {
      ok: false,
      error: `Lỗi DB: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidateAll();
  revalidatePath(`/nhan-su/${employee.id}/edit`);
  return { ok: true };
}
