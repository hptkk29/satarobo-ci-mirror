// lib/portal/goi-giao-vien-db.ts — đọc giới tính giáo viên (Employee.gender) theo TÊN hiển thị để gọi «thầy/cô + tên» (xem goi-giao-vien.ts).
//
// Vì sao theo tên: các loader của cổng (lịch, nhận xét) chỉ trả `teacher.name`. Hai tài khoản trùng tên mà khác giới tính ⇒ coi như CHƯA BIẾT
// (rơi về đoán theo tên đệm / «thầy/cô»), không chọn bừa một người.
import "server-only";
import { db } from "@/lib/db";
import type { GioiTinhGv } from "@/lib/portal/goi-giao-vien";

export async function docGioiTinhGvTheoTen(ten: (string | null | undefined)[]): Promise<Map<string, GioiTinhGv>> {
  const ds = [...new Set(ten.map((t) => t?.trim()).filter((t): t is string => !!t))];
  const kq = new Map<string, GioiTinhGv>();
  if (ds.length === 0) return kq;
  const rows = await db.user.findMany({
    where: { name: { in: ds } },
    select: { name: true, employee: { select: { gender: true } } },
  });
  for (const r of rows) {
    // Tài khoản không có hồ sơ nhân sự (phụ huynh trùng tên…) không phải giáo viên — bỏ qua, đừng để nó làm «mâu thuẫn».
    if (!r.name || !r.employee) continue;
    const g = r.employee.gender ?? null;
    if (!kq.has(r.name)) kq.set(r.name, g);
    else if (kq.get(r.name) !== g) kq.set(r.name, null);
  }
  return kq;
}
