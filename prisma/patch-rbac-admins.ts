// prisma/patch-rbac-admins.ts — RC-A hotfix: vá UserOrgRole cho admin/superadmin.
//
// Bối cảnh: hệ chạy LAI auth cũ (User.role) + mới (resolveActor/UserOrgRole).
// User superadmin legacy KHÔNG có UserOrgRole → resolveActor() ra scope rỗng →
// vỡ addLeadChild / dropdown cơ sở / /classes. Script này gán SUPER_ADMIN @ HO
// cho mọi user có vai trò SUPER_ADMIN (legacy) để actor trở thành HO-level
// (isSuperAdmin = true → can() bypass, thấy mọi center).
//
// AN TOÀN PROD:
//  - Idempotent: upsert theo khoá composite — chạy nhiều lần không tạo trùng.
//  - KHÔNG reset RolePermission (chỉ upsert RoleDef SUPER_ADMIN tối thiểu) → không
//    đụng role/permission tuỳ biến tạo qua UI.
//  - seedOrgUnits là upsert thuần (không xoá) → an toàn.
//  - PROD: chỉ chạy SAU khi đã backup DB. Dev/staging chạy thoải mái.
//
// Chạy: `tsx prisma/patch-rbac-admins.ts`  (đọc DATABASE_URL/DIRECT_URL hiện hành)
import { PrismaClient } from "@prisma/client";
import { seedOrgUnits } from "./seed-orgunit";

const db = new PrismaClient();

async function main() {
  console.log("🔧 RC-A patch: gán UserOrgRole SUPER_ADMIN @ HO cho admin…");

  // 1) Đảm bảo cây OrgUnit (ROOT/HO/CS1/CS2) tồn tại — upsert thuần, không xoá.
  await seedOrgUnits(db);

  // 2) Đảm bảo RoleDef SUPER_ADMIN tồn tại (KHÔNG reset permission của role khác).
  const superAdminRole = await db.roleDef.upsert({
    where: { code: "SUPER_ADMIN" },
    update: { isActive: true, isSystem: true },
    create: { code: "SUPER_ADMIN", name: "Quản trị tối cao", isSystem: true },
    select: { id: true },
  });

  // 3) HO OrgUnit (gán role HO-level → cross-center theo chức năng).
  const hoOrg = await db.orgUnit.findUnique({ where: { code: "HO" }, select: { id: true } });
  if (!hoOrg) {
    throw new Error("Không tìm thấy OrgUnit code=HO sau seedOrgUnits — dừng để tránh gán sai.");
  }

  // 4) Mọi user còn hiệu lực có vai trò SUPER_ADMIN (primary hoặc trong roles[]).
  const admins = await db.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      OR: [{ role: "SUPER_ADMIN" }, { roles: { has: "SUPER_ADMIN" } }],
    },
    select: { id: true, email: true },
  });

  if (admins.length === 0) {
    console.warn("⚠️  Không có user SUPER_ADMIN nào (legacy) — không gán gì.");
    return;
  }

  let patched = 0;
  for (const u of admins) {
    await db.userOrgRole.upsert({
      where: {
        userId_orgUnitId_roleId: {
          userId: u.id,
          orgUnitId: hoOrg.id,
          roleId: superAdminRole.id,
        },
      },
      update: { status: "ACTIVE", effectiveTo: null },
      create: {
        userId: u.id,
        orgUnitId: hoOrg.id,
        roleId: superAdminRole.id,
        status: "ACTIVE",
        grantedById: u.id, // tự cấp (hotfix) — audit ghi rõ nguồn là script
      },
    });
    patched++;
    console.log(`  ✓ ${u.email} → SUPER_ADMIN @ HO`);
  }

  console.log(`✅ Đã vá ${patched}/${admins.length} superadmin.`);
}

main()
  .catch((e) => {
    console.error("❌ patch-rbac-admins thất bại:", e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
