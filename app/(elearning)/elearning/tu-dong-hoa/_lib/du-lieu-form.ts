import type { ScopedDb } from "@/lib/actions/factory";

/**
 * Dữ liệu cho form Khai luật / Soạn lộ trình — đọc qua `scopedDb` nên chỉ thấy khoá/phòng ban trong tầm nhìn cơ sở của người xem
 * (khoá dùng chung `centerId = null` vẫn hiện, đúng NULL_IS_GLOBAL).
 */
export async function napDuLieuForm(db: ScopedDb) {
  const [khoa, loTrinh, phongBan] = await Promise.all([
    db.trnCourse.findMany({ where: { deletedAt: null, status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" }, take: 300 }),
    db.trnLearningPath.findMany({ where: { deletedAt: null }, select: { id: true, title: true, _count: { select: { steps: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.departmentDef.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { displayOrder: "asc" }, take: 100 }),
  ]);
  return {
    khoa: khoa as { id: string; title: string }[],
    loTrinh: (loTrinh as { id: string; title: string; _count: { steps: number } }[]).map((t) => ({ id: t.id, title: t.title, soBuoc: t._count.steps })),
    phongBan: phongBan as { id: string; name: string }[],
  };
}
