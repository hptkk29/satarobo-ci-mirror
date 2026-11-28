import { z } from "zod";

import { ChatAttachmentError, createChatUploadTicket, getChatAttachmentReadUrl } from "@/lib/chat/attachments";
import { isActiveChatParticipant } from "@/lib/chat/queries";

import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";
import { canhCong } from "./chat";

/**
 * V8.18 — ĐÍNH KÈM ẢNH TRONG CHAT: lớp MỎNG bọc domain web `lib/chat/attachments` (vé tải lên + URL đọc). KHÔNG có luật/kho thứ hai.
 *   1. `POST /chat/conversations/:id/attachments/tickets` — app xin vé (≤ 5 ảnh jpg/png/webp, ≤ 10 MB; MIME khai bị đối chiếu với 16 byte đầu THẬT do app gửi — không tin MIME/đuôi tự khai);
 *      máy chủ trả URL PUT KÝ ngắn hạn vào bucket chat RIÊNG (không bao giờ URL công khai) + `duongDanKho` (khoá do SERVER dựng, không nhúng tên tệp của người dùng).
 *   2. App PUT thẳng lên kho → gửi tin `POST …/messages { tepDinhKem:[{duongDanKho,…}] }` — máy chủ KIỂM LẠI: khoá thuộc đúng hội thoại, chưa dùng, đối tượng CÓ THẬT với đúng cỡ + loại (xem `chat.ts`).
 *   3. `GET /chat/attachments/:id/url` — đổi id lấy URL ĐỌC ký 5 phút: chỉ thành viên đang có quyền; tin đã gỡ ⇒ không cấp; mọi lỗi quyền ⇒ cùng 404.
 * Kho chat chưa cấu hình (R2_CHAT_BUCKET_NAME/credential) ⇒ 503 `MEDIA_CHUA_SAN_SANG` — KHÔNG bao giờ rơi về bucket công khai (BLOCKED_INFRA ngoài môi trường local). Chế độ học sinh KHÔNG dùng chat (allow-list + canhCong).
 * GIỚI HẠN THẬT: URL đã ký trước đó còn sống tới hết TTL (5 phút) kể cả khi tin bị gỡ ngay sau đó — không có thu hồi tức thời với URL đã ký; quét mã độc chưa có.
 */
const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

export const xinVeTepChatSchema = z.strictObject({
  tep: z
    .array(z.strictObject({ tenTep: z.string().min(1).max(255), loaiMime: z.string().min(1).max(100), kichThuoc: z.number().int().positive(), dauTepBase64: z.string().min(1).max(256) }))
    .min(1, "Chưa chọn ảnh nào.")
    .max(5, "Mỗi tin tối đa 5 ảnh."),
});
export type XinVeTepChat = z.infer<typeof xinVeTepChatSchema>;
export type VeTepChatDto = { tenTep: string; loaiMime: string; kichThuoc: number; duongDanKho: string; uploadUrl: string; phuongThuc: "PUT"; hetHanSauGiay: number };

function dich(e: unknown): never {
  if (e instanceof LoiApiMobile) throw e;
  if (e instanceof ChatAttachmentError) {
    switch (e.code) {
      case "NOT_PARTICIPANT":
      case "CONVERSATION_NOT_FOUND":
      case "ATTACHMENT_NOT_FOUND":
      case "MESSAGE_DELETED": // không lộ «tin đã gỡ» cho người xin URL
        throw khongThay();
      case "CONVERSATION_ARCHIVED":
      case "CONVERSATION_LOCKED":
        throw new LoiApiMobile("CHAT_KHONG_GUI_DUOC", 409, e.message);
      case "STORAGE_NOT_CONFIGURED":
        throw new LoiApiMobile("MEDIA_CHUA_SAN_SANG", 503, "Kho ảnh chat chưa sẵn sàng.", 60);
      case "FILE_TOO_LARGE":
      case "TOO_MANY_FILES":
        throw new LoiApiMobile("TEP_KHONG_HOP_LE", 413, e.message);
      case "UNSUPPORTED_MEDIA_TYPE":
        throw new LoiApiMobile("TEP_KHONG_HOP_LE", 415, e.message);
      default:
        throw new LoiApiMobile("TEP_KHONG_HOP_LE", 400, e.message);
    }
  }
  throw e;
}

export async function xinVeTepChat(nguoi: NguoiGoi, hoiThoaiId: string, body: XinVeTepChat): Promise<{ ve: VeTepChatDto[]; hetHanLuc: string }> {
  await canhCong(nguoi);
  if (!/^[0-9a-f-]{36}$/i.test(hoiThoaiId)) throw khongThay();
  // Không phải thành viên ĐANG CÓ QUYỀN ⇒ 404 TRƯỚC khi nói gì về hợp lệ của tệp.
  if (!(await isActiveChatParticipant(hoiThoaiId, nguoi.userId))) throw khongThay();
  try {
    const r = await createChatUploadTicket({ conversationId: hoiThoaiId, userId: nguoi.userId, files: body.tep.map((t) => ({ fileName: t.tenTep, mimeType: t.loaiMime, sizeBytes: t.kichThuoc, headBase64: t.dauTepBase64 })) });
    return {
      ve: r.tickets.map((t) => ({ tenTep: t.fileName, loaiMime: t.mimeType, kichThuoc: t.sizeBytes, duongDanKho: t.storagePath, uploadUrl: t.uploadUrl, phuongThuc: "PUT" as const, hetHanSauGiay: t.expiresIn })),
      hetHanLuc: r.expiresAt.toISOString(),
    };
  } catch (e) {
    return dich(e);
  }
}

export type UrlTepChatDto = { url: string; tenTep: string; loaiMime: string; hetHanSauGiay: number; hetHanLuc: string };

export async function layUrlTepChat(nguoi: NguoiGoi, tepId: string): Promise<UrlTepChatDto> {
  await canhCong(nguoi);
  const id = tepId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw khongThay();
  try {
    const r = await getChatAttachmentReadUrl(id, nguoi.userId);
    return { url: r.url, tenTep: r.fileName, loaiMime: r.mimeType, hetHanSauGiay: r.expiresIn, hetHanLuc: r.expiresAt.toISOString() };
  } catch (e) {
    return dich(e);
  }
}
