import type { ScopedDb } from "@/lib/actions/factory";
import { dsMucSchema } from "@/lib/elearning/rubric-shape";
import type { TieuChiTrongKhung } from "../_components/rubric-builder";

/**
 * Nạp MỘT khung + tiêu chí để dựng — dùng chung cho trang chi tiết riêng (`/khung-cham/[rubricId]`) và khung bên phải của màn master-detail
 * (`/khung-cham?id=`). Đọc QUA `scopedDb` (chính lượt đọc là cổng cách ly).
 *
 * ⚠️ `levelsJson` đọc QUA Zod, không ép kiểu: tiêu chí không đọc được ⇒ danh sách mức RỖNG (cổng kích hoạt sẽ gọi tên nó ra), không làm vỡ trang.
 */
export async function napKhungDeDung(db: ScopedDb, rubricId: string) {
  const khung = await db.trnRubric.findFirst({
    where: { id: rubricId, deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      totalPoints: true,
      passPoints: true,
      criteria: { select: { id: true, label: true, description: true, levelsJson: true, orderIndex: true }, orderBy: { orderIndex: "asc" } },
    },
  });
  if (!khung) return null;
  const cacTieuChi: TieuChiTrongKhung[] = khung.criteria.map((c) => {
    const r = dsMucSchema.safeParse(c.levelsJson);
    return { criterionId: c.id, label: c.label, description: c.description, levels: r.success ? r.data : [] };
  });
  return { khung, cacTieuChi };
}
