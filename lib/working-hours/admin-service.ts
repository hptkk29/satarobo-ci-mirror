// lib/working-hours/admin-service.ts — tầng ĐỌC/GHI DB cho MÀN QUẢN TRỊ giờ làm việc.
//
// Tách khỏi `./service.ts` (đường ĐỌC lúc chạy nghiệp vụ) vì hai bên hỏi hai câu khác nhau:
// service hỏi "giờ có hiệu lực là gì" (đã trộn xong 4 bậc), màn quản trị phải phân biệt
// được "dòng khai riêng của chính đơn vị này" với "giá trị đang kế thừa" — trộn xong rồi
// thì không tách ngược ra được nữa.
//
// Vì sao file này ở `lib/` chứ không nằm cạnh page: `app/(admin|portal|teacher)/**` bị
// ESLint chặn import `@/lib/db` trần (luật CLAUDE.md #4). Server Action gọi xuống đây.
//
// ⚠️ KHÔNG có lưới an toàn tầng truy vấn. `WorkingHourRule` không nằm trong SCOPED_MODELS
// (bảng không có cột `centerId` — luật Nền Hệ thống #3 dùng `orgUnitId`), nên `scopedDb`
// không chặn giúp được gì. Mọi chỗ gọi PHẢI tự gác quyền theo đơn vị đích trước khi ghi.

import "server-only";
import { db } from "@/lib/db";
import {
  WILDCARD,
  resolveWorkingHourWeek,
  type WorkingHourRuleRow,
  type WorkingHourWeek,
} from "./rules";

/** Vai chọn được trong dropdown "khai giờ riêng cho vai". */
export type RoleOption = { code: string; name: string };

export type WorkingHourAdminView = {
  /** Dòng khai riêng đúng cặp (đơn vị, vai) đang xem — có thể rỗng. */
  ownRows: WorkingHourRuleRow[];
  /** Giờ sẽ có hiệu lực NẾU không khai riêng gì cả (bậc trên + lưới mặc định). */
  inheritedWeek: WorkingHourWeek;
};

/**
 * Center.id → OrgUnit.id, ĐÚNG hai nhánh như `ORG_UNIT_FOR_CENTER_SQL` của
 * `lib/org/center-bridge.ts`.
 *
 * Vì sao không dùng thẳng `orgUnitIdForCenter()` (lib/org/org-service): hàm đó chỉ có
 * nhánh `OrgUnit.centerId = <id>`, nên với Center "hoi-so" — bản ghi MỒ CÔI đã biết, không
 * OrgUnit nào trỏ tới vì luật V7 cấm đơn vị HO mang `centerId` — nó trả `null` im lặng.
 * Ở màn này, `null` nghĩa là không lưu được gì cả, nên phải bắc cầu theo `code` như bảng
 * bridge vẫn làm; và khi vẫn không ra thì TRẢ NULL để chỗ gọi báo lỗi rõ ràng, tuyệt đối
 * không âm thầm rơi về sentinel "*" (ghi nhầm vào luật TOÀN HỆ THỐNG cho mọi cơ sở).
 */
export async function orgUnitIdForCenterBridged(center: {
  id: string;
  code: string | null;
}): Promise<string | null> {
  const direct = await db.orgUnit.findFirst({
    where: { centerId: center.id, deletedAt: null },
    select: { id: true },
  });
  if (direct) return direct.id;

  if (!center.code) return null;
  const byCode = await db.orgUnit.findFirst({
    where: { code: center.code, centerId: null, deletedAt: null },
    select: { id: true },
  });
  return byCode?.id ?? null;
}

/** Vai đang hoạt động cho dropdown. `RoleDef` là nguồn vai duy nhất (RBAC động). */
export async function listRoleOptions(): Promise<RoleOption[]> {
  return db.roleDef.findMany({
    where: { isActive: true },
    select: { code: true, name: true },
    orderBy: [{ name: "asc" }],
  });
}

/**
 * Dữ liệu cho bảng 7 thứ: dòng khai riêng + bảng tuần KẾ THỪA (đã loại chính cặp đang xem).
 *
 * Một truy vấn cho cả hai (như `getWorkingHourWeek`), rồi lọc trong bộ nhớ: tối đa 28 dòng
 * cấu hình, đi thêm vòng DB chỉ để tách hai tập là đắt vô ích.
 */
export async function loadWorkingHourAdminView(
  orgUnitId: string,
  roleCode: string,
): Promise<WorkingHourAdminView> {
  const rows = await db.workingHourRule.findMany({
    where: {
      orgUnitId: orgUnitId === WILDCARD ? WILDCARD : { in: [orgUnitId, WILDCARD] },
      roleCode: roleCode === WILDCARD ? WILDCARD : { in: [roleCode, WILDCARD] },
    },
    select: {
      orgUnitId: true,
      roleCode: true,
      weekday: true,
      openTime: true,
      closeTime: true,
      isClosed: true,
    },
  });

  const isOwn = (r: WorkingHourRuleRow) =>
    r.orgUnitId === orgUnitId && r.roleCode === roleCode;

  return {
    ownRows: rows.filter(isOwn),
    // Bỏ chính cặp đang xem ra rồi mới suy: đó đúng là "nếu tôi không khai gì thì sao".
    inheritedWeek: resolveWorkingHourWeek(rows.filter((r) => !isOwn(r)), orgUnitId, roleCode),
  };
}

/**
 * Ghi khai riêng cho một cặp (đơn vị, vai): upsert các thứ được khai, XOÁ các thứ còn lại.
 *
 * Xoá-thứ-không-khai chính là đường "trả về kế thừa" — nếu chỉ upsert thì một thứ đã lỡ
 * khai riêng sẽ dính vĩnh viễn, và người dùng không còn cách nào quay lại giá trị bậc trên
 * ngoài việc sửa DB tay.
 *
 * Cả hai vế nằm trong MỘT transaction: nửa chừng lỗi mà đã xoá xong sẽ để lại đơn vị này
 * chạy theo giờ của bậc trên trong im lặng.
 */
export async function saveWorkingHourRules(params: {
  orgUnitId: string;
  roleCode: string;
  rows: readonly WorkingHourRuleRow[];
  clearWeekdays: readonly number[];
  actorId: string | null;
  actorName: string;
}): Promise<void> {
  const { orgUnitId, roleCode, rows, clearWeekdays, actorId, actorName } = params;

  await db.$transaction(async (tx) => {
    if (clearWeekdays.length > 0) {
      await tx.workingHourRule.deleteMany({
        where: { orgUnitId, roleCode, weekday: { in: [...clearWeekdays] } },
      });
    }
    for (const row of rows) {
      await tx.workingHourRule.upsert({
        where: {
          orgUnitId_roleCode_weekday: { orgUnitId, roleCode, weekday: row.weekday },
        },
        update: {
          openTime: row.openTime,
          closeTime: row.closeTime,
          isClosed: row.isClosed,
          updatedById: actorId,
          updatedByName: actorName,
        },
        create: {
          orgUnitId,
          roleCode,
          weekday: row.weekday,
          openTime: row.openTime,
          closeTime: row.closeTime,
          isClosed: row.isClosed,
          updatedById: actorId,
          updatedByName: actorName,
        },
      });
    }
  });
}
