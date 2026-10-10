/**
 * lib/lead/child-class-options.ts — G-01.
 *
 * Ô "Lớp tại trung tâm" của một con (`LeadChild.classId`) lưu **Class.id**. Đây
 * là chỗ DUY NHẤT dựng danh sách lựa chọn cho ô đó, vì cùng một danh sách phải
 * phục vụ HAI việc trái chiều nhau:
 *
 *  1. **Chọn lớp** — người dùng cần thấy lớp đang mở.
 *  2. **Đọc tên lớp** — giao diện tra `classes.find(c => c.id === child.classId)`
 *     để hiện nhãn. `classId` cố ý KHÔNG ràng khoá ngoại (cùng kiểu
 *     `interestedCourseId`/`interestedCenterId`), nên id nào không có trong danh
 *     sách là hiện "—".
 *
 * Vì việc (2), truy vấn CỐ Ý không lọc theo `status`. Lọc "chỉ lớp đang tuyển"
 * thì con đang học một lớp vừa kết thúc sẽ mất nhãn ngay hôm lớp đó đóng — dữ
 * liệu vẫn còn trong DB nhưng màn hình bảo là không có, và lượt sửa kế tiếp
 * (select không khớp option nào → tụt về "— Chưa xếp lớp —" → bấm Lưu) sẽ xoá
 * thật. Đúng cơ chế đã làm mất cơ sở quan tâm của lead trước 25/08 (V-4 · G-01b).
 *
 * Cách ly cơ sở KHÔNG nằm ở đây: `Class` ∈ `SCOPED_MODELS`, nên gọi qua
 * `scopedDb(actor).class` là đã lọc theo tầm nhìn của actor.
 */
import type { Prisma } from "@prisma/client";

export type LeadChildClassOption = { id: string; name: string };

/** Dòng lớp tối thiểu mà {@link leadChildClassOptions} cần. */
export type LeadChildClassRow = {
  id: string;
  name: string;
  classCode: string | null;
};

/**
 * Tham số `findMany` dùng chung — truyền thẳng vào `scopedDb(actor).class`.
 *
 * `take: 500` là trần an toàn, không phải phân trang: hai cơ sở của Sata Robo
 * cộng lại chưa tới ba chữ số lớp. Chạm trần thì việc cần làm là đổi ô này sang
 * kiểu tìm-kiếm, đừng nâng số lên.
 */
export const LEAD_CHILD_CLASS_FIND_ARGS = {
  where: { deletedAt: null },
  orderBy: [{ status: "asc" }, { name: "asc" }],
  select: { id: true, name: true, classCode: true },
  take: 500,
} satisfies Prisma.ClassFindManyArgs;

/** Dòng lớp → option cho ô "Lớp tại trung tâm" (value = Class.id). */
export function leadChildClassOptions(
  rows: readonly LeadChildClassRow[],
): LeadChildClassOption[] {
  return rows.map((c) => ({
    id: c.id,
    // Kèm mã lớp khi có: hai lớp trùng tên ở hai cơ sở là chuyện thường, và
    // người chọn không có cách nào khác để phân biệt.
    name: c.classCode ? `${c.name} · ${c.classCode}` : c.name,
  }));
}
