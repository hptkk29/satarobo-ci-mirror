import "server-only";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import type { Actor } from "@/lib/auth/actor";

export type IntakeCenterOption = { code: string; name: string };

/**
 * Danh sách cơ sở cho ô "Cơ sở phụ huynh chọn" của biểu mẫu nhập khách.
 *
 * Tách khỏi trang để **site Sale sau này dùng lại nguyên vẹn** — chép tay đoạn
 * lọc này sang chỗ thứ hai là mở đường cho hai biểu mẫu lệch nhau, đúng kiểu
 * hỏng đã gặp với hai màn nhận xét buổi học.
 *
 * ⚠️ Chủ dự án chốt 04/08: **lead KHÔNG BAO GIỜ về Hội sở** — chỉ cơ sở dạy học
 * mới nhận lead. Dùng đúng `getNonEnrollableCenterIds()` mà `autoAssignNewLead`
 * dùng để chia lead, để hai đường không lệch nhau. Mở CS3 = thêm data, KHÔNG
 * sửa code.
 *
 * Đi qua `scopedDb(actor)` nên người cấp cơ sở chỉ thấy cơ sở của mình.
 */
export async function loadIntakeCenterOptions(
  actor: Actor,
): Promise<IntakeCenterOption[]> {
  const sdb = scopedDb(actor);
  const [centers, nonEnrollable] = await Promise.all([
    sdb.center.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    getNonEnrollableCenterIds(),
  ]);

  return centers
    .filter((c) => c.code && !nonEnrollable.includes(c.id))
    .map((c) => ({ code: c.code as string, name: c.name }));
}

export type IntakeCourseOption = { id: string; name: string };

/**
 * Khoá học cho ô "Khoá quan tâm" của biểu mẫu nhập khách (03/09/2026).
 *
 * Đặt cạnh `loadIntakeCenterOptions` vì cùng một lý do: biểu mẫu này dùng ở CẢ
 * `admin.satarobo.vn/nhap-khach-hang` LẪN site Sale. Chép câu truy vấn sang chỗ
 * thứ hai là mở đường cho hai biểu mẫu lệch nhau — đúng kiểu hỏng đã gặp với
 * hai màn nhận xét buổi học.
 *
 * `isTeachable` là điều kiện quan trọng: `Course` còn đựng cả khoá không dạy
 * trực tiếp (gói combo, khoá online trỏ Sataworld). Bày chúng ra đây thì người
 * nhập chọn được một "khoá quan tâm" mà tới lúc chốt không có lớp nào — và ô
 * "Lớp đăng ký" ở màn Chuyển đổi sẽ rỗng, đúng ca dễ bị đọc thành hệ thống hỏng.
 *
 * `Course` KHÔNG thuộc `SCOPED_MODELS` (danh mục dùng chung toàn hệ) nên không
 * cần `scopedDb` — mọi cơ sở dạy cùng một bộ khoá.
 */
export async function loadIntakeCourseOptions(): Promise<IntakeCourseOption[]> {
  const rows = await db.course.findMany({
    where: { isActive: true, isTeachable: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows;
}
