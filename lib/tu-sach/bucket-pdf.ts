/**
 * BUCKET RIÊNG cho PDF của Tủ sách (08/11/2026, chủ dự án chọn «tách PDF sang bucket riêng tư»).
 *
 * Vì sao: bucket `R2_BUCKET_NAME` mở công khai CẢ BUCKET (custom domain / r2.dev) nên mọi object tải được vô danh —
 * đo trên test: `…/tu-sach/ebook/2/sach.pdf` trả 200 không cần đăng nhập. «Thư mục riêng tư» trong bucket công khai không tồn tại,
 * nên link ký 5 phút chỉ là MỘT cách tải, không phải cách DUY NHẤT. PDF phải nằm ở bucket không công khai, và getter NÉM chứ không lùi
 * về bucket chung: một đường «tạm dùng bucket công khai» chạy đúng lúc thử rồi rò trên prod.
 *
 * Khuôn: `lib/bao-luu/kho-tep.ts`. Phần này THUẦN (không import R2) để test không cần mạng.
 */
export class TuSachKhoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TuSachKhoConfigError";
  }
}

const BUCKET_KHAC: readonly (readonly [string, string])[] = [
  ["R2_BUCKET_NAME", "bucket CÔNG KHAI — PDF sẽ tải được vô danh"],
  ["R2_CHAT_BUCKET_NAME", "bucket ảnh chat"],
  ["R2_ELEARNING_BUCKET_NAME", "bucket đào tạo nội bộ"],
  ["R2_INVOICE_BUCKET_NAME", "bucket hoá đơn điện tử"],
  ["R2_BAOLUU_BUCKET_NAME", "bucket tệp bảo lưu"],
];

/** Tên bucket PDF Tủ sách. NÉM `TuSachKhoConfigError` khi thiếu hoặc trùng bucket của module khác. */
export function getTuSachBucket(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const bucket = (env.R2_TU_SACH_BUCKET_NAME ?? "").trim();
  if (!bucket) throw new TuSachKhoConfigError("R2_TU_SACH_BUCKET_NAME chưa đặt — kho PDF Tủ sách chưa cấu hình");
  for (const [ten, nhan] of BUCKET_KHAC) {
    const khac = (env[ten] ?? "").trim();
    if (khac && khac === bucket) throw new TuSachKhoConfigError(`R2_TU_SACH_BUCKET_NAME trùng ${ten} — ${nhan}. Phải là bucket riêng, KHÔNG công khai.`);
  }
  return bucket;
}

/** Hỏi trước khi làm gì — KHÔNG ném. */
export function bucketTuSachHopLe(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  try {
    getTuSachBucket(env);
    return true;
  } catch {
    return false;
  }
}
