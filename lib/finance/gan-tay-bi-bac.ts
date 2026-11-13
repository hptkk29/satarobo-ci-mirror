import "server-only";
// lib/finance/gan-tay-bi-bac.ts — VIỆC 6 · a1 (10/10/2026): BÁO TRƯỚC cho người gắn tay rằng giao dịch này kế toán ĐÃ BÁC cho đơn này.
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐÂY KHÔNG PHẢI CỔNG. Cổng nằm ở `ganTienTheoCon` (`lib/finance/ghi-tien-don.ts`, `NguoiGan`): đọc DƯỚI khoá đơn bằng `tx` của chính lượt gắn, từ chối TRƯỚC phép ghi
// đầu tiên, và không tin bất cứ thứ gì client/màn hình đã "biết" trước đó. Hàm dưới đây chỉ để màn hình KHÔNG HỨA SUÔNG (luật 12):
//
//   Sale bấm "Gắn vào đơn" trên giao dịch X ⇒ chọn đơn ⇒ bảng chia mở ra ⇒ gõ số tiền ⇒ Lưu ⇒ mới nghe "không gắn được". Bảng chia ấy là lời hứa mà máy chủ CHẮC CHẮN
//   từ chối khi (X, đơn) đã có dòng `TU_CHOI` — nên nói ngay ở bước chọn đơn (`taiChiTietDonDeGan`, đường `toast.error` có sẵn), trước khi người ta mất công điền số.
//
// Vì sao không giấu đơn khỏi danh sách tìm / giấu X khỏi bảng giao dịch: màn đi theo chiều giao dịch → đơn. Bảng giao dịch là danh sách TOÀN CỤC (giấu X khỏi nó là giấu
// X khỏi MỌI đơn — vỡ luật "đơn KHÁC vẫn thấy giao dịch đó"), còn danh sách đơn tìm theo từ khoá nên không biết X là giao dịch nào. Đơn biến mất khỏi kết quả tìm mà không
// một câu giải thích còn tệ hơn một câu nói thẳng.
//
// MỘT NGUỒN: "giao dịch nào kế toán đã bác cho đơn" chỉ do `docGiaoDichDaBiBac` (Việc 5) trả lời — hàm này không có truy vấn `TU_CHOI` riêng (lưới `[GTB-W5b]`).
// Đọc bằng `db` TRẦN (không `scopedDb`): đúng vết bác cần chặn có thể mang `centerId` lệch, tra qua `scopedDb` thì nó bị lọc mất và cổng đọc rỗng thành "chưa từng bị bác"
// (xem `docGiaoDichDaBiBac`). Ở đây thì lọc mất chỉ làm MẤT một câu báo trước — cổng thật vẫn chặn — nhưng không có lý do gì để chọn cách tệ hơn.
import { db } from "@/lib/db";
import { docGiaoDichDaBiBac } from "@/lib/payments/pos/sai-ma-doc";

/**
 * Giao dịch `bankTransactionId` đã có dòng `TU_CHOI` cho CHÍNH đơn `orderId` chưa? Chỉ để BÁO TRƯỚC — người gọi phải bỏ qua kết quả với người giữ `payments:manage`
 * (kế toán gắn lại được) và KHÔNG được coi `false` là "gắn được": cổng thật ở `ganTienTheoCon` vẫn tính lại dưới khoá.
 */
export async function giaoDichDaBiBacChoDon(orderId: string, bankTransactionId: string): Promise<boolean> {
  const bac = await docGiaoDichDaBiBac(db, orderId);
  return bac.giaoDich.has(bankTransactionId);
}
