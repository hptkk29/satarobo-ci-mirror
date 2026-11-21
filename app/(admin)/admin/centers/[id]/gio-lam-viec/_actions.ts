"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import {
  firstIssueMessage,
  toRuleRows,
  weekdaysToClear,
  workingHourFormSchema,
} from "@/lib/working-hours/form";
import {
  loadWorkingHourAdminView,
  orgUnitIdForCenterBridged,
  saveWorkingHourRules,
} from "@/lib/working-hours/admin-service";
import { WILDCARD, type WorkingHourRuleRow } from "@/lib/working-hours/rules";

type ActionResult = { ok: true } | { ok: false; error: string };

/** Dòng cấu hình → chuỗi gọn để nhật ký đọc được bằng mắt ("1: nghỉ", "2: 07:45-21:00"). */
function summarize(rows: readonly WorkingHourRuleRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of [...rows].sort((a, b) => a.weekday - b.weekday)) {
    out[String(row.weekday)] = row.isClosed
      ? "nghỉ"
      : `${row.openTime ?? "?"}-${row.closeTime ?? "?"}`;
  }
  return out;
}

/**
 * Lưu khai riêng giờ làm việc cho một cơ sở (× một vai, hoặc "*" = mọi vai).
 *
 * DÙNG LẠI quyền `centers:edit` thay vì đẻ permission mới: quyền mới bắt buộc phải chạy
 * workflow `seed-prod-roles.yml` sau khi merge, quên là màn này TRẮNG với mọi vai trên
 * prod — cái bẫy đã cắn dự án này rồi (xem ghi chú `session-feedback:view-all`).
 * Hệ quả phải chấp nhận: `centers:edit` hiện chỉ SUPER_ADMIN có (v1 matrix
 * `lib/auth/permissions.ts`, và v2 không role nào được seed action này) ⇒ quản lý cơ sở
 * XEM được nhưng chưa tự khai được. Muốn mở cho họ thì thêm `{ action: "centers:edit",
 * scopeType: "CENTER" }` vào `prisma/seed-roles.ts` + chạy seed — thêm DỮ LIỆU, không
 * phải sửa code ở đây.
 */
export async function saveWorkingHoursAction(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // KHÔNG có cổng gác "trần" ở đây: `centers:edit` mang scope CENTER ở một số vai, mà
  // scope CENTER chỉ so được khi lời gọi có ĐÍCH — gác trần là chặn oan đúng những vai
  // đáng lẽ được phép (test `lib/auth/rbac-scope.test.ts` khoá cái bẫy này). Cổng THẬT
  // nằm bên dưới, sau khi đã biết cơ sở đích. Trước đó chỉ có: validate đầu vào (không
  // chạm DB) và một truy vấn đọc Center ĐÃ qua `scopedDb`.
  const parsed = workingHourFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const center = await sdb.center.findUnique({
    where: { id: parsed.data.centerId },
    select: { id: true, code: true, name: true },
  });
  if (!center) return { ok: false, error: "Cơ sở không tồn tại" };

  // `WorkingHourRule.orgUnitId` là OrgUnit.id, KHÔNG phải Center.id. Lấy sai thì ghi vẫn
  // thành công nhưng đường đọc không bao giờ khớp — cấu hình im lặng vô tác dụng.
  const orgUnitId = await orgUnitIdForCenterBridged(center);
  if (!orgUnitId) {
    return {
      ok: false,
      error: `Cơ sở "${center.name}" chưa được gắn với đơn vị nào trong cây tổ chức — không lưu được giờ làm việc. Vui lòng tạo/gắn OrgUnit cho cơ sở này trước.`,
    };
  }
  if (orgUnitId === WILDCARD) {
    // Bất biến phòng thủ: "*" là luật TOÀN HỆ THỐNG. Một OrgUnit.id trùng "*" là không
    // thể xảy ra (cuid), nhưng ghi nhầm vào đó là đổi giờ của mọi cơ sở cùng lúc.
    return { ok: false, error: "Đơn vị không hợp lệ" };
  }

  // Kiểm quyền LẦN HAI, lần này có đích: `can()` mới so được scope CENTER/đơn vị.
  // Tuyệt đối không thay bằng so `centerId` tay ở đây (luật cứng #1 Nền Hệ thống).
  if (!(await checkPermission("centers:edit", { centerId: center.id, orgUnitId }))) {
    return { ok: false, error: "Không có quyền chỉnh giờ làm việc của cơ sở này" };
  }

  const roleCode = parsed.data.roleCode;
  const before = await loadWorkingHourAdminView(orgUnitId, roleCode);
  const rows = toRuleRows(orgUnitId, parsed.data);

  try {
    const { actorId, actorName } = getAuditActor(session);
    await saveWorkingHourRules({
      orgUnitId,
      roleCode,
      rows,
      clearWeekdays: weekdaysToClear(parsed.data),
      actorId,
      actorName,
    });

    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "settings",
      entityType: "WorkingHourRule",
      // Không có một dòng "chủ" nào để trỏ tới (mỗi thứ là một dòng riêng), nên entityId
      // là KHOÁ LOGIC của cấu hình — đủ để lọc lại đúng cụm khi tra nhật ký.
      entityId: `${orgUnitId}:${roleCode}`,
      action: "working-hours.update",
      oldValues: summarize(before.ownRows),
      newValues: summarize(rows),
      orgUnitId,
    });
  } catch {
    return { ok: false, error: "Lỗi cơ sở dữ liệu — chưa lưu được giờ làm việc" };
  }

  // Hai đường: URL sạch trên host admin (`/centers/...`) và path thật của Next
  // (`/admin/centers/...`) — proxy rewrite giữa hai bên nên phải dọn cả hai.
  revalidatePath(`/centers/${center.id}/gio-lam-viec`);
  revalidatePath(`/admin/centers/${center.id}/gio-lam-viec`);
  return { ok: true };
}
