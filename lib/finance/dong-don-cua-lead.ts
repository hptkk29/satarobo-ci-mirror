import "server-only";
import { db } from "@/lib/db";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import { docPhamViDong, tienThucDongPhamVi } from "@/lib/orders/pham-vi/doc-dong";
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
    select: { totalPrice: true, discountAmount: true, unitPrice: true, quantity: true, metadata: true },
  });

  return items.map((it) => {
    // MỘT lần đọc `metadata` cho cả `courseId` lẫn `soBuoi` — hai lời gọi `docHinhThucLop`
    // trên cùng một giá trị là hai cơ hội để một bên bị sửa mà bên kia không.
    const ht = docHinhThucLop(it.metadata);
    // Dòng SCOPE mang khoản giảm Sale thêm [20/10/2026]: giá ghi danh = số khách THỰC trả (giá chính sách − khoản thêm), để khoản thêm được trừ
    // ĐÚNG MỘT LẦN. `computeEnrollmentPrice` chỉ nhận thêm giảm giá/học bổng khai lúc convert (một khoản KHÁC); nếu để `totalPrice` (giá chính
    // sách) thì Enrollment.finalPrice cao hơn tổng đơn đúng bằng khoản thêm và công nợ hiển thị lệch. Dòng thường: `totalPrice` như cũ, không đổi.
    const pv = docPhamViDong(it.metadata);
    const tienThuc = pv ? tienThucDongPhamVi(pv, it) : null;
    return {
      leadChildId: docConLeadTuMetadata(it.metadata),
      courseId: ht.courseId,
      totalPrice: tienThuc ? tienThuc.thanhTienThuc : it.totalPrice,
      soBuoi: ht.soBuoi,
      // GATE D: dòng mang dấu SCOPE (cờ do người gọi hỏi theo cơ sở). Đọc từ CHÍNH hàm đọc dấu — không dựng phép kiểm thứ hai.
      coPhamVi: pv !== null,
    };
  });
}
