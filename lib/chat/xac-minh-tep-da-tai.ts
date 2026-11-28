import { docByteDauChat, headChatObject } from "@/lib/storage/chat-storage";

import { sniffImageMime } from "./attachments";

/**
 * SEC-06 (V8.45) — XÁC MINH ẢNH CHAT SAU KHI TẢI LÊN, dùng cho CẢ web lẫn app (một lõi gửi tin: `lib/chat/messages.ts`).
 *
 * Lỗ cũ: vé tải lên chỉ nhìn `headBase64` (≤ 256 ký tự) do CLIENT gửi; sau khi PUT, lúc gửi tin lõi chỉ kiểm tiền tố khoá + MIME khai. Người dùng khai magic bytes JPEG rồi
 * PUT tệp bất kỳ (HTML / SVG / PE) vào khoá `.jpg` ⇒ nhân viên / phụ huynh khác mở qua URL ký ⇒ phát tán nội dung độc. Đường app (`kiemTepTruocKhiGui`) đã kiểm đối tượng thật,
 * đường web thì KHÔNG — nay lõi chung kiểm cho cả hai.
 *
 * Kiểm CHÍNH đối tượng trong kho chat RIÊNG (không tin lời khai): (1) có thật; (2) đúng cỡ đã khai; (3) `Content-Type` của đối tượng khớp MIME khai;
 * (4) byte ĐẦU thật đúng định dạng ảnh của MIME khai (`sniffImageMime` — JPEG / PNG / WEBP, cùng bộ nhận dạng đã dùng lúc xin vé).
 * Lỗi hạ tầng (kho không đọc được) ⇒ TỪ CHỐI với mã riêng (fail-closed) — không bao giờ coi «không kiểm được» là «hợp lệ».
 * Chỉ ĐỌC (HEAD + Range 32 byte); không ghi, không xoá (đối tượng sai nằm lại — dọn là việc của cron dọn tệp mồ côi, SEC-07).
 */
export type TepDaTaiLen = { storagePath: string; mimeType: string; sizeBytes: number };
export type LoiXacMinhTep = {
  code: "ATTACHMENT_NOT_UPLOADED" | "ATTACHMENT_SIZE_MISMATCH" | "ATTACHMENT_TYPE_MISMATCH" | "ATTACHMENT_CONTENT_INVALID" | "ATTACHMENT_STORAGE_UNAVAILABLE";
  message: string;
};

const BYTE_DAU = 32;
const chuanMime = (m: string) => (m ?? "").split(";")[0]!.trim().toLowerCase();
const KHO_LOI: LoiXacMinhTep = { code: "ATTACHMENT_STORAGE_UNAVAILABLE", message: "Kho ảnh chat chưa sẵn sàng — thử lại sau." };

export async function xacMinhTepChatDaTaiLen(tep: readonly TepDaTaiLen[]): Promise<LoiXacMinhTep | null> {
  for (const t of tep) {
    const khai = chuanMime(t.mimeType);
    let dau: Awaited<ReturnType<typeof headChatObject>>;
    try {
      dau = await headChatObject(t.storagePath);
    } catch {
      return KHO_LOI;
    }
    if (!dau) return { code: "ATTACHMENT_NOT_UPLOADED", message: "Ảnh chưa được tải lên xong." };
    if (dau.size !== t.sizeBytes) return { code: "ATTACHMENT_SIZE_MISMATCH", message: "Kích thước ảnh không khớp lúc tải lên." };
    if (chuanMime(dau.contentType ?? "") !== khai) return { code: "ATTACHMENT_TYPE_MISMATCH", message: "Loại ảnh không khớp lúc tải lên." };
    let byte: Uint8Array | null;
    try {
      byte = await docByteDauChat(t.storagePath, BYTE_DAU);
    } catch {
      return KHO_LOI;
    }
    if (!byte || sniffImageMime(byte) !== khai) return { code: "ATTACHMENT_CONTENT_INVALID", message: "Nội dung tệp không đúng định dạng ảnh đã khai." };
  }
  return null;
}
