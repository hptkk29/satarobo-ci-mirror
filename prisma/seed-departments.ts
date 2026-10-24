/**
 * Seed DepartmentDef (Track Department — R6 flexibility-hardening).
 * Idempotent qua upsert theo `code`. Code khớp enum Department cũ để backfill/dual-write.
 *
 * Chạy: pnpm db:seed:departments  (hoặc gọi từ prisma/seed.ts).
 */
import { PrismaClient } from "@prisma/client";

const DEPARTMENTS = [
  { code: "BAN_GIAM_DOC", name: "Ban Giám đốc", displayOrder: 0, isTeaching: false },
  { code: "DAO_TAO", name: "Phòng Đào tạo", displayOrder: 1, isTeaching: true },
  { code: "MARKETING", name: "Phòng Marketing", displayOrder: 2, isTeaching: false },
  { code: "KINH_DOANH", name: "Phòng Kinh doanh / Sale", displayOrder: 3, isTeaching: false },
  { code: "IT", name: "Phòng IT / Công nghệ", displayOrder: 4, isTeaching: false },
  { code: "HANH_CHANH_NHAN_SU", name: "Hành chính - Nhân sự", displayOrder: 5, isTeaching: false },
  { code: "KE_TOAN", name: "Phòng Kế toán", displayOrder: 6, isTeaching: false },
  { code: "TUYEN_SINH", name: "Phòng Tuyển sinh", displayOrder: 7, isTeaching: false },
  { code: "GIAO_VU", name: "Giáo vụ", displayOrder: 8, isTeaching: false },
  { code: "GIANG_DAY", name: "Giảng dạy", displayOrder: 9, isTeaching: true },
];

export async function seedDepartments(db: PrismaClient): Promise<void> {
  for (const d of DEPARTMENTS) {
    await db.departmentDef.upsert({
      where: { code: d.code },
      update: { name: d.name, displayOrder: d.displayOrder, isTeaching: d.isTeaching },
      create: d,
    });
  }
  console.log(`✅ Seeded ${DEPARTMENTS.length} DepartmentDef`);
}

if (require.main === module) {
  const db = new PrismaClient();
  seedDepartments(db)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
