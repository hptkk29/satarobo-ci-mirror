/**
 * Seed giờ làm việc MẶC ĐỊNH TOÀN HỆ THỐNG — 7 dòng ("*", "*") của `WorkingHourRule`.
 *
 * Chủ dự án chốt 19/08/2026: nghỉ Thứ Hai, T3–CN mở 07:45–21:00.
 *
 * Vì sao phải seed dù `lib/working-hours/rules.ts` đã có `DEFAULT_WORKING_HOUR_WEEK`:
 * hằng số đó là LƯỚI CUỐI khi bảng trống, không phải nguồn cấu hình. Còn yêu cầu gốc là
 * "admin tự chỉnh trên web chứ không sửa code" — muốn sửa được thì trên màn hình phải có
 * dòng để sửa. Không seed thì mặc định toàn hệ thống nằm trong code, ngoài tầm với.
 *
 * Idempotent qua upsert theo `@@unique([orgUnitId, roleCode, weekday])`. CỐ Ý chỉ `create`
 * mà KHÔNG ghi đè giờ ở nhánh `update`: chạy lại seed trên môi trường đã có người chỉnh
 * giờ mà đè về 07:45–21:00 là âm thầm xoá cấu hình vận hành thật.
 *
 * Chạy: pnpm db:seed:working-hours (hoặc gọi từ prisma/seed.ts).
 */
import { PrismaClient } from "@prisma/client";

/** Sentinel "mọi đơn vị" / "mọi vai" — xem khối comment trên model trong schema.prisma. */
const WILDCARD = "*";

/** 0 = Chủ nhật … 6 = Thứ Bảy, khớp `Date.getDay()` và cột `weekday`. */
const CLOSED_WEEKDAY = 1; // Thứ Hai
const OPEN_TIME = "07:45";
const CLOSE_TIME = "21:00";

export async function seedWorkingHours(db: PrismaClient): Promise<void> {
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    const isClosed = weekday === CLOSED_WEEKDAY;
    await db.workingHourRule.upsert({
      where: {
        orgUnitId_roleCode_weekday: {
          orgUnitId: WILDCARD,
          roleCode: WILDCARD,
          weekday,
        },
      },
      // Đã có dòng ⇒ giữ nguyên giá trị đang chạy; chỉ ghi lại dấu vết ai/lúc nào.
      update: { updatedByName: "seed" },
      create: {
        orgUnitId: WILDCARD,
        roleCode: WILDCARD,
        weekday,
        isClosed,
        openTime: isClosed ? null : OPEN_TIME,
        closeTime: isClosed ? null : CLOSE_TIME,
        note: "Mặc định toàn hệ thống (seed 19/08/2026)",
        updatedByName: "seed",
      },
    });
  }
  console.log("✅ Seeded 7 WorkingHourRule mặc định toàn hệ thống (nghỉ T2, T3–CN 07:45–21:00)");
}

if (require.main === module) {
  const db = new PrismaClient();
  seedWorkingHours(db)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
