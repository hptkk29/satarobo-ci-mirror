// components/chat/attachments/rules.ts — TẦNG THUẦN của luồng gửi ảnh (US-11).
//
// KHÔNG React, KHÔNG mạng, KHÔNG DOM (trừ `btoa` có sẵn ở cả browser lẫn jsdom/node18+):
// phần dễ sai nhất của US-11 phía client — đếm ảnh, chặn quá cỡ, chặn định dạng ngoài gói
// cắt, đọc magic bytes gửi cho server sniff — nằm ở đây để test bằng vitest thuần.
//
// ⚠️ MỌI LUẬT DƯỚI ĐÂY LÀ PHÉP LỊCH SỰ, KHÔNG PHẢI CỬA CHẶN. Cửa chặn thật là
// `assertChatUploadFiles` (server, có sniff magic bytes) + `checkAttachmentPaths`
// (server, khi ghi tin). Client chặn sớm chỉ để người dùng không phải chờ upload xong
// mới biết ảnh sai.
//
// ⚠️ VÌ SAO KHAI LẠI HẰNG SỐ THAY VÌ IMPORT `CHAT_IMAGE_RULES`: `lib/chat/attachments.ts`
// mở đầu bằng `import "server-only"` và kéo theo `@aws-sdk/client-s3` — chạm vào nó từ
// Client Component là hỏng build. Đổi số ở một nơi thì đổi cả hai (giống tiền lệ
// `DELETED_MESSAGE_TEXT` ở `components/chat/chat-store.ts`).

/** Gói cắt US-11 — khớp `CHAT_IMAGE_RULES.allowedMimes`. */
export const CHAT_IMAGE_ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Khớp `CHAT_IMAGE_RULES.maxFilesPerMessage`. */
export const CHAT_IMAGE_MAX_FILES = 5;
/** Khớp `CHAT_IMAGE_RULES.maxSizeBytes` (10MB/ảnh). */
export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Khớp `CHAT_IMAGE_RULES.headBytes` — số byte đầu file gửi kèm để SERVER sniff. */
export const CHAT_IMAGE_HEAD_BYTES = 16;
/** Gợi ý cho hộp thoại chọn file (người dùng vẫn đổi được sang "All files" — nên có kiểm). */
export const CHAT_IMAGE_ACCEPT = CHAT_IMAGE_ALLOWED_MIMES.join(",");

/** Thông điệp DUY NHẤT cho ca sai định dạng — khớp chuỗi server dùng (US-11 AC5). */
export const CHAT_IMAGE_UNSUPPORTED_MSG =
  "Định dạng chưa hỗ trợ — chỉ nhận ảnh JPG, PNG hoặc WEBP (tối đa 10MB).";

/** Một ảnh để HIỂN THỊ trong luồng. */
export type ChatAttachmentView = {
  /** `MessageAttachment.id` (server) — dùng để xin signed GET URL ở bước 3 của F-FILE. */
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * Object URL cục bộ của chính file vừa chọn. Có nó thì KHÔNG xin signed URL —
   * người gửi thấy ảnh của mình ngay lập tức, không tốn một vòng ký URL.
   */
  localUrl?: string;
};

/** Ảnh đã upload xong, sẵn sàng đính vào tin (khuôn `attachments[]` của `sendChatMessage`). */
export type ChatAttachmentPayload = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type PickResult = {
  /** Những file qua được vòng kiểm sơ bộ, đã cắt theo trần 5 ảnh/tin. */
  accepted: File[];
  /** Thông điệp tiếng Việt cho file bị loại — `null` khi không loại gì. */
  error: string | null;
};

function mimeOf(file: File): string {
  return (file.type ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * Lọc file người dùng vừa chọn.
 *
 * Thứ tự có chủ đích: định dạng → cỡ → trần số lượng. Người chọn nhầm file PDF cần biết
 * "sai định dạng", chứ không phải "đủ 5 ảnh rồi" chỉ vì file đó đứng thứ sáu.
 * `existingCount` = số ảnh ĐANG chờ gửi, để trần 5 tính trên cả tin chứ không chỉ lượt chọn.
 */
export function pickChatImages(existingCount: number, files: readonly File[]): PickResult {
  const accepted: File[] = [];
  let error: string | null = null;

  for (const file of files) {
    if (!(CHAT_IMAGE_ALLOWED_MIMES as readonly string[]).includes(mimeOf(file))) {
      error ??= CHAT_IMAGE_UNSUPPORTED_MSG;
      continue;
    }
    if (file.size <= 0 || file.size > CHAT_IMAGE_MAX_BYTES) {
      error ??= `Ảnh "${file.name}" vượt quá ${Math.round(CHAT_IMAGE_MAX_BYTES / 1024 / 1024)}MB — hãy chọn ảnh nhỏ hơn.`;
      continue;
    }
    if (existingCount + accepted.length >= CHAT_IMAGE_MAX_FILES) {
      error ??= `Mỗi tin nhắn tối đa ${CHAT_IMAGE_MAX_FILES} ảnh.`;
      continue;
    }
    accepted.push(file);
  }

  return { accepted, error };
}

/** Bytes → base64 (dùng cho `headBase64`, chỉ vài chục byte nên không cần chunk). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** "1,4 MB" / "820 KB" — chỉ để hiện dưới thumbnail, không tham gia quyết định nào. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
