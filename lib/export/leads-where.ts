// lib/export/leads-where.ts — mệnh đề `where` của xuất danh sách lead (THUẦN, test được không cần DB/phiên).
//
// 13/11/2026 — Ô TÌM KHÔNG CÒN NẰM Ở ĐÂY. Trước đó bộ dựng này tự ghép `OR [parentName, phone, childName]` (so đúng dấu, chỉ tên con đầu tiên) — bản chép thứ N của một ô tìm đã sai. Nay ô tìm là MỘT nơi dùng chung
// (`lib/lead/tim-lead.ts`): route tính `idKhopTimKiem` bằng `timIdLead({ q, duocTimSdtEmail })` rồi truyền vào đây; bộ dựng chỉ đặt `id IN (…)`.
//
// S-1 (search-oracle, reviewer 20/10/2026) VẪN NGUYÊN: chỉ cho TÌM theo SĐT/email khi người xuất thấy được SĐT thật. Cổng đó nay nằm ở `dieuKienTimLead(q, duocTimSdtEmail)` — thiếu quyền thì nhánh SĐT/email BIẾN MẤT
// khỏi câu SQL (khoá ở `[S-1c-*]`). `idKhopTimKiem` BẮT BUỘC khai (luật 7): quên truyền là `tsc` đỏ, không phải ô tìm lặng lẽ bị bỏ qua.
import type { LeadStatus } from "@prisma/client";

export function buildLeadExportWhere(p: {
  statusFilter: LeadStatus | undefined;
  /** Id lead khớp từ khoá (từ `timIdLead`); `null` = không có từ khoá ⇒ không lọc. `[]` = có từ khoá mà không ai khớp ⇒ tệp rỗng (đúng). */
  idKhopTimKiem: readonly string[] | null;
}) {
  const { statusFilter, idKhopTimKiem } = p;
  return {
    deletedAt: null as null,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(idKhopTimKiem ? { id: { in: [...idKhopTimKiem] } } : {}),
  };
}
