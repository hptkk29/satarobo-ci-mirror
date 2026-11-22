// lib/auth/org-role-sync.ts — đồng bộ `UserOrgRole` (RBAC v2) theo `User.roles[]` (v1).
//
// BỐI CẢNH (sự cố 07/08/2026): `createUserAction` chỉ ghi `User.roles[]`; đường DUY NHẤT
// sinh `UserOrgRole` trong app là màn /admin/users/[id]/org-roles phải bấm tay. Prod chạy
// v2 ⇒ tài khoản mới rỗng quyền: GV đăng nhập được, thấy lớp, nhưng mọi `checkPermission`
// đều false ("Không có quyền điểm danh lớp này"). 4 tài khoản GV đã dính.
//
// THIẾT KẾ:
//   • GÁN theo trạng thái THẬT trong DB (không diff) ⇒ idempotent + tự CHỮA tài khoản cũ
//     đang thiếu vai mỗi lần admin sửa user.
//   • THU HỒI theo DIFF (vai suy từ trạng thái TRƯỚC mà trạng thái SAU không còn) ⇒ không
//     bao giờ đụng vai người ta gán tay ở /admin/users/[id]/org-roles.
//   • KHÔNG bỏ qua im lặng: thiếu đơn vị hoặc thiếu RoleDef → ném lỗi, transaction rollback.
//     Chính cái "skip im lặng" của `patch-rbac-staff.ts:123` đã đẻ ra sự cố này.
import type { Prisma, Role } from "@prisma/client";
import { logRbacAudit } from "@/lib/audit/log";
import {
  planOrgRoleTargets,
  type OrgRoleTarget,
} from "@/lib/auth/legacy-role-map";

/** Lỗi nghiệp vụ — message tiếng Việt, hiện thẳng cho admin. */
export class OrgRoleSyncError extends Error {
  readonly code = "ORG_ROLE_SYNC_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "OrgRoleSyncError";
  }
}

type Tx = Prisma.TransactionClient;

/** Ảnh chụp vai trò + đơn vị của tài khoản tại một thời điểm. */
export type RoleSnapshot = {
  roles: readonly Role[];
  /** `User.orgUnitId`. null = chưa gán đơn vị. */
  orgUnitId: string | null;
};

export type ReconcileInput = {
  tx: Tx;
  userId: string;
  /** Trạng thái TRƯỚC thao tác (tạo mới → `{ roles: [], orgUnitId: null }`). */
  previous: RoleSnapshot;
  /** Trạng thái SAU thao tác. */
  next: RoleSnapshot;
  actorId: string | null;
  actorName: string;
  reason: string;
  /**
   * DỌN DÒNG ĐẶT SAI CHỖ — mặc định TẮT, bật có chủ đích.
   *
   * Vòng thu hồi thường chỉ đụng những dòng mà `previous` DỰ ĐOÁN là đang có. Nếu dòng thật
   * nằm ở đơn vị khác với thứ `previous` nói, nó KHÔNG BAO GIỜ được dọn — đo được trên prod
   * 22/08/2026: tài khoản có `User.orgUnitId = CS2` nhưng vẫn giữ dòng vai neo tại Hội sở,
   * và lưu lại hồ sơ bao nhiêu lần cũng không gỡ được.
   *
   * Bật cờ này thì ngoài vòng thường, hàm dọn thêm các dòng ĐANG HIỆU LỰC mang ĐÚNG VAI
   * mà bảng ánh xạ vừa sinh ra, nhưng đặt ở ĐƠN VỊ KHÁC với nơi đúng.
   *
   * ⚠️ Chỉ bật ở đường ĐỒNG BỘ ĐƠN VỊ TỪ HỒ SƠ NHÂN SỰ, nơi hồ sơ LÀ nguồn sự thật về "người
   * này làm ở đâu". Đừng bật ở đường đổi vai trò hay đường gán tay: ở đó một người CÓ THỂ
   * được cấp cùng một vai ở nhiều đơn vị một cách hợp lệ (GV dạy chéo cơ sở), và dọn ở đó là
   * thu hồi nhầm quyền của người đang dùng.
   */
  revokeMisplaced?: boolean;
};

export type ReconcileResult = {
  /** RoleDef.code đã gán thêm. */
  assigned: string[];
  /** RoleDef.code đã thu hồi. */
  revoked: string[];
};

/** Dòng phân quyền còn hiệu lực tại `now`. */
function isLive(
  row: { status: string; effectiveFrom: Date; effectiveTo: Date | null },
  now: Date,
): boolean {
  return (
    row.status === "ACTIVE" &&
    row.effectiveFrom <= now &&
    (row.effectiveTo === null || row.effectiveTo >= now)
  );
}

/**
 * Đồng bộ `UserOrgRole` cho 1 tài khoản. Gọi BÊN TRONG transaction đã ghi `User.roles[]`
 * — ném lỗi là cả cụm rollback, không để tài khoản nửa vời (có roles[] mà không có vai v2).
 */
export async function reconcileUserOrgRoles(
  input: ReconcileInput,
): Promise<ReconcileResult> {
  const { tx, userId } = input;
  const now = new Date();

  const orgs = await tx.orgUnit.findMany({
    where: { deletedAt: null },
    select: { id: true, type: true },
  });
  const ho =
    orgs.find((o) => o.type === "HO") ?? orgs.find((o) => o.type === "ROOT");
  if (!ho) {
    throw new OrgRoleSyncError(
      "Chưa có đơn vị Hội sở (OrgUnit type=HO) — không gán được quyền RBAC. Chạy seed OrgUnit trước.",
    );
  }
  const typeById = new Map(orgs.map((o) => [o.id, o.type]));

  const plan = (snap: RoleSnapshot) =>
    planOrgRoleTargets({
      roles: snap.roles,
      anchorOrgUnitId: snap.orgUnitId,
      anchorIsCenter: snap.orgUnitId
        ? typeById.get(snap.orgUnitId) === "CENTER"
        : false,
      hoOrgUnitId: ho.id,
    });

  const nextPlan = plan(input.next);
  if (nextPlan.missingAnchor.length > 0) {
    throw new OrgRoleSyncError(
      `Chưa chọn "Đơn vị" cho tài khoản — vai trò ${nextPlan.missingAnchor.join(", ")} ` +
        `cần đơn vị mới gán được quyền (RBAC v2). Chọn đơn vị rồi lưu lại.`,
    );
  }
  // Đơn vị TRƯỚC có thể null (tài khoản cũ) → prevPlan rỗng → chỉ gán thêm, không thu hồi gì.
  const prevPlan = plan(input.previous);

  const codes = [
    ...new Set(
      [...nextPlan.targets, ...prevPlan.targets].map((t) => t.roleCode),
    ),
  ];
  if (codes.length === 0) return { assigned: [], revoked: [] };

  const roleDefs = await tx.roleDef.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, isActive: true },
  });
  const roleIdByCode = new Map(roleDefs.map((r) => [r.code, r.id]));
  const missing = codes.filter((c) => !roleIdByCode.has(c));
  if (missing.length > 0) {
    throw new OrgRoleSyncError(
      `Thiếu RoleDef: ${missing.join(", ")} — chạy workflow "Seed Production RolePermission" rồi thử lại.`,
    );
  }
  const inactive = roleDefs.filter((r) => !r.isActive).map((r) => r.code);
  if (inactive.length > 0) {
    throw new OrgRoleSyncError(
      `Vai trò ${inactive.join(", ")} đang bị tắt (RoleDef.isActive=false) — bật lại ở /admin/roles rồi thử lại.`,
    );
  }

  const existing = await tx.userOrgRole.findMany({
    where: { userId },
    select: {
      orgUnitId: true,
      roleId: true,
      status: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });
  const liveKeys = new Set(
    existing
      .filter((r) => isLive(r, now))
      .map((r) => `${r.orgUnitId}:${r.roleId}`),
  );

  const rowKey = (t: OrgRoleTarget) =>
    `${t.orgUnitId}:${roleIdByCode.get(t.roleCode) as string}`;
  const nextKeys = new Set(nextPlan.targets.map(rowKey));

  // GÁN: mọi vai đích chưa còn hiệu lực trong DB (kể cả dòng cũ đã EXPIRED → kích hoạt lại).
  const assigned: string[] = [];
  for (const t of nextPlan.targets) {
    if (liveKeys.has(rowKey(t))) continue;
    const roleId = roleIdByCode.get(t.roleCode) as string;
    await tx.userOrgRole.upsert({
      where: {
        userId_orgUnitId_roleId: { userId, orgUnitId: t.orgUnitId, roleId },
      },
      update: { status: "ACTIVE", effectiveFrom: now, effectiveTo: null },
      create: {
        userId,
        orgUnitId: t.orgUnitId,
        roleId,
        status: "ACTIVE",
        effectiveFrom: now,
        grantedById: input.actorId ?? userId,
      },
    });
    await logRbacAudit({
      entity: "ASSIGNMENT",
      entityId: `${userId}:${t.orgUnitId}:${roleId}`,
      action: "ASSIGN",
      actorId: input.actorId,
      actorName: input.actorName,
      reason: input.reason,
      newValues: {
        userId,
        orgUnitId: t.orgUnitId,
        roleCode: t.roleCode,
        legacyRole: t.legacy,
        status: "ACTIVE",
        auto: true,
      },
      tx,
    });
    assigned.push(t.roleCode);
  }

  // THU HỒI: vai suy từ trạng thái TRƯỚC mà trạng thái SAU không còn (đổi vai trò / đổi
  // đơn vị). Chỉ đụng dòng do bảng ánh xạ sinh ra — vai gán tay nằm ngoài prevPlan.
  const revoked: string[] = [];
  for (const t of prevPlan.targets) {
    const key = rowKey(t);
    if (nextKeys.has(key) || !liveKeys.has(key)) continue;
    const roleId = roleIdByCode.get(t.roleCode) as string;
    await tx.userOrgRole.update({
      where: {
        userId_orgUnitId_roleId: { userId, orgUnitId: t.orgUnitId, roleId },
      },
      data: { status: "EXPIRED", effectiveTo: now },
    });
    await logRbacAudit({
      entity: "ASSIGNMENT",
      entityId: `${userId}:${t.orgUnitId}:${roleId}`,
      action: "REVOKE",
      actorId: input.actorId,
      actorName: input.actorName,
      reason: input.reason,
      oldValues: { status: "ACTIVE" },
      newValues: {
        roleCode: t.roleCode,
        legacyRole: t.legacy,
        status: "EXPIRED",
        effectiveTo: now,
        auto: true,
      },
      tx,
    });
    revoked.push(t.roleCode);
  }

  // DỌN DÒNG ĐẶT SAI CHỖ (chỉ khi `revokeMisplaced`) — xem chú thích ở `ReconcileInput`.
  //
  // Vòng trên dựa vào `previous`, tức dựa vào thứ người gọi TIN LÀ đang có. Vòng này dựa vào
  // DÒNG THẬT trong DB. Chỉ đụng những vai mà bảng ánh xạ VỪA SINH RA (`nextPlan`), nên vai gán
  // tay mang mã khác vẫn nằm ngoài tầm với.
  if (input.revokeMisplaced) {
    const noiDung = new Map<string, string>(); // roleId -> orgUnitId ĐÚNG
    for (const t of nextPlan.targets) {
      noiDung.set(roleIdByCode.get(t.roleCode) as string, t.orgUnitId);
    }
    const codeByRoleId = new Map(roleDefs.map((r) => [r.id, r.code]));

    for (const row of existing) {
      if (!isLive(row, now)) continue;
      const dung = noiDung.get(row.roleId);
      // Vai không thuộc bảng ánh xạ lần này ⇒ không đụng. Đặt đúng chỗ ⇒ không đụng.
      if (dung === undefined || dung === row.orgUnitId) continue;

      await tx.userOrgRole.update({
        where: {
          userId_orgUnitId_roleId: {
            userId,
            orgUnitId: row.orgUnitId,
            roleId: row.roleId,
          },
        },
        data: { status: "EXPIRED", effectiveTo: now },
      });
      const code = codeByRoleId.get(row.roleId) ?? row.roleId;
      await logRbacAudit({
        entity: "ASSIGNMENT",
        entityId: `${userId}:${row.orgUnitId}:${row.roleId}`,
        action: "REVOKE",
        actorId: input.actorId,
        actorName: input.actorName,
        // Lý do KHÁC vòng trên, để người đọc nhật ký phân biệt được "đổi đơn vị bình thường"
        // với "dọn một dòng đã kẹt sai chỗ từ trước".
        reason: `${input.reason} — dọn dòng vai đặt sai đơn vị`,
        oldValues: { status: "ACTIVE", orgUnitId: row.orgUnitId },
        newValues: {
          roleCode: code,
          status: "EXPIRED",
          effectiveTo: now,
          dungRa: dung,
          auto: true,
        },
        tx,
      });
      revoked.push(code);
    }
  }

  return { assigned, revoked };
}
