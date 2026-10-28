// lib/lead/ownership.ts — S-8: NGUỒN DUY NHẤT của khái niệm "khách của tôi".
//
// Khái niệm này từng có BA bản chép tay và cả ba đã trôi lệch nhau thật:
//
//   · `lib/lead/sale-leads.ts`             — 3 vế (được giao / mình nhập / dùng chung)
//   · `app/(admin)/admin/leads/page.tsx`   — 3 vế, gõ tay
//   · `app/(admin)/admin/search/page.tsx`  — **2 vế**, thiếu hẳn vế "mình nhập"
//
// Bản thiếu ở ô tìm là hậu quả trực tiếp của việc có nhiều bản: 23/08 vế
// `createdById` được thêm vào `/admin/leads`, 27/08 (S-4) thêm tiếp vào site
// Sale — không ai nhớ tới màn tìm kiếm. Người dùng thấy: Sale Hội sở nhập một
// phiếu, phiếu TỰ CHIA về Sale cơ sở (chốt 04/08 "lead không bao giờ về Hội
// sở"), rồi gõ đúng tên phụ huynh vào ô tìm toàn hệ thống thì **không ra gì** —
// trong khi cũng phiếu đó mở được từ danh sách. Không lỗi, không thông báo.
//
// Nên mệnh đề chỉ được viết ở ĐÂY. Test `lib/lead/ownership.test.ts` khoá điều
// đó bằng cách quét nguồn: `leadSharedOrClause()` là dấu vân tay của một mệnh đề
// gõ tay, hễ nó xuất hiện ngoài file này là có bản sao thứ hai vừa ra đời.
//
// ⚠️ Module THUẦN — KHÔNG `server-only`, KHÔNG `@/lib/db`, KHÔNG `scopedDb`.
// Cùng lý do đã tách `activity-clock.ts` khỏi `activity-write.ts`: nó phải dùng
// được từ trang quản trị, từ site Sale, từ lib đơn hàng và từ unit test — kéo
// Prisma vào là biến mọi test chạm nó thành test cần DB.
import type { Prisma } from "@prisma/client";
import { leadSharedOrClause } from "@/lib/lead/sharing";

/**
 * "Lead này có phải KHÁCH CỦA TÔI không" — bản dùng cho việc ĐỌC.
 *
 * Ba vế:
 *   1. `assignedToId` — phiếu được GIAO cho tôi. Sale cơ sở sống bằng vế này.
 *   2. `createdById`  — phiếu chính TÔI NHẬP. Sale Hội sở sống bằng vế này, vì
 *      phiếu họ nhập tự chia về cơ sở nên họ không bao giờ là assignee. Thiếu vế
 *      này thì mọi màn của họ trắng trơn — S-4 (site Sale) và S-8 (ô tìm).
 *   3. nhánh "dùng chung" — RỖNG theo mặc định (`leadSharedOrClause()`), chỉ quay
 *      lại khi ai đó bật env `LEAD_SHARING_ENABLED` (Q8 21/08 đã tắt chính sách).
 *
 * ⚠️ Nới ở đây KHÔNG nới cách ly cơ sở, và đó là chỗ dễ tưởng nhầm. Cả cụm này
 * đi vào `where` như MỘT vế, còn `scopedDb` bọc thêm `AND [ …, centerId IN
 * visibleCenterIds ]` ở ngoài ⇒ Sale CS1 nhập một phiếu rồi phiếu đó chuyển sang
 * CS2 thì họ vẫn KHÔNG đọc được. Test `[S-4] nới 'người nhập' KHÔNG được nới
 * cách ly cơ sở` (`lib/lead/sale-leads.test.ts`) khoá đúng hình dạng đó.
 */
export function leadOwnershipWhere(userId: string): Prisma.LeadWhereInput {
  return {
    OR: [{ assignedToId: userId }, { createdById: userId }, ...leadSharedOrClause()],
  };
}

/**
 * "Lead này có phải TRÁCH NHIỆM của tôi không" — HẸP hơn vế trên.
 *
 * Cố ý KHÔNG có `createdById`. Hai câu hỏi khác nhau và trộn vào nhau là sai:
 *   · "khách của tôi"      → tôi được XEM (nhập hộ cũng là của tôi);
 *   · "tôi phải chạm ai"   → tôi là người phải GỌI ĐIỆN.
 * Phiếu Sale Hội sở nhập được chia cho Sale cơ sở; người phải gọi là Sale cơ sở.
 * Đổ SLA của họ lên bảng việc Hội sở là đếm đôi `soKhachDangMo` trên hai màn và
 * bày ra việc mà người xem không bấm được.
 *
 * Đây cũng là mệnh đề quyết định AI ĐƯỢC TẮT ĐỒNG HỒ CHĂM SÓC của phiếu — xem
 * `actorMayResetLeadClock` (`lib/lead/sla-clock.ts`).
 */
export function leadPhuTrachWhere(userId: string): Prisma.LeadWhereInput {
  return { OR: [{ assignedToId: userId }, ...leadSharedOrClause()] };
}
