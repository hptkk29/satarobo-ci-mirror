import "server-only";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { khoLocal, khoLocalDangBat } from "@/lib/mobile-api/kho-tep-rieng";
import { getR2Client } from "@/lib/storage/r2-client";

// =============================================================================
// lib/storage/chat-storage.ts — kho ảnh RIÊNG cho chat (US-11 F-FILE).
//
// VÌ SAO TỒN TẠI FILE NÀY (đừng gộp lại vào `r2-client`/`signed-url`):
// bucket `R2_BUCKET_NAME` đang gắn tên miền phân phối công cộng
// `R2_PUBLIC_URL` (= https://cdn.satarobo.vn — Document/04_infrastructure.md).
// Mọi object trong bucket đó tải được **vô danh** qua `https://cdn…/<key>`.
// Ký một signed GET URL trỏ vào bucket đó là **vô nghĩa**: URL ký chứa nguyên
// `key`, người nhận chỉ việc ghép sang tên miền CDN là có bản vĩnh viễn, không
// chữ ký, không hạn 5 phút, và **vẫn tải được sau khi tin bị gỡ**.
// Ảnh chat là ảnh trẻ em trong nhóm lớp ⇒ 3 bảo đảm đã ký
// (docs/chat-realtime/flows.md:51-52,63 · 00-dieu-chinh-cho-repo.md mục Q2)
// chỉ đứng vững khi ảnh nằm ở bucket **không có custom domain**.
//
// Vì vậy: cùng credential R2 (`getR2Client()`), **khác bucket**.
//   ✅ getChatBucket() / signChatPutUrl() / signChatGetUrl()
//   ❌ getR2Bucket() / getR2PublicUrl() / getPublicUrl() / signedMediaUrl()
//      — luồng chat KHÔNG BAO GIỜ được chạm 4 hàm này (unit test chốt bằng
//      assert "không được gọi").
//
// Fail CLOSED: thiếu `R2_CHAT_BUCKET_NAME` → throw → tầng trên trả 503
// STORAGE_NOT_CONFIGURED. TUYỆT ĐỐI KHÔNG fallback về `R2_BUCKET_NAME` — im
// lặng rơi về bucket công khai chính là lỗ hổng đang vá.
// =============================================================================

/** Lỗi cấu hình kho ảnh chat — caller quy đổi thành 503, KHÔNG phải lỗi người dùng. */
export class ChatStorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatStorageConfigError";
  }
}

/**
 * Bucket R2 dành riêng cho ảnh chat. Đọc thẳng `process.env` (KHÔNG qua
 * `getR2Bucket()`) để không có đường nào rơi về bucket công khai.
 *
 * Throw khi:
 *   • `R2_CHAT_BUCKET_NAME` trống → chưa cấu hình (fail closed).
 *   • Trùng `R2_BUCKET_NAME` → chính là bucket đang có `R2_PUBLIC_URL`; nhận
 *     giá trị này = tự mở lại lỗ hổng, nên chặn ngay tại cấu hình.
 */
export function getChatBucket(): string {
  // V8.19: kho cục bộ (thử nghiệm) — không có bucket R2; trả tên giữ chỗ để các cổng «đã cấu hình chưa» của `lib/chat/attachments` không chặn. KHÔNG dùng để gọi R2.
  if (chatKhoCucBoDangBat()) return "kho-cuc-bo-thu-nghiem";
  const bucket = (process.env.R2_CHAT_BUCKET_NAME ?? "").trim();
  if (!bucket) {
    throw new ChatStorageConfigError(
      "R2_CHAT_BUCKET_NAME chưa đặt — ảnh chat cần bucket R2 RIÊNG (không gắn " +
        "custom domain). Không được dùng tạm R2_BUCKET_NAME: bucket đó phát công " +
        "khai qua R2_PUBLIC_URL.",
    );
  }
  const publicBucket = (process.env.R2_BUCKET_NAME ?? "").trim();
  if (publicBucket && bucket === publicBucket) {
    throw new ChatStorageConfigError(
      "R2_CHAT_BUCKET_NAME đang trỏ đúng vào bucket công khai (R2_BUCKET_NAME) — " +
        "ảnh chat sẽ tải được vô danh qua R2_PUBLIC_URL. Hãy tạo bucket riêng.",
    );
  }
  return bucket;
}

/**
 * V8.19 — KHO CỤC BỘ CHO THỬ NGHIỆM (HTTP/UAT không có R2): CHỈ khi NODE_ENV ≠ production VÀ `MOBILE_UPLOAD_LOCAL_DIR` đặt VÀ `R2_CHAT_BUCKET_NAME` KHÔNG đặt.
 * Đặt bucket chat thật ⇒ luôn dùng R2. Production ⇒ không bao giờ (cùng cổng với kho tệp di động). KHÔNG phải bằng chứng R2 — báo cáo phải nói «kho cục bộ».
 */
export function chatKhoCucBoDangBat(): boolean {
  return process.env.NODE_ENV !== "production" && !(process.env.R2_CHAT_BUCKET_NAME ?? "").trim() && khoLocalDangBat();
}

/** Env đã đủ để ký URL cho ảnh chat chưa (bucket riêng + credential R2). */
export function isChatBucketConfigured(): boolean {
  if (chatKhoCucBoDangBat()) return true;
  try {
    getChatBucket();
  } catch {
    return false;
  }
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

/**
 * Signed PUT URL để client upload thẳng lên bucket chat.
 * CHỈ ký `Content-Type` — browser PUT không gửi header khác, header đã-ký-nhưng
 * -không-gửi làm R2 trả 403 SignatureDoesNotMatch (ghi chú A1 ở
 * app/api/admin/upload-url/route.ts).
 */
export async function signChatPutUrl(
  key: string,
  contentType: string,
  ttlSeconds: number,
): Promise<string> {
  if (chatKhoCucBoDangBat()) return (await khoLocal.kyPut(key, contentType, ttlSeconds)).url;
  const command = new PutObjectCommand({
    Bucket: getChatBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getR2Client(), command, { expiresIn: ttlSeconds });
}

/**
 * Signed GET URL để xem ảnh chat. Bucket không có custom domain ⇒ hết hạn là
 * hết đường tải, đúng bảo đảm "URL sống 5 phút" (AC2 US-11).
 */
export async function signChatGetUrl(key: string, ttlSeconds: number): Promise<string> {
  if (chatKhoCucBoDangBat()) {
    const u = await khoLocal.kyGet(key, ttlSeconds);
    if (!u) throw new ChatStorageConfigError("kho chat cục bộ không ký được URL đọc");
    return u;
  }
  const command = new GetObjectCommand({ Bucket: getChatBucket(), Key: key });
  return getSignedUrl(getR2Client(), command, { expiresIn: ttlSeconds });
}

/**
 * Xác minh đối tượng ĐÃ có trong bucket chat (V8.18 — app báo «đã tải xong» rồi máy chủ kiểm lại, không tin lời khai).
 * Trả `{size, contentType}`; không có đối tượng ⇒ `null`. Lỗi hạ tầng khác thì ném (người gọi coi là 503, không coi là «không có»).
 */
export async function headChatObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  if (chatKhoCucBoDangBat()) return khoLocal.dau(key);
  try {
    const r = await getR2Client().send(new HeadObjectCommand({ Bucket: getChatBucket(), Key: key }));
    return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
  } catch (e) {
    const code = (e as { name?: string; $metadata?: { httpStatusCode?: number } }).name;
    const http = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (code === "NotFound" || code === "NoSuchKey" || http === 404) return null;
    throw e;
  }
}

/**
 * V8.19 — đọc `n` byte ĐẦU của đối tượng THẬT trong kho chat (dùng để đối chiếu định dạng ảnh với MIME đã khai — không tin 16 byte do app gửi lúc xin vé).
 * Không có đối tượng ⇒ `null`. Lỗi hạ tầng khác thì ném (người gọi coi là 503).
 */
export async function docByteDauChat(key: string, n: number): Promise<Uint8Array | null> {
  if (chatKhoCucBoDangBat()) return khoLocal.docByteDau(key, n);
  try {
    const r = await getR2Client().send(new GetObjectCommand({ Bucket: getChatBucket(), Key: key, Range: `bytes=0-${Math.max(1, n) - 1}` }));
    const b = r.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    return b?.transformToByteArray ? await b.transformToByteArray() : null;
  } catch (e) {
    const code = (e as { name?: string }).name;
    const http = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (code === "NoSuchKey" || code === "NotFound" || http === 404) return null;
    throw e;
  }
}
