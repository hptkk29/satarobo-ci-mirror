/**
 * Seed thông tin liên hệ cho hồ sơ gia đình test (Portal v2 — trang Hồ sơ giống SataUI).
 *   pnpm tsx prisma/seed-test-profile.ts
 * Idempotent. KHÔNG cho prod.
 */
import { db } from "../lib/db";

async function main() {
  const parent = await db.user.findFirst({
    where: { email: "phuhuynh.test@satarobo.vn" },
    select: { id: true },
  });
  if (!parent) throw new Error("Chưa có phụ huynh test — chạy seed-test-parent trước.");

  await db.user.update({
    where: { id: parent.id },
    data: { address: "123 Nguyễn Hữu Thọ, Hải Châu, Đà Nẵng" },
  });

  // SĐT PH đại diện (denormalized trên các con); PH thứ hai để trống (Chưa cập nhật).
  await db.student.updateMany({
    where: { parentUserId: parent.id, deletedAt: null },
    data: { parentPhone: "0987 654 321" },
  });

  // Khối lớp từng con (để hiện "Lớp N").
  await db.student.updateMany({ where: { studentCode: "CS1-TEST-001" }, data: { currentGrade: 4 } });
  await db.student.updateMany({ where: { studentCode: "CS1-TEST-002" }, data: { currentGrade: 3 } });

  console.log("✅ Seed hồ sơ liên hệ: địa chỉ PH + SĐT + khối lớp các con.");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌", e);
    await db.$disconnect();
    process.exit(1);
  });
