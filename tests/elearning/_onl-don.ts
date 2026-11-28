/**
 * Dọn bảng `Onl*` cho bộ test DB của E-learning Online — KHÔNG dùng đặc quyền bỏ qua trigger.
 *
 * Sổ sự kiện quyền học là BẤT BIẾN (trigger chặn UPDATE/DELETE theo hàng). `TRUNCATE` không kích hoạt trigger hàng nên là cách dọn
 * hợp lệ trên DB thử; còn `session_replication_role = replica` tắt cả khoá ngoại + trigger và (trên kết nối pool) có thể rò sang
 * truy vấn sau — nên bị cấm ở đây.
 *
 * Cổng: chỉ chạy khi TÊN database là DB dùng-để-test (`ci_test*`/`satarobo_test*`/`satarobo_vitest*`) và KHÔNG phải DB UAT.
 * `vitest.db.config.ts` đặt `fileParallelism: false` nên không có tệp nào khác đang đọc cùng lúc.
 */
import type { PrismaClient } from "@prisma/client";

const TEN_DB_DUOC_DON = /^(ci_test|satarobo_test|satarobo_vitest)/;
const TEN_DB_KHONG_DON = /(_uat|_local|_dev)$/;

/** Thứ tự không quan trọng (CASCADE), liệt kê đủ để một câu lệnh dọn sạch cả cụm. */
export const BANG_ONL: string[] = [
  "OnlAttemptCompensation",
  "OnlAttemptInterruption",
  "OnlAttemptDraftOp",
  "OnlAttemptDraft",
  "OnlSubmission",
  "OnlCertificateTemplate",
  "OnlRubric",
  "OnlCertificate",
  "OnlAttempt",
  "OnlAssessmentQuestion",
  "OnlAssessment",
  "OnlQuestion",
  "OnlEntitlementEvent",
  "OnlLessonProgress",
  "OnlEntitlement",
  "OnlLesson",
  "OnlChapter",
  "OnlCourseVersion",
  "OnlCourse",
  "OnlCategory",
];

export async function donBangOnl(db: PrismaClient, them: readonly string[] = []): Promise<void> {
  const [{ ten }] = await db.$queryRaw<{ ten: string }[]>`select current_database() as ten`;
  if (!TEN_DB_DUOC_DON.test(ten) || TEN_DB_KHONG_DON.test(ten)) {
    throw new Error(`Từ chối dọn bảng Onl* trên database "${ten}" — chỉ DB thử (ci_test*/satarobo_test*/satarobo_vitest*), không phải UAT/local/dev.`);
  }
  const ds = [...BANG_ONL, ...them].map((b) => `"${b}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${ds} RESTART IDENTITY CASCADE`);
}
