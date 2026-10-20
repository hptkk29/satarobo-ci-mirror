import "server-only";
import { db } from "@/lib/db";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import { locDonNhanTien } from "@/lib/payments/don-nhan-tien";
import type { DongDonChoGhiDanh } from "@/lib/finance/gia-tu-dong-don";

/**
 * ĐỌC DÒNG ĐƠN CỦA MỘT LEAD — đầu vào cho `listPriceChoGhiDanh` [HTL-09 · 23/09/2026].
 *
 * Tách khỏi `gia-tu-dong-don.ts` để tệp luật kia ở THUẦN (test không cần database). Ở đây
 * chỉ có phép đọc; mọi quyết định nằm bên kia.
 *
 * ⚠️ **Lọc bằng `locDonNhanTien()`, không tự viết danh sách trạng thái.** Đơn `DRAFT` /
 * `CANCELLED` / `REFUNDED` không phải giá gia đình đang nợ — lấy giá từ một đơn đã huỷ là
 * ghi vào ghi danh một con số không còn ai nợ ai. Repo có đúng một chỗ định nghĩa "đơn nào
 * còn nhận tiền"; chép lại là đẻ bản thứ hai, và hai bản sẽ lệch (bài học
 * `lib/payments/don-nhan-tien.ts`).
 *
 * ⚠️ `metadata` đọc bằng `docHinhThucLop` + `docConLeadTuMetadata` — hai hàm CÓ SẴN, fail
 * closed với dữ liệu cũ. Tự bóc `metadata.courseId` bằng tay ở đây là bản thứ ba của cùng
 * một phép đọc, trên một cột `Json?` có bốn đường ghi mà chỉ một đường qua zod.
 */
export async function dongDonCuaLead(leadId: string): Promise<DongDonChoGhiDanh[]> {
  const items = await db.orderItem.findMany({
    where: {
      order: { leadId, ...locDonNhanTien() },
      type: "COURSE_ENROLLMENT",
    },
    select: { totalPrice: true, metadata: true },
  });

  return items.map((it) => {
    // MỘT lần đọc `metadata` cho cả `courseId` lẫn `soBuoi` — hai lời gọi `docHinhThucLop`
    // trên cùng một giá trị là hai cơ hội để một bên bị sửa mà bên kia không.
    const ht = docHinhThucLop(it.metadata);
    return {
      leadChildId: docConLeadTuMetadata(it.metadata),
      courseId: ht.courseId,
      totalPrice: it.totalPrice,
      soBuoi: ht.soBuoi,
    };
  });
}
