// lib/export/leads-where.ts — mệnh đề `where` của xuất danh sách lead (THUẦN, test được không cần DB/phiên).
//
// S-1 (search-oracle): chỉ cho TÌM theo SĐT khi người xuất thấy được SĐT thật — cùng luật `canSearchPhone` của trang danh sách (`app/(admin)/admin/leads/page.tsx`).
// Reviewer độc lập 20/10/2026 (LOW): route xuất lọc theo SĐT VÔ ĐIỀU KIỆN (chỉ che ở đầu ra), nên vai được giao «Quyền xuất dữ liệu» nhưng KHÔNG có `leads:view-pii` gõ `?q=<số>` ⇒ file trả về có dòng khớp
// ⇒ xác nhận «số này có là lead» và nối số → hồ sơ — đúng thứ S-1 cấm. `canSearchPhone` BẮT BUỘC khai (luật 7): quên truyền là `tsc` đỏ, không phải tìm-theo-SĐT lặng lẽ mở.
import type { LeadStatus } from "@prisma/client";

export function buildLeadExportWhere(p: {
  statusFilter: LeadStatus | undefined;
  /** Từ khoá người dùng gõ (đã trim) hoặc rỗng/undefined. */
  q: string | undefined;
  /** `phoneSearchTerm(q) ?? q` — phần lõi SĐT (lưu 2 dạng `0…`/`84…`). */
  qPhone: string | undefined;
  canSearchPhone: boolean;
}) {
  const { statusFilter, q, qPhone, canSearchPhone } = p;
  return {
    deletedAt: null as null,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(q
      ? {
          OR: [
            { parentName: { contains: q, mode: "insensitive" as const } },
            ...(canSearchPhone && qPhone ? [{ phone: { contains: qPhone } }] : []),
            { childName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}
