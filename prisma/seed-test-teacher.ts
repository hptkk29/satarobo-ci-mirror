/**
 * Seed 1 tài khoản GIÁO VIÊN để test "Tài liệu lớp tôi" + trình chiếu SCORM (local).
 *   pnpm tsx prisma/seed-test-teacher.ts
 * Idempotent (upsert theo email). KHÔNG dùng cho prod.
 *
 * - Cấp UserOrgRole TEACHER @ CS1 → actor có scope cơ sở (RC-A: thiếu UserOrgRole →
 *   resolveActor ra scope rỗng → GV không thấy lớp nào).
 * - Gán GV vào 1 lớp ở CS1 (ưu tiên lớp của seed-test-parent để test xuyên suốt;
 *   fallback lớp CS1 bất kỳ). KHÔNG xoá GV chính: chỉ điền slot trống (teacherId rồi
 *   assistantId); nếu cả 2 đã có thì ghi đè assistantId (log lại slot cũ).
 */
import bcrypt from "bcryptjs";
import { db } from "../lib/db";

const EMAIL = "giaovien.test@satarobo.vn";
const PASSWORD = "Test@1234";
const TEST_CLASS_ID = "cmqqhcvoj00061ey49q5eqc20"; // CS1.SATA3.26.001 (cùng seed-test-parent)

async function main() {
  const password = await bcrypt.hash(PASSWORD, 12);

  const cs1Center = await db.center.findFirst({ where: { code: "CS1" }, select: { id: true } });
  if (!cs1Center) throw new Error("Thiếu Center CS1 — chạy `pnpm db:seed` trước.");
  const cs1Org = await db.orgUnit.findUnique({ where: { code: "CS1" }, select: { id: true } });
  const teacherRole = await db.roleDef.findUnique({ where: { code: "TEACHER" }, select: { id: true } });

  // 1) Tài khoản GV.
  const teacher = await db.user.upsert({
    where: { email: EMAIL },
    update: {
      role: "TEACHER",
      roles: ["TEACHER"],
      isActive: true,
      accountStatus: "ACTIVE",
      password,
      centerId: cs1Center.id,
    },
    create: {
      email: EMAIL,
      name: "Thầy Nam (Test)",
      password,
      role: "TEACHER",
      roles: ["TEACHER"],
      isActive: true,
      accountStatus: "ACTIVE",
      centerId: cs1Center.id,
    },
  });

  // 2) Scope: UserOrgRole TEACHER @ CS1 (idempotent).
  if (cs1Org && teacherRole) {
    await db.userOrgRole.upsert({
      where: {
        userId_orgUnitId_roleId: {
          userId: teacher.id,
          orgUnitId: cs1Org.id,
          roleId: teacherRole.id,
        },
      },
      update: { status: "ACTIVE", effectiveTo: null },
      create: {
        userId: teacher.id,
        orgUnitId: cs1Org.id,
        roleId: teacherRole.id,
        status: "ACTIVE",
        grantedById: teacher.id,
      },
    });
  } else {
    console.warn("⚠️  Thiếu OrgUnit CS1 hoặc RoleDef TEACHER — bỏ qua UserOrgRole (chạy db:seed).");
  }

  // 3) Hồ sơ GV (FIX 10) — idempotent.
  const hasProfile = await db.teacherProfile.findFirst({
    where: { userId: teacher.id },
    select: { id: true },
  });
  if (!hasProfile) await db.teacherProfile.create({ data: { userId: teacher.id } });

  // 4) Gán GV vào 1 lớp CS1.
  const cls =
    (await db.class.findFirst({
      where: { id: TEST_CLASS_ID, deletedAt: null },
      select: { id: true, name: true, classCode: true, teacherId: true, assistantId: true },
    })) ??
    (await db.class.findFirst({
      where: { deletedAt: null, centerId: cs1Center.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, classCode: true, teacherId: true, assistantId: true },
    }));

  let assignment = "—";
  if (cls) {
    if (!cls.teacherId) {
      await db.class.update({ where: { id: cls.id }, data: { teacherId: teacher.id } });
      assignment = "giáo viên chính (teacherId)";
    } else if (cls.teacherId === teacher.id) {
      assignment = "giáo viên chính (đã gán)";
    } else if (!cls.assistantId || cls.assistantId === teacher.id) {
      await db.class.update({ where: { id: cls.id }, data: { assistantId: teacher.id } });
      assignment = "trợ giảng (assistantId)";
    } else {
      console.warn(`⚠️  Lớp đã có cả GV chính + trợ giảng — ghi đè trợ giảng (cũ: ${cls.assistantId}).`);
      await db.class.update({ where: { id: cls.id }, data: { assistantId: teacher.id } });
      assignment = "trợ giảng (ghi đè)";
    }
  } else {
    console.warn("⚠️  Không tìm thấy lớp CS1 nào — GV chưa gán lớp (tạo lớp ở /admin/classes rồi gán).");
  }

  console.log("✅ Tài khoản giáo viên test đã sẵn sàng:");
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Mật khẩu: ${PASSWORD}`);
  console.log(`   Lớp:      ${cls ? `${cls.name}${cls.classCode ? ` (${cls.classCode})` : ""} — ${assignment}` : "chưa gán"}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌ Seed lỗi:", e);
    await db.$disconnect();
    process.exit(1);
  });
