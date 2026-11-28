// FIX 10 PHẦN 0 — tạo TeacherProfile mặc định cho mọi User CÓ vai trò TEACHER chưa có.
// Idempotent. Chạy: pnpm exec dotenv -e .env -- tsx prisma/seed-teacher-profiles.ts
import { db } from "../lib/db";
async function main() {
  const teachers = await db.user.findMany({
    // Đa vai trò (3B): gồm cả người có TEACHER ở vị trí phụ.
    where: { roles: { has: "TEACHER" }, deletedAt: null, teacherProfile: { is: null } },
    select: { id: true, name: true, email: true },
  });
  for (const t of teachers) {
    await db.teacherProfile.create({ data: { userId: t.id } });
    console.log(`  ✓ profile cho ${t.name ?? t.email}`);
  }
  console.log(`\nTạo ${teachers.length} TeacherProfile mặc định.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
