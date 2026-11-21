// lib/lead/tim-lead-db.ts — chạy câu tìm lead (xem `tim-lead.ts` cho luật). Trả DANH SÁCH ID lead khớp; nơi gọi đặt `{ id: { in: ids } }` vào `where` của CHÍNH truy vấn `scopedDb`.
//
// Vì sao trả id thay vì tự đọc lead: câu tìm chạy bằng SQL thô nên KHÔNG đi qua `scopedDb` (cách ly cơ sở) — nếu nó trả cả hàng thì vai cơ sở này đọc được lead cơ sở khác. Trả ID rồi để truy vấn
// có cách ly lọc lại thì tập kết quả luôn là GIAO của «khớp từ khoá» và «người xem được phép thấy»; id lạ ngoài tầm nhìn tự rơi mất. Id này không bao giờ xuống trình duyệt.
//
// `deletedAt IS NULL` đặt ở đây (lead đã xoá không bao giờ là kết quả). `db` trần được phép ở `lib/` (cổng ESLint chỉ chặn trong `app/(admin|portal|teacher)`).
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { GIOI_HAN_ID_TIM, dieuKienTimLead } from "@/lib/lead/tim-lead";

export type TimLeadKetQua = {
  /** Id lead khớp (tối đa `GIOI_HAN_ID_TIM`). `[]` = không có ai khớp. */
  ids: string[];
  /** Chạm trần ⇒ còn lead khớp nhưng không được liệt kê — nơi gọi nên nói thật thay vì im lặng. */
  daCat: boolean;
};

/**
 * `null` khi chuỗi tìm rỗng (không lọc gì). `duocTimSdtEmail` BẮT BUỘC khai (luật 7 — quên là `tsc` đỏ): `false` ⇒ nhánh SĐT/email biến mất khỏi câu, đúng luật S-1.
 */
export async function timIdLead(p: { q: string | undefined; duocTimSdtEmail: boolean }): Promise<TimLeadKetQua | null> {
  const q = p.q?.trim();
  if (!q) return null;
  const dieuKien = dieuKienTimLead(q, p.duocTimSdtEmail);
  if (!dieuKien) return null;
  const rows = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT l."id" FROM "Lead" l WHERE l."deletedAt" IS NULL AND (${dieuKien}) LIMIT ${GIOI_HAN_ID_TIM + 1}`,
  );
  const daCat = rows.length > GIOI_HAN_ID_TIM;
  return { ids: rows.slice(0, GIOI_HAN_ID_TIM).map((r) => r.id), daCat };
}
