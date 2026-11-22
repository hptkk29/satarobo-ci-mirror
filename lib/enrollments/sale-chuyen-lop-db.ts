// lib/enrollments/sale-chuyen-lop-db.ts — ĐỌC "học viên này có do Sale X phụ trách không". DB thật.
//
// ĐỊNH NGHĨA DUY NHẤT dùng lại `hocVienCuaSale` (lib/hoc-bu/danh-sach-db.ts: Enrollment.saleId, rơi về Sale của phiếu lead) —
// KHÔNG chế định nghĩa thứ bảy (đo 21/10/2026: đã có 6 định nghĩa "học viên của Sale" lệch nhau).
import "server-only";
import { db } from "@/lib/db";
import { hocVienCuaSale } from "@/lib/hoc-bu/danh-sach-db";

/** Tập `studentId` (trong số `studentIds`) do `saleId` phụ trách. Rỗng ⇒ không truy vấn. */
export async function docHocVienCuaSale(saleId: string, studentIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(studentIds)];
  if (ids.length === 0) return new Set();
  const rows = await db.student.findMany({
    where: { id: { in: ids }, deletedAt: null, ...hocVienCuaSale(saleId) },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
