import "server-only";
import { khoaIdCuaCacDong, type KhoaCoSoBuoi } from "./ten-dong-hoc-phi";

// Nạp tên + số buổi các khoá mà dòng đơn nhắc tới (`metadata.courseId`) — MỘT câu cho cả lần thu. Đọc thuần, không ghi.
// `Course` là danh mục dùng chung (không thuộc `SCOPED_MODELS`), nên `scopedDb` hay `db` đều cho cùng kết quả.

type DocKhoa = {
  course: {
    findMany(args: { where: { id: { in: string[] } }; select: { id: true; name: true } }): Promise<{ id: string; name: string }[]>;
  };
};

export async function napKhoaTheoDong(
  sdb: DocKhoa,
  dong: readonly { type: string; metadata?: unknown }[],
): Promise<Map<string, KhoaCoSoBuoi>> {
  const ids = khoaIdCuaCacDong(dong);
  if (ids.length === 0) return new Map();
  const ds = await sdb.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(ds.map((c) => [c.id, { name: c.name }]));
}
