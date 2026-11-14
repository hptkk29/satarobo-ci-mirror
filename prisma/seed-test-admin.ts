/**
 * Seed 1 tài khoản ADMIN DÙNG CHUNG để test local (SUPER_ADMIN @ HO — thấy mọi cơ sở).
 *   pnpm tsx prisma/seed-test-admin.ts
 * Idempotent (upsert theo email). Re-run = bật lại active + reset mật khẩu. KHÔNG cho prod.
 */
import bcrypt from "bcryptjs";
import { db } from "../lib/db";

const EMAIL = "admin.local@satarobo.vn";
const PASSWORD = "Test@1234";
const NAME = "Admin Local (Test)";

async function main() {
  const password = await bcrypt.hash(PASSWORD, 12);

  // 1) User SUPER_ADMIN active.
  const admin = await db.user.upsert({
    where: { email: EMAIL },
    update: {
      role: "SUPER_ADMIN",
      roles: ["SUPER_ADMIN"],
      isActive: true,
      accountStatus: "ACTIVE",
      password,
      tokenVersion: { increment: 1 }, // vô hiệu token cũ nếu có
    },
    create: {
      email: EMAIL,
      name: NAME,
      password,
      role: "SUPER_ADMIN",
      roles: ["SUPER_ADMIN"],
      isActive: true,
      accountStatus: "ACTIVE",
    },
  });

  // 2) Scope RBAC v2: UserOrgRole SUPER_ADMIN @ HO → resolveActor ra HO-level (thấy mọi
  //    cơ sở). Thiếu bước này thì actor scope rỗng (RC-A).
  const hoOrg = await db.orgUnit.findUnique({ where: { code: "HO" }, select: { id: true } });
  const superRole = await db.roleDef.findUnique({
    where: { code: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (hoOrg && superRole) {
    await db.userOrgRole.upsert({
      where: {
        userId_orgUnitId_roleId: {
          userId: admin.id,
          orgUnitId: hoOrg.id,
          roleId: superRole.id,
        },
      },
      update: { status: "ACTIVE", effectiveTo: null },
      create: {
        userId: admin.id,
        orgUnitId: hoOrg.id,
        roleId: superRole.id,
        status: "ACTIVE",
        grantedById: admin.id,
      },
    });
  } else {
    console.warn("⚠️  Thiếu OrgUnit HO hoặc RoleDef SUPER_ADMIN — chạy `pnpm db:seed` trước.");
  }

  console.log("✅ Admin test sẵn sàng:");
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Mật khẩu: ${PASSWORD}`);
  console.log(`   Scope:    SUPER_ADMIN @ HO (thấy mọi cơ sở)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
