import "server-only";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import {
  getChatBucket,
  isChatBucketConfigured,
  signChatGetUrl,
  signChatPutUrl,
} from "@/lib/storage/chat-storage";

// =============================================================================
// lib/chat/attachments.ts — US-11: đính kèm ảnh trong hội thoại (F-FILE, TS-14).
//
// Storage = **Cloudflare R2** (quyết định Q2, docs/chat-realtime/00-dieu-chinh
// -cho-repo.md) — KHÔNG dùng Supabase Storage. Đi qua `lib/storage/chat-storage`
// (bucket RIÊNG `R2_CHAT_BUCKET_NAME`, không custom domain), bổ sung kiểm
// **magic bytes** (mẫu: lib/exams/docx-import.ts:89).
//
// ⛔ KHÔNG dùng `getR2Bucket()` / `getR2PublicUrl()` / `signedMediaUrl()`: chúng
// trỏ vào bucket `R2_BUCKET_NAME` đang phát công khai qua `R2_PUBLIC_URL`
// (cdn.satarobo.vn) ⇒ signed URL trở nên vô nghĩa (ghép key sang tên miền CDN là
// tải được vĩnh viễn, kể cả sau khi tin bị gỡ). Lý do đầy đủ: lib/storage/chat-storage.ts.
//
// 3 bước của F-FILE:
//   1. Client xin signed PUT URL  → `createChatUploadTicket`  (guard quyền + file)
//   2. Client PUT thẳng lên R2    → ngoài phạm vi file này
//   3. Client xin signed GET URL  → `getChatAttachmentReadUrl` (hạn 5 phút)
//
// Bất biến phải giữ:
//   • Bucket/key PRIVATE — không bao giờ trả public URL của ảnh chat.
//   • Read URL sống ĐÚNG 5 phút (AC2) — dán sang tab ẩn danh sau 5' phải 403.
//   • Ảnh của tin đã gỡ → mọi signed URL cấp SAU đó bị từ chối (AC5 US-12, F-DEL).
//   • Key KHÔNG nhúng tên file người dùng (path traversal / lộ thông tin);
//     tên gốc chỉ nằm ở cột `MessageAttachment.fileName`.
//   • Đuôi file trong key lấy từ mime ĐÃ SNIFF, không lấy từ tên người dùng.
// =============================================================================

/** Gói cắt US-11: chỉ 3 định dạng. heic/pdf bị từ chối có chủ đích (AC5). */
export const CHAT_IMAGE_RULES = {
  allowedMimes: ["image/jpeg", "image/png", "image/webp"],
  /** 10MB/ảnh (AC1). */
  maxSizeBytes: 10 * 1024 * 1024,
  /** 5 ảnh/tin (AC1). */
  maxFilesPerMessage: 5,
  /** Số byte đầu file client phải gửi kèm để server tự sniff (WEBP cần 12). */
  headBytes: 16,
  /** TTL signed PUT — ngắn, chỉ đủ cho lượt upload đang diễn ra. */
  uploadUrlTtlSeconds: 300,
  /** TTL signed GET — ĐÚNG 5 phút theo AC2. */
  readUrlTtlSeconds: 300,
} as const;

export type ChatImageMime = "image/jpeg" | "image/png" | "image/webp";

const EXT_BY_MIME: Record<ChatImageMime, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** Thông điệp DUY NHẤT cho mọi ca sai định dạng (AC5 chốt đúng chuỗi này). */
const UNSUPPORTED_MSG =
  "Định dạng chưa hỗ trợ — chỉ nhận ảnh JPG, PNG hoặc WEBP (tối đa 10MB).";

// ─── Lỗi ────────────────────────────────────────────────────────────────────

export type ChatAttachmentErrorCode =
  | "CONVERSATION_NOT_FOUND"
  | "NOT_PARTICIPANT"
  | "CONVERSATION_ARCHIVED"
  | "CONVERSATION_LOCKED"
  | "NO_FILES"
  | "INVALID_FILE"
  | "TOO_MANY_FILES"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "ATTACHMENT_NOT_FOUND"
  | "MESSAGE_DELETED"
  | "STORAGE_NOT_CONFIGURED";

/** Mã lỗi EN → HTTP status (API contract CLAUDE.md); mã lỗi F-FILE: 403/415/413. */
const STATUS_BY_CODE: Record<ChatAttachmentErrorCode, number> = {
  CONVERSATION_NOT_FOUND: 404,
  NOT_PARTICIPANT: 403,
  CONVERSATION_ARCHIVED: 403,
  CONVERSATION_LOCKED: 403,
  NO_FILES: 400,
  INVALID_FILE: 400,
  TOO_MANY_FILES: 413,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  ATTACHMENT_NOT_FOUND: 404,
  MESSAGE_DELETED: 403,
  STORAGE_NOT_CONFIGURED: 503,
};

export class ChatAttachmentError extends Error {
  readonly status: number;
  constructor(
    /** Mã lỗi EN, message VI (quy ước API contract). */
    readonly code: ChatAttachmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChatAttachmentError";
    this.status = STATUS_BY_CODE[code];
  }
}

// ─── PHẦN THUẦN (không DB, không mạng — unit test được) ─────────────────────

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF" tại offset 0
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50]; // "WEBP" tại offset 8

function matchesAt(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

/**
 * Đọc **magic bytes** thật để xác định định dạng ảnh — chốt chặn AC1
 * "đổi đuôi file không lách được". THUẦN, không throw.
 *
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   WEBP  "RIFF" ....（4 byte size）"WEBP"
 *
 * Mọi thứ khác (exe, heic, pdf, gif, svg, file rỗng/quá ngắn) → `null`.
 */
export function sniffImageMime(bytes: Uint8Array): ChatImageMime | null {
  if (!bytes || bytes.length === 0) return null;
  if (matchesAt(bytes, JPEG_MAGIC)) return "image/jpeg";
  if (matchesAt(bytes, PNG_MAGIC)) return "image/png";
  if (matchesAt(bytes, RIFF_MAGIC) && matchesAt(bytes, WEBP_TAG, 8)) return "image/webp";
  return null;
}

export type ChatUploadFileInput = {
  /** Tên gốc người dùng thấy — chỉ để lưu `MessageAttachment.fileName`. */
  fileName: string;
  /** Mime client KHAI (không tin) — phải khớp kết quả sniff. */
  mimeType: string;
  sizeBytes: number;
  /** base64 của `CHAT_IMAGE_RULES.headBytes` byte ĐẦU file (client đọc bằng FileReader). */
  headBase64: string;
};

/** Decode phần đầu base64 → bytes. Rác/rỗng → mảng rỗng (không throw). */
function decodeHead(headBase64: string): Uint8Array {
  if (typeof headBase64 !== "string" || headBase64.length === 0) return new Uint8Array();
  // Chặn trần: chỉ cần vài chục byte đầu — không cho client đẩy cả file dạng base64.
  const buf = Buffer.from(headBase64.slice(0, 256), "base64");
  return new Uint8Array(buf);
}

/** Bỏ tham số charset/boundary + hạ chữ thường: `Image/JPEG; x=1` → `image/jpeg`. */
function normalizeMime(mime: string): string {
  return (mime ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * Kiểm bộ file trước khi ký URL (THUẦN). Trả mime ĐÃ SNIFF theo đúng thứ tự
 * input để caller dựng key + ContentType từ sự thật, không từ lời khai.
 *
 * Thứ tự có chủ đích: số lượng → (từng file) cỡ → magic bytes → mime khai khớp.
 * Cỡ đứng trước định dạng để không phải decode gì cho file đã quá cỡ.
 */
export function assertChatUploadFiles(
  files: readonly ChatUploadFileInput[],
): ChatImageMime[] {
  if (!files || files.length === 0) {
    throw new ChatAttachmentError("NO_FILES", "Chưa chọn ảnh nào.");
  }
  if (files.length > CHAT_IMAGE_RULES.maxFilesPerMessage) {
    throw new ChatAttachmentError(
      "TOO_MANY_FILES",
      `Mỗi tin nhắn tối đa ${CHAT_IMAGE_RULES.maxFilesPerMessage} ảnh (bạn chọn ${files.length}).`,
    );
  }

  const maxMb = Math.round(CHAT_IMAGE_RULES.maxSizeBytes / 1024 / 1024);
  return files.map((f) => {
    if (!Number.isInteger(f?.sizeBytes) || f.sizeBytes <= 0) {
      throw new ChatAttachmentError("INVALID_FILE", "Kích thước ảnh không hợp lệ.");
    }
    if (f.sizeBytes > CHAT_IMAGE_RULES.maxSizeBytes) {
      throw new ChatAttachmentError(
        "FILE_TOO_LARGE",
        `Ảnh vượt quá ${maxMb}MB — hãy chọn ảnh nhỏ hơn.`,
      );
    }
    // Mime KHAI phải nằm trong gói cắt (heic/pdf rụng ngay ở đây).
    const declared = normalizeMime(f.mimeType);
    if (!(CHAT_IMAGE_RULES.allowedMimes as readonly string[]).includes(declared)) {
      throw new ChatAttachmentError("UNSUPPORTED_MEDIA_TYPE", UNSUPPORTED_MSG);
    }
    // Không tin đuôi file, không tin mime client khai: đọc magic bytes thật.
    const sniffed = sniffImageMime(decodeHead(f.headBase64));
    if (!sniffed) {
      throw new ChatAttachmentError("UNSUPPORTED_MEDIA_TYPE", UNSUPPORTED_MSG);
    }
    if (declared !== sniffed) {
      // Lời khai lệch ruột file (vd .exe đổi tên .jpg khai image/jpeg).
      throw new ChatAttachmentError("UNSUPPORTED_MEDIA_TYPE", UNSUPPORTED_MSG);
    }
    return sniffed;
  });
}

/**
 * Tên hiển thị an toàn để lưu DB: bỏ đường dẫn (`../`, `C:\…`), bỏ ký tự điều
 * khiển, cắt 120 ký tự. KHÔNG dùng cho key R2 (key chỉ có uuid).
 */
export function sanitizeChatFileName(fileName: string, mime: ChatImageMime): string {
  const lastSegment = (fileName ?? "").split(/[\\/]/).pop()!;
  // Bỏ ký tự điều khiển bằng charCode (không dùng regex control-char — ESLint
  // no-control-regex) → chống cả log-injection khi in tên file ra console/audit.
  const base = Array.from(lastSegment)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c > 0x1f && c !== 0x7f;
    })
    .join("")
    .trim()
    .slice(0, 120);
  return base.length > 0 ? base : `anh${EXT_BY_MIME[mime]}`;
}

/** id an toàn để ghép vào key R2 (uuid của Conversation) — chống path traversal. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Key R2: `chat-attachments/{conversationId}/{yyyy-MM}/{uuid}{ext}`.
 * Mốc tháng lấy theo **UTC** (như các route upload sẵn có) — chỉ là prefix gom
 * file, không phải dữ liệu nghiệp vụ nên không cần giờ VN.
 */
export function buildChatAttachmentKey(params: {
  conversationId: string;
  mime: ChatImageMime;
  /** uuid v4 sinh sẵn (tham số hoá để test xác định được). */
  objectId?: string;
  now?: Date;
}): string {
  const { conversationId, mime } = params;
  if (!SAFE_ID.test(conversationId)) {
    throw new ChatAttachmentError("CONVERSATION_NOT_FOUND", "Hội thoại không hợp lệ.");
  }
  const objectId = params.objectId ?? uuidv4();
  if (!SAFE_ID.test(objectId)) {
    throw new ChatAttachmentError("INVALID_FILE", "Định danh tệp không hợp lệ.");
  }
  const month = (params.now ?? new Date()).toISOString().slice(0, 7); // yyyy-MM
  return `chat-attachments/${conversationId}/${month}/${objectId}${EXT_BY_MIME[mime]}`;
}

/**
 * Env đã đủ để ký URL ảnh chat chưa — script nghiệm thu dùng để SKIP bước cần ký.
 *
 * CỐ Ý **không** xét `R2_PUBLIC_URL` và **không** xét `R2_BUCKET_NAME`: luồng chat
 * không bao giờ dùng public URL, và thiếu `R2_CHAT_BUCKET_NAME` thì phải trả 503
 * chứ KHÔNG được rơi về bucket công khai.
 */
export function isChatStorageConfigured(): boolean {
  return isChatBucketConfigured();
}

// ─── PHẦN CHẠM DB + R2 ──────────────────────────────────────────────────────

// ⚠️ ĐỌC KHÔNG QUA scopedDb — CÓ CHỦ ĐÍCH (luật E-bis #5, 00-dieu-chinh mục E-bis):
// quyền chat là **participant-based**, không center-based. Tư cách thành viên là sự
// thật MỨC HỆ THỐNG: PH ở cơ sở khác, GV dạy chéo cơ sở, hội thoại DM có
// `centerId = null` — đọc qua `scopedDb(actor)` thì các trường hợp đó biến mất khỏi
// kết quả ⇒ người có quyền thật bị trả 403 oan (đúng dạng bug đã cháy ở
// `loadDerivedMembership`). `Conversation` ∈ SCOPE_EXEMPT còn
// `ConversationParticipant` / `Message` / `MessageAttachment` không nằm trong
// SCOPED_MODELS, nên `db` trần là đúng và an toàn; cách ly cơ sở KHÔNG phải là cửa
// chặn ở đây — cửa chặn là participant guard bên dưới.

/** Participant còn hiệu lực (`leftAt IS NULL`) — throw NOT_PARTICIPANT nếu không. */
async function assertActiveParticipant(conversationId: string, userId: string): Promise<void> {
  const p = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { leftAt: true },
  });
  if (!p || p.leftAt !== null) {
    throw new ChatAttachmentError(
      "NOT_PARTICIPANT",
      "Bạn không phải thành viên của hội thoại này.",
    );
  }
}

export type ChatUploadTicket = {
  /** Tên gốc đã làm sạch — ghi vào `MessageAttachment.fileName`. */
  fileName: string;
  mimeType: ChatImageMime;
  sizeBytes: number;
  /** Key R2 — ghi vào `MessageAttachment.storagePath`. */
  storagePath: string;
  /** Signed PUT URL (TTL ngắn). */
  uploadUrl: string;
  expiresIn: number;
};

/**
 * Bước 1 của F-FILE: cấp signed PUT URL sau khi kiểm quyền + file.
 *
 * Trả về ticket theo ĐÚNG thứ tự `files` đầu vào. Ticket chưa tạo record DB nào —
 * `MessageAttachment` do luồng gửi tin (US-06) ghi sau khi client upload xong.
 */
export async function createChatUploadTicket(input: {
  conversationId: string;
  userId: string;
  files: readonly ChatUploadFileInput[];
}): Promise<{ tickets: ChatUploadTicket[]; expiresAt: Date }> {
  const { conversationId, userId, files } = input;

  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, status: true },
  });
  if (!conv) {
    throw new ChatAttachmentError("CONVERSATION_NOT_FOUND", "Hội thoại không tồn tại.");
  }

  // Quyền TRƯỚC hợp lệ file: người ngoài không được biết "file của tôi sai gì".
  await assertActiveParticipant(conversationId, userId);

  if (conv.status === "ARCHIVED") {
    throw new ChatAttachmentError(
      "CONVERSATION_ARCHIVED",
      "Hội thoại đã lưu trữ — không gửi được tin mới.",
    );
  }
  if (conv.status === "LOCKED") {
    throw new ChatAttachmentError(
      "CONVERSATION_LOCKED",
      "Hội thoại đang bị khoá — không gửi được tin mới.",
    );
  }

  const mimes = assertChatUploadFiles(files);

  const now = new Date();
  const ttl = CHAT_IMAGE_RULES.uploadUrlTtlSeconds;
  // Chốt cấu hình TRƯỚC khi ký: thiếu bucket chat (hoặc bucket chat bị trỏ vào
  // bucket công khai) → 503 cấu hình hạ tầng, KHÔNG phải lỗi người dùng, và
  // tuyệt đối không có nhánh nào rơi về `R2_BUCKET_NAME`.
  try {
    getChatBucket();
  } catch {
    throw new ChatAttachmentError(
      "STORAGE_NOT_CONFIGURED",
      "Kho ảnh chưa được cấu hình — báo quản trị viên.",
    );
  }

  let tickets: ChatUploadTicket[];
  try {
    tickets = await Promise.all(
      files.map(async (f, i) => {
        const mime = mimes[i]!;
        const storagePath = buildChatAttachmentKey({ conversationId, mime, now });
        const uploadUrl = await signChatPutUrl(storagePath, mime, ttl);
        return {
          fileName: sanitizeChatFileName(f.fileName, mime),
          mimeType: mime,
          sizeBytes: f.sizeBytes,
          storagePath,
          uploadUrl,
          expiresIn: ttl,
        } satisfies ChatUploadTicket;
      }),
    );
  } catch (e) {
    if (e instanceof ChatAttachmentError) throw e;
    // Credential R2 thiếu/hỏng ⇒ vẫn là lỗi cấu hình, không phải lỗi người dùng.
    throw new ChatAttachmentError(
      "STORAGE_NOT_CONFIGURED",
      "Kho ảnh chưa được cấu hình — báo quản trị viên.",
    );
  }

  return { tickets, expiresAt: new Date(now.getTime() + ttl * 1000) };
}

export type ChatAttachmentReadUrl = {
  url: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  expiresIn: number;
  expiresAt: Date;
};

/**
 * Bước 3 của F-FILE: cấp signed GET URL hạn **5 phút** cho 1 ảnh.
 *
 * Guard (TS-14.2 / TS-14.4):
 *   • Người xin phải là participant còn hiệu lực của hội thoại CHỨA ảnh → 403.
 *   • Tin chứa ảnh đã bị gỡ (`Message.deletedAt`) → 403 `MESSAGE_DELETED` (F-DEL:
 *     mọi signed URL cấp SAU thời điểm gỡ đều bị từ chối; URL đã cấp trước đó vẫn
 *     sống tối đa 5 phút — rủi ro đã chấp nhận, chính là lý do TTL ngắn).
 * KHÔNG chặn theo `Conversation.status`: ARCHIVED/LOCKED vẫn ĐỌC được
 * (permissions.md "Trạng thái đè lên tất cả"), chỉ cấm GỬI.
 */
export async function getChatAttachmentReadUrl(
  attachmentId: string,
  userId: string,
): Promise<ChatAttachmentReadUrl> {
  const att = await db.messageAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      storagePath: true,
      fileName: true,
      mimeType: true,
      // `Message` KHÔNG thuộc SOFT_DELETE_MODELS (lib/soft-delete.ts) nên quan hệ
      // này vẫn trả về tin đã gỡ — cần thế để phân biệt 404 với MESSAGE_DELETED.
      message: { select: { conversationId: true, deletedAt: true } },
    },
  });
  if (!att) {
    throw new ChatAttachmentError("ATTACHMENT_NOT_FOUND", "Không tìm thấy ảnh.");
  }

  await assertActiveParticipant(att.message.conversationId, userId);

  if (att.message.deletedAt !== null) {
    throw new ChatAttachmentError("MESSAGE_DELETED", "Tin nhắn chứa ảnh này đã bị gỡ.");
  }

  const ttl = CHAT_IMAGE_RULES.readUrlTtlSeconds;
  let url: string;
  try {
    // Bucket chat (private, không custom domain) — KHÔNG dùng signedMediaUrl:
    // hàm đó ký vào bucket công khai nên URL 5 phút sẽ vô nghĩa.
    url = await signChatGetUrl(att.storagePath, ttl);
  } catch {
    throw new ChatAttachmentError(
      "STORAGE_NOT_CONFIGURED",
      "Kho ảnh chưa được cấu hình — báo quản trị viên.",
    );
  }

  return {
    url,
    storagePath: att.storagePath,
    fileName: att.fileName,
    mimeType: att.mimeType,
    expiresIn: ttl,
    expiresAt: new Date(Date.now() + ttl * 1000),
  };
}
