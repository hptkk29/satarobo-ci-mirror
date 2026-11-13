import "server-only";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client } from "@/lib/storage/r2-client";
import { getHoaDonBucket, TRAN_CO_TEP, vanTayHoaDon } from "./kho-tep";

// lib/finance/hoa-don/phan-phoi-tep.ts — ĐỌC THÂN PDF hoá đơn từ kho để PHỤC VỤ TRỰC TIẾP (Invoice Hub S10).
//
// Vì sao đọc thân thay vì redirect tới URL ký sẵn như route của kế toán: URL ký của R2 mang NGUYÊN KHOÁ tệp trong đường dẫn
// (`.../hoa-don/<mã cơ sở>/<năm>/<orderId>/<uuid>.pdf?...`). Route phân phối cho Sale / phụ huynh không được để khoá kho lọt
// ra trình duyệt, lịch sử hay log của phía thứ ba — nên máy chủ đọc rồi trả byte. PDF bị chặn trần 10 MB lúc tải lên
// (`TRAN_CO_TEP.pdf`) nên nạp vào bộ nhớ là chấp nhận được.
//
// Người gọi PHẢI đã qua cổng sở hữu + trạng thái + cờ và đã ghi audit TRƯỚC khi gọi hàm này.
// Lỗi kho / tệp hỏng / quá cỡ ⇒ `null` (người gọi trả 503/404); không ném, không log khoá.

export async function docPdfHoaDon(khoa: string): Promise<Uint8Array | null> {
  try {
    const r = await getR2Client().send(new GetObjectCommand({ Bucket: getHoaDonBucket(), Key: khoa }));
    const than = (await r.Body?.transformToByteArray()) ?? new Uint8Array();
    if (than.length === 0 || than.length > TRAN_CO_TEP.pdf) return null;
    // Tin BYTE, không tin nhãn: tệp trong kho không còn là PDF (bị ghi đè) thì không phát cho khách.
    if (!vanTayHoaDon("pdf", than)) return null;
    return than;
  } catch {
    return null;
  }
}
