import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

// Cloudflare R2 — S3-compatible API.
// Endpoint: https://<account-id>.r2.cloudflarestorage.com · region "auto".
//
// LAZY INITIALIZATION: throw chỉ khi consumer gọi getR2Client / getR2Bucket / etc.
// Nếu throw ở module evaluation, Vercel build collect-page-data sẽ fail
// dù route không static-rendered. Lazy pattern cho phép build pass khi
// env vars chỉ có ở runtime.

function readEnv() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  const missing: string[] = [];
  if (!accountId) missing.push("R2_ACCOUNT_ID");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("R2_BUCKET_NAME");
  if (!publicUrl) missing.push("R2_PUBLIC_URL");

  if (missing.length > 0) {
    throw new Error(
      `R2 env vars missing: ${missing.join(", ")}. Add to .env.local (local) hoặc Vercel Environment Variables (production/preview/development).`,
    );
  }

  // Tự thêm scheme nếu thiếu (vd R2_PUBLIC_URL="cdn.satarobo.vn" → "https://cdn.satarobo.vn")
  // để getPublicUrl luôn ra URL tuyệt đối hợp lệ.
  const normalizedPublicUrl = (
    /^https?:\/\//i.test(publicUrl!) ? publicUrl! : `https://${publicUrl!}`
  ).replace(/\/$/, "");

  return {
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
    publicUrl: normalizedPublicUrl,
  };
}

/**
 * Đủ biến để `getR2Client()` dựng được client chưa — hỏi ĐÚNG `readEnv()`, KHÔNG ném.
 *
 * Vì sao cần: các kho riêng (hoá đơn…) từng tự kiểm một danh sách biến NGẮN hơn danh sách này
 * (thiếu `R2_BUCKET_NAME` + `R2_PUBLIC_URL`), nên màn hình báo "kho đã cấu hình", vẽ nút tải, rồi
 * route ký URL qua client chung và ném ⇒ 503 (đo 26/09/2026, smoke GĐ 7 hoá đơn). Kho nào ký URL
 * qua client chung thì hỏi hàm này, đừng chép lại danh sách biến.
 */
export function r2DaCauHinh(): boolean {
  try {
    readEnv();
    return true;
  } catch {
    return false;
  }
}

let _client: S3Client | null = null;

// Lazy R2 client — chỉ khởi tạo khi gọi.
export function getR2Client(): S3Client {
  if (_client) return _client;
  const env = readEnv();
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
    // ⚠️ BẮT BUỘC CHO URL KÝ SẴN — phát hiện khi nghiệm thu chat 10/08/2026.
    // Từ @aws-sdk/client-s3 v3.729, mặc định là `requestChecksumCalculation:
    // "WHEN_SUPPORTED"` ⇒ SDK nhét `x-amz-checksum-crc32` + `x-amz-sdk-checksum-algorithm`
    // vào URL ký sẵn của PutObject. Nhưng lúc KÝ thì server CHƯA CÓ file, nên giá trị
    // nhúng vào là CRC32 của body RỖNG (`AAAAAA==`). Trình duyệt PUT byte thật lên →
    // R2 tính CRC32 khác → TỪ CHỐI.
    //
    // Vì sao cực khó chẩn đoán: response lỗi của R2 KHÔNG kèm header CORS, nên trình
    // duyệt báo "No 'Access-Control-Allow-Origin' header is present" — nhìn y hệt lỗi
    // cấu hình CORS. Ngày 10/08 đã mất một vòng đi đặt CORS cho bucket (việc đó vẫn
    // đúng và vẫn cần) rồi mới lộ ra thủ phạm thật nằm ở đây.
    //
    // Ảnh hưởng KHÔNG chỉ chat: `getR2Client()` là client dùng chung cho mọi đường ký
    // URL, gồm cả upload của admin/SCORM (`lib/storage/signed-url.ts`).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return _client;
}

export function getR2Bucket(): string {
  return readEnv().bucket;
}

export function getR2PublicUrl(): string {
  return readEnv().publicUrl;
}

export function getPublicUrl(key: string): string {
  const cleanKey = key.startsWith("/") ? key.slice(1) : key;
  return `${getR2PublicUrl()}/${cleanKey}`;
}

/**
 * Xoá toàn bộ object dưới `prefix` (vd `scorm/<id>/`) — dùng khi gỡ/thay gói SCORM.
 * List phân trang (≤1000/lần) rồi DeleteObjects theo từng trang (giới hạn 1000 key/lần).
 * Best-effort: caller nên bọc try/catch — R2 lỗi chỉ để lại rác, KHÔNG chặn nghiệp vụ.
 * No-op khi prefix rỗng/"pending" (gói chưa kịp gán prefix thật).
 */
export async function deleteR2Prefix(prefix: string): Promise<void> {
  if (!prefix || prefix === "pending") return;
  const client = getR2Client();
  const bucket = getR2Bucket();
  let token: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    const objects = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k))
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }),
      );
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
}
