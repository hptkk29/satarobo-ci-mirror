import "server-only";

/**
 * E-LEARNING ONLINE — KHO VIDEO TRẢ PHÍ trên R2 (V8.44). Chủ dự án chốt: dùng bucket R2 ĐÃ CÓ của SataRobo, không tạo bucket riêng.
 *
 * Hai thứ ở file này, cả hai đều FAIL-CLOSED (thiếu/sai ⇒ NÉM, không có nhánh "tạm dùng thứ khác"):
 *  1. `getOnlineVideoBucket()` — TÊN bucket, đọc từ `R2_ONLINE_VIDEO_BUCKET_NAME`. Biến này CHỈ TRỎ vào một bucket đã tồn tại; nó không tạo gì.
 *     · Từ chối bucket ảnh chat / hoá đơn / bảo lưu: ba kho đó có luật giữ-xoá riêng, dùng chung là áp nhầm luật.
 *     · Từ chối `R2_BUCKET_NAME` (bucket gắn custom domain `cdn.satarobo.vn`, mọi object tải được vô danh nếu biết khoá) TRỪ KHI đặt rõ
 *       `R2_ONLINE_VIDEO_CHAP_NHAN_BUCKET_CONG_KHAI=true`. Đó là một quyết định RỦI RO của chủ dự án, không phải mặc định — xem ghi chú dưới.
 *  2. VÙNG KHOÁ — KHÔNG định nghĩa ở đây nữa. Chuẩn DUY NHẤT là hàm kiểm khoá của Core E (`lib/elearning-online/video-khoa.ts`: `VUNG_VIDEO_ONLINE` =
 *     `online/video/`, `laKhoaVideoOnlineHopLe`); lớp phát gọi qua `kiemKhoaVideo` (`khoa-video.ts`). Chỉ khoá dưới vùng đó mới được phát, kể cả khi
 *     bucket dùng chung với nội dung khác (SCORM, video giáo trình, bài nộp `online/sp/`, phôi `online/cn/`).
 *
 * ⚠️ NẾU BUCKET LÀ BUCKET CÔNG KHAI: lớp quyền ở route phát (vé · quyền học · thu hồi) bảo vệ MỌI đường đi qua ứng dụng, nhưng KHÔNG chặn được
 * ai biết đúng khoá và gõ thẳng `https://cdn.satarobo.vn/<khoá>` — quyền công khai là của CẢ bucket, không có "thư mục riêng tư" (xem `lib/bao-luu/kho-tep.ts`).
 * Cần một quy tắc Cloudflare (WAF / Transform Rule) CHẶN đường dẫn `/online/*` (ít nhất `/online/video/*`) trên host công khai — việc hạ tầng, KHÔNG kiểm được từ mã.
 * Code không bao giờ dựng hay trả URL công khai (`getPublicUrl`) cho video này; khoá không bao giờ ra khỏi máy chủ.
 */

export class OnlineVideoStorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnlineVideoStorageConfigError";
  }
}

/** Bucket KHÔNG được dùng cho video Online (có luật giữ/xoá riêng). `R2_BUCKET_NAME` xử lý riêng bên dưới (có cờ chấp nhận). */
const BUCKET_CAM: readonly (readonly [string, string])[] = [
  ["R2_CHAT_BUCKET_NAME", "bucket ảnh chat"],
  ["R2_INVOICE_BUCKET_NAME", "bucket hoá đơn điện tử"],
  ["R2_BAOLUU_BUCKET_NAME", "bucket đơn bảo lưu"],
];

export function getOnlineVideoBucket(): string {
  const bucket = (process.env.R2_ONLINE_VIDEO_BUCKET_NAME ?? "").trim();
  if (!bucket) {
    throw new OnlineVideoStorageConfigError(
      "R2_ONLINE_VIDEO_BUCKET_NAME chưa đặt — kho video Online chưa cấu hình (đặt tên một bucket R2 ĐÃ CÓ).",
    );
  }
  for (const [env, nhan] of BUCKET_CAM) {
    const khac = (process.env[env] ?? "").trim();
    if (khac && khac === bucket) {
      throw new OnlineVideoStorageConfigError(`R2_ONLINE_VIDEO_BUCKET_NAME trùng ${env} — ${nhan}; luật giữ/xoá khác nhau.`);
    }
  }
  const congKhai = (process.env.R2_BUCKET_NAME ?? "").trim();
  if (congKhai && congKhai === bucket && process.env.R2_ONLINE_VIDEO_CHAP_NHAN_BUCKET_CONG_KHAI !== "true") {
    throw new OnlineVideoStorageConfigError(
      "R2_ONLINE_VIDEO_BUCKET_NAME đang trỏ vào bucket CÔNG KHAI (R2_BUCKET_NAME): ai biết khoá tải được vô danh qua custom domain. " +
        "Chỉ cho phép khi chủ dự án chấp nhận rủi ro VÀ đã chặn đường dẫn online/* ở Cloudflare: đặt R2_ONLINE_VIDEO_CHAP_NHAN_BUCKET_CONG_KHAI=true.",
    );
  }
  return bucket;
}

/** Env đã đủ để phát video chưa — KHÔNG ném. Hỏi trước khi cấp vé: đừng cấp vé cho một video mà route phát chắc chắn trả 503. */
export function isOnlineVideoBucketConfigured(): boolean {
  try {
    getOnlineVideoBucket();
  } catch {
    return false;
  }
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}
