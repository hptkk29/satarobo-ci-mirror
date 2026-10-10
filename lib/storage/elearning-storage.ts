import "server-only";

/**
 * EL-10 — BUCKET R2 RIÊNG cho media đào tạo nội bộ.
 *
 * ⚠️ Vì sao KHÔNG dùng chung `R2_BUCKET_NAME`: bucket đó gắn custom domain
 * `cdn.satarobo.vn` và phát CÔNG KHAI. Ai đoán được khoá là tải được vô danh —
 * với ảnh marketing thì đó là tính năng, với video đào tạo nội bộ (có thẻ bảo
 * mật tới mức `CONFIDENTIAL`) thì đó là rò rỉ vĩnh viễn, vì tệp đã ra khỏi hệ
 * thống thì không thu về được.
 *
 * ⚠️ Hàm này THROW thay vì trả về giá trị dự phòng. Không có nhánh fallback nào,
 * cố ý: một đường dự phòng "tạm dùng bucket công khai" sẽ chạy đúng trong lúc
 * thử và rò rỉ trên prod. Khuôn này chép từ `lib/storage/chat-storage.ts`, nơi
 * chính nó đã chặn lại đúng lỗ hổng đó một lần.
 */

export class ElearningStorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElearningStorageConfigError";
  }
}

export function getElearningBucket(): string {
  const bucket = (process.env.R2_ELEARNING_BUCKET_NAME ?? "").trim();
  if (!bucket) {
    throw new ElearningStorageConfigError(
      "R2_ELEARNING_BUCKET_NAME chưa đặt — media đào tạo cần bucket R2 RIÊNG " +
        "(không gắn custom domain). Không được dùng tạm R2_BUCKET_NAME: bucket đó " +
        "phát công khai qua R2_PUBLIC_URL.",
    );
  }

  const publicBucket = (process.env.R2_BUCKET_NAME ?? "").trim();
  if (publicBucket && bucket === publicBucket) {
    throw new ElearningStorageConfigError(
      "R2_ELEARNING_BUCKET_NAME đang trỏ đúng vào bucket công khai " +
        "(R2_BUCKET_NAME) — video đào tạo sẽ tải được vô danh qua R2_PUBLIC_URL. " +
        "Hãy tạo bucket riêng.",
    );
  }

  // Trùng bucket chat cũng chặn: hai module có luật giữ/xoá khác nhau, và một
  // luật vòng đời đặt cho bucket này sẽ âm thầm áp lên tệp của module kia.
  const chatBucket = (process.env.R2_CHAT_BUCKET_NAME ?? "").trim();
  if (chatBucket && bucket === chatBucket) {
    throw new ElearningStorageConfigError(
      "R2_ELEARNING_BUCKET_NAME trùng bucket chat — hai module có luật giữ/xoá " +
        "khác nhau, dùng chung thì luật của bên này áp nhầm lên tệp của bên kia.",
    );
  }

  return bucket;
}

/** Env đã đủ để ký URL / phát tệp media đào tạo chưa. */
export function isElearningBucketConfigured(): boolean {
  try {
    getElearningBucket();
  } catch {
    return false;
  }
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}
