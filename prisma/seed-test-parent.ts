/**
 * Seed 1 tài khoản PHỤ HUYNH để test Portal v2 (local).
 *   pnpm tsx prisma/seed-test-parent.ts
 * Idempotent (upsert theo email / studentCode). KHÔNG dùng cho prod.
 */
import bcrypt from "bcryptjs";
import { db } from "../lib/db";

const EMAIL = "phuhuynh.test@satarobo.vn";
const PASSWORD = "Test@1234";
const CENTER_ID = "co-so-nguyen-huu-tho"; // CS1 (đã có trong DB)

async function main() {
  const password = await bcrypt.hash(PASSWORD, 12);

  const parent = await db.user.upsert({
    where: { email: EMAIL },
    update: { role: "PARENT", roles: ["PARENT"], isActive: true, accountStatus: "ACTIVE", password },
    create: {
      email: EMAIL,
      name: "Chị Hương (Test)",
      password,
      role: "PARENT",
      roles: ["PARENT"],
      isActive: true,
      accountStatus: "ACTIVE",
    },
  });

  const kids = [
    { code: "CS1-TEST-001", name: "Nguyễn Bảo Minh" },
    { code: "CS1-TEST-002", name: "Nguyễn Bảo An" },
  ];

  for (const k of kids) {
    await db.student.upsert({
      where: { studentCode: k.code },
      update: { parentUserId: parent.id, centerId: CENTER_ID, status: "ACTIVE", deletedAt: null },
      create: {
        name: k.name,
        studentCode: k.code,
        parentUserId: parent.id,
        centerId: CENTER_ID,
        status: "ACTIVE",
      },
    });
  }

  // Ghi danh 2 con vào 1 lớp ACTIVE ở CS1 + chốt giá → dashboard hiện học phí/công nợ thật.
  const CLASS_ID = "cmqqhcvoj00061ey49q5eqc20"; // CS1.SATA3.26.001 (ACTIVE)
  const COURSE_ID = "cmpqrne4n000461mh148jyxqm";
  const FINAL_PRICE = 2_400_000;
  for (const k of kids) {
    const st = await db.student.findUnique({ where: { studentCode: k.code }, select: { id: true } });
    if (!st) continue;
    const existing = await db.enrollment.findFirst({ where: { studentId: st.id, classId: CLASS_ID }, select: { id: true } });
    if (!existing) {
      await db.enrollment.create({
        // QA 21/07 (#C7) — Enrollment ∈ SCOPED_MODELS: PHẢI set centerId, thiếu →
        // GV (center-scope) không thấy roster (dialog đăng ảnh trống control).
        data: { studentId: st.id, classId: CLASS_ID, courseId: COURSE_ID, finalPrice: FINAL_PRICE, status: "STUDYING", centerId: CENTER_ID },
      });
    } else {
      // Bản ghi cũ seed trước đây thiếu centerId → vá lại cho idempotent.
      await db.enrollment.update({ where: { id: existing.id }, data: { centerId: CENTER_ID } });
    }
  }

  console.log("✅ Tài khoản phụ huynh test đã sẵn sàng:");
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Mật khẩu: ${PASSWORD}`);
  console.log(`   Con:      ${kids.map((k) => k.name).join(", ")} (CS1)`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌ Seed lỗi:", e);
    await db.$disconnect();
    process.exit(1);
  });
