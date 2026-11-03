// =============================================================================
// lib/lead/intake/prefill.ts — đọc tham số `?phone=&name=` của trang nhập khách.
//
// VÌ SAO CÓ FILE NÀY (chốt 9.13/9.5, đợt tích hợp ZaloCRM):
// Từ khung chat, người tư vấn bấm "Tạo khách" và được đẩy sang
// `/nhap-khach-hang?phone=84905123456&name=Chị%20An`. Trước đợt này trang KHÔNG
// khai `searchParams` và `<QuickLeadForm>` không có prop điền sẵn, nên cú nhảy đó
// mở ra một biểu mẫu TRẮNG: hỏng câm, không lỗi, và người tư vấn phải gõ lại
// đúng con số họ vừa nhìn thấy trên màn chat.
//
// VÌ SAO LÀ HÀM THUẦN RIÊNG chứ không viết thẳng vào page:
// có HAI trang song sinh (`app/(admin)/admin/nhap-khach-hang` +
// `app/(sale)/sale/nhap-khach-hang`) dùng chung một biểu mẫu. Chép biểu thức đọc
// query sang cả hai là mở đường cho chúng trôi lệch — đúng kiểu hỏng đã gặp với
// hai màn nhận xét buổi học. Một hàm, hai chỗ gọi, một bộ test.
//
// ⚠️ FILE THUẦN — KHÔNG `import "server-only"`: test chạy được không cần DB, và
// nếu sau này có màn client tự dựng liên kết thì cũng dùng lại được.
// =============================================================================
import { canonicalPhone, formatPhoneVN } from "@/lib/phone";

/** Trần ký tự của ô "Tên phụ huynh" — khớp `optionalText(120)` trong
 *  `lib/validators/internal-lead.ts`. Đổi bên đó thì đổi luôn ở đây. */
const TRAN_TEN = 120;

/**
 * Hai ô DUY NHẤT được điền sẵn qua đường liên kết.
 *
 * Cố ý hẹp: query là đầu vào NGƯỜI NGOÀI đặt được (ai cũng gõ được vào thanh địa
 * chỉ). Mở thêm ô — nhất là `centerCode` (quyết định phiếu về cơ sở nào) hay
 * `note` — là để người khác lái dữ liệu phiếu qua một cái link. Cần thêm ô thì
 * thêm có chủ đích, kèm test, đừng trải phẳng cả `searchParams` vào form.
 */
export type PrefillNhapKhach = {
  parentName: string;
  phone: string;
};

/** Chỉ nhận chuỗi. Tham số lặp (`?name=a&name=b`) đến dưới dạng mảng — coi như
 *  KHÔNG có, vì không có cách nào đoán đúng người gửi muốn giá trị nào. */
function layChuoi(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

/**
 * Query → giá trị điền sẵn cho `<QuickLeadForm initial={…}>`.
 *
 * Luật của ô SĐT: **hợp lệ thì điền, không hợp lệ thì để TRỐNG** — không bao giờ
 * đổ nguyên chuỗi query vào ô. Đổ chuỗi rác vào thì người nhập bấm Lưu và ăn lỗi
 * validator ở tận server ("SĐT không hợp lệ") cho một giá trị họ chưa hề gõ.
 *
 * Điền dạng HIỂN THỊ `0XXXXXXXXX` (`formatPhoneVN`) chứ không phải canonical
 * `84XXXXXXXXX`: đây là ô cho người đọc và đối chiếu bằng mắt với màn chat, còn
 * việc chuẩn hoá lại về canonical là của `internalLeadSchema` lúc gửi.
 */
export function docPrefillTuQuery(
  sp: Record<string, string | string[] | undefined>,
): PrefillNhapKhach {
  const sdtTho = layChuoi(sp.phone);
  const chuan = canonicalPhone(sdtTho);

  return {
    // Khoá là `name` (không phải `parentName`) — đúng khuôn liên kết đã chốt ở
    // kế hoạch S1. Cắt về trần validator để giá trị điền sẵn luôn lưu được.
    parentName: layChuoi(sp.name).trim().slice(0, TRAN_TEN),
    phone: chuan ? formatPhoneVN(chuan) : "",
  };
}
